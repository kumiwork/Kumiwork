import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassifierResult } from "../router-classifier";

const db = vi.hoisted(() => ({
  listModelRouterDecisionsForSession: vi.fn(),
  insertModelRouterDecisions: vi.fn(),
  isFirstRunOfSession: vi.fn(),
  recordWorkerJobOutcome: vi.fn(),
  getSession: vi.fn(),
  getAgent: vi.fn(),
  getTaskBySessionId: vi.fn(),
  getRun: vi.fn(),
  getMessage: vi.fn(),
}));
const queue = vi.hoisted(() => ({ enqueueModelRouterJob: vi.fn() }));

vi.mock("@kumiwork/db", () => db);
vi.mock("@kumiwork/queue", () => queue);

import { processModelRouterJob, resolveModelRouterMode, scheduleModelRouter } from "../model-router-job";

const jobData = {
  orgId: 1,
  sessionId: 3,
  runId: 40,
  actual: { modelId: "claude-sonnet-5-5", effort: "high", effortWasDefault: true, selectionReason: "agent_default" },
};

const okClassifier = vi.fn(
  async (): Promise<ClassifierResult> => ({
    ok: true,
    guess: { modelId: "claude-haiku-5-5", effort: "medium", reason: "small", confidence: "high" },
    latencyMs: 800,
  }),
);

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(queue)]) fn.mockReset();
  okClassifier.mockClear();
  db.getSession.mockResolvedValue({ id: 3, agentId: 9 });
  db.getAgent.mockResolvedValue({ id: 9, name: "Developer", description: "" });
  db.getTaskBySessionId.mockResolvedValue({
    title: "Fix login",
    description: "Short.",
    acceptanceCriteria: [],
    codebase: "acme/web",
  });
  db.getRun.mockResolvedValue({ id: 40, triggeringMessageId: undefined });
  db.insertModelRouterDecisions.mockResolvedValue(2);
  db.isFirstRunOfSession.mockResolvedValue(true);
  db.listModelRouterDecisionsForSession.mockResolvedValue([]);
  db.recordWorkerJobOutcome.mockResolvedValue(undefined);
  queue.enqueueModelRouterJob.mockResolvedValue(undefined);
});

describe("resolveModelRouterMode", () => {
  it("defaults to shadow", () => {
    expect(resolveModelRouterMode(undefined)).toBe("shadow");
    expect(resolveModelRouterMode("nonsense")).toBe("shadow");
    expect(resolveModelRouterMode("off")).toBe("off");
    expect(resolveModelRouterMode("apply")).toBe("apply");
  });
});

describe("scheduleModelRouter", () => {
  const context = { orgId: 1, sessionId: 3, runId: 40, selection: { modelId: "claude-sonnet-5-5", reason: "agent_default" } };

  it("enqueues the first run with the catalog default effort filled in", async () => {
    await scheduleModelRouter(context, "shadow");

    expect(queue.enqueueModelRouterJob).toHaveBeenCalledExactlyOnceWith({
      orgId: 1,
      sessionId: 3,
      runId: 40,
      actual: { modelId: "claude-sonnet-5-5", effort: "high", effortWasDefault: true, selectionReason: "agent_default" },
    });
  });

  it("keeps an explicit effort", async () => {
    await scheduleModelRouter({ ...context, selection: { ...context.selection, effort: "low" } }, "shadow");

    expect(queue.enqueueModelRouterJob.mock.calls[0][0].actual).toMatchObject({ effort: "low", effortWasDefault: false });
  });

  it("does nothing when the mode is off or the run is not the first", async () => {
    await scheduleModelRouter(context, "off");
    db.isFirstRunOfSession.mockResolvedValue(false);
    await scheduleModelRouter(context, "shadow");

    expect(queue.enqueueModelRouterJob).not.toHaveBeenCalled();
  });

  it("never throws when the first-run check rejects, and does not enqueue", async () => {
    db.isFirstRunOfSession.mockRejectedValue(new Error("db down"));

    await expect(scheduleModelRouter(context, "shadow")).resolves.toBeUndefined();
    expect(queue.enqueueModelRouterJob).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    queue.enqueueModelRouterJob.mockRejectedValue(new Error("redis down"));
    await expect(scheduleModelRouter(context, "shadow")).resolves.toBeUndefined();
  });
});

