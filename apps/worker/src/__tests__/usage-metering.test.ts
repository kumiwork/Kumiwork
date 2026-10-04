import { describe, expect, it, vi } from "vitest";

vi.mock("@kumiwork/db", () => ({ addRunUsage: vi.fn() }));
vi.mock("@kumiwork/logger", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { createLogger: () => log };
});

const { recordRunUsage } = await import("../usage-metering");

const usage = { model: "claude-haiku-4-5-20251001", inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 };

describe("recordRunUsage", () => {
  it("adds total tokens to the run", async () => {
    const addRunUsage = vi.fn();
    await recordRunUsage({ orgId: 1, runId: 42, purpose: "run", provider: "anthropic" }, usage, { addRunUsage });
    expect(addRunUsage).toHaveBeenCalledWith(42, { tokens: 100, costUsd: expect.any(Number) });
  });

  it("records nothing for credentials that have no run", async () => {
    const addRunUsage = vi.fn();
    await recordRunUsage({ orgId: 1, purpose: "repo-map", provider: "anthropic" }, usage, { addRunUsage });
    expect(addRunUsage).not.toHaveBeenCalled();
  });

  it("records tokens with zero cost for a model with no pricing", async () => {
    const addRunUsage = vi.fn();
    await recordRunUsage({ orgId: 1, runId: 7, purpose: "run", provider: "anthropic" }, { ...usage, model: "mystery-model" }, { addRunUsage });
    expect(addRunUsage).toHaveBeenCalledWith(7, { tokens: 100, costUsd: 0 });
  });
});
