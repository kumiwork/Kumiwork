import {
  appendEvent,
  failRunIfStuck,
  getAgent,
  getRunsForSession,
  getSession,
  getTaskBySessionId,
  listIdleSandboxSessions,
  listStuckRuns,
  updateTask,
} from "@kumiwork/db";
import { createLogger } from "@kumiwork/logger";
import { enqueueSandboxTeardownJob } from "@kumiwork/queue";
import { notifySessionOfReply } from "./channel-notify";
import { runTurnTimeoutMs } from "./run-timeout";

// A session's sandbox is torn down after this long without activity, even if nothing ever
// explicitly finished or deleted its task (the other two teardown triggers, in apps/web's
// /api/tasks/[taskId] route). Long enough that a developer who steps away mid-task for a couple
// hours doesn't come back to a cold container; see ARCHITECTURE.md's Lifecycle section, which
// this constant is the actual value behind.
export const SANDBOX_IDLE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// How often apps/worker's sandboxReapWorker re-runs the scan below.
export const SANDBOX_REAP_INTERVAL_MS = 15 * 60 * 1000;

const log = createLogger("sandbox-reap");

const STUCK_RUN_INACTIVITY_FACTOR = 2;

const STUCK_RUN_MESSAGE = "The worker stopped responding while this run was in progress, so the run was marked as failed.";

async function failStuckRun(runId: number, sessionId: number, inactiveSince: Date): Promise<boolean> {
  const failed = await failRunIfStuck(runId, inactiveSince);
  if (!failed) return false;
  await appendEvent(runId, "error", { message: STUCK_RUN_MESSAGE });

  const [task, runs] = await Promise.all([getTaskBySessionId(sessionId), getRunsForSession(sessionId)]);
  if (task && runs[0]?.id === runId) await updateTask(task.id, { status: "failed" });

  const session = await getSession(sessionId);
  const agent = session ? await getAgent(session.agentId) : undefined;
  if (session && agent) {
    await notifySessionOfReply(agent.orgId, session, "Something went wrong and the run couldn't complete. Reply to try again.", (type, data) =>
      appendEvent(runId, type, data),
    ).catch(() => {});
  }
  return true;
}

export async function failStuckRuns(): Promise<number> {
  const inactiveSince = new Date(Date.now() - STUCK_RUN_INACTIVITY_FACTOR * runTurnTimeoutMs());
  const stuck = await listStuckRuns(inactiveSince);
  let failedCount = 0;
  for (const run of stuck) {
    try {
      if (await failStuckRun(run.id, run.sessionId, inactiveSince)) failedCount++;
    } catch (err) {
      log.error("Could not fail a stuck run", { err, runId: run.id });
    }
  }
  return failedCount;
}

// Finds sessions whose sandbox has sat idle past SANDBOX_IDLE_THRESHOLD_MS and enqueues a
// teardown job for each. listIdleSandboxSessions already excludes sessions with a non-terminal
// run, but that check and this scan are separate queries, not a transaction — the teardown
// worker's own hasNonTerminalRun check immediately before it destroys anything (see worker.ts)
// is the one that actually has to be correct; this is just triage to avoid enqueueing
// obviously-unnecessary jobs.
export async function scanForIdleSandboxes(): Promise<number> {
  await failStuckRuns().catch((err: unknown) => {
    log.error("Stuck-run sweep failed", { err });
  });
  const cutoff = new Date(Date.now() - SANDBOX_IDLE_THRESHOLD_MS);
  const idleSessions = await listIdleSandboxSessions(cutoff);
  for (const session of idleSessions) {
    await enqueueSandboxTeardownJob(session.id);
  }
  return idleSessions.length;
}
