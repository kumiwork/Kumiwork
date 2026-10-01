import { describe, expect, it } from "vitest";
import { createUsageExtractor } from "../model-usage";

const encoder = new TextEncoder();

function feed(extractor: ReturnType<typeof createUsageExtractor>, text: string, size = text.length) {
  const bytes = encoder.encode(text);
  for (let i = 0; i < bytes.length; i += size) extractor.push(bytes.subarray(i, i + size));
  return extractor.finish();
}

const ANTHROPIC_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":12,"cache_creation_input_tokens":100,"cache_read_input_tokens":300,"output_tokens":1}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":45}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join("");

describe("createUsageExtractor", () => {
  it("reads Anthropic streaming usage from message_start and message_delta", () => {
    expect(feed(createUsageExtractor("anthropic", "text/event-stream"), ANTHROPIC_SSE)).toEqual({
      model: "claude-haiku-4-5-20251001",
      inputTokens: 12,
      outputTokens: 45,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
    });
  });

  it("copes with events split across tiny chunks and CRLF line endings", () => {
    const usage = feed(createUsageExtractor("anthropic", "text/event-stream; charset=utf-8"), ANTHROPIC_SSE.replace(/\n/g, "\r\n"), 7);
    expect(usage).toMatchObject({ inputTokens: 12, outputTokens: 45 });
  });

  it("keeps the partial usage when the stream ends before message_delta", () => {
    const partial = ANTHROPIC_SSE.split("event: content_block_delta")[0]!;
    expect(feed(createUsageExtractor("anthropic", "text/event-stream"), partial)).toMatchObject({ inputTokens: 12, outputTokens: 1 });
  });

  it("reads a non-streaming Anthropic JSON body", () => {
    const body = JSON.stringify({ model: "claude-sonnet-5", usage: { input_tokens: 5, output_tokens: 7 } });
    expect(feed(createUsageExtractor("anthropic", "application/json"), body, 9)).toEqual({
      model: "claude-sonnet-5",
      inputTokens: 5,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("reads OpenAI response.completed and splits cached tokens out of the input count", () => {
    const sse = `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: { model: "gpt-6-luna", usage: { input_tokens: 1000, output_tokens: 20, input_tokens_details: { cached_tokens: 800 } } },
    })}\n\n`;
    expect(feed(createUsageExtractor("openai", "text/event-stream"), sse)).toEqual({
      model: "gpt-6-luna",
      inputTokens: 200,
      outputTokens: 20,
      cacheReadTokens: 800,
      cacheWriteTokens: 0,
    });
  });

  it("returns undefined for responses that carry no usage", () => {
    expect(feed(createUsageExtractor("anthropic", "application/json"), JSON.stringify({ input_tokens: 42 }))).toBeUndefined();
    expect(feed(createUsageExtractor("anthropic", "application/json"), "not json")).toBeUndefined();
    expect(feed(createUsageExtractor("anthropic", "text/event-stream"), "event: ping\ndata: {}\n\n")).toBeUndefined();
    expect(feed(createUsageExtractor("anthropic", "text/plain"), "hello")).toBeUndefined();
    expect(createUsageExtractor("anthropic", null).finish()).toBeUndefined();
  });
});
