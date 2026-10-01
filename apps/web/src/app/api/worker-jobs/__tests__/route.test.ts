import { afterEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn(async (): Promise<{ orgId: number } | undefined> => ({ orgId: 1 }));
vi.mock("@/server/auth", () => ({ requireAuthContext: () => requireAuthContextMock() }));
const listWorkerJobOutcomesMock = vi.fn();
vi.mock("@agentfactory/db", () => ({
  listWorkerJobOutcomes: (...args: unknown[]) => listWorkerJobOutcomesMock(...args),
}));

const { GET } = await import("../route");

function get(query = ""): Request {
  return new Request(`http://localhost/api/worker-jobs${query}`);
}

afterEach(() => {
  vi.clearAllMocks();
  requireAuthContextMock.mockResolvedValue({ orgId: 1 });
});

describe("GET /api/worker-jobs", () => {
  it("lists the caller's org outcomes", async () => {
    listWorkerJobOutcomesMock.mockResolvedValue([{ id: 1, jobType: "repo_map_warm" }]);

    const res = await GET(get());

    expect(listWorkerJobOutcomesMock).toHaveBeenCalledWith(1, { jobType: undefined, status: undefined, limit: undefined });
    await expect(res.json()).resolves.toEqual([{ id: 1, jobType: "repo_map_warm" }]);
  });

  it("passes filters through", async () => {
    listWorkerJobOutcomesMock.mockResolvedValue([]);

    await GET(get("?jobType=memory_retrospective&status=failed&limit=10"));

    expect(listWorkerJobOutcomesMock).toHaveBeenCalledWith(1, { jobType: "memory_retrospective", status: "failed", limit: 10 });
  });

  it.each(["?jobType=nope", "?status=nope", "?limit=abc"])("rejects %s with 400", async (query) => {
    expect((await GET(get(query))).status).toBe(400);
    expect(listWorkerJobOutcomesMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    requireAuthContextMock.mockResolvedValue(undefined);
    expect((await GET(get())).status).toBe(401);
  });
});
