"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar, type GatewayItem } from "../components/sidebar";
import { ChatArea } from "../components/chat-area";
import { TaskPanel } from "../components/task-panel";
import { TopBar } from "../components/top-bar";
import { IconPlay, IconStop, IconSettings, IconX, IconGlobe, IconPlus, IconSearch, IconCpu, IconHash, IconFolder, IconDownload, IconCheck, IconSpinner, IconXCircle, IconArrowRight, IconShield, IconSun, IconMoon } from "../components/icons";
import { QuickModelConfig, QuickChannelsConfig } from "../components/quick-config";
import { RpcPoolProvider } from "../lib/rpc-pool-context";
import { EMOJI_OPTIONS, FEATURED_COUNT } from "../lib/emoji-data";
import type { GatewayInfo } from "../lib/rpc-pool";
import { openUrlInWindow } from "../lib/open-url";

export type ServiceState = "unconfigured" | "loading" | "starting" | "stopping" | "running" | "error" | "stopped";

export type ComposeStartProgress = {
  stage: string;
  message: string;
  image: string | null;
  percent: number | null;
  layers_done: number;
  layers_total: number;
};

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
  busy?: boolean;
  lastError?: string;
  startProgress?: ComposeStartProgress;
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
const BROWSER_CDP_PORT = "18790";
const THEME_STORAGE_KEY = "clawpond-theme";
const SECURITY_OFFICER_STORAGE_KEY = "clawpond-security-officer";
const AGENT_ICONS_STORAGE_KEY = "clawpond-agent-icons";

