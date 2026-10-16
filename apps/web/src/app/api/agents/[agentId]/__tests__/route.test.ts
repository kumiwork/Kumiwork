import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContext = vi.fn();
const updateAgent = vi.fn();

vi.mock("@kumiwork/db", () => ({
  updateAgent: (...args: unknown[]) => updateAgent(...args),
  getAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));
vi.mock("@kumiwork/queue", () => ({ enqueueRepoMapWarmJob: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/auth", () => ({ requireAuthContext: () => requireAuthContext() }));

import { PATCH } from "../route";

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("http://localhost/api/agents/5", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ agentId: "5" }),
  });
}

beforeEach(() => {
  requireAuthContext.mockReset().mockResolvedValue({ user: { id: 1 }, orgId: 3 });
  updateAgent.mockReset().mockResolvedValue({ id: 5, orgId: 3 });
});

describe("PATCH /api/agents/[agentId] effort", () => {
  it("400s on an unknown effort level without touching the db", async () => {
    const res = await patch({ effort: "turbo" });

    expect(res.status).toBe(400);
    expect(updateAgent).not.toHaveBeenCalled();
  });

  it("passes a valid effort level through", async () => {
    const res = await patch({ effort: "low" });

    expect(res.status).toBe(200);
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith(5, { effort: "low" });
  });

  it("accepts null to clear the effort", async () => {
    const res = await patch({ effort: null });

    expect(res.status).toBe(200);
    expect(updateAgent).toHaveBeenCalledExactlyOnceWith(5, { effort: null });
  });
});
