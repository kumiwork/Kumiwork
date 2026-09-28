import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import { classifyCodexFailure, translateCodexEvent, type CodexTurnState, REMEMBER_MCP_SERVER } from "./codex-events.js";
import { ERROR_MARKER, EVENT_MARKER, RESULT_MARKER } from "./markers.js";

const PROXY_PROVIDER_ID = "arata";
const PROXY_TOKEN_ENV = "ARATA_MODEL_TOKEN";

function parseStructuredOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const systemPrompt = process.env.SYSTEM_PROMPT ?? "";
  const userText = process.env.USER_TEXT ?? "";
  const model = process.env.MODEL_ID;
  const resume = process.env.RESUME_SESSION_REF || undefined;
  const outputSchemaEnv = process.env.OUTPUT_SCHEMA;
  const outputSchema = outputSchemaEnv ? JSON.parse(outputSchemaEnv) : undefined;
  const isReviewTurn = process.env.AGENT_TURN_KIND === "review";
  const baseUrl = process.env.MODEL_BASE_URL;
  if (!baseUrl) throw new Error("MODEL_BASE_URL is not set");

  process.env[PROXY_TOKEN_ENV] = process.env.MODEL_TOKEN ?? "";

  const codex = new Codex({
    config: {
      model_provider: PROXY_PROVIDER_ID,
      model_providers: {
        [PROXY_PROVIDER_ID]: {
          name: "Arata model proxy",
          base_url: baseUrl,
          env_key: PROXY_TOKEN_ENV,
          wire_api: "responses",
        },
      },
      developer_instructions: systemPrompt,
      model_reasoning_summary: "auto",
      web_search: "disabled",
      check_for_update_on_startup: false,
      analytics: { enabled: false },
      feedback: { enabled: false },
      mcp_servers: isReviewTurn
        ? {}
        : {
            [REMEMBER_MCP_SERVER]: {
              command: "/agent/node_modules/.bin/tsx",
              args: ["/agent/remember-mcp.ts"],
              required: true,
            },
          },
    },
  });

  const threadOptions: ThreadOptions = {
    model,
    workingDirectory: "/workspace",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    networkAccessEnabled: true,
    webSearchMode: "disabled",
  };
  const thread = resume ? codex.resumeThread(resume, threadOptions) : codex.startThread(threadOptions);
  const state: CodexTurnState = { threadId: resume };

  try {
    const { events } = await thread.runStreamed(userText, outputSchema ? { outputSchema } : undefined);
    for await (const event of events) {
      for (const line of translateCodexEvent(event, state, isReviewTurn)) {
        process.stdout.write(`${EVENT_MARKER}${JSON.stringify(line)}\n`);
      }
    }
  } catch (err) {
    state.failure ??= err instanceof Error ? err.message : String(err);
  }

  if (state.failure !== undefined) {
    const code = classifyCodexFailure(`${state.failure}\n${state.lastErrorMessage ?? ""}`);
    if (code) {
      process.stdout.write(`${ERROR_MARKER}${JSON.stringify({ code })}\n`);
      return;
    }
    throw new Error(`Codex turn failed: ${state.failure}`);
  }

  const threadId = thread.id ?? state.threadId;
  if (state.finalResponse === undefined || !threadId) {
    throw new Error("Codex turn completed without a final response");
  }

  const structuredOutput = outputSchema ? parseStructuredOutput(state.finalResponse) : undefined;
  process.stdout.write(
    `${RESULT_MARKER}${JSON.stringify({
      text: state.finalResponse,
      providerSessionRef: threadId,
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    })}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
