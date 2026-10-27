"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";
import { getEnv } from "./env";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    return new ConvexReactClient(getEnv().NEXT_PUBLIC_CONVEX_URL);
  }, []);

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
