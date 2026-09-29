export type ContentFormat = "auto" | "markdown" | "code" | "text";

export type ContentLanguage =
  | "ts"
  | "tsx"
  | "js"
  | "json"
  | "yaml"
  | "bash"
  | "python"
  | "sql"
  | "css"
  | "html"
  | "diff"
  | "markdown"
  | "go"
  | "rust"
  | "java"
  | "toml"
  | "dockerfile";

export interface ResolveFormatInput {
  format?: ContentFormat;
  language?: ContentLanguage;
  filename?: string;
}

export type ResolvedFormat =
  | { format: "markdown" }
  | { format: "text" }
  | { format: "code"; language?: ContentLanguage };

export const LANGUAGE_LABELS: Record<ContentLanguage, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  json: "JSON",
  yaml: "YAML",
  bash: "Bash",
  python: "Python",
  sql: "SQL",
  css: "CSS",
  html: "HTML",
  diff: "Diff",
  markdown: "Markdown",
  go: "Go",
  rust: "Rust",
  java: "Java",
  toml: "TOML",
  dockerfile: "Dockerfile",
};

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

const EXTENSION_LANGUAGES: Record<string, ContentLanguage> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "bash",
  ".bash": "bash",
  ".py": "python",
  ".sql": "sql",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".diff": "diff",
  ".patch": "diff",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".toml": "toml",
};

const FILENAME_LANGUAGES: Record<string, ContentLanguage> = {
  dockerfile: "dockerfile",
};

function baseName(filename: string): string {
  return filename.split(/[/\\]/).pop() ?? filename;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

function resolveFromFilename(filename: string): ResolvedFormat {
  const name = baseName(filename).toLowerCase();
  const extension = extensionOf(name);

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return { format: "markdown" };
  }

  const filenameLanguage = FILENAME_LANGUAGES[name];
  if (filenameLanguage) {
    return { format: "code", language: filenameLanguage };
  }

  const extensionLanguage = EXTENSION_LANGUAGES[extension];
  if (extensionLanguage) {
    return { format: "code", language: extensionLanguage };
  }

  return { format: "text" };
}

export function resolveFormat({ format, language, filename }: ResolveFormatInput): ResolvedFormat {
  if (format === "markdown") return { format: "markdown" };
  if (format === "text") return { format: "text" };

  if (format === "code") {
    if (language) return { format: "code", language };
    if (filename) {
      const byFilename = resolveFromFilename(filename);
      return { format: "code", language: byFilename.format === "code" ? byFilename.language : undefined };
    }
    return { format: "code" };
  }

  if (language) return { format: "code", language };
  if (filename) return resolveFromFilename(filename);
  return { format: "text" };
}
