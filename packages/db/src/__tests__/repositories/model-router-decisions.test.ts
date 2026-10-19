import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import "../setup.js";
import { db } from "../../client.js";
import { orgs } from "../../schema.js";
import {
  insertModelRouterDecisions,
  listModelRouterDecisionsForSession,
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

function row(base: { orgId: number; sessionId: number; runId: number }, method: "rules" | "classifier"): NewModelRouterDecision {
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
