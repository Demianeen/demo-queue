"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useReportedError } from "@/lib/posthog-browser";

/**
 * A link that was replaced, turned off or mistyped makes the judge queries
 * throw. Judges see what to do instead of the browser's crash page.
 */
export default function JudgeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportedError(error, "judge");
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
    <Alert variant="destructive">
      <AlertTitle>This judging link isn&apos;t working</AlertTitle>
      <AlertDescription>It may have been replaced or turned off by the organisers. Ask them for your current link. Scores you already gave are kept.</AlertDescription>
    </Alert>
    <div><Button onClick={reset}>Try again</Button></div>
  </main>;
}