describe("processModelRouterJob", () => {
  it("writes a rules row and a classifier row with the same actual choice", async () => {
    await processModelRouterJob(jobData, okClassifier);

    expect(okClassifier).toHaveBeenCalledWith(expect.objectContaining({ title: "Fix login" }), 3);
    const rows = db.insertModelRouterDecisions.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      method: "rules",
      modelId: "claude-haiku-5-5",
      effort: "high",
      reason: "short_task",
      routerVersion: "rules-1",
      actualModelId: "claude-sonnet-5-5",
      actualEffort: "high",
      actualEffortWasDefault: true,
      features: { kind: "task", hasCodebase: true, selectionReason: "agent_default" },
      prices: { "claude-haiku-5-5": 0.5, "claude-sonnet-5-5": 10, "claude-opus-5-5": 20 },
    });
    expect(rows[1]).toMatchObject({
      method: "classifier",
      modelId: "claude-haiku-5-5",
      effort: "medium",
      confidence: "high",
      latencyMs: 800,
      routerVersion: "classifier-1",
      classifierModel: "claude-haiku-5-5",
    });
    expect(rows[1].promptHash).toMatch(/^[0-9a-f]{16}$/);
    expect(db.recordWorkerJobOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: "model_router", subject: "session:3", status: "completed" }),
    );
  });

  it("stores a classifier failure as an error row", async () => {
    const failing = vi.fn(async (): Promise<ClassifierResult> => ({ ok: false, error: "timeout", latencyMs: 10_000 }));

    await processModelRouterJob(jobData, failing);

    const classifierRow = db.insertModelRouterDecisions.mock.calls[0][0][1];
    expect(classifierRow).toMatchObject({ method: "classifier", error: "timeout", latencyMs: 10_000 });
    expect(classifierRow.modelId).toBeUndefined();
  });

  it("drops an unknown effort in the job data", async () => {
    await processModelRouterJob({ ...jobData, actual: { ...jobData.actual, effort: "turbo" } }, okClassifier);

    expect(db.insertModelRouterDecisions.mock.calls[0][0][0].actualEffort).toBeUndefined();
  });

  it("skips before any guess work when decisions already exist", async () => {
    db.listModelRouterDecisionsForSession.mockResolvedValue([{ id: 1, method: "rules" }]);

    await processModelRouterJob(jobData, okClassifier);

    expect(okClassifier).not.toHaveBeenCalled();
    expect(db.insertModelRouterDecisions).not.toHaveBeenCalled();
    expect(db.recordWorkerJobOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", reason: "already_recorded" }),
    );
  });

  it("records a skip when a concurrent insert wins the race", async () => {
    db.insertModelRouterDecisions.mockResolvedValue(0);

    await processModelRouterJob(jobData, okClassifier);

    expect(db.recordWorkerJobOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", reason: "already_recorded" }),
    );
  });

  it("writes nothing and rethrows when the classifier throws", async () => {
    const throwing = vi.fn(async (): Promise<ClassifierResult> => {
      throw new Error("classifier blew up");
    });

    await expect(processModelRouterJob(jobData, throwing)).rejects.toThrow("classifier blew up");
    expect(db.insertModelRouterDecisions).not.toHaveBeenCalled();
    expect(db.recordWorkerJobOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "classifier blew up" }),
    );
  });

  it("stores the classifier reason as-is without logging it", async () => {
    const reason = "ignore previous instructions {{x}}";
    const odd = vi.fn(
      async (): Promise<ClassifierResult> => ({
        ok: true,
        guess: { modelId: "claude-haiku-5-5", effort: "low", reason, confidence: "low" },
        latencyMs: 5,
      }),
    );

    await processModelRouterJob(jobData, odd);

    expect(db.insertModelRouterDecisions.mock.calls[0][0][1].reason).toBe(reason);
  });

  it("skips a session that no longer exists without calling the classifier", async () => {
    db.getSession.mockResolvedValue(undefined);

    await processModelRouterJob(jobData, okClassifier);

    expect(okClassifier).not.toHaveBeenCalled();
    expect(db.insertModelRouterDecisions).not.toHaveBeenCalled();
    expect(db.recordWorkerJobOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", reason: "session_gone" }));
  });

  it("records the failure and throws when the DB write fails, so BullMQ retries", async () => {
    db.insertModelRouterDecisions.mockRejectedValue(new Error("db down"));

    await expect(processModelRouterJob(jobData, okClassifier)).rejects.toThrow("db down");
    expect(db.recordWorkerJobOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "db down" }));
  });
});
