import { McpConnectionPage } from "@/components/McpConnectionPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an assistant" };

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request } = await searchParams;
  return <McpConnectionPage requestId={request} />;
}
