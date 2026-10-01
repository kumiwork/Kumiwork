import { describe, expect, it, vi } from "vitest";
import type { Embedder } from "../embedder";

vi.mock("@agentfactory/db", () => ({
  findSimilarMemoryEntries: vi.fn(),
  insertMemoryEntryWithWrite: vi.fn(),
  reinforceMemoryEntryWithWrite: vi.fn(),
  replaceMemoryEntryWithWrite: vi.fn(),
}));
vi.mock("@agentfactory/logger", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { createLogger: () => log };
});

import {
  MAX_MEMORY_CONTENT_CHARS,
  MEMORY_ADJUDICATION_CANDIDATES,
  MEMORY_ADJUDICATION_FLOOR,
  writeMemoryEntry,
} from "../memory-write";
import type { Adjudication } from "../memory-adjudicator";

function fakeEmbedder(): Embedder {
  return {
    modelId: "fake-model",
    dimensions: 3,
    embedQuery: vi.fn(async () => [1, 0, 0]),
    embedDocuments: vi.fn(async (texts: string[]) => texts.map((t) => (t.startsWith("MERGED") ? [0, 1, 0] : [1, 0, 0]))),
  };
}

function deps(candidates: Array<{ id: number; weight: number; score: number; content: string }> = [], decision?: Adjudication | Error) {
  return {
    findSimilarMemoryEntries: vi.fn().mockResolvedValue(candidates),
    insertMemoryEntryWithWrite: vi.fn().mockResolvedValue(42),
    reinforceMemoryEntryWithWrite: vi.fn().mockResolvedValue({ reinforced: true, duplicate: false }),
    replaceMemoryEntryWithWrite: vi.fn().mockResolvedValue(true),
    adjudicate: vi.fn(async () => {
      if (decision instanceof Error) throw decision;
      return decision ?? { decision: "distinct" };
    }),
    embedder: fakeEmbedder(),
  };
}

const npm = { id: 7, weight: 3, score: 0.93, content: "Use npm for installs." };

