/**
 * Token usage tracking store — persists per-gateway hourly token usage in SQLite.
 */
import { invoke } from "@tauri-apps/api/core";

export type DayUsage = { date: string; tokens: number };
export type HourUsage = { hour: number; tokens: number };

/** Record token usage for a gateway at current time. */
export async function recordUsage(gatewayId: string, tokens: number) {
  if (tokens <= 0) return;
  try {
    await invoke("db_record_usage", { gatewayId, tokens });
  } catch { /* ignore */ }
}

/** Estimate token count from text content (~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Get daily usage for the last N days (not including today). */
export async function getDailyUsage(gatewayId: string, days: number): Promise<DayUsage[]> {
  try {
    return await invoke<DayUsage[]>("db_get_daily_usage", { gatewayId, days });
  } catch { return []; }
}

/** Get hourly usage for today (hours 0-23). */
export async function getTodayHourlyUsage(gatewayId: string): Promise<HourUsage[]> {
  try {
    return await invoke<HourUsage[]>("db_get_hourly_usage", { gatewayId });
  } catch { return []; }
}

/** Clean up entries older than 30 days. */
export async function pruneOldUsage() {
  try {
    await invoke("db_prune_old_usage");
  } catch { /* ignore */ }
}
