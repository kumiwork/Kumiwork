import type { Agent, ChatMessage, EffortLevel, ModelSpec, Task } from "@kumiwork/core";

export interface ModelSelectionContext {
  agent: Agent;
  task?: Task;
  triggeringMessage?: ChatMessage;
}

export type ModelSelectionReason = "task_override" | "agent_default";

export interface ModelSelection {
  model: ModelSpec;
  effort?: EffortLevel;
  reason: ModelSelectionReason;
}

export interface ModelSelector {
  select(context: ModelSelectionContext): Promise<ModelSelection>;
}

export const explicitModelSelector: ModelSelector = {
  async select({ agent, task }) {
    const effort = agent.effort ? { effort: agent.effort } : {};
    if (task?.model) return { model: task.model, ...effort, reason: "task_override" };
    return { model: agent.model, ...effort, reason: "agent_default" };
  },
};
