import type { EffortLevel } from "./domain";
import { getCatalogEntry } from "./models";

export const ROUTER_CANDIDATE_MODEL_IDS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;

export type RouterCandidateModelId = (typeof ROUTER_CANDIDATE_MODEL_IDS)[number];

export type RouterConfidence = "low" | "medium" | "high";

export interface RouterFeatures {
  kind: "task" | "chat";
  source: "jira" | "manual" | "chat";
  descriptionChars: number;
  criteriaCount: number;
  isPrReview: boolean;
  isIssueLink: boolean;
  hasCodebase: boolean;
}

export interface RouterInput {
  title: string;
  description: string;
  criteria: string[];
  message: string;
  agentName: string;
  agentDescription: string;
  features: RouterFeatures;
}

export interface RouterGuess {
  modelId: RouterCandidateModelId;
  effort: EffortLevel;
  reason: string;
  confidence?: RouterConfidence;
}

export type PriceSnapshot = Record<string, number>;

export function isRouterCandidate(modelId: string): modelId is RouterCandidateModelId {
  return (ROUTER_CANDIDATE_MODEL_IDS as readonly string[]).includes(modelId);
}

export function priceSnapshot(modelIds: readonly string[]): PriceSnapshot {
  const snapshot: PriceSnapshot = {};
  for (const modelId of modelIds) {
    const outputPrice = getCatalogEntry(modelId)?.pricing?.outputPerMTok;
    if (outputPrice !== undefined) snapshot[modelId] = outputPrice;
  }
  return snapshot;
}
