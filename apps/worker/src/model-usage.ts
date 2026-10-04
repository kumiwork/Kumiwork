import type { TokenUsage } from "@kumiwork/core";
import type { ModelProvider } from "./run-credentials";

export interface ModelUsage extends TokenUsage {
  model?: string;
}

export interface UsageExtractor {
  push(chunk: Uint8Array): void;
  finish(): ModelUsage | undefined;
}

const MAX_LINE_CHARS = 1024 * 1024;
const MAX_JSON_BODY_CHARS = 8 * 1024 * 1024;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function emptyUsage(): ModelUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function mergeAnthropic(current: ModelUsage, usage: unknown): void {
  if (!isRecord(usage)) return;
  current.inputTokens = Math.max(current.inputTokens, count(usage.input_tokens));
  current.outputTokens = Math.max(current.outputTokens, count(usage.output_tokens));
  current.cacheReadTokens = Math.max(current.cacheReadTokens, count(usage.cache_read_input_tokens));
  current.cacheWriteTokens = Math.max(current.cacheWriteTokens, count(usage.cache_creation_input_tokens));
}

function mergeOpenAi(current: ModelUsage, usage: unknown): void {
  if (!isRecord(usage)) return;
  const details = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const cached = count(details.cached_tokens);
  current.cacheReadTokens = Math.max(current.cacheReadTokens, cached);
  current.inputTokens = Math.max(current.inputTokens, Math.max(count(usage.input_tokens) - cached, 0));
  current.outputTokens = Math.max(current.outputTokens, count(usage.output_tokens));
}

function applyEvent(provider: ModelProvider, current: ModelUsage, event: unknown): boolean {
  if (!isRecord(event)) return false;
  if (provider === "anthropic") {
    if (event.type === "message_start" && isRecord(event.message)) {
      if (typeof event.message.model === "string") current.model = event.message.model;
      mergeAnthropic(current, event.message.usage);
      return true;
    }
    if (event.type === "message_delta") {
      mergeAnthropic(current, event.usage);
      return true;
    }
    return false;
  }
  if (event.type === "response.completed" && isRecord(event.response)) {
    if (typeof event.response.model === "string") current.model = event.response.model;
    mergeOpenAi(current, event.response.usage);
    return true;
  }
  return false;
}

function applyBody(provider: ModelProvider, current: ModelUsage, body: unknown): boolean {
  if (!isRecord(body)) return false;
  if (typeof body.model === "string") current.model = body.model;
  if (!isRecord(body.usage)) return false;
  if (provider === "anthropic") mergeAnthropic(current, body.usage);
  else mergeOpenAi(current, body.usage);
  return true;
}

function hasTokens(usage: ModelUsage): boolean {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens > 0;
}

export function createUsageExtractor(provider: ModelProvider, contentType: string | null): UsageExtractor {
  const decoder = new TextDecoder();
  const usage = emptyUsage();
  let seen = false;

  if (contentType?.includes("text/event-stream")) {
    let buffer = "";
    const consumeLine = (line: string) => {
      if (!line.startsWith("data:")) return;
      try {
        if (applyEvent(provider, usage, JSON.parse(line.slice(5).trim()))) seen = true;
      } catch {
        return;
      }
    };
    return {
      push(chunk) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          consumeLine(buffer.slice(0, newline).replace(/\r$/, ""));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
        if (buffer.length > MAX_LINE_CHARS) buffer = "";
      },
      finish() {
        consumeLine(buffer.replace(/\r$/, ""));
        return seen && hasTokens(usage) ? usage : undefined;
      },
    };
  }

  if (contentType?.includes("application/json")) {
    let body = "";
    let overflowed = false;
    return {
      push(chunk) {
        if (overflowed) return;
        body += decoder.decode(chunk, { stream: true });
        if (body.length > MAX_JSON_BODY_CHARS) overflowed = true;
      },
      finish() {
        if (overflowed) return undefined;
        try {
          seen = applyBody(provider, usage, JSON.parse(body + decoder.decode()));
        } catch {
          return undefined;
        }
        return seen && hasTokens(usage) ? usage : undefined;
      },
    };
  }

  return { push() {}, finish: () => undefined };
}
