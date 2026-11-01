"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Ellipsis, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { checkInviteEmails, initials, invitationStatus, INVITE_PROBLEM_MESSAGES, MAX_INVITES_PER_REQUEST, shortDate, splitEmails } from "@/lib/members";
import type { InvitationRow, MemberRow, MembersAccess, MembersOverview } from "@/lib/workos-members";
import { inviteMembers, removeMember, resendInvitation, revokeInvitation, type ActionResult } from "@/app/(workspace)/members/actions";
import { cn } from "@/lib/utils";

function plural(count: number, word: string) { return `${count} ${word}${count === 1 ? "" : "s"}`; }

/** Dates use the viewer's time zone once mounted; the server renders UTC. */
function useTimeZone() {
  const [timeZone, setTimeZone] = useState<string | undefined>("UTC");
  useEffect(() => { setTimeZone(undefined); }, []);
  return timeZone;
}

const panel = "rounded-lg border border-border bg-card text-card-foreground";
const panelHeading = "m-0 flex justify-between gap-3 px-6 pt-4 pb-2.5 text-[15px] font-semibold max-sm:px-4 [&>span]:font-medium [&>span]:text-muted-foreground [&>span]:tabular-nums";
const rowText = "flex min-w-0 flex-col [&>strong]:text-sm [&>strong]:font-semibold [&>strong]:break-words [&>span]:text-[13px] [&>span]:text-muted-foreground [&>span]:break-words";
const emptyRow = "m-0 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-6 py-3.5 text-sm text-muted-foreground max-sm:px-4";

