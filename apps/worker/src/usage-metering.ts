import { computeCostUsd, totalTokens } from "@agentfactory/core";
import { addRunUsage } from "@agentfactory/db";
import { createLogger } from "@agentfactory/logger";
import type { ModelUsage } from "./model-usage";
import type { RunCredentialContext } from "./run-credentials";

const log = createLogger("usage-metering");

const warnedModels = new Set<string>();

export interface UsageMeteringDeps {
  addRunUsage: typeof addRunUsage;
}

export async function recordRunUsage(
  context: RunCredentialContext,
  usage: ModelUsage,
  deps: UsageMeteringDeps = { addRunUsage },
): Promise<void> {
  if (context.runId === undefined) return;
  const costUsd = usage.model ? computeCostUsd(usage.model, usage) : undefined;
  if (costUsd === undefined) {
    const key = usage.model ?? "unknown";
    if (!warnedModels.has(key)) {
      warnedModels.add(key);
      log.warn("No pricing for model; recording tokens with zero cost", { model: key });
    }
  }
  await deps.addRunUsage(context.runId, { tokens: totalTokens(usage), costUsd: costUsd ?? 0 });
}
