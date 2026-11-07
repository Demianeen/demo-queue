import type { Metadata } from "next";
import ClientPage from "./ClientPage";
import { eventLook, eventTitle } from "@/app/metadata";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  return {
    title: `Presentation - ${await eventTitle(slug)}`,
  };
}

export default async function StagePage({ params }: PageProps) {
  const { slug } = await params;
  await eventLook(slug);
  return <ClientPage />;
}
