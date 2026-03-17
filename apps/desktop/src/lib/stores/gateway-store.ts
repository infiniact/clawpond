import { invoke } from "@tauri-apps/api/core";

export type ServiceState = "unconfigured" | "loading" | "starting" | "stopping" | "running" | "error" | "stopped";

export type ComposeStartProgress = {
  stage: string;
  message: string;
  image: string | null;
  percent: number | null;
  layers_done: number;
  layers_total: number;
};

export type GatewayType = "local" | "docker";

export type Gateway = {
  id: string;
  name: string;
  emoji: string;
  type: GatewayType;
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
export type StoredGateway = {
  id: string;
  name: string;
  emoji: string;
  type: GatewayType;
  rootDir: string | null;
  configured: boolean;
};

/** DB-side stored gateway shape (matches Rust serde rename) */
type DbStoredGateway = {
  id: string;
  name: string;
  emoji: string;
  type: string;
  rootDir: string | null;
  configured: boolean;
};

export const GATEWAYS_STORAGE_KEY = "clawpond-gateways";
export const AGENT_ICONS_STORAGE_KEY = "clawpond-agent-icons";

export async function loadAgentIcons(): Promise<Record<string, string>> {
  try {
    return await invoke<Record<string, string>>("db_load_agent_icons");
  } catch { return {}; }
}

export async function saveAgentIcons(icons: Record<string, string>) {
  await invoke("db_save_agent_icons", { icons });
}

/** Migrate legacy pond rootDir paths to the new ~/.openclaw/workspace/pond/ location */
function migrateRootDir(rootDir: string | null): string | null {
  if (!rootDir) return rootDir;
  const legacyPatterns = [
    /^~\/clawpond\/clawking\/pond\//,
    /^~\/clawpond\/pond\//,
  ];
  for (const pat of legacyPatterns) {
    if (pat.test(rootDir)) {
      return rootDir.replace(pat, "~/.openclaw/workspace/pond/");
    }
  }
  return rootDir;
}

/** Load gateways from SQLite and return migration pairs (old → new rootDir) for file migration */
export async function loadGatewaysWithMigration(): Promise<{ gateways: Gateway[]; migrations: Array<{ oldDir: string; newDir: string }> }> {
  const migrations: Array<{ oldDir: string; newDir: string }> = [];
  try {
    const dbGateways = await invoke<DbStoredGateway[]>("db_load_gateways");
    if (Array.isArray(dbGateways) && dbGateways.length > 0) {
      let migrated = false;
      const gateways = dbGateways.map((g) => {
        const rootDir = g.rootDir;
        const gwType = g.type as GatewayType;
        const newRootDir = g.id === "default" ? "~/.openclaw" : migrateRootDir(rootDir);
        if (newRootDir !== rootDir && rootDir && newRootDir) {
          migrated = true;
          migrations.push({ oldDir: rootDir, newDir: newRootDir });
        }
        return {
          id: g.id,
          name: g.name,
          emoji: g.emoji,
          type: g.id === "default" ? "local" as const : (gwType || "docker" as const),
          rootDir: newRootDir,
          configured: g.configured,
          serviceState: !g.configured
            ? "unconfigured" as const
            : "loading" as const,
        };
      });
      if (migrated) {
        await saveGateways(gateways);
      }
      return { gateways, migrations };
    }
  } catch { /* ignore */ }
  return {
    gateways: [
      { id: "default", name: "ClawKing", emoji: "\u{1F99E}", type: "local", rootDir: "~/.openclaw", configured: false, serviceState: "unconfigured" },
    ],
    migrations: [],
  };
}

export async function saveGateways(gateways: Gateway[]) {
  const stored = gateways.map(({ id, name, emoji, type, rootDir, configured }) => ({
    id, name, emoji, type, rootDir, configured,
  }));
  await invoke("db_save_gateways", { gateways: stored });
}
