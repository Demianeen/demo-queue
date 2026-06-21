"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";
import { env } from "./env";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    return new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);
  }, []);

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
