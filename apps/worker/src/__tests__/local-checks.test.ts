import { describe, expect, it } from "vitest";
import { checkKindsOf, localChecksOutcome, type CheckEvent } from "../local-checks";

let seq = 0;
function bash(command: string, isError = false, extra: Record<string, unknown> = {}, runId = 1): CheckEvent {
  return { runId, seq: ++seq, type: "tool_result", data: { tool: "Bash", command, isError, ...extra } };
}

describe("checkKindsOf", () => {
  it.each([
    ["pnpm test:unit", ["test"]],
    ["npx vitest run --project unit", ["test"]],
    ["pytest -q", ["test"]],
    ["mvn -q test", ["test"]],
    ["pnpm typecheck", ["typecheck"]],
    ["npx tsc --noEmit", ["typecheck"]],
    ["pnpm lint", ["lint"]],
    ["pnpm test:unit && pnpm typecheck && pnpm lint", ["test", "typecheck", "lint"]],
    ["git status", []],
    ["cat tests/readme.md", []],
  ])("%s", (command, expected) => {
    expect(checkKindsOf(command)).toEqual(expected);
  });
});

describe("localChecksOutcome", () => {
  it("is not_run when the agent never ran a check", () => {
    expect(localChecksOutcome([bash("git status")])).toBe("not_run");
    expect(localChecksOutcome([])).toBe("not_run");
  });

  it("is passed when every check that ran succeeded", () => {
    expect(localChecksOutcome([bash("pnpm test:unit"), bash("pnpm typecheck"), bash("pnpm lint")])).toBe("passed");
  });

  it("is failed when the latest run of a check failed", () => {
    expect(localChecksOutcome([bash("pnpm test:unit"), bash("pnpm lint", true)])).toBe("failed");
  });

  it("counts a check that failed and was then fixed", () => {
    expect(localChecksOutcome([bash("pnpm test:unit", true), bash("pnpm test:unit")])).toBe("passed");
  });

  it("is failed when a check passed and then a later run of it failed", () => {
    expect(localChecksOutcome([bash("pnpm test:unit"), bash("pnpm test:unit", true)])).toBe("failed");
  });

  it("orders by run and sequence rather than array position", () => {
    const late = bash("pnpm test:unit", false, {}, 2);
    const early = bash("pnpm test:unit", true, {}, 1);
    expect(localChecksOutcome([late, early])).toBe("passed");
  });

  it("ignores subagent and non-Bash results", () => {
    expect(localChecksOutcome([bash("pnpm test:unit"), bash("pnpm lint", true, { subagent: true })])).toBe("passed");
    expect(localChecksOutcome([{ runId: 1, seq: 99, type: "tool_result", data: { tool: "Read", isError: true } }, bash("pnpm test:unit")])).toBe("passed");
  });
});
