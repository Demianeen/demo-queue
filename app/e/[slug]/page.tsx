"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { participantPath } from "@/lib/routes";
import { randomQueueOrder, randomToken } from "@/lib/tokens";

function Req() {
  return <span style={{ color: "var(--app-bad)" }}> *</span>;
}

export default function SubmissionPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const stage = useQuery(api.events.getStage, { slug: params.slug });
  const submitDemo = useMutation(api.events.submitDemo);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [socialError, setSocialError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();

    const twitter = read("twitter");
    const linkedin = read("linkedin");

    // Cross-field rule: at least one social is required (native `required`
    // only validates a single field, not "one of this group").
    if (!twitter && !linkedin) {
      setSocialError("Add at least one of Twitter/X or LinkedIn so the team can connect with you after.");
      return;
    }
    setSocialError("");
    setIsSubmitting(true);

    const participantToken = randomToken(32);
    try {
      await submitDemo({
        slug: params.slug,
        participantToken,
        name: read("name"),
        demoTitle: read("demoTitle"),
        description: read("description"),
        phone: read("phone"),
        email: read("email") || undefined,
        category: read("category") || undefined,
        twitter: twitter || undefined,
        linkedin: linkedin || undefined,
        queueOrder: randomQueueOrder(),
      });
      router.push(participantPath(params.slug, participantToken));
    } catch {
      setIsSubmitting(false);
      setSocialError("Something went wrong submitting. Please try again.");
    }
  }

  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}>
        <p className="eyebrow">{stage?.event.name ?? "Demo Queue"}</p>
        <h1>Submit your demo.</h1>
        <p className="lead">
          You will get a private status link after submitting. The Meet link appears there only when
          you are up next or presenting.
        </p>

        <form className="form" onSubmit={onSubmit} style={{ marginTop: 24 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <h2 style={{ fontSize: 18, marginBottom: 0 }}>Demo info</h2>
            <div className="field">
              <label htmlFor="name">Your name<Req /></label>
              <input id="name" name="name" required />
            </div>

            <div className="field">
              <label htmlFor="demoTitle">Demo title<Req /></label>
              <input id="demoTitle" name="demoTitle" required />
            </div>

            <div className="field">
              <label htmlFor="description">Short description<Req /></label>
              <textarea id="description" name="description" required />
            </div>

            <div className="field">
              <label htmlFor="phone">Phone number<Req /></label>
              <input id="phone" name="phone" required />
            </div>

            <div className="field">
              <label htmlFor="email">Email<Req /></label>
              <input id="email" name="email" type="email" required />
            </div>

            <div className="field">
              <label htmlFor="category">Category, optional</label>
              <input id="category" name="category" placeholder="AI, devtools, consumer, hardware..." />
            </div>
          </div>

          <div style={{ display: "grid", gap: 14, marginTop: 10 }}>
            <h2 style={{ fontSize: 18, marginBottom: 0 }}>Socials</h2>
            <p className="muted" style={{ marginTop: -4 }}>
              Add at least one so the event team can connect with you after.
            </p>

            <div className="field">
              <label htmlFor="twitter">Twitter/X</label>
              <input id="twitter" name="twitter" />
            </div>

            <div className="field">
              <label htmlFor="linkedin">LinkedIn</label>
              <input id="linkedin" name="linkedin" />
            </div>

            {socialError ? (
              <p style={{ color: "var(--app-bad)", fontWeight: 600, marginTop: 2 }}>{socialError}</p>
            ) : null}
          </div>

          <div className="actions">
            <button className="button" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Submitting..." : "Join the queue"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
