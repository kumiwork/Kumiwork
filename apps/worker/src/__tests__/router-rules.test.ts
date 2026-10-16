import { describe, expect, it } from "vitest";
import type { RouterFeatures } from "@kumiwork/core";
import { rulesGuess } from "../router-rules";

function features(overrides: Partial<RouterFeatures> = {}): RouterFeatures {
  return {
    kind: "task",
    source: "manual",
    descriptionChars: 1000,
    criteriaCount: 4,
    isPrReview: false,
    isIssueLink: false,
    hasCodebase: true,
    ...overrides,
  };
}

describe("rulesGuess", () => {
  it.each([
    ["a PR review", { isPrReview: true, descriptionChars: 50 }, "claude-sonnet-5-5", "medium", "pr_review"],
    ["text-only work", { hasCodebase: false }, "claude-haiku-5-5", "medium", "no_codebase"],
    ["a chat session", { kind: "chat", source: "chat", hasCodebase: false }, "claude-haiku-5-5", "medium", "no_codebase"],
    ["an issue link", { isIssueLink: true, descriptionChars: 40, criteriaCount: 0 }, "claude-sonnet-5-5", "medium", "issue_link"],
    ["a short task", { descriptionChars: 399, criteriaCount: 2 }, "claude-haiku-5-5", "high", "short_task"],
    ["a long description", { descriptionChars: 3001 }, "claude-opus-5-5", "high", "long_task"],
    ["many criteria", { criteriaCount: 8 }, "claude-opus-5-5", "high", "long_task"],
    ["anything else", {}, "claude-sonnet-5-5", "medium", "default"],
  ] as const)("routes %s", (_name, overrides, modelId, effort, reason) => {
    expect(rulesGuess(features(overrides))).toEqual({ modelId, effort, reason });
  });

  it.each([
    ["400 chars is not short", { descriptionChars: 400, criteriaCount: 0 }, "default"],
    ["3 criteria is not short", { descriptionChars: 100, criteriaCount: 3 }, "default"],
    ["3000 chars is not long", { descriptionChars: 3000 }, "default"],
    ["7 criteria is not many", { criteriaCount: 7 }, "default"],
  ] as const)("keeps the boundary: %s", (_name, overrides, reason) => {
    expect(rulesGuess(features(overrides)).reason).toBe(reason);
  });
});
