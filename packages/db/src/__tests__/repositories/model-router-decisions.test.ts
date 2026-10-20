import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import "../setup.js";
import { db } from "../../client.js";
import { orgs, runs, sessions } from "../../schema.js";
import {
  insertModelRouterDecisions,
  listModelRouterDecisionsForSession,
  type ModelRouterMethod,
  type NewModelRouterDecision,
} from "../../repositories/model-router-decisions.js";
import { createRun, isFirstRunOfSession } from "../../repositories/runs.js";
import { insertAgent, insertOrg, insertSession } from "../fixtures.js";

async function setup() {
  const org = await insertOrg();
  const agent = await insertAgent(org.id);
  const session = await insertSession(org.id, agent.id);
  const run = await createRun(session.id);
  return { org, session, run };
}

function row(base: { orgId: number; sessionId: number; runId: number }, method: ModelRouterMethod): NewModelRouterDecision {
  return {
    ...base,
    method,
    modelId: "claude-haiku-5-5",
    effort: "high",
    reason: "short_task",
    latencyMs: 3,
    routerVersion: method === "rules" ? "rules-1" : "classifier-1",
    features: { kind: "task", descriptionChars: 120 },
    actualModelId: "claude-sonnet-5-5",
    actualEffort: "high",
    actualEffortWasDefault: true,
    prices: { "claude-haiku-5-5": 0.5, "claude-sonnet-5-5": 10 },
  };
}

describe("model-router-decisions repository", () => {
  it("stores both guesses and reads them back", async () => {
    const { org, session, run } = await setup();
    const base = { orgId: org.id, sessionId: session.id, runId: run.id };

    const inserted = await insertModelRouterDecisions([
      row(base, "rules"),
      { ...row(base, "classifier"), modelId: undefined, effort: undefined, reason: undefined, error: "timeout", promptHash: "abc", classifierModel: "claude-haiku-5-5" },
    ]);

    expect(inserted).toBe(2);
    const rows = await listModelRouterDecisionsForSession(session.id);
    expect(rows.map((r) => r.method)).toEqual(["classifier", "rules"]);
    expect(rows[0]).toMatchObject({ error: "timeout", modelId: undefined, promptHash: "abc" });
    expect(rows[1]).toMatchObject({ modelId: "claude-haiku-5-5", actualEffortWasDefault: true, prices: { "claude-sonnet-5-5": 10 } });
  });

  it("ignores a second write for the same session and method", async () => {
    const { org, session, run } = await setup();
    const base = { orgId: org.id, sessionId: session.id, runId: run.id };
    await insertModelRouterDecisions([row(base, "rules")]);

    const inserted = await insertModelRouterDecisions([{ ...row(base, "rules"), modelId: "claude-opus-5-5" }]);

    expect(inserted).toBe(0);
    const rows = await listModelRouterDecisionsForSession(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].modelId).toBe("claude-haiku-5-5");
  });

  it("stores the classifier error row with every empty column read back as undefined", async () => {
    const { org, session, run } = await setup();
    const base = { orgId: org.id, sessionId: session.id, runId: run.id };
    const errorRow: NewModelRouterDecision = {
      ...base,
      method: "classifier",
      error: "timeout",
      latencyMs: 9,
      routerVersion: "classifier-1",
      promptHash: "abc",
      classifierModel: "claude-haiku-5-5",
      features: { kind: "task" },
      actualModelId: "claude-sonnet-5-5",
      actualEffortWasDefault: false,
      prices: { "claude-sonnet-5-5": 10 },
    };

    await insertModelRouterDecisions([errorRow]);

    const [stored] = await listModelRouterDecisionsForSession(session.id);
    const { id, createdAt, ...rest } = stored;
    expect(id).toBeGreaterThan(0);
    expect(createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(rest).toEqual({
      ...errorRow,
      modelId: undefined,
      effort: undefined,
      reason: undefined,
      confidence: undefined,
      actualEffort: undefined,
    });
  });

  it("stores confidence", async () => {
    const { org, session, run } = await setup();
    await insertModelRouterDecisions([{ ...row({ orgId: org.id, sessionId: session.id, runId: run.id }, "rules"), confidence: "high" }]);

    const [stored] = await listModelRouterDecisionsForSession(session.id);

    expect(stored.confidence).toBe("high");
  });

  it("clamps and rounds latency", async () => {
    const { org, session, run } = await setup();
    const base = { orgId: org.id, sessionId: session.id, runId: run.id };
    await insertModelRouterDecisions([{ ...row(base, "rules"), latencyMs: -5 }, { ...row(base, "classifier"), latencyMs: 2.6 }]);

    const rows = await listModelRouterDecisionsForSession(session.id);

    expect(rows.map((r) => [r.method, r.latencyMs])).toEqual([["classifier", 3], ["rules", 0]]);
  });

  it("counts one row when a batch repeats a session and method", async () => {
    const { org, session, run } = await setup();
    const base = { orgId: org.id, sessionId: session.id, runId: run.id };

    const inserted = await insertModelRouterDecisions([row(base, "rules"), { ...row(base, "rules"), modelId: "claude-opus-5-5" }]);

    expect(inserted).toBe(1);
  });

  it("keeps the unique key per session", async () => {
    const first = await setup();
    const second = await setup();

    const a = await insertModelRouterDecisions([row({ orgId: first.org.id, sessionId: first.session.id, runId: first.run.id }, "rules")]);
    const b = await insertModelRouterDecisions([row({ orgId: second.org.id, sessionId: second.session.id, runId: second.run.id }, "rules")]);

    expect([a, b]).toEqual([1, 1]);
  });

  it("is deleted with its session but not its org", async () => {
    const { org, session, run } = await setup();
    await insertModelRouterDecisions([row({ orgId: org.id, sessionId: session.id, runId: run.id }, "rules")]);

    await db.delete(sessions).where(eq(sessions.id, session.id));

    await expect(listModelRouterDecisionsForSession(session.id)).resolves.toEqual([]);
    const remaining = await db.select().from(orgs).where(eq(orgs.id, org.id));
    expect(remaining).toHaveLength(1);
  });

  it("is deleted with its run", async () => {
    const { org, session, run } = await setup();
    await insertModelRouterDecisions([row({ orgId: org.id, sessionId: session.id, runId: run.id }, "rules")]);

    await db.delete(runs).where(eq(runs.id, run.id));

    await expect(listModelRouterDecisionsForSession(session.id)).resolves.toEqual([]);
  });

  it("returns 0 for an empty list", async () => {
    await expect(insertModelRouterDecisions([])).resolves.toBe(0);
  });

  it("is deleted with its org", async () => {
    const { org, session, run } = await setup();
    await insertModelRouterDecisions([row({ orgId: org.id, sessionId: session.id, runId: run.id }, "rules")]);

    await db.delete(orgs).where(eq(orgs.id, org.id));

    await expect(listModelRouterDecisionsForSession(session.id)).resolves.toEqual([]);
  });
});

describe("isFirstRunOfSession", () => {
  it("is true only for the session's earliest run", async () => {
    const { session, run } = await setup();
    const second = await createRun(session.id);

    await expect(isFirstRunOfSession(session.id, run.id)).resolves.toBe(true);
    await expect(isFirstRunOfSession(session.id, second.id)).resolves.toBe(false);
  });

  it("does not look at other sessions' runs", async () => {
    const other = await setup();
    const { session, run } = await setup();
    expect(other.run.id).toBeLessThan(run.id);

    await expect(isFirstRunOfSession(session.id, run.id)).resolves.toBe(true);
  });
});
