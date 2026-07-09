import type { Metadata } from "next";
import ClientPage from "./ClientPage";
import { eventTitle } from "@/app/metadata";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const title = await eventTitle(slug);

  return {
    title: title ? `Presentation - ${title}` : "Presentation",
  };
}

export default function StagePage() {
  return <ClientPage />;
}
