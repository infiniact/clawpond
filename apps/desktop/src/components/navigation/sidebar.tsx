"use client";

import { useState, useRef, useEffect } from "react";
import {
  IconPlus,
  IconChevronRight,
  IconShield,
  IconSearch,
} from "../icons";
import type { ServiceState } from "../../lib/stores/gateway-store";
import { EMOJI_OPTIONS, FEATURED_COUNT } from "../../lib/emoji-data";

export type GatewayItem = {
  id: string;
  name: string;
  emoji: string;
  serviceState: ServiceState;
  cpuPercent?: number;
  memUsageMb?: number;
  busy?: boolean;
  isSecurityOfficer?: boolean;
};

export function Sidebar({
  expanded,
  onToggleExpanded,
  gateways,
  activeItem,
  onSelect,
  onAddGateway,
  onGatewayContextMenu,
  onEmojiChange,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
  gateways: GatewayItem[];
  activeItem: string;
  onSelect: (id: string) => void;
  onAddGateway: () => void;
  onGatewayContextMenu?: (id: string, e: React.MouseEvent) => void;
  onEmojiChange?: (gatewayId: string, emoji: string) => void;
}) {
  const [emojiPicker, setEmojiPicker] = useState<{ gatewayId: string; x: number; y: number } | null>(null);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [emojiShowAll, setEmojiShowAll] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  // Close emoji picker on click outside
  useEffect(() => {
    if (!emojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setEmojiPicker(null);
        setEmojiSearch("");
        setEmojiShowAll(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [emojiPicker]);

  const filtered = emojiSearch
    ? EMOJI_OPTIONS.filter((e) =>
        e.kw.toLowerCase().includes(emojiSearch.toLowerCase()) ||
        e.emoji.includes(emojiSearch)
      )
    : emojiShowAll
      ? EMOJI_OPTIONS
      : EMOJI_OPTIONS.slice(0, FEATURED_COUNT);

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
          const isLoading = item.serviceState === "loading" || item.serviceState === "starting" || item.serviceState === "stopping";
          const statusColor =
            item.serviceState === "running"
              ? "bg-accent-emerald"
              : item.serviceState === "error"
                ? "bg-accent-red"
                : item.serviceState === "loading" || item.serviceState === "starting"
                  ? "bg-amber-400"
                  : item.serviceState === "stopping"
                    ? "bg-amber-400"
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
                <span
                  className={`leading-none cursor-pointer ${expanded ? "text-[16px]" : "text-[15px] opacity-80"}`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setEmojiPicker({ gatewayId: item.id, x: rect.left, y: rect.bottom + 4 });
                  }}
                  title="Double-click to change icon"
                >
                  {item.emoji}
                </span>
                <span
                  className={`absolute -right-1 -top-1 block h-[6px] w-[6px] rounded-full ring-1 ring-bg-deep ${statusColor}${isLoading ? " animate-pulse" : ""}`}
                />
                {item.busy && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2">
                    <svg className="animate-spin h-[10px] w-[10px] text-accent-blue" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
                {item.isSecurityOfficer && (
                  <span className="absolute -bottom-1 -right-1.5" title="Security Officer">
                    <IconShield size={9} className="text-amber-400" />
                  </span>
                )}
              </div>

              {expanded ? (
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium leading-tight">
                    {item.name}
                  </span>
                  {item.serviceState === "loading" && (
                    <span className="block truncate text-[9px] leading-tight text-amber-400 animate-pulse">
                      loading...
                    </span>
                  )}
                  {item.serviceState === "running" && item.cpuPercent != null && item.memUsageMb != null && (
                    <span className="block truncate text-[9px] leading-tight text-text-ghost">
                      CPU {item.cpuPercent.toFixed(1)}% · {item.memUsageMb < 1024
                        ? `${item.memUsageMb.toFixed(0)}MB`
                        : `${(item.memUsageMb / 1024).toFixed(1)}GB`}
                    </span>
                  )}
                </div>
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

      {/* Emoji picker popup */}
      {emojiPicker && (
        <div
          ref={emojiRef}
          className="fixed z-[1000] w-[220px] rounded-xl bg-bg-surface p-3 shadow-xl ring-1 ring-border-default"
          style={{ left: Math.min(emojiPicker.x, window.innerWidth - 240), top: Math.min(emojiPicker.y, window.innerHeight - 280) }}
        >
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-bg-elevated px-2 py-1.5 ring-1 ring-border-default">
            <IconSearch size={12} className="shrink-0 text-text-ghost" />
            <input
              type="text"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-[11px] text-text-primary placeholder:text-text-ghost focus:outline-none"
            />
          </div>
          <div className="grid max-h-[180px] grid-cols-8 gap-0.5 overflow-y-auto">
            {filtered.map((e) => (
              <button
                key={e.emoji}
                onClick={() => {
                  onEmojiChange?.(emojiPicker.gatewayId, e.emoji);
                  setEmojiPicker(null);
                  setEmojiSearch("");
                  setEmojiShowAll(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] transition-all hover:bg-bg-hover"
              >
                {e.emoji}
              </button>
            ))}
          </div>
          {!emojiSearch && !emojiShowAll && EMOJI_OPTIONS.length > FEATURED_COUNT && (
            <button
              onClick={() => setEmojiShowAll(true)}
              className="mt-2 w-full text-center text-[11px] font-medium text-accent-emerald hover:underline"
            >
              Show more ({EMOJI_OPTIONS.length - FEATURED_COUNT} more)
            </button>
          )}
        </div>
      )}
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
