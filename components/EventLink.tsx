"use client";

import { useState } from "react";

export function EventLink({ label, href }: { label: string; href: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable - the link is still openable
    }
  }

  return (
    <div className="event-link">
      <div className="event-link-text">
        <span className="event-link-label">{label}</span>
        <a className="event-link-url" href={href} target="_blank" rel="noreferrer">
          {href}
        </a>
      </div>
      <button type="button" className="event-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
