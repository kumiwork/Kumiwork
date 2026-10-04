import type Docker from "dockerode";
import { describe, expect, it, vi } from "vitest";
import {
  reapDependencyCaches,
  selectCacheVolumesToRemove,
  type CacheReapPolicy,
  type CacheVolumeInfo,
  type CacheVolumeStore,
} from "../dependency-cache-reap";
import { DockerCacheVolumeStore, toCacheVolumeInfo } from "../sandbox/docker-cache-volumes";
import { LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX } from "../sandbox-cache";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 23);
const GB = 1024 * 1024 * 1024;

function volume(name: string, overrides: Partial<CacheVolumeInfo> = {}): CacheVolumeInfo {
  return { name, createdAt: new Date(NOW - DAY), inUse: false, sizeBytes: GB, ...overrides };
}

const policy: CacheReapPolicy = {
  orgExists: (orgId) => orgId !== 9,
  now: NOW,
  maxAgeMs: 14 * DAY,
  maxSizeBytes: 10 * GB,
};

describe("selectCacheVolumesToRemove", () => {
  it("keeps a fresh, small, per-repo cache for a live org", () => {
    expect(selectCacheVolumesToRemove([volume("kumiwork-deps-cache-org-1-acme-widgets-abcdef012345")], policy)).toEqual([]);
  });

  it.each([
    ["org_deleted", volume("kumiwork-deps-cache-org-9-acme-widgets-abcdef012345")],
    ["legacy_org_wide", volume("kumiwork-deps-cache-org-1")],
    ["expired", volume("kumiwork-deps-cache-org-1-acme-widgets-abcdef012345", { createdAt: new Date(NOW - 15 * DAY) })],
    ["oversized", volume("kumiwork-deps-cache-org-1-acme-widgets-abcdef012345", { sizeBytes: 11 * GB })],
  ])("removes a cache that is %s", (reason, candidate) => {
    expect(selectCacheVolumesToRemove([candidate], policy)).toEqual([{ name: candidate.name, reason }]);
  });

  it("never touches a volume a container is using, whatever else is true of it", () => {
    const inUse = volume("kumiwork-deps-cache-org-9", { inUse: true, createdAt: new Date(0), sizeBytes: 100 * GB });
    expect(selectCacheVolumesToRemove([inUse], policy)).toEqual([]);
  });

  it("ignores volumes that are not dependency caches", () => {
    const others = [volume("main_postgres-data"), volume("kumiwork-deps-cache-org-x"), volume("kumiwork-deps-cache-org-")];
    expect(selectCacheVolumesToRemove(others, policy)).toEqual([]);
  });

  it("keeps a cache whose size Docker has not computed", () => {
    const unknownSize = volume("kumiwork-deps-cache-org-1-acme-widgets-abcdef012345", { sizeBytes: undefined });
    expect(selectCacheVolumesToRemove([unknownSize], policy)).toEqual([]);
  });
});

describe("selectCacheVolumesToRemove legacy prefix", () => {
  it("removes unused volumes left under the legacy prefix, whatever their age", () => {
    const legacyUnused = `${LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX}1-acme-widgets-abcdef012345`;
    const legacyInUse = `${LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX}1-acme-gadgets-abcdef012345`;
    const removals = selectCacheVolumesToRemove(
      [volume(legacyUnused), volume(legacyInUse, { inUse: true }), volume("kumiwork-deps-cache-org-1-acme-widgets-abcdef012345")],
      policy,
    );
    expect(removals).toEqual([{ name: legacyUnused, reason: "legacy_prefix" }]);
  });
});

describe("reapDependencyCaches", () => {
  function store(volumes: CacheVolumeInfo[], failOn?: string) {
    const removed: string[] = [];
    const cacheStore: CacheVolumeStore = {
      list: async () => volumes,
      remove: async (name) => {
        if (name === failOn) throw new Error("volume is in use");
        removed.push(name);
      },
    };
    return { cacheStore, removed };
  }

  it("removes what the policy selects, looking each org up once", async () => {
    const { cacheStore, removed } = store([
      volume("kumiwork-deps-cache-org-9-a-111111111111"),
      volume("kumiwork-deps-cache-org-9-b-222222222222"),
      volume("kumiwork-deps-cache-org-1-c-333333333333"),
    ]);
    const orgExists = vi.fn(async (orgId: number) => orgId !== 9);

    const result = await reapDependencyCaches({ store: cacheStore, orgExists, now: NOW });

    expect(removed).toEqual(["kumiwork-deps-cache-org-9-a-111111111111", "kumiwork-deps-cache-org-9-b-222222222222"]);
    expect(result.map((r) => r.reason)).toEqual(["org_deleted", "org_deleted"]);
    expect(orgExists).toHaveBeenCalledTimes(2);
  });

  it("carries on when Docker refuses to remove one volume", async () => {
    const { cacheStore, removed } = store(
      [volume("kumiwork-deps-cache-org-1"), volume("kumiwork-deps-cache-org-2")],
      "kumiwork-deps-cache-org-1",
    );

    const result = await reapDependencyCaches({ store: cacheStore, orgExists: async () => true, now: NOW });

    expect(removed).toEqual(["kumiwork-deps-cache-org-2"]);
    expect(result).toEqual([{ name: "kumiwork-deps-cache-org-2", reason: "legacy_org_wide" }]);
  });
});

describe("toCacheVolumeInfo", () => {
  it("reads Docker's disk-usage entry, treating an uncomputed size as unknown", () => {
    expect(
      toCacheVolumeInfo({
        Name: "kumiwork-deps-cache-org-1",
        CreatedAt: "2026-09-20T10:00:00Z",
        UsageData: { Size: -1, RefCount: 0 },
      }),
    ).toEqual({ name: "kumiwork-deps-cache-org-1", createdAt: new Date("2026-09-20T10:00:00Z"), inUse: false, sizeBytes: undefined });
    expect(toCacheVolumeInfo({ Name: "v", UsageData: { Size: 5, RefCount: 2 } })).toMatchObject({ inUse: true, sizeBytes: 5 });
  });
});

describe("DockerCacheVolumeStore", () => {
  it("lists current and legacy-prefixed cache volumes only", async () => {
    const legacyName = `${LEGACY_DEPENDENCY_CACHE_VOLUME_PREFIX}1-a-111111111111`;
    const docker = {
      df: async () => ({
        Volumes: [{ Name: "kumiwork-deps-cache-org-1-a-111111111111" }, { Name: legacyName }, { Name: "main_postgres-data" }],
      }),
    } as unknown as Docker;
    const names = (await new DockerCacheVolumeStore(docker).list()).map((volume) => volume.name);
    expect(names).toEqual(["kumiwork-deps-cache-org-1-a-111111111111", legacyName]);
  });
});
