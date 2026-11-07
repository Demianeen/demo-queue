import type { Metadata } from "next";
import ClientPage from "./ClientPage";
import { eventLook, eventTitle } from "@/app/metadata";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  return {
    title: `Submit - ${await eventTitle(slug)}`,
  };
}

export default async function SubmissionPage({ params }: PageProps) {
  const { slug } = await params;
  return <ClientPage look={await eventLook(slug)} />;
}
