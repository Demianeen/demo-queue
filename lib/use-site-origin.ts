"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const serverOrigin = () => "";
const browserOrigin = () => window.location.origin;

// Hydrate with the same relative URLs as the server; then resolve browser origin.
export function useSiteOrigin() {
  return useSyncExternalStore(subscribe, browserOrigin, serverOrigin);
}
