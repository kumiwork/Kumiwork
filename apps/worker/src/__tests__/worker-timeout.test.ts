import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const workers: Array<{ name: string; processor: (job: { data: unknown }) => Promise<unknown> }> = [];
  const sandbox = {
    create: vi.fn(async () => ({ id: "sandbox-1" })),
    exec: vi.fn(),
    writeFiles: vi.fn(),
    readWorkspace: vi.fn(async () => ({})),
    destroy: vi.fn(),
    exists: vi.fn(async () => true),
    resetMemory: vi.fn(),
    interrupt: vi.fn(async () => undefined),
  };
  const runTurn = vi.fn();
  const revokeModelCredential = vi.fn();
  const issueModelCredential = vi.fn((_context: unknown) => ({
    endpoint: { baseUrl: "http://host.docker.internal:8787/anthropic", token: "kumiwork-run-test" },
    revoke: revokeModelCredential,
  }));
  return { workers, sandbox, runTurn, revokeModelCredential, issueModelCredential };
});

vi.mock("bullmq", () => ({
  Worker: class {
    constructor(name: string, processor: (job: { data: unknown }) => Promise<unknown>) {
      h.workers.push({ name, processor });
    }
    on() {}
  },
  Queue: class {
    add() {
      return Promise.resolve();
    }
  },
}));

// Imported for its queue-name constants only; importing it for real opens an ioredis connection.
vi.mock("@kumiwork/queue", () => ({
  RUN_QUEUE_NAME: "runs",
  RUN_CANCEL_QUEUE_NAME: "run-cancel",
  SANDBOX_TEARDOWN_QUEUE_NAME: "sandbox-teardown",
  SANDBOX_REAP_QUEUE_NAME: "sandbox-reap",
  REPO_MAP_WARM_QUEUE_NAME: "repo-map-warm",
  EVAL_QUEUE_NAME: "evals",
  MEMORY_RETROSPECTIVE_QUEUE_NAME: "memory-retrospective",
  TEAM_CONTEXT_INGEST_QUEUE_NAME: "team-context-ingest",
  TASK_CONTEXT_INGEST_QUEUE_NAME: "task-context-ingest",
  queueConnection: {},
}));

vi.mock("@kumiwork/db", () => ({
  CURRENT_KEY_VERSION: 1,
  clearSessionSandbox: vi.fn(),
  createEvent: vi.fn(),
  createMessage: vi.fn(),
  createPendingPrReview: vi.fn(),
  encryptSecret: vi.fn(),
  getCodebaseSettings: vi.fn(async () => undefined),
  findSimilarMemoryEntry: vi.fn(),
  findSimilarMemoryEntries: vi.fn(),
  replaceMemoryEntryWithWrite: vi.fn(),
  getAgent: vi.fn(),
  getLatestPrReview: vi.fn(async () => undefined),
  getLatestResumeCandidate: vi.fn(async () => undefined),
  getMessage: vi.fn(),
  getRun: vi.fn(),
  getRunsForSession: vi.fn(async () => []),
  getSession: vi.fn(),
  getTaskBySessionId: vi.fn(),
  getTeamForOrg: vi.fn(async () => undefined),
  hasNonTerminalRun: vi.fn(async () => false),
  insertMemoryEntryWithWrite: vi.fn(),
  insertRunContextRetrievals: vi.fn(),
  listMessages: vi.fn(async () => []),
  readAgentMemoryEntries: vi.fn(async () => []),
  reinforceMemoryEntryWithWrite: vi.fn(),
  setSessionSandbox: vi.fn(),
  touchSessionActivity: vi.fn(),
  updateRunCommitRange: vi.fn(),
  updateRunStatus: vi.fn(),
  updateRunWorkspace: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@kumiwork/scm", () => ({
  parsePullRequestReferenceAcrossProviders: vi.fn(),
  resolveScmConnection: vi.fn(),
}));

vi.mock("../sandbox/docker-sandbox-provider", () => ({
  DockerSandboxProvider: class {
    create = h.sandbox.create;
    exec = h.sandbox.exec;
    writeFiles = h.sandbox.writeFiles;
    readWorkspace = h.sandbox.readWorkspace;
    destroy = h.sandbox.destroy;
    exists = h.sandbox.exists;
    resetMemory = h.sandbox.resetMemory;
    interrupt = h.sandbox.interrupt;
  },
}));

