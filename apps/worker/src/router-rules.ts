import type { RouterFeatures, RouterGuess } from "@kumiwork/core";

export const RULES_VERSION = "rules-1";

const SHORT_DESCRIPTION_CHARS = 400;
const FEW_CRITERIA = 2;
const LONG_DESCRIPTION_CHARS = 3000;
const MANY_CRITERIA = 8;

export function rulesGuess(features: RouterFeatures): RouterGuess {
  if (features.isPrReview) return { modelId: "claude-sonnet-5-5", effort: "medium", reason: "pr_review" };
  if (!features.hasCodebase) return { modelId: "claude-haiku-5-5", effort: "medium", reason: "no_codebase" };
  if (features.isIssueLink) return { modelId: "claude-sonnet-5-5", effort: "medium", reason: "issue_link" };
  if (features.descriptionChars < SHORT_DESCRIPTION_CHARS && features.criteriaCount <= FEW_CRITERIA) {
    return { modelId: "claude-haiku-5-5", effort: "high", reason: "short_task" };
  }
  if (features.descriptionChars > LONG_DESCRIPTION_CHARS || features.criteriaCount >= MANY_CRITERIA) {
    return { modelId: "claude-opus-5-5", effort: "high", reason: "long_task" };
  }
  return { modelId: "claude-sonnet-5-5", effort: "medium", reason: "default" };
}
