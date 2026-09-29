import { describe, expect, it } from "vitest";
import {
  classifyCodexFailure,
  translateCodexEvent,
  type CodexEvent,
  type CodexTurnState,
} from "../../sandbox-image/codex-events";
import { MAX_SANDBOX_TOOL_OUTPUT_CHARS } from "../../sandbox-image/tool-results";

function translate(events: CodexEvent[], isReviewTurn = false) {
  const state: CodexTurnState = {};
  const lines = events.flatMap((event) => translateCodexEvent(event, state, isReviewTurn));
  return { state, lines };
}

const completed = (item: Record<string, unknown>): CodexEvent => ({ type: "item.completed", item } as CodexEvent);
const started = (item: Record<string, unknown>): CodexEvent => ({ type: "item.started", item } as CodexEvent);

describe("translateCodexEvent", () => {
  it("records the thread id and the last agent message as the turn's result", () => {
    const { state, lines } = translate([
      { type: "thread.started", thread_id: "thread-1" },
      completed({ id: "1", type: "agent_message", text: "draft" }),
      completed({ id: "2", type: "agent_message", text: "final" }),
    ]);

    expect(state).toMatchObject({ threadId: "thread-1", finalResponse: "final" });
    expect(lines).toEqual([]);
  });

  it("streams reasoning summaries as thinking", () => {
    const { lines } = translate([
      completed({ id: "1", type: "reasoning", text: "Looking at the failing test" }),
      completed({ id: "2", type: "reasoning", text: "  " }),
    ]);

    expect(lines).toEqual([{ type: "thinking_delta", text: "Looking at the failing test" }]);
  });

  it("announces a command when it starts and reports its result when it completes", () => {
    const item = { id: "c1", type: "command_execution", command: "pnpm test", aggregated_output: "ok" };
    const { lines } = translate([
      started({ ...item, status: "in_progress" }),
      completed({ ...item, status: "completed", exit_code: 0 }),
    ]);

    expect(lines).toEqual([
      { type: "thinking_delta", tool: "Bash", command: "pnpm test", text: "[Bash] pnpm test\n" },
      {
        type: "tool_result",
        toolUseId: "c1",
        tool: "Bash",
        inputSummary: "pnpm test",
        command: "pnpm test",
        isError: false,
        subagent: false,
      },
    ]);
  });

  it("reports a non-zero exit as an error with the tail of its output", () => {
    const output = "x".repeat(MAX_SANDBOX_TOOL_OUTPUT_CHARS + 5) + "boom";
    const { lines } = translate([
      completed({
        id: "c1",
        type: "command_execution",
        command: "pnpm test",
        aggregated_output: output,
        exit_code: 1,
        status: "completed",
      }),
    ]);

    expect(lines[0]).toMatchObject({ type: "tool_result", isError: true });
    const reported = (lines[0] as { output: string }).output;
    expect(reported).toHaveLength(MAX_SANDBOX_TOOL_OUTPUT_CHARS);
    expect(reported.endsWith("boom")).toBe(true);
  });

  it("shows file changes as writes and edits with their paths", () => {
    const { lines } = translate([
      completed({
        id: "f1",
        type: "file_change",
        status: "completed",
        changes: [
          { path: "src/new.ts", kind: "add" },
          { path: "src/old.ts", kind: "update" },
        ],
      }),
    ]);

    expect(lines).toEqual([
      { type: "thinking_delta", tool: "Write", filePath: "src/new.ts", text: "[Write] Write: src/new.ts\n" },
      { type: "thinking_delta", tool: "Edit", filePath: "src/old.ts", text: "[Edit] Edit: src/old.ts\n" },
      {
        type: "tool_result",
        toolUseId: "f1",
        tool: "Edit",
        inputSummary: "src/new.ts, src/old.ts",
        isError: false,
        subagent: false,
      },
    ]);
  });

  it("turns a completed remember call into a memory write", () => {
    const { lines } = translate([
      completed({
        id: "m1",
        type: "mcp_tool_call",
        server: "memory",
        tool: "remember",
        arguments: { content: "Run pnpm install before tests." },
        status: "completed",
      }),
    ]);

    expect(lines[0]).toEqual({ type: "memory_write", content: "Run pnpm install before tests." });
  });

  it("does not write memory for a failed or empty remember call", () => {
    const call = { id: "m1", type: "mcp_tool_call", server: "memory", tool: "remember" };
    const { lines } = translate([
      completed({ ...call, arguments: { content: "x" }, status: "failed", error: { message: "nope" } }),
      completed({ ...call, arguments: { content: "   " }, status: "completed" }),
    ]);

    expect(lines.some((line) => line.type === "memory_write")).toBe(false);
  });

  it("renders the to-do list as a planning step", () => {
    const { lines } = translate([
      completed({
        id: "t1",
        type: "todo_list",
        items: [
          { text: "Reproduce", completed: true },
          { text: "Fix", completed: false },
        ],
      }),
    ]);

    expect(lines).toEqual([{ type: "thinking_delta", tool: "TodoWrite", text: "[x] Reproduce\n[ ] Fix" }]);
  });

  it("withholds tool results on a review turn but keeps the thinking steps", () => {
    const { lines } = translate(
      [
        completed({
          id: "c1",
          type: "command_execution",
          command: "git diff",
          aggregated_output: "",
          exit_code: 0,
          status: "completed",
        }),
        completed({ id: "f1", type: "file_change", status: "completed", changes: [{ path: "a.ts", kind: "update" }] }),
      ],
      true,
    );

    expect(lines.map((line) => line.type)).toEqual(["thinking_delta"]);
  });

  it("records a failed turn and the last stream error without emitting anything", () => {
    const { state, lines } = translate([
      { type: "error", message: "Reconnecting... 1/5" },
      { type: "turn.failed", error: { message: "stream disconnected" } },
    ]);

    expect(state).toMatchObject({ failure: "stream disconnected", lastErrorMessage: "Reconnecting... 1/5" });
    expect(lines).toEqual([]);
  });

  it("ignores item types it does not know", () => {
    expect(translate([completed({ id: "x", type: "collab_tool_call" })]).lines).toEqual([]);
  });
});

describe("classifyCodexFailure", () => {
  it.each([
    "context_length_exceeded: Your input exceeds the context window of this model",
    "This model's maximum context length is 400000 tokens",
  ])("classifies %s as a context overflow", (message) => {
    expect(classifyCodexFailure(message)).toBe("prompt_too_long");
  });

  it.each(["insufficient_quota", "You exceeded your current quota, please check your plan and billing details."])(
    "classifies %s as exhausted credit",
    (message) => {
      expect(classifyCodexFailure(message)).toBe("insufficient_credit");
    },
  );

  it("leaves anything else unclassified", () => {
    expect(classifyCodexFailure("unexpected status 500 Internal Server Error")).toBeUndefined();
  });
});
