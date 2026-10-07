import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@kumiwork/core";

const listIdleSandboxSessionsMock = vi.fn();
const listStuckRunsMock = vi.fn();
const failRunIfStuckMock = vi.fn();
const appendEventMock = vi.fn();
const getRunsForSessionMock = vi.fn();
const getTaskBySessionIdMock = vi.fn();
const updateTaskMock = vi.fn();
const getSessionMock = vi.fn();
const getAgentMock = vi.fn();
vi.mock("@kumiwork/db", () => ({
  listIdleSandboxSessions: (...args: unknown[]) => listIdleSandboxSessionsMock(...args),
  listStuckRuns: (...args: unknown[]) => listStuckRunsMock(...args),
  failRunIfStuck: (...args: unknown[]) => failRunIfStuckMock(...args),
  appendEvent: (...args: unknown[]) => appendEventMock(...args),
  getRunsForSession: (...args: unknown[]) => getRunsForSessionMock(...args),
  getTaskBySessionId: (...args: unknown[]) => getTaskBySessionIdMock(...args),
  updateTask: (...args: unknown[]) => updateTaskMock(...args),
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getAgent: (...args: unknown[]) => getAgentMock(...args),
}));

const notifySessionOfReplyMock = vi.fn();
vi.mock("../channel-notify", () => ({
  notifySessionOfReply: (...args: unknown[]) => notifySessionOfReplyMock(...args),
}));

// @kumiwork/queue's module body throws unless REDIS_URL is set — mocked here so this stays
// a unit test with no Redis dependency, same as repo-map.test.ts.
const enqueueSandboxTeardownJobMock = vi.fn();
vi.mock("@kumiwork/queue", () => ({
  enqueueSandboxTeardownJob: (...args: unknown[]) => enqueueSandboxTeardownJobMock(...args),
}));

const { scanForIdleSandboxes, failStuckRuns } = await import("../sandbox-reap");

function fakeSession(id: number): Session {
  return {
    id,
    agentId: 1,
    title: "Test session",
    origin: "web",
    sandboxId: "sandbox-abc",
    createdAt: "2026-09-01T00:00:00.000Z",
    lastActivityAt: "2026-09-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  listStuckRunsMock.mockReset().mockResolvedValue([]);
  failRunIfStuckMock.mockReset().mockImplementation(async (id: number) => ({ id, sessionId: 3, status: "failed" }));
  appendEventMock.mockReset().mockResolvedValue(undefined);
  getRunsForSessionMock.mockReset().mockImplementation(async () => [{ id: 7 }]);
  getTaskBySessionIdMock.mockReset().mockResolvedValue(undefined);
  updateTaskMock.mockReset().mockResolvedValue(undefined);
  getSessionMock.mockReset().mockResolvedValue(undefined);
  getAgentMock.mockReset().mockResolvedValue(undefined);
  notifySessionOfReplyMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scanForIdleSandboxes", () => {
  it("enqueues a teardown job for exactly each session the scan returns, nothing else", async () => {
    listIdleSandboxSessionsMock.mockReset().mockResolvedValue([fakeSession(1), fakeSession(2)]);
    enqueueSandboxTeardownJobMock.mockReset().mockResolvedValue(undefined);

    const count = await scanForIdleSandboxes();

    expect(count).toBe(2);
    expect(enqueueSandboxTeardownJobMock).toHaveBeenCalledTimes(2);
    expect(enqueueSandboxTeardownJobMock).toHaveBeenNthCalledWith(1, 1);
    expect(enqueueSandboxTeardownJobMock).toHaveBeenNthCalledWith(2, 2);
  });

  it("enqueues nothing when the scan returns no idle sessions", async () => {
    listIdleSandboxSessionsMock.mockReset().mockResolvedValue([]);
    enqueueSandboxTeardownJobMock.mockReset().mockResolvedValue(undefined);

    const count = await scanForIdleSandboxes();

    expect(count).toBe(0);
    expect(enqueueSandboxTeardownJobMock).not.toHaveBeenCalled();
  });
});

