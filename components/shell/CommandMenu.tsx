"use client";

import { useMemo } from "react";
import { Command as CommandRoot, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { KeySequence, useCommandRegistry, type Command } from "./commands";

// Page actions come first, then creation, navigation and help.
const GROUP_ORDER = ["This page", "Create", "Live now", "Go to", "Switch organization", "Help"];

/** ⌘K: every action registered by the shell and the page that is open. */
export function CommandMenu() {
  const { commands, menuOpen, setMenuOpen, context } = useCommandRegistry();
  const groups = useMemo(() => {
    const byGroup = new Map<string, Command[]>();
    for (const command of commands) byGroup.set(command.group, [...(byGroup.get(command.group) ?? []), command]);
    return [...byGroup.entries()].sort(([a], [b]) => rank(a) - rank(b));
  }, [commands]);

  return <CommandDialog open={menuOpen} onOpenChange={setMenuOpen} title="Command menu" description="Search for an action or a page" className="dq-command sm:max-w-[560px]">
    <CommandRoot loop>
      {context && <div className="dq-command-context"><span className="dq-label">{context}</span></div>}
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matching actions.</CommandEmpty>
        {groups.map(([group, items]) => <CommandGroup key={group} heading={group}>
          {items.map((command) => <CommandItem key={command.id} value={`${command.label} ${command.hint ?? ""} ${group}`} disabled={command.disabled} onSelect={() => { setMenuOpen(false); command.run(); }}>
            <span className="min-w-0 flex-1 truncate">{command.label}</span>
            {command.hint && <span className="dq-command-hint">{command.hint}</span>}
            {command.keys && <KeySequence keys={command.keys} />}
          </CommandItem>)}
        </CommandGroup>)}
      </CommandList>
    </CommandRoot>
  </CommandDialog>;
}

function rank(group: string) {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}
