import type { Metadata } from "next";
import AdminSubmissionReviewPage from "./ClientPage";

export const metadata: Metadata = {
  title: "Project review",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AdminSubmissionReviewPage />;
}
