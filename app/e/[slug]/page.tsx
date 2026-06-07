"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { participantPath } from "@/lib/routes";
import { randomQueueOrder, randomToken } from "@/lib/tokens";

export default function SubmissionPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const stage = useQuery(api.events.getStage, { slug: params.slug });
  const submitDemo = useMutation(api.events.submitDemo);
  const generateUploadUrl = useMutation(api.events.generateUploadUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const participantToken = randomToken(32);
    const screenshot = form.get("screenshot");
    let screenshotId: Id<"_storage"> | undefined;

    if (screenshot instanceof File && screenshot.size > 0) {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": screenshot.type },
        body: screenshot,
      });
      const json = await result.json();
      screenshotId = json.storageId as Id<"_storage">;
    }

    await submitDemo({
      slug: params.slug,
      participantToken,
      name: String(form.get("name") || ""),
      demoTitle: String(form.get("demoTitle") || ""),
      description: String(form.get("description") || ""),
      phone: String(form.get("phone") || ""),
      email: String(form.get("email") || "") || undefined,
      twitter: String(form.get("twitter") || "") || undefined,
      linkedin: String(form.get("linkedin") || "") || undefined,
      category: String(form.get("category") || "") || undefined,
      screenshotId,
      queueOrder: randomQueueOrder(),
    });

    router.push(participantPath(params.slug, participantToken));
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

        <form className="form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" name="name" required />
          </div>

          <div className="field">
            <label htmlFor="demoTitle">Demo title</label>
            <input id="demoTitle" name="demoTitle" required />
          </div>

          <div className="field">
            <label htmlFor="description">Short description</label>
            <textarea id="description" name="description" required />
          </div>

          <div className="field">
            <label htmlFor="phone">Phone number</label>
            <input id="phone" name="phone" required />
          </div>

          <div className="field">
            <label htmlFor="email">Email, optional</label>
            <input id="email" name="email" type="email" />
          </div>

          <div className="field">
            <label htmlFor="twitter">Twitter/X, optional</label>
            <input id="twitter" name="twitter" />
          </div>

          <div className="field">
            <label htmlFor="linkedin">LinkedIn, optional</label>
            <input id="linkedin" name="linkedin" />
          </div>

          <div className="field">
            <label htmlFor="category">Category, optional</label>
            <input id="category" name="category" placeholder="AI, devtools, consumer, hardware..." />
          </div>

          <div className="field">
            <label htmlFor="screenshot">Screenshot, optional</label>
            <input accept="image/*" id="screenshot" name="screenshot" type="file" />
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
