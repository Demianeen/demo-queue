"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { commandForKeys } from "@/lib/key-sequence";

/**
 * One action the organiser can run from the command menu, and from its keys.
 * `keys` is a sequence: ["G", "E"] means G then E; ["C"] is a single key.
 */
export type Command = {
  id: string;
  label: string;
  group: string;
  keys?: string[];
  hint?: string;
  run: () => void;
  disabled?: boolean;
};

type Registry = {
  commands: Command[];
  register: (owner: string, commands: Command[]) => void;
  unregister: (owner: string) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  context?: string;
  setContext: (owner: string, label: string | undefined) => void;
};

const CommandContext = createContext<Registry | null>(null);

export function useCommandRegistry() {
  const registry = useContext(CommandContext);
  if (!registry) throw new Error("Commands need the organiser shell.");
  return registry;
}

/** Registers a page's commands while it is mounted. Pass a stable `owner`. */
export function useCommands(owner: string, commands: Command[], context?: string) {
  const registry = useContext(CommandContext);
  const latest = useRef(commands);
  latest.current = commands;
  const signature = commands.map((command) => `${command.id}:${command.label}:${command.disabled ? 1 : 0}:${(command.keys ?? []).join("")}`).join("|");
  useEffect(() => {
    if (!registry) return;
    registry.register(owner, latest.current.map((command) => ({ ...command, run: () => latest.current.find((next) => next.id === command.id)?.run() })));
    return () => registry.unregister(owner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, signature, registry?.register, registry?.unregister]);
  useEffect(() => {
    if (!registry) return;
    registry.setContext(owner, context);
    return () => registry.setContext(owner, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, context, registry?.setContext]);
}

/** True while the person is typing, so single-key shortcuts never fire there. */
export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox'], [role='textbox']"));
}

const SEQUENCE_WINDOW_MS = 1200;

export function CommandProvider({ children }: { children: ReactNode }) {
  const [owners, setOwners] = useState<Record<string, Command[]>>({});
  const [contexts, setContexts] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const register = useCallback((owner: string, commands: Command[]) => setOwners((current) => ({ ...current, [owner]: commands })), []);
  const unregister = useCallback((owner: string) => setOwners((current) => { const next = { ...current }; delete next[owner]; return next; }), []);
  const setContext = useCallback((owner: string, label: string | undefined) => setContexts((current) => {
    const next = { ...current };
    if (label) next[owner] = label; else delete next[owner];
    return next;
  }), []);
  const commands = useMemo(() => Object.values(owners).flat(), [owners]);
  const context = Object.values(contexts).at(-1);

  const pressed = useRef<{ key: string; at: number }[]>([]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSheetOpen(false);
        setMenuOpen((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || isTypingTarget(event.target)) return;
      if (document.querySelector("[role='dialog'][data-open], [role='alertdialog'][data-open], [role='menu']")) return;
      if (event.key === "?") { event.preventDefault(); setSheetOpen(true); return; }
      if (event.key.length !== 1) return;
      const now = Date.now();
      pressed.current = [...pressed.current.filter((entry) => now - entry.at < SEQUENCE_WINDOW_MS), { key: event.key, at: now }].slice(-3);
      const keys = pressed.current.map((entry) => entry.key);
      const match = commandForKeys(commands, keys);
      if (!match) return;
      event.preventDefault();
      pressed.current = [];
      match.run();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commands]);

  const value = useMemo(() => ({ commands, register, unregister, menuOpen, setMenuOpen, sheetOpen, setSheetOpen, context, setContext }), [commands, register, unregister, menuOpen, sheetOpen, context, setContext]);
  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

/** Keys shown as "G then S", or a chord such as "⌘ K". */
export function KeySequence({ keys, chord = false }: { keys: string[]; chord?: boolean }) {
  return <KbdGroup className="dq-shortcut-keys">
    {keys.map((key, index) => <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
      {index > 0 && !chord && <span>then</span>}
      <Kbd>{key}</Kbd>
    </span>)}
  </KbdGroup>;
}

/**
 * Shows the action name and its keys after a one second hover. Shortcuts are
 * never printed inline on buttons.
 */
export function ShortcutTooltip({ label, keys, side, children }: { label: string; keys?: string[]; side?: "top" | "right" | "bottom" | "left"; children: ReactElement }) {
  return <Tooltip>
    {/* The bare trigger, so the child keeps its own data-slot (button, sidebar-menu-button) and its styles. */}
    <TooltipPrimitive.Trigger render={children} />
    <TooltipContent side={side}><span className="dq-shortcut">{label}{keys && keys.length > 0 && <KeySequence keys={keys} />}</span></TooltipContent>
  </Tooltip>;
}
