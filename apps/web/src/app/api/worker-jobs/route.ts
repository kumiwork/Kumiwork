import { NextResponse } from "next/server";
import { listWorkerJobOutcomes, type WorkerJobStatus, type WorkerJobType } from "@kumiwork/db";
import { requireAuthContext } from "@/server/auth";

const JOB_TYPES: readonly WorkerJobType[] = ["repo_map_warm", "memory_retrospective"];
const STATUSES: readonly WorkerJobStatus[] = ["completed", "skipped", "failed"];

export async function GET(request: Request) {
  const ctx = await requireAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const jobType = params.get("jobType");
  const status = params.get("status");
  const limit = params.get("limit");

  if (jobType !== null && !JOB_TYPES.includes(jobType as WorkerJobType)) {
    return NextResponse.json({ error: `jobType must be one of ${JOB_TYPES.join(", ")}` }, { status: 400 });
  }
  if (status !== null && !STATUSES.includes(status as WorkerJobStatus)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
  }
  if (limit !== null && !/^\d+$/.test(limit)) {
    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  return NextResponse.json(
    await listWorkerJobOutcomes(ctx.orgId, {
      jobType: (jobType as WorkerJobType | null) ?? undefined,
      status: (status as WorkerJobStatus | null) ?? undefined,
      limit: limit !== null ? Number(limit) : undefined,
    }),
  );
}
