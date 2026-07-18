"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type EventType = "demo" | "hackathon"

const EVENT_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: EventType }> = [
  { label: "Demo queue", value: "demo" },
  { label: "Hackathon", value: "hackathon" },
]

export function EventTypeSelect({
  id,
  onValueChange,
  value,
}: {
  id: string
  onValueChange: (value: EventType) => void
  value: EventType
}) {
  return (
    <Select<EventType>
      items={EVENT_TYPE_OPTIONS}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onValueChange(nextValue)
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EVENT_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
