"use client";

import { FormEvent, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { ExternalLinkIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return message.includes("ConvexError") ? message.split("ConvexError: ").pop()?.split("\n")[0] ?? message : message;
}

const HELP =
  "After a team submits, X, LinkedIn and GitHub they left empty are filled in from each person's Luma registration. The Luma registration form needs X, LinkedIn and GitHub questions.";

/**
 * Links the event to its Luma event, so empty socials are imported from each
 * person's Luma registration after they submit. Only organisations that own
 * the deployment's Luma calendar can link.
 */
export function LumaEventSetting({
  slug,
  available,
  lumaEvent,
}: {
  slug: string;
  available: boolean;
  lumaEvent: { id: string; name: string; url: string | null } | null;
}) {
  const link = useAction(api.luma.linkLumaEvent);
  const unlink = useMutation(api.luma.unlinkLumaEvent);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await link({ slug, lumaEvent: value });
      setValue("");
      setEditing(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await unlink({ slug });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const showForm = !lumaEvent || editing;
  if (!available) {
    return (
      <div className="field admin-luma-setting">
        <label htmlFor="lumaEvent">Luma event</label>
        <input disabled id="lumaEvent" placeholder="Not available" value="" readOnly />
        <span className="muted form-help">Luma import is not available for this organization.</span>
      </div>
    );
  }
  return (
    <div className="field admin-luma-setting">
      <label htmlFor="lumaEvent">Luma event</label>
      {lumaEvent && !editing ? (
        <div className="admin-luma-linked">
          <span>
            Linked to{" "}
            {lumaEvent.url ? (
              <a href={lumaEvent.url} rel="noreferrer" target="_blank">
                {lumaEvent.name} <ExternalLinkIcon aria-hidden="true" />
              </a>
            ) : (
              <strong>{lumaEvent.name}</strong>
            )}
          </span>
          <span className="admin-luma-actions">
            <Button disabled={busy} onClick={() => setEditing(true)} size="sm" type="button" variant="outline">Change</Button>
            <Button disabled={busy} onClick={() => void remove()} size="sm" type="button" variant="outline">Unlink</Button>
          </span>
        </div>
      ) : null}
      {showForm ? (
        <form className="admin-luma-form" onSubmit={save}>
          <input
            aria-describedby={error ? "lumaEvent-error lumaEvent-help" : "lumaEvent-help"}
            aria-invalid={Boolean(error) || undefined}
            autoComplete="off"
            id="lumaEvent"
            maxLength={300}
            onChange={(event) => setValue(event.target.value)}
            placeholder="luma.com/your-event or evt-..."
            required
            value={value}
          />
          <Button disabled={busy || !value.trim()} size="sm" type="submit">{busy ? "Checking..." : "Link"}</Button>
          {editing ? (
            <Button disabled={busy} onClick={() => { setEditing(false); setError(""); }} size="sm" type="button" variant="outline">Cancel</Button>
          ) : null}
        </form>
      ) : null}
      {error ? <span className="form-error" id="lumaEvent-error" role="alert">{error}</span> : null}
      <span className="muted form-help" id="lumaEvent-help">{HELP}</span>
    </div>
  );
}
