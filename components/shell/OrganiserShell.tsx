"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { Building2, CalendarDays, Check, ChevronsUpDown, Code2, FlaskConical, Gavel, Inbox, Keyboard, Link2, ListChecks, ListOrdered, MonitorPlay, Palette, Plug, Plus, Presentation, Radio, Search, Settings, Trophy, UserCheck, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspaceAccountMenu } from "@/components/WorkspaceAccountMenu";
import { CommandProvider, ShortcutTooltip, useCommandRegistry, useCommands, type Command } from "./commands";
import { CommandMenu } from "./CommandMenu";
import { ShortcutSheet } from "./ShortcutSheet";
import { ADMIN_VIEW_KEYS, adminViewPath, adminViewsFor, judgingPath, JUDGES_KEY, LIVE_KEY, phaseTabLabel, type AdminView } from "@/lib/admin-views";
import { absoluteUrl, adminPath, stagePath, submissionPath } from "@/lib/routes";
import { liveGroup } from "@/lib/command-menu";
import type { EventPhase } from "@/lib/event-phase";
import { InPageLink, useInPageNavigate } from "@/components/InPageLink";

type Organization = { id: string; name: string };
export type ShellEvent = { name: string; slug: string; eventType: "demo" | "hackathon"; practice?: boolean; phase?: EventPhase };

export type ShellProps = {
  organizations: Organization[];
  activeOrganizationId?: string;
  email: string;
  displayName: string;
  switching: boolean;
  onSelectOrganization: (id: string) => Promise<void>;
  /** The org's live event, shown under "Live now". Undefined while loading, null when there is none. */
  liveEvent: ShellEvent | null | undefined;
  /** The event this page shows, when it is not the live one (an older or a practice event). */
  openEvent?: ShellEvent | null;
  /** The org's real events loaded so far, newest first, for the command menu's search. */
  events?: ShellEvent[];
  children: ReactNode;
};

/** The organiser app frame: sidebar, inset main panel, command menu and shortcut sheet. */
export function OrganiserShell(props: ShellProps) {
  return <div className="dq-app">
    <TooltipProvider delay={1000}>
      <CommandProvider>
        <SidebarProvider className="dq-shell">
          <ShellSidebar {...props} />
          <SidebarInset>{props.children}</SidebarInset>
        </SidebarProvider>
        <GlobalCommands {...props} />
        <CommandMenu liveEvent={props.liveEvent} events={props.events} searchable={!!props.activeOrganizationId && !!props.events} />
        <ShortcutSheet />
        <Toaster position="bottom-right" />
      </CommandProvider>
    </TooltipProvider>
  </div>;
}

