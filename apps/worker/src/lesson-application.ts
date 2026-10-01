import type { SuccessMarker } from "./session-timeline";

export interface LessonApplication {
  lessonId: number;
  runId: number;
  command: string;
  span: string;
}

const NEGATION = /\b(?:not|never|don't|do not|doesn't|does not|avoid|instead of|rather than|no longer|stop|without|n't)\b/i;
const MIN_SPAN_TOKENS = 2;

export function lessonCommandSpans(lesson: string): string[] {
  const spans: string[] = [];
  for (const sentence of lesson.split(/[.;!?\n]+/)) {
    if (NEGATION.test(sentence)) continue;
    for (const match of sentence.matchAll(/`([^`\n]+)`/g)) {
      const span = match[1].trim().replace(/\s+/g, " ");
      if (span.split(" ").length >= MIN_SPAN_TOKENS) spans.push(span);
    }
  }
  return spans;
}

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ");
}

export function findLessonApplications(
  lessons: ReadonlyMap<number, string>,
  successes: readonly SuccessMarker[],
): LessonApplication[] {
  const applications: LessonApplication[] = [];
  for (const [lessonId, content] of lessons) {
    const spans = lessonCommandSpans(content);
    if (spans.length === 0) continue;
    for (const success of successes) {
      if (success.tool !== "Bash" || !success.command) continue;
      const command = normalizeCommand(success.command);
      const span = spans.find((candidate) => command.includes(candidate));
      if (span) applications.push({ lessonId, runId: success.runId, command: success.command, span });
    }
  }
  return applications;
}

export function appliedLessonIds(
  applications: readonly LessonApplication[],
  wasInjected: (lessonId: number, runId: number) => boolean,
): Map<number, LessonApplication> {
  const applied = new Map<number, LessonApplication>();
  for (const application of applications) {
    if (applied.has(application.lessonId)) continue;
    if (wasInjected(application.lessonId, application.runId)) applied.set(application.lessonId, application);
  }
  return applied;
}
