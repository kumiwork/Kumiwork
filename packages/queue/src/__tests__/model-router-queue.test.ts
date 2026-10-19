import "./setup.js";
import { Queue } from "bullmq";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { MODEL_ROUTER_QUEUE_NAME, enqueueModelRouterJob, queueConnection } from "../index.js";

const inspectQueue = new Queue(MODEL_ROUTER_QUEUE_NAME, { connection: queueConnection });
const sessionId = 9_000_000 + Math.floor(Math.random() * 1_000_000);
const jobId = `router-${sessionId}`;

afterEach(async () => {
  await inspectQueue.remove(jobId);
});

afterAll(async () => {
  await inspectQueue.close();
  await queueConnection.quit();
});

const data = {
  orgId: 1,
  sessionId,
  runId: 40,
  actual: { modelId: "claude-sonnet-5-5", effort: "high", effortWasDefault: true, selectionReason: "agent_default" },
};

describe("enqueueModelRouterJob", () => {
  it("adds one retrying job keyed by session", async () => {
    await enqueueModelRouterJob(data);

    const job = await inspectQueue.getJob(jobId);
    expect(job?.name).toBe("route-session");
    expect(job?.data).toEqual(data);
    expect(job?.opts).toMatchObject({
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 604800 },
      removeOnFail: { count: 100 },
    });
  });

  it("collapses a second enqueue for the same session", async () => {
    await enqueueModelRouterJob(data);
    await enqueueModelRouterJob({ ...data, runId: 41 });

    const job = await inspectQueue.getJob(jobId);
    expect(job?.data.runId).toBe(40);
  });
});
