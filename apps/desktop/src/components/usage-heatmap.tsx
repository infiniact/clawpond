"use client";

import { useState, useEffect, useCallback } from "react";
import { useRpcPool } from "../lib/rpc/rpc-pool-context";
import { getDailyUsage, getTodayHourlyUsage, type DayUsage, type HourUsage } from "../lib/stores/usage-store";

const DAILY_TOKEN_MAX = 100_000_000;  // 1亿 tokens = full red (daily)
const HOURLY_TOKEN_MAX = 10_000_000;  // 1000万 tokens = full red (hourly)

/** Interpolate green → red based on token count and max threshold */
function usageColor(tokens: number, max: number): string {
  if (tokens <= 0) return "transparent";
  const t = Math.min(1, tokens / max);
  const h = 120 - t * 120;
  const s = 50 + t * 20;
  const l = 65 - t * 10;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[d.getDay()];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hourKey(date: Date): string {
  return `${dayKey(date)}-${String(date.getHours()).padStart(2, "0")}`;
}

type SessionEntry = {
  sessionKey?: string;
  sessionId?: string;
  updatedAt?: string;
  createdAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
  [key: string]: unknown;
};

/** Aggregate sessions.list data into daily and hourly buckets, and persist to localStorage */
function aggregateSessions(sessions: SessionEntry[], gatewayId: string): { daily: DayUsage[]; hourly: HourUsage[] } {
  const dailyMap = new Map<string, number>();
  const hourlyMap = new Map<number, number>();
  const now = new Date();
  const todayStr = dayKey(now);

  // Initialize past 6 days
  for (let i = 6; i >= 1; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyMap.set(dayKey(d), 0);
  }
  // Initialize 24 hours
  for (let h = 0; h < 24; h++) hourlyMap.set(h, 0);

  // Collect per-hourKey totals so we can write them to localStorage
  const hourKeyTotals = new Map<string, number>();

  // Deduplicate sessions by sessionKey or sessionId
  const seen = new Set<string>();

  for (const s of sessions) {
    const dedupKey = s.sessionKey || s.sessionId || "";
    if (dedupKey && seen.has(dedupKey)) continue;
    if (dedupKey) seen.add(dedupKey);

    const tokens = s.totalTokens || ((s.inputTokens || 0) + (s.outputTokens || 0));
    if (tokens <= 0) continue;

    const ts = s.updatedAt || s.createdAt;
    if (!ts) continue;

    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;

    const dk = dayKey(date);
    const hk = hourKey(date);

    // Accumulate for localStorage persistence
    hourKeyTotals.set(hk, (hourKeyTotals.get(hk) || 0) + tokens);

    if (dk === todayStr) {
      const hour = date.getHours();
      hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + tokens);
    } else if (dailyMap.has(dk)) {
      dailyMap.set(dk, (dailyMap.get(dk) || 0) + tokens);
    }
  }

  // Persist aggregated data to localStorage so it's available as fallback and history
  persistToLocalStorage(gatewayId, hourKeyTotals);

  const daily: DayUsage[] = [];
  for (const [date, tokens] of dailyMap) {
    daily.push({ date, tokens });
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));

  const hourly: HourUsage[] = [];
  for (const [hour, tokens] of hourlyMap) {
    hourly.push({ hour, tokens });
  }
  hourly.sort((a, b) => a.hour - b.hour);

  return { daily, hourly };
}

