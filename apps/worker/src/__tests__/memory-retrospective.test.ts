import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

const recordWorkerJobOutcomeMock = vi.fn();
vi.mock("@agentfactory/db", () => ({
  recordWorkerJobOutcome: (...args: unknown[]) => recordWorkerJobOutcomeMock(...args),
  getAgent: vi.fn(),
  getSession: vi.fn(),
  getTaskBySessionId: vi.fn(),
  getRunsForSession: vi.fn(),
  listMessages: vi.fn(),
  listEventsForSession: vi.fn(),
  readAgentMemoryEntries: vi.fn(),
  decryptSecret: vi.fn(),
  findSimilarMemoryEntry: vi.fn(),
  findSimilarMemoryEntries: vi.fn(),
  replaceMemoryEntryWithWrite: vi.fn(),
  insertMemoryEntryWithWrite: vi.fn(),
  reinforceMemoryEntryWithWrite: vi.fn(),
}));

const mockLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
mockLog.child.mockReturnValue(mockLog);
vi.mock("@agentfactory/logger", () => ({
  createLogger: vi.fn(() => mockLog),
}));

const { processMemoryRetrospectiveJob, buildJudgeUserMessage, MAX_KNOWN_LESSONS_CHARS } = await import("../memory-retrospective");

const CORRECTION = "That's not how we write release notes here. No commit hashes, please.";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    getAgent: vi.fn().mockResolvedValue({ id: 2, orgId: 1 }),
    getSession: vi.fn().mockResolvedValue({ id: 3, agentId: 2 }),
    getTaskBySessionId: vi.fn().mockResolvedValue({ ref: "T-171", title: "Notes", description: "Write notes." }),
    getRunsForSession: vi.fn().mockResolvedValue([
      { id: 11, status: "done", triggeringMessageId: 101 },
      { id: 10, status: "done", triggeringMessageId: 100 },
    ]),
    listMessages: vi.fn().mockResolvedValue([
      { id: 100, role: "user", content: "Task: Notes\nWrite notes.", kind: "task_brief" },
      { id: 101, role: "user", content: CORRECTION },
    ]),
    listEventsForSession: vi.fn().mockResolvedValue([
      { id: 1, runId: 10, seq: 1, type: "tool_result", data: { toolUseId: "a", tool: "Bash", command: "git commit", inputSummary: "git commit", isError: true, subagent: false, ciphertext: "good" }, createdAt: "" },
      { id: 2, runId: 10, seq: 2, type: "tool_result", data: { toolUseId: "b", tool: "Bash", isError: true, ciphertext: "bad" }, createdAt: "" },
    ]),
    readAgentMemoryEntries: vi.fn().mockResolvedValue([{ id: 12, content: "Release notes are for end users." }]),
    decryptSecret: vi.fn((c: string) => {
      if (c === "bad") throw new Error("tampered");
      return { output: "Author identity unknown, key ghp_" + "A1b2C3d4E5".repeat(4) };
    }),
    judge: vi.fn().mockResolvedValue({
      reasoning: "The user corrected the format.",
      items: [
        { runId: 11, evidenceSource: "user_message", evidenceQuote: "No commit hashes, please", why: "User correction.", lesson: "Release notes: no commit hashes." },
        { runId: 11, evidenceSource: "user_message", evidenceQuote: "made up quote that is not there", why: "x", lesson: "Something else entirely." },
      ],
      truncated: false,
    }),
    writeMemoryEntry: vi.fn().mockResolvedValue({ reinforced: false }),
    reinforceMemoryEntryWithWrite: vi.fn().mockResolvedValue({ reinforced: true, duplicate: false }),
    ...overrides,
  };
}

