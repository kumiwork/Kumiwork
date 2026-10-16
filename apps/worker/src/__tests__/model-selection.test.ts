import { describe, expect, it } from "vitest";
import type { Agent, ModelSpec, Task } from "@kumiwork/core";
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

  it("returns the agent's effort with the agent's model", async () => {
    const lowAgent = { model: agentModel, effort: "low" } as Agent;
    await expect(explicitModelSelector.select({ agent: lowAgent })).resolves.toEqual({
      model: agentModel,
      effort: "low",
      reason: "agent_default",
    });
  });

  it("keeps the agent's effort when the task overrides only the model", async () => {
    const lowAgent = { model: agentModel, effort: "low" } as Agent;
    await expect(
      explicitModelSelector.select({ agent: lowAgent, task: { model: taskModel } as Task }),
    ).resolves.toEqual({ model: taskModel, effort: "low", reason: "task_override" });
  });
});
