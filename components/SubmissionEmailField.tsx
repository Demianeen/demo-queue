"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { browserClientId } from "@/lib/client-id";
import type { LumaSocials } from "@/lib/luma";
import { emailKey, isValidEmail } from "@/lib/validation";

const CHECK_DELAY_MS = 350;
// Longer than the taken check, so a half-typed address is not sent to Luma.
const LUMA_DELAY_MS = 900;

export const EMAIL_TAKEN_MESSAGE = "You already submitted with this email. Check your inbox for your status link.";

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Checks, while the person types, whether this email already submitted to the
 * event (as a presenter or a team member). The server enforces the same rule
 * on submit, so a failed or rate limited check just shows nothing.
 */
export function useEmailTaken(slug: string, email: string) {
  const check = useMutation(api.events.checkSubmissionEmail);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const trimmed = email.trim();
  const debounced = useDebounced(trimmed, CHECK_DELAY_MS);
  const key = emailKey(debounced);
  // The server refuses malformed emails, so only well-formed ones are checked.
  const ready = debounced === trimmed && isValidEmail(key);
  const known = ready && key in answers;

  useEffect(() => {
    if (!ready || known) return;
    let current = true;
    check({ slug, email: debounced, clientId: browserClientId() })
      .then((result) => current && setAnswers((previous) => ({ ...previous, [key]: result.taken })))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [check, debounced, key, known, ready, slug]);

  return ready && answers[key] === true;
}

/**
 * Once the person stops typing a well-formed email, asks the event's Luma
 * registrations for their X, LinkedIn and GitHub (once per address). Any
 * failure is ignored: the form works the same without it.
 */
function useLumaSocials(slug: string, email: string, enabled: boolean, onFound?: (socials: LumaSocials) => void) {
  const lookup = useAction(api.luma.lookupLumaSocials);
  const trimmed = email.trim();
  const debounced = useDebounced(trimmed, LUMA_DELAY_MS);
  const asked = useRef(new Set<string>());
  const found = useRef(onFound);
  useEffect(() => {
    found.current = onFound;
  }, [onFound]);
  useEffect(() => {
    if (!enabled || debounced !== trimmed) return;
    const key = emailKey(debounced);
    const askedEmails = asked.current;
    if (!isValidEmail(key) || askedEmails.has(key)) return;
    askedEmails.add(key);
    let current = true;
    let answered = false;
    lookup({ slug, email: debounced })
      .then((socials) => {
        answered = true;
        if (current && Object.keys(socials).length > 0) found.current?.(socials);
      })
      .catch(() => {
        answered = true;
      });
    return () => {
      current = false;
      // Changed before the answer came: ask again if they come back to it.
      if (!answered) askedEmails.delete(key);
    };
  }, [debounced, enabled, lookup, slug, trimmed]);
}

export function SubmissionEmailField({
  slug,
  id,
  name,
  label,
  value,
  onChange,
  onTakenChange,
  error,
  placeholder,
  autoComplete,
  maxLength,
  lumaLinked = false,
  onLumaSocials,
}: {
  slug: string;
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onTakenChange: (taken: boolean) => void;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength: number;
  /** The event is linked to Luma, so socials can be prefilled from this email. */
  lumaLinked?: boolean;
  onLumaSocials?: (socials: LumaSocials) => void;
}) {
  const taken = useEmailTaken(slug, value);
  useLumaSocials(slug, value, lumaLinked && !taken, onLumaSocials);
  useEffect(() => onTakenChange(taken), [taken, onTakenChange]);
  const errorId = `${id}-error`;
  const takenId = `${id}-taken`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        aria-describedby={[taken && takenId, error && errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={Boolean(taken || error) || undefined}
        autoComplete={autoComplete}
        id={id}
        maxLength={maxLength}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        type="email"
        value={value}
      />
      {error && !taken ? (
        <span className="form-error" id={errorId}>
          {error}
        </span>
      ) : null}
      {taken ? <EmailTakenNotice email={value.trim()} id={takenId} key={value.trim().toLowerCase()} slug={slug} /> : null}
    </div>
  );
}

function EmailTakenNotice({ slug, email, id }: { slug: string; email: string; id: string }) {
  const requestLink = useMutation(api.events.requestStatusLinkEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function send() {
    setState("sending");
    try {
      await requestLink({ slug, email });
      setState("sent");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="email-taken" id={id} role="alert">
      <span>{EMAIL_TAKEN_MESSAGE}</span>
      {state === "sent" ? (
        <span className="email-taken-sent" role="status">
          Sent. It can take a minute to arrive.
        </span>
      ) : (
        <button className="email-taken-button" disabled={state === "sending"} onClick={send} type="button">
          {state === "sending" ? "Sending..." : state === "failed" ? "Try again" : "Email me the link again"}
        </button>
      )}
    </div>
  );
}
