import { invoke } from "@tauri-apps/api/core";

export async function browserStart(relayPort: string, image: string) {
  return invoke("browser_start", { relayPort, image });
}

export async function browserStop() {
  return invoke("browser_stop");
}

export async function browserHealth(): Promise<boolean> {
  return invoke<boolean>("browser_health");
}

export async function resolvePlaywrightImage(): Promise<string> {
  return invoke<string>("resolve_playwright_image");
}
