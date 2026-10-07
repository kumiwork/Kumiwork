import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import "../setup.js";
import { db } from "../../client.js";
import { events, runs, sessions } from "../../schema.js";
import { createRun, failRunIfStuck, getRun, hasNonTerminalRun, listStuckRuns, updateRunStatus } from "../../repositories/runs.js";
import { appendEvent } from "../../repositories/events.js";
import { listIdleSandboxSessions, setSessionSandbox } from "../../repositories/sessions.js";
import { insertAgent, insertOrg, insertSession } from "../fixtures.js";
import type { Session } from "@kumiwork/core";

const HOUR = 60 * 60 * 1000;

async function setupIdleSandboxSession(): Promise<Session> {
  const org = await insertOrg();
  const agent = await insertAgent(org.id);
  const session = await insertSession(org.id, agent.id);
  await setSessionSandbox(session.id, "sandbox-123", "kumiwork-sandbox-node:local");
  await backdateLastActivity(session.id, 3 * HOUR);
  return session;
}

// listIdleSandboxSessions/hasNonTerminalRun have no setter for an arbitrary lastActivityAt (the
// only writer, touchSessionActivity, always stamps "now") — tests reach past the repository to
// set it directly, the same way sessions.test.ts reaches for `db` to assert FK cascade behavior.
async function backdateLastActivity(sessionId: number, ageMs: number): Promise<void> {
  await db
    .update(sessions)
    .set({ lastActivityAt: new Date(Date.now() - ageMs) })
    .where(eq(sessions.id, sessionId));
}

describe("listIdleSandboxSessions", () => {
  it("excludes a session with no sandbox", async () => {
    const org = await insertOrg();
    const agent = await insertAgent(org.id);
    const session = await insertSession(org.id, agent.id);
    await backdateLastActivity(session.id, 3 * HOUR);

    const idle = await listIdleSandboxSessions(new Date(Date.now() - 2 * HOUR));

    expect(idle.map((s) => s.id)).not.toContain(session.id);
  });

  it("includes an idle session with a sandbox and no runs", async () => {
    const session = await setupIdleSandboxSession();

    const idle = await listIdleSandboxSessions(new Date(Date.now() - 2 * HOUR));

    expect(idle.map((s) => s.id)).toContain(session.id);
  });

  it("includes an idle session whose only runs are terminal", async () => {
    const session = await setupIdleSandboxSession();
    const done = await createRun(session.id);
    await updateRunStatus(done.id, "done");
    const failed = await createRun(session.id);
    await updateRunStatus(failed.id, "failed");
    const cancelled = await createRun(session.id);
    await updateRunStatus(cancelled.id, "cancelled");

    const idle = await listIdleSandboxSessions(new Date(Date.now() - 2 * HOUR));

    expect(idle.map((s) => s.id)).toContain(session.id);
  });

  it("excludes an idle session with a non-terminal run", async () => {
    const session = await setupIdleSandboxSession();
    await createRun(session.id); // defaults to "queued"

    const idle = await listIdleSandboxSessions(new Date(Date.now() - 2 * HOUR));

    expect(idle.map((s) => s.id)).not.toContain(session.id);
    await expect(hasNonTerminalRun(session.id)).resolves.toBe(true);
  });

  it("excludes a session with a sandbox that is not yet idle", async () => {
    const org = await insertOrg();
    const agent = await insertAgent(org.id);
    const session = await insertSession(org.id, agent.id);
    await setSessionSandbox(session.id, "sandbox-123", "kumiwork-sandbox-node:local");
    await backdateLastActivity(session.id, 5 * 60 * 1000); // 5 minutes ago

    const idle = await listIdleSandboxSessions(new Date(Date.now() - 2 * HOUR));

    expect(idle.map((s) => s.id)).not.toContain(session.id);
  });
});

describe("hasNonTerminalRun", () => {
  it("returns false when the session has no runs", async () => {
    const org = await insertOrg();
    const agent = await insertAgent(org.id);
    const session = await insertSession(org.id, agent.id);

    await expect(hasNonTerminalRun(session.id)).resolves.toBe(false);
  });

  it("returns false when every run is terminal", async () => {
    const org = await insertOrg();
    const agent = await insertAgent(org.id);
    const session = await insertSession(org.id, agent.id);
    const run = await createRun(session.id);
    await updateRunStatus(run.id, "done");

    await expect(hasNonTerminalRun(session.id)).resolves.toBe(false);
  });

  it("returns true when a run is in a non-terminal status", async () => {
    const org = await insertOrg();
    const agent = await insertAgent(org.id);
    const session = await insertSession(org.id, agent.id);
    const run = await createRun(session.id);
    await updateRunStatus(run.id, "running");

    await expect(hasNonTerminalRun(session.id)).resolves.toBe(true);
  });
});

