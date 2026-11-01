"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useReportedError } from "@/lib/posthog-browser";

export default function EventsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportedError(error, "workspace");
  return <main className="dq-app dq-message-page"><section className="dq-card dq-message">
    <Alert variant="destructive"><AlertTitle>Events are unavailable</AlertTitle><AlertDescription>We couldn’t verify your access or load your events. Please try again.</AlertDescription></Alert>
    <div className="dq-message-actions"><Button onClick={reset}>Try again</Button><Button variant="ghost" render={<a href="/events/sign-in" />} nativeButton={false}>Sign in again</Button></div>
  </section></main>;
}
