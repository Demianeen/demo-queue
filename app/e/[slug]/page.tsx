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
    title: title ? `Submit - ${title}` : "Submit",
  };
}

export default function SubmissionPage() {
  return <ClientPage />;
}
