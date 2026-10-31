"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Ellipsis, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ShortcutTooltip, useCommands } from "@/components/shell/commands";
import { checkInviteEmails, initials, invitationStatus, INVITE_PROBLEM_MESSAGES, MAX_INVITES_PER_REQUEST, shortDate, splitEmails } from "@/lib/members";
import type { InvitationRow, MemberRow, MembersAccess, MembersOverview } from "@/lib/workos-members";
import { inviteMembers, removeMember, resendInvitation, revokeInvitation, type ActionResult } from "@/app/(workspace)/members/actions";
import { cn } from "@/lib/utils";

function plural(count: number, word: string) { return `${count} ${word}${count === 1 ? "" : "s"}`; }

const INVITE_INPUT_ID = "invite-emails";
function focusInvite() { document.getElementById(INVITE_INPUT_ID)?.focus(); }

/** Dates use the viewer's time zone once mounted; the server renders UTC. */
function useTimeZone() {
  const [timeZone, setTimeZone] = useState<string | undefined>("UTC");
  useEffect(() => { setTimeZone(undefined); }, []);
  return timeZone;
}

/** The page header's action: puts the cursor in the invite field. I does the same. */
export function InvitePeopleAction() {
  return <ShortcutTooltip label="Invite people" keys={["I"]}><Button size="sm" onClick={focusInvite}>Invite people<kbd className="ws-kbd" aria-hidden>I</kbd></Button></ShortcutTooltip>;
}

function SignInAgain({ children = "Sign in again" }: { children?: ReactNode }) {
  const pathname = usePathname();
  // The global `a { color: inherit }` rule outranks layered utilities, hence the `!`.
  return <a data-slot="button" className={cn(buttonVariants({ size: "sm" }), "!text-primary-foreground")} href={`/events/sign-in?returnTo=${encodeURIComponent(pathname)}`}>{children}</a>;
}

/** The session or membership no longer allows this page: say why, and the way back. */
function AccessNotice({ access, message }: { access: MembersAccess; message: string }) {
  return <Alert variant="destructive" className="flex flex-col gap-2.5">
    <AlertTitle>{access === "session" ? "Your session expired" : access === "membership" ? "You no longer have access" : "No organization chosen"}</AlertTitle>
    <AlertDescription>{message}</AlertDescription>
    <div className="flex flex-wrap gap-2">
      {access === "session" ? <SignInAgain /> : <a data-slot="button" className={cn(buttonVariants({ size: "sm", variant: "outline" }), "!text-foreground")} href="/events">Go to your workspaces</a>}
    </div>
  </Alert>;
}

/** Shown while the page loads: the same cards as the page, in grey. */
export function MembersSkeleton() {
  const rows = (count: number) => Array.from({ length: count }, (_, index) => <div key={index} className="ws-row">
    <Skeleton className="size-7 flex-none rounded-full" />
    <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-40 max-w-full" /><Skeleton className="h-3 w-52 max-w-full" /></div>
  </div>);
  return <section className="ws-page" aria-busy="true" aria-label="Loading members">
    <div className="ws-main">
      <div className="ws-card"><div className="ws-card-head"><Skeleton className="h-3.5 w-24" /></div>{rows(4)}</div>
      <div className="ws-card"><div className="ws-card-head"><Skeleton className="h-3.5 w-36" /></div>{rows(2)}</div>
    </div>
    <div className="ws-side"><div className="ws-card ws-card-body"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-24" /><Skeleton className="h-16 w-full" /><Skeleton className="h-3 w-full" /></div></div>
  </section>;
}

/** The page could not load: access problems get their way back, anything else gets Try again. */
export function MembersLoadProblem({ access, message }: { access?: MembersAccess; message?: string }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  return <section className="ws-column">
    <title>Members | Demo Queue</title>
    <h1 className="sr-only">Members</h1>
    {access ? <AccessNotice access={access} message={message ?? ""} /> : <Alert variant="destructive" className="flex flex-col gap-2.5">
      <AlertTitle>Could not load members</AlertTitle>
      <AlertDescription>The member list did not load from WorkOS. Nothing was changed.</AlertDescription>
      <div><Button size="sm" variant="outline" disabled={retrying} onClick={() => startRetry(() => router.refresh())}>{retrying ? "Trying again…" : "Try again"}</Button></div>
    </Alert>}
  </section>;
}

type RowError = { key: string; message: string };

