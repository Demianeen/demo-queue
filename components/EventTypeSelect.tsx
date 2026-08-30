"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { VisualStyle } from "@/lib/visual-style"

export type EventType = "demo" | "hackathon"

const EVENT_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: EventType }> = [
  { label: "Demo queue", value: "demo" },
  { label: "Hackathon", value: "hackathon" },
]

export function EventTypeSelect({
  id,
  onValueChange,
  value,
  visualStyle = "codex",
}: {
  id: string
  onValueChange: (value: EventType) => void
  value: EventType
  visualStyle?: VisualStyle
}) {
  const isOutpost = visualStyle === "outpost"

  return (
    <Select<EventType>
      items={EVENT_TYPE_OPTIONS}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onValueChange(nextValue)
      }}
    >
      <SelectTrigger
        id={id}
        className={cn(
          isOutpost &&
            "rounded-sm !border-[#aaa69f] bg-[#f8f6f0]/70 focus-visible:!border-[#111212] focus-visible:ring-2 focus-visible:ring-black/10 data-[popup-open]:!border-[#111212] data-[popup-open]:bg-[#f8f6f0] data-[popup-open]:ring-2 data-[popup-open]:ring-black/10"
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        className={cn(isOutpost && "rounded-sm bg-[#f4f1e9] text-[#111212] ring-black/20")}
      >
        {EVENT_TYPE_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className={cn(
              isOutpost &&
                "rounded-sm data-[highlighted]:bg-[#111212] data-[highlighted]:text-[#f4f1e9] data-[selected]:bg-[#111212] data-[selected]:text-[#f4f1e9]"
            )}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
