import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../ContentViewer.module.css"), "utf-8");

describe("ContentViewer.module.css", () => {
  it("declares hljs token rules through :global so highlight.js classes stay unhashed", () => {
    const hljsSelectors = [
      ".hljs-keyword",
      ".hljs-string",
      ".hljs-number",
      ".hljs-comment",
      ".hljs-title",
      ".hljs-attr",
      ".hljs-deletion",
      ".hljs-addition",
    ];

    for (const selector of hljsSelectors) {
      expect(css).toContain(`:global(${selector})`);
    }

    expect(css).not.toMatch(/(?<!:global\()\.hljs-[a-z_-]+/);
  });

  it("restores list markers for markdown lists, including nested lists", () => {
    expect(css).toMatch(/\.markdown ul\s*{[^}]*list-style-type:\s*disc/);
    expect(css).toMatch(/\.markdown ol\s*{[^}]*list-style-type:\s*decimal/);
    expect(css).toMatch(/\.markdown ul ul\s*{[^}]*list-style-type:\s*circle/);
  });
});
