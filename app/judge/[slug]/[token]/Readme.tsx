"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { BookOpenIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Skeleton } from "@/app/Skeleton";
import styles from "./judge.module.css";

const PLUGINS = [rehypeRaw, rehypeSanitize];

/** The project's README from GitHub, sanitised. Loaded on demand by the judge page. */
export const Readme = memo(function Readme({ repositoryUrl }: { repositoryUrl: string | null }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; markdown: string }>({ status: "idle", markdown: "" });
  useEffect(() => {
    if (!repositoryUrl) { setState({ status: "idle", markdown: "" }); return; }
    const controller = new AbortController();
    setState({ status: "loading", markdown: "" });
    void fetch(`/api/github-readme?url=${encodeURIComponent(repositoryUrl)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("README unavailable");
        return await response.json() as { markdown: string };
      })
      .then((result) => setState({ status: "ready", markdown: result.markdown }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", markdown: "" });
      });
    return () => controller.abort();
  }, [repositoryUrl]);
  // Parse the markdown once per README, not on every render
  const rendered = useMemo(() => state.status === "ready" ? <ReactMarkdown rehypePlugins={PLUGINS}>{state.markdown}</ReactMarkdown> : null, [state]);
  return (
    <section className={styles.readmeSection} id="project-readme">
      <div className={styles.sectionLabel}><BookOpenIcon /> README</div>
      {state.status === "loading" ? (
        <div className={styles.readmeLoading}><Skeleton w="58%" h={24} /><Skeleton h={14} /><Skeleton w="85%" h={14} /><Skeleton h={90} /></div>
      ) : state.status === "ready" ? (
        <div className={styles.markdown}>{rendered}</div>
      ) : (
        <p className={styles.emptyCopy}>{repositoryUrl ? "The README could not be displayed here. Open the repository to review it on GitHub." : "No GitHub repository was provided."}</p>
      )}
    </section>
  );
});