describe("processMemoryRetrospectiveJob", () => {
  it("sends known lessons and a masked timeline, skipping rows that fail to decrypt", async () => {
    const d = deps();
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    const message = d.judge.mock.calls[0][0] as string;
    expect(message).toContain(`<known_lesson id="12">`);
    expect(message).toContain(CORRECTION);
    expect(message).toContain("Author identity unknown");
    expect(message).not.toContain("ghp_");
    expect(message.match(/<tool_failed /g)).toHaveLength(1);
  });

  it("writes accepted lessons with their own run as provenance and a quoted reason, and drops rejected ones", async () => {
    const d = deps();
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.writeMemoryEntry).toHaveBeenCalledExactlyOnceWith(1, 2, "Release notes: no commit hashes.", "retrospective", { runId: 11, sessionId: 3 }, {
      reason: `User correction. (evidence from run 11: "No commit hashes, please")`,
    });
  });

  it("reinforces a known lesson by id", async () => {
    const d = deps({
      judge: vi.fn().mockResolvedValue({
        items: [{ runId: 11, evidenceSource: "user_message", evidenceQuote: "No commit hashes, please", why: "Corrected again.", reinforcesLessonId: 12 }],
        truncated: false,
      }),
    });
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.writeMemoryEntry).not.toHaveBeenCalled();
    expect(d.reinforceMemoryEntryWithWrite).toHaveBeenCalledExactlyOnceWith(1, 2, 12, {
      source: "retrospective",
      lesson: "Release notes are for end users.",
      reason: `Corrected again. (evidence from run 11: "No commit hashes, please")`,
      runId: 11,
      sessionId: 3,
    });
  });

  it("ignores the judge's lesson text on a reinforcement and keeps the known lesson's wording", async () => {
    const d = deps({
      judge: vi.fn().mockResolvedValue({
        items: [
          {
            runId: 11,
            evidenceSource: "user_message",
            evidenceQuote: "No commit hashes, please",
            why: "Corrected again.",
            reinforcesLessonId: 12,
            lesson: "A completely different lesson text from the judge.",
          },
        ],
        truncated: false,
      }),
    });
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.writeMemoryEntry).not.toHaveBeenCalled();
    expect(d.reinforceMemoryEntryWithWrite).toHaveBeenCalledExactlyOnceWith(1, 2, 12, {
      source: "retrospective",
      lesson: "Release notes are for end users.",
      reason: `Corrected again. (evidence from run 11: "No commit hashes, please")`,
      runId: 11,
      sessionId: 3,
    });
  });

  it.each([
    ["agent from another org", { getAgent: vi.fn().mockResolvedValue({ id: 2, orgId: 99 }) }],
    ["session of another agent", { getSession: vi.fn().mockResolvedValue({ id: 3, agentId: 77 }) }],
    ["no runs", { getRunsForSession: vi.fn().mockResolvedValue([]) }],
  ])("does not judge: %s", async (_name, overrides) => {
    const d = deps(overrides);
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.judge).not.toHaveBeenCalled();
  });

  it("records a completed outcome with the accepted, reinforced and rejected counts", async () => {
    const d = deps();
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(recordWorkerJobOutcomeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "completed",
        details: { agentId: 2, accepted: expect.any(Number), reinforced: expect.any(Number), rejected: expect.any(Number) },
        durationMs: expect.any(Number),
      }),
    );
  });

  it("skips the judge when there is no user message of 15+ characters and no failure", async () => {
    const d = deps({
      listMessages: vi.fn().mockResolvedValue([
        { id: 100, role: "user", content: "Task brief", kind: "task_brief" },
        { id: 101, role: "user", content: "thanks" },
      ]),
      listEventsForSession: vi.fn().mockResolvedValue([]),
    });
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.judge).not.toHaveBeenCalled();
    expect(recordWorkerJobOutcomeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ orgId: 1, jobType: "memory_retrospective", subject: "session:3", status: "skipped", reason: "no_user_message_or_failure" }),
    );
  });

  it("judges a session whose only signal is an actionable run error", async () => {
    const d = deps({
      listMessages: vi.fn().mockResolvedValue([{ id: 100, role: "user", content: "Task brief", kind: "task_brief" }]),
      listEventsForSession: vi.fn().mockResolvedValue([
        { runId: 11, seq: 1, type: "error", data: { message: "Cannot push: remote branch already has unrelated commits that conflict" } },
      ]),
    });
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.judge).toHaveBeenCalledOnce();
    expect(d.judge.mock.calls[0]![0]).toContain("<run_error id=\"e1\">");
  });

  it("does not judge a session whose only signal is an infrastructure error", async () => {
    const d = deps({
      listMessages: vi.fn().mockResolvedValue([{ id: 100, role: "user", content: "Task brief", kind: "task_brief" }]),
      listEventsForSession: vi.fn().mockResolvedValue([
        { runId: 11, seq: 1, type: "error", data: { message: "Permission to acme/x.git denied to bot[bot]." } },
      ]),
    });
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.judge).not.toHaveBeenCalled();
  });

  it("works when the task is gone", async () => {
    const d = deps({ getTaskBySessionId: vi.fn().mockResolvedValue(undefined) });
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.judge).toHaveBeenCalledOnce();
  });

  it("rethrows judge API errors so the queue retries", async () => {
    const d = deps({ judge: vi.fn().mockRejectedValue(new Anthropic.APIConnectionError({ message: "down" })) });
    await expect(processMemoryRetrospectiveJob(1, 2, 3, d as never)).rejects.toThrow("down");
    expect(d.writeMemoryEntry).not.toHaveBeenCalled();
  });

  it("swallows other judge errors", async () => {
    const d = deps({ judge: vi.fn().mockRejectedValue(new Error("judge returned no report_lessons tool call")) });
    await expect(processMemoryRetrospectiveJob(1, 2, 3, d as never)).resolves.toBeUndefined();
    expect(recordWorkerJobOutcomeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed", reason: "judge_failed", error: "judge returned no report_lessons tool call" }),
    );
  });

  it("stores nothing when the judge output was cut off", async () => {
    const d = deps({ judge: vi.fn().mockResolvedValue({ items: [], truncated: true }) });
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.writeMemoryEntry).not.toHaveBeenCalled();
  });

  it("keeps going when one write fails", async () => {
    const d = deps({
      judge: vi.fn().mockResolvedValue({
        items: [
          { runId: 11, evidenceSource: "user_message", evidenceQuote: "No commit hashes, please", why: "a", lesson: "Lesson one about notes." },
          { runId: 11, evidenceSource: "user_message", evidenceQuote: "how we write release notes here", why: "b", lesson: "Lesson two about notes." },
        ],
        truncated: false,
      }),
      writeMemoryEntry: vi.fn().mockRejectedValueOnce(new Error("db")).mockResolvedValue({ reinforced: false }),
    });
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    expect(d.writeMemoryEntry).toHaveBeenCalledTimes(2);
  });

  it("does not crash on a setup error", async () => {
    const d = deps({ listMessages: vi.fn().mockRejectedValue(new Error("db down")) });
    await expect(processMemoryRetrospectiveJob(1, 2, 3, d as never)).resolves.toBeUndefined();
    expect(recordWorkerJobOutcomeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed", reason: "setup_failed", error: "db down" }),
    );
  });

  it("logs a rejected item without lesson, quote, why, or closest-match text", async () => {
    mockLog.info.mockClear();
    const quote = "made up quote that is not there";
    const d = deps();
    await processMemoryRetrospectiveJob(1, 2, 3, d as never);
    const rejectionCall = mockLog.info.mock.calls.find((call) => call[0] === "Rejected a judged lesson");
    expect(rejectionCall).toBeDefined();
    const serialized = JSON.stringify(rejectionCall);
    expect(serialized).not.toContain(quote);
    expect(serialized).not.toContain("Something else entirely");
    expect(serialized).toContain("quote not found");
  });
});

describe("buildJudgeUserMessage", () => {
  it("keeps the highest-weight known lessons and drops the ones past the character budget", () => {
    const knownLessons = [
      { id: 1, content: "a".repeat(MAX_KNOWN_LESSONS_CHARS - 100) },
      { id: 2, content: "This lesson does not fit in the remaining budget." },
    ];
    const message = buildJudgeUserMessage(knownLessons, "<timeline/>");
    expect(message).toContain(`<known_lesson id="1">`);
    expect(message).not.toContain(`<known_lesson id="2">`);
  });
});
