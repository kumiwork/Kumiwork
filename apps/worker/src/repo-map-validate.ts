const KNOWN_MAP_FILENAMES = [
  "CODEBASE_MAP.md",
  "AGENT_MAP.md",
  ".claude/AGENT_MAP.md",
  "CONTRIBUTOR_MAP.md",
  "REPOSITORY_MAP.md",
];

const CREATED_FILE_PHRASE = /\b(?:i'?ve|i have|done!?,?\s*i'?ve)\s+(?:created|written|saved|generated|added)\b/i;
const MARKDOWN_FILENAME = /[\w./-]+\.mdx?\b/i;

export function isRepoMapFileCreationSummary(text: string): boolean {
  if (KNOWN_MAP_FILENAMES.some((filename) => text.includes(filename))) return true;
  return CREATED_FILE_PHRASE.test(text) && MARKDOWN_FILENAME.test(text);
}
