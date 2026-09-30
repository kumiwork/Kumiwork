import type { ModelProvider, ModelSpec, OverflowPolicy, RuntimeKind } from "./domain";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  provider: ModelProvider;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic" },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-5";

const PROVIDER_RUNTIME: Record<ModelProvider, RuntimeKind> = {
  anthropic: "claude-code",
};

// Explicit list, not derived from MODEL_CATALOG order — keeps Fable's exclusion a deliberate
// fact in the data rather than an accident of catalog ordering.
const ESCALATION_LADDERS: Record<ModelProvider, readonly string[]> = {
  anthropic: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
};

export function getCatalogEntry(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id);
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
