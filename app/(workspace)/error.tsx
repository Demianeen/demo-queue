"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";

export default function EventsError({ reset }: { reset: () => void }) {
  return <main className="workspace workspace-sign-in"><section className="workspace-login-content">
    <Alert variant="destructive"><AlertTitle>Events are unavailable</AlertTitle><AlertDescription>We couldn’t verify your access or load your events. Please try again.</AlertDescription></Alert>
    <div className="actions"><button className="button" onClick={reset}>Try again</button><a className="button ghost" href="/events/sign-in">Sign in again</a><Link href="/saved">Saved event links</Link></div>
  </section></main>;
}
