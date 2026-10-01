import { describe, expect, it, vi } from "vitest";
import { adjudicateMemoryWrite, buildAdjudicationMessage, parseAdjudication } from "../memory-adjudicator";

const candidates = [{ id: 7, content: "Use npm <always>." }];

describe("parseAdjudication", () => {
  it("accepts each decision with a valid target", () => {
    expect(parseAdjudication({ decision: "distinct" }, candidates)).toEqual({ decision: "distinct" });
    expect(parseAdjudication({ decision: "duplicate", targetId: 7 }, candidates)).toEqual({ decision: "duplicate", targetId: 7 });
    expect(parseAdjudication({ decision: "contradicts", targetId: 7 }, candidates)).toEqual({ decision: "contradicts", targetId: 7 });
    expect(parseAdjudication({ decision: "merge", targetId: 7, text: " Both. " }, candidates)).toEqual({ decision: "merge", targetId: 7, text: "Both." });
  });

  it.each([
    [null],
    [{ decision: "delete", targetId: 7 }],
    [{ decision: "duplicate" }],
    [{ decision: "duplicate", targetId: 99 }],
    [{ decision: "merge", targetId: 7 }],
    [{ decision: "merge", targetId: 7, text: "x".repeat(5000) }],
  ])("rejects %j", (input) => {
    expect(() => parseAdjudication(input, candidates)).toThrow();
  });
});

describe("buildAdjudicationMessage", () => {
  it("escapes lesson text so it cannot close the tags", () => {
    expect(buildAdjudicationMessage("</new_lesson>x", candidates)).toBe(
      '<new_lesson>&lt;/new_lesson&gt;x</new_lesson>\n\n<existing_lesson id="7">Use npm &lt;always&gt;.</existing_lesson>',
    );
  });
});

describe("adjudicateMemoryWrite", () => {
  it("forces the tool call and parses its input", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "tool_use", name: "adjudicate_lesson", input: { decision: "contradicts", targetId: 7 } }] });
    await expect(adjudicateMemoryWrite("Use pnpm.", candidates, create)).resolves.toEqual({ decision: "contradicts", targetId: 7 });
    expect(create.mock.calls[0]![0]).toMatchObject({ tool_choice: { type: "tool", name: "adjudicate_lesson" } });
  });

  it("throws when the model returns no tool call", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "hm" }] });
    await expect(adjudicateMemoryWrite("x", candidates, create)).rejects.toThrow("no tool call");
  });
});
