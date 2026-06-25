import type { Metadata } from "next";
import ClientPage from "./ClientPage";
import { adminEventTitle } from "@/app/metadata";

type PageProps = {
  params: Promise<{ slug: string; token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, token } = await params;
  const title = await adminEventTitle(slug, token);

  return {
    title: title ? `Admin - ${title}` : "Admin",
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function AdminPage() {
  return <ClientPage />;
}
