import { describe, expect, it } from "vitest";
import type { RuntimeKind } from "@agentfactory/core";
import { claudeCodeRuntime } from "../agent-runtime/claude-code-runtime";
import { codexRuntime } from "../agent-runtime/codex-runtime";
import { getAgentRuntime, getDefaultAgentRuntime } from "../agent-runtime/registry";

describe("getAgentRuntime", () => {
  it("dispatches each kind to its own runtime", () => {
    expect(getAgentRuntime("claude-code")).toBe(claudeCodeRuntime);
    expect(getAgentRuntime("codex")).toBe(codexRuntime);
  });

  it("treats the Claude Code runtime as the default", () => {
    expect(getDefaultAgentRuntime()).toBe(claudeCodeRuntime);
  });

  it("throws for a kind with no registered runtime", () => {
    expect(() => getAgentRuntime("nonexistent" as RuntimeKind)).toThrow(/No AgentRuntime registered/);
  });
});
