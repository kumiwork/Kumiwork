import { afterEach, describe, expect, it } from "vitest";
import {
  buildModelSpec,
  computeCostUsd,
  findCatalogEntryForResponseModel,
  isValidModelId,
  MODEL_CATALOG,
  nextEscalationTier,
  runtimeForModel,
  totalTokens,
} from "../models";

describe("cost computation", () => {
  const haiku = MODEL_CATALOG.find((entry) => entry.id === "claude-haiku-4-5")!;
  const original = haiku.pricing;
  const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 100_000 };

  afterEach(() => {
    haiku.pricing = original;
  });

  it("matches a dated response model id to its catalog entry", () => {
    expect(findCatalogEntryForResponseModel("claude-haiku-4-5-20251001")?.id).toBe("claude-haiku-4-5");
    expect(findCatalogEntryForResponseModel("claude-haiku-4-5")?.id).toBe("claude-haiku-4-5");
    expect(findCatalogEntryForResponseModel("claude-haiku-4-50")).toBeUndefined();
    expect(findCatalogEntryForResponseModel("unknown")).toBeUndefined();
  });

  it("totals every token class", () => {
    expect(totalTokens(usage)).toBe(3_600_000);
  });

  it("prices each token class per million tokens", () => {
    haiku.pricing = { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 };
    expect(computeCostUsd("claude-haiku-4-5-20251001", usage)).toBeCloseTo(1 + 2.5 + 0.2 + 0.125, 10);
  });

  it("falls back to the input price for cache classes with no price of their own", () => {
    haiku.pricing = { inputPerMTok: 2, outputPerMTok: 10 };
    expect(computeCostUsd("claude-haiku-4-5", usage)).toBeCloseTo(2 + 5 + 4 + 0.2, 10);
  });

  it("returns undefined when the model has no pricing", () => {
    haiku.pricing = undefined;
    expect(computeCostUsd("claude-haiku-4-5", usage)).toBeUndefined();
    expect(computeCostUsd("unknown", usage)).toBeUndefined();
  });
});

describe("nextEscalationTier", () => {
  it("walks up the ladder from haiku to sonnet", () => {
    expect(nextEscalationTier("claude-haiku-4-5")).toBe("claude-sonnet-5");
  });

  it("walks up the ladder from sonnet to opus", () => {
    expect(nextEscalationTier("claude-sonnet-5")).toBe("claude-opus-5");
  });

  it("returns undefined at the top of the ladder", () => {
    expect(nextEscalationTier("claude-opus-5")).toBeUndefined();
  });

  it("excludes fable from the ladder", () => {
    expect(nextEscalationTier("claude-fable-5")).toBeUndefined();
  });

  it("returns undefined for an unknown model id", () => {
    expect(nextEscalationTier("not-a-real-model")).toBeUndefined();
  });

  it("never escalates to a model from a different provider", () => {
    for (const entry of MODEL_CATALOG) {
      const next = nextEscalationTier(entry.id);
      if (next) expect(buildModelSpec(next).family).toBe(entry.provider);
    }
  });
});

describe("buildModelSpec", () => {
  it("takes the provider from the catalog entry", () => {
    expect(buildModelSpec("claude-opus-5")).toEqual({ family: "anthropic", id: "claude-opus-5", maxTokens: 8192 });
  });

  it("defaults to the default model", () => {
    expect(buildModelSpec().id).toBe("claude-sonnet-5");
  });

  it("rejects an id that is not in the catalog", () => {
    expect(() => buildModelSpec("not-a-real-model")).toThrow(/Unknown model id/);
  });
});

describe("isValidModelId", () => {
  it("accepts catalog ids and rejects everything else", () => {
    expect(isValidModelId("claude-sonnet-5")).toBe(true);
    expect(isValidModelId("not-a-real-model")).toBe(false);
  });
});

describe("runtimeForModel", () => {
  it("runs Anthropic models on the Claude Code runtime", () => {
    expect(runtimeForModel(buildModelSpec("claude-sonnet-5"))).toBe("claude-code");
  });

  it("runs OpenAI models on the Codex runtime", () => {
    expect(runtimeForModel(buildModelSpec("gpt-6-sol"))).toBe("codex");
    expect(runtimeForModel(buildModelSpec("gpt-6-luna"))).toBe("codex");
  });

  it("resolves a stored spec whose id has since left the catalog by its provider", () => {
    expect(runtimeForModel({ family: "anthropic", id: "claude-retired-1", maxTokens: 8192 })).toBe("claude-code");
  });
});
