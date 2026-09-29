// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n/context";
import { ContentViewer } from "@/components/content-viewer/ContentViewer";
import { MessageContent, TaskDescription } from "../page";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("Task page read-only surfaces", () => {
  it("renders a README.md file formatted as markdown", () => {
    const content = "# Read me\n\nSome **bold** prose.";
    renderWithI18n(<ContentViewer content={content} filename="README.md" />);

    expect(screen.getByRole("heading", { name: "Read me" })).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("highlights an index.ts file with line numbers", () => {
    const content = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
    const { container } = renderWithI18n(<ContentViewer content={content} filename="index.ts" />);

    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("highlights a schema.sql file as SQL with line numbers", () => {
    const content = "CREATE TABLE users (\n  id INT PRIMARY KEY\n);\n";
    const { container } = renderWithI18n(<ContentViewer content={content} filename="schema.sql" />);

    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    expect(screen.getByText("SQL")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders an assistant message with a table as formatted markdown", () => {
    const content = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    renderWithI18n(<MessageContent content={content} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders a user message with a sql fence highlighted", () => {
    const content = ["Here you go:", "", "```sql", "SELECT * FROM users;", "```"].join("\n");
    const { container } = renderWithI18n(<MessageContent content={content} />);

    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    expect(screen.getByText("SQL")).toBeInTheDocument();
  });

  it("does not break on a streaming reply with an unterminated fence", () => {
    const content = ["Partial reply:", "", "```ts", "const a = 1;"].join("\n");
    const { container } = renderWithI18n(<MessageContent content={content} />);

    expect(screen.getByText(/Partial reply/)).toBeInTheDocument();
    expect(container.textContent).toContain("const a = 1;");
  });

  it("renders the task description as markdown", () => {
    renderWithI18n(<TaskDescription description={"- one\n- two"} />);

    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });

  it("falls back to an em dash for an empty description", () => {
    renderWithI18n(<TaskDescription description={""} />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
