"use client";

import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useReportedError } from "@/lib/posthog-browser";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportedError(error, "event_admin");
  return <section className="workspace-heading">
    <title>Event controls unavailable | Demo Queue</title>
    <Alert variant="destructive">
      <AlertTitle>Event controls unavailable</AlertTitle>
      <AlertDescription>We couldn’t verify your access or update this event. Check your organization and try again.</AlertDescription>
    </Alert>
    <div className="actions">
      <Button onClick={reset}>Try again</Button>
      <Link href="/events">Back to events</Link>
    </div>
  </section>;
}
