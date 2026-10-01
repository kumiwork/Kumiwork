const INFRASTRUCTURE_ERROR_PATTERNS: readonly RegExp[] = [
  /\b(?:401|403|408|429|5\d\d)\b/,
  /\b(?:denied to|permission to|unauthorized|forbidden|rate limit|overloaded|insufficient[_ ]credit|credit balance|usage credits|quota)\b/i,
  /\b(?:timed? ?out|timeout|ETIMEDOUT|ECONN\w*|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed)\b/i,
  /^Couldn't (?:deliver|fetch|post|comment|send)/i,
  /Sandbox run produced no result/i,
  /Failed to (?:fetch|provision|create) (?:the )?(?:sandbox|container|image)/i,
];

export function isInfrastructureError(message: string): boolean {
  return INFRASTRUCTURE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
