"use client";

import "./globals.css";
import { useReportedError } from "@/lib/posthog-browser";

// Replaces the root layout when it fails, so it brings its own html and body.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportedError(error, "root");
  return (
    <html lang="en">
      <body>
        <main className="narrow-page">
          <section className="panel panel-pad" style={{ width: "min(560px, 100%)" }}>
            <p className="eyebrow">Demo Queue</p>
            <h1 style={{ fontSize: "clamp(26px, 3vw, 34px)", lineHeight: 1.1 }}>Something went wrong.</h1>
            <p className="lead">This page couldn&apos;t load. Please try again.</p>
            <div className="actions">
              <button className="button" type="button" onClick={() => reset()}>Try again</button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
