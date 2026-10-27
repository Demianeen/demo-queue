"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorkspaceSignInNotice } from "@/components/WorkspaceSignInLink";
import styles from "./WorkspaceLogin.module.css";
import type { OrganizationSelectionView } from "@/lib/google-auth-flow";

export function WorkspaceLogin({ unavailable = false, organizationSelection }: { unavailable?: boolean; organizationSelection?: OrganizationSelectionView }) {
  const pathname = usePathname();

  return (
    <main className={styles.login}>
      <title>{organizationSelection ? "Choose organization" : "Sign in"} | Demo Queue</title>
      <section className={styles.stage} aria-label="Demo Queue">
        <Image src="/sign-in-stage.png" alt="" fill priority sizes="(max-width: 700px) 100vw, 45vw" className={styles.stageImage} />
        <Link href="/events" className={styles.brand}>Demo Queue</Link>
        <p className={styles.tagline}>Good ideas deserve a stage.</p>
      </section>
      <section className={styles.panel} aria-labelledby="sign-in-heading">
        <div className={styles.content}>
          <h1 id="sign-in-heading">{organizationSelection ? "Where are you hosting?" : <>Your next demo night<br className={styles.headlineBreak} /> starts here.</>}</h1>
          <p className={styles.description}>{organizationSelection ? "Choose an organization to finish signing in. You can switch organizations in your workspace." : "Sign in to manage events across your organizations."}</p>
          {organizationSelection ? <form method="post" action={`/events/choose-organization/complete?flow=${encodeURIComponent(organizationSelection.flowId)}`} className={styles.organizationChoices}>
            <input type="hidden" name="csrf" value={organizationSelection.csrf} />
            {organizationSelection.organizations.map((organization) => <Button key={organization.id} type="submit" name="organizationId" value={organization.id} className={styles.organizationButton}>{organization.name}</Button>)}
            <a href={`/events/sign-in?returnTo=${encodeURIComponent(organizationSelection.returnTo)}`} className={styles.startAgain}>Use a different Google account</a>
          </form> : unavailable ? <p role="status" className={styles.unavailable}>Event login is not configured yet. Please check back once authentication setup is complete.</p> : <>
            <WorkspaceSignInNotice />
            <a href={`/events/sign-in?returnTo=${encodeURIComponent(pathname)}`} className={`${buttonVariants()} ${styles.googleButton}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://developers.google.com/identity/images/g-logo.png" alt="" width="24" height="24" />
              Continue with Google
            </a>
          </>}
          <p className={styles.invitation}>For invited organizers only.</p>
        </div>
      </section>
    </main>
  );
}
