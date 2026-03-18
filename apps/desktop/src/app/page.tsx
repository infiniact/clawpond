"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar, type GatewayItem } from "../components/navigation/sidebar";
import { ChatArea } from "../components/chat/chat-area";
import { TaskPanel } from "../components/task-panel";
import { TopBar } from "../components/navigation/top-bar";
import { QuickModelConfig, QuickChannelsConfig } from "../components/config/quick-config";
import { UpdateChecker } from "../components/modals/update-checker";
import { AddGatewayModal } from "../components/modals/add-gateway-modal";
import { DeleteGatewayModal } from "../components/modals/delete-gateway-modal";
import { SettingsModal } from "../components/modals/settings-modal";
import { GatewayContextMenu } from "../components/navigation/gateway-context-menu";
import { DiscoveryBanner, type DiscoveredItem, type ConflictAction, type DiscoveredGateway } from "../components/discovery-banner";
import { RpcPoolProvider } from "../lib/rpc/rpc-pool-context";
import type { GatewayInfo } from "../lib/rpc/rpc-pool";
import { openUrlInWindow } from "../lib/open-url";
import {
  type Gateway,
  type ServiceState,
  type ComposeStartProgress,
  loadGatewaysWithMigration,
  saveGateways,
  loadAgentIcons,
  saveAgentIcons,
} from "../lib/stores/gateway-store";
import {
  THEME_STORAGE_KEY,
  loadSharedDir,
  loadTheme,
  saveTheme,
  loadSecurityOfficer,
  saveSecurityOfficer,
  saveSharedDir,
} from "../lib/stores/settings-store";
import { migrateIfNeeded } from "../lib/stores/migration";

// Re-export types for backwards compatibility with any external references
export type { ServiceState, ComposeStartProgress } from "../lib/stores/gateway-store";

// SSR-safe defaults (localStorage unavailable during static export pre-render)
const SSR_DEFAULT_GATEWAYS: Gateway[] = [
  { id: "default", name: "ClawKing", emoji: "\u{1F99E}", type: "local", rootDir: "~/.openclaw", configured: false, serviceState: "unconfigured" },
];

