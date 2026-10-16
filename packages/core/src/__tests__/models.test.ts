import { afterEach, describe, expect, it } from "vitest";
import {
  buildModelSpec,
  computeCostUsd,
  DEFAULT_MODEL_ID,
  findCatalogEntryForResponseModel,
  getCatalogEntry,
  isValidModelId,
  MODEL_CATALOG,
  nextEscalationTier,
  runtimeForModel,
  SMALL_MODEL_ID,
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

  it.each([
    ["claude-haiku-5-5-20260601", "claude-haiku-5-5"],
    ["claude-sonnet-5-5-20260601", "claude-sonnet-5-5"],
    ["claude-opus-5-5-20260601", "claude-opus-5-5"],
    ["claude-fable-5-1-20260601", "claude-fable-5-1"],
    ["claude-sonnet-5-20260601", "claude-sonnet-5"],
    ["claude-fable-5-20260601", "claude-fable-5"],
  ])("matches the dated response id %s to %s and never to a shorter id", (responseModel, catalogId) => {
    expect(findCatalogEntryForResponseModel(responseModel)?.id).toBe(catalogId);
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
    expect(nextEscalationTier("claude-fable-5-1")).toBeUndefined();
  });

  it("walks the 5.5 ladder from haiku to sonnet to opus", () => {
    expect(nextEscalationTier("claude-haiku-5-5")).toBe("claude-sonnet-5-5");
    expect(nextEscalationTier("claude-sonnet-5-5")).toBe("claude-opus-5-5");
    expect(nextEscalationTier("claude-opus-5-5")).toBeUndefined();
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

describe("new Anthropic models", () => {
  it.each(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"])(
    "accepts %s and runs it on the Claude Code runtime",
    (id) => {
      expect(isValidModelId(id)).toBe(true);
      expect(runtimeForModel(buildModelSpec(id))).toBe("claude-code");
    },
  );

  it("keeps the default model unchanged", () => {
    expect(DEFAULT_MODEL_ID).toBe("claude-sonnet-5");
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

describe("SMALL_MODEL_ID", () => {
  it("names an Anthropic catalog entry", () => {
    expect(isValidModelId(SMALL_MODEL_ID)).toBe(true);
    expect(buildModelSpec(SMALL_MODEL_ID).family).toBe("anthropic");
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

describe("catalog pricing", () => {
  it.each(MODEL_CATALOG.map((entry) => [entry.id]))("prices %s", (id) => {
    const pricing = getCatalogEntry(id)?.pricing;
    expect(pricing?.inputPerMTok).toBeGreaterThan(0);
    expect(pricing?.outputPerMTok).toBeGreaterThan(0);
  });

  it("uses the published Claude 5.5 prices", () => {
    expect(getCatalogEntry("claude-haiku-5-5")?.pricing).toEqual({
      inputPerMTok: 0.1,
      outputPerMTok: 0.5,
      cacheReadPerMTok: 0.01,
      cacheWritePerMTok: 0.125,
    });
    expect(getCatalogEntry("claude-sonnet-5-5")?.pricing?.outputPerMTok).toBe(10);
    expect(getCatalogEntry("claude-opus-5-5")?.pricing?.outputPerMTok).toBe(20);
  });
});

describe("default effort", () => {
  it("records the API default effort for the router candidates", () => {
    expect(getCatalogEntry("claude-haiku-5-5")?.defaultEffort).toBe("medium");
    expect(getCatalogEntry("claude-sonnet-5-5")?.defaultEffort).toBe("high");
    expect(getCatalogEntry("claude-opus-5-5")?.defaultEffort).toBe("medium");
  });

  it("leaves models without an effort parameter unset", () => {
    expect(getCatalogEntry("claude-haiku-4-5")?.defaultEffort).toBeUndefined();
    expect(getCatalogEntry("gpt-6-luna")?.defaultEffort).toBeUndefined();
  });
});
