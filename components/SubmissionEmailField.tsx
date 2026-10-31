"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { browserClientId } from "@/lib/client-id";
import { emailKey, isValidEmail } from "@/lib/validation";

const CHECK_DELAY_MS = 350;

export const EMAIL_TAKEN_MESSAGE = "You already submitted with this email. Check your inbox for your status link.";

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type EmailCheck = (args: { slug: string; email: string; clientId: string }) => Promise<{ taken: boolean }>;

/** Replaces the server check: the style preview's sample form uses it, so typing there reaches no event. */
export const EmailCheckOverride = createContext<EmailCheck | null>(null);

/**
 * Checks, while the person types, whether this email already submitted to the
 * event (as a presenter or a team member). The server enforces the same rule
 * on submit, so a failed or rate limited check just shows nothing.
 */
export function useEmailTaken(slug: string, email: string) {
  const serverCheck = useMutation(api.events.checkSubmissionEmail);
  const check = useContext(EmailCheckOverride) ?? serverCheck;
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

export function SubmissionEmailField({
  slug,
  id,
  name,
  label,
  help,
  value,
  onChange,
  onTakenChange,
  error,
  placeholder,
  autoComplete,
  maxLength,
}: {
  slug: string;
  id: string;
  name: string;
  label: ReactNode;
  help?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onTakenChange: (taken: boolean) => void;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength: number;
}) {
  const taken = useEmailTaken(slug, value);
  useEffect(() => onTakenChange(taken), [taken, onTakenChange]);
  const errorId = `${id}-error`;
  const takenId = `${id}-taken`;
  const helpId = `${id}-help`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        aria-describedby={[help && helpId, taken && takenId, error && errorId].filter(Boolean).join(" ") || undefined}
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
      {help ? (
        <span className="muted form-help" id={helpId}>
          {help}
        </span>
      ) : null}
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
