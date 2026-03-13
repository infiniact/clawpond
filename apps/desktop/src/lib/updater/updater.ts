import { invoke } from "@tauri-apps/api/core";

export async function checkUpdates() {
  return invoke("check_updates");
}

export async function applyUpdate(component: string) {
  return invoke("apply_update", { component });
}
