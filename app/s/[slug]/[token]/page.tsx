import type { Metadata } from "next";
import ClientPage from "./ClientPage";
import { participantTitle } from "@/app/metadata";

type PageProps = {
  params: Promise<{ slug: string; token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, token } = await params;
  const participant = await participantTitle(slug, token);

  return {
    title: participant ? `Status - ${participant.eventName}` : "Status",
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function ParticipantStatusPage() {
  return <ClientPage />;
}
