import { describe, expect, it } from "vitest";
import { resolveFormat } from "../resolve-format";

describe("resolveFormat", () => {
  it("honors an explicit markdown format regardless of filename", () => {
    expect(resolveFormat({ format: "markdown", filename: "notes.ts" })).toEqual({ format: "markdown" });
  });

  it("honors an explicit text format regardless of language", () => {
    expect(resolveFormat({ format: "text", language: "sql" })).toEqual({ format: "text" });
  });

  it("honors an explicit code format, using the given language", () => {
    expect(resolveFormat({ format: "code", language: "python" })).toEqual({ format: "code", language: "python" });
  });

  it("falls back to the filename's language when format is code but no language is given", () => {
    expect(resolveFormat({ format: "code", filename: "schema.sql" })).toEqual({ format: "code", language: "sql" });
  });

  it("uses an explicit language over the filename when format is auto", () => {
    expect(resolveFormat({ format: "auto", language: "yaml", filename: "config.json" })).toEqual({
      format: "code",
      language: "yaml",
    });
  });

  it("uses the language when no format is given at all", () => {
    expect(resolveFormat({ language: "go" })).toEqual({ format: "code", language: "go" });
  });

  it.each([
    ["README.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["guide.mdx", "markdown"],
  ])("resolves %s to markdown by extension", (filename, expected) => {
    expect(resolveFormat({ filename })).toEqual({ format: expected });
  });

  it.each([
    ["index.ts", "ts"],
    ["component.tsx", "tsx"],
    ["script.js", "js"],
    ["data.json", "json"],
    ["config.yaml", "yaml"],
    ["config.yml", "yaml"],
    ["setup.sh", "bash"],
    ["main.py", "python"],
    ["schema.sql", "sql"],
    ["styles.css", "css"],
    ["page.html", "html"],
    ["change.diff", "diff"],
    ["main.go", "go"],
    ["lib.rs", "rust"],
    ["Main.java", "java"],
    ["pyproject.toml", "toml"],
  ])("resolves %s to code with language %s", (filename, expected) => {
    expect(resolveFormat({ filename })).toEqual({ format: "code", language: expected });
  });

  it("resolves a bare Dockerfile by filename, not extension", () => {
    expect(resolveFormat({ filename: "Dockerfile" })).toEqual({ format: "code", language: "dockerfile" });
  });

  it("is case-insensitive about the filename", () => {
    expect(resolveFormat({ filename: "SCHEMA.SQL" })).toEqual({ format: "code", language: "sql" });
  });

  it("falls back to text for an unknown extension", () => {
    expect(resolveFormat({ filename: "notes.xyz" })).toEqual({ format: "text" });
  });

  it("falls back to text for a filename with no extension", () => {
    expect(resolveFormat({ filename: "LICENSE" })).toEqual({ format: "text" });
  });

  it("falls back to text when nothing is given", () => {
    expect(resolveFormat({})).toEqual({ format: "text" });
  });
});
