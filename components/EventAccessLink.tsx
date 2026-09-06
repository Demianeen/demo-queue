"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, ArrowUpRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useSiteOrigin } from "@/lib/use-site-origin";

export function EventAccessLink({ name, description, path, icon }: { name: string; description: string; path: string; icon: ReactNode }) {
  const origin = useSiteOrigin();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${origin}${path}`);
      setCopied(true); setFailed(false);
    } catch { setFailed(true); setCopied(false); }
  }
  return <div className="workspace-access-link">
    <span className="workspace-access-icon" aria-hidden>{icon}</span>
    <div className="workspace-access-copy"><h3>{name}</h3><p>{description}</p>{failed && <span role="status">Couldn’t copy. Open the link instead.</span>}</div>
    <div className="workspace-access-actions">
      <Button variant="ghost" size="icon" onClick={() => void copy()} aria-label={copied ? `${name} link copied` : `Copy ${name.toLowerCase()} link`} title={copied ? "Copied" : "Copy link"}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}</Button>
      <a className={buttonVariants({ variant: "ghost", size: "icon" })} href={path} target="_blank" rel="noreferrer" aria-label={`Open ${name.toLowerCase()}`} title="Open in new tab"><ArrowUpRight aria-hidden /></a>
    </div>
  </div>;
}
