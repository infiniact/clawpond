/**
 * Token usage tracking store — persists per-gateway hourly token usage in localStorage.
 *
 * Storage format: { [gatewayId]: { [hourKey]: tokens } }
 * hourKey = "YYYY-MM-DD-HH" (e.g. "2026-03-08-14")
 */

const STORAGE_KEY = "clawpond_token_usage";

type UsageMap = Record<string, Record<string, number>>;

function load(): UsageMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(data: UsageMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function hourKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}`;
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Record token usage for a gateway at current time. */
export function recordUsage(gatewayId: string, tokens: number) {
  if (tokens <= 0) return;
  const data = load();
  if (!data[gatewayId]) data[gatewayId] = {};
  const key = hourKey(new Date());
  data[gatewayId][key] = (data[gatewayId][key] || 0) + tokens;
  save(data);
}

/** Estimate token count from text content (~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export type DayUsage = { date: string; tokens: number };
export type HourUsage = { hour: number; tokens: number };

/** Get daily usage for the last N days (not including today). */
export function getDailyUsage(gatewayId: string, days: number): DayUsage[] {
  const data = load();
  const gwData = data[gatewayId] || {};
  const result: DayUsage[] = [];
  const now = new Date();

  for (let i = days; i >= 1; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dk = dayKey(d);
    let total = 0;
    for (let h = 0; h < 24; h++) {
      const hk = `${dk}-${String(h).padStart(2, "0")}`;
      total += gwData[hk] || 0;
    }
    result.push({ date: dk, tokens: total });
  }
  return result;
}

/** Get hourly usage for today (hours 0-23). */
export function getTodayHourlyUsage(gatewayId: string): HourUsage[] {
  const data = load();
  const gwData = data[gatewayId] || {};
  const now = new Date();
  const dk = dayKey(now);
  const result: HourUsage[] = [];

  for (let h = 0; h < 24; h++) {
    const hk = `${dk}-${String(h).padStart(2, "0")}`;
    result.push({ hour: h, tokens: gwData[hk] || 0 });
  }
  return result;
}

/** Clean up entries older than 30 days. */
export function pruneOldUsage() {
  const data = load();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = dayKey(cutoff);

  for (const gwId of Object.keys(data)) {
    for (const key of Object.keys(data[gwId])) {
      if (key < cutoffKey) {
        delete data[gwId][key];
      }
    }
    if (Object.keys(data[gwId]).length === 0) {
      delete data[gwId];
    }
  }
  save(data);
}
