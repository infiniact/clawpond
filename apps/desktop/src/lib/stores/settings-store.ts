import { invoke } from "@tauri-apps/api/core";

export const SHARED_DIR_STORAGE_KEY = "clawpond-shared-dir";
export const THEME_STORAGE_KEY = "clawpond-theme";
export const SECURITY_OFFICER_STORAGE_KEY = "clawpond-security-officer";

export async function loadSharedDir(): Promise<string> {
  try {
    const val = await invoke<string | null>("db_get_setting", { key: "shared-dir" });
    return val || "";
  } catch { return ""; }
}

export async function saveSharedDir(dir: string) {
  await invoke("db_set_setting", { key: "shared-dir", value: dir });
}

export async function loadTheme(): Promise<"dark" | "light"> {
  try {
    const val = await invoke<string | null>("db_get_setting", { key: "theme" });
    return (val as "dark" | "light") || "dark";
  } catch { return "dark"; }
}

export async function saveTheme(theme: "dark" | "light") {
  // Write-through to localStorage for layout.tsx inline script (prevents FOUC)
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* ignore */ }
  await invoke("db_set_setting", { key: "theme", value: theme });
}

export async function loadSecurityOfficer(): Promise<string | null> {
  try {
    return await invoke<string | null>("db_get_setting", { key: "security-officer" });
  } catch { return null; }
}

export async function saveSecurityOfficer(id: string | null) {
  if (id) {
    await invoke("db_set_setting", { key: "security-officer", value: id });
  } else {
    await invoke("db_delete_setting", { key: "security-officer" });
  }
}
