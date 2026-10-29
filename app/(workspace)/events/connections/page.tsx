import { McpConnectionClient } from "@/components/McpConnectionClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

// The workspace layout signs the person in and provides the auth context.
export default function ConnectionsPage() {
  return <McpConnectionClient settings />;
}
