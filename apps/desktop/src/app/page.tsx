"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar, type GatewayItem } from "../components/sidebar";
import { ChatArea } from "../components/chat-area";
import { TaskPanel } from "../components/task-panel";
import { TopBar } from "../components/top-bar";
import { IconPlay, IconStop, IconSettings, IconX, IconGlobe, IconPlus, IconSearch, IconCpu, IconHash, IconFolder, IconDownload, IconCheck, IconSpinner, IconXCircle, IconArrowRight, IconShield } from "../components/icons";
import { QuickModelConfig, QuickChannelsConfig } from "../components/quick-config";
import { RpcPoolProvider } from "../lib/rpc-pool-context";
import type { GatewayInfo } from "../lib/rpc-pool";
import { openUrlInWindow } from "../lib/open-url";

export type ServiceState = "unconfigured" | "loading" | "running" | "error" | "stopped";

export type Gateway = {
  id: string;
  name: string;
  emoji: string;
  type: "docker";
  rootDir: string | null;
  configured: boolean;
  serviceState: ServiceState;
  cpuPercent?: number;
  memUsageMb?: number;
};

/** Persisted gateway shape (no runtime state like serviceState) */
type StoredGateway = {
  id: string;
  name: string;
  emoji: string;
  type: "docker";
  rootDir: string | null;
  configured: boolean;
};

const GATEWAYS_STORAGE_KEY = "clawpond-gateways";
const SHARED_DIR_STORAGE_KEY = "clawpond-shared-dir";

function loadGateways(): Gateway[] {
  try {
    const raw = localStorage.getItem(GATEWAYS_STORAGE_KEY);
    if (raw) {
      const stored: StoredGateway[] = JSON.parse(raw);
      if (Array.isArray(stored) && stored.length > 0) {
        return stored.map((g) => ({
          ...g,
          type: "docker" as const,
          serviceState: !g.configured
            ? "unconfigured" as const
            : "loading" as const,
        }));
      }
    }
  } catch { /* ignore */ }
  return [
    { id: "default", name: "ClawKing", emoji: "\u{1F99E}", type: "docker", rootDir: null, configured: false, serviceState: "unconfigured" },
  ];
}

function saveGateways(gateways: Gateway[]) {
  const stored: StoredGateway[] = gateways.map(({ id, name, emoji, rootDir, configured }) => ({
    id, name, emoji, type: "docker", rootDir, configured,
  }));
  localStorage.setItem(GATEWAYS_STORAGE_KEY, JSON.stringify(stored));
}

// Emoji data for the icon picker
const EMOJI_OPTIONS = [
  { emoji: "🦞", kw: "lobster claw" },
  { emoji: "🐙", kw: "octopus" },
  { emoji: "🦊", kw: "fox" },
  { emoji: "🐺", kw: "wolf" },
  { emoji: "🦁", kw: "lion" },
  { emoji: "🐯", kw: "tiger" },
  { emoji: "🐻", kw: "bear" },
  { emoji: "🦄", kw: "unicorn" },
  { emoji: "🐬", kw: "dolphin" },
  { emoji: "🦈", kw: "shark" },
  { emoji: "🐉", kw: "dragon" },
  { emoji: "🦅", kw: "eagle" },
  { emoji: "🦉", kw: "owl" },
  { emoji: "🐝", kw: "bee" },
  { emoji: "🦋", kw: "butterfly" },
  { emoji: "🔥", kw: "fire hot" },
  { emoji: "⚡", kw: "lightning bolt electric" },
  { emoji: "💎", kw: "diamond gem" },
  { emoji: "🚀", kw: "rocket launch" },
  { emoji: "🛡️", kw: "shield protect" },
  { emoji: "⚔️", kw: "sword fight" },
  { emoji: "🔮", kw: "crystal ball magic" },
  { emoji: "💡", kw: "light idea" },
  { emoji: "🎯", kw: "target aim" },
  { emoji: "🎨", kw: "art paint" },
  { emoji: "📡", kw: "satellite antenna" },
  { emoji: "🔬", kw: "microscope science" },
  { emoji: "🧲", kw: "magnet" },
  { emoji: "🗝️", kw: "key" },
  { emoji: "📦", kw: "package box" },
  { emoji: "🧰", kw: "toolbox" },
  { emoji: "🎲", kw: "dice game" },
  { emoji: "⭐", kw: "star" },
  { emoji: "🌙", kw: "moon night" },
  { emoji: "☀️", kw: "sun" },
  { emoji: "🌊", kw: "wave ocean" },
  { emoji: "🌿", kw: "leaf plant" },
  { emoji: "🍀", kw: "clover luck" },
  { emoji: "❄️", kw: "snow ice" },
  { emoji: "🏗️", kw: "building construction" },
  { emoji: "🤖", kw: "robot bot ai" },
  { emoji: "👾", kw: "alien game" },
  { emoji: "🎮", kw: "game controller" },
  { emoji: "🔧", kw: "wrench tool" },
  { emoji: "⚙️", kw: "gear settings" },
  { emoji: "🏠", kw: "house home" },
  { emoji: "🏢", kw: "office building" },
  { emoji: "🌐", kw: "globe world web" },
  { emoji: "📊", kw: "chart data" },
  { emoji: "🔒", kw: "lock security" },
];

