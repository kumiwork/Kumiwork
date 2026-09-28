import { MAX_SANDBOX_TOOL_OUTPUT_CHARS, type ToolResultLine } from "./tool-results.js";

export const REMEMBER_MCP_SERVER = "memory";
export const REMEMBER_TOOL = "remember";

interface CommandExecutionItem {
  id: string;
  type: "command_execution";
  command: string;
  aggregated_output: string;
  exit_code?: number;
  status: "in_progress" | "completed" | "failed";
}

interface FileChangeItem {
  id: string;
  type: "file_change";
  changes: { path: string; kind: "add" | "delete" | "update" }[];
  status: "completed" | "failed";
}

interface McpToolCallItem {
  id: string;
  type: "mcp_tool_call";
  server: string;
  tool: string;
  arguments: unknown;
  error?: { message: string };
  status: "in_progress" | "completed" | "failed";
}

interface TextItem {
  id: string;
  type: "agent_message" | "reasoning";
  text: string;
}

interface WebSearchItem {
  id: string;
  type: "web_search";
  query: string;
}

interface TodoListItem {
  id: string;
  type: "todo_list";
  items: { text: string; completed: boolean }[];
}

type CodexItem = CommandExecutionItem | FileChangeItem | McpToolCallItem | TextItem | WebSearchItem | TodoListItem;

export type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "item.started" | "item.updated" | "item.completed"; item: { type: string } }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "error"; message: string }
  | { type: string };

export type CodexRuntimeEvent =
  | { type: "thinking_delta"; text: string; tool?: string; command?: string; filePath?: string }
  | { type: "memory_write"; content: string }
  | ToolResultLine;

export interface CodexTurnState {
  threadId?: string;
  finalResponse?: string;
  failure?: string;
  lastErrorMessage?: string;
}

export type CodexFailureCode = "prompt_too_long" | "insufficient_credit";

function keepTail(text: string, max: number): string {
  return text.length > max ? text.slice(text.length - max) : text;
}

function toolResult(
  item: { id: string },
  tool: string,
  inputSummary: string,
  isError: boolean,
  extra: { command?: string; output?: string } = {},
): ToolResultLine {
  return {
    type: "tool_result",
    toolUseId: item.id,
    tool,
    inputSummary,
    ...(extra.command !== undefined ? { command: extra.command } : {}),
    isError,
    subagent: false,
    ...(isError && extra.output ? { output: keepTail(extra.output, MAX_SANDBOX_TOOL_OUTPUT_CHARS) } : {}),
  };
}

function rememberedContent(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const content = (args as { content?: unknown }).content;
  return typeof content === "string" && content.trim() ? content : undefined;
}

function startedItemEvents(item: CodexItem): CodexRuntimeEvent[] {
  if (item.type !== "command_execution") return [];
  return [{ type: "thinking_delta", tool: "Bash", command: item.command, text: `[Bash] ${item.command}\n` }];
}

function completedItemEvents(item: CodexItem, state: CodexTurnState, isReviewTurn: boolean): CodexRuntimeEvent[] {
  const events: CodexRuntimeEvent[] = [];
  switch (item.type) {
    case "agent_message":
      state.finalResponse = item.text;
      return events;
    case "reasoning":
      if (item.text.trim()) events.push({ type: "thinking_delta", text: item.text });
      return events;
    case "command_execution": {
      const isError = item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0);
      events.push(
        toolResult(item, "Bash", item.command, isError, { command: item.command, output: item.aggregated_output }),
      );
      break;
    }
    case "file_change":
      for (const change of item.changes) {
        const tool = change.kind === "add" ? "Write" : "Edit";
        events.push({ type: "thinking_delta", tool, filePath: change.path, text: `[${tool}] ${tool}: ${change.path}\n` });
      }
      events.push(
        toolResult(item, "Edit", item.changes.map((change) => change.path).join(", "), item.status === "failed"),
      );
      break;
    case "mcp_tool_call": {
      const name = `mcp__${item.server}__${item.tool}`;
      if (item.server === REMEMBER_MCP_SERVER && item.tool === REMEMBER_TOOL && item.status === "completed") {
        const content = rememberedContent(item.arguments);
        if (content) events.push({ type: "memory_write", content });
      }
      events.push({ type: "thinking_delta", tool: name, text: `[${name}]\n` });
      events.push(
        toolResult(item, name, name, item.status === "failed", { output: item.error?.message }),
      );
      break;
    }
    case "web_search":
      events.push({ type: "thinking_delta", tool: "WebSearch", text: `[WebSearch] ${item.query}\n` });
      return events;
    case "todo_list":
      events.push({
        type: "thinking_delta",
        tool: "TodoWrite",
        text: item.items.map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.text}`).join("\n"),
      });
      return events;
  }
  return isReviewTurn ? events.filter((event) => event.type !== "tool_result") : events;
}

export function translateCodexEvent(
  event: CodexEvent,
  state: CodexTurnState,
  isReviewTurn: boolean,
): CodexRuntimeEvent[] {
  if (event.type === "thread.started" && "thread_id" in event) {
    state.threadId = event.thread_id;
    return [];
  }
  if (event.type === "turn.failed" && "error" in event) {
    state.failure = event.error.message;
    return [];
  }
  if (event.type === "error" && "message" in event) {
    state.lastErrorMessage = event.message;
    return [];
  }
  if (!("item" in event)) return [];
  const item = event.item as CodexItem;
  if (event.type === "item.started") return startedItemEvents(item);
  if (event.type === "item.completed") return completedItemEvents(item, state, isReviewTurn);
  return [];
}

export function classifyCodexFailure(message: string): CodexFailureCode | undefined {
  if (/context[_ ]length[_ ]exceeded|context window|maximum context length/i.test(message)) return "prompt_too_long";
  if (/insufficient[_ ]quota|exceeded your current quota|billing/i.test(message)) return "insufficient_credit";
  return undefined;
}
