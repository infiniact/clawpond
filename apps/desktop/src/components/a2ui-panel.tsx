"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  IconBot,
  IconChevronDown,
  IconChevronRight,
  IconSpinner,
  IconSettings,
  IconCode,
} from "./icons";

type AgentInfo = {
  name: string;
  icon: string;
  isRunning: boolean;
  isInList: boolean;
  isAllowed: boolean;
};

type A2UIPanelProps = {
  agents: string[];
  allowedAgents: string[];
  runningAgents: Set<string>;
  agentIcons: Record<string, string>;
  agentTaskInfo?: Record<string, { text: string; startedAt: number }>;
  gatewayId: string;
  rootDir: string | null;
  onRefreshAgents?: () => void;
  onAgentIconChange?: (agentName: string, emoji: string) => void;
  onAgentClick?: (agentName: string) => void;
};

/** Elapsed time formatter */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s}s`;
}

/**
 * A2UI Panel - Agent-to-User Interface
 * Displays agent status, activity, and controls
 */
export function A2UIPanel({
  agents,
  allowedAgents,
  runningAgents,
  agentIcons,
  agentTaskInfo,
  gatewayId,
  rootDir,
  onRefreshAgents,
  onAgentIconChange,
  onAgentClick,
}: A2UIPanelProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [elapsedTimes, setElapsedTimes] = useState<Record<string, number>>({});
  const [showAddModal, setShowAddModal] = useState(false);

  // Update elapsed times every second
  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed: Record<string, number> = {};
      if (agentTaskInfo) {
        for (const [agent, data] of Object.entries(agentTaskInfo)) {
          elapsed[agent] = Math.floor((Date.now() - data.startedAt) / 1000);
        }
      }
      setElapsedTimes(elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [agentTaskInfo]);

  // Build unified agent list
  const allAgents: AgentInfo[] = agents.map((name) => ({
    name,
    icon: agentIcons[name] || "🤖",
    isRunning: runningAgents.has(name),
    isInList: true,
    isAllowed: allowedAgents.includes(name),
  }));

  const runningCount = runningAgents.size;

  const handleAddAgent = useCallback(async (name: string, emoji: string) => {
    if (!rootDir) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("add_workspace_agent", { rootDir, agentName: name });
      if (onAgentIconChange) {
        onAgentIconChange(name, emoji);
      }
      onRefreshAgents?.();
    } catch (err) {
      console.error("Failed to add workspace agent:", err);
    }
    setShowAddModal(false);
  }, [rootDir, onAgentIconChange, onRefreshAgents]);

  return (
    <div className="flex h-full flex-col bg-bg-deep">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <div className="flex items-center gap-2">
          <IconBot size={14} className="text-text-tertiary" />
          <span className="text-[12px] font-semibold text-text-primary">Agents</span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-accent-emerald/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-emerald">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-emerald" />
              {runningCount} running
            </span>
          )}
        </div>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-ghost transition-colors hover:bg-bg-hover hover:text-text-secondary"
          title="Settings"
        >
          <IconSettings size={12} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {allAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-surface ring-1 ring-border-default">
              <IconBot size={22} className="text-text-ghost" />
            </div>
            <p className="mt-4 whitespace-nowrap text-[13px] font-medium text-text-secondary">
              No agents configured
            </p>
            <p className="mt-1 whitespace-nowrap text-center text-[11px] leading-relaxed text-text-ghost">
              Add agents to your workspace
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-2">
            {/* Running agents first */}
            {allAgents
              .filter((a) => a.isRunning)
              .map((agent) => (
                <AgentCard
                  key={agent.name}
                  agent={agent}
                  expanded={expandedAgent === agent.name}
                  onToggle={() =>
                    setExpandedAgent(expandedAgent === agent.name ? null : agent.name)
                  }
                  onClick={() => onAgentClick?.(agent.name)}
                  taskInfo={agentTaskInfo?.[agent.name]}
                  elapsed={elapsedTimes[agent.name]}
                />
              ))}

            {/* Idle agents */}
            {allAgents
              .filter((a) => !a.isRunning)
              .map((agent) => (
                <AgentCard
                  key={agent.name}
                  agent={agent}
                  expanded={expandedAgent === agent.name}
                  onToggle={() =>
                    setExpandedAgent(expandedAgent === agent.name ? null : agent.name)
                  }
                  onClick={() => onAgentClick?.(agent.name)}
                />
              ))}
          </div>
        )}
      </div>

      {/* Footer - Quick actions */}
      <div className="shrink-0 border-t border-border-subtle p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-ghost">
            {allAgents.length} agent{allAgents.length !== 1 ? "s" : ""}
          </span>
          <button
            className="inline-flex items-center gap-1 rounded-md bg-bg-surface px-2 py-1 text-[11px] font-medium text-text-secondary ring-1 ring-border-default transition-colors hover:bg-bg-hover hover:text-text-primary"
            onClick={() => setShowAddModal(true)}
          >
            + New Agent
          </button>
        </div>
      </div>

      {/* Add Agent Modal */}
      {showAddModal && (
        <AddAgentModal
          onConfirm={handleAddAgent}
          onCancel={() => setShowAddModal(false)}
          existingNames={allAgents.map((a) => a.name)}
        />
      )}
    </div>
  );
}

function AgentCard({
  agent,
  expanded,
  onToggle,
  onClick,
  taskInfo,
  elapsed,
}: {
  agent: AgentInfo;
  expanded: boolean;
  onToggle: () => void;
  onClick?: () => void;
  taskInfo?: { text: string; startedAt: number };
  elapsed?: number;
}) {
  return (
    <div className="rounded-lg bg-bg-surface ring-1 ring-border-default transition-colors hover:ring-border-strong">
      {/* Agent header */}
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2"
        onClick={onToggle}
      >
        {/* Expand icon */}
        <div className="flex h-4 w-4 shrink-0 items-center justify-center text-text-ghost">
          {expanded ? (
            <IconChevronDown size={12} />
          ) : (
            <IconChevronRight size={12} />
          )}
        </div>

        {/* Agent icon */}
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[14px] ${
            agent.isRunning
              ? "bg-accent-emerald/15 ring-1 ring-accent-emerald/25"
              : "bg-bg-deep"
          }`}
        >
          {agent.icon}
        </div>

        {/* Agent name */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-medium text-text-primary">
              {agent.name}
            </span>
            {agent.isRunning && (
              <IconSpinner size={10} className="shrink-0 animate-spin text-accent-emerald" />
            )}
          </div>
        </div>

        {/* Status badge */}
        {!agent.isAllowed && (
          <span className="shrink-0 rounded bg-bg-deep px-1.5 py-0.5 text-[9px] font-medium text-text-ghost">
            disabled
          </span>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border-subtle px-3 py-2">
          <div className="flex flex-col gap-2">
            {/* Status */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-ghost">Status</span>
              <span
                className={
                  agent.isRunning ? "text-accent-emerald" : "text-text-tertiary"
                }
              >
                {agent.isRunning ? "Running" : "Idle"}
              </span>
            </div>

            {/* Task preview (only for running agents) */}
            {agent.isRunning && taskInfo && (
              <>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-ghost">Task</span>
                  <span className="text-text-tertiary">
                    &ldquo;{taskInfo.text}&rdquo;
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-ghost">Elapsed</span>
                  <span className="font-mono text-text-tertiary">
                    {elapsed != null ? formatElapsed(elapsed) : "—"}
                  </span>
                </div>
              </>
            )}

            {/* Permissions */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-ghost">Can be called</span>
              <span
                className={
                  agent.isAllowed ? "text-accent-emerald" : "text-accent-red"
                }
              >
                {agent.isAllowed ? "Yes" : "No"}
              </span>
            </div>

            {/* Quick actions */}
            <div className="mt-1 flex items-center gap-2">
              <button
                className="inline-flex items-center gap-1 rounded-md bg-bg-deep px-2 py-1 text-[10px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  // TODO: View agent logs
                }}
              >
                <IconCode size={10} />
                Logs
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md bg-bg-deep px-2 py-1 text-[10px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.();
                }}
              >
                <IconBot size={10} />
                Mention
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { EMOJI_OPTIONS, FEATURED_COUNT } from "../lib/emoji-data";

function AddAgentModal({
  onConfirm,
  onCancel,
  existingNames,
}: {
  onConfirm: (name: string, emoji: string) => void;
  onCancel: () => void;
  existingNames: string[];
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [emojiSearch, setEmojiSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const trimmed = name.trim();
  const nameError = trimmed
    ? existingNames.includes(trimmed.toLowerCase())
      ? "Name already exists"
      : /[^a-zA-Z0-9_-]/.test(trimmed)
        ? "Only letters, numbers, - and _ allowed"
        : null
    : null;

  const canConfirm = !!trimmed && !nameError;

  const filtered = emojiSearch
    ? EMOJI_OPTIONS.filter((e) =>
        e.kw.toLowerCase().includes(emojiSearch.toLowerCase()) ||
        e.emoji.includes(emojiSearch)
      )
    : showAll
      ? EMOJI_OPTIONS
      : EMOJI_OPTIONS.slice(0, FEATURED_COUNT);

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(trimmed, emoji);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <h3 className="mb-4 text-[14px] font-bold text-text-primary">
          New Workspace Agent
        </h3>

        {/* Name */}
        <label className="mb-1 block text-[11px] font-medium text-text-secondary">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-agent"
          autoFocus
          className="mb-1 w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) handleConfirm();
            if (e.key === "Escape") onCancel();
          }}
        />
        {nameError && <p className="mb-2 text-[10px] text-accent-red">{nameError}</p>}

        {/* Icon picker */}
        <label className="mb-1 block text-[11px] font-medium text-text-secondary">Icon</label>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-elevated text-[20px] ring-1 ring-border-default">
            {emoji}
          </span>
          <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-bg-elevated px-2.5 py-1.5 ring-1 ring-border-default focus-within:ring-accent-emerald/50">
            <input
              type="text"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              placeholder="Search icons..."
              className="w-full bg-transparent text-[11px] text-text-primary placeholder:text-text-ghost focus:outline-none"
            />
          </div>
        </div>
        <div className="mb-2 grid grid-cols-10 gap-1">
          {filtered.map((e) => (
            <button
              key={e.emoji}
              type="button"
              onClick={() => setEmoji(e.emoji)}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-[14px] transition-all hover:bg-bg-hover ${
                emoji === e.emoji ? "bg-accent-emerald/15 ring-1 ring-accent-emerald/30" : ""
              }`}
            >
              {e.emoji}
            </button>
          ))}
        </div>
        {!emojiSearch && !showAll && EMOJI_OPTIONS.length > FEATURED_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mb-3 w-full text-center text-[11px] font-medium text-accent-emerald hover:underline"
          >
            Show more ({EMOJI_OPTIONS.length - FEATURED_COUNT} more)
          </button>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-emerald/15 px-4 py-2 text-[12px] font-semibold text-accent-emerald ring-1 ring-accent-emerald/25 transition-all hover:bg-accent-emerald/25 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