vi.mock("../agent-runtime/registry", () => ({
  getAgentRuntime: () => ({
    kind: "claude-code",
    capabilities: () => ({ supportsSkills: true, skillDir: ".claude/skills", supportsResume: true }),
    runTurn: h.runTurn,
  }),
}));

// Only the two sandbox-executing helpers are stubbed; parseStructuredReview,
// validateReviewComments, renderReviewAsMarkdown, resolveReviewRange and truncateDiff stay real,
// because the failure this file exercises is a real parseStructuredReview throw.
vi.mock("../pr-review", async () => {
  const actual = await vi.importActual<typeof import("../pr-review")>("../pr-review");
  return { ...actual, checkoutPullRequest: vi.fn(), isAncestor: vi.fn(async () => false) };
});

vi.mock("../scm-provider", () => ({
  buildPullRequestBody: vi.fn(() => ""),
  cloneIntoSandbox: vi.fn(),
  resolveDetectedLanguage: vi.fn(async () => undefined),
  fetchIssue: vi.fn(),
  fetchPullRequestFeedback: vi.fn(),
  openPullRequest: vi.fn(),
  parseIssueReference: vi.fn(() => undefined),
  pushChangesIfDirty: vi.fn(async () => ({ changedFiles: [], pushed: false })),
  resolveCloneTarget: vi.fn(),
  sessionBranchName: vi.fn(() => "agent/session-1"),
  syncWithDefaultBranch: vi.fn(async () => ({ status: "up_to_date" })),
}));

vi.mock("../repo-map", () => ({ ensureRepoMap: vi.fn(async () => ""), warmRepoMap: vi.fn() }));
vi.mock("../sandbox-model-access", () => ({
  startModelProxy: vi.fn(async () => ({})),
  issueSandboxModelCredential: h.issueModelCredential,
}));
vi.mock("../context-retrieval", () => ({
  buildRetrievalQuery: vi.fn(() => ""),
  retrieveContext: vi.fn(async () => ({ text: "", retrievals: [] })),
}));
vi.mock("../context-ingest-wait", () => ({ waitForPendingContextIngest: vi.fn(async () => undefined) }));
vi.mock("../task-documents", () => ({ materialiseTaskDocuments: vi.fn(async () => ({ written: [], omitted: [] })) }));
vi.mock("../skills-materialize", () => ({ materialiseSkills: vi.fn(async () => []) }));
vi.mock("../eval-runner", () => ({ processEvalJob: vi.fn() }));
vi.mock("../memory-retrospective", () => ({ processMemoryRetrospectiveJob: vi.fn() }));
vi.mock("../context-ingest", () => ({ ingestTaskContextItem: vi.fn(), ingestTeamContextItem: vi.fn() }));
vi.mock("../task-notify", () => ({ notifyIssueOfPullRequest: vi.fn() }));
vi.mock("../sandbox-reap", () => ({ SANDBOX_REAP_INTERVAL_MS: 60_000, scanForIdleSandboxes: vi.fn() }));

import {
  createEvent,
  getAgent,
  getRun,
  getSession,
  getTaskBySessionId,
  updateRunStatus,
  updateTask,
} from "@kumiwork/db";
import { parsePullRequestReferenceAcrossProviders } from "@kumiwork/scm";

const TURN_LIMIT_MS = 40;

let runProcessor: (job: { data: unknown }) => Promise<unknown>;

beforeAll(async () => {
  await import("../worker");
  const entry = h.workers.find((w) => w.name === "runs");
  if (!entry) throw new Error("run worker was never constructed");
  runProcessor = entry.processor;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RUN_TURN_TIMEOUT_MS = String(TURN_LIMIT_MS);

  vi.mocked(getRun).mockResolvedValue({
    id: 1,
    sessionId: 10,
    status: "running",
    createdAt: new Date().toISOString(),
    triggeringMessageId: null,
  } as never);
  vi.mocked(getSession).mockResolvedValue({
    id: 10,
    agentId: 20,
    sandboxId: "sandbox-1",
    createdAt: new Date().toISOString(),
  } as never);
  vi.mocked(getAgent).mockResolvedValue({
    id: 20,
    orgId: 5,
    teamId: null,
    name: "Builder",
    systemPrompt: "You build things.",
    model: { family: "anthropic", id: "claude-x", maxTokens: 8192 },
    onContextOverflow: "fail",
  } as never);
  vi.mocked(getTaskBySessionId).mockResolvedValue({
    id: 30,
    ref: "T-1",
    title: "Write the changelog",
    description: "Summarise this release for the changelog.",
    codebase: undefined,
    prNumber: undefined,
  } as never);
  vi.mocked(parsePullRequestReferenceAcrossProviders).mockReturnValue(undefined as never);
});