function Heading({ organizationName }: { organizationName?: string }) {
  return <div className="workspace-heading !mb-1"><h1>Members</h1><p>{organizationName ? `Everyone here can run every ${organizationName} event: create events, manage judging and invite others.` : "Everyone in your organization can run its events and invite others."}</p></div>;
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

/** Shown while the page loads: the same blocks as the page, in grey. */
export function MembersSkeleton() {
  const rows = (count: number, avatar: boolean) => Array.from({ length: count }, (_, index) => <div key={index} className="flex min-h-14 items-center gap-4 border-t border-border px-6 py-2.5 max-sm:px-4">
    {avatar && <Skeleton className="size-[34px] flex-none rounded-full" />}
    <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-44 max-w-full" /><Skeleton className="h-3 w-32 max-w-full" /></div>
    <Skeleton className="h-6 w-24 rounded-full max-sm:hidden" />
  </div>);
  return <section className="flex max-w-[960px] flex-col gap-5" aria-busy="true" aria-label="Loading members">
    <div className="flex flex-col gap-3"><Skeleton className="h-9 w-48" /><Skeleton className="h-4 w-full max-w-[520px]" /></div>
    <div className={cn(panel, "flex flex-col gap-3 px-6 py-5 max-sm:px-4")}>
      <Skeleton className="h-5 w-36" /><Skeleton className="h-3.5 w-28" />
      <div className="flex flex-wrap gap-2.5"><Skeleton className="h-11 min-w-0 flex-[1_1_420px]" /><Skeleton className="h-11 w-36 rounded-full max-sm:w-full" /></div>
      <Skeleton className="h-3 w-full max-w-[560px]" />
    </div>
    <div className={panel}><div className="px-6 pt-4 pb-3 max-sm:px-4"><Skeleton className="h-4 w-40" /></div>{rows(2, false)}</div>
    <div className={panel}><div className="px-6 pt-4 pb-3 max-sm:px-4"><Skeleton className="h-4 w-24" /></div>{rows(3, true)}</div>
  </section>;
}

/** The page could not load: access problems get their way back, anything else gets Retry. */
export function MembersLoadProblem({ access, message }: { access?: MembersAccess; message?: string }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  return <section className="flex max-w-[960px] flex-col gap-5">
    <title>Members | Demo Queue</title>
    <Heading />
    {access ? <AccessNotice access={access} message={message ?? ""} /> : <Alert variant="destructive" className="flex flex-col gap-2.5">
      <AlertTitle>Could not load members</AlertTitle>
      <AlertDescription>The member list did not load from WorkOS. Nothing was changed.</AlertDescription>
      <div><Button size="sm" disabled={retrying} onClick={() => startRetry(() => router.refresh())}>{retrying ? "Retrying…" : "Retry"}</Button></div>
    </Alert>}
  </section>;
}

type RowError = { key: string; message: string };

export function OrganizationMembers({ organizationName, overview, now }: { organizationName: string; overview: MembersOverview; now: number }) {
  const router = useRouter();
  const timeZone = useTimeZone();
  // Moves forward after each action, so a row sent just now reads "Expires in 7 days".
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
  const errorFor = (...keys: string[]) => rowError && keys.includes(rowError.key) ? <p role="alert" className="m-0 basis-full text-[13px] text-destructive">{rowError.message}</p> : null;

  return <section className="flex max-w-[960px] flex-col gap-5">
    <title>{`Members · ${organizationName} | Demo Queue`}</title>
    <Heading organizationName={organizationName} />
    {access && <AccessNotice {...access} />}
    <InviteForm organizationName={organizationName} members={members} invitations={invitations} inputRef={inviteInput} disabled={Boolean(access)}
      onSent={(message, rows) => { setClock(Date.now()); setRowError(null); setAdded((current) => [...rows, ...current]); setNotice(message); refresh(); }} onAccess={(problem) => setAccess(problem)} />
    {notice && <p role="status" className="m-0 text-sm text-foreground">{notice}</p>}

    <section className={panel} aria-labelledby="pending-heading" aria-busy={refreshing}>
      <h2 id="pending-heading" className={panelHeading}>Pending invitations <span>{invitations.length}</span></h2>
      {invitations.length === 0 ? <div className={emptyRow}>
        <span className="flex-[1_1_280px]">No pending invitations. People you invite show up here until they join.</span>
        <Button variant="outline" size="sm" onClick={() => inviteInput.current?.focus()}>Invite people</Button>
      </div> : <ul className="m-0 list-none p-0 [&>li]:border-t [&>li]:border-border">
        {invitations.map((invitation) => <li key={invitation.id} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1.5 px-6 py-2.5 max-sm:gap-x-3 max-sm:px-4">
          <span className={cn(rowText, "flex-[1_1_260px]")}>
            <strong>{invitation.email}</strong>
            <span>{invitation.invitedBy ? `Invited by ${invitation.invitedBy} · ` : "Invited "}{shortDate(invitation.invitedAt, at, timeZone)}</span>
          </span>
          <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", invitation.expired ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{invitationStatus(invitation, at)}</span>
          <span className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={busy !== null || Boolean(access)} onClick={() => void run(`resend:${invitation.id}`, () => resendInvitation(invitation.id), `Invitation sent again to ${invitation.email}.`, invitation.expired ? invitation.id : undefined)}>{busy === `resend:${invitation.id}` ? "Sending…" : invitation.expired ? "Send again" : "Resend"}</Button>
            <Button variant="ghost" size="sm" disabled={busy !== null || Boolean(access)} onClick={() => void run(`revoke:${invitation.id}`, () => revokeInvitation(invitation.id), `Invitation to ${invitation.email} revoked.`, invitation.id)}>{busy === `revoke:${invitation.id}` ? "Revoking…" : "Revoke"}</Button>
          </span>
          {errorFor(`resend:${invitation.id}`, `revoke:${invitation.id}`)}
        </li>)}
      </ul>}
    </section>

    <section className={panel} aria-labelledby="members-heading" aria-busy={refreshing}>
      <h2 id="members-heading" className={panelHeading}>Members <span>{members.length}</span></h2>
      <ul className="m-0 list-none p-0 [&>li]:border-t [&>li]:border-border">
        {members.map((member) => <li key={member.membershipId}>
          <div className="flex min-h-14 items-center gap-4 px-6 py-2.5 max-sm:gap-3 max-sm:px-4">
            <span className="grid size-[34px] flex-none place-items-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground" aria-hidden>{initials(member.name, member.email)}</span>
            <span className={cn(rowText, "flex-1")}>
              <strong>{member.name}{member.you && <span className="font-medium text-muted-foreground"> (you)</span>}</strong>
              <span>{member.email}</span>
              <span className="sm:hidden">Joined {joined(member.joinedAt)}</span>
            </span>
            <span className="min-w-[130px] text-[13px] text-muted-foreground max-sm:hidden">Joined {joined(member.joinedAt)}</span>
            {member.you ? <span className="w-8" aria-hidden /> : <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Options for ${member.name}`} disabled={busy !== null || Boolean(access)} />}><Ellipsis aria-hidden /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="workspace-account-menu">
                <DropdownMenuItem variant="destructive" onClick={() => { setRowError(null); setConfirming(member); }}>Remove from {organizationName}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>
          {confirming?.membershipId === member.membershipId && <Alert variant="destructive" className="mx-6 mb-3 flex w-auto flex-wrap items-center gap-x-3 gap-y-2 max-sm:mx-4">
            <AlertDescription className="flex-[1_1_280px]">Remove {member.name} from {organizationName}? They lose access to its events, and their assistant connections lose {organizationName} access on the next call.</AlertDescription>
            <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void run(`remove:${member.membershipId}`, () => removeMember(member.membershipId), `${member.name} was removed from ${organizationName}.`, member.membershipId).then((done) => { if (done) setConfirming(null); })}>{busy === `remove:${member.membershipId}` ? "Removing…" : "Remove"}</Button>
            <Button variant="outline" size="sm" className="text-foreground" disabled={busy !== null} onClick={() => { setRowError(null); setConfirming(null); }}>Cancel</Button>
            {errorFor(`remove:${member.membershipId}`)}
          </Alert>}
        </li>)}
        {members.length === 1 && members[0].you && <li className={emptyRow}>
          <span className="flex-[1_1_280px]">Only you so far. Invite the people who run events with you.</span>
          <Button variant="outline" size="sm" onClick={() => inviteInput.current?.focus()}>Invite people</Button>
        </li>}
      </ul>
    </section>
    {members.some((member) => !member.you) && <p className="m-0 text-[13px] text-muted-foreground">The options menu removes someone from {organizationName}. Their assistant connections lose {organizationName} access on the next call.</p>}
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
    if (event.key === "," || event.key === ";" || event.key === " " || (event.key === "Enter" && text.trim())) { event.preventDefault(); commit(); }
    else if (event.key === "Backspace" && !text && chips.length) setChips((current) => current.slice(0, -1));
  }
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    if (/[\s,;]/.test(pasted.trim())) { event.preventDefault(); commit(`${text} ${pasted}`); }
  }

  async function send() {
    if (sending) return;
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
  return <section className={cn(panel, "flex flex-col gap-3 px-6 py-5 max-sm:px-4")} aria-labelledby="invite-heading">
    <h2 id="invite-heading" className="m-0 text-lg font-semibold">Invite people</h2>
    <label htmlFor="invite-emails" className="text-sm font-medium">Email addresses</label>
    <div className="flex flex-wrap items-start gap-2.5">
      <div className={cn("flex min-h-11 min-w-0 flex-[1_1_420px] cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50", (sending || disabled) && "opacity-60")} onClick={() => inputRef.current?.focus()}>
        {checked.slice(0, chips.length).map((entry, index) => {
          const bad = Boolean(entry.problem || chips[index]?.message);
          return <span key={`${entry.email}-${index}`} className={cn("inline-flex h-7 max-w-full items-center gap-1 rounded-full pr-1 pl-2.5 text-[13px] font-medium break-all", bad ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground")}>
            {entry.email}
            <button type="button" disabled={sending} className="grid size-[22px] flex-none cursor-pointer place-items-center rounded-full hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default" aria-label={`Remove ${entry.email}`} onClick={(event) => { event.stopPropagation(); setChips((current) => current.filter((_, i) => i !== index)); }}><X aria-hidden className="size-3" /></button>
          </span>;
        })}
        <input ref={inputRef} id="invite-emails" className="h-[30px] min-w-40 flex-[1_1_200px] border-0 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground" value={text} disabled={sending || disabled} autoComplete="off" spellCheck={false}
          placeholder={chips.length ? "" : "Paste or type emails"}
          onChange={(event) => { const value = event.target.value; if (/[,;\s]$/.test(value)) commit(value); else setText(value); }}
          onKeyDown={onKeyDown} onPaste={onPaste} onBlur={() => commit()}
          aria-invalid={problems.length > 0 || undefined} aria-describedby="invite-help invite-problems" />
      </div>
      <Button className="max-sm:w-full" disabled={sending || disabled || !sendable.length || tooMany} onClick={() => void send()}>{sending ? "Sending…" : label}</Button>
    </div>
    <p id="invite-help" className="m-0 text-[13px] leading-normal text-muted-foreground">Each person gets an email from WorkOS with a link to join {organizationName}. They sign in with Google using that address. Links expire after 7 days.</p>
    <div id="invite-problems">
      {tooMany && <p role="alert" className="m-0 text-[13px] leading-normal text-destructive">Invite up to {MAX_INVITES_PER_REQUEST} people at a time.</p>}
      {problems.map((problem) => <p key={problem} role="alert" className="m-0 text-[13px] leading-normal text-destructive">{problem}</p>)}
      {error && <p role="alert" className="m-0 text-[13px] leading-normal text-destructive">{error}</p>}
    </div>
  </section>;
}
