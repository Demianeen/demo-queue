"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeySequence, useCommandRegistry } from "./commands";

const ALWAYS = [
  { label: "Command menu", keys: ["⌘", "K"], chord: true },
  { label: "Toggle sidebar", keys: ["⌘", "B"], chord: true },
  { label: "Keyboard shortcuts", keys: ["?"], chord: false },
];

/** `?`: every shortcut that works on the page that is open, grouped like the command menu. */
export function ShortcutSheet() {
  const { commands, sheetOpen, setSheetOpen, context } = useCommandRegistry();
  const groups = useMemo(() => {
    const byGroup = new Map<string, { label: string; keys: string[] }[]>();
    for (const command of commands) {
      if (!command.keys || command.id === "shortcuts") continue;
      const group = command.group === "This page" && context ? context : command.group;
      byGroup.set(group, [...(byGroup.get(group) ?? []), { label: command.label, keys: command.keys }]);
    }
    return [...byGroup.entries()];
  }, [commands, context]);

  return <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
    <DialogContent className="dq-shortcut-sheet sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Single keys work when you are not typing in a field.</DialogDescription>
      </DialogHeader>
      <div className="dq-shortcut-groups">
        <section><h3 className="dq-label">General</h3><dl>{ALWAYS.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><KeySequence keys={item.keys} chord={item.chord} /></dd></div>)}</dl></section>
        {groups.map(([group, items]) => <section key={group}><h3 className="dq-label">{group}</h3><dl>{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><KeySequence keys={item.keys} /></dd></div>)}</dl></section>)}
      </div>
    </DialogContent>
  </Dialog>;
}
