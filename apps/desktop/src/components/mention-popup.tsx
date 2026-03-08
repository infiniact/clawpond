"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { GatewayInfo } from "../lib/rpc-pool";

export function MentionPopup({
  query,
  gateways,
  currentGatewayId,
  onSelect,
  onClose,
  anchorRect,
}: {
  query: string;
  gateways: GatewayInfo[];
  currentGatewayId: string;
  onSelect: (gateway: GatewayInfo) => void;
  onClose: () => void;
  anchorRect: { left: number; bottom: number } | null;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);

  // Filter gateways: exclude current, match query
  const filtered = gateways.filter((g) => {
    if (g.id === currentGatewayId) return false;
    if (!query) return true;
    return g.name.toLowerCase().includes(query.toLowerCase());
  });

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const gw = filtered[selectedIndex];
        if (gw && gw.serviceState === "running") {
          onSelect(gw);
        }
        return;
      }
    },
    [filtered, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (filtered.length === 0) return null;
  if (!anchorRect) return null;

  return (
    <div
      ref={popupRef}
      className="fixed z-[100] min-w-[200px] max-w-[280px] overflow-hidden rounded-lg bg-bg-surface py-1 shadow-xl ring-1 ring-border-default"
      style={{
        left: anchorRect.left,
        bottom: window.innerHeight - anchorRect.bottom + 8,
      }}
    >
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-ghost">
        Mention Gateway
      </div>
      {filtered.map((gw, i) => {
        const isRunning = gw.serviceState === "running";
        const isSelected = i === selectedIndex;
        return (
          <button
            key={gw.id}
            onClick={() => {
              if (isRunning) onSelect(gw);
            }}
            onMouseEnter={() => setSelectedIndex(i)}
            disabled={!isRunning}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors ${
              isSelected ? "bg-bg-hover" : ""
            } ${
              isRunning
                ? "text-text-primary hover:bg-bg-hover"
                : "cursor-not-allowed text-text-ghost opacity-50"
            }`}
          >
            <span className="text-[14px] leading-none">{gw.emoji}</span>
            <span className="flex-1 truncate font-medium">{gw.name}</span>
            {!isRunning && (
              <span className="text-[10px] text-text-ghost">stopped</span>
            )}
            {isRunning && (
              <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald" />
            )}
          </button>
        );
      })}
    </div>
  );
}
