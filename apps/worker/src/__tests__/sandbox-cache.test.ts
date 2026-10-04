import { describe, expect, it } from "vitest";
import {
  DEPENDENCY_CACHE_DIR,
  dependencyCacheEnv,
  dependencyCacheVolume,
  isDependencyCacheVolumeName,
  LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX,
  parseDependencyCacheVolumeName,
} from "../sandbox-cache";

describe("dependencyCacheVolume", () => {
  it("scopes the volume to one repo within one org", () => {
    const volume = dependencyCacheVolume(7, "Acme/Widgets");
    expect(volume.target).toBe("/cache");
    expect(volume.name).toMatch(/^kumiwork-deps-cache-org-7-acme-widgets-[0-9a-f]{12}$/);
    expect(dependencyCacheVolume(7, "acme/widgets").name).toBe(volume.name);
    expect(dependencyCacheVolume(8, "acme/widgets").name).not.toBe(volume.name);
    expect(dependencyCacheVolume(7, "acme/gadgets").name).not.toBe(volume.name);
  });

  it("keeps repos distinct even when their slugs collide", () => {
    expect(dependencyCacheVolume(7, "acme/a+b").name).not.toBe(dependencyCacheVolume(7, "acme/a-b").name);
  });

  it("produces a valid Docker volume name for unusual repo names", () => {
    expect(dependencyCacheVolume(7, `acme/${"x".repeat(200)}`).name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/);
  });
});

describe("parseDependencyCacheVolumeName", () => {
  it("reads the org back from both volume name formats", () => {
    expect(parseDependencyCacheVolumeName(dependencyCacheVolume(7, "acme/widgets").name)).toEqual({
      orgId: 7,
      perRepo: true,
      legacyPrefix: false,
    });
    expect(parseDependencyCacheVolumeName("kumiwork-deps-cache-org-7")).toEqual({
      orgId: 7,
      perRepo: false,
      legacyPrefix: false,
    });
  });

  it("recognises volumes created under the legacy prefix", () => {
    const legacyName = `${LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX}7-acme-widgets-abcdef012345`;
    expect(parseDependencyCacheVolumeName(legacyName)).toEqual({ orgId: 7, perRepo: true, legacyPrefix: true });
  });

  it.each([
    "main_postgres-data",
    "kumiwork-deps-cache-org-",
    "kumiwork-deps-cache-org-x-acme",
    "prefix-kumiwork-deps-cache-org-7",
    `prefix-${LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX}7`,
  ])("does not claim %s", (name) => {
    expect(parseDependencyCacheVolumeName(name)).toBeUndefined();
  });
});

describe("isDependencyCacheVolumeName", () => {
  it.each([
    ["kumiwork-deps-cache-org-1-a-111111111111", true],
    [`${LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX}1-a-111111111111`, true],
    ["main_postgres-data", false],
  ])("%s → %s", (name, expected) => {
    expect(isDependencyCacheVolumeName(name)).toBe(expected);
  });
});

describe("dependencyCacheEnv", () => {
  it("points every supported package manager cache inside the mounted volume", () => {
    const env = dependencyCacheEnv();
    for (const key of [
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "npm_config_cache",
      "YARN_CACHE_FOLDER",
      "PIP_CACHE_DIR",
      "UV_CACHE_DIR",
      "POETRY_CACHE_DIR",
      "GRADLE_USER_HOME",
    ]) {
      expect(env[key]?.startsWith(`${DEPENDENCY_CACHE_DIR}/`)).toBe(true);
    }
    expect(env.MAVEN_OPTS).toBe(`-Dmaven.repo.local=${DEPENDENCY_CACHE_DIR}/m2/repository`);
  });
});
