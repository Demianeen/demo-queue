"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAction, useConvexAuth, useMutation, useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectAssistant } from "@/components/ConnectAssistant";
import { initials, shortDate } from "@/lib/members";
import styles from "./McpConnectionPage.module.css";

type Organization = { id: string; name: string };
type Access = "read" | "manage";
type OrganizationSelection = { kind: "all" } | { kind: "selected"; organizationIds: string[] };
type LoadState = { kind: "loading" } | { kind: "ready"; organizations: Organization[] } | { kind: "error" };

export function McpConnectionClient({ requestId, settings }: { requestId?: string; settings: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const memberships = useAction(api.mcpConsent.memberships);
  const authorize = useAction(api.mcpConsent.authorize);
  const createApiKey = useAction(api.mcpConsent.createApiKey);
  const revoke = useMutation(api.mcpConsent.revokeConnection);
  const request = useQuery(api.mcpConsent.getRequest, isAuthenticated && requestId ? { requestId } : "skip");
  const { results: connections, status: connectionStatus, loadMore } = usePaginatedQuery(api.mcpConsent.listConnections, isAuthenticated && settings ? {} : "skip", { initialNumItems: 20 });
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [selection, setSelection] = useState<OrganizationSelection>({ kind: "selected", organizationIds: [] });
  const [access, setAccess] = useState<Access>("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [userCode, setUserCode] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [framed, setFramed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null);
  const mcpUrl = useQuery(api.gettingStarted.mcpAddress, isAuthenticated && settings ? {} : "skip");

  useEffect(() => { setFramed(window.top !== window.self); }, []);
  useEffect(() => {
    if (!isAuthenticated) return;
    let current = true;
    setLoad({ kind: "loading" });
    memberships({}).then((organizations) => {
      if (current) setLoad({ kind: "ready", organizations });
    }).catch(() => { if (current) setLoad({ kind: "error" }); });
    return () => { current = false; };
  }, [isAuthenticated, memberships, attempt]);

  if (framed) return <section className={styles.card}><h1>Open this page directly</h1><p>Connection approvals cannot be embedded in another website.</p></section>;
  if (complete) return <section className={styles.card}><p className={styles.eyebrow}>Connected</p><h1>You can return to your assistant.</h1><p>Your approval applies to the organizations and permissions you selected.</p><Link href="/events/connections">Manage connected assistants</Link></section>;
  if (!settings && (load.kind === "loading" || !isAuthenticated)) return <section className={styles.card} role="status"><h1>Loading your connections...</h1></section>;
  if (!settings && load.kind === "error") return <section className={styles.card}><h1>Could not verify your memberships</h1><p>Reload this page to try again.</p><Button onClick={() => window.location.reload()}>Try again</Button></section>;
  if (!settings && (!requestId || request === null)) return <section className={styles.card}><h1>Start from your assistant</h1><p>Add the MCP server URL to your assistant, then open its approval link.</p><Link href="/events/connections">View connected assistants</Link></section>;
  if (!settings && request === undefined) return <section className={styles.card} role="status"><h1>Loading approval request...</h1></section>;

  const grantSelection: { organizationIds: string[]; allOrganizations?: true } = selection.kind === "all"
    ? { organizationIds: [], allOrganizations: true }
    : { organizationIds: selection.organizationIds };
  const organizations = load.kind === "ready" ? load.organizations : [];
  const hasOrganizations = organizations.length > 0 && (selection.kind === "all" || selection.organizationIds.length > 0);

  async function approve(approved: boolean) {
    if (!requestId) return;
    setBusy(true);
    setError("");
    try {
      const result = await authorize({ requestId, approve: approved, ...grantSelection, access, ...(request?.kind === "device" ? { userCode } : {}) });
      if (result.redirectUrl) window.location.assign(result.redirectUrl);
      else setComplete(true);
    } catch { setError("This request could not be completed. Start again from your assistant."); }
    finally { setBusy(false); }
  }

  async function generateKey() {
    setBusy(true);
    setError("");
    setKey("");
    setShowKey(false);
    setCopied(false);
    try { const result = await createApiKey({ name, ...grantSelection, access }); setKey(result.apiKey); setName(""); }
    catch { setError("Could not create the key. Check your organization access and try again."); }
    finally { setBusy(false); }
  }

  const organizationName = (id: string) => organizations.find((organization) => organization.id === id)?.name || "Unavailable organization";
  const accessFields = <>
      <fieldset disabled={busy} className={styles.fieldset}>
        <legend>Organizations</legend>
        <RadioGroup aria-label="Organization access" value={selection.kind} onValueChange={(value) => {
          if (value === "all") setSelection({ kind: "all" });
          else if (value === "selected") setSelection({ kind: "selected", organizationIds: [] });
        }}>
          <label className={styles.choice}><RadioGroupItem value="all" /><span><strong>All current and future organizations</strong><small>Include every organization you belong to now and any you join later.</small></span></label>
          <label className={styles.choice}><RadioGroupItem value="selected" /><span><strong>Choose organizations</strong><small>Only the organizations you select. New memberships need a new approval.</small></span></label>
        </RadioGroup>
        {selection.kind === "selected" && <>
          <div className={styles.organizationHeading}><span>Select one or more.</span><Button variant="link" onClick={() => setSelection({ kind: "selected", organizationIds: organizations.map((organization) => organization.id) })}>Select all listed</Button></div>
          {organizations.map((organization) => <label className={styles.choice} key={organization.id}>
            <Checkbox checked={selection.organizationIds.includes(organization.id)} onCheckedChange={(checked) => setSelection((current) => current.kind === "all" ? current : {
              kind: "selected", organizationIds: checked ? [...current.organizationIds, organization.id] : current.organizationIds.filter((id) => id !== organization.id),
            })} />
            <span>{organization.name}</span>
          </label>)}
        </>}
        {organizations.length === 0 && <p>You have no active organization memberships.</p>}
        <p className={styles.help}>Every call requires your active membership and the permissions approved for this connection.</p>
      </fieldset>
      <fieldset disabled={busy} className={styles.fieldset}>
        <legend>Permissions</legend>
        <RadioGroup value={access} onValueChange={(value) => { if (value === "read" || value === "manage") setAccess(value); }}>
          <label className={styles.choice}><RadioGroupItem value="read" /><span><strong>Read only</strong><small>View event information. Cannot change events or read participant contacts.</small></span></label>
          <label className={styles.choice}><RadioGroupItem value="manage" /><span><strong>Manage events</strong><small>Read contacts, create and change events, manage judging, timers and integrations, and perform destructive admin actions.</small></span></label>
        </RadioGroup>
      </fieldset>
  </>;

  const connected = connectionStatus === "LoadingFirstPage" ? undefined : connections.length > 0;
  const connectionsLoading = connectionStatus === "LoadingFirstPage" || load.kind === "loading";
  const when = (time: number) => shortDate(new Date(time).toISOString(), Date.now());
  if (settings) return <div className="ws-column" data-width="wide">
      <h1 className="sr-only">Connections</h1>
      <section className="ws-card ws-card-body" aria-labelledby="connect-heading">
        <h2 id="connect-heading" className="ws-card-title">Connect an assistant</h2>
        <ConnectAssistant mcpUrl={isAuthenticated ? mcpUrl : undefined} connected={connected} />
      </section>
      <section className="ws-card" aria-labelledby="connected-heading" aria-busy={connectionsLoading}>
        <h2 id="connected-heading" className="ws-card-head">Connected assistants {!connectionsLoading && <span className="ws-count">{connections.length}</span>}</h2>
        {error && <div className="px-3.5 pb-2.5"><p role="alert" className="ws-error">{error}</p></div>}
        {load.kind === "error" && <div className="ws-row">
          <span className="ws-row-text"><span className="ws-error">Could not load your organizations, so connection details are missing.</span></span>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
        </div>}
        {connectionsLoading
          ? <div aria-label="Loading connected assistants">{[0, 1].map((row) => <div key={row} className="ws-row"><Skeleton className="size-[26px] rounded-full" /><div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3 w-64 max-w-full" /></div><Skeleton className="h-7 w-24" /></div>)}</div>
          : <ul className="ws-list" aria-label="Connected assistants">
            {connections.map((connection) => <li key={connection.id} className="ws-row">
              <span className="ws-avatar" data-tone="muted" aria-hidden>{initials(connection.name, connection.name)}</span>
              <span className="ws-row-text">
                <span>{connection.name}</span>
                <span className="ws-sub">{connection.allOrganizations ? "All current and future organizations" : connection.organizationIds.map(organizationName).join(", ")} · {connection.kind === "apiKey" ? `script key, created ${when(connection.createdAt)}` : `approved ${when(connection.createdAt)}`}</span>
              </span>
              <span className="ws-pill">{connection.access === "read" ? "Read only" : "Manage events"}</span>
              <Button variant="outline" size="sm" disabled={revoking !== null} onClick={async () => {
                setRevoking(connection.id); setError("");
                try { await revoke({ id: connection.id }); }
                catch { setError(`Could not disconnect ${connection.name}. Try again.`); }
                finally { setRevoking(null); }
              }}>{revoking === connection.id ? "Disconnecting…" : "Disconnect"}</Button>
            </li>)}
            {connections.length === 0 && <li className="ws-row"><span className="ws-sub">No assistants connected yet. Follow the steps above to connect one. The list updates as soon as one appears.</span></li>}
          </ul>}
        {connectionStatus === "CanLoadMore" && <div className="ws-row"><Button variant="outline" size="sm" onClick={() => loadMore(20)}>Load more connections</Button></div>}
        {connectionStatus === "LoadingMore" && <div className="ws-row"><Skeleton className="h-7 w-48" /></div>}
      </section>
      <section className="ws-card ws-card-body" aria-labelledby="keys-heading">
        <h2 id="keys-heading" className="ws-card-title">Script keys</h2>
        <p className="ws-help">Optional. A key lets a script or CLI call Demo Queue with the organizations and permissions you pick here.</p>
        {load.kind === "ready" ? <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-[0_1_240px] flex-col gap-1.5"><label htmlFor="script-name" className="ws-label">Key name</label><Input id="script-name" className="h-8" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Event summary script" disabled={busy} /></div>
            <div role="radiogroup" aria-label="Permissions" className="ws-segment">
              {(["read", "manage"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={access === value} disabled={busy} onClick={() => setAccess(value)}>{value === "read" ? "Read only" : "Manage events"}</button>)}
            </div>
            <Button variant="outline" size="sm" disabled={busy || !hasOrganizations || !name.trim()} onClick={generateKey}>{busy ? "Creating…" : "Create key"}</Button>
          </div>
          <fieldset disabled={busy} className="m-0 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-0 p-0">
            <legend className="ws-label mb-1.5 p-0">Organizations</legend>
            <label className="flex items-center gap-1.5 text-[13px]"><Checkbox checked={selection.kind === "all"} onCheckedChange={(checked) => setSelection(checked ? { kind: "all" } : { kind: "selected", organizationIds: [] })} />All current and future</label>
            {selection.kind === "selected" && organizations.map((organization) => <label key={organization.id} className="flex items-center gap-1.5 text-[13px]">
              <Checkbox checked={selection.organizationIds.includes(organization.id)} onCheckedChange={(checked) => setSelection((current) => current.kind === "all" ? current : {
                kind: "selected", organizationIds: checked ? [...current.organizationIds, organization.id] : current.organizationIds.filter((id) => id !== organization.id),
              })} />{organization.name}
            </label>)}
            {organizations.length === 0 && <span className="ws-sub">You have no active organization memberships.</span>}
          </fieldset>
          <p className="ws-help">{access === "read" ? "Read only views event information. It cannot change events or read participant contacts." : "Manage events reads contacts, creates and changes events, manages judging, timers and integrations, and can perform destructive admin actions."}</p>
          {key && <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--dq-warning-line)] bg-[var(--dq-warning-bg)] px-3 py-2.5">
            <span className="text-xs font-medium text-[var(--dq-warning-fg)]">Copy this key now. It is only shown once.</span>
            <div className="flex flex-wrap gap-1.5">
              <Input aria-label="New API key" className="h-8 min-w-0 flex-[1_1_240px] font-mono text-xs" type={showKey ? "text" : "password"} readOnly value={key} />
              <Button variant="outline" size="sm" onClick={() => setShowKey((shown) => !shown)}>{showKey ? "Hide" : "Show"}</Button>
              <Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(key); setCopied(true); } catch { setError("Could not copy the key. Show the key, then select and copy it from the field."); } }}>{copied ? "Copied" : "Copy"}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setKey(""); setShowKey(false); setCopied(false); }}>Done</Button>
            </div>
          </div>}
        </> : load.kind === "loading" ? <Skeleton className="h-16 w-full" /> : <p className="ws-sub">Retry loading your organizations above to create a key.</p>}
      </section>
    </div>;

  return <div className={styles.content}>
    <section className={styles.card}>
      <p className={styles.eyebrow}>Connect your assistant</p>
      <h1>Choose what your assistant can access.</h1>
      <p>Your assistant can only act within your current organization access and the approval you give here.</p>
      {request && <div className={styles.request}>
        <strong>{request.clientName || "Unnamed application"}</strong><span>Application name is supplied by the client.</span>
        {request.kind === "redirect" && request.redirectUri && <span>Return to {new URL(request.redirectUri).host}</span>}
        {request.kind === "device" && <div className={styles.keyForm}><label htmlFor="device-code">Code shown by your assistant</label><Input id="device-code" value={userCode} onChange={(event) => setUserCode(event.target.value)} maxLength={32} autoComplete="off" placeholder="Enter the code from your assistant" /><span>Only enter a code from a connection you started yourself.</span></div>}
      </div>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {accessFields}
      <div className={styles.actions}>
        <Button variant="outline" disabled={busy} onClick={() => approve(false)}>Cancel</Button>
        <Button disabled={busy || !hasOrganizations || (request?.kind === "device" && userCode.trim().length < 6)} onClick={() => approve(true)}>{busy ? "Connecting..." : "Allow access"}</Button>
      </div>
    </section>
    <footer className={styles.footer}><Link href="/events">Back to events</Link><Link href="/events/connections">Manage connections</Link></footer>
  </div>;
}
