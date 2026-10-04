import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Docker from "dockerode";
import { createLogger } from "@agentfactory/logger";

const log = createLogger("sandbox-image-check");

export const SANDBOX_SOURCE_HASH_LABEL = "kumiwork.sandbox.source-hash";
export const SANDBOX_IMAGE_SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sandbox-image");

export type SandboxImageStatus = "current" | "stale" | "unlabeled" | "missing";

export interface SandboxImageReport {
  image: string;
  status: SandboxImageStatus;
  imageHash?: string;
}

export type SandboxImageCheckMode = "warn" | "enforce" | "off";

async function listFiles(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === "node_modules" && dir === "." ? [] : listFiles(root, relative);
      return entry.isFile() ? [relative] : [];
    }),
  );
  return nested.flat();
}

export async function computeSandboxSourceHash(root: string = SANDBOX_IMAGE_SOURCE_DIR): Promise<string> {
  const files = (await listFiles(root, ".")).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const lines = await Promise.all(
    files.map(async (file) => {
      const digest = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
      return `${digest}  ${file}\n`;
    }),
  );
  return createHash("sha256").update(lines.join("")).digest("hex");
}

export function classifySandboxImage(labelValue: string | undefined, currentHash: string): SandboxImageStatus {
  if (!labelValue || labelValue === "unknown") return "unlabeled";
  return labelValue === currentHash ? "current" : "stale";
}

export type InspectImageLabels = (image: string) => Promise<Record<string, string> | undefined>;

const dockerInspectLabels: InspectImageLabels = async (image) => {
  try {
    const info = await new Docker().getImage(image).inspect();
    return info.Config?.Labels ?? {};
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) return undefined;
    throw err;
  }
};

export async function checkSandboxImages(
  images: readonly string[],
  currentHash: string,
  inspectLabels: InspectImageLabels = dockerInspectLabels,
): Promise<SandboxImageReport[]> {
  return Promise.all(
    [...new Set(images)].map(async (image): Promise<SandboxImageReport> => {
      const labels = await inspectLabels(image);
      if (!labels) return { image, status: "missing" };
      const imageHash = labels[SANDBOX_SOURCE_HASH_LABEL];
      return { image, status: classifySandboxImage(imageHash, currentHash), imageHash };
    }),
  );
}

export function resolveSandboxImageCheckMode(value: string | undefined): SandboxImageCheckMode {
  return value === "enforce" || value === "off" ? value : "warn";
}

export function findProblemImages(reports: readonly SandboxImageReport[]): SandboxImageReport[] {
  return reports.filter((report) => report.status !== "current");
}

export async function runSandboxImageCheck(
  mode: SandboxImageCheckMode,
  images: readonly string[],
): Promise<SandboxImageReport[]> {
  if (mode === "off") return [];
  let reports: SandboxImageReport[];
  let currentHash: string;
  try {
    currentHash = await computeSandboxSourceHash();
    reports = await checkSandboxImages(images, currentHash);
  } catch (err) {
    log.warn("Could not check sandbox images against the current source", { err });
    return [];
  }
  for (const report of reports) {
    if (report.status === "current") continue;
    const rebuild = "Rebuild with scripts/build-sandbox-images.sh.";
    if (report.status === "stale") {
      log.error(`Sandbox image ${report.image} was built from older sandbox-image/ source and is running stale code. ${rebuild}`, {
        imageHash: report.imageHash,
        currentHash,
      });
    } else if (report.status === "unlabeled") {
      log.error(`Sandbox image ${report.image} has no source hash label, so it cannot be checked and may be stale. ${rebuild}`, {
        currentHash,
      });
    } else {
      log.warn(`Sandbox image ${report.image} is not present locally. ${rebuild}`);
    }
  }
  return reports;
}
