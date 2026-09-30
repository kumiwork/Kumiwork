import { describe, expect, it } from "vitest";
import { buildModelSpec, isValidModelId, MODEL_CATALOG, nextEscalationTier, runtimeForModel } from "../models";

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
    expect(runtimeForModel({ family: "openai", id: "gpt-anything", maxTokens: 8192 })).toBe("codex");
  });

  it("resolves a stored spec whose id has since left the catalog by its provider", () => {
    expect(runtimeForModel({ family: "anthropic", id: "claude-retired-1", maxTokens: 8192 })).toBe("claude-code");
  });
});
