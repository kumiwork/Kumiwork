// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n/context";
import { SharedContextPanels } from "../SharedContextPanels";
import type { SharedContextData } from "@/lib/shared-context";

const DATA: SharedContextData = {
  categories: [
    {
      id: "general",
      label: "General",
      type: "text",
      entries: [{ text: "## Mission\n\nShip agents that ship code." }],
    },
  ],
};

function renderPanels(data: SharedContextData = DATA) {
  return render(
    <I18nProvider>
      <SharedContextPanels data={data} usedBytes={40} maxBytes={65536} onSave={vi.fn()} />
    </I18nProvider>,
  );
}

describe("SharedContextPanels", () => {
  it("opens a text category showing the raw draft in the Edit tab by default", async () => {
    renderPanels();
    fireEvent.click(screen.getByText("General"));

    expect(screen.getByRole("textbox")).toHaveValue("## Mission\n\nShip agents that ship code.");
  });

  it("renders the draft as Markdown when switched to the Preview tab", async () => {
    renderPanels();
    fireEvent.click(screen.getByText("General"));

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByRole("heading", { name: "Mission" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps edits made before switching back from Preview", async () => {
    renderPanels();
    fireEvent.click(screen.getByText("General"));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Updated mission text" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Updated mission text")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toHaveValue("Updated mission text");
  });
});
