"use client";

import { memo, useCallback, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { LanguageFn } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { useTranslation } from "@/lib/i18n/context";
import { LANGUAGE_LABELS, resolveFormat, type ContentFormat, type ContentLanguage } from "./resolve-format";
import styles from "./ContentViewer.module.css";

const LARGE_CONTENT_THRESHOLD_BYTES = 200_000;

const CODE_LANGUAGES: Record<ContentLanguage, LanguageFn> = {
  ts: typescript,
  tsx: typescript,
  js: javascript,
  json,
  yaml,
  bash,
  python,
  sql,
  css,
  html: xml,
  diff,
  markdown: markdownLanguage,
  go,
  rust,
  java,
  toml: ini,
  dockerfile,
};

const REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm];
const REHYPE_PLUGINS: Options["rehypePlugins"] = [[rehypeHighlight, { languages: CODE_LANGUAGES }]];

const DISALLOWED_AFTER_DEFAULT_TRANSFORM = /^(ircs?|xmpp):/i;

function safeUrlTransform(value: string): string {
  const transformed = defaultUrlTransform(value);
  if (!transformed) return transformed;
  return DISALLOWED_AFTER_DEFAULT_TRANSFORM.test(transformed) ? "" : transformed;
}

interface HastLikeNode {
  type?: unknown;
  tagName?: unknown;
  value?: unknown;
  properties?: { className?: unknown };
  children?: unknown[];
}

function asHastNode(node: unknown): HastLikeNode | undefined {
  return typeof node === "object" && node !== null ? (node as HastLikeNode) : undefined;
}

function collectText(node: unknown): string {
  const current = asHastNode(node);
  if (!current) return "";
  if (current.type === "text" && typeof current.value === "string") return current.value;
  if (Array.isArray(current.children)) return current.children.map(collectText).join("");
  return "";
}

function findCodeElement(preNode: unknown): HastLikeNode | undefined {
  const children = asHastNode(preNode)?.children;
  if (!Array.isArray(children)) return undefined;
  return children.find((child) => asHastNode(child)?.tagName === "code") as HastLikeNode | undefined;
}

function extractLanguage(codeNode: HastLikeNode | undefined): string | undefined {
  const classes = codeNode?.properties?.className;
  if (!Array.isArray(classes)) return undefined;
  for (const entry of classes) {
    if (typeof entry === "string" && entry.startsWith("language-")) {
      return entry.slice("language-".length);
    }
  }
  return undefined;
}

function languageLabel(language: string | undefined): string {
  if (!language) return "";
  return (LANGUAGE_LABELS as Record<string, string>)[language] ?? language;
}

function buildCodeFence(content: string, language?: ContentLanguage): string {
  const longestBacktickRun = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  const body = content.endsWith("\n") ? content : `${content}\n`;
  return `${fence}${language ?? ""}\n${body}${fence}\n`;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }, [text]);

  return (
    <button type="button" className={styles.copyButton} onClick={handleClick}>
      {copied ? t("contentViewer.copied") : t("contentViewer.copy")}
    </button>
  );
}

type LinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

function SafeLink({ href, children, node, ...rest }: LinkProps) {
  void node;
  if (!href) {
    return <span className={styles.unsafeLink}>{children}</span>;
  }
  const external = /^https?:/i.test(href);
  return (
    <a
      {...rest}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer nofollow" : undefined}
    >
      {children}
    </a>
  );
}

type ImgProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };

function ImageLink({ src, alt }: ImgProps) {
  const href = typeof src === "string" ? src : undefined;
  const label = alt || href || "";
  if (!href) {
    return <span className={styles.unsafeLink}>{label}</span>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {label}
    </a>
  );
}

type PreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
  showCopy: boolean;
  showLineNumbers: boolean;
};

function CodeFence({ node, children, showCopy, showLineNumbers }: PreProps) {
  const codeNode = findCodeElement(node);
  const rawText = collectText(codeNode).replace(/\n$/, "");
  const label = languageLabel(extractLanguage(codeNode));
  const lines = showLineNumbers ? rawText.split("\n") : null;

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLanguage}>{label}</span>
        {showCopy && <CopyButton text={rawText} />}
      </div>
      <div className={styles.codeBody}>
        {lines && (
          <div className={styles.gutter} aria-hidden="true">
            {lines.map((_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
        )}
        <pre className={styles.pre}>{children}</pre>
      </div>
    </div>
  );
}

function PlainText({ content, showCopy }: { content: string; showCopy: boolean }) {
  return (
    <div className={styles.codeBlock}>
      {showCopy && (
        <div className={styles.codeHeader}>
          <span className={styles.codeLanguage} />
          <CopyButton text={content} />
        </div>
      )}
      <pre className={styles.plain}>{content}</pre>
    </div>
  );
}

interface MarkdownBodyProps {
  content: string;
  showCopy: boolean;
  showLineNumbers: boolean;
}

function MarkdownBody({ content, showCopy, showLineNumbers }: MarkdownBodyProps) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={safeUrlTransform}
        components={{
          a: (props) => <SafeLink {...props} />,
          img: (props) => <ImageLink {...props} />,
          pre: (props) => <CodeFence {...props} showCopy={showCopy} showLineNumbers={showLineNumbers} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export interface ContentViewerProps {
  content: string;
  filename?: string;
  language?: ContentLanguage;
  format?: ContentFormat;
  maxHeight?: number | string;
  showCopy?: boolean;
  allowRawToggle?: boolean;
}

function ContentViewerComponent({
  content,
  filename,
  language,
  format = "auto",
  maxHeight,
  showCopy = true,
  allowRawToggle = false,
}: ContentViewerProps) {
  const { t } = useTranslation();
  const [rawView, setRawView] = useState(false);

  const resolved = useMemo(() => resolveFormat({ format, language, filename }), [format, language, filename]);
  const isOversize = content.length > LARGE_CONTENT_THRESHOLD_BYTES;
  const effectiveFormat = isOversize ? "text" : resolved.format;
  const codeLanguage = resolved.format === "code" ? resolved.language : undefined;
  const showRawToggle = !isOversize && effectiveFormat === "markdown" && allowRawToggle;

  let body: ReactNode;
  if (effectiveFormat === "text") {
    body = <PlainText content={content} showCopy={showCopy} />;
  } else if (effectiveFormat === "markdown") {
    body = rawView ? (
      <PlainText content={content} showCopy={showCopy} />
    ) : (
      <MarkdownBody content={content} showCopy={showCopy} showLineNumbers={false} />
    );
  } else {
    body = <MarkdownBody content={buildCodeFence(content, codeLanguage)} showCopy={showCopy} showLineNumbers />;
  }

  return (
    <div
      className={styles.wrapper}
      style={maxHeight !== undefined ? { maxHeight, overflow: "auto" } : undefined}
    >
      {isOversize && <p className={styles.notice}>{t("contentViewer.largeFileNotice")}</p>}
      {showRawToggle && (
        <div className={styles.toggleRow}>
          <button
            type="button"
            className={
              rawView ? styles.toggleButton : `${styles.toggleButton} ${styles.toggleButtonActive}`
            }
            onClick={() => setRawView(false)}
          >
            {t("contentViewer.rendered")}
          </button>
          <button
            type="button"
            className={
              rawView ? `${styles.toggleButton} ${styles.toggleButtonActive}` : styles.toggleButton
            }
            onClick={() => setRawView(true)}
          >
            {t("contentViewer.raw")}
          </button>
        </div>
      )}
      {body}
    </div>
  );
}

export const ContentViewer = memo(ContentViewerComponent);
