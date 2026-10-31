import type { Metadata } from "next";
import ClientPage from "./ClientPage";
import { eventLook, eventTitle } from "@/app/metadata";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const title = await eventTitle(slug);

  return {
    title: title ? `Submit - ${title}` : "Submit",
  };
}

export default async function SubmissionPage({ params }: PageProps) {
  const { slug } = await params;
  return <ClientPage look={await eventLook(slug)} />;
}
