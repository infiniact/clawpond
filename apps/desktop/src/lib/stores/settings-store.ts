export const SHARED_DIR_STORAGE_KEY = "clawpond-shared-dir";
export const THEME_STORAGE_KEY = "clawpond-theme";
export const SECURITY_OFFICER_STORAGE_KEY = "clawpond-security-officer";
export const PLAYWRIGHT_IMAGE_FALLBACK = "mcr.microsoft.com/playwright:v1.52.0-noble";

export function loadSharedDir(): string {
  try { return localStorage.getItem(SHARED_DIR_STORAGE_KEY) || ""; } catch { return ""; }
}

export function saveSharedDir(dir: string) {
  localStorage.setItem(SHARED_DIR_STORAGE_KEY, dir);
}

export function loadTheme(): "dark" | "light" {
  try { return (localStorage.getItem(THEME_STORAGE_KEY) as "dark" | "light") || "dark"; } catch { return "dark"; }
}

export function saveTheme(theme: "dark" | "light") {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function loadSecurityOfficer(): string | null {
  try { return localStorage.getItem(SECURITY_OFFICER_STORAGE_KEY) || null; } catch { return null; }
}

export function saveSecurityOfficer(id: string | null) {
  if (id) {
    localStorage.setItem(SECURITY_OFFICER_STORAGE_KEY, id);
  } else {
    localStorage.removeItem(SECURITY_OFFICER_STORAGE_KEY);
  }
}
