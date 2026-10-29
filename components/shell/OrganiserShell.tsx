"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { Building2, CalendarDays, Check, ChevronsUpDown, Code2, ListChecks, Palette, Plug, Plus, Presentation, Search, Users } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarTrigger,
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
import { eventDetailsPath } from "@/lib/workspace-routes";
import { adminPath } from "@/lib/routes";
import { adminViewPath, adminViewsFor, type AdminView } from "@/lib/admin-views";

type Organization = { id: string; name: string };
export type ShellEvent = { name: string; slug: string; eventType: "demo" | "hackathon" };

export type ShellProps = {
  organizations: Organization[];
  activeOrganizationId?: string;
  email: string;
  displayName: string;
  switching: boolean;
  onSelectOrganization: (id: string) => Promise<void>;
  /** The org's current event, shown under "Current event". Undefined while loading, null when there is none. */
  currentEvent: ShellEvent | null | undefined;
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
        <CommandMenu />
        <ShortcutSheet />
        <Toaster position="bottom-right" />
      </CommandProvider>
    </TooltipProvider>
  </div>;
}

function useActiveAdminView(): AdminView | undefined {
  const pathname = usePathname();
  const search = useSearchParams();
  if (!/^\/events\/[^/]+\/admin$/.test(pathname)) return undefined;
  const view = search.get("view");
  return (view && ["queue", "submissions", "judging", "settings"].includes(view) ? view : "queue") as AdminView;
}

function ShellSidebar({ organizations, activeOrganizationId, email, displayName, switching, onSelectOrganization, currentEvent }: ShellProps) {
  const pathname = usePathname();
  const adminView = useActiveAdminView();
  const { setMenuOpen } = useCommandRegistry();
  const active = organizations.find((org) => org.id === activeOrganizationId);
  const inCurrentEvent = !!currentEvent && pathname.startsWith(`/events/${currentEvent.slug}/`);
  const eventsActive = pathname === "/events" || pathname === "/events/new" || (/^\/events\/[^/]+\/(overview|admin)$/.test(pathname) && !inCurrentEvent);

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
        <SidebarGroupLabel>Current event</SidebarGroupLabel>
        <SidebarMenu>
          {currentEvent === undefined ? <SidebarMenuItem><div className="flex h-7 items-center px-2"><Skeleton className="h-3 w-32" /></div></SidebarMenuItem>
            : currentEvent === null ? <SidebarMenuItem><SidebarMenuButton render={<Link href="/events/new" />} className="text-[var(--dq-fg-2)]"><Plus aria-hidden /><span>Create your first event</span></SidebarMenuButton></SidebarMenuItem>
            : <SidebarMenuItem>
              <SidebarMenuButton render={<Link href={eventDetailsPath(currentEvent.slug)} />} isActive={pathname === eventDetailsPath(currentEvent.slug)}>
                {currentEvent.eventType === "hackathon" ? <Code2 aria-hidden /> : <Presentation aria-hidden />}<span>{currentEvent.name}</span>
              </SidebarMenuButton>
              <SidebarMenuSub>
                {adminViewsFor(currentEvent.eventType).map((item) => <SidebarMenuSubItem key={item.view}>
                  <SidebarMenuSubButton render={<Link href={adminViewPath(currentEvent.slug, item.view)} />} isActive={inCurrentEvent && adminView === item.view}><span>{item.label}</span></SidebarMenuSubButton>
                </SidebarMenuSubItem>)}
              </SidebarMenuSub>
            </SidebarMenuItem>}
        </SidebarMenu>
      </SidebarGroup>}
      <SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarMenu>
          <NavItem href="/events" label="Events" keys={["G", "E"]} icon={<CalendarDays aria-hidden />} active={Boolean(eventsActive)} />
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

function NavItem({ href, label, keys, icon, active }: { href: string; label: string; keys: string[]; icon: ReactNode; active: boolean }) {
  return <SidebarMenuItem>
    <ShortcutTooltip label={label} keys={keys} side="right">
      <SidebarMenuButton render={<Link href={href} />} isActive={active}>{icon}<span>{label}</span></SidebarMenuButton>
    </ShortcutTooltip>
  </SidebarMenuItem>;
}

/** Navigation and creation commands that work on every organiser page. */
function GlobalCommands({ currentEvent, organizations, activeOrganizationId, switching, onSelectOrganization }: ShellProps) {
  const router = useRouter();
  const { setSheetOpen } = useCommandRegistry();
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "new-event", group: "Create", label: "New event", keys: ["C"], run: () => router.push("/events/new") },
      { id: "go-events", group: "Go to", label: "Events", keys: ["G", "E"], run: () => router.push("/events") },
      { id: "go-styles", group: "Go to", label: "Styles", keys: ["G", "S"], run: () => router.push("/styles") },
      { id: "go-members", group: "Go to", label: "Members", keys: ["G", "M"], run: () => router.push("/members") },
      { id: "go-connections", group: "Go to", label: "Connections", keys: ["G", "C"], run: () => router.push("/events/connections") },
      { id: "go-guide", group: "Go to", label: "Getting started", keys: ["G", "G"], run: () => router.push("/events/getting-started") },
      { id: "shortcuts", group: "Help", label: "Keyboard shortcuts", keys: ["?"], run: () => setSheetOpen(true) },
    ];
    if (currentEvent) {
      list.push({ id: "go-summary", group: "Current event", label: `${currentEvent.name}: summary`, keys: ["G", "O"], run: () => router.push(eventDetailsPath(currentEvent.slug)) });
      const keyFor: Record<AdminView, string> = { queue: "Q", submissions: "U", judging: "J", settings: "T" };
      for (const item of adminViewsFor(currentEvent.eventType)) {
        list.push({ id: `go-${item.view}`, group: "Current event", label: `${currentEvent.name}: ${item.label.toLowerCase()}`, keys: ["G", keyFor[item.view]], run: () => router.push(adminViewPath(currentEvent.slug, item.view)) });
      }
      list.push({ id: "open-admin", group: "Current event", label: "Open event controls", run: () => router.push(adminPath(currentEvent.slug)) });
    }
    if (organizations.length > 1) for (const org of organizations) {
      if (org.id === activeOrganizationId) continue;
      list.push({ id: `org-${org.id}`, group: "Switch organization", label: `Switch to ${org.name}`, disabled: switching, run: () => void onSelectOrganization(org.id) });
    }
    return list;
  }, [router, setSheetOpen, currentEvent, organizations, activeOrganizationId, switching, onSelectOrganization]);
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
