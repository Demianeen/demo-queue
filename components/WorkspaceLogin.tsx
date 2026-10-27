"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { WorkspaceSignInNotice } from "@/components/WorkspaceSignInLink";
import styles from "./WorkspaceLogin.module.css";

export function WorkspaceLogin({ unavailable = false }: { unavailable?: boolean }) {
  const pathname = usePathname();

  return (
    <main className={styles.login}>
      <title>Sign in | Demo Queue</title>
      <section className={styles.stage} aria-label="Demo Queue">
        <Image src="/sign-in-stage.png" alt="" fill priority sizes="(max-width: 700px) 100vw, 45vw" className={styles.stageImage} />
        <Link href="/events" className={styles.brand}>Demo Queue</Link>
        <p className={styles.tagline}>Good ideas deserve a stage.</p>
      </section>
      <section className={styles.panel} aria-labelledby="sign-in-heading">
        <div className={styles.content}>
          <h1 id="sign-in-heading">Your next demo night<br className={styles.headlineBreak} /> starts here.</h1>
          <p className={styles.description}>Sign in to manage events across your organizations.</p>
          {unavailable ? <p role="status" className={styles.unavailable}>Event login is not configured yet. Please check back once authentication setup is complete.</p> : <>
            <WorkspaceSignInNotice />
            <Button nativeButton={false} render={<a href={`/events/sign-in?returnTo=${encodeURIComponent(pathname)}`} />} className={styles.googleButton}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://developers.google.com/identity/images/g-logo.png" alt="" width="24" height="24" />
              Continue with Google
            </Button>
          </>}
          <p className={styles.invitation}>For invited organizers only.</p>
        </div>
      </section>
    </main>
  );
}
