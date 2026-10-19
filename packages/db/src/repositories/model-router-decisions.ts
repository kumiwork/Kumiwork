import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { modelRouterDecisions } from "../schema";

export type ModelRouterMethod = "rules" | "classifier";

export interface NewModelRouterDecision {
  orgId: number;
  sessionId: number;
  runId: number;
  method: ModelRouterMethod;
  modelId?: string;
  effort?: string;
  reason?: string;
  confidence?: string;
  error?: string;
  latencyMs: number;
  routerVersion: string;
  promptHash?: string;
  classifierModel?: string;
  features: Record<string, unknown>;
  actualModelId: string;
  actualEffort?: string;
  actualEffortWasDefault: boolean;
  prices: Record<string, number>;
}

export interface ModelRouterDecision extends NewModelRouterDecision {
  id: number;
  createdAt: string;
}

function toRow(decision: NewModelRouterDecision): typeof modelRouterDecisions.$inferInsert {
  return {
    orgId: decision.orgId,
    sessionId: decision.sessionId,
    runId: decision.runId,
    method: decision.method,
    modelId: decision.modelId ?? null,
    effort: decision.effort ?? null,
    reason: decision.reason ?? null,
    confidence: decision.confidence ?? null,
    error: decision.error ?? null,
    latencyMs: Math.max(0, Math.round(decision.latencyMs)),
    routerVersion: decision.routerVersion,
    promptHash: decision.promptHash ?? null,
    classifierModel: decision.classifierModel ?? null,
    features: decision.features,
    actualModelId: decision.actualModelId,
    actualEffort: decision.actualEffort ?? null,
    actualEffortWasDefault: decision.actualEffortWasDefault,
    prices: decision.prices,
  };
}

function toDecision(row: typeof modelRouterDecisions.$inferSelect): ModelRouterDecision {
  return {
    id: row.id,
    orgId: row.orgId,
    sessionId: row.sessionId,
    runId: row.runId,
    method: row.method as ModelRouterMethod,
    modelId: row.modelId ?? undefined,
    effort: row.effort ?? undefined,
    reason: row.reason ?? undefined,
    confidence: row.confidence ?? undefined,
    error: row.error ?? undefined,
    latencyMs: row.latencyMs,
    routerVersion: row.routerVersion,
    promptHash: row.promptHash ?? undefined,
    classifierModel: row.classifierModel ?? undefined,
    features: row.features,
    actualModelId: row.actualModelId,
    actualEffort: row.actualEffort ?? undefined,
    actualEffortWasDefault: row.actualEffortWasDefault,
    prices: row.prices,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertModelRouterDecisions(decisions: readonly NewModelRouterDecision[]): Promise<number> {
  if (decisions.length === 0) return 0;
  const inserted = await db
    .insert(modelRouterDecisions)
    .values(decisions.map(toRow))
    .onConflictDoNothing({ target: [modelRouterDecisions.sessionId, modelRouterDecisions.method] })
    .returning({ id: modelRouterDecisions.id });
  return inserted.length;
}

export async function listModelRouterDecisionsForSession(sessionId: number): Promise<ModelRouterDecision[]> {
  const rows = await db
    .select()
    .from(modelRouterDecisions)
    .where(eq(modelRouterDecisions.sessionId, sessionId))
    .orderBy(asc(modelRouterDecisions.method));
  return rows.map(toDecision);
}
