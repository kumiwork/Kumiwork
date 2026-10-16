import { describe, expect, it, vi } from "vitest";
import type { Agent, ChatMessage, Task } from "@kumiwork/core";

vi.mock("@kumiwork/db", () => ({ listConnections: vi.fn() }));

import { buildRouterInput, ROUTER_CRITERIA_MAX_CHARS, ROUTER_TEXT_MAX_CHARS } from "../router-input";

const agent = { name: "Developer", description: "Builds features" } as Agent;

function task(overrides: Partial<Task> = {}): Task {
  return { title: "Fix login", description: "The login button does nothing.", acceptanceCriteria: [], ...overrides } as Task;
}

describe("buildRouterInput", () => {
  it("describes a manual task with a codebase", () => {
    const input = buildRouterInput({
      agent,
      task: task({ codebase: "acme/web", acceptanceCriteria: [{ text: "Button logs in", done: false }] }),
    });
    expect(input).toEqual({
      title: "Fix login",
      description: "The login button does nothing.",
      criteria: ["Button logs in"],
      message: "",
      agentName: "Developer",
      agentDescription: "Builds features",
      features: {
        kind: "task",
        source: "manual",
        descriptionChars: 30,
        criteriaCount: 1,
        isPrReview: false,
        isIssueLink: false,
        hasCodebase: true,
      },
    });
  });

  it("marks a Jira task", () => {
    const input = buildRouterInput({
      agent,
      task: task({ externalRef: { provider: "jira", key: "P-1", url: "https://x", lastKnownUpdated: "" } }),
    });
    expect(input.features.source).toBe("jira");
  });

  it("treats a PR link as a PR review with a codebase", () => {
    const input = buildRouterInput({ agent, task: task({ description: "https://github.com/acme/web/pull/12" }) });
    expect(input.features).toMatchObject({ isPrReview: true, isIssueLink: false, hasCodebase: true });
  });

  it("marks an issue link", () => {
    const input = buildRouterInput({
      agent,
      task: task({ codebase: "acme/web", description: "https://github.com/acme/web/issues/7" }),
    });
    expect(input.features).toMatchObject({ isPrReview: false, isIssueLink: true });
  });

  it("counts the full description but sends only the first part", () => {
    const long = "x".repeat(ROUTER_TEXT_MAX_CHARS + 500);
    const input = buildRouterInput({ agent, task: task({ description: long }) });
    expect(input.description).toHaveLength(ROUTER_TEXT_MAX_CHARS);
    expect(input.features.descriptionChars).toBe(ROUTER_TEXT_MAX_CHARS + 500);
  });

  it("caps the criteria text but counts every criterion", () => {
    const criteria = Array.from({ length: 30 }, (_, i) => ({ text: `${i}`.padEnd(100, "c"), done: false }));
    const input = buildRouterInput({ agent, task: task({ acceptanceCriteria: criteria }) });
    expect(input.criteria.join("").length).toBe(ROUTER_CRITERIA_MAX_CHARS);
    expect(input.features.criteriaCount).toBe(30);
  });

  it("accepts an agent with no description", () => {
    const input = buildRouterInput({ agent: { name: "Bare" } as Agent, task: task() });
    expect(input.agentDescription).toBe("");
  });

  it("describes a chat session from its message", () => {
    const message = { content: "What does this repo do?" } as ChatMessage;
    const input = buildRouterInput({ agent, triggeringMessage: message });
    expect(input).toMatchObject({ title: "", description: "", criteria: [], message: "What does this repo do?" });
    expect(input.features).toEqual({
      kind: "chat",
      source: "chat",
      descriptionChars: 0,
      criteriaCount: 0,
      isPrReview: false,
      isIssueLink: false,
      hasCodebase: false,
    });
  });
});
