"use client";

import { useState, type ReactNode } from "react";
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
  return <div className="flex flex-wrap items-start gap-1.5">
    <pre className="m-0 min-w-0 flex-[1_1_320px] overflow-x-auto rounded-[7px] border border-input bg-background px-2.5 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground select-all">{value}</pre>
    <CopyButton value={value} />
  </div>;
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <li className="flex gap-3">
    <span className="grid size-[22px] flex-none place-items-center rounded-full bg-[var(--dq-segment)] text-[11px] font-semibold" aria-hidden>{number}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-1.5"><span className="font-medium">{title}</span>{children}</div>
  </li>;
}

/** Each assistant's own steps, for people who want more than the address. */
function AssistantGuides({ mcpUrl }: { mcpUrl: string }) {
  const [assistant, setAssistant] = useState<AssistantId>("claude-code");
  const setup = assistantSetup(assistant, mcpUrl);
  return <details className="group">
    <summary className="ws-sub cursor-pointer select-none">Step by step for Claude Code, Codex, the Claude app or Cursor</summary>
    <div className="mt-3 flex flex-col gap-3">
      <div role="tablist" aria-label="Assistant" className="flex flex-wrap gap-1.5">
        {ASSISTANTS.map((entry) => <Button key={entry.id} role="tab" id={`assistant-tab-${entry.id}`} aria-selected={assistant === entry.id} aria-controls="assistant-panel" size="xs"
          variant={assistant === entry.id ? "default" : "outline"} onClick={() => setAssistant(entry.id)}>{entry.label}</Button>)}
      </div>
      <div role="tabpanel" id="assistant-panel" aria-labelledby={`assistant-tab-${assistant}`} className="flex flex-col gap-3">
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {setup.steps.map((step, index) => <li key={index} className="flex gap-2.5">
            <span className="ws-sub w-4 flex-none text-right tabular-nums" aria-hidden>{index + 1}.</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
              <p className="m-0 leading-normal">{step.text}</p>
              {step.kind === "command" && <CodeLine value={step.command} />}
              {step.kind === "text" && step.command && <CodeLine value={step.command} />}
              {step.kind === "link" && <div><a data-slot="button" className={cn(buttonVariants({ size: "sm" }), "!text-primary-foreground")} href={step.href}>{step.label}</a></div>}
              {step.kind === "prompt" && <CodeLine value={SAMPLE_PROMPT} />}
            </div>
          </li>)}
        </ol>
        {setup.note && <p className="ws-help">{setup.note}</p>}
      </div>
    </div>
  </details>;
}

/**
 * How to connect an assistant: the server address, the approval step,
 * each assistant's own steps on request, and the live connection state underneath.
 */
export function ConnectAssistant({ mcpUrl, connected }: { mcpUrl: string | null | undefined; connected: boolean | undefined }) {
  if (mcpUrl === undefined) return <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading assistant setup">
    <Skeleton className="h-4 w-64 max-w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-4 w-80 max-w-full" />
  </div>;
  if (mcpUrl === null) return <p className="ws-sub">Assistant connections are not available on this deployment. Use the production site to connect one.</p>;
  return <div className="flex flex-col gap-3">
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      <Step number={1} title="Add Demo Queue to your assistant">
        <div className="flex gap-1.5">
          <input aria-label="Demo Queue server address" readOnly value={mcpUrl} onFocus={(event) => event.currentTarget.select()}
            className="h-8 min-w-0 flex-1 rounded-[7px] border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
          <CopyButton value={mcpUrl} />
        </div>
        <span className="ws-sub">Claude, ChatGPT and other MCP clients: add it as a custom connector.</span>
      </Step>
      <Step number={2} title="Approve it here">
        <span className="ws-sub">Your assistant opens an approval page. Pick the organizations and Read only or Manage events.</span>
      </Step>
    </ol>
    <AssistantGuides mcpUrl={mcpUrl} />
    <p role="status" className={cn("m-0 flex items-center gap-1.5 text-xs", connected ? "text-[var(--dq-success-fg)]" : "text-muted-foreground")}>
      {connected === undefined ? <Skeleton className="h-3.5 w-64" /> : connected
        ? <><span className="size-1.5 flex-none rounded-full bg-[var(--dq-success)]" aria-hidden />Connected. Your assistant can use Demo Queue now.</>
        : <><span className="size-1.5 flex-none animate-pulse rounded-full bg-muted-foreground" aria-hidden />Waiting for your first connection. This updates as soon as one appears.</>}
    </p>
  </div>;
}
