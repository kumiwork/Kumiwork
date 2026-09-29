import { describe, expect, it } from "vitest";
import { isRepoMapFileCreationSummary } from "../repo-map-validate";

describe("isRepoMapFileCreationSummary", () => {
  it("rejects a summary naming a created CODEBASE_MAP.md file", () => {
    const text =
      "I've created **CODEBASE_MAP.md** at the repo root with a full overview of the directory " +
      "structure, entry points, and conventions a new contributor would need.";

    expect(isRepoMapFileCreationSummary(text)).toBe(true);
  });

  it("rejects a summary naming a created .claude/AGENT_MAP.md file", () => {
    const text =
      "Done! I've created **.claude/AGENT_MAP.md** with a comprehensive map covering the " +
      "monorepo layout, build commands, and testing conventions.";

    expect(isRepoMapFileCreationSummary(text)).toBe(true);
  });

  it("rejects a summary describing a saved REPOSITORY_MAP.md even without the exact phrase", () => {
    const text = "The repository map has been saved to REPOSITORY_MAP.md for future reference.";

    expect(isRepoMapFileCreationSummary(text)).toBe(true);
  });

  it("accepts a real repo map returned directly as the reply", () => {
    const text =
      "## Repository Map\n\n" +
      "### Structure\n" +
      "- `apps/web` — Next.js frontend and Route Handlers.\n" +
      "- `apps/worker` — BullMQ consumer running agents in Docker sandboxes.\n" +
      "- `packages/core` — shared domain types.\n\n" +
      "### Commands\n" +
      "`pnpm build`, `pnpm test`, `pnpm lint`.\n\n" +
      "### Conventions\n" +
      "Styling uses Tailwind; tests live under `src/__tests__`.";

    expect(isRepoMapFileCreationSummary(text)).toBe(false);
  });
});
