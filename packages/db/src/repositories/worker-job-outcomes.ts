import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { workerJobOutcomes } from "../schema";

export type WorkerJobType = "repo_map_warm" | "memory_retrospective";
export type WorkerJobStatus = "completed" | "skipped" | "failed";

export interface WorkerJobOutcome {
  id: number;
  orgId: number;
  jobType: WorkerJobType;
  subject: string;
  status: WorkerJobStatus;
  reason: string | null;
  error: string | null;
  durationMs: number;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface NewWorkerJobOutcome {
  orgId: number;
  jobType: WorkerJobType;
  subject: string;
  status: WorkerJobStatus;
  reason?: string;
  error?: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

const ERROR_MAX_CHARS = 4000;

function toOutcome(row: typeof workerJobOutcomes.$inferSelect): WorkerJobOutcome {
  return {
    id: row.id,
    orgId: row.orgId,
    jobType: row.jobType as WorkerJobType,
    subject: row.subject,
    status: row.status as WorkerJobStatus,
    reason: row.reason,
    error: row.error,
    durationMs: row.durationMs,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function recordWorkerJobOutcome(input: NewWorkerJobOutcome): Promise<void> {
  await db.insert(workerJobOutcomes).values({
    orgId: input.orgId,
    jobType: input.jobType,
    subject: input.subject,
    status: input.status,
    reason: input.reason ?? null,
    error: input.error?.slice(0, ERROR_MAX_CHARS) ?? null,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    details: input.details ?? null,
  });
}

export interface ListWorkerJobOutcomesFilter {
  jobType?: WorkerJobType;
  status?: WorkerJobStatus;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listWorkerJobOutcomes(
  orgId: number,
  filter: ListWorkerJobOutcomesFilter = {},
): Promise<WorkerJobOutcome[]> {
  const conditions = [eq(workerJobOutcomes.orgId, orgId)];
  if (filter.jobType) conditions.push(eq(workerJobOutcomes.jobType, filter.jobType));
  if (filter.status) conditions.push(eq(workerJobOutcomes.status, filter.status));
  const rows = await db
    .select()
    .from(workerJobOutcomes)
    .where(and(...conditions))
    .orderBy(desc(workerJobOutcomes.createdAt), desc(workerJobOutcomes.id))
    .limit(Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT));
  return rows.map(toOutcome);
}
