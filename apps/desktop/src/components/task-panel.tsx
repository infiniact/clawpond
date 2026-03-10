"use client";

import { useState, useEffect, useCallback } from "react";
import {
  IconClock,
  IconPlus,
  IconChevronRight,
  IconX,
  IconSpinner,
} from "./icons";

type CronJob = {
  key: string;
  id: string;
  name: string;
  schedule: string;
  createdAt: string;
};

type HeartbeatState = {
  lastChecks: Record<string, unknown>;
  cronJobs: Record<string, { id: string; name: string; schedule: string; createdAt: string }>;
};

function describeCron(schedule: string): string {
  // Strip optional timezone suffix
  const parts = schedule.trim().split(/\s+/);
  const tz = parts.length === 6 ? parts[5] : null;
  const [minute, hour, dom, mon, dow] = parts;

  let desc = "";

  // Every N minutes
  if (minute?.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    desc = `Every ${minute.slice(2)} min`;
  }
  // Every N hours
  else if (minute !== undefined && hour?.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    desc = `Every ${hour.slice(2)} hours`;
  }
  // Weekdays at HH:MM
  else if (minute !== undefined && hour !== undefined && !hour.includes("*") && !minute.includes("*") && dom === "*" && mon === "*" && dow === "1-5") {
    desc = `Weekdays ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  // Every day at HH:MM
  else if (minute !== undefined && hour !== undefined && !hour.includes("*") && !minute.includes("*") && dom === "*" && mon === "*" && (dow === "*" || dow === undefined)) {
    desc = `Every day ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  // Fallback: show raw cron (without tz)
  else {
    desc = parts.slice(0, 5).join(" ");
  }

  if (tz) {
    // Show short timezone
    const shortTz = tz.split("/").pop() || tz;
    desc += ` (${shortTz})`;
  }

  return desc;
}

function toKebabCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "task";
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function TaskPanel({
  collapsed,
  onToggle,
  rootDir,
  gatewayId,
  serviceState,
}: {
  collapsed: boolean;
  onToggle: () => void;
  rootDir: string | null;
  gatewayId: string;
  serviceState: string;
}) {
  const [tasks, setTasks] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addSchedule, setAddSchedule] = useState("0 9 * * * Asia/Shanghai");
  const [saving, setSaving] = useState(false);
  const [fullState, setFullState] = useState<HeartbeatState>({ lastChecks: {}, cronJobs: {} });

  const loadTasks = useCallback(async () => {
    if (!rootDir) {
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const state = await invoke<HeartbeatState>("read_scheduled_tasks", { rootDir });
      setFullState(state);
      const jobs: CronJob[] = Object.entries(state.cronJobs || {}).map(([key, val]) => ({
        key,
        id: val.id,
        name: val.name,
        schedule: val.schedule,
        createdAt: val.createdAt,
      }));
      setTasks(jobs);
    } catch {
      setTasks([]);
      setFullState({ lastChecks: {}, cronJobs: {} });
    } finally {
      setLoading(false);
    }
  }, [rootDir]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks, gatewayId]);

  async function handleDelete(key: string) {
    if (!rootDir) return;
    const newCronJobs = { ...fullState.cronJobs };
    delete newCronJobs[key];
    const newState = { ...fullState, cronJobs: newCronJobs };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_scheduled_tasks", { rootDir, state: newState });
      setFullState(newState);
      setTasks((prev) => prev.filter((t) => t.key !== key));
    } catch { /* ignore */ }
  }

  async function handleAdd() {
    if (!rootDir || !addName.trim()) return;
    setSaving(true);
    const key = toKebabCase(addName.trim());
    const newJob = {
      id: generateUUID(),
      name: addName.trim(),
      schedule: addSchedule.trim(),
      createdAt: new Date().toISOString().slice(0, 10),
    };
    const newCronJobs = { ...fullState.cronJobs, [key]: newJob };
    const newState = { ...fullState, cronJobs: newCronJobs };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_scheduled_tasks", { rootDir, state: newState });
      setFullState(newState);
      setTasks(Object.entries(newCronJobs).map(([k, val]) => ({
        key: k,
        id: val.id,
        name: val.name,
        schedule: val.schedule,
        createdAt: val.createdAt,
      })));
      setAddName("");
      setAddSchedule("0 9 * * * Asia/Shanghai");
      setShowAddForm(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  const isUnconfigured = !rootDir || serviceState === "unconfigured";

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-l border-border-subtle bg-bg-deep transition-all duration-200 ${
        collapsed ? "w-0 overflow-hidden border-l-0 opacity-0" : "w-[272px] opacity-100"
      }`}
    >
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <div className="flex items-center gap-2">
          <IconClock size={14} className="text-text-tertiary" />
          <span className="whitespace-nowrap text-[12px] font-semibold text-text-primary">
            Scheduled Tasks
          </span>
          {tasks.length > 0 && (
            <span className="rounded-full bg-bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-ghost ring-1 ring-border-default">
              {tasks.length}
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <IconChevronRight size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <IconSpinner size={18} className="animate-spin text-text-ghost" />
          </div>
        ) : isUnconfigured ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-surface ring-1 ring-border-default">
              <IconClock size={22} className="text-text-ghost" />
            </div>
            <p className="mt-4 whitespace-nowrap text-[13px] font-medium text-text-secondary">
              No gateway configured
            </p>
            <p className="mt-1 whitespace-nowrap text-center text-[11px] leading-relaxed text-text-ghost">
              Configure a gateway first
            </p>
          </div>
        ) : tasks.length === 0 && !showAddForm ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-surface ring-1 ring-border-default">
              <IconClock size={22} className="text-text-ghost" />
            </div>
            <p className="mt-4 whitespace-nowrap text-[13px] font-medium text-text-secondary">
              No scheduled tasks
            </p>
            <p className="mt-1 whitespace-nowrap text-center text-[11px] leading-relaxed text-text-ghost">
              Create a task to run automatically
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 p-3">
            {tasks.map((task) => (
              <div
                key={task.key}
                className="group relative rounded-lg bg-bg-surface p-3 ring-1 ring-border-default transition-colors hover:ring-border-strong"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-text-primary">
                      {task.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-tertiary">
                      {describeCron(task.schedule)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-text-ghost">
                      {task.createdAt}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(task.key)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-ghost opacity-0 transition-all hover:bg-bg-hover hover:text-accent-red group-hover:opacity-100"
                    title="Delete task"
                  >
                    <IconX size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Inline add form */}
        {showAddForm && (
          <div className="border-t border-border-subtle p-3">
            <div className="rounded-lg bg-bg-surface p-3 ring-1 ring-border-default">
              <label className="mb-1 block text-[11px] font-medium text-text-secondary">
                Task Name
              </label>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g. Daily Report"
                autoFocus
                className="mb-2 w-full rounded-md bg-bg-deep px-2.5 py-1.5 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && addName.trim()) handleAdd();
                  if (e.key === "Escape") setShowAddForm(false);
                }}
              />
              <label className="mb-1 block text-[11px] font-medium text-text-secondary">
                Cron Schedule
              </label>
              <input
                type="text"
                value={addSchedule}
                onChange={(e) => setAddSchedule(e.target.value)}
                placeholder="0 9 * * * Asia/Shanghai"
                className="mb-1 w-full rounded-md bg-bg-deep px-2.5 py-1.5 font-mono text-[11px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && addName.trim()) handleAdd();
                  if (e.key === "Escape") setShowAddForm(false);
                }}
              />
              <p className="mb-3 text-[10px] text-text-ghost">
                {describeCron(addSchedule)}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="rounded-md px-2.5 py-1 text-[11px] text-text-tertiary hover:text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!addName.trim() || saving}
                  className="inline-flex items-center gap-1 rounded-md bg-accent-emerald/15 px-2.5 py-1 text-[11px] font-medium text-accent-emerald ring-1 ring-accent-emerald/25 hover:bg-accent-emerald/25 disabled:opacity-40"
                >
                  {saving ? <IconSpinner size={11} className="animate-spin" /> : <IconPlus size={11} />}
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border-subtle p-3">
        <button
          onClick={() => setShowAddForm(true)}
          disabled={isUnconfigured || showAddForm}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-default py-2 text-[12px] font-medium text-text-tertiary transition-all hover:border-border-strong hover:bg-bg-surface hover:text-text-secondary disabled:opacity-40 disabled:hover:border-border-default disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
        >
          <IconPlus size={13} />
          Add Task
        </button>
      </div>
    </aside>
  );
}