export function OrganizationMembers({ organizationName, overview, now }: { organizationName: string; overview: MembersOverview; now: number }) {
  const router = useRouter();
  const timeZone = useTimeZone();
  // Moves forward after each action, so a row sent just now reads "expires in 7 days".
  const [clock, setClock] = useState(now);
  const at = Math.max(now, clock);
  const joined = (iso: string) => shortDate(iso, at, timeZone).replace(/^today, .*/, "today");
  const [refreshing, startRefresh] = useTransition();
  const [notice, setNotice] = useState("");
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [access, setAccess] = useState<{ access: MembersAccess; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<MemberRow | null>(null);
  // What finished actions changed, shown at once: a reload can land late or stale.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<InvitationRow[]>([]);
  const inviteInput = useRef<HTMLInputElement>(null);
  const refresh = () => startRefresh(() => router.refresh());
  const invitations = [...added.filter((row) => !overview.invitations.some((invitation) => invitation.id === row.id)), ...overview.invitations].filter((invitation) => !gone.has(invitation.id));
  const members = overview.members.filter((member) => !gone.has(member.membershipId));
  const commands = useMemo(() => [{ id: "members-invite", group: "This page", label: "Invite people", keys: ["I"], run: focusInvite }], []);
  useCommands("members", commands, "Members");

  /** Runs one row action; a failure stays next to the row that caused it. */
  async function run(key: string, action: () => Promise<ActionResult<InvitationRow>>, success: string, hide?: string) {
    setBusy(key); setRowError(null); setNotice("");
    try {
      const result = await action();
      if (result.ok) {
        setClock(Date.now());
        if (hide) setGone((current) => new Set(current).add(hide));
        if (result.value) { const row = result.value; setAdded((current) => [row, ...current]); }
        setNotice(success); refresh();
        return true;
      }
      if (result.access) setAccess({ access: result.access, message: result.error });
      else setRowError({ key, message: result.error });
    } catch { setRowError({ key, message: "Something went wrong. Check your connection and try again." }); }
    finally { setBusy(null); }
    return false;
  }
  const errorFor = (...keys: string[]) => rowError && keys.includes(rowError.key) ? <p role="alert" className="ws-error">{rowError.message}</p> : null;
  const onlyYou = members.length === 1 && members[0].you;

  return <section className="ws-page">
    <title>{`Members · ${organizationName} | Demo Queue`}</title>
    <h1 className="sr-only">Members</h1>
    <div className="ws-main">
      {access && <AccessNotice {...access} />}
      {notice && <p role="status" className="m-0 text-sm text-foreground">{notice}</p>}

      <section className="ws-card" aria-labelledby="members-heading" aria-busy={refreshing}>
        <h2 id="members-heading" className="ws-card-head">Members <span className="ws-count">{members.length}</span></h2>
        <ul className="ws-list">
          {members.map((member) => <li key={member.membershipId}>
            <div className="ws-row">
              <span className="ws-avatar" aria-hidden>{initials(member.name, member.email)}</span>
              <span className="ws-row-text">
                <span>{member.name}{member.you && <span className="ws-muted"> you</span>}</span>
                <span className="ws-sub">{member.email}</span>
              </span>
              <span className="ws-sub whitespace-nowrap max-sm:hidden">Joined {joined(member.joinedAt)}</span>
              {member.you ? <span className="w-7" aria-hidden /> : <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Options for ${member.name}`} disabled={busy !== null || Boolean(access)} />}><Ellipsis aria-hidden /></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="workspace-account-menu">
                  <DropdownMenuItem variant="destructive" onClick={() => { setRowError(null); setConfirming(member); }}>Remove from {organizationName}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>}
            </div>
            {confirming?.membershipId === member.membershipId && <Alert variant="destructive" className="mx-3.5 mb-3 flex w-auto flex-wrap items-center gap-x-3 gap-y-2">
              <AlertDescription className="flex-[1_1_280px]">Remove {member.name} from {organizationName}? They lose access to its events, and their assistant connections lose {organizationName} access on the next call.</AlertDescription>
              <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void run(`remove:${member.membershipId}`, () => removeMember(member.membershipId), `${member.name} was removed from ${organizationName}.`, member.membershipId).then((done) => { if (done) setConfirming(null); })}>{busy === `remove:${member.membershipId}` ? "Removing…" : "Remove"}</Button>
              <Button variant="outline" size="sm" className="text-foreground" disabled={busy !== null} onClick={() => { setRowError(null); setConfirming(null); }}>Cancel</Button>
              {errorFor(`remove:${member.membershipId}`)}
            </Alert>}
          </li>)}
          {onlyYou && <li className="ws-row">
            <span className="ws-row-text"><span>Only you so far</span><span className="ws-sub">Invite the people who run events with you.</span></span>
            <Button variant="outline" size="sm" onClick={() => inviteInput.current?.focus()}>Invite people</Button>
          </li>}
        </ul>
      </section>

      <section className="ws-card" aria-labelledby="pending-heading" aria-busy={refreshing}>
        <h2 id="pending-heading" className="ws-card-head">Pending invitations <span className="ws-count">{invitations.length}</span></h2>
        {invitations.length === 0 ? <div className="ws-row">
          <span className="ws-row-text"><span className="ws-sub">No pending invitations. People you invite show up here until they join.</span></span>
          <Button variant="outline" size="sm" onClick={() => inviteInput.current?.focus()}>Invite people</Button>
        </div> : <ul className="ws-list">
          {invitations.map((invitation) => <li key={invitation.id} className="ws-row">
            <span className="ws-avatar" data-tone="muted" aria-hidden>{invitation.email.slice(0, 1).toUpperCase()}</span>
            <span className="ws-row-text">
              <span>{invitation.email}</span>
              <span className="ws-sub">{invitation.invitedBy ? `Invited by ${invitation.invitedBy}, ` : "Invited "}{shortDate(invitation.invitedAt, at, timeZone)} · <span className={invitation.expired ? "text-destructive" : undefined}>{invitationStatus(invitation, at).toLowerCase()}</span></span>
            </span>
            <span className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={busy !== null || Boolean(access)} onClick={() => void run(`resend:${invitation.id}`, () => resendInvitation(invitation.id), `Invitation sent again to ${invitation.email}.`, invitation.expired ? invitation.id : undefined)}>{busy === `resend:${invitation.id}` ? "Sending…" : "Send again"}</Button>
              <Button variant="outline" size="sm" disabled={busy !== null || Boolean(access)} onClick={() => void run(`revoke:${invitation.id}`, () => revokeInvitation(invitation.id), `Invitation to ${invitation.email} revoked.`, invitation.id)}>{busy === `revoke:${invitation.id}` ? "Revoking…" : "Revoke"}</Button>
            </span>
            {errorFor(`resend:${invitation.id}`, `revoke:${invitation.id}`)}
          </li>)}
        </ul>}
      </section>
      {members.some((member) => !member.you) && <p className="ws-help">The options menu removes someone from {organizationName}. Their assistant connections lose {organizationName} access on the next call.</p>}
    </div>
    <aside className="ws-side">
      <InviteForm organizationName={organizationName} members={members} invitations={invitations} inputRef={inviteInput} disabled={Boolean(access)}
        onSent={(message, rows) => { setClock(Date.now()); setRowError(null); setAdded((current) => [...rows, ...current]); setNotice(message); refresh(); }} onAccess={(problem) => setAccess(problem)} />
    </aside>
  </section>;
}

type Chip = { email: string; message?: string };

function InviteForm({ organizationName, members, invitations, inputRef, disabled, onSent, onAccess }: {
  organizationName: string; members: MemberRow[]; invitations: InvitationRow[]; inputRef: RefObject<HTMLInputElement | null>; disabled: boolean;
  onSent: (message: string, rows: InvitationRow[]) => void; onAccess: (problem: { access: MembersAccess; message: string }) => void;
}) {
  const [chips, setChips] = useState<Chip[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const known = useMemo(() => ({
    memberEmails: members.map((member) => member.email),
    invitedEmails: invitations.filter((invitation) => !invitation.expired).map((invitation) => invitation.email),
  }), [members, invitations]);
  const all = [...chips.map((chip) => chip.email), ...splitEmails(text)];
  const checked = checkInviteEmails(all, known);
  const sendable = checked.filter((entry, index) => !entry.problem && !chips[index]?.message);
  const problems = [...new Set(checked.flatMap((entry, index) => entry.problem ? [INVITE_PROBLEM_MESSAGES[entry.problem](entry.email)] : chips[index]?.message ? [chips[index].message!] : []))];
  const tooMany = sendable.length > MAX_INVITES_PER_REQUEST;

  function commit(value = text) {
    const emails = splitEmails(value);
    if (emails.length) setChips((current) => [...current, ...emails.map((email) => ({ email }))]);
    setText("");
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
    else if (event.key === "," || event.key === ";" || event.key === " " || (event.key === "Enter" && text.trim())) { event.preventDefault(); commit(); }
    else if (event.key === "Backspace" && !text && chips.length) setChips((current) => current.slice(0, -1));
  }
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    if (/[\s,;]/.test(pasted.trim())) { event.preventDefault(); commit(`${text} ${pasted}`); }
  }
  function clear() { setChips([]); setText(""); setError(""); }

  async function send() {
    if (sending || disabled) return;
    const emails = sendable.map((entry) => entry.email);
    if (!emails.length || tooMany) return;
    setSending(true); setError("");
    try {
      const result = await inviteMembers(emails);
      // Nothing was sent: keep every address so the person can try again.
      if (!result.ok) { if (result.access) onAccess({ access: result.access, message: result.error }); else setError(result.error); return; }
      const results = result.value ?? [];
      const sent = results.filter((entry) => entry.status === "sent");
      const left = results.filter((entry) => entry.status !== "sent");
      // Keep what was not sent, with the reason, and drop what was.
      setChips([...left.map((entry) => ({ email: entry.email, message: entry.message })), ...chips.filter((chip) => !results.some((entry) => entry.email === chip.email) && !emails.includes(chip.email))]);
      setText("");
      const rows = sent.flatMap((entry) => entry.invitation ? [entry.invitation] : []);
      if (sent.length && left.length) onSent(`Sent ${sent.length} of ${plural(results.length, "invitation")}. The ${left.length === 1 ? "address that was" : "addresses that were"} not sent ${left.length === 1 ? "stays" : "stay"} in the box with the reason.`, rows);
      else if (sent.length) onSent(`Sent ${plural(sent.length, "invitation")}.`, rows);
      else if (left.length) setError("No invitations were sent.");
    } catch { setError("Could not reach the server. Your addresses are still here; try again."); }
    finally { setSending(false); }
  }

  const label = sendable.length > 1 ? `Send ${sendable.length} invitations` : "Send invitation";
  return <section className="ws-card ws-card-body" aria-labelledby="invite-heading">
    <h2 id="invite-heading" className="ws-card-title">Invite people</h2>
    <div className="flex flex-col gap-1.5">
      <label htmlFor={INVITE_INPUT_ID} className="ws-label">Email addresses</label>
      <div className={cn("flex min-h-16 min-w-0 cursor-text flex-wrap content-start items-center gap-1 rounded-[7px] border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50", (sending || disabled) && "opacity-60")} onClick={() => inputRef.current?.focus()}>
        {checked.slice(0, chips.length).map((entry, index) => {
          const bad = Boolean(entry.problem || chips[index]?.message);
          return <span key={`${entry.email}-${index}`} className={cn("inline-flex h-5 max-w-full items-center gap-0.5 rounded-full border pr-0.5 pl-2 text-[11px] break-all", bad ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border text-muted-foreground")}>
            {entry.email}
            <button type="button" disabled={sending} className="grid size-4 flex-none cursor-pointer place-items-center rounded-full hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default" aria-label={`Remove ${entry.email}`} onClick={(event) => { event.stopPropagation(); setChips((current) => current.filter((_, i) => i !== index)); }}><X aria-hidden className="size-2.5" /></button>
          </span>;
        })}
        <input ref={inputRef} id={INVITE_INPUT_ID} className="h-6 min-w-32 flex-[1_1_160px] border-0 bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground" value={text} disabled={sending || disabled} autoComplete="off" spellCheck={false}
          placeholder={chips.length ? "" : "Type or paste addresses"}
          onChange={(event) => { const value = event.target.value; if (/[,;\s]$/.test(value)) commit(value); else setText(value); }}
          onKeyDown={onKeyDown} onPaste={onPaste} onBlur={() => commit()}
          aria-invalid={problems.length > 0 || undefined} aria-describedby="invite-help invite-problems" />
      </div>
      <p id="invite-help" className="ws-help">Comma, space or Enter adds one. Backspace removes the last.</p>
    </div>
    <div id="invite-problems" className="empty:hidden">
      {tooMany && <p role="alert" className="ws-error">Invite up to {MAX_INVITES_PER_REQUEST} people at a time.</p>}
      {problems.map((problem) => <p key={problem} role="alert" className="ws-error">{problem}</p>)}
      {error && <p role="alert" className="ws-error">{error}</p>}
    </div>
    <div className="ws-actions">
      <Button variant="outline" size="sm" disabled={sending || (!chips.length && !text)} onClick={clear}>Cancel</Button>
      <Button size="sm" disabled={sending || disabled || !sendable.length || tooMany} onClick={() => void send()}>{sending ? "Sending…" : label}<kbd className="ws-kbd" aria-hidden>⌘↵</kbd></Button>
    </div>
    <p className="ws-help">Everyone in {organizationName} can run its events and invite others. Each person gets an email with a link to join and signs in with Google using that address. Invitations expire in 7 days.</p>
  </section>;
}