type RunStatusName = "queued" | "provisioning" | "running" | "finalizing" | "done" | "failed" | "cancelled";

async function runWithStatus(status: RunStatusName, ageMs: number, lastEventAgeMs?: number) {
  const org = await insertOrg();
  const agent = await insertAgent(org.id);
  const session = await insertSession(org.id, agent.id);
  const run = await createRun(session.id);
  await updateRunStatus(run.id, status);
  await db
    .update(runs)
    .set({ createdAt: new Date(Date.now() - ageMs) })
    .where(eq(runs.id, run.id));
  if (lastEventAgeMs !== undefined) {
    await appendEvent(run.id, "text_delta", { text: "x" });
    await db
      .update(events)
      .set({ createdAt: new Date(Date.now() - lastEventAgeMs) })
      .where(eq(events.runId, run.id));
  }
  return run;
}

describe("listStuckRuns", () => {
  it.each(["provisioning", "running", "finalizing"] as const)("includes a %s run with no events older than the cutoff", async (status) => {
    const run = await runWithStatus(status, 2 * HOUR);

    const stuck = await listStuckRuns(new Date(Date.now() - HOUR));

    expect(stuck.map((r) => r.id)).toContain(run.id);
  });

  it("includes a run whose last event is older than the cutoff", async () => {
    const run = await runWithStatus("running", 3 * HOUR, 2 * HOUR);

    const stuck = await listStuckRuns(new Date(Date.now() - HOUR));

    expect(stuck.map((r) => r.id)).toContain(run.id);
  });

  it("excludes an old run that wrote an event after the cutoff", async () => {
    const run = await runWithStatus("running", 3 * HOUR, 5 * 60 * 1000);

    const stuck = await listStuckRuns(new Date(Date.now() - HOUR));

    expect(stuck.map((r) => r.id)).not.toContain(run.id);
  });

  it("excludes a running run newer than the cutoff", async () => {
    const run = await runWithStatus("running", 5 * 60 * 1000);

    const stuck = await listStuckRuns(new Date(Date.now() - HOUR));

    expect(stuck.map((r) => r.id)).not.toContain(run.id);
  });

  it("excludes an old queued run", async () => {
    const run = await runWithStatus("queued", 2 * HOUR);

    const stuck = await listStuckRuns(new Date(Date.now() - HOUR));

    expect(stuck.map((r) => r.id)).not.toContain(run.id);
  });

  it.each(["done", "failed", "cancelled"] as const)("excludes an old %s run", async (status) => {
    const run = await runWithStatus(status, 2 * HOUR);

    const stuck = await listStuckRuns(new Date(Date.now() - HOUR));

    expect(stuck.map((r) => r.id)).not.toContain(run.id);
  });
});

describe("failRunIfStuck", () => {
  it("fails a stuck run and stamps finishedAt", async () => {
    const run = await runWithStatus("running", 2 * HOUR, 2 * HOUR);

    const failed = await failRunIfStuck(run.id, new Date(Date.now() - HOUR));

    expect(failed?.status).toBe("failed");
    expect((await getRun(run.id))?.finishedAt).toBeDefined();
  });

  it.each(["done", "cancelled"] as const)("leaves a %s run untouched", async (status) => {
    const run = await runWithStatus(status, 2 * HOUR, 2 * HOUR);

    const failed = await failRunIfStuck(run.id, new Date(Date.now() - HOUR));

    expect(failed).toBeUndefined();
    expect((await getRun(run.id))?.status).toBe(status);
  });

  it("leaves a run alone when it wrote an event after the cutoff", async () => {
    const run = await runWithStatus("running", 2 * HOUR, 60 * 1000);

    const failed = await failRunIfStuck(run.id, new Date(Date.now() - HOUR));

    expect(failed).toBeUndefined();
    expect((await getRun(run.id))?.status).toBe("running");
  });
});
