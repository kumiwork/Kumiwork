import type { Agent, ChatMessage, RouterInput, Task } from "@kumiwork/core";
import { parseIssueReferenceAcrossProviders, parsePullRequestReferenceAcrossProviders } from "@kumiwork/scm";

export const ROUTER_TEXT_MAX_CHARS = 4000;
export const ROUTER_CRITERIA_MAX_CHARS = 2000;
export const ROUTER_TITLE_MAX_CHARS = 500;
export const ROUTER_AGENT_DESCRIPTION_MAX_CHARS = 1000;

export interface RouterInputContext {
  agent: Agent;
  task?: Task;
  triggeringMessage?: ChatMessage;
}

function capCriteria(texts: readonly string[]): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const text of texts) {
    const room = ROUTER_CRITERIA_MAX_CHARS - used;
    if (room <= 0) break;
    const part = text.slice(0, room);
    kept.push(part);
    used += part.length;
  }
  return kept;
}

export function buildRouterInput({ agent, task, triggeringMessage }: RouterInputContext): RouterInput {
  const agentFields = {
    agentName: agent.name,
    agentDescription: (agent.description ?? "").slice(0, ROUTER_AGENT_DESCRIPTION_MAX_CHARS),
  };
  if (!task) {
    return {
      title: "",
      description: "",
      criteria: [],
      message: (triggeringMessage?.content ?? "").slice(0, ROUTER_TEXT_MAX_CHARS),
      ...agentFields,
      features: {
        kind: "chat",
        source: "chat",
        descriptionChars: 0,
        criteriaCount: 0,
        isPrReview: false,
        isIssueLink: false,
        hasCodebase: false,
      },
    };
  }
  const isPrReview = parsePullRequestReferenceAcrossProviders(task.description) !== undefined;
  const isIssueLink = !isPrReview && parseIssueReferenceAcrossProviders(task.description) !== undefined;
  return {
    title: task.title.slice(0, ROUTER_TITLE_MAX_CHARS),
    description: task.description.slice(0, ROUTER_TEXT_MAX_CHARS),
    criteria: capCriteria(task.acceptanceCriteria.map((criterion) => criterion.text)),
    message: "",
    ...agentFields,
    features: {
      kind: "task",
      source: task.externalRef?.provider === "jira" ? "jira" : "manual",
      descriptionChars: task.description.length,
      criteriaCount: task.acceptanceCriteria.length,
      isPrReview,
      isIssueLink,
      hasCodebase: Boolean(task.codebase) || isPrReview,
    },
  };
}
