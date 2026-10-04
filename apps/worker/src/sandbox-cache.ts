import { createHash } from "node:crypto";
import type { SandboxVolume } from "./sandbox/types";

export const DEPENDENCY_CACHE_DIR = "/cache";
export const DEPENDENCY_CACHE_VOLUME_PREFIX = "kumiwork-deps-cache-org-";
export const LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX = "arata-deps-cache-org-";
const REPO_SLUG_MAX_CHARS = 40;

export function dependencyCacheVolume(orgId: number, repoFullName: string): SandboxVolume {
  const normalized = repoFullName.toLowerCase();
  const slug = normalized.replace(/[^a-z0-9_.-]+/g, "-").slice(0, REPO_SLUG_MAX_CHARS);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return { name: `${DEPENDENCY_CACHE_VOLUME_PREFIX}${orgId}-${slug}-${hash}`, target: DEPENDENCY_CACHE_DIR };
}

export interface ParsedCacheVolumeName {
  orgId: number;
  perRepo: boolean;
  legacyPrefix: boolean;
}

function cacheVolumePrefixOf(name: string): string | undefined {
  return [DEPENDENCY_CACHE_VOLUME_PREFIX, LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX].find((prefix) => name.startsWith(prefix));
}

export function isDependencyCacheVolumeName(name: string): boolean {
  return cacheVolumePrefixOf(name) !== undefined;
}

export function parseDependencyCacheVolumeName(name: string): ParsedCacheVolumeName | undefined {
  const prefix = cacheVolumePrefixOf(name);
  if (!prefix) return undefined;
  const match = /^(\d+)(-.+)?$/.exec(name.slice(prefix.length));
  if (!match) return undefined;
  return { orgId: Number(match[1]), perRepo: Boolean(match[2]), legacyPrefix: prefix === LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX };
}

export function dependencyCacheEnv(): Record<string, string> {
  const dir = DEPENDENCY_CACHE_DIR;
  return {
    XDG_DATA_HOME: `${dir}/xdg-data`,
    XDG_CACHE_HOME: `${dir}/xdg-cache`,
    npm_config_cache: `${dir}/npm`,
    // pnpm ignores npm_config_cache for its package store — it only reads its own
    // pnpm_config_store_dir (or a `store-dir` in .npmrc). Without this, pnpm defaults to
    // <repo>/.pnpm-store, which lives on the container's ephemeral filesystem rather than this
    // cache volume, so every run reinstalled its whole store from network cold.
    pnpm_config_store_dir: `${dir}/pnpm-store`,
    YARN_CACHE_FOLDER: `${dir}/yarn`,
    YARN_GLOBAL_FOLDER: `${dir}/yarn-berry`,
    PIP_CACHE_DIR: `${dir}/pip`,
    UV_CACHE_DIR: `${dir}/uv`,
    UV_LINK_MODE: "copy",
    POETRY_CACHE_DIR: `${dir}/poetry`,
    MAVEN_OPTS: `-Dmaven.repo.local=${dir}/m2/repository`,
    GRADLE_USER_HOME: `${dir}/gradle`,
  };
}
