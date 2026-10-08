// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LatticeSpinner } from "../LatticeSpinner";

describe("LatticeSpinner", () => {
  it("exposes its label as a status", () => {
    render(<LatticeSpinner label="Loading" />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("injects its stylesheet once no matter how many spinners render", () => {
    render(
      <>
        <LatticeSpinner />
        <LatticeSpinner />
        <LatticeSpinner />
      </>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(3);
    const spinnerStyles = [...document.querySelectorAll("style")].filter((style) =>
      style.textContent?.includes("@keyframes kwLatticeFrame"),
    );
    expect(spinnerStyles).toHaveLength(1);
  });
});
