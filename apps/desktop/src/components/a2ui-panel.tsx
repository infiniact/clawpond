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
  onAgentClick?: (agentName: string) => void;
};

/**
 * A2UI Panel - Agent-to-User Interface
 * Displays agent status, activity, and controls
 */
export function A2UIPanel({
  agents,
  allowedAgents,
  runningAgents,
  agentIcons,
  onAgentClick,
}: A2UIPanelProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // Build unified agent list
  const allAgents: AgentInfo[] = agents.map((name) => ({
    name,
    icon: agentIcons[name] || "🤖",
    isRunning: runningAgents.has(name),
    isInList: true,
    isAllowed: allowedAgents.includes(name),
  }));

  const runningCount = runningAgents.size;

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
            onClick={() => {
              // TODO: Open agent creation modal
            }}
          >
            + New Agent
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  expanded,
  onToggle,
  onClick,
}: {
  agent: AgentInfo;
  expanded: boolean;
  onToggle: () => void;
  onClick?: () => void;
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
