// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { I18nProvider } from "../../../lib/i18n/context";
import { ContentViewer } from "../ContentViewer";

function renderViewer(props: Partial<React.ComponentProps<typeof ContentViewer>> & { content: string }) {
  return render(
    <I18nProvider>
      <ContentViewer {...props} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

describe("ContentViewer", () => {
  it("renders a heading, a GFM table, and a list from markdown", () => {
    const content = [
      "# Title",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "- one",
      "- two",
    ].join("\n");

    renderViewer({ content, format: "markdown" });

    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });

  it("highlights a fenced code block, including sql", () => {
    const content = ["```sql", "SELECT * FROM users;", "```"].join("\n");
    const { container } = renderViewer({ content, format: "markdown" });

    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    expect(screen.getByText("SQL")).toBeInTheDocument();
  });

  it("escapes raw HTML instead of interpreting it", () => {
    const content = "Before <script>alert(1)</script> after";
    const { container } = renderViewer({ content, format: "markdown" });

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("filters javascript: links, rendering them as plain text", () => {
    const content = "[click me](javascript:alert(1))";
    renderViewer({ content, format: "markdown" });

    expect(screen.queryByRole("link", { name: "click me" })).not.toBeInTheDocument();
    expect(screen.getByText("click me")).toBeInTheDocument();
  });

  it("renders http links as anchors with safe rel/target", () => {
    const content = "[click me](https://example.com)";
    renderViewer({ content, format: "markdown" });

    const link = screen.getByRole("link", { name: "click me" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("turns images into links carrying the alt text, never fetching them", () => {
    const content = "![a screenshot](https://example.com/shot.png)";
    renderViewer({ content, format: "markdown" });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "a screenshot" });
    expect(link).toHaveAttribute("href", "https://example.com/shot.png");
  });

  it("falls back to plain text for an unregistered fence language", () => {
    const content = ["```brainfuck", "++++++++[>++++[>++>+++>+++>+<<<<-]", "```"].join("\n");
    const { container } = renderViewer({ content, format: "markdown" });

    expect(container.querySelector(".hljs-keyword")).toBeNull();
    expect(container.textContent).toContain("++++++++[>++++[>++>+++>+++>+<<<<-]");
  });

  it("falls back to plain text for oversize content, without highlighting or parsing markdown", () => {
    const content = `# heading\n${"a".repeat(200_001)}`;
    const { container } = renderViewer({ content, format: "markdown" });

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText(/Large file, shown as plain text/)).toBeInTheDocument();
    expect(container.textContent).toContain("# heading");
  });

  it("copies a standalone code block's content via the clipboard", async () => {
    renderViewer({ content: "const a = 1;", format: "code", language: "ts" });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("const a = 1;"),
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("switches between rendered and raw markdown output", () => {
    const content = "# Heading\n\nSome text.";
    renderViewer({ content, format: "markdown", allowRawToggle: true });

    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));

    expect(screen.queryByRole("heading", { name: "Heading" })).not.toBeInTheDocument();
    expect(screen.getByText(/# Heading/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rendered" }));

    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
  });

  it("resolves format from the filename when no explicit format or language is given", () => {
    const { container } = renderViewer({ content: "SELECT 1;", filename: "schema.sql" });

    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    expect(screen.getByText("SQL")).toBeInTheDocument();
  });

  it("hides copy buttons when showCopy is false", () => {
    renderViewer({ content: "const a = 1;", format: "code", language: "ts", showCopy: false });

    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });
});
