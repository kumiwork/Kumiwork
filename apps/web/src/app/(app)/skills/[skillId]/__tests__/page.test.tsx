// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill, SkillVersion } from "@agentfactory/core";
import { I18nProvider } from "@/lib/i18n/context";
import SkillDetailPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ skillId: "9" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const SKILL: Skill = {
  id: 9,
  orgId: 1,
  name: "PR Review",
  slug: "pr-review",
  description: "Reviews pull requests",
  source: "authored",
  currentVersionId: 42,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const PUBLISHED_VERSION: SkillVersion = {
  id: 42,
  skillId: 9,
  version: 1,
  name: "PR Review",
  description: "Reviews pull requests",
  bodySha256: "abc123",
  publishedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockApi({ currentVersionInstructions }: { currentVersionInstructions?: string }) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === "/api/skills/9") {
      return Promise.resolve({ skill: SKILL, versions: [PUBLISHED_VERSION], currentVersionInstructions });
    }
    if (path === "/api/skills/9/assignments") return Promise.resolve([]);
    if (path === "/api/agents") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <SkillDetailPage />
    </I18nProvider>,
  );
}

describe("SkillDetailPage instructions section", () => {
  beforeEach(() => apiFetchMock.mockReset());

  it("renders the instructions as markdown when currentVersionInstructions is present", async () => {
    mockApi({ currentVersionInstructions: "# Do the review\n\nCheck **tests**." });
    renderPage();

    expect(await screen.findByText("Instructions")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Do the review" })).toBeInTheDocument();
    expect(screen.getByText("tests")).toBeInTheDocument();
  });

  it("omits the instructions section when currentVersionInstructions is absent", async () => {
    mockApi({ currentVersionInstructions: undefined });
    renderPage();

    await waitFor(() => expect(screen.getByText("PR Review")).toBeInTheDocument());
    expect(screen.queryByText("Instructions")).not.toBeInTheDocument();
  });
});
