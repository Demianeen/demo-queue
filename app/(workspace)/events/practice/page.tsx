import { PracticeEvents } from "@/components/live/PracticeEvents";

export const dynamic = "force-dynamic";
export const metadata = { title: "Practice" };

// The workspace layout signs the person in and provides the auth context.
export default function PracticePage() {
  return <PracticeEvents />;
}