function loadAgentIcons(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AGENT_ICONS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveAgentIcons(icons: Record<string, string>) {
  localStorage.setItem(AGENT_ICONS_STORAGE_KEY, JSON.stringify(icons));
}

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

// Emoji data imported from ../lib/emoji-data

export default function Home() {
  const [gateways, setGateways] = useState<Gateway[]>(loadGateways);
  const [activeGatewayId, setActiveGatewayId] = useState("default");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  const [addGatewayModal, setAddGatewayModal] = useState(false);
  const [reconfiguring, setReconfiguring] = useState(false);
  const [quickConfig, setQuickConfig] = useState<"model" | "channels" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ gatewayId: string; name: string; rootDir: string | null } | null>(null);
  const [settingsModal, setSettingsModal] = useState(false);
  const [sharedDir, setSharedDir] = useState(() => {
    try { return localStorage.getItem(SHARED_DIR_STORAGE_KEY) || ""; } catch { return ""; }
  });
  const [settingsDraft, setSettingsDraft] = useState("");
  const [browserRunning, setBrowserRunning] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return (localStorage.getItem(THEME_STORAGE_KEY) as "dark" | "light") || "dark"; } catch { return "dark"; }
  });
  const [securityOfficerId, setSecurityOfficerId] = useState<string | null>(() => {
    try { return localStorage.getItem(SECURITY_OFFICER_STORAGE_KEY) || null; } catch { return null; }
  });

  // Agent state: per-gateway agent lists (agents in list + allowed subagents) and cached emoji icons
  const [gatewayAgents, setGatewayAgents] = useState<Record<string, { agents: string[]; allowed: string[] }>>({});
  const [agentIcons, setAgentIcons] = useState<Record<string, string>>(loadAgentIcons);

  const handleAgentIconChange = useCallback((gatewayId: string, agentName: string, emoji: string) => {
    setAgentIcons((prev) => {
      const next = { ...prev, [`${gatewayId}:${agentName}`]: emoji };
      saveAgentIcons(next);
      return next;
    });
  }, []);

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  function toggleSecurityOfficer(gatewayId: string) {
    if (securityOfficerId === gatewayId) {
      setSecurityOfficerId(null);
      localStorage.removeItem(SECURITY_OFFICER_STORAGE_KEY);
    } else {
      setSecurityOfficerId(gatewayId);
      localStorage.setItem(SECURITY_OFFICER_STORAGE_KEY, gatewayId);
    }
  }

  // Persist gateways whenever the list changes
  useEffect(() => {
    saveGateways(gateways);
  }, [gateways]);

  // Context menu state — includes which gateway was right-clicked
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; gatewayId: string } | null>(null);
  const [ctxEndpoint, setCtxEndpoint] = useState<string | null>(null);
  const [ctxCdpEndpoint, setCtxCdpEndpoint] = useState<string | null>(null);
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
      setCtxCdpEndpoint(null);
      import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke<{ port: string; bridge_port: string; token: string }>("read_gateway_info", { rootDir: gw.rootDir })
          .then((info) => {
            setCtxEndpoint(`127.0.0.1:${info.port}`);
            setCtxCdpEndpoint(`127.0.0.1:${BROWSER_CDP_PORT}`);
          })
          .catch(() => { setCtxEndpoint(null); setCtxCdpEndpoint(null); })
      );
    } else {
      setCtxEndpoint(null);
      setCtxCdpEndpoint(null);
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
    if (action === "security-officer") {
      toggleSecurityOfficer(targetId);
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
        updateGateway(targetId, { serviceState: "starting", lastError: undefined, startProgress: undefined });
        let unlisten: (() => void) | undefined;
        try {
          // Auto-start global shared browser if not running
          if (!browserRunning) {
            await invoke("browser_start", { cdpPort: BROWSER_CDP_PORT }).catch(() => {});
            setBrowserRunning(true);
          }
          const { listen } = await import("@tauri-apps/api/event");
          unlisten = await listen<ComposeStartProgress>("compose-start-progress", (event) => {
            updateGateway(targetId, { startProgress: event.payload });
          });
          await invoke("compose_start", { rootDir });
          updateGateway(targetId, { serviceState: "running", lastError: undefined, startProgress: undefined });
        } finally {
          unlisten?.();
        }
      } else if (action === "stop") {
        updateGateway(targetId, { serviceState: "stopping", lastError: undefined });
        await invoke("compose_stop", { rootDir });
        updateGateway(targetId, { serviceState: "stopped", cpuPercent: undefined, memUsageMb: undefined, lastError: undefined });
      }
    } catch (err) {
      updateGateway(targetId, { serviceState: "error", lastError: String(err), startProgress: undefined });
    }
    checkHealth();
  }

  // On startup: check health for ALL configured gateways
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");

      // Auto-detect default gateway config
      try {
        const detected = await invoke<string | null>("detect_config");
        if (!cancelled && detected) {
          setGateways((prev) =>
            prev.map((g) =>
              g.id === "default" && !g.configured
                ? { ...g, rootDir: detected, configured: true, serviceState: "loading" }
                : g
            )
          );
        }
      } catch { /* no existing config */ }

      if (cancelled) return;

      // Migrate existing gateway compose files from legacy per-gateway browser to shared-network format.
      // This will `compose down` + rewrite compose for any gateway still using the old `openclaw-browser` service.
      try {
        const currentGateways = gatewaysRef.current;
        for (const gw of currentGateways) {
          if (cancelled) break;
          if (gw.configured && gw.rootDir) {
            await invoke<boolean>("migrate_gateway_compose", { rootDir: gw.rootDir }).catch(() => {});
          }
        }
      } catch { /* ignore */ }

      if (cancelled) return;

      // Check global shared browser status
      try {
        const running = await invoke<boolean>("browser_health");
        if (!cancelled) setBrowserRunning(running);
      } catch { /* ignore */ }

      if (cancelled) return;

      // Now check health for every configured gateway — sequentially to avoid flooding
      setGateways((prev) => {
        (async () => {
          for (const gw of prev) {
            if (cancelled) break;
            if (!gw.configured || !gw.rootDir) continue;
            await checkGatewayHealth(invoke, gw.id, gw.rootDir);
          }
        })();
        return prev;
      });
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard against overlapping health checks
  const healthCheckBusy = useRef(false);

  // Check health for a single gateway
  async function checkGatewayHealth(
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    gwId: string,
    rootDir: string,
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

      // Don't overwrite transitional or error-with-detail states
      const current = gatewaysRef.current.find((g) => g.id === gwId);
      if (current) {
        const cs = current.serviceState;
        if (cs === "starting" || cs === "stopping") return;
        // Don't clear a detailed error with a generic "stopped"
        if (cs === "error" && current.lastError && serviceState === "stopped") return;
      }

      updateGateway(gwId, isRunning
        ? { serviceState }
        : { serviceState, cpuPercent: undefined, memUsageMb: undefined });

      // Fetch stats in background
      if (isRunning) {
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

  // Use refs for polling so the interval callback doesn't depend on reactive state
  const gatewaysRef = useRef(gateways);
  gatewaysRef.current = gateways;
  const activeGatewayRef = useRef(activeGateway);
  activeGatewayRef.current = activeGateway;
  const activeGatewayIdRef = useRef(activeGatewayId);
  activeGatewayIdRef.current = activeGatewayId;

  // Poll service health for active gateway — guarded and non-reactive
  const checkHealth = useCallback(async () => {
    const gw = activeGatewayRef.current;
    const rootDir = gw.rootDir;
    if (!rootDir) return;
    // Skip during transition states — compose start/stop is in progress
    if (gw.serviceState === "starting" || gw.serviceState === "stopping") return;
    if (healthCheckBusy.current) return; // skip if previous check still running
    healthCheckBusy.current = true;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await checkGatewayHealth(invoke, activeGatewayIdRef.current, rootDir);
      // Also check global browser health
      const running = await invoke<boolean>("browser_health");
      setBrowserRunning(running);
    } catch {
      updateGateway(activeGatewayIdRef.current, { serviceState: "error", cpuPercent: undefined, memUsageMb: undefined });
    } finally {
      healthCheckBusy.current = false;
    }
  }, [updateGateway]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeGateway.configured || !activeGateway.rootDir) return;
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, [activeGateway.configured, activeGateway.rootDir, activeGateway.id, checkHealth]);

  // Fetch workspace agents for all configured gateways with a rootDir
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const gw of gatewaysRef.current) {
        if (cancelled) break;
        if (!gw.configured || !gw.rootDir) continue;
        try {
          const info = await invoke<{ agents: string[]; allowed: string[] }>("list_workspace_agents", { rootDir: gw.rootDir });
          if (!cancelled) {
            setGatewayAgents((prev) => ({ ...prev, [gw.id]: info }));
          }
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [gateways.map((g) => `${g.id}:${g.configured}:${g.serviceState}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

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
            updateGateway(activeGatewayId, { serviceState: "starting", lastError: undefined, startProgress: undefined });
            let unlistenProgress: (() => void) | undefined;
            try {
              // Auto-start global shared browser if not running
              const running = await invoke<boolean>("browser_health");
              if (!running) {
                await invoke("browser_start", { cdpPort: BROWSER_CDP_PORT }).catch(() => {});
                setBrowserRunning(true);
              }
              unlistenProgress = await listen<ComposeStartProgress>("compose-start-progress", (ev) => {
                updateGateway(activeGatewayId, { startProgress: ev.payload });
              });
              await invoke("compose_start", { rootDir });
              updateGateway(activeGatewayId, { serviceState: "running", lastError: undefined, startProgress: undefined });
            } finally {
              unlistenProgress?.();
            }
          } else if (event.payload === "stop") {
            updateGateway(activeGatewayId, { serviceState: "stopping", lastError: undefined });
            await invoke("compose_stop", { rootDir });
            updateGateway(activeGatewayId, { serviceState: "stopped", lastError: undefined });
          }
        } catch (err) {
          updateGateway(activeGatewayId, { serviceState: "error", lastError: String(err), startProgress: undefined });
        }
        checkHealth();
      });
    })();
    return () => { unlisten?.(); };
  }, [activeGateway.rootDir, activeGatewayId, updateGateway, checkHealth]);

  function handleAddGateway(name: string, emoji: string) {
    const id = `gw-${Date.now()}`;
    const dir = `~/clawpond/clawking/pond/${name}`;
    setGateways((prev) => [...prev, { id, name, emoji, type: "docker", rootDir: dir, configured: false, serviceState: "unconfigured" }]);
    setActiveGatewayId(id);
    setAddGatewayModal(false);
  }

  async function handleDeleteGateway(gatewayId: string, deleteFiles: boolean) {
    const gw = gateways.find((g) => g.id === gatewayId);
    if (!gw) return;

    // Stop the service first if running
    if (gw.rootDir && gw.serviceState === "running") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("compose_stop", { rootDir: gw.rootDir });
      } catch { /* ignore */ }
    }

    // Delete config files if requested
    if (deleteFiles && gw.rootDir) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("remove_directory", { path: gw.rootDir });
      } catch { /* ignore */ }
    }

    // Remove from list and switch to default
    setGateways((prev) => prev.filter((g) => g.id !== gatewayId));
    if (activeGatewayId === gatewayId) {
      setActiveGatewayId("default");
    }
    if (securityOfficerId === gatewayId) {
      setSecurityOfficerId(null);
      localStorage.removeItem(SECURITY_OFFICER_STORAGE_KEY);
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
    busy: g.busy,
    isSecurityOfficer: g.id === securityOfficerId,
  }));

  // Map gateways to GatewayInfo for the RPC pool context
  const gatewayInfos: GatewayInfo[] = gateways.map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    serviceState: g.serviceState,
    rootDir: g.rootDir,
    busy: g.busy,
  }));

  return (
    <RpcPoolProvider gateways={gatewayInfos}>
    <div className="flex h-screen flex-col overflow-hidden bg-bg-deep font-sans">
      <TopBar
        onSettings={() => { setSettingsDraft(sharedDir); setSettingsModal(true); }}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div className="relative flex min-h-0 flex-1">
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
              lastError={g.lastError}
              startProgress={g.startProgress}
              skipDocker={!isDefault}
              fixedRootDir={!isDefault && g.rootDir ? g.rootDir : undefined}
              sharedDir={sharedDir}
              onBusyChange={(busy: boolean) => updateGateway(g.id, { busy })}
              securityOfficerId={securityOfficerId ?? undefined}
              agents={gatewayAgents[g.id]?.agents || []}
              allowedAgents={gatewayAgents[g.id]?.allowed || []}
              agentIcons={agentIcons}
              onAgentIconChange={(agentName: string, emoji: string) => handleAgentIconChange(g.id, agentName, emoji)}
              onRefreshAgents={async () => {
                if (!g.rootDir) return;
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  const info = await invoke<{ agents: string[]; allowed: string[] }>("list_workspace_agents", { rootDir: g.rootDir });
                  setGatewayAgents((prev) => ({ ...prev, [g.id]: info }));
                } catch { /* ignore */ }
              }}
            />
          );
        })}
        <TaskPanel
          rootDir={activeGateway.rootDir}
          gatewayId={activeGateway.id}
          serviceState={activeGateway.serviceState}
        />
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
          </div>
          {ctxEndpoint && (
            <div className="px-3 pb-1 text-[10px] font-mono text-text-ghost/70">
              API {ctxEndpoint}
            </div>
          )}
          {ctxCdpEndpoint && (
            <div className="px-3 pb-1 text-[10px] font-mono text-text-ghost/70">
              CDP {ctxCdpEndpoint}
            </div>
          )}
          <div className="my-0.5 h-px bg-border-subtle" />
          <button
            onClick={() => ctxAction("start")}
            disabled={!ctxGw.configured || ctxGw.serviceState === "running" || ctxGw.serviceState === "starting" || ctxGw.serviceState === "stopping"}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconPlay size={14} className="shrink-0 text-accent-emerald" />
            Start Gateway
          </button>
          <button
            onClick={() => ctxAction("stop")}
            disabled={!ctxGw.configured || ctxGw.serviceState === "stopped" || ctxGw.serviceState === "unconfigured" || ctxGw.serviceState === "starting" || ctxGw.serviceState === "stopping"}
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
            disabled={!ctxGw.configured}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconCpu size={14} className="shrink-0 text-text-tertiary" />
            Model Config...
          </button>
          <button
            onClick={() => ctxAction("config-channels")}
            disabled={!ctxGw.configured}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconHash size={14} className="shrink-0 text-text-tertiary" />
            Channel Config...
          </button>
          <div className="my-1 h-px bg-border-subtle" />
          <button
            onClick={() => ctxAction("security-officer")}
            disabled={!ctxGw.configured || (securityOfficerId !== null && securityOfficerId !== ctxGw.id)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-40"
          >
            <IconShield size={14} className={`shrink-0 ${securityOfficerId === ctxGw.id ? "text-accent-amber" : "text-text-tertiary"}`} />
            {securityOfficerId === ctxGw.id ? "Remove Security Officer" : "Set as Security Officer"}
          </button>
          <div className="my-1 h-px bg-border-subtle" />
          <button
            onClick={() => ctxAction("reconfigure")}
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
          hasFiles={!!deleteConfirm.rootDir}
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

            <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
              Shared Browser
            </label>
            <p className="mb-2 text-[11px] text-text-ghost">
              All gateways share a Playwright browser container via Docker network <code className="rounded bg-bg-elevated px-1 py-0.5 font-mono text-[10px]">clawpond-shared</code>. CDP available at <code className="rounded bg-bg-elevated px-1 py-0.5 font-mono text-[10px]">127.0.0.1:{BROWSER_CDP_PORT}</code>.
            </p>
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-bg-elevated px-3 py-2.5 ring-1 ring-border-default">
              <span className={`inline-block h-2 w-2 rounded-full ${browserRunning ? "bg-accent-emerald" : "bg-text-ghost"}`} />
              <span className="text-[12px] font-medium text-text-primary">
                {browserRunning ? "Browser Running" : "Browser Stopped"}
              </span>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSettingsModal(false)}
                className="rounded-lg border border-border-default px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
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

/* ── Add Gateway Modal (docker only) ── */

function AddGatewayModal({
  onConfirm,
  onCancel,
  existingNames,
}: {
  onConfirm: (name: string, emoji: string) => void;
  onCancel: () => void;
  existingNames: string[];
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("\u{1F916}");
  const [emojiSearch, setEmojiSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const trimmed = name.trim();
  const nameError = trimmed
    ? existingNames.includes(trimmed.toLowerCase())
      ? "Name already exists"
      : /[^a-zA-Z0-9_-]/.test(trimmed)
        ? "Only letters, numbers, - and _ allowed"
        : null
    : null;

  const canConfirm = !!trimmed && !nameError;

  const filtered = emojiSearch
    ? EMOJI_OPTIONS.filter((e) =>
        e.kw.toLowerCase().includes(emojiSearch.toLowerCase()) ||
        e.emoji.includes(emojiSearch)
      )
    : showAll
      ? EMOJI_OPTIONS
      : EMOJI_OPTIONS.slice(0, FEATURED_COUNT);

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(trimmed, emoji);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <h3 className="mb-4 text-[14px] font-bold text-text-primary">
          Add Docker Gateway
        </h3>

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
        {trimmed && !nameError && (
          <p className="mb-2 text-[10px] text-text-ghost">
            ~/clawpond/clawking/pond/{trimmed}
          </p>
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
            Create
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