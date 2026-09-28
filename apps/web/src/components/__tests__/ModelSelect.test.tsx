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

  it("groups the models under their provider", () => {
    const { container } = renderSelect();
    const groups = [...container.querySelectorAll("optgroup")].map((group) => ({
      label: group.getAttribute("label"),
      models: [...group.querySelectorAll("option")].map((option) => option.textContent),
    }));
    expect(groups).toEqual([
      { label: "Anthropic", models: ["Claude Haiku 4.5", "Claude Sonnet 5", "Claude Opus 5", "Claude Fable 5"] },
      { label: "OpenAI", models: ["GPT-6 Luna", "GPT-6 Sol"] },
    ]);
  });

  it("reports the chosen model id", () => {
    const { onChange } = renderSelect();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "gpt-6-sol" } });
    expect(onChange).toHaveBeenCalledWith("gpt-6-sol");
  });
});
