"use client";

import { createContext } from "react";

// The shared layout can outlive a server page during client navigation.
export const WorkspaceOrganizationContext = createContext<string | undefined>(undefined);
