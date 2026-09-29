import { describe, expect, it } from "vitest";
import type { ModelSpec } from "@agentfactory/core";
import { resumableSessionRef } from "../resume-candidate";

const claudeModel: ModelSpec = { family: "anthropic", id: "claude-sonnet-5", maxTokens: 8192 };
const openaiModel: ModelSpec = { family: "openai", id: "gpt-anything", maxTokens: 8192 };
const current = { sandboxId: "sandbox-1", runtimeKind: "claude-code" as const };

describe("resumableSessionRef", () => {
  it("resumes a ref recorded in the same sandbox on the same runtime", () => {
    const candidate = { providerSessionRef: "ref-1", sandboxId: "sandbox-1", model: claudeModel };
    expect(resumableSessionRef(candidate, current)).toBe("ref-1");
  });

  it("does not resume when there is no candidate", () => {
    expect(resumableSessionRef(undefined, current)).toBeUndefined();
  });

  it("does not resume a ref recorded in a different sandbox", () => {
    const candidate = { providerSessionRef: "ref-1", sandboxId: "sandbox-0", model: claudeModel };
    expect(resumableSessionRef(candidate, current)).toBeUndefined();
  });

  it("does not resume a ref recorded by a different runtime", () => {
    const candidate = { providerSessionRef: "thread-1", sandboxId: "sandbox-1", model: openaiModel };
    expect(resumableSessionRef(candidate, current)).toBeUndefined();
  });

  it("does not resume a ref whose run never recorded a model", () => {
    const candidate = { providerSessionRef: "ref-1", sandboxId: "sandbox-1" };
    expect(resumableSessionRef(candidate, current)).toBeUndefined();
  });
});
