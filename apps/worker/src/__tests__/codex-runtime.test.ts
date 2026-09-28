import { describe, expect, it } from "vitest";
import type { OutputChunk, SandboxProvider } from "../sandbox/types";
import { codexRuntime } from "../agent-runtime/codex-runtime";
import { PromptTooLongError } from "../agent-runtime/errors";

function fakeSandbox(chunks: OutputChunk[]) {
  const execCalls: Array<{ id: string; cmd: string[]; env?: Record<string, string> }> = [];
  const sandboxProvider: SandboxProvider = {
    create: async () => ({ id: "unused" }),
    exec: (id, cmd, opts) => {
      execCalls.push({ id, cmd, env: opts?.env });
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    },
    writeFiles: async () => {},
    resetMemory: async () => {},
    readWorkspace: async () => ({}),
    destroy: async () => {},
    exists: async () => true,
    interrupt: async () => {},
  };
  return { sandboxProvider, execCalls };
}

const resultLine = (payload: Record<string, unknown>): OutputChunk => ({
  stream: "stdout",
  data: `__RESULT__${JSON.stringify(payload)}\n`,
});

function baseInput() {
  return {
    systemPrompt: "Be helpful.",
    model: { family: "openai" as const, id: "gpt-test", maxTokens: 8192 },
    userText: "Fix the bug.",
  };
}

describe("codexRuntime", () => {
  it("has kind 'codex' and materialises skills where Codex discovers them", () => {
    expect(codexRuntime.kind).toBe("codex");
    expect(codexRuntime.capabilities()).toEqual({
      supportsSkills: true,
      skillDir: ".agents/skills",
      supportsResume: true,
    });
  });

  it("generates no repo maps of its own", () => {
    expect(codexRuntime.repoMap).toBeUndefined();
  });

  it("execs run-turn-codex.ts with the turn inputs and returns the parsed result", async () => {
    const { sandboxProvider, execCalls } = fakeSandbox([resultLine({ text: "Done", providerSessionRef: "thread-1" })]);

    const result = await codexRuntime.runTurn(
      { ...baseInput(), resumeSessionRef: "thread-0", outputSchema: { type: "object" }, isReviewTurn: true },
      { sandboxProvider, sandboxId: "sandbox-1" },
    );

    expect(result).toEqual({ text: "Done", providerSessionRef: "thread-1" });
    expect(execCalls[0]!.cmd).toEqual(["/agent/node_modules/.bin/tsx", "/agent/run-turn-codex.ts"]);
    expect(execCalls[0]!.env).toEqual({
      SYSTEM_PROMPT: "Be helpful.",
      USER_TEXT: "Fix the bug.",
      MODEL_ID: "gpt-test",
      RESUME_SESSION_REF: "thread-0",
      OUTPUT_SCHEMA: JSON.stringify({ type: "object" }),
      AGENT_TURN_KIND: "review",
    });
  });

  it("points Codex at the proxy's versioned base path with the run token", async () => {
    const { sandboxProvider, execCalls } = fakeSandbox([resultLine({ text: "Done", providerSessionRef: "thread-1" })]);
    const modelEndpoint = { baseUrl: "http://host.docker.internal:8787/openai", token: "arata-run-abc" };

    await codexRuntime.runTurn({ ...baseInput(), modelEndpoint }, { sandboxProvider, sandboxId: "sandbox-1" });

    expect(execCalls[0]!.env).toMatchObject({
      MODEL_BASE_URL: "http://host.docker.internal:8787/openai/v1",
      MODEL_TOKEN: "arata-run-abc",
    });
  });

  it("surfaces a classified context overflow as PromptTooLongError", async () => {
    const { sandboxProvider } = fakeSandbox([
      { stream: "stdout", data: `__ERROR__${JSON.stringify({ code: "prompt_too_long" })}\n` },
    ]);

    await expect(codexRuntime.runTurn(baseInput(), { sandboxProvider, sandboxId: "sandbox-1" })).rejects.toBeInstanceOf(
      PromptTooLongError,
    );
  });
});
