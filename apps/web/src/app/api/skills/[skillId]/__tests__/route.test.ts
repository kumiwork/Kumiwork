import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
vi.mock("@/server/auth", () => ({ requireAuthContext: () => requireAuthContextMock() }));

const getSkillForOrgMock = vi.fn();
const getSkillVersionsForSkillMock = vi.fn();
const getSkillVersionMock = vi.fn();
const getSkillVersionMarkdownMock = vi.fn();
const deleteSkillForOrgMock = vi.fn();

vi.mock("@kumiwork/db", () => ({
  getSkillForOrg: (id: number, orgId: number) => getSkillForOrgMock(id, orgId),
  getSkillVersionsForSkill: (skillId: number) => getSkillVersionsForSkillMock(skillId),
  getSkillVersion: (id: number) => getSkillVersionMock(id),
  getSkillVersionMarkdown: (orgId: number, version: unknown) => getSkillVersionMarkdownMock(orgId, version),
  deleteSkillForOrg: (id: number, orgId: number) => deleteSkillForOrgMock(id, orgId),
  decomposeSkillMarkdown: (markdown: string) => {
    const match = markdown.match(/^---\nname: (.*)\ndescription: (.*)\n---\n\n([\s\S]*)$/);
    if (!match) throw new Error("Malformed skill markdown: expected name/description frontmatter");
    const [, name, description, instructions] = match;
    return { name, description, instructions };
  },
}));

const { GET } = await import("../route");

function fakeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    orgId: 1,
    name: "PR Review",
    slug: "pr-review",
    description: "Reviews pull requests",
    source: "authored" as const,
    currentVersionId: 42,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeVersion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 42,
    skillId: 7,
    version: 1,
    name: "PR Review",
    description: "Reviews pull requests",
    bodySha256: "abc123",
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("GET /api/skills/[skillId]", () => {
  beforeEach(() => {
    requireAuthContextMock.mockReset();
    getSkillForOrgMock.mockReset();
    getSkillVersionsForSkillMock.mockReset();
    getSkillVersionMock.mockReset();
    getSkillVersionMarkdownMock.mockReset();
    deleteSkillForOrgMock.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    requireAuthContextMock.mockResolvedValue(undefined);
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ skillId: "7" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the skill doesn't exist or belongs to another org", async () => {
    requireAuthContextMock.mockResolvedValue({ orgId: 1, user: { id: 1 } });
    getSkillForOrgMock.mockResolvedValue(undefined);
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ skillId: "7" }) });
    expect(res.status).toBe(404);
  });

  it("returns currentVersionInstructions for a published skill", async () => {
    requireAuthContextMock.mockResolvedValue({ orgId: 1, user: { id: 1 } });
    const skill = fakeSkill();
    const version = fakeVersion();
    getSkillForOrgMock.mockResolvedValue(skill);
    getSkillVersionsForSkillMock.mockResolvedValue([version]);
    getSkillVersionMock.mockResolvedValue(version);
    getSkillVersionMarkdownMock.mockResolvedValue("---\nname: PR Review\ndescription: Reviews pull requests\n---\n\nDo the review.");

    const res = await GET(new Request("http://x"), { params: Promise.resolve({ skillId: "7" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skill).toEqual(skill);
    expect(body.versions).toEqual([version]);
    expect(body.currentVersionInstructions).toBe("Do the review.");
  });

  it("omits currentVersionInstructions for a draft-only skill", async () => {
    requireAuthContextMock.mockResolvedValue({ orgId: 1, user: { id: 1 } });
    const skill = fakeSkill({ currentVersionId: undefined });
    const draft = fakeVersion({ publishedAt: undefined });
    getSkillForOrgMock.mockResolvedValue(skill);
    getSkillVersionsForSkillMock.mockResolvedValue([draft]);

    const res = await GET(new Request("http://x"), { params: Promise.resolve({ skillId: "7" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions).toEqual([draft]);
    expect(body.currentVersionInstructions).toBeUndefined();
    expect(getSkillVersionMock).not.toHaveBeenCalled();
  });

  it("still returns 200 with skill and versions when the markdown read throws", async () => {
    requireAuthContextMock.mockResolvedValue({ orgId: 1, user: { id: 1 } });
    const skill = fakeSkill();
    const version = fakeVersion();
    getSkillForOrgMock.mockResolvedValue(skill);
    getSkillVersionsForSkillMock.mockResolvedValue([version]);
    getSkillVersionMock.mockResolvedValue(version);
    getSkillVersionMarkdownMock.mockRejectedValue(new Error("blob missing"));

    const res = await GET(new Request("http://x"), { params: Promise.resolve({ skillId: "7" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skill).toEqual(skill);
    expect(body.versions).toEqual([version]);
    expect(body.currentVersionInstructions).toBeUndefined();
  });
});
