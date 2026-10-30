import { AiUsage } from "@/components/usage/AiUsage";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI usage" };

// The workspace layout signs the person in and provides the auth context.
export default function AiUsagePage() {
  return <AiUsage />;
}
