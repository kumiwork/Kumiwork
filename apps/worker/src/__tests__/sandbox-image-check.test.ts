import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dockerode", () => ({ default: class {} }));

const {
  SANDBOX_IMAGE_SOURCE_DIR,
  SANDBOX_SOURCE_HASH_LABEL,
  checkSandboxImages,
  classifySandboxImage,
  computeSandboxSourceHash,
  findProblemImages,
  resolveSandboxImageCheckMode,
} = await import("../sandbox-image-check");

const tempDirs: string[] = [];

function tempSourceDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sandbox-hash-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("computeSandboxSourceHash", () => {
  it("changes when a file's content changes", async () => {
    const a = await computeSandboxSourceHash(tempSourceDir({ "run-turn.ts": "one", "Dockerfile": "FROM x" }));
    const b = await computeSandboxSourceHash(tempSourceDir({ "run-turn.ts": "two", "Dockerfile": "FROM x" }));
    expect(a).not.toBe(b);
  });

  it("is stable across directories with the same contents and ignores top-level node_modules", async () => {
    const a = await computeSandboxSourceHash(tempSourceDir({ "a.ts": "x", "b/c.ts": "y" }));
    const b = await computeSandboxSourceHash(tempSourceDir({ "a.ts": "x", "b/c.ts": "y", "node_modules/pkg/index.js": "z" }));
    expect(a).toBe(b);
  });

  it("matches scripts/sandbox-image-hash.sh, which is what stamps the image label", async () => {
    const script = path.resolve(SANDBOX_IMAGE_SOURCE_DIR, "../../../scripts/sandbox-image-hash.sh");
    const fromScript = execFileSync(script, { encoding: "utf8" }).trim();
    await expect(computeSandboxSourceHash()).resolves.toBe(fromScript);
  });
});

describe("classifySandboxImage", () => {
  it.each([
    ["abc", "abc", "current"],
    ["old", "abc", "stale"],
    [undefined, "abc", "unlabeled"],
    ["unknown", "abc", "unlabeled"],
  ] as const)("label %s against %s is %s", (label, current, expected) => {
    expect(classifySandboxImage(label, current)).toBe(expected);
  });
});

describe("checkSandboxImages", () => {
  it("reports each distinct image's status from its hash label", async () => {
    const labels: Record<string, Record<string, string> | undefined> = {
      "img-current": { [SANDBOX_SOURCE_HASH_LABEL]: "abc" },
      "img-stale": { [SANDBOX_SOURCE_HASH_LABEL]: "old" },
      "img-bare": {},
      "img-gone": undefined,
    };
    const inspect = vi.fn(async (image: string) => labels[image]);

    const reports = await checkSandboxImages(["img-current", "img-stale", "img-bare", "img-gone", "img-current"], "abc", inspect);

    expect(inspect).toHaveBeenCalledTimes(4);
    expect(reports.map((r) => [r.image, r.status])).toEqual([
      ["img-current", "current"],
      ["img-stale", "stale"],
      ["img-bare", "unlabeled"],
      ["img-gone", "missing"],
    ]);
    expect(findProblemImages(reports).map((r) => r.image)).toEqual(["img-stale", "img-bare", "img-gone"]);
  });
});

describe("resolveSandboxImageCheckMode", () => {
  it.each([
    [undefined, "warn"],
    ["enforce", "enforce"],
    ["off", "off"],
    ["nonsense", "warn"],
  ] as const)("%s resolves to %s", (value, expected) => {
    expect(resolveSandboxImageCheckMode(value)).toBe(expected);
  });
});