function ShellSidebar({ organizations, activeOrganizationId, email, displayName, switching, onSelectOrganization, liveEvent, openEvent }: ShellProps) {
  const pathname = usePathname();
  const { setMenuOpen } = useCommandRegistry();
  const active = organizations.find((org) => org.id === activeOrganizationId);
  const inEvent = (event: ShellEvent | null | undefined) => !!event && pathname.startsWith(`/events/${event.slug}/`);
  const other = openEvent && openEvent.slug !== liveEvent?.slug ? openEvent : null;
  const practiceActive = pathname === "/events/practice" || (!!other?.practice && inEvent(other));
  const eventsActive = pathname === "/events" || pathname === "/events/new" || (!!other && !other.practice && inEvent(other));

  return <Sidebar variant="inset" collapsible="offcanvas">
    <SidebarHeader className="gap-1 px-2 pt-2">
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger disabled={switching || !organizations.length} className="dq-org-switcher" aria-label="Organization">
            <span className="dq-org-mark" aria-hidden>{(active?.name ?? "D").slice(0, 1).toUpperCase()}</span>
            <span className="truncate">{switching ? "Switching…" : active?.name ?? "Choose workspace"}</span>
            <ChevronsUpDown aria-hidden className="ml-auto size-3.5 text-[var(--dq-fg-3)]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
              {organizations.map((org) => <DropdownMenuItem key={org.id} disabled={switching} aria-current={org.id === activeOrganizationId ? "true" : undefined} onClick={() => void onSelectOrganization(org.id)}>
                <Building2 aria-hidden /><span className="truncate">{org.name}</span>{org.id === activeOrganizationId && <Check aria-hidden className="ml-auto" />}
              </DropdownMenuItem>)}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ShortcutTooltip label="Search and commands" keys={["⌘", "K"]}>
          <Button variant="ghost" size="icon-sm" aria-label="Search and commands" onClick={() => setMenuOpen(true)}><Search aria-hidden /></Button>
        </ShortcutTooltip>
        <ShortcutTooltip label="New event" keys={["C"]}>
          <Button variant="ghost" size="icon-sm" aria-label="New event" render={<Link href="/events/new" />} nativeButton={false}><Plus aria-hidden /></Button>
        </ShortcutTooltip>
      </div>
    </SidebarHeader>
    <SidebarContent>
      {active && <SidebarGroup>
        <SidebarGroupLabel><span className="dq-dot mr-1.5" data-tone={liveEvent ? "success" : undefined} aria-hidden />Live now</SidebarGroupLabel>
        <SidebarMenu>
          {liveEvent === undefined ? <SidebarMenuItem><div className="flex h-7 items-center px-2"><Skeleton className="h-3 w-32" /></div></SidebarMenuItem>
            : liveEvent === null ? <SidebarMenuItem><SidebarMenuButton render={<Link href="/events/new" />} className="text-[var(--dq-fg-2)]"><Plus aria-hidden /><span>No live event. Create one</span></SidebarMenuButton></SidebarMenuItem>
            : <EventNav event={liveEvent} active={inEvent(liveEvent)} />}
        </SidebarMenu>
      </SidebarGroup>}
      {active && other && <SidebarGroup>
        <SidebarGroupLabel>{other.practice ? "Practice event" : "Open event"}</SidebarGroupLabel>
        <SidebarMenu><EventNav event={other} active={inEvent(other)} /></SidebarMenu>
      </SidebarGroup>}
      <SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarMenu>
          <NavItem href="/events" label="Events" keys={["G", "E"]} icon={<CalendarDays aria-hidden />} active={eventsActive} />
          <NavItem href="/events/practice" label="Practice" keys={["G", "P"]} icon={<FlaskConical aria-hidden />} active={practiceActive} />
          <NavItem href="/styles" label="Styles" keys={["G", "S"]} icon={<Palette aria-hidden />} active={pathname === "/styles"} />
          <NavItem href="/members" label="Members" keys={["G", "M"]} icon={<Users aria-hidden />} active={pathname === "/members"} />
          <NavItem href="/events/connections" label="Connections" keys={["G", "C"]} icon={<Plug aria-hidden />} active={pathname === "/events/connections"} />
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter className="px-2 pb-2">
      <SidebarMenu>
        <NavItem href="/events/getting-started" label="Getting started" keys={["G", "G"]} icon={<ListChecks aria-hidden />} active={pathname === "/events/getting-started"} />
      </SidebarMenu>
      <div className="dq-account-row">
        <WorkspaceAccountMenu email={email} displayName={displayName} organizations={organizations} activeOrganizationId={activeOrganizationId} switching={switching} onSelectOrganization={onSelectOrganization} />
        <span className="min-w-0 truncate text-[12px] text-[var(--dq-fg-2)]" title={email}>{displayName || email}</span>
      </div>
    </SidebarFooter>
  </Sidebar>;
}

/** An event in the sidebar: one item with its phase. Its sections are the tabs on its page. */
function EventNav({ event, active }: { event: ShellEvent; active: boolean }) {
  return <SidebarMenuItem>
    <SidebarMenuButton render={<InPageLink href={adminPath(event.slug)} />} isActive={active}>
      {event.practice ? <FlaskConical aria-hidden /> : event.eventType === "hackathon" ? <Code2 aria-hidden /> : <Presentation aria-hidden />}<span className="truncate">{event.name}</span>
      {event.phase && <span className="dq-nav-phase" data-phase={event.phase}>{phaseTabLabel(event.eventType, event.phase)}</span>}
    </SidebarMenuButton>
  </SidebarMenuItem>;
}

function NavItem({ href, label, keys, icon, active }: { href: string; label: string; keys: string[]; icon: ReactNode; active: boolean }) {
  return <SidebarMenuItem>
    <ShortcutTooltip label={label} keys={keys} side="right">
      <SidebarMenuButton render={<Link href={href} />} isActive={active}>{icon}<span>{label}</span></SidebarMenuButton>
    </ShortcutTooltip>
  </SidebarMenuItem>;
}

const VIEW_ICONS: Record<AdminView, LucideIcon> = { submissions: Inbox, judging: Gavel, stage: Presentation, queue: ListOrdered, results: Trophy, settings: Settings };

async function copyLink(url: string, done: string) {
  try { await navigator.clipboard.writeText(url); toast(done); } catch { toast.error("Could not copy. Open Share on the event and copy it there."); }
}

