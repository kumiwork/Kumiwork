import type { RuntimeKind } from "@kumiwork/core";
import { claudeCodeRuntime } from "./claude-code-runtime";
import { codexRuntime } from "./codex-runtime";
import type { AgentRuntime } from "./types";

export const runtimes: AgentRuntime[] = [claudeCodeRuntime, codexRuntime];

export function getDefaultAgentRuntime(): AgentRuntime {
  return runtimes[0]!;
}

export function getAgentRuntime(kind: RuntimeKind): AgentRuntime {
  const runtime = runtimes.find((r) => r.kind === kind);
  if (!runtime) throw new Error(`No AgentRuntime registered for kind "${kind}"`);
  return runtime;
}
