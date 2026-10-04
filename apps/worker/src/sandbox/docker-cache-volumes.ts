import Docker from "dockerode";
import type { CacheVolumeInfo, CacheVolumeStore } from "../dependency-cache-reap";
import { isDependencyCacheVolumeName } from "../sandbox-cache";

interface DockerDiskUsageVolume {
  Name: string;
  CreatedAt?: string;
  UsageData?: { Size?: number; RefCount?: number };
}

export function toCacheVolumeInfo(volume: DockerDiskUsageVolume): CacheVolumeInfo {
  const size = volume.UsageData?.Size;
  return {
    name: volume.Name,
    createdAt: new Date(volume.CreatedAt ?? 0),
    inUse: (volume.UsageData?.RefCount ?? 0) !== 0,
    sizeBytes: typeof size === "number" && size >= 0 ? size : undefined,
  };
}

export class DockerCacheVolumeStore implements CacheVolumeStore {
  constructor(private readonly docker: Docker = new Docker()) {}

  async list(): Promise<CacheVolumeInfo[]> {
    const usage = (await this.docker.df()) as { Volumes?: DockerDiskUsageVolume[] | null };
    return (usage.Volumes ?? [])
      .filter((volume) => isDependencyCacheVolumeName(volume.Name))
      .map(toCacheVolumeInfo);
  }

  async remove(name: string): Promise<void> {
    await this.docker.getVolume(name).remove();
  }
}
