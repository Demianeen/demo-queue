"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Building2, Check, Link2, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logOut } from "@/app/events/actions";

type Organization = { id: string; name: string };

export function WorkspaceAccountMenu({ email, displayName, organizations, activeOrganizationId, switching, onSelectOrganization }: {
  email: string; displayName: string; organizations: Organization[]; activeOrganizationId?: string;
  switching: boolean; onSelectOrganization: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const active = organizations.find((org) => org.id === activeOrganizationId);
  const name = displayName || email;
  const initials = displayName.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || email[0].toUpperCase();
  const profileAvatar = <Avatar className="workspace-profile-avatar"><AvatarImage src={user?.profilePictureUrl ?? undefined} alt="" referrerPolicy="no-referrer" /><AvatarFallback>{initials}</AvatarFallback></Avatar>;

  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger className="workspace-avatar" aria-label={`Account: ${email}`}>{profileAvatar}</DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} className="workspace-account-menu">
      <div className="workspace-account-profile">
        {profileAvatar}
        <div className="workspace-account-identity"><span className="workspace-account-name" title={name}>{name}</span><span className="workspace-account-email" title={email}>{email}</span></div>
      </div>
      {organizations.length > 0 && <><DropdownMenuSeparator /><DropdownMenuGroup>
        <DropdownMenuLabel>Organization</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={switching}><Building2 aria-hidden /><span className="workspace-account-org-name">{active?.name ?? "Choose organization"}</span></DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="workspace-account-menu workspace-account-organizations" sideOffset={8}>
            <DropdownMenuGroup><DropdownMenuLabel>Switch organization</DropdownMenuLabel>
              {organizations.map((org) => <DropdownMenuItem key={org.id} disabled={switching} aria-current={org.id === activeOrganizationId ? "true" : undefined} onClick={() => { setOpen(false); void onSelectOrganization(org.id); }}>
                <Building2 aria-hidden /><span className="workspace-account-org-name">{org.name}</span>{org.id === activeOrganizationId && <Check aria-hidden className="workspace-account-check" />}
              </DropdownMenuItem>)}
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup></>}
      <DropdownMenuSeparator />
      <DropdownMenuItem render={<Link href="/saved" />}><Link2 aria-hidden />Saved event links</DropdownMenuItem>
      <DropdownMenuSeparator />
      <form action={logOut}><SignOutItem /></form>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function SignOutItem() {
  const { pending } = useFormStatus();
  return <DropdownMenuItem variant="destructive" nativeButton closeOnClick={false} disabled={pending} render={<button type="submit" />}><LogOut aria-hidden />{pending ? "Signing out…" : "Sign out"}</DropdownMenuItem>;
}
