import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminPath } from "@/lib/routes";

type PageProps = {
  params: Promise<{ slug: string; token: string }>;
};

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminPage({ params }: PageProps) {
  const { slug } = await params;
  redirect(adminPath(slug));
}
