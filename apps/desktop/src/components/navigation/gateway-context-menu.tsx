"use client";

import { useRef, useEffect } from "react";
import { IconPlay, IconStop, IconGlobe, IconCpu, IconHash, IconShield, IconSettings, IconXCircle, IconX, IconEdit } from "../icons";
import type { Gateway } from "../../lib/stores/gateway-store";

export function GatewayContextMenu({
  ctxMenu,
  ctxEndpoint,
  ctxCdpEndpoint,
  gateways,
  securityOfficerId,
  onAction,
  onClose,
}: {
  ctxMenu: { x: number; y: number; gatewayId: string };
  ctxEndpoint: string | null;
  ctxCdpEndpoint: string | null;
  gateways: Gateway[];
  securityOfficerId: string | null;
  onAction: (action: string) => void;
  onClose: () => void;
}) {
  const ctxRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const ctxGw = gateways.find((g) => g.id === ctxMenu.gatewayId);
  if (!ctxGw) return null;

  return (
    <div
      ref={ctxRef}
      className="fixed z-[999] min-w-[180px] overflow-hidden rounded-lg bg-bg-surface py-1 shadow-xl ring-1 ring-border-default"
      style={{ left: ctxMenu.x, top: ctxMenu.y }}
    >
      {/* Gateway name header */}
      <div className="px-3 py-1.5 text-[11px] font-medium text-text-ghost">
        {ctxGw.emoji} {ctxGw.name}
      </div>
      {ctxEndpoint && (
        <div className="px-3 pb-1 text-[10px] font-mono text-text-ghost/70">
          API {ctxEndpoint}
        </div>
      )}
      {ctxCdpEndpoint && (
        <div className="px-3 pb-1 text-[10px] font-mono text-text-ghost/70">
          Relay {ctxCdpEndpoint}
        </div>
      )}
      <div className="my-0.5 h-px bg-border-subtle" />
      <button
        onClick={() => onAction("start")}
        disabled={!ctxGw.configured || ctxGw.serviceState === "running" || ctxGw.serviceState === "starting" || ctxGw.serviceState === "stopping"}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
      >
        <IconPlay size={14} className="shrink-0 text-accent-emerald" />
        Start Gateway
      </button>
      <button
        onClick={() => onAction("stop")}
        disabled={!ctxGw.configured || ctxGw.serviceState === "stopped" || ctxGw.serviceState === "unconfigured" || ctxGw.serviceState === "starting" || ctxGw.serviceState === "stopping"}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
      >
        <IconStop size={14} className="shrink-0 text-accent-red" />
        Stop Gateway
      </button>
      <button
        onClick={() => onAction("open-gateway")}
        disabled={!ctxGw.configured || ctxGw.serviceState !== "running"}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
      >
        <IconGlobe size={14} className="shrink-0 text-accent-emerald" />
        Connect Gateway
      </button>
      <div className="my-1 h-px bg-border-subtle" />
      <button
        onClick={() => onAction("config-model")}
        disabled={!ctxGw.configured}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
      >
        <IconCpu size={14} className="shrink-0 text-text-tertiary" />
        Model Config...
      </button>
      <button
        onClick={() => onAction("config-channels")}
        disabled={!ctxGw.configured}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
      >
        <IconHash size={14} className="shrink-0 text-text-tertiary" />
        Channel Config...
      </button>
      <div className="my-1 h-px bg-border-subtle" />
      <button
        onClick={() => onAction("security-officer")}
        disabled={!ctxGw.configured || (securityOfficerId !== null && securityOfficerId !== ctxGw.id)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
      >
        <IconShield size={14} className={`shrink-0 ${securityOfficerId === ctxGw.id ? "text-accent-amber" : "text-text-tertiary"}`} />
        {securityOfficerId === ctxGw.id ? "Remove Security Officer" : "Set as Security Officer"}
      </button>
      <div className="my-1 h-px bg-border-subtle" />
      <button
        onClick={() => onAction("reconfigure")}
        disabled={!ctxGw.configured}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
      >
        <IconSettings size={14} className="shrink-0 text-text-tertiary" />
        Reconfigure...
      </button>
      {ctxGw.id !== "default" && (
        <>
          <div className="my-1 h-px bg-border-subtle" />
          <button
            onClick={() => onAction("rename")}
            disabled={!ctxGw.configured}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconEdit size={14} className="shrink-0 text-text-tertiary" />
            {"Rename..."}
          </button>
          <button
            onClick={() => onAction("delete")}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-accent-red transition-colors hover:bg-accent-red/10"
          >
            <IconXCircle size={14} className="shrink-0 text-accent-red" />
            Delete Gateway
          </button>
        </>
      )}
      <div className="my-1 h-px bg-border-subtle" />
      <button
        onClick={onClose}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover"
      >
        <IconX size={14} className="shrink-0" />
        Close
      </button>
    </div>
  );
}
