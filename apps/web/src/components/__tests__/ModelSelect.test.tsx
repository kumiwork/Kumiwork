// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "@agentfactory/core";
import { I18nProvider } from "../../lib/i18n/context";
import { ModelSelect } from "../ModelSelect";

function renderSelect(value = "claude-sonnet-5") {
  const onChange = vi.fn();
  const { container } = render(
    <I18nProvider>
      <ModelSelect value={value} onChange={onChange} />
    </I18nProvider>,
  );
  return { onChange, container };
}

describe("ModelSelect", () => {
  it("offers every catalog model", () => {
    renderSelect();
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(
      MODEL_CATALOG.map((entry) => entry.id),
    );
  });

  it("shows a flat list while every model has the same provider", () => {
    const { container } = renderSelect();
    expect(container.querySelectorAll("optgroup")).toHaveLength(0);
  });

  it("reports the chosen model id", () => {
    const { onChange } = renderSelect();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "claude-opus-5" } });
    expect(onChange).toHaveBeenCalledWith("claude-opus-5");
  });
});
