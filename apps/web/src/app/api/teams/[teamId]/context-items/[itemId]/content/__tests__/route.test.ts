import { beforeEach, describe, expect, it, vi } from "vitest";

const getTeamContextItemForOrgMock = vi.fn();
vi.mock("@kumiwork/db", () => ({
  getTeamContextItemForOrg: (...args: unknown[]) => getTeamContextItemForOrgMock(...args),
}));
const getBlobMock = vi.fn();
vi.mock("@kumiwork/storage", () => ({
  createBlobStore: () => ({ put: vi.fn(), get: (...args: unknown[]) => getBlobMock(...args) }),
}));
const requireAuthContextMock = vi.fn();
vi.mock("@/server/auth", () => ({
  requireAuthContext: (...args: unknown[]) => requireAuthContextMock(...args),
}));

import { GET } from "../route";

function params(itemId = "9") {
  return { params: Promise.resolve({ teamId: "1", itemId }) };
}

const ITEM = {
  id: 9,
  teamId: 1,
  orgId: 1,
  title: "handbook.md",
  sizeBytes: 9,
  sha256: "a".repeat(64),
  mime: "text/markdown",
  source: "upload",
  status: "indexed",
  createdAt: "2026-09-01T10:00:00.000Z",
};

beforeEach(() => {
  getTeamContextItemForOrgMock.mockReset();
  getBlobMock.mockReset();
  requireAuthContextMock.mockReset();
  requireAuthContextMock.mockResolvedValue({ user: { id: 5 }, orgId: 1 });
});

describe("GET /api/teams/[teamId]/context-items/[itemId]/content", () => {
  it("streams the blob's bytes with the item's mime as Content-Type", async () => {
    getTeamContextItemForOrgMock.mockResolvedValue(ITEM);
    const bytes = new TextEncoder().encode("# Handbook");
    getBlobMock.mockResolvedValue(bytes);

    const res = await GET(new Request("http://localhost/api/teams/1/context-items/9/content"), params());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(getTeamContextItemForOrgMock).toHaveBeenCalledWith(9, 1);
    expect(getBlobMock).toHaveBeenCalledWith(1, "a".repeat(64));
  });

  it("answers 404 when the item doesn't exist or belongs to another org", async () => {
    getTeamContextItemForOrgMock.mockResolvedValue(undefined);

    const res = await GET(new Request("http://localhost/api/teams/1/context-items/9/content"), params());

    expect(res.status).toBe(404);
    expect(getBlobMock).not.toHaveBeenCalled();
  });

  it("answers 404 when the item exists but its blob is missing", async () => {
    getTeamContextItemForOrgMock.mockResolvedValue(ITEM);
    getBlobMock.mockResolvedValue(undefined);

    const res = await GET(new Request("http://localhost/api/teams/1/context-items/9/content"), params());

    expect(res.status).toBe(404);
  });

  it("answers 401 without touching the db or blob store when unauthorized", async () => {
    requireAuthContextMock.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/teams/1/context-items/9/content"), params());

    expect(res.status).toBe(401);
    expect(getTeamContextItemForOrgMock).not.toHaveBeenCalled();
    expect(getBlobMock).not.toHaveBeenCalled();
  });
});
