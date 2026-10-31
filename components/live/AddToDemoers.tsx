"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { errorText } from "./changes";
import styles from "./live.module.css";

export type PoolPerson = { id: Id<"submissions">; name: string; demo: string };

/**
 * Add to demoers: searches the people who are not in the queue, and Enter
 * adds the highlighted one to the end. It stays open so you can add several.
 */
export function AddToDemoers({ pool, onAdd }: { pool: PoolPerson[]; onAdd: (id: Id<"submissions">) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (needle ? pool.filter((person) => `${person.name} ${person.demo}`.toLowerCase().includes(needle)) : pool).slice(0, 8);
  }, [pool, search]);
  const commands = useMemo<Command[]>(() => [
    { id: "add-to-demoers", group: "This page", label: "Add to demoers", keys: ["A"], run: () => setOpen(true), disabled: pool.length === 0 },
  ], [pool.length]);
  useCommands("add-to-demoers", commands);

  async function add(person: PoolPerson | undefined) {
    if (!person || busy) return;
    setBusy(true);
    try {
      await onAdd(person.id);
      toast.success(`${person.name} added to demoers.`);
      setSearch("");
      setActive(0);
    } catch (error) {
      toast.error(errorText(error, "Could not add them to demoers."));
    } finally {
      setBusy(false);
    }
  }

  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setSearch(""); setActive(0); } }}>
    <ShortcutTooltip label="Add to demoers" keys={["A"]}>
      <PopoverTrigger render={<Button variant="outline" size="sm" disabled={pool.length === 0} />}>
        <Plus aria-hidden />Add to demoers
      </PopoverTrigger>
    </ShortcutTooltip>
    <PopoverContent align="end" sideOffset={6} className={styles.phaseMenu}>
      <label htmlFor="add-demoer-search" className="sr-only">Search the people not in the queue</label>
      <input id="add-demoer-search" className={styles.pickerSearch} autoFocus autoComplete="off" placeholder={`Search ${pool.length} not in the queue`}
        role="combobox" aria-expanded aria-controls="add-demoer-list" aria-activedescendant={matches[active] ? `add-demoer-${matches[active].id}` : undefined}
        value={search} onChange={(event) => { setSearch(event.currentTarget.value); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, matches.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          if (event.key === "Enter") { event.preventDefault(); void add(matches[active]); }
        }} />
      <ul id="add-demoer-list" role="listbox" aria-label="People not in the queue" className={styles.pickerList}>
        {matches.length === 0
          ? <li className={styles.pickerEmpty}>{pool.length === 0 ? "Everyone is in the queue." : "No one matches."}</li>
          : matches.map((person, index) => <li key={person.id} id={`add-demoer-${person.id}`} role="option" aria-selected={index === active}
            className={styles.pickerItem} data-active={index === active ? "" : undefined}
            onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => void add(person)}>
            <span className={styles.listTitle}>{person.demo || person.name}</span>
            {person.demo ? <span className={styles.listTeam}>{person.name}</span> : null}
          </li>)}
      </ul>
      <p className={styles.pickerHint}>Enter adds to the end of the queue.</p>
    </PopoverContent>
  </Popover>;
}
