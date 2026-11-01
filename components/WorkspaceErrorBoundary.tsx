"use client";

import { Component, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/posthog-browser";

export class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { reportClientError(error, { boundary: "workspace_shell" }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="dq-app dq-message-page"><section className="dq-card dq-message">
      <title>Workspace unavailable | Demo Queue</title>
      <Alert variant="destructive"><AlertTitle>Workspace unavailable</AlertTitle><AlertDescription>We couldn’t verify your session or update your workspace. Reload to try again.</AlertDescription></Alert>
      <div className="dq-message-actions"><Button onClick={() => window.location.reload()}>Reload workspace</Button><Button variant="ghost" render={<a href="/events/sign-in" />} nativeButton={false}>Sign in again</Button></div>
    </section></main>;
  }
}
