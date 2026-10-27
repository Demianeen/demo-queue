import type { Metadata } from "next";
import ClientPage from "./ClientPage";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <ClientPage />;
}
