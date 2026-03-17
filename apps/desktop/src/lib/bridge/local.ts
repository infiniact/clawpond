import { invoke } from "@tauri-apps/api/core";

export type OpenClawEnvStatus = {
  node_installed: boolean;
  node_version: string | null;
  openclaw_installed: boolean;
  openclaw_version: string | null;
  npx_available: boolean;
};

export type LocalHealthResult = {
  running: boolean;
  healthy: boolean | null;
  pid: number | null;
  error: string | null;
};

export async function checkOpenClaw(): Promise<OpenClawEnvStatus> {
  return invoke<OpenClawEnvStatus>("check_openclaw");
}

export async function openclawStart() {
  return invoke("openclaw_start");
}

export async function openclawStop() {
  return invoke("openclaw_stop");
}

export async function openclawHealth(): Promise<LocalHealthResult> {
  return invoke<LocalHealthResult>("openclaw_health");
}

export async function writeLocalConfig(params: {
  configJson: Record<string, unknown>;
  gatewayPort: string;
  gatewayBind: string;
  gatewayToken: string;
  providerEnvKey: string;
  providerApiKey: string;
}) {
  return invoke("write_local_config", params);
}

export async function writeLocalAuthProfiles(provider: string, apiKey: string) {
  return invoke("write_local_auth_profiles", { provider, apiKey });
}
