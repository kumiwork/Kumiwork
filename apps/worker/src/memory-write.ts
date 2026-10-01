import { MAX_MEMORY_CONTENT_CHARS, type MemorySource } from "@agentfactory/core";
import {
  findSimilarMemoryEntries,
  insertMemoryEntryWithWrite,
  reinforceMemoryEntryWithWrite,
  replaceMemoryEntryWithWrite,
} from "@agentfactory/db";
import { createLogger } from "@agentfactory/logger";
import { getEmbedder, type Embedder } from "./embedder";
import { adjudicateMemoryWrite, type Adjudication } from "./memory-adjudicator";
import { lessonTextProblem } from "./lesson-evidence";

const log = createLogger("memory-write");

// At or above this similarity an entry is treated as a duplicate on its own when the adjudicator
// is unavailable. A false-positive merge silently discards a distinct new lesson rather than
// merely missing a relevant excerpt, so the bar is much higher than document retrieval's 0.6.
export const MEMORY_SIMILARITY_FLOOR = 0.85;

// Entries this similar are shown to the adjudicator, which decides whether they are duplicates,
// contradictions, overlaps to merge, or unrelated. Embeddings cannot tell "use npm" from "use pnpm".
export const MEMORY_ADJUDICATION_FLOOR = 0.6;
export const MEMORY_ADJUDICATION_CANDIDATES = 3;

// Re-exported for this module's existing importers (e.g. memory-write.test.ts). The value now
// lives in @agentfactory/core so apps/web's PATCH .../memory/[entryId] route can enforce the same
// cap without depending on apps/worker.
export { MAX_MEMORY_CONTENT_CHARS };

export interface MemoryProvenance {
  runId?: number;
  sessionId?: number;
}

export interface MemoryWriteOptions {
  reason?: string;
}

export interface MemoryWriteDeps {
  findSimilarMemoryEntries: typeof findSimilarMemoryEntries;
  insertMemoryEntryWithWrite: typeof insertMemoryEntryWithWrite;
  reinforceMemoryEntryWithWrite: typeof reinforceMemoryEntryWithWrite;
  replaceMemoryEntryWithWrite: typeof replaceMemoryEntryWithWrite;
  adjudicate: typeof adjudicateMemoryWrite;
  embedder: Embedder;
}

const defaultDbDeps: Omit<MemoryWriteDeps, "embedder"> = {
  findSimilarMemoryEntries,
  insertMemoryEntryWithWrite,
  reinforceMemoryEntryWithWrite,
  replaceMemoryEntryWithWrite,
  adjudicate: adjudicateMemoryWrite,
};

export type MemoryWriteOutcome = "inserted" | "reinforced" | "superseded" | "merged";

function capContent(content: string): string {
  return content.length > MAX_MEMORY_CONTENT_CHARS ? content.slice(0, MAX_MEMORY_CONTENT_CHARS) : content;
}

export async function writeMemoryEntry(
  orgId: number,
  agentId: number,
  content: string,
  source: MemorySource,
  provenance: MemoryProvenance,
  options: MemoryWriteOptions = {},
  deps: Partial<MemoryWriteDeps> = {},
): Promise<{ reinforced: boolean; outcome: MemoryWriteOutcome }> {
  const d = { ...defaultDbDeps, ...deps };
  const embedder = d.embedder ?? getEmbedder();
  const capped = capContent(content);
  const write = { source, lesson: capped, reason: options.reason, runId: provenance.runId, sessionId: provenance.sessionId };

  const [embedding] = await embedder.embedDocuments([capped]);
  const candidates = await d.findSimilarMemoryEntries(
    orgId,
    agentId,
    embedding,
    MEMORY_ADJUDICATION_FLOOR,
    MEMORY_ADJUDICATION_CANDIDATES,
  );

  const insert = async () => {
    await d.insertMemoryEntryWithWrite(
      { orgId, agentId, source, content: capped, embedding, embeddingModel: embedder.modelId },
      write,
    );
    return { reinforced: false, outcome: "inserted" as const };
  };
  if (candidates.length === 0) return insert();

  let decision: Adjudication;
  try {
    decision = await d.adjudicate(capped, candidates);
  } catch (err) {
    log.warn("Memory adjudication failed; falling back to the similarity threshold", { agentId, err });
    decision =
      candidates[0].score >= MEMORY_SIMILARITY_FLOOR
        ? { decision: "duplicate", targetId: candidates[0].id }
        : { decision: "distinct" };
  }

  if (decision.decision === "distinct") return insert();

  if (decision.decision === "duplicate") {
    await d.reinforceMemoryEntryWithWrite(orgId, agentId, decision.targetId, write);
    return { reinforced: true, outcome: "reinforced" };
  }

  if (decision.decision === "merge") {
    const merged = capContent(decision.text);
    if (lessonTextProblem(merged)) {
      await d.reinforceMemoryEntryWithWrite(orgId, agentId, decision.targetId, write);
      return { reinforced: true, outcome: "reinforced" };
    }
    const [mergedEmbedding] = await embedder.embedDocuments([merged]);
    const replaced = await d.replaceMemoryEntryWithWrite(
      orgId,
      agentId,
      decision.targetId,
      { content: merged, embedding: mergedEmbedding, embeddingModel: embedder.modelId, weight: "increment" },
      { ...write, lesson: merged, reason: `Merged with: ${capped}${options.reason ? ` (${options.reason})` : ""}` },
    );
    return replaced ? { reinforced: true, outcome: "merged" } : insert();
  }

  const replaced = await d.replaceMemoryEntryWithWrite(
    orgId,
    agentId,
    decision.targetId,
    { content: capped, embedding, embeddingModel: embedder.modelId, weight: "reset" },
    { ...write, reason: `Replaces a contradicted lesson${options.reason ? `: ${options.reason}` : ""}` },
  );
  return replaced ? { reinforced: false, outcome: "superseded" } : insert();
}
