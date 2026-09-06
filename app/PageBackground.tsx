"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Fixed Codex video backdrop for public event pages. The <video> shows its poster
// frame until we call play() - so on reduced-motion or small screens we simply
// never start it (poster stays, no bandwidth/decode cost). The CSS gradient on
// <html> is the ultimate fallback if the media fails to load at all.
export function PageBackground() {
  const pathname = usePathname();
  const neutral = pathname === "/" || pathname.startsWith("/events") || pathname === "/styles" || pathname === "/saved" || pathname.startsWith("/admin/");
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 640px)").matches;
    if (reduced || small) return;
    ref.current?.play().catch(() => {});
  }, [neutral]);

  if (neutral) return null;

  return (
    <div aria-hidden className="page-bg">
      <video
        ref={ref}
        className="page-bg-media"
        muted
        loop
        playsInline
        preload="metadata"
        poster="/codex-bg-poster.jpg"
      >
        <source src="/codex-bg.webm" type="video/webm" />
        <source src="/codex-bg.mp4" type="video/mp4" />
      </video>
      <div className="page-bg-scrim" />
    </div>
  );
}
