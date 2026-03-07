"use client";

import {
  IconPlus,
  IconChevronRight,
} from "./icons";
import type { ServiceState } from "../app/page";

export type GatewayItem = {
  id: string;
  name: string;
  emoji: string;
  serviceState: ServiceState;
};

export function Sidebar({
  expanded,
  onToggleExpanded,
  gateways,
  activeItem,
  onSelect,
  onAddGateway,
  onGatewayContextMenu,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
  gateways: GatewayItem[];
  activeItem: string;
  onSelect: (id: string) => void;
  onAddGateway: () => void;
  onGatewayContextMenu?: (id: string, e: React.MouseEvent) => void;
}) {
  return (
    <nav
      className={`flex h-full shrink-0 flex-col bg-bg-deep transition-all duration-200 ${
        expanded ? "w-[200px]" : "w-[60px]"
      }`}
    >
      {/* Gateway items */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-1 pt-2">
        {gateways.map((item) => {
          const isActive = activeItem === item.id;
          const statusColor =
            item.serviceState === "running"
              ? "bg-accent-emerald"
              : item.serviceState === "error"
                ? "bg-accent-red"
                : "bg-text-ghost";

          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onGatewayContextMenu?.(item.id, e);
              }}
              className={`group relative flex w-full items-center rounded-lg transition-all duration-150 ${
                expanded ? "gap-2.5 px-2.5 py-2" : "flex-col gap-1 px-1 py-2"
              } ${
                isActive
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-tertiary hover:bg-bg-surface hover:text-text-secondary"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-emerald" />
              )}

              <div className="relative shrink-0">
                <span className={`leading-none ${expanded ? "text-[16px]" : "text-[15px] opacity-80"}`}>
                  {item.emoji}
                </span>
                <span
                  className={`absolute -right-1 -top-1 block h-[6px] w-[6px] rounded-full ring-1 ring-bg-deep ${statusColor}`}
                />
              </div>

              {expanded ? (
                <span className="min-w-0 truncate text-[12px] font-medium leading-tight">
                  {item.name}
                </span>
              ) : (
                <span className="max-w-full truncate text-[9px] font-medium leading-none tracking-wide">
                  {item.name.length > 6 ? item.name.slice(0, 5) + "\u2026" : item.name}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className={`flex flex-col gap-0.5 border-t border-border-subtle px-1 py-2 ${expanded ? "" : "items-center"}`}>
        <SidebarBtn onClick={onAddGateway} expanded={expanded} label="Add Gateway">
          <IconPlus size={15} />
        </SidebarBtn>
        <SidebarBtn onClick={onToggleExpanded} expanded={expanded} label={expanded ? "Collapse" : "Expand"}>
          <IconChevronRight size={15} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </SidebarBtn>
      </div>
    </nav>
  );
}

function SidebarBtn({
  children,
  onClick,
  expanded,
  label,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  expanded?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center rounded-md text-text-tertiary transition-colors hover:bg-bg-surface hover:text-text-secondary ${
        expanded
          ? "w-full gap-2.5 px-2.5 py-1.5"
          : "h-8 w-8 justify-center"
      }`}
    >
      <span className="shrink-0">{children}</span>
      {expanded && label && (
        <span className="text-[11px] font-medium">{label}</span>
      )}
    </button>
  );
}
