// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../lib/i18n/context";
import { EditablePreview } from "../EditablePreview";

function Harness({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("# Heading\n\nSome draft text.");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <EditablePreview value={value} onChange={(event) => setValue(event.target.value)} rows={4} />
      <button type="submit">Submit</button>
    </form>
  );
}

function renderHarness(onSubmit: (value: string) => void = vi.fn()) {
  return render(
    <I18nProvider>
      <Harness onSubmit={onSubmit} />
    </I18nProvider>,
  );
}

describe("EditablePreview", () => {
  it("shows a textarea with the draft value in edit mode by default", () => {
    renderHarness();

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Heading\n\nSome draft text.");
  });

  it("switching to Preview renders the draft as Markdown without losing the textarea's content", async () => {
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Heading" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Heading\n\nSome draft text.");
  });

  it("keeps typed edits after toggling to Preview and back", async () => {
    renderHarness();

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Heading\n\nEdited text." } });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Edited text.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("# Heading\n\nEdited text.");
  });

  it("submits the current raw text whether the form is submitted from Edit or Preview mode", () => {
    const onSubmit = vi.fn();
    renderHarness(onSubmit);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Heading\n\nFinal text." } });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledWith("# Heading\n\nFinal text.");
  });
});
