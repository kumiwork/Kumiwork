import { describe, expect, it } from "vitest";
import { appliedLessonIds, findLessonApplications, lessonCommandSpans } from "../lesson-application";

describe("lessonCommandSpans", () => {
  it("returns multi-word inline code from sentences that do not negate it", () => {
    expect(lessonCommandSpans("Tests here run with `make check`; `npm test` is not set up.")).toEqual(["make check"]);
  });

  it("ignores single-token spans and lessons with no code", () => {
    expect(lessonCommandSpans("Use `pnpm` for installs.")).toEqual([]);
    expect(lessonCommandSpans("Write release notes for end users.")).toEqual([]);
  });

  it("skips spans in sentences that say never, avoid or instead of", () => {
    expect(lessonCommandSpans("Never run `git push --force`. Prefer `git push` instead of `git push -f`.")).toEqual([]);
  });

  it("normalizes whitespace inside a span", () => {
    expect(lessonCommandSpans("Run `pnpm   test:unit` first.")).toEqual(["pnpm test:unit"]);
  });
});

describe("findLessonApplications", () => {
  const lessons = new Map([
    [1, "Tests here run with `make check`."],
    [2, "Write release notes for end users."],
  ]);

  it("matches a successful Bash command that contains the lesson's span", () => {
    const found = findLessonApplications(lessons, [
      { runId: 5, seq: 1, tool: "Bash", command: "cd app && make   check" },
      { runId: 5, seq: 2, tool: "Bash", command: "ls" },
    ]);
    expect(found).toEqual([{ lessonId: 1, runId: 5, command: "cd app && make   check", span: "make check" }]);
  });

  it("ignores non-Bash tools and results with no command", () => {
    expect(findLessonApplications(lessons, [{ runId: 5, seq: 1, tool: "Read" }, { runId: 5, seq: 2, tool: "Bash" }])).toEqual([]);
  });
});

describe("appliedLessonIds", () => {
  it("keeps the first application per lesson that was injected into that run", () => {
    const applications = [
      { lessonId: 1, runId: 4, command: "make check", span: "make check" },
      { lessonId: 1, runId: 5, command: "make check", span: "make check" },
      { lessonId: 3, runId: 5, command: "make lint", span: "make lint" },
    ];
    const applied = appliedLessonIds(applications, (lessonId, runId) => lessonId === 1 && runId === 5);
    expect([...applied.keys()]).toEqual([1]);
    expect(applied.get(1)?.runId).toBe(5);
  });
});
