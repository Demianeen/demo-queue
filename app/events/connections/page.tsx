import { McpConnectionPage } from "@/components/McpConnectionPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connected assistants" };

export default function ConnectionsPage() {
  return <McpConnectionPage settings />;
}
