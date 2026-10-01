export interface CheckEvent {
  runId: number;
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

type CheckKind = "test" | "typecheck" | "lint";

const PACKAGE_RUNNER = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?`;

const CHECK_PATTERNS: ReadonlyArray<readonly [CheckKind, RegExp]> = [
  [
    "test",
    new RegExp(
      String.raw`\b(?:vitest|jest|pytest|mocha|playwright)\b|\b${PACKAGE_RUNNER}(?:\S+:)?test\b|\b(?:cargo|go|mvn|gradle|gradlew|dotnet)\b[^\n&|;]*\btest\b|\bmake\s+(?:test|check)\b`,
    ),
  ],
  ["typecheck", new RegExp(String.raw`\btsc\b|\btypecheck\b|\bmypy\b|\bpyright\b`)],
  [
    "lint",
    new RegExp(
      String.raw`\b(?:eslint|ruff|flake8|pylint|checkstyle|golangci-lint)\b|\b${PACKAGE_RUNNER}lint\b|\bcargo\s+clippy\b`,
    ),
  ],
];

export function checkKindsOf(command: string): CheckKind[] {
  return CHECK_PATTERNS.filter(([, pattern]) => pattern.test(command)).map(([kind]) => kind);
}

export function localChecksPassed(events: readonly CheckEvent[]): boolean {
  const latestPassed = new Map<CheckKind, boolean>();
  const ordered = [...events].sort((a, b) => a.runId - b.runId || a.seq - b.seq);
  for (const event of ordered) {
    if (event.type !== "tool_result" || event.data.subagent === true) continue;
    if (event.data.tool !== "Bash" || typeof event.data.command !== "string") continue;
    for (const kind of checkKindsOf(event.data.command)) {
      latestPassed.set(kind, event.data.isError !== true);
    }
  }
  return latestPassed.size > 0 && [...latestPassed.values()].every(Boolean);
}
