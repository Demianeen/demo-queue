"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ASSISTANTS, assistantSetup, SAMPLE_PROMPT, type AssistantId } from "@/lib/assistant-setup";
import { cn } from "@/lib/utils";

/** A copy button that says when it worked, and falls back to selecting the text when it did not. */
export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return <Button variant="outline" size="sm" className={className} aria-live="polite" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setState("copied"); setTimeout(() => setState("idle"), 2000); }
    catch { setState("failed"); }
  }}>{state === "copied" ? <><Check aria-hidden />Copied</> : state === "failed" ? "Select and copy" : <><Copy aria-hidden />{label}</>}</Button>;
}

function CodeLine({ value }: { value: string }) {
  return <div className="flex flex-wrap items-start gap-2">
    <pre className="m-0 min-w-0 flex-[1_1_320px] overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-foreground select-all">{value}</pre>
    <CopyButton value={value} />
  </div>;
}

/**
 * Per-assistant setup: tabs for each client, numbered steps with copy buttons,
 * and the live connection state underneath.
 */
export function ConnectAssistant({ mcpUrl, connected, headingLevel = 3 }: { mcpUrl: string | null | undefined; connected: boolean | undefined; headingLevel?: 2 | 3 }) {
  const [assistant, setAssistant] = useState<AssistantId>("claude-code");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  if (mcpUrl === undefined) return <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading assistant setup">
    <div className="flex flex-wrap gap-2">{ASSISTANTS.map((entry) => <Skeleton key={entry.id} className="h-9 w-28 rounded-full" />)}</div>
    <Skeleton className="h-4 w-80 max-w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-64 max-w-full" />
  </div>;
  if (mcpUrl === null) return <p className="m-0 text-sm text-muted-foreground">Assistant connections are not available on this deployment. Use the production site to connect one.</p>;
  const setup = assistantSetup(assistant, mcpUrl);
  return <div className="flex flex-col gap-4">
    <div role="tablist" aria-label="Assistant" className="flex flex-wrap gap-2">
      {ASSISTANTS.map((entry) => <Button key={entry.id} role="tab" id={`assistant-tab-${entry.id}`} aria-selected={assistant === entry.id} aria-controls="assistant-panel" size="sm"
        variant={assistant === entry.id ? "default" : "outline"} onClick={() => setAssistant(entry.id)}>{entry.label}</Button>)}
    </div>
    <div role="tabpanel" id="assistant-panel" aria-labelledby={`assistant-tab-${assistant}`} className="flex flex-col gap-4">
      <Heading className="sr-only">Connect {setup.label}</Heading>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {setup.steps.map((step, index) => <li key={index} className="flex gap-3">
          <span className="grid size-6 flex-none place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground" aria-hidden>{index + 1}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
            <p className="m-0 leading-normal">{step.text}</p>
            {step.kind === "command" && <CodeLine value={step.command} />}
            {step.kind === "text" && step.command && <CodeLine value={step.command} />}
            {step.kind === "link" && <div><a data-slot="button" className={cn(buttonVariants({ size: "sm" }), "!text-primary-foreground")} href={step.href}>{step.label}</a></div>}
            {step.kind === "prompt" && <CodeLine value={SAMPLE_PROMPT} />}
          </div>
        </li>)}
      </ol>
      {setup.note && <p className="m-0 text-[13px] text-muted-foreground">{setup.note}</p>}
    </div>
    <p role="status" className={cn("m-0 flex items-center gap-2 text-sm", connected ? "text-foreground" : "text-muted-foreground")}>
      {connected === undefined ? <Skeleton className="h-4 w-64" /> : connected
        ? <><Check aria-hidden className="size-4" />Connected. Your assistant can use Demo Queue now.</>
        : <><span className="size-2 animate-pulse rounded-full bg-muted-foreground" aria-hidden />Waiting for your first connection. This updates as soon as one appears.</>}
    </p>
  </div>;
}
