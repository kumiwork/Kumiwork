"use client";

import { useState, type ComponentPropsWithoutRef } from "react";
import { Textarea } from "@kumiwork/shared";
import { useTranslation } from "@/lib/i18n/context";
import { ContentViewer, type ContentViewerProps } from "./LazyContentViewer";
import styles from "./ContentViewer.module.css";

type TextareaProps = ComponentPropsWithoutRef<"textarea">;

export interface EditablePreviewProps extends Omit<TextareaProps, "value" | "onChange"> {
  value: string;
  onChange: NonNullable<TextareaProps["onChange"]>;
  format?: ContentViewerProps["format"];
  filename?: ContentViewerProps["filename"];
  language?: ContentViewerProps["language"];
}

export function EditablePreview({
  value,
  onChange,
  format = "markdown",
  filename,
  language,
  ...textareaProps
}: EditablePreviewProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <div>
      <div className={styles.toggleRow}>
        <button
          type="button"
          className={mode === "edit" ? `${styles.toggleButton} ${styles.toggleButtonActive}` : styles.toggleButton}
          onClick={() => setMode("edit")}
        >
          {t("editablePreview.edit")}
        </button>
        <button
          type="button"
          className={
            mode === "preview" ? `${styles.toggleButton} ${styles.toggleButtonActive}` : styles.toggleButton
          }
          onClick={() => setMode("preview")}
        >
          {t("editablePreview.preview")}
        </button>
      </div>
      {mode === "edit" ? (
        <Textarea value={value} onChange={onChange} {...textareaProps} />
      ) : (
        <ContentViewer content={value} format={format} filename={filename} language={language} />
      )}
    </div>
  );
}
