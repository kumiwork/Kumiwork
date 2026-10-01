"use client";

import dynamic from "next/dynamic";
import styles from "./ContentViewer.module.css";

export type { ContentViewerProps } from "./ContentViewer";

export const ContentViewer = dynamic(() => import("./ContentViewer").then((module) => module.ContentViewer), {
  ssr: false,
  loading: () => <div className={styles.loading} aria-busy="true" />,
});
