import {
  getCatalogEntry,
  isEffortLevel,
  priceSnapshot,
  ROUTER_CANDIDATE_MODEL_IDS,
  type EffortLevel,
  type RouterInput,
} from "@kumiwork/core";
import {
  getAgent,
  getMessage,
  getRun,
  getSession,
  getTaskBySessionId,
  insertModelRouterDecisions,
  isFirstRunOfSession,
  listModelRouterDecisionsForSession,
  type NewModelRouterDecision,
} from "@kumiwork/db";
import { createLogger } from "@kumiwork/logger";
import { enqueueModelRouterJob, type ModelRouterJobData } from "@kumiwork/queue";
import { describeError, recordJobOutcome } from "./job-outcome";
import {
  CLASSIFIER_VERSION,
  classifierGuess,
  classifierPromptHash,
  ROUTER_CLASSIFIER_MODEL_ID,
  type ClassifierResult,
} from "./router-classifier";
import { buildRouterInput } from "./router-input";
import { RULES_VERSION, rulesGuess } from "./router-rules";

const log = createLogger("model-router");

export type ModelRouterMode = "off" | "shadow" | "apply";

export function resolveModelRouterMode(value: string | undefined): ModelRouterMode {
  return value === "off" || value === "apply" ? value : "shadow";
}

export interface RouterSelection {
  modelId: string;
  effort?: EffortLevel;
  reason: string;
}

export interface ScheduleModelRouterContext {
  orgId: number;
  sessionId: number;
  runId: number;
  selection: RouterSelection;
}

export async function scheduleModelRouter(
  context: ScheduleModelRouterContext,
  mode: ModelRouterMode = resolveModelRouterMode(process.env.MODEL_ROUTER_MODE),
): Promise<void> {
  if (mode === "off") return;
  try {
    if (!(await isFirstRunOfSession(context.sessionId, context.runId))) return;
    const { selection } = context;
    await enqueueModelRouterJob({
      orgId: context.orgId,
      sessionId: context.sessionId,
      runId: context.runId,
      actual: {
        modelId: selection.modelId,
        effort: selection.effort ?? getCatalogEntry(selection.modelId)?.defaultEffort,
        effortWasDefault: selection.effort === undefined,
        selectionReason: selection.reason,
      },
    });
  } catch (err) {
    log.warn("Could not schedule the model router", { sessionId: context.sessionId, err });
  }
}

type Classify = (input: RouterInput, seed: number) => Promise<ClassifierResult>;

async function loadRouterInput(data: ModelRouterJobData): Promise<RouterInput | undefined> {
  const session = await getSession(data.sessionId);
  const agent = session ? await getAgent(session.agentId) : undefined;
  if (!session || !agent) return undefined;
  const task = await getTaskBySessionId(session.id);
  const run = await getRun(data.runId);
  const triggeringMessage = run?.triggeringMessageId ? await getMessage(run.triggeringMessageId) : undefined;
  return buildRouterInput({ agent, task, triggeringMessage });
}

export async function processModelRouterJob(data: ModelRouterJobData, classify: Classify = classifierGuess): Promise<void> {
  const startedAt = Date.now();
  const outcomeBase = { orgId: data.orgId, jobType: "model_router" as const, subject: `session:${data.sessionId}` };
  try {
    const existing = await listModelRouterDecisionsForSession(data.sessionId);
    if (existing.length > 0) {
      await recordJobOutcome(startedAt, { ...outcomeBase, status: "skipped", reason: "already_recorded" });
      return;
    }
    const input = await loadRouterInput(data);
    if (!input) {
      await recordJobOutcome(startedAt, { ...outcomeBase, status: "skipped", reason: "session_gone" });
      return;
    }
    const shared = {
      orgId: data.orgId,
      sessionId: data.sessionId,
      runId: data.runId,
      features: { ...input.features, selectionReason: data.actual.selectionReason },
      actualModelId: data.actual.modelId,
      actualEffort: isEffortLevel(data.actual.effort) ? data.actual.effort : undefined,
      actualEffortWasDefault: data.actual.effortWasDefault,
      prices: priceSnapshot([...ROUTER_CANDIDATE_MODEL_IDS, data.actual.modelId]),
    };
    const rulesStartedAt = Date.now();
    const rules = rulesGuess(input.features);
    const rulesRow: NewModelRouterDecision = {
      ...shared,
      method: "rules",
      modelId: rules.modelId,
      effort: rules.effort,
      reason: rules.reason,
      latencyMs: Date.now() - rulesStartedAt,
      routerVersion: RULES_VERSION,
    };
    const classified = await classify(input, data.sessionId);
    const classifierRow: NewModelRouterDecision = {
      ...shared,
      method: "classifier",
      latencyMs: classified.latencyMs,
      routerVersion: CLASSIFIER_VERSION,
      promptHash: classifierPromptHash(),
      classifierModel: ROUTER_CLASSIFIER_MODEL_ID,
      ...(classified.ok
        ? {
            modelId: classified.guess.modelId,
            effort: classified.guess.effort,
            reason: classified.guess.reason,
            confidence: classified.guess.confidence,
          }
        : { error: classified.error }),
    };
    const inserted = await insertModelRouterDecisions([rulesRow, classifierRow]);
    await recordJobOutcome(startedAt, {
      ...outcomeBase,
      status: inserted > 0 ? "completed" : "skipped",
      reason: inserted > 0 ? undefined : "already_recorded",
      details: { classifierError: classified.ok ? null : classified.error },
    });
  } catch (err) {
    await recordJobOutcome(startedAt, { ...outcomeBase, status: "failed", error: describeError(err) });
    throw err;
  }
}
