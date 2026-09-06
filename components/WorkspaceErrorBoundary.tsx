"use client";

import { Component, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="workspace workspace-sign-in"><section className="workspace-login-content">
      <title>Workspace unavailable | Demo Queue</title>
      <Alert variant="destructive"><AlertTitle>Workspace unavailable</AlertTitle><AlertDescription>We couldn’t verify your session or update your workspace. Reload to try again.</AlertDescription></Alert>
      <Button onClick={() => window.location.reload()}>Reload workspace</Button>
      <a href="/events/sign-in">Sign in again</a>
    </section></main>;
  }
}
