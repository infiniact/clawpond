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

export const GATEWAYS_STORAGE_KEY = "clawpond-gateways";
export const AGENT_ICONS_STORAGE_KEY = "clawpond-agent-icons";

export function loadAgentIcons(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AGENT_ICONS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

export function saveAgentIcons(icons: Record<string, string>) {
  localStorage.setItem(AGENT_ICONS_STORAGE_KEY, JSON.stringify(icons));
}

export function loadGateways(): Gateway[] {
  try {
    const raw = localStorage.getItem(GATEWAYS_STORAGE_KEY);
    if (raw) {
      const stored: StoredGateway[] = JSON.parse(raw);
      if (Array.isArray(stored) && stored.length > 0) {
        return stored.map((g) => ({
          ...g,
          // Default gateway (ClawKing) is always local; others are docker
          type: g.id === "default" ? "local" as const : (g.type || "docker" as const),
          rootDir: g.id === "default" ? "~/.openclaw" : g.rootDir,
          serviceState: !g.configured
            ? "unconfigured" as const
            : "loading" as const,
        }));
      }
    }
  } catch { /* ignore */ }
  return [
    { id: "default", name: "ClawKing", emoji: "\u{1F99E}", type: "local", rootDir: "~/.openclaw", configured: false, serviceState: "unconfigured" },
  ];
}

export function saveGateways(gateways: Gateway[]) {
  const stored: StoredGateway[] = gateways.map(({ id, name, emoji, type, rootDir, configured }) => ({
    id, name, emoji, type, rootDir, configured,
  }));
  localStorage.setItem(GATEWAYS_STORAGE_KEY, JSON.stringify(stored));
}