describe("failStuckRuns", () => {
  const stuckRun = { id: 7, sessionId: 3, status: "running" };

  it("asks for runs inactive for twice the turn timeout", async () => {
    vi.stubEnv("RUN_TURN_TIMEOUT_MS", String(10 * 60 * 1000));
    const now = Date.now();

    await failStuckRuns();

    const cutoff = listStuckRunsMock.mock.calls[0][0] as Date;
    expect(now - cutoff.getTime()).toBeGreaterThanOrEqual(20 * 60 * 1000);
    expect(now - cutoff.getTime()).toBeLessThan(20 * 60 * 1000 + 5000);
  });

  it("fails the run with the same cutoff, records an error event, and fails its task", async () => {
    listStuckRunsMock.mockResolvedValue([stuckRun]);
    getTaskBySessionIdMock.mockResolvedValue({ id: 11, status: "in_progress" });

    const count = await failStuckRuns();

    expect(count).toBe(1);
    expect(failRunIfStuckMock).toHaveBeenCalledWith(7, listStuckRunsMock.mock.calls[0][0]);
    expect(appendEventMock).toHaveBeenCalledWith(7, "error", { message: expect.any(String) });
    expect(updateTaskMock).toHaveBeenCalledWith(11, { status: "failed" });
  });

  it("does not touch a run that finished before the guarded update", async () => {
    listStuckRunsMock.mockResolvedValue([stuckRun]);
    failRunIfStuckMock.mockResolvedValue(undefined);
    getTaskBySessionIdMock.mockResolvedValue({ id: 11, status: "pr_open" });

    const count = await failStuckRuns();

    expect(count).toBe(0);
    expect(appendEventMock).not.toHaveBeenCalled();
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("leaves the task alone when a newer run exists on the session", async () => {
    listStuckRunsMock.mockResolvedValue([stuckRun]);
    getRunsForSessionMock.mockResolvedValue([{ id: 9 }, { id: 7 }]);
    getTaskBySessionIdMock.mockResolvedValue({ id: 11, status: "pr_open" });

    await failStuckRuns();

    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("still fails the run when its session has no task", async () => {
    listStuckRunsMock.mockResolvedValue([stuckRun]);

    await failStuckRuns();

    expect(failRunIfStuckMock).toHaveBeenCalled();
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("tells the session's channel that the run failed", async () => {
    listStuckRunsMock.mockResolvedValue([stuckRun]);
    const session = { id: 3, agentId: 4, origin: "telegram" };
    getSessionMock.mockResolvedValue(session);
    getAgentMock.mockResolvedValue({ id: 4, orgId: 2 });

    await failStuckRuns();

    expect(notifySessionOfReplyMock).toHaveBeenCalledWith(2, session, expect.any(String), expect.any(Function));
  });

  it("keeps sweeping the other runs when one run's handling throws", async () => {
    listStuckRunsMock.mockResolvedValue([stuckRun, { id: 8, sessionId: 4, status: "running" }]);
    failRunIfStuckMock.mockRejectedValueOnce(new Error("db down"));

    const count = await failStuckRuns();

    expect(count).toBe(1);
    expect(failRunIfStuckMock).toHaveBeenCalledTimes(2);
    expect(appendEventMock).toHaveBeenCalledWith(8, "error", expect.anything());
  });

  it("does nothing when no run is stuck", async () => {
    const count = await failStuckRuns();

    expect(count).toBe(0);
    expect(failRunIfStuckMock).not.toHaveBeenCalled();
  });

  it("is run by the idle scan before it looks for idle sessions", async () => {
    listIdleSandboxSessionsMock.mockResolvedValue([]);
    listStuckRunsMock.mockResolvedValue([stuckRun]);

    await scanForIdleSandboxes();

    expect(failRunIfStuckMock).toHaveBeenCalledWith(7, expect.any(Date));
  });

  it("still scans for idle sandboxes when the sweep itself fails", async () => {
    listStuckRunsMock.mockRejectedValue(new Error("db down"));
    listIdleSandboxSessionsMock.mockResolvedValue([fakeSession(1)]);
    enqueueSandboxTeardownJobMock.mockReset().mockResolvedValue(undefined);

    const count = await scanForIdleSandboxes();

    expect(count).toBe(1);
    expect(enqueueSandboxTeardownJobMock).toHaveBeenCalledWith(1);
  });
});
