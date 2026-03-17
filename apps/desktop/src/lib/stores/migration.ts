/**
 * One-time migration from localStorage to SQLite.
 * Called from page.tsx hydration effect before any store loads.
 */
import { invoke } from "@tauri-apps/api/core";
import type { StoredMessage } from "./chat-store";

const THEME_LS_KEY = "clawpond-theme";

type StoredGateway = {
  id: string;
  name: string;
  emoji: string;
  type: string;
  rootDir: string | null;
  configured: boolean;
};

export async function migrateIfNeeded(): Promise<void> {
  try {
    const done = await invoke<string | null>("db_get_setting", { key: "db_migration_complete" });
    if (done === "1") return;
  } catch {
    return; // DB not ready
  }

  try {
    // 1. Collect settings
    const settings: Record<string, string> = {};
    const settingsKeys = ["clawpond-shared-dir", "clawpond-theme", "clawpond-security-officer"];
    const keyMap: Record<string, string> = {
      "clawpond-shared-dir": "shared-dir",
      "clawpond-theme": "theme",
      "clawpond-security-officer": "security-officer",
    };
    for (const lsKey of settingsKeys) {
      const val = localStorage.getItem(lsKey);
      if (val) settings[keyMap[lsKey]] = val;
    }

    // 2. Collect gateways
    let gateways: Array<{ id: string; name: string; emoji: string; gw_type: string; root_dir: string | null; configured: boolean }> | undefined;
    const gwRaw = localStorage.getItem("clawpond-gateways");
    if (gwRaw) {
      try {
        const parsed: StoredGateway[] = JSON.parse(gwRaw);
        gateways = parsed.map((g) => ({
          id: g.id,
          name: g.name,
          emoji: g.emoji,
          gw_type: g.type || "docker",
          root_dir: g.rootDir,
          configured: g.configured,
        }));
      } catch { /* ignore */ }
    }

    // 3. Collect agent icons
    let agentIcons: Record<string, string> | undefined;
    const iconsRaw = localStorage.getItem("clawpond-agent-icons");
    if (iconsRaw) {
      try { agentIcons = JSON.parse(iconsRaw); } catch { /* ignore */ }
    }

    // 4. Collect chat messages
    const chatMessages: Record<string, StoredMessage[]> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("clawpond-chat:")) {
        const rootDir = key.slice("clawpond-chat:".length);
        try {
          const msgs = JSON.parse(localStorage.getItem(key) || "[]");
          if (Array.isArray(msgs) && msgs.length > 0) {
            chatMessages[rootDir] = msgs;
          }
        } catch { /* ignore */ }
      }
    }

    // 5. Collect token usage
    let tokenUsage: Record<string, Record<string, number>> | undefined;
    const usageRaw = localStorage.getItem("clawpond_token_usage");
    if (usageRaw) {
      try { tokenUsage = JSON.parse(usageRaw); } catch { /* ignore */ }
    }

    // 6. Send to Rust for atomic write
    const payload: Record<string, unknown> = {};
    if (Object.keys(settings).length > 0) payload.settings = settings;
    if (gateways) payload.gateways = gateways;
    if (agentIcons) payload.agent_icons = agentIcons;
    if (Object.keys(chatMessages).length > 0) payload.chat_messages = chatMessages;
    if (tokenUsage) payload.token_usage = tokenUsage;

    if (Object.keys(payload).length > 0) {
      await invoke("db_migrate_from_localstorage", { payload });
    }

    // 7. Mark complete
    await invoke("db_set_setting", { key: "db_migration_complete", value: "1" });

    // 8. Clear localStorage (keep theme for layout.tsx inline script)
    const themeVal = localStorage.getItem(THEME_LS_KEY);
    localStorage.clear();
    if (themeVal) localStorage.setItem(THEME_LS_KEY, themeVal);

    console.log("[migration] localStorage → SQLite complete");
  } catch (e) {
    console.warn("[migration] failed:", e);
  }
}
