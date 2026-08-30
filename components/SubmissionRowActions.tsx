"use client";

import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SubmissionRowActions({
  menuLabel,
  menuItems,
}: {
  menuLabel: string;
  menuItems: { label: string; onSelect: () => void }[];
}) {
  if (menuItems.length === 0) return null;

  return (
    <div className="table-actions">
      <DropdownMenu>
        <DropdownMenuTrigger className="table-row-menu-trigger" aria-label={menuLabel}>
          <MoreHorizontal size={16} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="table-row-menu-content" sideOffset={4}>
          {menuItems.map((action) => (
            <DropdownMenuItem
              className="table-row-menu-item"
              key={action.label}
              onClick={action.onSelect}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
