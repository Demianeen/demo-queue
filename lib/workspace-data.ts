import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type WorkspaceData = {
  events: FunctionReturnType<typeof api.events.listOrganizationEvents>;
  styles: FunctionReturnType<typeof api.organizationStyles.list>;
};
