"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  const connections = useQuery(api.mcpConsent.listConnections, isAuthenticated && settings ? {} : "skip");
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

  useEffect(() => { setFramed(window.top !== window.self); }, []);
  useEffect(() => {
    if (!isAuthenticated) return;
    let current = true;
    memberships({}).then((organizations) => {
      if (current) setLoad({ kind: "ready", organizations });
    }).catch(() => { if (current) setLoad({ kind: "error" }); });
    return () => { current = false; };
  }, [isAuthenticated, memberships]);

  if (framed) return <section className={styles.card}><h1>Open this page directly</h1><p>Connection approvals cannot be embedded in another website.</p></section>;
  if (complete) return <section className={styles.card}><p className={styles.eyebrow}>Connected</p><h1>You can return to your assistant.</h1><p>Your approval applies to the organizations and permissions you selected.</p><Link href="/events/connections">Manage connected assistants</Link></section>;
  if (load.kind === "loading" || !isAuthenticated) return <section className={styles.card} role="status"><h1>Loading your connections...</h1></section>;
  if (load.kind === "error") return <section className={styles.card}><h1>Could not verify your memberships</h1><p>Reload this page to try again.</p><Button onClick={() => window.location.reload()}>Try again</Button></section>;
  if (!settings && (!requestId || request === null)) return <section className={styles.card}><h1>Start from your assistant</h1><p>Add the MCP server URL to your assistant, then open its approval link.</p><Link href="/events/connections">View connected assistants</Link></section>;
  if (!settings && request === undefined) return <section className={styles.card} role="status"><h1>Loading approval request...</h1></section>;

  const grantSelection: { organizationIds: string[]; allOrganizations?: true } = selection.kind === "all"
    ? { organizationIds: [], allOrganizations: true }
    : { organizationIds: selection.organizationIds };
  const hasOrganizations = load.organizations.length > 0 && (selection.kind === "all" || selection.organizationIds.length > 0);

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

  return <div className={styles.content}>
    <section className={styles.card}>
      <p className={styles.eyebrow}>{settings ? "Assistant access" : "Connect your assistant"}</p>
      <h1>{settings ? "Connected assistants" : "Choose what your assistant can access."}</h1>
      <p>{settings ? "Each connection has its own organizations and permissions. Disconnecting one leaves your other connections working." : "Your assistant can only act within your current organization access and the approval you give here."}</p>
      {!settings && request && <div className={styles.request}>
        <strong>{request.clientName || "Unnamed application"}</strong><span>Application name is supplied by the client.</span>
        {request.kind === "redirect" && request.redirectUri && <span>Return to {new URL(request.redirectUri).host}</span>}
        {request.kind === "device" && <div className={styles.keyForm}><label htmlFor="device-code">Code shown by your assistant</label><Input id="device-code" value={userCode} onChange={(event) => setUserCode(event.target.value)} maxLength={32} autoComplete="off" placeholder="Enter the code from your assistant" /><span>Only enter a code from a connection you started yourself.</span></div>}
      </div>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {settings && <ul className={styles.connections} aria-label="Connected assistants">
        {connections?.map((connection) => <li key={connection.id}>
          <div><strong>{connection.name}</strong><p>{connection.allOrganizations ? "All current and future organizations" : connection.organizationIds.map((id) => load.organizations.find((organization) => organization.id === id)?.name || "Unavailable organization").join(", ")} · {connection.access === "read" ? "Read only" : "Manage events"}</p></div>
          <Button variant="outline" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try { await revoke({ id: connection.id }); }
            catch { setError("Could not disconnect this assistant. Try again."); }
            finally { setBusy(false); }
          }}>Disconnect</Button>
        </li>)}
        {connections?.length === 0 && <li>No assistants connected yet.</li>}
      </ul>}
      {settings && <h2>Create a script key</h2>}
      {settings && <p>Optional. Use a key for a script or CLI that cannot sign in through a browser.</p>}
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
          <div className={styles.organizationHeading}><span>Select one or more.</span><Button variant="link" onClick={() => setSelection({ kind: "selected", organizationIds: load.organizations.map((organization) => organization.id) })}>Select all listed</Button></div>
          {load.organizations.map((organization) => <label className={styles.choice} key={organization.id}>
            <Checkbox checked={selection.organizationIds.includes(organization.id)} onCheckedChange={(checked) => setSelection((current) => current.kind === "all" ? current : {
              kind: "selected", organizationIds: checked ? [...current.organizationIds, organization.id] : current.organizationIds.filter((id) => id !== organization.id),
            })} />
            <span>{organization.name}</span>
          </label>)}
        </>}
        {load.organizations.length === 0 && <p>You have no active organization memberships.</p>}
        <p className={styles.help}>Every call requires your active membership and the permissions approved for this connection.</p>
      </fieldset>
      <fieldset disabled={busy} className={styles.fieldset}>
        <legend>Permissions</legend>
        <RadioGroup value={access} onValueChange={(value) => { if (value === "read" || value === "manage") setAccess(value); }}>
          <label className={styles.choice}><RadioGroupItem value="read" /><span><strong>Read only</strong><small>View event information. Cannot change events or read participant contacts.</small></span></label>
          <label className={styles.choice}><RadioGroupItem value="manage" /><span><strong>Manage events</strong><small>Read contacts, create and change events, manage judging, timers and integrations, and perform destructive admin actions.</small></span></label>
        </RadioGroup>
      </fieldset>
      {settings ? <div className={styles.keyForm}>
        <label htmlFor="script-name">Key name</label><Input id="script-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Event summary script" />
        <Button disabled={busy || !hasOrganizations || !name.trim()} onClick={generateKey}>Create API key</Button>
        {key && <Alert><AlertDescription><p>Copy this key now. It is only shown once.</p><Input aria-label="New API key" type={showKey ? "text" : "password"} readOnly value={key} /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(key); setCopied(true); } catch { setError("Could not copy the key. Show the key, then select and copy it from the field."); } }}>{copied ? "Copied" : "Copy key"}</Button><Button variant="ghost" onClick={() => setShowKey((shown) => !shown)}>{showKey ? "Mask key" : "Show key"}</Button><Button variant="ghost" onClick={() => { setKey(""); setShowKey(false); setCopied(false); }}>Done</Button></AlertDescription></Alert>}
      </div> : <div className={styles.actions}>
        <Button variant="outline" disabled={busy} onClick={() => approve(false)}>Cancel</Button>
        <Button disabled={busy || !hasOrganizations || (request?.kind === "device" && userCode.trim().length < 6)} onClick={() => approve(true)}>{busy ? "Connecting..." : "Allow access"}</Button>
      </div>}
    </section>
    <footer className={styles.footer}><Link href="/events">Back to events</Link>{!settings && <Link href="/events/connections">Manage connections</Link>}</footer>
  </div>;
}
