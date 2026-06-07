"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const client = useMemo(() => {
    if (!convexUrl) {
      return null;
    }
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!client) {
    return (
      <main className="config-screen">
        <section className="config-panel">
          <p className="eyebrow">Setup required</p>
          <h1>Connect Convex to run Demo Queue</h1>
          <p>
            Run <code>pnpm convex:dev</code> and copy the generated{" "}
            <code>NEXT_PUBLIC_CONVEX_URL</code> into <code>.env.local</code>.
          </p>
        </section>
      </main>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