const FEATURED_COUNT = 20;

export default function Home() {
  const [gateways, setGateways] = useState<Gateway[]>(loadGateways);
  const [activeGatewayId, setActiveGatewayId] = useState("default");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(true);
  const [addGatewayModal, setAddGatewayModal] = useState(false);
  const [reconfiguring, setReconfiguring] = useState(false);
  const [quickConfig, setQuickConfig] = useState<"model" | "channels" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ gatewayId: string; name: string; rootDir: string | null; type: GatewayType } | null>(null);
  const [settingsModal, setSettingsModal] = useState(false);
  const [sharedDir, setSharedDir] = useState(() => {
    try { return localStorage.getItem(SHARED_DIR_STORAGE_KEY) || ""; } catch { return ""; }
  });
  const [settingsDraft, setSettingsDraft] = useState("");

  // Persist gateways whenever the list changes
  useEffect(() => {
    saveGateways(gateways);
  }, [gateways]);

  // Context menu state — includes which gateway was right-clicked
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; gatewayId: string } | null>(null);
  const [ctxEndpoint, setCtxEndpoint] = useState<string | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const activeGateway = gateways.find((g) => g.id === activeGatewayId) || gateways[0];

  const updateGateway = useCallback((id: string, updates: Partial<Gateway>) => {
    setGateways((prev) => prev.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  }, []);

  // Suppress default browser context menu globally
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  // Gateway-specific context menu triggered from sidebar
  const handleGatewayContextMenu = useCallback((gatewayId: string, e: React.MouseEvent) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, gatewayId });
    // Resolve the endpoint address for display
    const gw = gateways.find((g) => g.id === gatewayId);
    if (gw?.rootDir) {
      setCtxEndpoint(null);
      import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke<{ port: string; token: string }>("read_gateway_info", { rootDir: gw.rootDir })
          .then((info) => setCtxEndpoint(`127.0.0.1:${info.port}`))
          .catch(() => setCtxEndpoint(null))
      );
    } else {
      setCtxEndpoint(null);
    }
  }, [gateways]);

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  // Close context menu on Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [ctxMenu]);

  async function ctxAction(action: string) {
    if (!ctxMenu) return;
    const targetId = ctxMenu.gatewayId;
    const targetGw = gateways.find((g) => g.id === targetId);
    setCtxMenu(null);
    if (!targetGw) return;

    // Switch to the target gateway first so UI reflects the right one
    setActiveGatewayId(targetId);

    const rootDir = targetGw.rootDir;
    if (action === "reconfigure") {
      setReconfiguring(true);
      return;
    }
    if (action === "delete") {
      setDeleteConfirm({ gatewayId: targetId, name: targetGw.name, rootDir: targetGw.rootDir });
      return;
    }
    if (action === "config-model") {
      setQuickConfig("model");
      return;
    }
    if (action === "config-channels") {
      setQuickConfig("channels");
      return;
    }
    if (action === "open-gateway") {
      if (!rootDir) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const info = await invoke<{ port: string; token: string }>("read_gateway_info", { rootDir });
        const url = `http://localhost:${info.port}/?token=${encodeURIComponent(info.token)}`;
        openUrlInWindow(url, "Gateway");
      } catch { /* ignore */ }
      return;
    }
    if (!rootDir) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (action === "start") {
        await invoke("compose_start", { rootDir });
        updateGateway(targetId, { serviceState: "running" });
      } else if (action === "stop") {
        await invoke("compose_stop", { rootDir });
        updateGateway(targetId, { serviceState: "stopped", cpuPercent: undefined, memUsageMb: undefined });
      }
    } catch {
      updateGateway(targetId, { serviceState: "error" });
    }
    checkHealth();
  }

  // On startup: check health for ALL configured gateways
  useEffect(() => {
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");

      // Auto-detect default gateway config
      try {
        const detected = await invoke<string | null>("detect_config");
        if (detected) {
          setGateways((prev) =>
            prev.map((g) =>
              g.id === "default" && !g.configured
                ? { ...g, rootDir: detected, configured: true, serviceState: "loading" }
                : g
            )
          );
        }
      } catch { /* no existing config */ }

      // Now check health for every configured gateway
      setGateways((prev) => {
        for (const gw of prev) {
          if (!gw.configured || !gw.rootDir) continue;
          checkGatewayHealth(invoke, gw.id, gw.rootDir);
        }
        return prev;
      });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check health for a single docker/local gateway
  async function checkGatewayHealth(
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    gwId: string,
    rootDir: string,
    gwType: GatewayType
  ) {
    try {
      const status = await invoke<{
        running: boolean;
        healthy: boolean | null;
        error: string | null;
      }>("compose_health", { rootDir });
      const isRunning = status.running;
      const serviceState: ServiceState = isRunning
        ? status.healthy === false ? "error" : "running"
        : "stopped";

      updateGateway(gwId, isRunning
        ? { serviceState }
        : { serviceState, cpuPercent: undefined, memUsageMb: undefined });

      // Fetch stats in background
      if (isRunning && gwType === "docker") {
        invoke<{ cpu_percent: number; mem_usage_mb: number } | null>(
          "compose_stats", { rootDir }
        ).then((stats) => {
          if (stats) {
            updateGateway(gwId, {
              cpuPercent: stats.cpu_percent,
              memUsageMb: stats.mem_usage_mb,
            });
          }
        }).catch(() => {});
      }
    } catch {
      updateGateway(gwId, { serviceState: "error", cpuPercent: undefined, memUsageMb: undefined });
    }
  }

  // Probe a remote gateway by attempting a WebSocket connection
  async function probeRemoteGateway(gw: Gateway) {
    if (!gw.remoteHost || !gw.remotePort || !gw.remoteToken) {
      updateGateway(gw.id, { serviceState: "error" });
      return;
    }
    try {
      const { OpenClawRpc } = await import("../lib/openclaw-rpc");
      const probe = new OpenClawRpc();
      await probe.connect(gw.remotePort, gw.remoteToken, gw.remoteHost);
      probe.disconnect();
      updateGateway(gw.id, { serviceState: "running" });
    } catch {
      updateGateway(gw.id, { serviceState: "error" });
    }
  }

  // Poll service health for active gateway
  const checkHealth = useCallback(async () => {
    const rootDir = activeGateway.rootDir;
    if (!rootDir) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await checkGatewayHealth(invoke, activeGatewayId, rootDir, activeGateway.type);
    } catch {
      updateGateway(activeGatewayId, { serviceState: "error", cpuPercent: undefined, memUsageMb: undefined });
    }
  }, [activeGateway.rootDir, activeGateway.type, activeGatewayId, updateGateway]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeGateway.configured || !activeGateway.rootDir || activeGateway.type === "remote") return;
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [activeGateway.configured, activeGateway.rootDir, activeGateway.type, checkHealth]);

  // Listen for tray gateway start/stop actions
  useEffect(() => {
    const rootDir = activeGateway.rootDir;
    if (!rootDir) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("tray-gateway-action", async (event) => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          if (event.payload === "start") {
            await invoke("compose_start", { rootDir });
            updateGateway(activeGatewayId, { serviceState: "running" });
          } else if (event.payload === "stop") {
            await invoke("compose_stop", { rootDir });
            updateGateway(activeGatewayId, { serviceState: "stopped" });
          }
        } catch {
          updateGateway(activeGatewayId, { serviceState: "error" });
        }
        checkHealth();
      });
    })();
    return () => { unlisten?.(); };
  }, [activeGateway.rootDir, activeGatewayId, updateGateway, checkHealth]);

  function handleAddGateway(name: string, emoji: string, type: GatewayType, rootDir?: string, remote?: { host: string; port: string; token: string }) {
    const id = `gw-${Date.now()}`;
    if (type === "docker") {
      const dir = `~/clawpond/clawking/pond/${name}`;
      setGateways((prev) => [...prev, { id, name, emoji, type, rootDir: dir, configured: false, serviceState: "unconfigured" }]);
    } else if (type === "remote") {
      setGateways((prev) => [...prev, {
        id, name, emoji, type, rootDir: null, configured: true, serviceState: "running",
        remoteHost: remote!.host, remotePort: remote!.port, remoteToken: remote!.token,
      }]);
    } else {
      // local or existing
      setGateways((prev) => [...prev, { id, name, emoji, type, rootDir: rootDir!, configured: true, serviceState: "stopped" }]);
    }
    setActiveGatewayId(id);
    setAddGatewayModal(false);
  }

  async function handleDeleteGateway(gatewayId: string, deleteFiles: boolean) {
    const gw = gateways.find((g) => g.id === gatewayId);
    if (!gw) return;

    // Stop the service first if running
    if (gw.rootDir && gw.serviceState === "running" && gw.type !== "remote") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("compose_stop", { rootDir: gw.rootDir });
      } catch { /* ignore */ }
    }

    // Delete config files if requested
    if (deleteFiles && gw.rootDir && gw.type !== "remote") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("run_shell_command", { command: `rm -rf "${gw.rootDir}"` });
      } catch { /* ignore */ }
    }

    // Remove from list and switch to default
    setGateways((prev) => prev.filter((g) => g.id !== gatewayId));
    if (activeGatewayId === gatewayId) {
      setActiveGatewayId("default");
    }
    setDeleteConfirm(null);
  }

  const isDefaultGateway = activeGatewayId === "default";
  const sidebarGateways: GatewayItem[] = gateways.map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    serviceState: g.serviceState,
    cpuPercent: g.cpuPercent,
    memUsageMb: g.memUsageMb,
  }));

  // Map gateways to GatewayInfo for the RPC pool context
  const gatewayInfos: GatewayInfo[] = gateways.map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    serviceState: g.serviceState,
    rootDir: g.rootDir,
    remoteHost: g.remoteHost,
    remotePort: g.remotePort,
    remoteToken: g.remoteToken,
  }));

  return (
    <RpcPoolProvider gateways={gatewayInfos}>
    <div className="flex h-screen flex-col overflow-hidden bg-bg-deep font-sans">
      <TopBar onSettings={() => { setSettingsDraft(sharedDir); setSettingsModal(true); }} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          expanded={sidebarExpanded}
          onToggleExpanded={() => setSidebarExpanded((v) => !v)}
          gateways={sidebarGateways}
          activeItem={activeGatewayId}
          onSelect={setActiveGatewayId}
          onAddGateway={() => setAddGatewayModal(true)}
          onGatewayContextMenu={handleGatewayContextMenu}
        />
        {gateways.map((g) => {
          const isActive = g.id === activeGatewayId;
          const isDefault = g.id === "default";
          return (
            <ChatArea
              key={g.id}
              hidden={!isActive}
              onToggleTaskPanel={() => setTaskPanelOpen((v) => !v)}
              taskPanelOpen={taskPanelOpen}
              gatewayName={g.name}
              gatewayEmoji={g.emoji}
              gatewayId={g.id}
              configured={g.configured}
              reconfiguring={isActive && reconfiguring}
              onCloseReconfig={() => setReconfiguring(false)}
              onConfigComplete={(dir: string) => {
                updateGateway(g.id, { rootDir: dir, configured: true, serviceState: "running" });
                setReconfiguring(false);
              }}
              rootDir={g.rootDir}
              serviceState={g.serviceState}
              skipDocker={!isDefault}
              fixedRootDir={!isDefault && g.rootDir ? g.rootDir : undefined}
              remoteHost={g.remoteHost}
              remotePort={g.remotePort}
              remoteToken={g.remoteToken}
              sharedDir={sharedDir}
            />
          );
        })}
        <TaskPanel collapsed={!taskPanelOpen} onToggle={() => setTaskPanelOpen((v) => !v)} />
      </div>

      {/* Custom context menu — scoped to the right-clicked gateway */}
      {ctxMenu && (() => {
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
            {ctxGw.type === "remote" && <span className="ml-1.5 text-text-ghost">(read-only)</span>}
          </div>
          {ctxEndpoint && (
            <div className="px-3 pb-1 text-[10px] font-mono text-text-ghost/70">
              {ctxEndpoint}
            </div>
          )}
          <div className="my-0.5 h-px bg-border-subtle" />
          <button
            onClick={() => ctxAction("start")}
            disabled={ctxGw.type === "remote" || !ctxGw.configured || ctxGw.serviceState === "running"}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconPlay size={14} className="shrink-0 text-accent-emerald" />
            Start Gateway
          </button>
          <button
            onClick={() => ctxAction("stop")}
            disabled={ctxGw.type === "remote" || !ctxGw.configured || ctxGw.serviceState === "stopped" || ctxGw.serviceState === "unconfigured"}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconStop size={14} className="shrink-0 text-accent-red" />
            Stop Gateway
          </button>
          <button
            onClick={() => ctxAction("open-gateway")}
            disabled={!ctxGw.configured || ctxGw.serviceState !== "running"}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconGlobe size={14} className="shrink-0 text-accent-emerald" />
            Connect Gateway
          </button>
          <div className="my-1 h-px bg-border-subtle" />
          <button
            onClick={() => ctxAction("config-model")}
            disabled={ctxGw.type === "remote" || !ctxGw.configured}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconCpu size={14} className="shrink-0 text-text-tertiary" />
            Model Config...
          </button>
          <button
            onClick={() => ctxAction("config-channels")}
            disabled={ctxGw.type === "remote" || !ctxGw.configured}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconHash size={14} className="shrink-0 text-text-tertiary" />
            Channel Config...
          </button>
          <div className="my-1 h-px bg-border-subtle" />
          <button
            onClick={() => ctxAction("reconfigure")}
            disabled={ctxGw.type === "remote" || !ctxGw.configured}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconSettings size={14} className="shrink-0 text-text-tertiary" />
            Reconfigure...
          </button>
          {ctxGw.id !== "default" && (
            <>
              <div className="my-1 h-px bg-border-subtle" />
              <button
                onClick={() => ctxAction("delete")}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-accent-red transition-colors hover:bg-accent-red/10"
              >
                <IconXCircle size={14} className="shrink-0 text-accent-red" />
                Delete Gateway
              </button>
            </>
          )}
          <div className="my-1 h-px bg-border-subtle" />
          <button
            onClick={() => setCtxMenu(null)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover"
          >
            <IconX size={14} className="shrink-0" />
            Close
          </button>
        </div>
        );
      })()}

      {/* Add Gateway Modal */}
      {addGatewayModal && (
        <AddGatewayModal
          onConfirm={handleAddGateway}
          onCancel={() => setAddGatewayModal(false)}
          existingNames={gateways.map((g) => g.name.toLowerCase())}
        />
      )}

      {/* Quick Model Config */}
      {quickConfig === "model" && activeGateway.rootDir && (
        <QuickModelConfig
          rootDir={activeGateway.rootDir}
          onClose={() => setQuickConfig(null)}
          onSaved={() => checkHealth()}
        />
      )}

      {/* Quick Channels Config */}
      {quickConfig === "channels" && activeGateway.rootDir && (
        <QuickChannelsConfig
          rootDir={activeGateway.rootDir}
          onClose={() => setQuickConfig(null)}
          onSaved={() => checkHealth()}
        />
      )}

      {/* Delete Gateway Confirmation */}
      {deleteConfirm && (
        <DeleteGatewayModal
          name={deleteConfirm.name}
          hasFiles={deleteConfirm.type !== "remote" && !!deleteConfirm.rootDir}
          onConfirm={(deleteFiles) => handleDeleteGateway(deleteConfirm.gatewayId, deleteFiles)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {/* ── Settings Modal ── */}
      {settingsModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-bg-surface p-6 shadow-2xl ring-1 ring-border-default">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-text-primary">Global Settings</h2>
              <button onClick={() => setSettingsModal(false)} className="text-text-ghost hover:text-text-secondary">
                <IconX size={16} />
              </button>
            </div>

            <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
              Shared Directory
            </label>
            <p className="mb-2 text-[11px] text-text-ghost">
              A host directory mounted into all Docker gateways at <code className="rounded bg-bg-elevated px-1 py-0.5 font-mono text-[10px]">/home/node/.openclaw/shared</code>. Leave empty to disable.
            </p>
            <input
              type="text"
              value={settingsDraft}
              onChange={(e) => setSettingsDraft(e.target.value)}
              placeholder="~/clawpond/shared"
              className="mb-4 w-full rounded-lg border border-border-default bg-bg-deep px-3 py-2 text-[12px] text-text-primary placeholder:text-text-ghost focus:border-accent-blue focus:outline-none"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSettingsModal(false)}
                className="rounded-lg border border-border-default px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setSharedDir(settingsDraft);
                  localStorage.setItem(SHARED_DIR_STORAGE_KEY, settingsDraft);
                  setSettingsModal(false);
                }}
                className="rounded-lg bg-accent-blue px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-blue/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </RpcPoolProvider>
  );
}