afterEach(() => {
  delete process.env.RUN_TURN_TIMEOUT_MS;
});

function hangForever() {
  h.runTurn.mockImplementation(() => new Promise(() => {}));
}

describe("a run whose agent turn outlives the wall-clock limit", () => {
  beforeEach(() => {
    hangForever();
  });

  it("fails the job with the timeout error", async () => {
    await expect(runProcessor({ data: { runId: 1 } })).rejects.toThrow(/limit/);
  });

  it("kills the turn's exec in the run's sandbox", async () => {
    await runProcessor({ data: { runId: 1 } }).catch(() => undefined);

    expect(h.sandbox.interrupt).toHaveBeenCalledWith("sandbox-1");
  });

  it("records an error event and a done event with reason budget_exceeded", async () => {
    await runProcessor({ data: { runId: 1 } }).catch(() => undefined);

    expect(createEvent).toHaveBeenCalledWith(
      1,
      expect.any(Number),
      "error",
      expect.objectContaining({ message: expect.stringContaining("limit") }),
    );
    expect(createEvent).toHaveBeenCalledWith(1, expect.any(Number), "done", { reason: "budget_exceeded" });
  });

  it("marks the run failed with budgetExceeded set, and fails the task", async () => {
    await runProcessor({ data: { runId: 1 } }).catch(() => undefined);

    expect(updateRunStatus).toHaveBeenCalledWith(1, "failed", expect.objectContaining({ budgetExceeded: true }));
    expect(updateTask).toHaveBeenCalledWith(30, { status: "failed" });
  });

  it("revokes the model credential", async () => {
    await runProcessor({ data: { runId: 1 } }).catch(() => undefined);

    expect(h.revokeModelCredential).toHaveBeenCalledTimes(1);
  });

  it("leaves the sandbox alive for the idle reaper", async () => {
    await runProcessor({ data: { runId: 1 } }).catch(() => undefined);

    expect(h.sandbox.destroy).not.toHaveBeenCalled();
  });

  it("stays cancelled when the user pressed Stop before the limit hit", async () => {
    vi.mocked(getRun)
      .mockResolvedValueOnce({ id: 1, sessionId: 10, status: "running", createdAt: new Date().toISOString() } as never)
      .mockResolvedValue({ id: 1, sessionId: 10, status: "cancelled", createdAt: new Date().toISOString() } as never);

    await runProcessor({ data: { runId: 1 } });

    expect(createEvent).toHaveBeenCalledWith(1, expect.any(Number), "done", { reason: "cancelled" });
    expect(createEvent).not.toHaveBeenCalledWith(1, expect.any(Number), "done", { reason: "budget_exceeded" });
    expect(updateRunStatus).not.toHaveBeenCalledWith(1, "failed", expect.anything());
  });
});

describe("a run whose agent turn finishes within the limit", () => {
  it("completes without interrupting anything", async () => {
    h.runTurn.mockResolvedValue({ text: "All done.", providerSessionRef: "sdk-1" } as never);

    await runProcessor({ data: { runId: 1 } });
    await new Promise((resolve) => setTimeout(resolve, TURN_LIMIT_MS * 2));

    expect(h.sandbox.interrupt).not.toHaveBeenCalled();
    expect(updateRunStatus).toHaveBeenCalledWith(1, "done", expect.anything());
    expect(createEvent).not.toHaveBeenCalledWith(1, expect.any(Number), "done", { reason: "budget_exceeded" });
  });

  it("does not fail a fast turn just because the environment sets a limit", async () => {
    h.runTurn.mockResolvedValue({ text: "Quick.", providerSessionRef: "sdk-2" } as never);

    await expect(runProcessor({ data: { runId: 1 } })).resolves.not.toThrow();
  });
});
