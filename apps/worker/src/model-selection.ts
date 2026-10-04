import type { Agent, ChatMessage, ModelSpec, Task } from "@kumiwork/core";

export interface ModelSelectionContext {
  agent: Agent;
  task?: Task;
  triggeringMessage?: ChatMessage;
}

export type ModelSelectionReason = "task_override" | "agent_default";

export interface ModelSelection {
  model: ModelSpec;
  reason: ModelSelectionReason;
}

export interface ModelSelector {
  select(context: ModelSelectionContext): Promise<ModelSelection>;
}

export const explicitModelSelector: ModelSelector = {
  async select({ agent, task }) {
    if (task?.model) return { model: task.model, reason: "task_override" };
    return { model: agent.model, reason: "agent_default" };
  },
};
