import { describe, expect, it } from "vitest";
import "../setup.js";
import { listWorkerJobOutcomes, recordWorkerJobOutcome } from "../../repositories/worker-job-outcomes.js";
import { insertOrg } from "../fixtures.js";

describe("worker-job-outcomes repository", () => {
  it("records an outcome and lists it newest first, scoped to the org", async () => {
    const org = await insertOrg();
    const other = await insertOrg();
    await recordWorkerJobOutcome({
      orgId: org.id,
      jobType: "repo_map_warm",
      subject: "acme/widgets",
      status: "skipped",
      reason: "already_cached",
      durationMs: 12,
    });
    await recordWorkerJobOutcome({
      orgId: org.id,
      jobType: "memory_retrospective",
      subject: "session:7",
      status: "failed",
      error: "boom",
      durationMs: 300,
      details: { accepted: 0 },
    });
    await recordWorkerJobOutcome({
      orgId: other.id,
      jobType: "repo_map_warm",
      subject: "acme/other",
      status: "completed",
      durationMs: 1,
    });

    const all = await listWorkerJobOutcomes(org.id);
    expect(all.map((o) => o.subject)).toEqual(["session:7", "acme/widgets"]);
    expect(all[0]).toMatchObject({ status: "failed", error: "boom", reason: null, details: { accepted: 0 } });
    expect(all[1]).toMatchObject({ status: "skipped", reason: "already_cached", error: null });
  });

  it("filters by job type and status and caps the limit", async () => {
    const org = await insertOrg();
    for (const status of ["completed", "failed", "failed"] as const) {
      await recordWorkerJobOutcome({ orgId: org.id, jobType: "repo_map_warm", subject: "a/b", status, durationMs: 1 });
    }
    await recordWorkerJobOutcome({ orgId: org.id, jobType: "memory_retrospective", subject: "session:1", status: "failed", durationMs: 1 });

    expect(await listWorkerJobOutcomes(org.id, { jobType: "repo_map_warm", status: "failed" })).toHaveLength(2);
    expect(await listWorkerJobOutcomes(org.id, { limit: 1 })).toHaveLength(1);
  });

  it("truncates very long error text", async () => {
    const org = await insertOrg();
    await recordWorkerJobOutcome({ orgId: org.id, jobType: "repo_map_warm", subject: "a/b", status: "failed", error: "x".repeat(10_000), durationMs: 1 });
    const [row] = await listWorkerJobOutcomes(org.id);
    expect(row.error).toHaveLength(4000);
  });
});
