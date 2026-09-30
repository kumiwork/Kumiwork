import { describe, expect, it } from "vitest";
import type { Agent, ModelSpec, Task } from "@agentfactory/core";
import { explicitModelSelector } from "../model-selection";

const agentModel: ModelSpec = { family: "anthropic", id: "claude-sonnet-5", maxTokens: 8192 };
const taskModel: ModelSpec = { family: "anthropic", id: "claude-opus-5", maxTokens: 8192 };
const agent = { model: agentModel } as Agent;

describe("explicitModelSelector", () => {
  it("uses the agent's default model when the run has no task", async () => {
    await expect(explicitModelSelector.select({ agent })).resolves.toEqual({
      model: agentModel,
      reason: "agent_default",
    });
  });

  it("uses the agent's default model when the task has no override", async () => {
    await expect(explicitModelSelector.select({ agent, task: {} as Task })).resolves.toEqual({
      model: agentModel,
      reason: "agent_default",
    });
  });

  it("prefers the task's model override", async () => {
    await expect(explicitModelSelector.select({ agent, task: { model: taskModel } as Task })).resolves.toEqual({
      model: taskModel,
      reason: "task_override",
    });
  });
});
