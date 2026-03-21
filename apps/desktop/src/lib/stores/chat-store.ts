/**
 * Persistent chat message storage using SQLite via Tauri commands.
 * Messages are keyed by rootDir (gateway identity).
 */
import { invoke } from "@tauri-apps/api/core";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string; // ISO string for serialization
  tool?: { name: string; status: "running" | "done" | "error" };
  sourceGateway?: { id: string; name: string; emoji: string };
  mentions?: string[];
  agentName?: string;
  images?: { name: string; mediaType: string; base64: string }[];
};

const PAGE_SIZE = 100;

/**
 * Load a page of messages (most recent first).
 * @param offset Number of recent messages already loaded (0 = first page)
 * @returns Messages in chronological order (oldest first within the page)
 */
export async function loadMessages(rootDir: string, offset: number = 0): Promise<{ messages: StoredMessage[]; hasMore: boolean }> {
  try {
    const result = await invoke<{ messages: StoredMessage[]; hasMore: boolean }>("db_load_messages", {
      rootDir,
      offset: offset,
      limit: PAGE_SIZE,
    });
    return result;
  } catch {
    return { messages: [], hasMore: false };
  }
}

/** Save all current messages (full replace). Used for bulk sync. */
export async function saveAllMessages(rootDir: string, msgs: StoredMessage[]) {
  try {
    await invoke("db_save_all_messages", { rootDir, messages: msgs });
  } catch { /* ignore */ }
}