/* ── Add Gateway Modal (unified: type selection -> form) ── */

function AddGatewayModal({
  onConfirm,
  onCancel,
  existingNames,
}: {
  onConfirm: (name: string, emoji: string, type: GatewayType, rootDir?: string, remote?: { host: string; port: string; token: string }) => void;
  onCancel: () => void;
  existingNames: string[];
}) {
  const [step, setStep] = useState<"type" | "form">("type");
  const [gwType, setGwType] = useState<GatewayType>("docker");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("\u{1F916}");
  const [rootDir, setRootDir] = useState("");
  const [emojiSearch, setEmojiSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Binary check state (for local type)
  const [binaryStatus, setBinaryStatus] = useState<"idle" | "checking" | "found" | "not_found">("idle");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // Existing pond validation state
  const [existingValidation, setExistingValidation] = useState<{
    envExists: boolean | null;
    configExists: boolean | null;
    composeExists: boolean | null;
    port?: string;
    checking: boolean;
  }>({ envExists: null, configExists: null, composeExists: null, checking: false });

  // Remote connection state
  const [remoteHost, setRemoteHost] = useState("");
  const [remotePort, setRemotePort] = useState("18789");
  const [remoteToken, setRemoteToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<"success" | "error" | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const trimmed = name.trim();
  const nameError = trimmed
    ? existingNames.includes(trimmed.toLowerCase())
      ? "Name already exists"
      : /[^a-zA-Z0-9_-]/.test(trimmed)
        ? "Only letters, numbers, - and _ allowed"
        : null
    : null;

  const dirTrimmed = rootDir.trim();

  const canConfirm = (() => {
    if (!trimmed || nameError) return false;
    switch (gwType) {
      case "docker": return true;
      case "local": return !!dirTrimmed && binaryStatus === "found";
      case "existing": return !!dirTrimmed && existingValidation.envExists === true && existingValidation.configExists === true;
      case "remote": return !!remoteHost.trim() && !!remotePort.trim() && !!remoteToken.trim();
    }
  })();

  const filtered = emojiSearch
    ? EMOJI_OPTIONS.filter((e) =>
        e.kw.toLowerCase().includes(emojiSearch.toLowerCase()) ||
        e.emoji.includes(emojiSearch)
      )
    : showAll
      ? EMOJI_OPTIONS
      : EMOJI_OPTIONS.slice(0, FEATURED_COUNT);

  function selectType(type: GatewayType) {
    setGwType(type);
    setStep("form");
    if (type === "local") {
      checkBinary();
    }
  }

  async function checkBinary() {
    setBinaryStatus("checking");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const exists = await invoke<boolean>("check_binary_exists", { name: "openclaw" });
      setBinaryStatus(exists ? "found" : "not_found");
    } catch {
      setBinaryStatus("not_found");
    }
  }

  async function installBinary() {
    setInstalling(true);
    setInstallError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("run_shell_command", { command: "npm install -g @anthropic/openclaw" });
      await checkBinary();
    } catch (e) {
      setInstallError(typeof e === "string" ? e : (e as Error)?.message || "Installation failed");
    } finally {
      setInstalling(false);
    }
  }

  async function pickDirectory() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | null>("pick_directory");
      if (selected) {
        setRootDir(selected);
        if (gwType === "existing") {
          validateExistingDirectory(selected);
        }
      }
    } catch {
      // command not available or cancelled
    }
  }

  async function validateExistingDirectory(dir: string) {
    setExistingValidation({ envExists: null, configExists: null, composeExists: null, checking: true });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      let envOk = false;
      let port: string | undefined;
      try {
        const info = await invoke<{ port: string; token: string }>("read_gateway_info", { rootDir: dir });
        envOk = true;
        port = info.port;
      } catch { /* missing */ }

      let configOk = false;
      try {
        await invoke("read_existing_config", { rootDir: dir });
        configOk = true;
      } catch { /* missing */ }

      // Check docker-compose.yml (optional)
      let composeOk = false;
      try {
        const output = await invoke<string>("run_shell_command", { command: `test -f "${dir}/docker-compose.yml" && echo "yes" || echo "no"` });
        composeOk = output.trim() === "yes";
      } catch {
        // couldn't check, leave as false
      }

      setExistingValidation({ envExists: envOk, configExists: configOk, composeExists: composeOk, port, checking: false });
    } catch {
      setExistingValidation({ envExists: false, configExists: false, composeExists: false, checking: false });
    }
  }

  async function testRemoteConnection() {
    setTestingConnection(true);
    setConnectionResult(null);
    setConnectionError(null);
    try {
      const { OpenClawRpc } = await import("../lib/openclaw-rpc");
      const testRpc = new OpenClawRpc();
      await testRpc.connect(remotePort.trim(), remoteToken.trim(), remoteHost.trim());
      testRpc.disconnect();
      setConnectionResult("success");
    } catch (e) {
      setConnectionResult("error");
      setConnectionError(typeof e === "string" ? e : (e as Error)?.message || "Connection failed");
    } finally {
      setTestingConnection(false);
    }
  }

  function handleConfirm() {
    if (!canConfirm) return;
    switch (gwType) {
      case "docker":
        onConfirm(trimmed, emoji, "docker");
        break;
      case "local":
        onConfirm(trimmed, emoji, "local", dirTrimmed);
        break;
      case "existing":
        onConfirm(trimmed, emoji, "existing", dirTrimmed);
        break;
      case "remote":
        onConfirm(trimmed, emoji, "remote", undefined, {
          host: remoteHost.trim(),
          port: remotePort.trim(),
          token: remoteToken.trim(),
        });
        break;
    }
  }

  // Step 1: Type selection
  if (step === "type") {
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
          <h3 className="mb-4 text-[14px] font-bold text-text-primary">Add Gateway</h3>
          <p className="mb-4 text-[12px] text-text-tertiary">Choose how to run the gateway:</p>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => selectType("docker")}
              className="flex items-center gap-3 rounded-lg bg-bg-elevated p-3.5 text-left ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-accent-emerald/30"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-emerald/10 ring-1 ring-accent-emerald/20">
                <IconDownload size={16} className="text-accent-emerald" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-text-primary">Docker</div>
                <div className="text-[11px] text-text-tertiary">New via Docker container (recommended)</div>
              </div>
              <IconArrowRight size={14} className="shrink-0 text-text-ghost" />
            </button>

            <button
              onClick={() => selectType("local")}
              className="flex items-center gap-3 rounded-lg bg-bg-elevated p-3.5 text-left ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-accent-emerald/30"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-emerald/10 ring-1 ring-accent-emerald/20">
                <IconSettings size={16} className="text-accent-emerald" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-text-primary">Local</div>
                <div className="text-[11px] text-text-tertiary">New via local OpenClaw binary</div>
              </div>
              <IconArrowRight size={14} className="shrink-0 text-text-ghost" />
            </button>

            <button
              onClick={() => selectType("existing")}
              className="flex items-center gap-3 rounded-lg bg-bg-elevated p-3.5 text-left ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-accent-emerald/30"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-emerald/10 ring-1 ring-accent-emerald/20">
                <IconFolder size={16} className="text-accent-emerald" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-text-primary">Existing Pond</div>
                <div className="text-[11px] text-text-tertiary">Import an existing gateway directory</div>
              </div>
              <IconArrowRight size={14} className="shrink-0 text-text-ghost" />
            </button>

            <button
              onClick={() => selectType("remote")}
              className="flex items-center gap-3 rounded-lg bg-bg-elevated p-3.5 text-left ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-accent-emerald/30"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-emerald/10 ring-1 ring-accent-emerald/20">
                <IconGlobe size={16} className="text-accent-emerald" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-text-primary">Remote</div>
                <div className="text-[11px] text-text-tertiary">Connect to a remote gateway (read-only)</div>
              </div>
              <IconArrowRight size={14} className="shrink-0 text-text-ghost" />
            </button>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const formTitle = {
    docker: "Add Docker Gateway",
    local: "Add Local Gateway",
    existing: "Import Existing Pond",
    remote: "Add Remote Gateway",
  }[gwType];

  // Step 2: Form
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setStep("type")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            <IconArrowRight size={14} className="rotate-180" />
          </button>
          <h3 className="text-[14px] font-bold text-text-primary">
            {formTitle}
          </h3>
        </div>

        {/* Binary check (local only) */}
        {gwType === "local" && (
          <>
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-bg-elevated px-3 py-2 ring-1 ring-border-default">
            {binaryStatus === "checking" && (
              <>
                <IconSpinner size={14} className="animate-spin text-text-ghost" />
                <span className="text-[11px] text-text-tertiary">Checking openclaw binary...</span>
              </>
            )}
            {binaryStatus === "found" && (
              <>
                <IconCheck size={14} className="text-accent-emerald" />
                <span className="text-[11px] text-accent-emerald">openclaw binary found</span>
              </>
            )}
            {binaryStatus === "not_found" && (
              <>
                <IconXCircle size={14} className="text-accent-red" />
                <span className="flex-1 text-[11px] text-accent-red">openclaw binary not found in PATH</span>
                <button
                  onClick={checkBinary}
                  className="text-[11px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
                >
                  Retry
                </button>
              </>
            )}
          </div>
          {binaryStatus === "not_found" && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              <button
                onClick={installBinary}
                disabled={installing}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-emerald/15 px-3 py-2 text-[12px] font-medium text-accent-emerald ring-1 ring-accent-emerald/25 transition-colors hover:bg-accent-emerald/25 disabled:opacity-50"
              >
                {installing ? (
                  <>
                    <IconSpinner size={12} className="animate-spin" />
                    Installing openclaw...
                  </>
                ) : (
                  <>Install openclaw</>
                )}
              </button>
              {installError && (
                <p className="text-[10px] text-accent-red">{installError}</p>
              )}
            </div>
          )}
          </>
        )}

        {/* Name */}
        <label className="mb-1 block text-[11px] font-medium text-text-secondary">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-gateway"
          autoFocus
          className="mb-1 w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) handleConfirm();
            if (e.key === "Escape") onCancel();
          }}
        />
        {nameError && <p className="mb-2 text-[10px] text-accent-red">{nameError}</p>}
        {gwType === "docker" && trimmed && !nameError && (
          <p className="mb-2 text-[10px] text-text-ghost">
            ~/clawpond/clawking/pond/{trimmed}
          </p>
        )}

        {/* Directory (local and existing) */}
        {(gwType === "local" || gwType === "existing") && (
          <>
            <label className="mb-1 mt-2 block text-[11px] font-medium text-text-secondary">Gateway Directory</label>
            <div className="mb-1 flex items-center gap-2">
              <input
                type="text"
                value={rootDir}
                onChange={(e) => {
                  setRootDir(e.target.value);
                  if (gwType === "existing") {
                    setExistingValidation({ envExists: null, configExists: null, composeExists: null, checking: false });
                  }
                }}
                placeholder="/path/to/gateway"
                className="flex-1 rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canConfirm) handleConfirm();
                  if (e.key === "Escape") onCancel();
                }}
              />
              <button
                type="button"
                onClick={pickDirectory}
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-bg-elevated ring-1 ring-border-default transition-colors hover:bg-bg-hover"
                title="Browse..."
              >
                <IconFolder size={14} className="text-text-tertiary" />
              </button>
            </div>
            {gwType === "local" && (
              <p className="mb-2 text-[10px] text-text-ghost">
                Point to an existing OpenClaw gateway directory
              </p>
            )}
          </>
        )}

        {/* Existing pond validation */}
        {gwType === "existing" && dirTrimmed && (
          <div className="mb-3 flex flex-col gap-1 rounded-lg bg-bg-elevated px-3 py-2 ring-1 ring-border-default">
            {existingValidation.checking ? (
              <div className="flex items-center gap-2">
                <IconSpinner size={12} className="animate-spin text-text-ghost" />
                <span className="text-[11px] text-text-tertiary">Validating directory...</span>
              </div>
            ) : existingValidation.envExists === null ? (
              <button
                onClick={() => validateExistingDirectory(dirTrimmed)}
                className="text-[11px] font-medium text-accent-emerald hover:underline"
              >
                Validate directory
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {existingValidation.envExists ? (
                    <IconCheck size={12} className="text-accent-emerald" />
                  ) : (
                    <IconXCircle size={12} className="text-accent-red" />
                  )}
                  <span className={`text-[11px] ${existingValidation.envExists ? "text-accent-emerald" : "text-accent-red"}`}>
                    .env {existingValidation.envExists ? "found" : "missing"}{existingValidation.port ? ` (port ${existingValidation.port})` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {existingValidation.configExists ? (
                    <IconCheck size={12} className="text-accent-emerald" />
                  ) : (
                    <IconXCircle size={12} className="text-accent-red" />
                  )}
                  <span className={`text-[11px] ${existingValidation.configExists ? "text-accent-emerald" : "text-accent-red"}`}>
                    config/openclaw.json {existingValidation.configExists ? "found" : "missing"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {existingValidation.composeExists ? (
                    <IconCheck size={12} className="text-accent-emerald" />
                  ) : (
                    <IconX size={12} className="text-text-ghost" />
                  )}
                  <span className={`text-[11px] ${existingValidation.composeExists ? "text-accent-emerald" : "text-text-ghost"}`}>
                    docker-compose.yml {existingValidation.composeExists ? "found" : "not found (optional)"}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Remote connection fields */}
        {gwType === "remote" && (
          <>
            <label className="mb-1 mt-2 block text-[11px] font-medium text-text-secondary">Host</label>
            <input
              type="text"
              value={remoteHost}
              onChange={(e) => { setRemoteHost(e.target.value); setConnectionResult(null); }}
              placeholder="192.168.1.100"
              className="mb-2 w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
            />

            <label className="mb-1 block text-[11px] font-medium text-text-secondary">Port</label>
            <input
              type="text"
              value={remotePort}
              onChange={(e) => { setRemotePort(e.target.value); setConnectionResult(null); }}
              placeholder="18789"
              className="mb-2 w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
            />

            <label className="mb-1 block text-[11px] font-medium text-text-secondary">Token</label>
            <div className="mb-2 flex items-center gap-2">
              <input
                type={showToken ? "text" : "password"}
                value={remoteToken}
                onChange={(e) => { setRemoteToken(e.target.value); setConnectionResult(null); }}
                placeholder="Gateway access token"
                className="flex-1 rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canConfirm) handleConfirm();
                  if (e.key === "Escape") onCancel();
                }}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-bg-elevated ring-1 ring-border-default transition-colors hover:bg-bg-hover"
                title={showToken ? "Hide token" : "Show token"}
              >
                <IconShield size={14} className="text-text-tertiary" />
              </button>
            </div>

            {/* Test Connection */}
            <button
              type="button"
              onClick={testRemoteConnection}
              disabled={testingConnection || !remoteHost.trim() || !remotePort.trim() || !remoteToken.trim()}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-bg-elevated px-3 py-2 text-[12px] font-medium text-text-secondary ring-1 ring-border-default transition-colors hover:bg-bg-hover disabled:opacity-40"
            >
              {testingConnection ? (
                <>
                  <IconSpinner size={12} className="animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <IconGlobe size={12} />
                  Test Connection
                </>
              )}
            </button>
            {connectionResult === "success" && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-accent-emerald/10 px-3 py-1.5 ring-1 ring-accent-emerald/20">
                <IconCheck size={12} className="text-accent-emerald" />
                <span className="text-[11px] text-accent-emerald">Connection successful</span>
              </div>
            )}
            {connectionResult === "error" && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-accent-red/10 px-3 py-1.5 ring-1 ring-accent-red/20">
                <IconXCircle size={12} className="text-accent-red" />
                <span className="text-[11px] text-accent-red">{connectionError || "Connection failed"}</span>
              </div>
            )}
          </>
        )}

        {/* Icon picker */}
        <label className="mb-1 block text-[11px] font-medium text-text-secondary">Icon</label>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-elevated text-[20px] ring-1 ring-border-default">
            {emoji}
          </span>
          <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-bg-elevated px-2.5 py-1.5 ring-1 ring-border-default focus-within:ring-accent-emerald/50">
            <IconSearch size={12} className="shrink-0 text-text-ghost" />
            <input
              type="text"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              placeholder="Search icons..."
              className="w-full bg-transparent text-[11px] text-text-primary placeholder:text-text-ghost focus:outline-none"
            />
          </div>
        </div>
        <div className="mb-2 grid grid-cols-10 gap-1">
          {filtered.map((e) => (
            <button
              key={e.emoji}
              type="button"
              onClick={() => setEmoji(e.emoji)}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-[14px] transition-all hover:bg-bg-hover ${
                emoji === e.emoji ? "bg-accent-emerald/15 ring-1 ring-accent-emerald/30" : ""
              }`}
            >
              {e.emoji}
            </button>
          ))}
        </div>
        {!emojiSearch && !showAll && EMOJI_OPTIONS.length > FEATURED_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mb-3 w-full text-center text-[11px] font-medium text-accent-emerald hover:underline"
          >
            Show more ({EMOJI_OPTIONS.length - FEATURED_COUNT} more)
          </button>
        )}
        {emojiSearch && filtered.length === 0 && (
          <p className="mb-3 text-center text-[11px] text-text-ghost">No matching icons</p>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-emerald/15 px-4 py-2 text-[12px] font-semibold text-accent-emerald ring-1 ring-accent-emerald/25 transition-all hover:bg-accent-emerald/25 disabled:opacity-40"
          >
            <IconPlus size={13} />
            {gwType === "existing" ? "Import" : gwType === "remote" ? "Connect" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Delete Gateway Confirmation Modal ── */

function DeleteGatewayModal({
  name,
  hasFiles,
  onConfirm,
  onCancel,
}: {
  name: string;
  hasFiles: boolean;
  onConfirm: (deleteFiles: boolean) => void;
  onCancel: () => void;
}) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    await onConfirm(deleteFiles);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-xs rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <h3 className="mb-2 text-[14px] font-bold text-text-primary">Delete Gateway</h3>
        <p className="mb-4 text-[12px] text-text-secondary">
          Are you sure you want to delete <span className="font-semibold text-text-primary">{name}</span>?
        </p>

        {hasFiles && (
          <label className="mb-4 flex cursor-pointer items-center gap-2.5 rounded-lg bg-bg-elevated px-3 py-2.5 ring-1 ring-border-default transition-colors hover:bg-bg-hover">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-accent-red"
            />
            <div>
              <div className="text-[12px] font-medium text-accent-red">Also delete all config files</div>
              <div className="text-[10px] text-text-ghost">.env, docker-compose.yml, config/, workspace/</div>
            </div>
          </label>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-red/15 px-4 py-2 text-[12px] font-semibold text-accent-red ring-1 ring-accent-red/25 transition-all hover:bg-accent-red/25 disabled:opacity-40"
          >
            {deleting ? (
              <>
                <IconSpinner size={13} className="animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <IconXCircle size={13} />
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}