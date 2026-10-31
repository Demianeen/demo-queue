import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parsePreviewPage, parsePreviewStyle } from "@/lib/style-preview";
import ClientPage from "./ClientPage";

type PageProps = {
  params: Promise<{ style: string; page: string }>;
};

// Sample pages: never indexed, and nothing here reads or writes an event.
export const metadata: Metadata = {
  title: "Style preview",
  robots: { index: false, follow: false },
};

export default async function StylePreviewPage({ params }: PageProps) {
  const { style, page } = await params;
  const previewStyle = parsePreviewStyle(decodeURIComponent(style));
  const previewPage = parsePreviewPage(page);
  if (!previewStyle || !previewPage) notFound();
  return <ClientPage style={previewStyle} page={previewPage} />;
}