/** Navigation and creation commands that work on every organiser page. */
function GlobalCommands({ liveEvent, organizations, activeOrganizationId, switching, onSelectOrganization }: ShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const navigate = useInPageNavigate();
  const { setSheetOpen } = useCommandRegistry();
  const onLiveEvent = !!liveEvent && pathname === adminPath(liveEvent.slug);
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "new-event", group: "Create", label: "New event", keys: ["C"], icon: Plus, run: () => router.push("/events/new") },
      { id: "new-practice", group: "Create", label: "New practice event", icon: FlaskConical, keywords: ["test", "rehearse"], run: () => router.push("/events/practice?new=1") },
      { id: "go-events", group: "Go to", label: "Events", keys: ["G", "E"], icon: CalendarDays, run: () => router.push("/events") },
      { id: "go-practice", group: "Go to", label: "Practice", keys: ["G", "P"], icon: FlaskConical, run: () => router.push("/events/practice") },
      { id: "go-styles", group: "Go to", label: "Styles", keys: ["G", "S"], icon: Palette, keywords: ["theme", "brand"], run: () => router.push("/styles") },
      { id: "go-members", group: "Go to", label: "Members", keys: ["G", "M"], icon: Users, keywords: ["people", "invite", "team"], run: () => router.push("/members") },
      { id: "go-connections", group: "Go to", label: "Connections", keys: ["G", "C"], icon: Plug, keywords: ["mcp", "assistant", "google"], run: () => router.push("/events/connections") },
      { id: "go-guide", group: "Go to", label: "Getting started", keys: ["G", "G"], icon: ListChecks, keywords: ["guide", "help"], run: () => router.push("/events/getting-started") },
      { id: "shortcuts", group: "Help", label: "Keyboard shortcuts", keys: ["?"], icon: Keyboard, run: () => setSheetOpen(true) },
    ];
    if (liveEvent) {
      // The event's name is the group's heading, so each row is just the place.
      const group = liveGroup(liveEvent.name);
      list.push({ id: "go-live", group, label: "Current phase", hint: liveEvent.phase ? phaseTabLabel(liveEvent.eventType, liveEvent.phase) : undefined, keys: ["G", LIVE_KEY], icon: Radio, keywords: ["live", "open event"], run: () => navigate(adminPath(liveEvent.slug)) });
      for (const item of adminViewsFor(liveEvent.eventType)) {
        list.push({ id: `go-${item.view}`, group, label: item.label, keys: ["G", ADMIN_VIEW_KEYS[item.view]], icon: VIEW_ICONS[item.view], run: () => navigate(adminViewPath(liveEvent.slug, item.view)) });
      }
      // The Judges page is part of Judging now; its key still opens the judges.
      if (liveEvent.eventType === "hackathon") list.push({ id: "go-judges", group, label: "Judges", keys: ["G", JUDGES_KEY], icon: UserCheck, run: () => navigate(judgingPath(liveEvent.slug)) });
      // On the live event's own page, Share's commands under This page do the same.
      if (!onLiveEvent) {
        list.push({ id: "live-copy-submit", group, label: "Copy the submit link", icon: Link2, keywords: ["share", "qr"], run: () => void copyLink(absoluteUrl(submissionPath(liveEvent.slug)), "Submit link copied") });
        list.push({ id: "live-open-stage", group, label: "Open presentation view", hint: "New tab", icon: MonitorPlay, keywords: ["stage", "projector"], run: () => { window.open(stagePath(liveEvent.slug), "_blank", "noopener"); } });
      }
    }
    if (organizations.length > 1) for (const org of organizations) {
      if (org.id === activeOrganizationId) continue;
      list.push({ id: `org-${org.id}`, group: "Switch organization", label: `Switch to ${org.name}`, icon: Building2, keywords: ["organization", "workspace"], disabled: switching, run: () => void onSelectOrganization(org.id) });
    }
    return list;
  }, [router, navigate, setSheetOpen, liveEvent, onLiveEvent, organizations, activeOrganizationId, switching, onSelectOrganization]);
  useCommands("global", commands);
  return null;
}

/** The header at the top of the main panel: breadcrumb on the left, page actions on the right. */
export function PageHeader({ crumbs, actions }: { crumbs: { label: string; href?: string }[]; actions?: ReactNode }) {
  return <header className="dq-header">
    <SidebarToggle />
    <nav aria-label="Breadcrumb" className="dq-header-title"><ol>{crumbs.map((crumb, index) => <li key={`${crumb.label}-${index}`} aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb.href && index < crumbs.length - 1 ? <Link href={crumb.href}>{crumb.label}</Link> : <span className="truncate">{crumb.label}</span>}</li>)}</ol></nav>
    {actions && <div className="dq-header-actions">{actions}</div>}
  </header>;
}

function SidebarToggle() {
  return <ShortcutTooltip label="Toggle sidebar" keys={["⌘", "B"]}><SidebarTrigger className="-ml-1 text-[var(--dq-fg-2)]" /></ShortcutTooltip>;
}
