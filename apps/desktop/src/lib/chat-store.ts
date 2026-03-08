/**
 * Persistent chat message storage using localStorage.
 * Messages are keyed by rootDir (gateway identity).
 */

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string; // ISO string for serialization
  tool?: { name: string; status: "running" | "done" | "error" };
  sourceGateway?: { id: string; name: string; emoji: string };
  mentions?: string[];
};

const STORAGE_PREFIX = "clawpond-chat:";
const PAGE_SIZE = 100;

function storageKey(rootDir: string): string {
  return `${STORAGE_PREFIX}${rootDir}`;
}

/** Load all stored messages for a gateway. */
function loadAll(rootDir: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(rootDir));
    if (!raw) return [];
    return JSON.parse(raw) as StoredMessage[];
  } catch {
    return [];
  }
}

/** Get the total message count for a gateway. */
export function getMessageCount(rootDir: string): number {
  return loadAll(rootDir).length;
}

/**
 * Load a page of messages (most recent first).
 * @param offset Number of recent messages already loaded (0 = first page)
 * @returns Messages in chronological order (oldest first within the page)
 */
export function loadMessages(rootDir: string, offset: number = 0): { messages: StoredMessage[]; hasMore: boolean } {
  const all = loadAll(rootDir);
  const total = all.length;
  // We want the most recent PAGE_SIZE messages first, then older ones on "load more"
  const end = total - offset;
  const start = Math.max(0, end - PAGE_SIZE);
  if (end <= 0) return { messages: [], hasMore: false };
  return {
    messages: all.slice(start, end),
    hasMore: start > 0,
  };
}

/** Append messages to the store. Deduplicates by id. */
export function appendMessages(rootDir: string, msgs: StoredMessage[]) {
  const all = loadAll(rootDir);
  const existingIds = new Set(all.map((m) => m.id));
  const newMsgs = msgs.filter((m) => !existingIds.has(m.id));
  if (newMsgs.length === 0) return;
  all.push(...newMsgs);
  try {
    localStorage.setItem(storageKey(rootDir), JSON.stringify(all));
  } catch {
    // Storage full — trim oldest 20%
    const trimmed = all.slice(Math.floor(all.length * 0.2));
    localStorage.setItem(storageKey(rootDir), JSON.stringify(trimmed));
  }
}

/** Update a message in the store by id. */
export function updateMessage(rootDir: string, id: string, updates: Partial<StoredMessage>) {
  const all = loadAll(rootDir);
  const idx = all.findIndex((m) => m.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...updates };
  try {
    localStorage.setItem(storageKey(rootDir), JSON.stringify(all));
  } catch {
    // ignore
  }
}

/** Save all current messages (full replace). Used for bulk sync. */
export function saveAllMessages(rootDir: string, msgs: StoredMessage[]) {
  // Merge: keep older stored messages not present in the provided list,
  // then append the provided list (which represents the loaded window + new messages).
  const stored = loadAll(rootDir);
  const providedIds = new Set(msgs.map((m) => m.id));
  // Older messages that weren't loaded into the current view
  const olderMsgs = stored.filter((m) => !providedIds.has(m.id));
  const merged = [...olderMsgs, ...msgs];
  try {
    localStorage.setItem(storageKey(rootDir), JSON.stringify(merged));
  } catch {
    const trimmed = merged.slice(Math.floor(merged.length * 0.2));
    localStorage.setItem(storageKey(rootDir), JSON.stringify(trimmed));
  }
}