export default function Home() {
  const [gateways, setGateways] = useState<Gateway[]>(SSR_DEFAULT_GATEWAYS);
  const [activeGatewayId, setActiveGatewayId] = useState("default");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  const [addGatewayModal, setAddGatewayModal] = useState(false);
  const [reconfiguring, setReconfiguring] = useState(false);
  const [quickConfig, setQuickConfig] = useState<"model" | "channels" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ gatewayId: string; name: string; rootDir: string | null } | null>(null);
  const [settingsModal, setSettingsModal] = useState(false);
  const [updateModal, setUpdateModal] = useState(false);
  const [sharedDir, setSharedDir] = useState("");
  const [settingsDraft, setSettingsDraft] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [securityOfficerId, setSecurityOfficerId] = useState<string | null>(null);

  // Agent state: per-gateway agent lists (agents in list + allowed subagents) and cached emoji icons
  const [gatewayAgents, setGatewayAgents] = useState<Record<string, { agents: string[]; allowed: string[] }>>({});
  const [agentIcons, setAgentIcons] = useState<Record<string, string>>({});

  // Discovered-but-not-imported gateways from disk scan
  const [discoveredGateways, setDiscoveredGateways] = useState<DiscoveredItem[]>([]);

  // Hydrate from SQLite after mount (migration runs first)
  useEffect(() => {
    (async () => {
      // Run one-time migration from localStorage → SQLite
      await migrateIfNeeded();

      let { gateways: loaded, migrations } = await loadGatewaysWithMigration();

      // Auto-detect default gateway config (must run after load, before setGateways)
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const detected = await invoke<string | null>("detect_config");
        if (detected) {
          const detectedType = detected === "~/.openclaw" ? "local" as const : "docker" as const;
          loaded = loaded.map((g) =>
            g.id === "default" && !g.configured
              ? { ...g, rootDir: detected, type: detectedType, configured: true, serviceState: "loading" as const }
              : g
          );
        }
      } catch { /* no existing config */ }

      setGateways(loaded);
      setSharedDir(await loadSharedDir());
      setTheme(await loadTheme());
      setSecurityOfficerId(await loadSecurityOfficer());
      setAgentIcons(await loadAgentIcons());

      // Scan disk for gateways — detect new, name clashes, and path mismatches
      try {
        const discovered = await invoke<DiscoveredGateway[]>("scan_gateways");

        // Normalize rootDir for comparison: trim trailing slash, lowercase
        const norm = (p: string | null) => (p ?? "").replace(/\/+$/, "").toLowerCase();

        const byRootDir = new Map(loaded.map((g) => [norm(g.rootDir), g]));
        const byName = new Map(loaded.map((g) => [g.name.toLowerCase(), g]));

        const items: DiscoveredItem[] = [];
        for (const d of discovered) {
          const dNorm = norm(d.rootDir);
          const existingByPath = byRootDir.get(dNorm);
          const existingByName = byName.get(d.name.toLowerCase());

          if (existingByPath) {
            // rootDir already imported
            if (existingByPath.name.toLowerCase() === d.name.toLowerCase()) {
              // Fully matched — skip (duplicate)
              continue;
            }
            // Same path but name differs on disk vs DB
            items.push({
              ...d,
              conflict: "path_exists",
              conflictWith: existingByPath.name,
              conflictId: existingByPath.id,
            });
          } else if (existingByName) {
            // Same name found — check if rootDir also matches (just stored differently)
            if (norm(existingByName.rootDir) === dNorm) {
              // Same gateway, rootDir format differs — skip
              continue;
            }
            // Different rootDir but same name
            items.push({
              ...d,
              conflict: "name_clash",
              conflictWith: existingByName.name,
              conflictId: existingByName.id,
            });
          } else {
            // Completely new
            items.push({ ...d, conflict: "new" });
          }
        }

        if (items.length > 0) {
          setDiscoveredGateways(items);
        }
      } catch { /* scan failed — non-critical */ }

      // Migrate legacy pond directories on disk (fire-and-forget)
      if (migrations.length > 0) {
        for (const { oldDir, newDir } of migrations) {
          invoke("migrate_pond_dir", { oldRootDir: oldDir, newRootDir: newDir })
            .then(() => console.log(`[migration] moved ${oldDir} → ${newDir}`))
            .catch((e: unknown) => console.warn(`[migration] failed ${oldDir} → ${newDir}:`, e));
        }
      }
    })();
  }, []);

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
    saveTheme(next);
  }

  function toggleSecurityOfficer(gatewayId: string) {
    if (securityOfficerId === gatewayId) {
      setSecurityOfficerId(null);
      saveSecurityOfficer(null);
    } else {
      setSecurityOfficerId(gatewayId);
      saveSecurityOfficer(gatewayId);
    }
  }

  // Persist gateways whenever the list changes
  const gatewaysInitialized = useRef(false);
  useEffect(() => {
    // Skip the initial SSR default — only persist after hydration
    if (!gatewaysInitialized.current) {
      if (gateways !== SSR_DEFAULT_GATEWAYS) {
        gatewaysInitialized.current = true;
      }
      return;
    }
    saveGateways(gateways);
  }, [gateways]);

  // Context menu state — includes which gateway was right-clicked
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; gatewayId: string } | null>(null);
  const [ctxEndpoint, setCtxEndpoint] = useState<string | null>(null);
  const [ctxCdpEndpoint, setCtxCdpEndpoint] = useState<string | null>(null);

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
        invoke<{ port: string; token: string }>("read_gateway_info", { rootDir: gw.rootDir })
          .then((info) => {
            setCtxEndpoint(`127.0.0.1:${info.port}`);
            const relayPort = parseInt(info.port, 10) + 3;
            setCtxCdpEndpoint(`127.0.0.1:${relayPort}`);
          })
          .catch(() => { setCtxEndpoint(null); setCtxCdpEndpoint(null); })
      );
    } else {
      setCtxEndpoint(null);
      setCtxCdpEndpoint(null);
    }
  }, [gateways]);

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
    if (!rootDir && targetGw.type !== "local") return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (action === "start") {
        updateGateway(targetId, { serviceState: "starting", lastError: undefined, startProgress: undefined });
        let unlisten: (() => void) | undefined;
        try {
          if (targetGw.type === "local") {
            await invoke("openclaw_start");
          } else {
            const { listen } = await import("@tauri-apps/api/event");
            unlisten = await listen<ComposeStartProgress>("compose-start-progress", (event) => {
              updateGateway(targetId, { startProgress: event.payload });
            });
            await invoke("compose_start", { rootDir });
          }
          updateGateway(targetId, { serviceState: "running", lastError: undefined, startProgress: undefined });
        } finally {
          unlisten?.();
        }
      } else if (action === "stop") {
        updateGateway(targetId, { serviceState: "stopping", lastError: undefined });
        if (targetGw.type === "local") {
          await invoke("openclaw_stop");
        } else {
          await invoke("compose_stop", { rootDir });
        }
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

      if (cancelled) return;

      // Check health for every configured gateway — sequentially to avoid flooding
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
      const gw = gatewaysRef.current.find((g) => g.id === gwId);
      const gwType = gw?.type || "docker";

      let isRunning: boolean;
      let serviceState: ServiceState;

      if (gwType === "local") {
        // Local process health check
        const localStatus = await invoke<{
          running: boolean;
          healthy: boolean | null;
          pid: number | null;
          error: string | null;
        }>("openclaw_health");
        isRunning = localStatus.running;
        serviceState = isRunning
          ? localStatus.healthy === false ? "error" : "running"
          : "stopped";
      } else {
        // Docker compose health check
        const status = await invoke<{
          running: boolean;
          healthy: boolean | null;
          error: string | null;
        }>("compose_health", { rootDir });
        isRunning = status.running;
        serviceState = isRunning
          ? status.healthy === false ? "error" : "running"
          : "stopped";
      }

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

      // Fetch stats in background (Docker only)
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
    const gwType = activeGateway.type || "docker";
    if (!rootDir && gwType !== "local") return;
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
              if (gwType === "local") {
                await invoke("openclaw_start");
              } else {
                unlistenProgress = await listen<ComposeStartProgress>("compose-start-progress", (ev) => {
                  updateGateway(activeGatewayId, { startProgress: ev.payload });
                });
                await invoke("compose_start", { rootDir });
              }
              updateGateway(activeGatewayId, { serviceState: "running", lastError: undefined, startProgress: undefined });
            } finally {
              unlistenProgress?.();
            }
          } else if (event.payload === "stop") {
            updateGateway(activeGatewayId, { serviceState: "stopping", lastError: undefined });
            if (gwType === "local") {
              await invoke("openclaw_stop");
            } else {
              await invoke("compose_stop", { rootDir });
            }
            updateGateway(activeGatewayId, { serviceState: "stopped", lastError: undefined });
          }
        } catch (err) {
          updateGateway(activeGatewayId, { serviceState: "error", lastError: String(err), startProgress: undefined });
        }
        checkHealth();
      });
    })();
    return () => { unlisten?.(); };
  }, [activeGateway.rootDir, activeGateway.type, activeGatewayId, updateGateway, checkHealth]);

  function handleAddGateway(name: string, emoji: string) {
    const id = `gw-${Date.now()}`;
    const dir = `~/.openclaw/workspace/pond/${name}`;
    setGateways((prev) => [...prev, { id, name, emoji, type: "docker", rootDir: dir, configured: false, serviceState: "unconfigured" }]);
    setActiveGatewayId(id);
    setAddGatewayModal(false);
  }

  async function handleImportGateway(d: DiscoveredItem, action: ConflictAction) {
    const { invoke } = await import("@tauri-apps/api/core");
    if (action === "skip") {
      setDiscoveredGateways((prev) => prev.filter((x) => x.rootDir !== d.rootDir));
      return;
    }

    // "merge": migrate old messages + workspace files (append .md) to new rootDir, then overwrite
    if (action === "merge" && d.conflictId) {
      const oldGw = gateways.find((g) => g.id === d.conflictId);
      if (oldGw?.rootDir && d.rootDir) {
        try {
          await Promise.all([
            invoke("db_merge_messages", { fromRootDir: oldGw.rootDir, toRootDir: d.rootDir }),
            invoke("merge_workspace_files", {
              fromRootDir: oldGw.rootDir,
              toRootDir: d.rootDir,
              appendMd: true,
            }),
          ]);
        } catch (e) {
          console.warn("[merge] failed to merge:", e);
        }
      }
      // Fall through to overwrite logic below
    }

    // For new non-local gateways, copy source dir into pond
    let rootDir = d.rootDir;
    if (d.type !== "local" && !d.conflictId) {
      try {
        rootDir = await invoke<string>("copy_to_pond", { rootDir: d.rootDir, name: d.name });
      } catch (e) {
        console.warn("[import] copy_to_pond failed:", e);
      }
    }

    setGateways((prev) => {
      let next: Gateway[];

      if (action === "update_name" && d.conflictId) {
        // path_exists: update existing gateway's name to match disk
        next = prev.map((g) =>
          g.id === d.conflictId ? { ...g, name: d.name } : g
        );
      } else if (d.type === "local") {
        // Local gateway always maps to the "default" slot
        next = prev.map((g) =>
          g.id === "default"
            ? { ...g, rootDir, configured: true, serviceState: "loading" as const }
            : g
        );
      } else if ((action === "overwrite" || action === "merge") && d.conflictId) {
        // name_clash: replace existing gateway's rootDir
        next = prev.map((g) =>
          g.id === d.conflictId
            ? { ...g, rootDir, configured: true, serviceState: "loading" as const }
            : g
        );
      } else if (action === "delete_old" && d.conflictId) {
        // name_clash: remove the old gateway, then add the discovered one as new
        next = [
          ...prev.filter((g) => g.id !== d.conflictId),
          {
            id: `gw-${Date.now()}`,
            name: d.name,
            emoji: "\u{1F916}",
            type: "docker" as const,
            rootDir,
            configured: true,
            serviceState: "loading" as const,
          },
        ];
      } else {
        // New import or "rename" — deduplicate the name
        let name = d.name;
        if (action === "rename" || prev.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
          const base = name;
          let n = 2;
          while (prev.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
            name = `${base}-${n}`;
            n++;
          }
        }
        next = [
          ...prev,
          {
            id: `gw-${Date.now()}`,
            name,
            emoji: "\u{1F916}",
            type: "docker" as const,
            rootDir,
            configured: true,
            serviceState: "loading" as const,
          },
        ];
      }

      saveGateways(next);
      return next;
    });
    setDiscoveredGateways((prev) => prev.filter((x) => x.rootDir !== d.rootDir));
  }

  async function handleImportAllGateways() {
    const { invoke } = await import("@tauri-apps/api/core");
    // Only auto-import items without conflicts
    const safe = discoveredGateways.filter((d) => d.conflict === "new");
    if (safe.length === 0) return;

    // Copy non-local dirs into pond first
    const resolved = await Promise.all(
      safe.map(async (d) => {
        if (d.type === "local") return { ...d, resolvedDir: d.rootDir };
        try {
          const newDir = await invoke<string>("copy_to_pond", { rootDir: d.rootDir, name: d.name });
          return { ...d, resolvedDir: newDir };
        } catch {
          return { ...d, resolvedDir: d.rootDir };
        }
      })
    );

    setGateways((prev) => {
      let next = [...prev];
      const usedNames = new Set(next.map((g) => g.name.toLowerCase()));
      for (const d of resolved) {
        if (d.type === "local") {
          next = next.map((g) =>
            g.id === "default"
              ? { ...g, rootDir: d.resolvedDir, configured: true, serviceState: "loading" as const }
              : g
          );
        } else {
          let name = d.name;
          if (usedNames.has(name.toLowerCase())) {
            const base = name;
            let n = 2;
            while (usedNames.has(name.toLowerCase())) {
              name = `${base}-${n}`;
              n++;
            }
          }
          usedNames.add(name.toLowerCase());
          next = [
            ...next,
            {
              id: `gw-${Date.now()}-${d.name}`,
              name,
              emoji: "\u{1F916}",
              type: "docker" as const,
              rootDir: d.resolvedDir,
              configured: true,
              serviceState: "loading" as const,
            },
          ];
        }
      }
      saveGateways(next);
      return next;
    });
    setDiscoveredGateways((prev) => prev.filter((d) => d.conflict !== "new"));
  }

  async function handleDeleteGateway(gatewayId: string, deleteFiles: boolean) {
    const gw = gateways.find((g) => g.id === gatewayId);
    if (!gw) return;

    // Stop the service first if running
    if (gw.serviceState === "running") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (gw.type === "local") {
          await invoke("openclaw_stop");
        } else if (gw.rootDir) {
          await invoke("compose_stop", { rootDir: gw.rootDir });
        }
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
      saveSecurityOfficer(null);
    }
    setDeleteConfirm(null);
  }

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
      <DiscoveryBanner
        items={discoveredGateways}
        onImport={handleImportGateway}
        onImportAll={handleImportAllGateways}
        onDismiss={() => setDiscoveredGateways([])}
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
              fixedRootDir={g.type !== "local" && g.rootDir ? g.rootDir : undefined}
              gatewayType={g.type || "docker"}
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
      {ctxMenu && (
        <GatewayContextMenu
          ctxMenu={ctxMenu}
          ctxEndpoint={ctxEndpoint}
          ctxCdpEndpoint={ctxCdpEndpoint}
          gateways={gateways}
          securityOfficerId={securityOfficerId}
          onAction={ctxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}

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
        <SettingsModal
          settingsDraft={settingsDraft}
          onSettingsDraftChange={setSettingsDraft}
          browserRunning={false}
          onSave={() => {
            setSharedDir(settingsDraft);
            saveSharedDir(settingsDraft);
            setSettingsModal(false);
          }}
          onClose={() => setSettingsModal(false)}
          onCheckUpdates={() => { setSettingsModal(false); setUpdateModal(true); }}
        />
      )}

      {/* ── Update Checker Modal ── */}
      {updateModal && (
        <UpdateChecker onClose={() => setUpdateModal(false)} />
      )}
    </div>
    </RpcPoolProvider>
  );
}
