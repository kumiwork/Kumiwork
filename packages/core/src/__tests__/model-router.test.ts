import { describe, expect, it } from "vitest";
import { isRouterCandidate, priceSnapshot, ROUTER_CANDIDATE_MODEL_IDS } from "../model-router";

describe("router candidates", () => {
  it("offers Haiku, Sonnet and Opus 5.5 only", () => {
    expect([...ROUTER_CANDIDATE_MODEL_IDS]).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(isRouterCandidate("claude-sonnet-5-5")).toBe(true);
    expect(isRouterCandidate("claude-fable-5-1")).toBe(false);
    expect(isRouterCandidate("claude-sonnet-5")).toBe(false);
  });
});

describe("priceSnapshot", () => {
  it("keeps the output price of each known model and skips unknown ids", () => {
    expect(priceSnapshot(["claude-haiku-5-5", "claude-opus-5-5", "not-a-model"])).toEqual({
      "claude-haiku-5-5": 0.5,
      "claude-opus-5-5": 20,
    });
  });
});
