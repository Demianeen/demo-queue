"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function WorkspaceSignInNotice() {
  const searchParams = useSearchParams();
  if (!searchParams.has("error")) return null;
  return <Alert variant="destructive"><AlertDescription>Sign-in could not be completed. Please try again with your invited account.</AlertDescription></Alert>;
}

export function WorkspaceSignInLink({ children, className }: { children: React.ReactNode; className?: string }) {
  const pathname = usePathname();
  return <a className={className} href={`/events/sign-in?returnTo=${encodeURIComponent(pathname)}`}>{children}</a>;
}