describe("writeMemoryEntry", () => {
  it("inserts without calling the adjudicator when nothing is similar", async () => {
    const d = deps();

    const result = await writeMemoryEntry(1, 2, "Use pnpm.", "manual", { runId: 9, sessionId: 5 }, {}, d as never);

    expect(result).toEqual({ reinforced: false, outcome: "inserted" });
    expect(d.findSimilarMemoryEntries).toHaveBeenCalledWith(1, 2, [1, 0, 0], MEMORY_ADJUDICATION_FLOOR, MEMORY_ADJUDICATION_CANDIDATES);
    expect(d.adjudicate).not.toHaveBeenCalled();
    expect(d.insertMemoryEntryWithWrite).toHaveBeenCalledExactlyOnceWith(
      { orgId: 1, agentId: 2, source: "manual", content: "Use pnpm.", embedding: [1, 0, 0], embeddingModel: "fake-model" },
      { source: "manual", lesson: "Use pnpm.", reason: undefined, runId: 9, sessionId: 5 },
    );
  });

  it("reinforces the target when the adjudicator says duplicate", async () => {
    const d = deps([npm], { decision: "duplicate", targetId: 7 });

    const result = await writeMemoryEntry(1, 2, "Install with npm.", "retrospective", { sessionId: 5 }, { reason: "again" }, d as never);

    expect(result).toEqual({ reinforced: true, outcome: "reinforced" });
    expect(d.adjudicate).toHaveBeenCalledWith("Install with npm.", [npm]);
    expect(d.reinforceMemoryEntryWithWrite).toHaveBeenCalledExactlyOnceWith(1, 2, 7, {
      source: "retrospective",
      lesson: "Install with npm.",
      reason: "again",
      runId: undefined,
      sessionId: 5,
    });
    expect(d.insertMemoryEntryWithWrite).not.toHaveBeenCalled();
  });

  it("replaces a contradicted lesson with the new one and resets its weight instead of reinforcing it", async () => {
    const d = deps([npm], { decision: "contradicts", targetId: 7 });

    const result = await writeMemoryEntry(1, 2, "Use pnpm for installs.", "manual", { sessionId: 5 }, {}, d as never);

    expect(result).toEqual({ reinforced: false, outcome: "superseded" });
    expect(d.replaceMemoryEntryWithWrite).toHaveBeenCalledExactlyOnceWith(
      1,
      2,
      7,
      { content: "Use pnpm for installs.", embedding: [1, 0, 0], embeddingModel: "fake-model", weight: "reset" },
      expect.objectContaining({ source: "manual", lesson: "Use pnpm for installs.", reason: "Replaces a contradicted lesson" }),
    );
    expect(d.reinforceMemoryEntryWithWrite).not.toHaveBeenCalled();
    expect(d.insertMemoryEntryWithWrite).not.toHaveBeenCalled();
  });

  it("rewrites the target with the merged text, re-embedded, and counts it as reinforced", async () => {
    const d = deps([npm], { decision: "merge", targetId: 7, text: "MERGED: use pnpm; npm only in legacy/." });

    const result = await writeMemoryEntry(1, 2, "Use pnpm outside legacy/.", "manual", {}, {}, d as never);

    expect(result).toEqual({ reinforced: true, outcome: "merged" });
    expect(d.replaceMemoryEntryWithWrite).toHaveBeenCalledWith(
      1,
      2,
      7,
      { content: "MERGED: use pnpm; npm only in legacy/.", embedding: [0, 1, 0], embeddingModel: "fake-model", weight: "increment" },
      expect.objectContaining({ lesson: "MERGED: use pnpm; npm only in legacy/." }),
    );
  });

  it("falls back to reinforcing when the merged text fails the lesson blocklist", async () => {
    const d = deps([npm], { decision: "merge", targetId: 7, text: "See https://evil.example for installs." });

    const result = await writeMemoryEntry(1, 2, "Use pnpm.", "manual", {}, {}, d as never);

    expect(result).toEqual({ reinforced: true, outcome: "reinforced" });
    expect(d.replaceMemoryEntryWithWrite).not.toHaveBeenCalled();
    expect(d.reinforceMemoryEntryWithWrite).toHaveBeenCalledOnce();
  });

  it("inserts when the adjudicator says distinct", async () => {
    const d = deps([{ ...npm, score: 0.7 }], { decision: "distinct" });

    const result = await writeMemoryEntry(1, 2, "Run tests with make check.", "manual", {}, {}, d as never);

    expect(result).toEqual({ reinforced: false, outcome: "inserted" });
    expect(d.reinforceMemoryEntryWithWrite).not.toHaveBeenCalled();
  });

  it("falls back to the 0.85 threshold when the adjudicator fails", async () => {
    const close = deps([npm], new Error("api down"));
    await expect(writeMemoryEntry(1, 2, "x", "manual", {}, {}, close as never)).resolves.toEqual({ reinforced: true, outcome: "reinforced" });

    const far = deps([{ ...npm, score: 0.7 }], new Error("api down"));
    await expect(writeMemoryEntry(1, 2, "x", "manual", {}, {}, far as never)).resolves.toEqual({ reinforced: false, outcome: "inserted" });
  });

  it("inserts when the target vanished before it could be replaced", async () => {
    const d = deps([npm], { decision: "contradicts", targetId: 7 });
    d.replaceMemoryEntryWithWrite.mockResolvedValue(false);

    await expect(writeMemoryEntry(1, 2, "Use pnpm.", "manual", {}, {}, d as never)).resolves.toEqual({ reinforced: false, outcome: "inserted" });
  });

  it("caps over-long content before embedding and storing", async () => {
    const d = deps();
    await writeMemoryEntry(1, 2, "a".repeat(MAX_MEMORY_CONTENT_CHARS + 50), "manual", {}, {}, d as never);
    expect(d.insertMemoryEntryWithWrite.mock.calls[0]![0].content).toHaveLength(MAX_MEMORY_CONTENT_CHARS);
  });
});
