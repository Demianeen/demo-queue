"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EventCreator } from "@/components/EventCreator";

export default function HomePage() {
  const createEvent = useMutation(api.events.createEvent);
  return <EventCreator createEvent={createEvent} />;
}
