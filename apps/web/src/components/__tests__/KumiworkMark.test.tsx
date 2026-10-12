// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KumiworkMark } from "@kumiwork/shared";

const FAVICON_PATH = join(__dirname, "../../app/icon.svg");

describe("KumiworkMark", () => {
  it("draws the same pieces as the favicon", () => {
    const { container } = render(<KumiworkMark />);
    const markPoints = Array.from(container.querySelectorAll("polygon"), (polygon) => polygon.getAttribute("points"));
    const faviconPoints = Array.from(readFileSync(FAVICON_PATH, "utf8").matchAll(/points="([^"]+)"/g), (match) => match[1]);
    expect(markPoints).toEqual(faviconPoints);
  });

  it("stays out of the accessibility tree because the wordmark text names the brand", () => {
    const { container } = render(<KumiworkMark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
