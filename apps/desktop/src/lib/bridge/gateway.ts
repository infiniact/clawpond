import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ComposeStartProgress } from "../stores/gateway-store";

export type GatewayInfoResult = {
  port: string;
  token: string;
};

export type HealthResult = {
  running: boolean;
  healthy: boolean | null;
  error: string | null;
};

export type StatsResult = {
  cpu_percent: number;
  mem_usage_mb: number;
};

export async function composeStart(rootDir: string) {
  return invoke("compose_start", { rootDir });
}

export async function composeStop(rootDir: string) {
  return invoke("compose_stop", { rootDir });
}

export async function composeHealth(rootDir: string): Promise<HealthResult> {
  return invoke<HealthResult>("compose_health", { rootDir });
}

export async function composeStats(rootDir: string): Promise<StatsResult | null> {
  return invoke<StatsResult | null>("compose_stats", { rootDir });
}

export async function readGatewayInfo(rootDir: string): Promise<GatewayInfoResult> {
  return invoke<GatewayInfoResult>("read_gateway_info", { rootDir });
}

export async function detectConfig(): Promise<string | null> {
  return invoke<string | null>("detect_config");
}

export async function migrateGatewayCompose(rootDir: string): Promise<boolean> {
  return invoke<boolean>("migrate_gateway_compose", { rootDir });
}

export async function removeDirectory(path: string) {
  return invoke("remove_directory", { path });
}

export async function listWorkspaceAgents(rootDir: string): Promise<{ agents: string[]; allowed: string[] }> {
  return invoke<{ agents: string[]; allowed: string[] }>("list_workspace_agents", { rootDir });
}

export async function listenComposeStartProgress(cb: (p: ComposeStartProgress) => void) {
  return listen<ComposeStartProgress>("compose-start-progress", (event) => cb(event.payload));
}

export async function listenTrayGatewayAction(cb: (action: string) => void) {
  return listen<string>("tray-gateway-action", (event) => cb(event.payload));
}
