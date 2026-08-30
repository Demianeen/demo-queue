import type { Metadata } from "next";
import JudgeClientPage from "./ClientPage";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Judge", robots: { index: false, follow: false } };
}

export default function JudgePage() {
  return <JudgeClientPage />;
}
