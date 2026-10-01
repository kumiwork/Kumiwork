import type { ModelProvider, ModelSpec, OverflowPolicy, RuntimeKind } from "./domain";

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

export interface ModelCatalogEntry {
  id: string;
  label: string;
  provider: ModelProvider;
  pricing?: ModelPricing;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic" },
  { id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai" },
  { id: "gpt-6-sol", label: "GPT-6 Sol", provider: "openai" },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-5";

const PROVIDER_RUNTIME: Record<ModelProvider, RuntimeKind> = {
  anthropic: "claude-code",
  openai: "codex",
};

// Explicit list, not derived from MODEL_CATALOG order — keeps Fable's exclusion a deliberate
// fact in the data rather than an accident of catalog ordering.
const ESCALATION_LADDERS: Record<ModelProvider, readonly string[]> = {
  anthropic: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
  openai: [],
};

export function getCatalogEntry(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id);
}

export function findCatalogEntryForResponseModel(responseModel: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.filter((entry) => responseModel === entry.id || responseModel.startsWith(`${entry.id}-`)).sort(
    (a, b) => b.id.length - a.id.length,
  )[0];
}

export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

export function computeCostUsd(responseModel: string, usage: TokenUsage): number | undefined {
  const pricing = findCatalogEntryForResponseModel(responseModel)?.pricing;
  if (!pricing) return undefined;
  const cacheRead = pricing.cacheReadPerMTok ?? pricing.inputPerMTok;
  const cacheWrite = pricing.cacheWritePerMTok ?? pricing.inputPerMTok;
  return (
    (usage.inputTokens * pricing.inputPerMTok +
      usage.outputTokens * pricing.outputPerMTok +
      usage.cacheReadTokens * cacheRead +
      usage.cacheWriteTokens * cacheWrite) /
    1_000_000
  );
}

export function isValidModelId(id: string): boolean {
  return getCatalogEntry(id) !== undefined;
}

export function runtimeForModel(model: ModelSpec): RuntimeKind {
  return PROVIDER_RUNTIME[model.family];
}

export function nextEscalationTier(modelId: string): string | undefined {
  const entry = getCatalogEntry(modelId);
  if (!entry) return undefined;
  const ladder = ESCALATION_LADDERS[entry.provider];
  const index = ladder.indexOf(modelId);
  if (index === -1 || index === ladder.length - 1) return undefined;
  return ladder[index + 1];
}

export function isValidOverflowPolicy(value: string): value is OverflowPolicy {
  return value === "fallback" || value === "fail_fast";
}

export function buildModelSpec(id: string = DEFAULT_MODEL_ID): ModelSpec {
  const entry = getCatalogEntry(id);
  if (!entry) throw new Error(`Unknown model id "${id}"`);
  return { family: entry.provider, id, maxTokens: 8192 };
}
