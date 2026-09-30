import type { SandboxProvider } from "../sandbox/types";
import { CODEX_SKILL_DIR } from "../skill-paths";
import { agentGitIdentityEnv } from "./claude-code-runtime";
import { readAgentTurnOutput } from "./marker-protocol";
import type { AgentRuntime, AgentTurnResult, ModelEndpoint, RunInput, RuntimeCapabilities, RuntimeEvent } from "./types";

export function codexModelEnv(endpoint: ModelEndpoint): Record<string, string> {
  return {
    MODEL_BASE_URL: `${endpoint.baseUrl}/v1`,
    MODEL_TOKEN: endpoint.token,
  };
}

class CodexRuntime implements AgentRuntime {
  readonly kind = "codex" as const;

  capabilities(): RuntimeCapabilities {
    return { supportsSkills: true, skillDir: CODEX_SKILL_DIR, supportsResume: true };
  }

  async runTurn(
    input: RunInput,
    ctx: { sandboxProvider: SandboxProvider; sandboxId: string; onEvent?: (event: RuntimeEvent) => Promise<void> },
  ): Promise<AgentTurnResult> {
    const env: Record<string, string> = {
      SYSTEM_PROMPT: input.systemPrompt,
      USER_TEXT: input.userText,
      MODEL_ID: input.model.id,
      ...agentGitIdentityEnv(input.agentName),
      ...(input.modelEndpoint ? codexModelEnv(input.modelEndpoint) : {}),
    };
    if (input.resumeSessionRef) env.RESUME_SESSION_REF = input.resumeSessionRef;
    if (input.outputSchema) env.OUTPUT_SCHEMA = JSON.stringify(input.outputSchema);
    if (input.isReviewTurn) env.AGENT_TURN_KIND = "review";

    const output = ctx.sandboxProvider.exec(
      ctx.sandboxId,
      ["/agent/node_modules/.bin/tsx", "/agent/run-turn-codex.ts"],
      { env },
    );
    return readAgentTurnOutput(output, ctx.onEvent);
  }
}

export const codexRuntime: AgentRuntime = new CodexRuntime();
