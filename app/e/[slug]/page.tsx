"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { participantPath } from "@/lib/routes";
import { randomQueueOrder, randomToken } from "@/lib/tokens";
import { isValidLinkedin, isValidPhone, isValidTwitter } from "@/lib/validation";
import { Brand } from "@/app/Brand";

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
  const [twitterError, setTwitterError] = useState("");
  const [linkedinError, setLinkedinError] = useState("");
  const [phoneError, setPhoneError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();

    const phone = read("phone");
    const twitter = read("twitter");
    const linkedin = read("linkedin");

    setSocialError("");
    setTwitterError("");
    setLinkedinError("");
    setPhoneError("");

    let valid = true;
    if (!isValidPhone(phone)) {
      setPhoneError("Enter a valid phone number (7-15 digits).");
      valid = false;
    }
    // Cross-field rule: at least one social is required (native `required`
    // only validates a single field, not "one of this group").
    if (!twitter && !linkedin) {
      setSocialError("Add at least one of Twitter/X or LinkedIn so the team can connect with you after.");
      valid = false;
    }
    // Format checks so a stray paste (e.g. the helper text) can't slip through.
    if (twitter && !isValidTwitter(twitter)) {
      setTwitterError("Enter an @handle or an x.com / twitter.com link.");
      valid = false;
    }
    if (linkedin && !isValidLinkedin(linkedin)) {
      setLinkedinError("Enter a linkedin.com/in/... link.");
      valid = false;
    }
    if (!valid) {
      return;
    }
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
        <Brand label={stage?.event.name ?? "Demo Queue"} />
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
              <input id="name" name="name" placeholder="Your full name" required />
            </div>

            <div className="field">
              <label htmlFor="demoTitle">Demo title<Req /></label>
              <input id="demoTitle" name="demoTitle" placeholder="What are you demoing?" required />
            </div>

            <div className="field">
              <label htmlFor="description">Short description<Req /></label>
              <textarea
                id="description"
                name="description"
                placeholder="One or two lines about your demo"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="phone">Phone number<Req /></label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                placeholder="+1 555 123 4567"
                required
              />
              {phoneError ? (
                <span style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600 }}>{phoneError}</span>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="email">Email<Req /></label>
              <input id="email" name="email" type="email" placeholder="you@example.com" required />
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
              <input id="twitter" name="twitter" placeholder="@handle or x.com/handle" />
              {twitterError ? (
                <span style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600 }}>{twitterError}</span>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="linkedin">LinkedIn</label>
              <input id="linkedin" name="linkedin" placeholder="linkedin.com/in/you" />
              {linkedinError ? (
                <span style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600 }}>{linkedinError}</span>
              ) : null}
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