/** Overwrite localStorage usage data with RPC-sourced aggregated data */
function persistToLocalStorage(gatewayId: string, hourKeyTotals: Map<string, number>) {
  const STORAGE_KEY = "clawpond_token_usage";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data: Record<string, Record<string, number>> = raw ? JSON.parse(raw) : {};
    if (!data[gatewayId]) data[gatewayId] = {};
    for (const [hk, tokens] of hourKeyTotals) {
      // Only overwrite if RPC data is larger (more accurate)
      if (tokens > (data[gatewayId][hk] || 0)) {
        data[gatewayId][hk] = tokens;
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

const AUTO_REFRESH_INTERVAL = 30_000; // 30 seconds

export function UsageHeatmap({ gatewayId }: { gatewayId: string }) {
  const { pool, gateways } = useRpcPool();
  const [dailyUsage, setDailyUsage] = useState<DayUsage[]>([]);
  const [hourlyUsage, setHourlyUsage] = useState<HourUsage[]>([]);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [totalRange, setTotalRange] = useState<"7d" | "30d">("7d");

  const fetchFromRpc = useCallback(async (): Promise<boolean> => {
    const gw = gateways.find((g) => g.id === gatewayId);
    if (!gw || gw.serviceState !== "running") return false;

    try {
      const conn = await pool.getConnection(gw);

      const result = await conn.call("sessions.list", {}) as SessionEntry[] | { sessions: SessionEntry[] } | Record<string, SessionEntry>;

      let sessions: SessionEntry[];
      if (Array.isArray(result)) {
        sessions = result;
      } else if (result && typeof result === "object" && "sessions" in result && Array.isArray((result as { sessions: SessionEntry[] }).sessions)) {
        sessions = (result as { sessions: SessionEntry[] }).sessions;
      } else if (result && typeof result === "object") {
        sessions = Object.values(result as Record<string, SessionEntry>);
      } else {
        return false;
      }

      const { daily, hourly } = aggregateSessions(sessions, gatewayId);
      setDailyUsage(daily);
      setHourlyUsage(hourly);
      return true;
    } catch {
      return false;
    }
  }, [gatewayId, gateways, pool]);

  // Initial load from localStorage, then auto-refresh from RPC
  useEffect(() => {
    setDailyUsage(getDailyUsage(gatewayId, 6));
    setHourlyUsage(getTodayHourlyUsage(gatewayId));

    // Fetch from RPC immediately, then periodically
    fetchFromRpc();
    const timer = setInterval(() => {
      fetchFromRpc();
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(timer);
  }, [gatewayId, fetchFromRpc]);

  const currentHour = new Date().getHours();

  // Calculate total based on selected range
  const rangeTotal = (() => {
    const todayTokens = hourlyUsage.reduce((sum, h) => sum + h.tokens, 0);
    if (totalRange === "7d") {
      return dailyUsage.reduce((sum, d) => sum + d.tokens, 0) + todayTokens;
    }
    // 30d: read from localStorage for the full 30-day range
    const monthly = getDailyUsage(gatewayId, 30);
    return monthly.reduce((sum, d) => sum + d.tokens, 0) + todayTokens;
  })();

  return (
    <div className="relative flex items-center gap-1.5 overflow-visible">
      {/* Total badge — click to toggle 7d/30d */}
      <div
        className="relative flex flex-col items-center"
        onMouseEnter={() => setHoveredItem("range-total")}
        onMouseLeave={() => setHoveredItem(null)}
      >
        <button
          onClick={() => setTotalRange((v) => (v === "7d" ? "30d" : "7d"))}
          className="flex h-[18px] cursor-pointer items-center gap-1 rounded-md bg-bg-surface px-1.5 ring-1 ring-border-default transition-colors hover:ring-border-strong"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-text-ghost">
            <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-[9px] font-medium text-text-tertiary">{formatTokens(rangeTotal)}</span>
          <span className="text-[8px] text-text-ghost">{totalRange === "7d" ? "7d" : "30d"}</span>
        </button>
        {hoveredItem === "range-total" && (
          <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-bg-deep px-2 py-1 text-[10px] text-text-secondary shadow-xl ring-1 ring-border-subtle">
            {totalRange === "7d" ? "7-day" : "30-day"} total: {formatTokens(rangeTotal)} tokens (click to switch)
          </div>
        )}
      </div>

      <div className="mx-0.5 h-[18px] w-px bg-border-subtle" />

      {/* Past 6 days — color: 0~1亿 */}
      {dailyUsage.map((d) => {
        const key = `day-${d.date}`;
        return (
          <div
            key={key}
            className="relative flex flex-col items-center gap-0.5"
            onMouseEnter={() => setHoveredItem(key)}
            onMouseLeave={() => setHoveredItem(null)}
          >
            <div
              className="h-[18px] w-[18px] rounded-[3px] border border-border-default"
              style={{ backgroundColor: usageColor(d.tokens, DAILY_TOKEN_MAX) }}
            />
            <span className="text-[8px] leading-none text-text-ghost">{formatDate(d.date)}</span>
            {hoveredItem === key && (
              <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-bg-deep px-2 py-1 text-[10px] text-text-secondary shadow-xl ring-1 ring-border-subtle">
                {formatTokens(d.tokens)} tokens
              </div>
            )}
          </div>
        );
      })}

      {/* Separator */}
      <div className="mx-0.5 mb-2 h-[18px] w-px bg-border-subtle" />

      {/* Today's hours — color: 0~1000万 */}
      {hourlyUsage.map((h) => {
        if (h.hour > currentHour) return null;
        const key = `hr-${h.hour}`;
        return (
          <div
            key={key}
            className="relative flex flex-col items-center gap-0.5"
            onMouseEnter={() => setHoveredItem(key)}
            onMouseLeave={() => setHoveredItem(null)}
          >
            <div
              className="h-[18px] w-[8px] rounded-[2px] border border-border-default"
              style={{ backgroundColor: usageColor(h.tokens, HOURLY_TOKEN_MAX) }}
            />
            <span className="text-[7px] leading-none text-text-ghost">{h.hour}</span>
            {hoveredItem === key && (
              <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-bg-deep px-2 py-1 text-[10px] text-text-secondary shadow-xl ring-1 ring-border-subtle">
                {h.hour}:00 — {formatTokens(h.tokens)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
