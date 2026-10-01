import { recordWorkerJobOutcome, type NewWorkerJobOutcome } from "@agentfactory/db";
import { createLogger } from "@agentfactory/logger";

const log = createLogger("job-outcome");

export type JobOutcomeFields = Omit<NewWorkerJobOutcome, "durationMs">;

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function recordJobOutcome(startedAt: number, outcome: JobOutcomeFields): Promise<void> {
  try {
    await recordWorkerJobOutcome({ ...outcome, durationMs: Date.now() - startedAt });
  } catch (err) {
    log.error("Failed to record worker job outcome", { jobType: outcome.jobType, subject: outcome.subject, err });
  }
}
