"use client";

import { useEffect, useState } from "react";
import {
  BookOpenIcon,
  ExternalLinkIcon,
  GitForkIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Skeleton } from "@/app/Skeleton";
import styles from "./ProjectReviewContent.module.css";

export type ReviewProject = {
  demoTitle: string;
  description: string;
  name: string;
  category?: string;
  githubUrl: string | null;
  videoUrl: string | null;
  people?: string[];
};

function youtubeEmbedUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
      else id = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ?? "";
    }
    return /^[A-Za-z0-9_-]{6,}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  } catch {
    return null;
  }
}

function genericVideoEmbedUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function Readme({ repositoryUrl }: { repositoryUrl: string | null }) {
  const [state, setState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    markdown: string;
  }>({ status: "idle", markdown: "" });

  useEffect(() => {
    if (!repositoryUrl) {
      setState({ status: "idle", markdown: "" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", markdown: "" });
    void fetch(`/api/github-readme?url=${encodeURIComponent(repositoryUrl)}`, {
      signal: controller.signal,
    })
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

  return (
    <section className={styles.readmeSection}>
      <div className={styles.sectionLabel}><BookOpenIcon /> README</div>
      {state.status === "loading" ? (
        <div className={styles.readmeLoading}><Skeleton w="58%" h={24} /><Skeleton h={14} /><Skeleton w="85%" h={14} /><Skeleton h={90} /></div>
      ) : state.status === "ready" ? (
        <div className={styles.markdown}>
          <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]}>{state.markdown}</ReactMarkdown>
        </div>
      ) : (
        <p className={styles.emptyCopy}>
          {repositoryUrl ? "The README could not be displayed here. Open the repository to review it on GitHub." : "No GitHub repository was provided."}
        </p>
      )}
    </section>
  );
}

export function ProjectReviewContent({ project }: { project: ReviewProject }) {
  const youtubeUrl = youtubeEmbedUrl(project.videoUrl);
  const embedUrl = youtubeUrl ?? genericVideoEmbedUrl(project.videoUrl);
  const people = project.people?.length ? project.people.join(", ") : project.name;

  return (
    <article className={styles.projectPane}>
      <div className={styles.projectIntro}>
        <h1>{project.demoTitle}</h1>
        <p className={styles.projectMeta}>{people}{project.category ? ` · ${project.category}` : ""}</p>
        <p className={styles.description}>{project.description}</p>
        <div className={styles.projectLinks}>
          {project.githubUrl ? <a href={project.githubUrl} target="_blank" rel="noreferrer"><GitForkIcon /> GitHub repository <ExternalLinkIcon /></a> : null}
          {project.videoUrl ? <a href={project.videoUrl} target="_blank" rel="noreferrer">Demo video <ExternalLinkIcon /></a> : null}
        </div>
      </div>
      {embedUrl ? (
        <div className={styles.videoFrame}>
          <iframe
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox={youtubeUrl ? undefined : "allow-forms allow-presentation allow-same-origin allow-scripts"}
            src={embedUrl}
            title={`${project.demoTitle} demo video`}
          />
        </div>
      ) : project.videoUrl ? (
        <a className={styles.videoFallback} href={project.videoUrl} target="_blank" rel="noreferrer">Open the demo video <ExternalLinkIcon /></a>
      ) : (
        <div className={styles.videoFallback}>No demo video was provided.</div>
      )}
      <Readme repositoryUrl={project.githubUrl} />
    </article>
  );
}
