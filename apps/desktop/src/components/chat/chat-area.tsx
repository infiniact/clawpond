"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrlInWindow } from "../../lib/open-url";
import type { ComposeStartProgress } from "../../lib/stores/gateway-store";
import {
  IconChat,
  IconCode,
  IconSend,
  IconBot,
  IconUser,
  IconSpinner,
  IconXCircle,
  IconShield,
  IconCheck,
  IconX,
  IconFolder,
  IconChevronDown,
  IconImage,
  IconMic,
  IconFile,
  IconCopy,
  IconShare,
} from "../icons";
import { MentionPopup } from "./mention-popup";
import { UsageHeatmap } from "../usage-heatmap";
import { ConfigWizard } from "../config/config-wizard";
import { A2UIPanel } from "../a2ui-panel";
import { OpenClawRpc } from "../../lib/rpc/openclaw-rpc";
import type { RpcEvent } from "../../lib/rpc/openclaw-rpc";
import { useRpcPool } from "../../lib/rpc/rpc-pool-context";
import { parseMentions, extractMentionContent, segmentMentions } from "../../lib/mention-utils";
import {
  loadMessages,
  saveAllMessages,
  type StoredMessage,
} from "../../lib/stores/chat-store";
import { recordUsage, estimateTokens } from "../../lib/stores/usage-store";
import { EMOJI_OPTIONS, FEATURED_COUNT } from "../../lib/emoji-data";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  streaming?: boolean;
  /** Tool call info displayed inline */
  tool?: { name: string; status: "running" | "done" | "error" };
  /** When message comes from another Gateway via @ mention */
  sourceGateway?: { id: string; name: string; emoji: string };
  /** Gateway IDs mentioned in this message */
  mentions?: string[];
  /** Agent name (workspace agent) that produced this message */
  agentName?: string;
};

type QueuedMessage = {
  id: string;
  text: string;
  images: { name: string; mediaType: string; base64: string; containerPath?: string }[];
  files: { name: string; containerPath: string }[];
};

/** Extract plain text from content that may be a string, a content block {type,text}, or an array of blocks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textOf).join("");
  if (content && typeof content === "object" && typeof content.text === "string") return content.text;
  return "";
}

/**
 * Global security officer review queue — shared across all ChatView instances.
 * Ensures only one security check runs at a time, even when multiple gateways
 * send messages concurrently.
 */
let _securityQueue: Promise<{ approved: boolean; reason?: string }> = Promise.resolve({ approved: true });
let _securityQueueOfficerId: string | undefined;

function resetSecurityQueueIfChanged(officerId: string | undefined) {
  if (_securityQueueOfficerId !== officerId) {
    _securityQueueOfficerId = officerId;
    _securityQueue = Promise.resolve({ approved: true });
  }
}

function enqueueSecurityCheck(
  fn: () => Promise<{ approved: boolean; reason?: string }>,
): Promise<{ approved: boolean; reason?: string }> {
  const queued = _securityQueue.then(fn, fn);
  _securityQueue = queued;
  return queued;
}

type ExecApproval = {
  id: string;
  command: string;
  cwd?: string;
  host?: string;
  agent?: string;
  session?: string;
  resolved?: string;
  security?: string;
  expiresAt?: number;
};

export function ChatArea({
  hidden,
  gatewayName,
  gatewayEmoji,
  gatewayId,
  configured,
  reconfiguring,
  onCloseReconfig,
  onConfigComplete,
  rootDir,
  serviceState,
  lastError,
  fixedRootDir,
  gatewayType,
  sharedDir,
  onBusyChange,
  startProgress,
  securityOfficerId,
  agents,
  allowedAgents,
  agentIcons,
  onAgentIconChange,
  onRefreshAgents,
}: {
  hidden?: boolean;
  gatewayName: string;
  gatewayEmoji: string;
  gatewayId: string;
  configured: boolean;
  reconfiguring?: boolean;
  onCloseReconfig?: () => void;
  onConfigComplete: (rootDir: string) => void;
  rootDir: string | null;
  serviceState: string;
  lastError?: string;
  fixedRootDir?: string;
  gatewayType?: "local" | "docker";
  sharedDir?: string;
  onBusyChange?: (busy: boolean) => void;
  startProgress?: ComposeStartProgress;
  securityOfficerId?: string;
  agents?: string[];
  allowedAgents?: string[];
  agentIcons?: Record<string, string>;
  onAgentIconChange?: (agentName: string, emoji: string) => void;
  onRefreshAgents?: () => void;
}) {
  const showWizard = !configured || reconfiguring;
  const showChat = configured && !reconfiguring;

  // Track which agents are currently running (reported by ChatView via RPC events)
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());
  // Track agent task info (text summary + start time) from ChatView
  const [agentTaskInfo, setAgentTaskInfo] = useState<Record<string, { text: string; startedAt: number }>>({});
  // Track agents discovered from messages but not in the workspace list
  const [discoveredAgents, setDiscoveredAgents] = useState<Set<string>>(new Set());
  const allAgents = agents && agents.length > 0
    ? [...new Set([...agents, ...discoveredAgents])]
    : [...discoveredAgents];

  // Emoji picker state for agent icon editing
  const [emojiPicker, setEmojiPicker] = useState<{ agentName: string; x: number; y: number } | null>(null);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [emojiShowAll, setEmojiShowAll] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  // Agent context menu state (shown on double-click)
  const [agentMenu, setAgentMenu] = useState<{ agentName: string; x: number; y: number } | null>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);

  // Close emoji picker or agent menu on click outside
  useEffect(() => {
    if (!emojiPicker && !agentMenu) return;
    const handler = (e: MouseEvent) => {
      if (emojiPicker && emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPicker(null);
        setEmojiSearch("");
        setEmojiShowAll(false);
      }
      if (agentMenu && agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setAgentMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [emojiPicker, agentMenu]);

  const handleAgentDoubleClick = useCallback((agentName: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAgentMenu({ agentName, x: rect.left, y: rect.bottom + 4 });
  }, []);

  const handleAgentMenuAction = useCallback(async (action: "icon" | "add" | "allow" | "disallow") => {
    if (!agentMenu) return;
    if (action === "icon") {
      setEmojiPicker({ agentName: agentMenu.agentName, x: agentMenu.x, y: agentMenu.y + 32 });
      setEmojiSearch("");
      setEmojiShowAll(false);
    } else if (action === "add" && rootDir) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("add_workspace_agent", { rootDir, agentName: agentMenu.agentName });
        setDiscoveredAgents((prev) => {
          const next = new Set(prev);
          next.delete(agentMenu.agentName);
          return next;
        });
        onRefreshAgents?.();
      } catch (err) {
        console.error("Failed to add workspace agent:", err);
      }
    } else if ((action === "allow" || action === "disallow") && rootDir) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("toggle_agent_allowed", { rootDir, agentName: agentMenu.agentName, allow: action === "allow" });
        onRefreshAgents?.();
      } catch (err) {
        console.error("Failed to toggle agent allowed:", err);
      }
    }
    setAgentMenu(null);
  }, [agentMenu, rootDir, onRefreshAgents]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    if (emojiPicker && onAgentIconChange) {
      onAgentIconChange(emojiPicker.agentName, emoji);
    }
    setEmojiPicker(null);
    setEmojiSearch("");
    setEmojiShowAll(false);
  }, [emojiPicker, onAgentIconChange]);

  const filteredEmojis = emojiSearch
    ? EMOJI_OPTIONS.filter((e) => e.kw.toLowerCase().includes(emojiSearch.toLowerCase()))
    : emojiShowAll ? EMOJI_OPTIONS : EMOJI_OPTIONS.slice(0, FEATURED_COUNT);

  return (
    <div className={`flex min-w-0 flex-1 flex-col bg-bg-base${hidden ? " hidden" : ""}`}>
      {/* ── Top bar: Agent Info Panel ── */}
      {allAgents.length > 0 && (
        <AgentInfoPanel
          allAgents={allAgents}
          runningAgents={runningAgents}
          agents={agents}
          allowedAgents={allowedAgents}
          agentIcons={agentIcons}
          gatewayId={gatewayId}
          agentTaskInfo={agentTaskInfo}
          onAgentDoubleClick={handleAgentDoubleClick}
        />
      )}

      {/* ── Top bar: Usage Heatmap (shown when no agents or always) ── */}
      <div className="relative z-10 flex h-10 shrink-0 items-center overflow-visible border-b border-border-subtle px-3">
        {showChat && (
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <UsageHeatmap gatewayId={gatewayId} />
          </div>
        )}
      </div>

      {/* Agent context menu (right-click / double-click) */}
      {agentMenu && (() => {
        const menuIsInList = agents?.includes(agentMenu.agentName);
        const menuIsAllowed = allowedAgents?.includes(agentMenu.agentName);
        return (
          <div
            ref={agentMenuRef}
            className="fixed z-[999] w-[180px] rounded-lg bg-bg-surface py-1 shadow-xl ring-1 ring-border-default"
            style={{ left: agentMenu.x, top: agentMenu.y }}
          >
            <button
              onClick={() => handleAgentMenuAction("icon")}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-hover"
            >
              <span className="text-[13px]">🎨</span>
              Change Icon
            </button>
            {!menuIsInList && (
              <button
                onClick={() => handleAgentMenuAction("add")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-accent-emerald transition-colors hover:bg-bg-hover"
              >
                <span className="text-[13px] leading-none">+</span>
                Add to Workspace
              </button>
            )}
            {menuIsInList && menuIsAllowed && (
              <button
                onClick={() => handleAgentMenuAction("disallow")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-text-ghost transition-colors hover:bg-bg-hover"
              >
                <span className="text-[13px] leading-none">−</span>
                Disallow Agent
              </button>
            )}
            {menuIsInList && !menuIsAllowed && (
              <button
                onClick={() => handleAgentMenuAction("allow")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-accent-emerald transition-colors hover:bg-bg-hover"
              >
                <span className="text-[13px] leading-none">+</span>
                Allow Agent
              </button>
            )}
          </div>
        );
      })()}

      {/* Emoji picker popup for agent icons */}
      {emojiPicker && (
        <div
          ref={emojiPickerRef}
          className="fixed z-[999] w-[280px] rounded-lg bg-bg-surface p-2 shadow-xl ring-1 ring-border-default"
          style={{ left: emojiPicker.x, top: emojiPicker.y }}
        >
          <input
            autoFocus
            type="text"
            placeholder="Search emoji..."
            value={emojiSearch}
            onChange={(e) => setEmojiSearch(e.target.value)}
            className="mb-2 w-full rounded-md bg-bg-deep px-2 py-1 text-[12px] text-text-primary ring-1 ring-border-default outline-none placeholder:text-text-ghost"
          />
          <div className="grid grid-cols-8 gap-1">
            {filteredEmojis.map((e) => (
              <button
                key={e.emoji}
                onClick={() => handleEmojiSelect(e.emoji)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[16px] transition-colors hover:bg-bg-hover"
                title={e.kw}
              >
                {e.emoji}
              </button>
            ))}
          </div>
          {!emojiSearch && !emojiShowAll && EMOJI_OPTIONS.length > FEATURED_COUNT && (
            <button
              onClick={() => setEmojiShowAll(true)}
              className="mt-1 w-full text-center text-[11px] text-text-ghost hover:text-text-secondary"
            >
              Show more...
            </button>
          )}
        </div>
      )}

      {/* ── Content ── */}
      <div className={`flex min-h-0 flex-1 flex-col ${showWizard ? "" : "hidden"}`}>
        <ConfigWizard
          onComplete={onConfigComplete}
          onClose={reconfiguring ? onCloseReconfig : undefined}
          fixedRootDir={fixedRootDir}
          gatewayType={gatewayType}
          sharedDir={sharedDir}
        />
      </div>
      {configured && (
        <SplitPane
          showChat={showChat}
          agents={allAgents}
          allowedAgents={allowedAgents || []}
          runningAgents={runningAgents}
          agentIcons={agentIcons || {}}
        >
          <ChatView rootDir={rootDir} serviceState={serviceState} lastError={lastError} startProgress={startProgress} hidden={hidden} gatewayId={gatewayId} gatewayName={gatewayName} gatewayEmoji={gatewayEmoji} gatewayType={gatewayType} onBusyChange={onBusyChange} securityOfficerId={securityOfficerId} agents={agents} agentIcons={agentIcons} onRunningAgentsChange={setRunningAgents} onDiscoveredAgentsChange={setDiscoveredAgents} onAgentTaskInfoChange={setAgentTaskInfo} />
        </SplitPane>
      )}
    </div>
  );
}

/** Dual-column split pane: left = children (chat), right = A2UI panel */
function SplitPane({
  showChat,
  agents,
  allowedAgents,
  runningAgents,
  agentIcons,
  children,
}: {
  showChat: boolean;
  agents: string[];
  allowedAgents: string[];
  runningAgents: Set<string>;
  agentIcons: Record<string, string>;
  children: React.ReactNode;
}) {
  const [leftRatio, setLeftRatio] = useState(0.6);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      setLeftRatio(Math.max(0.3, Math.min(0.75, ratio)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 flex-1 ${showChat ? "" : "hidden"}`}
    >
      {/* Left column: Chat */}
      <div className="flex min-h-0 flex-col" style={{ width: `${leftRatio * 100}%` }}>
        {children}
      </div>

      {/* Drag handle */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-border-subtle transition-colors hover:bg-accent-emerald/30"
        onMouseDown={handleMouseDown}
      />

      {/* Right column: A2UI Panel */}
      <div className="flex min-h-0 flex-1 flex-col">
        <A2UIPanel
          agents={agents}
          allowedAgents={allowedAgents}
          runningAgents={runningAgents}
          agentIcons={agentIcons}
        />
      </div>
    </div>
  );
}

/** Elapsed time formatter */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s}s`;
}

/** Agent info panel: shows agent cards with status, elapsed time, and task summary.
 *  Compact mode (default): single row of pills.
 *  Expanded mode: shows task text preview for a selected running agent.
 */
function AgentInfoPanel({
  allAgents,
  runningAgents,
  agents,
  allowedAgents,
  agentIcons,
  gatewayId,
  agentTaskInfo,
  onAgentDoubleClick,
}: {
  allAgents: string[];
  runningAgents: Set<string>;
  agents?: string[];
  allowedAgents?: string[];
  agentIcons?: Record<string, string>;
  gatewayId: string;
  agentTaskInfo: Record<string, { text: string; startedAt: number }>;
  onAgentDoubleClick: (agentName: string, e: React.MouseEvent) => void;
}) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [elapsedTimes, setElapsedTimes] = useState<Record<string, number>>({});

  // Update elapsed times every second
  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed: Record<string, number> = {};
      for (const [agent, data] of Object.entries(agentTaskInfo)) {
        elapsed[agent] = Math.floor((Date.now() - data.startedAt) / 1000);
      }
      setElapsedTimes(elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [agentTaskInfo]);

  // Sort: running agents first
  const sortedAgents = [...allAgents].sort((a, b) => {
    const aRunning = runningAgents.has(a) ? 0 : 1;
    const bRunning = runningAgents.has(b) ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return a.localeCompare(b);
  });

  const isExpanded = expandedAgent !== null;

  return (
    <div className="shrink-0 border-b border-border-subtle px-3">
      {/* Compact row */}
      <div className="flex h-10 items-center gap-1.5 overflow-x-auto">
        {sortedAgents.map((agent) => {
          const iconKey = `${gatewayId}:${agent}`;
          const icon = agentIcons?.[iconKey] || "🤖";
          const isRunning = runningAgents.has(agent);
          const isInList = agents?.includes(agent);
          const isAllowed = allowedAgents?.includes(agent);
          const elapsed = elapsedTimes[agent];
          const taskInfo = agentTaskInfo[agent];
          const isExpandedAgent = expandedAgent === agent;

          return (
            <button
              key={agent}
              className={`relative flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-bg-hover ring-1 ${isInList ? "text-text-secondary ring-border-subtle" : "text-text-ghost ring-border-subtle/50 ring-dashed"} ${isRunning ? "bg-accent-emerald/5" : ""}`}
              title={`Agent: ${agent}${isRunning ? " (running)" : ""}${isInList ? (isAllowed ? " (allowed)" : " (disabled)") : " (not in workspace)"}`}
              onClick={() => setExpandedAgent(isExpandedAgent ? null : (isRunning ? agent : null))}
              onDoubleClick={(e) => onAgentDoubleClick(agent, e)}
              onContextMenu={(e) => { e.preventDefault(); onAgentDoubleClick(agent, e); }}
            >
              <span className="relative text-[13px] leading-none">
                {icon}
                {isRunning ? (
                  <span className="absolute -right-0.5 -top-0.5 block h-[5px] w-[5px] rounded-full bg-accent-emerald ring-1 ring-bg-base animate-pulse" />
                ) : (
                  <span className={`absolute -right-0.5 -top-0.5 block h-[5px] w-[5px] rounded-full ring-1 ring-bg-base ${isInList && isAllowed ? "bg-text-ghost" : "bg-text-ghost/40"}`} />
                )}
              </span>
              <span className="max-w-[80px] truncate">{agent}</span>
              {isRunning && (
                <span className="ml-0.5 text-[10px] text-accent-emerald font-mono">
                  {elapsed != null ? formatElapsed(elapsed) : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded view: show task text preview for selected running agent */}
      {isExpanded && expandedAgent && agentTaskInfo[expandedAgent] && (
        <div className="px-1 pb-2">
          <div className="flex items-start gap-2 rounded-lg bg-bg-elevated px-3 py-2 ring-1 ring-border-subtle">
            <span className="mt-0.5 text-[12px] text-text-ghost">
              {agentIcons?.[`${gatewayId}:${expandedAgent}`] || "🤖"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-text-secondary">{expandedAgent}</span>
                <span className="flex items-center gap-1 text-[10px] text-accent-emerald">
                  <span className="inline-block h-[4px] w-[4px] rounded-full bg-accent-emerald animate-pulse" />
                  running
                </span>
                {elapsedTimes[expandedAgent] != null && (
                  <span className="text-[10px] font-mono text-text-ghost">{formatElapsed(elapsedTimes[expandedAgent])}</span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-text-tertiary">
                &ldquo;{agentTaskInfo[expandedAgent].text}&rdquo;
              </p>
            </div>
            <button
              onClick={() => setExpandedAgent(null)}
              className="shrink-0 text-[11px] text-text-ghost transition-colors hover:text-text-secondary"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function toStored(msg: Message): StoredMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp.toISOString(),
    tool: msg.tool,
    ...(msg.sourceGateway ? { sourceGateway: msg.sourceGateway } : {}),
    ...(msg.mentions ? { mentions: msg.mentions } : {}),
    ...(msg.agentName ? { agentName: msg.agentName } : {}),
  };
}

function fromStored(msg: StoredMessage): Message {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: new Date(msg.timestamp),
    tool: msg.tool,
    ...(msg.sourceGateway ? { sourceGateway: msg.sourceGateway } : {}),
    ...(msg.mentions ? { mentions: msg.mentions } : {}),
    ...(msg.agentName ? { agentName: msg.agentName } : {}),
  };
}

function ChatView({ rootDir, serviceState, lastError, startProgress, hidden, gatewayId, gatewayName, gatewayEmoji, gatewayType, onBusyChange, securityOfficerId, agents, agentIcons, onRunningAgentsChange, onDiscoveredAgentsChange, onAgentTaskInfoChange }: { rootDir: string | null; serviceState: string; lastError?: string; startProgress?: ComposeStartProgress; hidden?: boolean; gatewayId: string; gatewayName: string; gatewayEmoji: string; gatewayType?: "local" | "docker"; onBusyChange?: (busy: boolean) => void; securityOfficerId?: string; agents?: string[]; agentIcons?: Record<string, string>; onRunningAgentsChange?: (agents: Set<string>) => void; onDiscoveredAgentsChange?: (agents: Set<string>) => void; onAgentTaskInfoChange?: (info: Record<string, { text: string; startedAt: number }>) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartElapsed, setRestartElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const messageQueue = useRef<QueuedMessage[]>([]);

  // Propagate busy state to parent
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(sending);
  }, [sending]);

  // Track running subagents and propagate to parent
  const runningAgentsRef = useRef<Set<string>>(new Set());
  const onRunningAgentsChangeRef = useRef(onRunningAgentsChange);
  onRunningAgentsChangeRef.current = onRunningAgentsChange;

  // Track agent task info (text summary + start time) and elapsed times
  const [agentTaskInfo, setAgentTaskInfo] = useState<Record<string, { text: string; startedAt: number }>>({});
  const [agentElapsedTimes, setAgentElapsedTimes] = useState<Record<string, number>>({});
  const agentTaskInfoRef = useRef(agentTaskInfo);
  agentTaskInfoRef.current = agentTaskInfo;
  const onAgentTaskInfoChangeRef = useRef(onAgentTaskInfoChange);
  onAgentTaskInfoChangeRef.current = onAgentTaskInfoChange;

  // Sync agentTaskInfo to parent ChatArea
  useEffect(() => {
    onAgentTaskInfoChangeRef.current?.(agentTaskInfo);
  }, [agentTaskInfo]);

  // Timer: update elapsed times every second for running agents
  useEffect(() => {
    const timer = setInterval(() => {
      const info = agentTaskInfoRef.current;
      const elapsed: Record<string, number> = {};
      for (const [agent, data] of Object.entries(info)) {
        elapsed[agent] = Math.floor((Date.now() - data.startedAt) / 1000);
      }
      setAgentElapsedTimes(elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const markAgentRunning = useCallback((agentName: string, delta?: string) => {
    let changed = false;
    if (!runningAgentsRef.current.has(agentName)) {
      runningAgentsRef.current = new Set(runningAgentsRef.current).add(agentName);
      onRunningAgentsChangeRef.current?.(runningAgentsRef.current);
      changed = true;
    }
    // Update task info with latest text
    if (delta) {
      setAgentTaskInfo((prev) => {
        const existing = prev[agentName];
        const newText = existing ? existing.text + delta : delta;
        const text = newText.slice(0, 50);
        return { ...prev, [agentName]: { text, startedAt: existing?.startedAt || Date.now() } };
      });
    }
  }, []);
  const markAgentStopped = useCallback((agentName: string) => {
    if (runningAgentsRef.current.has(agentName)) {
      const next = new Set(runningAgentsRef.current);
      next.delete(agentName);
      runningAgentsRef.current = next;
      onRunningAgentsChangeRef.current?.(next);
    }
    // Clear task info for stopped agent
    setAgentTaskInfo((prev) => {
      const next = { ...prev };
      delete next[agentName];
      return next;
    });
  }, []);

  // Track discovered agents from RPC events and propagate to parent
  const discoveredAgentsRef = useRef<Set<string>>(new Set());
  const onDiscoveredAgentsChangeRef = useRef(onDiscoveredAgentsChange);
  onDiscoveredAgentsChangeRef.current = onDiscoveredAgentsChange;
  const markAgentDiscovered = useCallback((agentName: string) => {
    if (!discoveredAgentsRef.current.has(agentName)) {
      discoveredAgentsRef.current = new Set(discoveredAgentsRef.current).add(agentName);
      onDiscoveredAgentsChangeRef.current?.(discoveredAgentsRef.current);
    }
  }, []);

  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const THINKING_TIMEOUT_SECONDS = 30;
  const [approvalQueue, setApprovalQueue] = useState<ExecApproval[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadedOffset, setLoadedOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [imageAttachments, setImageAttachments] = useState<{ name: string; mediaType: string; base64: string; containerPath?: string }[]>([]);
  const [fileAttachments, setFileAttachments] = useState<{ name: string; containerPath: string }[]>([]);
  const [voiceListening, setVoiceListening] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // @ mention state
  const [mentionPopupOpen, setMentionPopupOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionAnchor, setMentionAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const mentionStartPos = useRef<number>(-1);
  const { pool, gateways: allGateways } = useRpcPool();
  // Refs for values needed in the event handler (which has [] deps)
  const allGatewaysRef = useRef(allGateways);
  allGatewaysRef.current = allGateways;
  const forwardRef = useRef(forwardToGateway);
  // will be assigned after forwardToGateway is defined
  const streamBuf = useRef<string>("");
  const streamMsgId = useRef<string | null>(null);
  const streamSource = useRef<"agent" | "chat" | null>(null);
  const sessionKey = useRef(`session-${Date.now().toString(36)}`);
  const rpcRef = useRef<OpenClawRpc>(new OpenClawRpc());
  const rpc = rpcRef.current;
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const maxReconnectAttempts = 10;
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const RESTART_GRACE_SECONDS = 30;

  // Security Officer: check content with the designated security officer gateway
  const securityOfficerIdRef = useRef(securityOfficerId);
  securityOfficerIdRef.current = securityOfficerId;
  const isSecurityOfficer = securityOfficerId === gatewayId;

  // Reset the global security queue when securityOfficerId changes
  resetSecurityQueueIfChanged(securityOfficerId);

  async function _doSecurityCheck(
    content: string,
  ): Promise<{ approved: boolean; reason?: string }> {
    // Read from ref to always get the latest value, not a stale closure capture
    const currentOfficerId = securityOfficerIdRef.current;
    if (!currentOfficerId || currentOfficerId === gatewayId) {
      return { approved: true };
    }
    const officerGw = allGatewaysRef.current.find((g) => g.id === currentOfficerId);
    if (!officerGw || officerGw.serviceState !== "running") {
      return { approved: true };
    }

    try {
      const officerRpc = await pool.getConnection(officerGw);
      const reviewPrompt = `[安全审查] 请审查以下用户消息。如果内容安全合规，请回复"APPROVED"。如果有问题，请回复"REJECTED: 原因"。\n\n待审查内容：\n---\n${content}\n---`;

      // Send review request and wait for the response
      const result = await officerRpc.call("chat.send", {
        sessionKey: `security-review-${Date.now().toString(36)}`,
        idempotencyKey: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message: reviewPrompt,
      });

      // Try to extract the response text
      let responseText = "";
      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        const rawContent = r.text || (r.message as Record<string, unknown>)?.content || (r.message as Record<string, unknown>)?.text || "";
        responseText = textOf(rawContent);
      }

      // If we got a direct response, parse it
      if (responseText) {
        const trimmed = responseText.trim();
        if (trimmed.startsWith("APPROVED")) {
          return { approved: true };
        }
        const rejectedMatch = trimmed.match(/^REJECTED:\s*([\s\S]*)/);
        if (rejectedMatch) {
          return { approved: false, reason: rejectedMatch[1].trim() };
        }
        // If we can't parse the response, assume approved
        return { approved: true };
      }

      // If no direct response, wait for the final event via a promise
      return new Promise<{ approved: boolean; reason?: string }>((resolve) => {
        const timeout = setTimeout(() => {
          unsub();
          resolve({ approved: true }); // timeout = allow through
        }, 30000);

        const unsub = officerRpc.onEvent((event: RpcEvent) => {
          if (event.type === "chat" && event.payload?.state === "final") {
            const msg = event.payload?.message;
            const finalContent = textOf(msg?.text || msg?.content || "");
            clearTimeout(timeout);
            unsub();

            if (finalContent) {
              const trimmedResp = finalContent.trim();
              if (trimmedResp.startsWith("APPROVED")) {
                resolve({ approved: true });
              } else {
                const match = trimmedResp.match(/^REJECTED:\s*([\s\S]*)/);
                resolve({ approved: false, reason: match?.[1]?.trim() || trimmedResp });
              }
            } else {
              resolve({ approved: true });
            }
          }
        });
      });
    } catch (e) {
      console.error("[security-officer] check failed:", e);
      return { approved: true }; // fail open
    }
  }

  // Queued wrapper: ensures security checks are serialized globally across all gateways
  function checkWithSecurityOfficer(
    content: string,
  ): Promise<{ approved: boolean; reason?: string }> {
    return enqueueSecurityCheck(() => _doSecurityCheck(content));
  }

  // Thinking timer: track elapsed time while sending, trigger timeout
  useEffect(() => {
    if (sending && !streamMsgId.current) {
      setThinkingElapsed(0);
      setTimedOut(false);
      const start = Date.now();
      thinkingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        setThinkingElapsed(elapsed);
        if (elapsed >= THINKING_TIMEOUT_SECONDS) {
          setTimedOut(true);
        }
      }, 1000);
    } else {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setThinkingElapsed(0);
      setTimedOut(false);
    }
    return () => {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    };
  }, [sending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear thinking timer when stream starts (first streaming message arrives)
  const hasStreamingMsg = messages.some((m) => m.streaming);
  useEffect(() => {
    if (hasStreamingMsg && thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
      setTimedOut(false);
      setThinkingElapsed(0);
    }
  }, [hasStreamingMsg]);

  // Track whether we need to scroll to bottom after initial load
  const needsInitialScroll = useRef(false);

  // Load persisted messages on mount / rootDir change
  useEffect(() => {
    if (!rootDir) return;
    (async () => {
      const { messages: stored, hasMore: more } = await loadMessages(rootDir, 0);
      setMessages(stored.map(fromStored));
      setHasMore(more);
      setLoadedOffset(stored.length);
      needsInitialScroll.current = true;
    })();
  }, [rootDir]);

  // Scroll to bottom after messages are rendered on initial load.
  // Markdown rendering and image loading can delay layout, so retry until
  // scrollHeight actually exceeds clientHeight (i.e. content is painted).
  useEffect(() => {
    if (!needsInitialScroll.current || messages.length === 0) return;
    // If hidden, don't consume the flag — wait until we become visible
    if (hidden) return;
    needsInitialScroll.current = false;

    let attempts = 0;
    const maxAttempts = 10;

    function tryScroll() {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      // If content hasn't been laid out yet, retry
      if (el.scrollHeight <= el.clientHeight && attempts < maxAttempts) {
        attempts++;
        requestAnimationFrame(tryScroll);
      }
    }

    requestAnimationFrame(tryScroll);
  }, [messages, hidden]);

  // Persist messages on change (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!rootDir || messages.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Only save non-streaming messages
      const toSave = messages.filter((m) => !m.streaming).map(toStored);
      saveAllMessages(rootDir, toSave);
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [messages, rootDir]);

  // Load more (older) messages
  const handleLoadMore = useCallback(async () => {
    if (!rootDir || !hasMore || loadingMore) return;
    setLoadingMore(true);
    const scrollEl = scrollRef.current;
    const prevScrollHeight = scrollEl?.scrollHeight || 0;

    const { messages: older, hasMore: more } = await loadMessages(rootDir, loadedOffset);
    setMessages((prev) => {
      // Deduplicate by id
      const existingIds = new Set(prev.map((m) => m.id));
      const newMsgs = older.map(fromStored).filter((m) => !existingIds.has(m.id));
      return [...newMsgs, ...prev];
    });
    setHasMore(more);
    setLoadedOffset((prev) => prev + older.length);
    setLoadingMore(false);

    // Preserve scroll position after prepending
    requestAnimationFrame(() => {
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight - prevScrollHeight;
      }
    });
  }, [rootDir, hasMore, loadedOffset, loadingMore]);

  // Enter the "gateway restarting" grace period — suppresses error display for up to RESTART_GRACE_SECONDS
  const enterRestartGrace = useCallback(() => {
    // Already in restart grace — don't reset the counter
    if (restartTickRef.current) return;

    // Clear any previous timeout
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);

    setRestarting(true);
    setRestartElapsed(0);
    setConnError(null);

    // Tick every second to update elapsed counter
    const start = Date.now();
    restartTickRef.current = setInterval(() => {
      setRestartElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    // After grace period, give up and show the error
    restartTimeoutRef.current = setTimeout(() => {
      if (restartTickRef.current) clearInterval(restartTickRef.current);
      restartTickRef.current = null;
      setRestarting(false);
      setConnError("Gateway failed to restart within the timeout period");
    }, RESTART_GRACE_SECONDS * 1000);
  }, [RESTART_GRACE_SECONDS]);

  const exitRestartGrace = useCallback(() => {
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null; }
    if (restartTickRef.current) { clearInterval(restartTickRef.current); restartTickRef.current = null; }
    setRestarting(false);
    setRestartElapsed(0);
  }, []);

  // Cleanup restart timers on unmount
  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (restartTickRef.current) clearInterval(restartTickRef.current);
    };
  }, []);

  // Auto-scroll on new messages or approval changes
  useEffect(() => {
    if (hidden) return;
    // Use requestAnimationFrame to ensure DOM has updated before scrolling
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, [messages, approvalQueue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when becoming visible (e.g. switching gateways)
  // Elements with display:none have scrollHeight=0, so retry after layout
  const prevHiddenRef = useRef(hidden);
  useEffect(() => {
    const wasHidden = prevHiddenRef.current;
    prevHiddenRef.current = hidden;
    if (wasHidden && !hidden) {
      let attempts = 0;
      function tryScroll() {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
        if (el.scrollHeight <= el.clientHeight && attempts < 10) {
          attempts++;
          requestAnimationFrame(tryScroll);
        }
      }
      requestAnimationFrame(tryScroll);
    }
  }, [hidden]);

  // Disconnect on unmount
  useEffect(() => {
    const instance = rpcRef.current;
    return () => {
      instance.disconnect();
    };
  }, []);

  // Connect to gateway WebSocket when service is running
  const connectRpc = useCallback(async () => {
    console.log(`[connectRpc] called: rootDir=${rootDir}, serviceState=${serviceState}, rpc.connected=${rpc.connected}`);
    if (!rootDir || serviceState !== "running") {
      console.log("[connectRpc] bail: rootDir/serviceState not ready");
      return;
    }

    // Already connected
    if (rpc.connected) {
      setConnected(true);
      return;
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ port: string; token: string }>("read_gateway_info", { rootDir });
    const host = "127.0.0.1";
    const port = info.port;
    const token = info.token;

    setConnecting(true);
    setConnError(null);
    try {
      console.log(`[connectRpc] connecting to ${host}:${port} (rootDir=${rootDir}, token=${token ? token.slice(0, 4) + "***" : "none"})`);
      await rpc.connect(port, token, host);
      setConnected(true);
      imageSupport.current = "unknown"; // re-probe on new connection
      reconnectAttempt.current = 0;
      exitRestartGrace();

      setMessages((prev) => {
        // Only add welcome if no messages or first connect
        if (prev.length === 0 || prev[prev.length - 1]?.role === "system") {
          return [...prev, {
            id: `welcome-${Date.now()}`,
            role: "assistant" as const,
            content: reconnectAttempt.current > 0
              ? "Reconnected to OpenClaw Gateway."
              : "Connected to OpenClaw Gateway. How can I help you?",
            timestamp: new Date(),
          }];
        }
        return prev;
      });
    } catch (e) {
      // During restart grace period, suppress the error — just keep retrying
      if (!restarting) {
        setConnError(typeof e === "string" ? e : (e as Error)?.message || "Failed to connect");
      }
      setConnected(false);
      // Schedule reconnect via ref to avoid circular dependency
      scheduleReconnectRef.current();
    } finally {
      setConnecting(false);
    }
  }, [rootDir, serviceState, restarting, exitRestartGrace]);

  // Schedule auto-reconnect with exponential backoff (use ref to break circular dep)
  const scheduleReconnectRef = useRef(() => {});
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (reconnectAttempt.current >= maxReconnectAttempts) return;

    // During restart grace, use shorter intervals (2s) for faster recovery
    const delay = restarting
      ? 2000
      : Math.min(2000 * Math.pow(1.5, reconnectAttempt.current), 30000);
    reconnectAttempt.current++;

    reconnectTimer.current = setTimeout(() => {
      if (!rpc.connected && serviceState === "running") {
        connectRpc();
      }
    }, delay);
  }, [connectRpc, serviceState, restarting]);
  scheduleReconnectRef.current = scheduleReconnect;

  // Handle disconnects — enter restart grace period, then auto-reconnect
  useEffect(() => {
    const unsub = rpc.onDisconnect((reason) => {
      setConnected(false);
      finishSending();
      // Clear running agents on disconnect
      if (runningAgentsRef.current.size > 0) {
        runningAgentsRef.current = new Set();
        onRunningAgentsChangeRef.current?.(runningAgentsRef.current);
      }
      if (serviceState === "running") {
        // Enter restart grace period — show "restarting" instead of error
        enterRestartGrace();
        scheduleReconnect();
      } else {
        setConnError(reason);
      }
    });
    return unsub;
  }, [scheduleReconnect, serviceState, enterRestartGrace]);

  // Initial connect + reconnect on service state change
  useEffect(() => {
    if (serviceState === "running" && !connected && !connecting) {
      // If we had a previous connection (connError set), this is likely a restart
      if (connError || restarting) {
        enterRestartGrace();
        reconnectAttempt.current = 0;
      }
      connectRpc();
    }
    if (serviceState !== "running") {
      // Service stopped, clear reconnect and restart grace
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      reconnectAttempt.current = 0;
      exitRestartGrace();
    }
    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };
  }, [serviceState, connectRpc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for all server-push events
  useEffect(() => {
    const unsub = rpc.onEvent((event: RpcEvent) => {
      // Debug: log non-heartbeat events
      if (event.type !== "health" && event.type !== "tick" && event.type !== "heartbeat") {
        console.log("[chat] event:", event.type, event.payload?.stream || event.payload?.state || "", "| streamMsgId:", streamMsgId.current, "| source:", streamSource.current);
      }

      // ── Agent stream: assistant text deltas ──
      if (event.type === "agent" && event.payload?.stream === "assistant") {
        const delta = event.payload?.data?.delta || "";
        if (typeof delta === "string" && delta) {
          streamBuf.current += delta;
          const msgId = streamMsgId.current || `stream-${Date.now()}`;
          // Try to extract agent name from event payload
          const eventAgent = event.payload?.agent || event.payload?.agentId || event.payload?.workspace || event.payload?.data?.agent || event.payload?.data?.workspace;
          const resolvedAgent: string | undefined = typeof eventAgent === "string" && eventAgent ? eventAgent : undefined;
          if (resolvedAgent) {
            markAgentRunning(resolvedAgent, delta);
            markAgentDiscovered(resolvedAgent);
          }
          if (!streamMsgId.current) {
            streamMsgId.current = msgId;
            streamSource.current = "agent";
            console.log("[chat] >>> AGENT CREATE msg:", msgId);
            setMessages((prev) => [...prev, {
              id: msgId,
              role: "assistant",
              content: streamBuf.current,
              timestamp: new Date(),
              streaming: true,
              agentName: resolvedAgent,
            }]);
          } else {
            setMessages((prev) => prev.map((m) =>
              m.id === msgId ? { ...m, content: streamBuf.current, ...(resolvedAgent && !m.agentName ? { agentName: resolvedAgent } : {}) } : m
            ));
          }
        }
      }

      // ── Agent stream: tool events ──
      if (event.type === "agent" && event.payload?.stream === "tool") {
        const data = event.payload?.data;
        if (data) {
          const toolName = data.name || data.tool || "tool";
          // Tool start
          if (data.phase === "start" || data.status === "start") {
            setMessages((prev) => [...prev, {
              id: `tool-${Date.now()}`,
              role: "system",
              content: "",
              timestamp: new Date(),
              tool: { name: toolName, status: "running" },
            }]);
          }
          // Tool end
          if (data.phase === "end" || data.status === "end" || data.phase === "done") {
            setMessages((prev) => {
              const idx = [...prev].reverse().findIndex((m) => m.tool?.name === toolName && m.tool?.status === "running");
              if (idx === -1) return prev;
              const realIdx = prev.length - 1 - idx;
              return prev.map((m, i) => i === realIdx ? { ...m, tool: { name: toolName, status: "done" } } : m);
            });
          }
          // Tool error
          if (data.phase === "error" || data.status === "error") {
            setMessages((prev) => {
              const idx = [...prev].reverse().findIndex((m) => m.tool?.name === toolName && m.tool?.status === "running");
              if (idx === -1) return prev;
              const realIdx = prev.length - 1 - idx;
              return prev.map((m, i) => i === realIdx ? { ...m, tool: { name: toolName, status: "error" } } : m);
            });
          }
        }
      }

      // ── Agent stream: lifecycle ──
      if (event.type === "agent" && event.payload?.stream === "lifecycle") {
        if (event.payload?.data?.phase === "end" || event.payload?.data?.phase === "error") {
          console.log("[chat] >>> AGENT LIFECYCLE END | streamMsgId:", streamMsgId.current);
          // Mark agent as stopped
          const lifecycleAgent = event.payload?.agent || event.payload?.agentId || event.payload?.workspace || event.payload?.data?.agent || event.payload?.data?.workspace;
          if (typeof lifecycleAgent === "string" && lifecycleAgent) markAgentStopped(lifecycleAgent);
          const msgId = streamMsgId.current;
          if (msgId) {
            setMessages((prev) => prev.map((m) =>
              m.id === msgId ? { ...m, streaming: false } : m
            ));
          }
          // Don't clear streamMsgId here — let chat.final handle cleanup
          // so it can match the existing message instead of creating a duplicate.
          // Only stop the sending indicator; if chat.final never arrives,
          // a safety timeout will clean up.
          finishSending();
          // Safety: if chat.final doesn't arrive within 5s, clean up refs
          const staleId = streamMsgId.current;
          setTimeout(() => {
            if (streamMsgId.current === staleId && staleId) {
              streamBuf.current = "";
              streamMsgId.current = null;
              streamSource.current = null;
            }
          }, 5000);
        }
      }

      // ── Chat final message ──
      // Skip if we're already tracking via agent stream (avoids duplicate)
      if (event.type === "chat" && event.payload?.state === "final") {
        const msg = event.payload?.message;
        const content = textOf(msg?.text || msg?.content || "");
        const msgId = streamMsgId.current;
        console.log("[chat] >>> CHAT FINAL | streamMsgId:", msgId, "| role:", msg?.role, "| hasContent:", !!content);
        if (msgId) {
          // Agent stream already created the message — just finalize it
          console.log("[chat] >>> CHAT FINAL: finalize existing msg:", msgId);
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, content: content || m.content, streaming: false } : m
          ));
        } else if (content && msg?.role === "assistant") {
          console.log("[chat] >>> CHAT FINAL: CREATE new msg (no streamMsgId)");
          setMessages((prev) => [...prev, {
            id: `a-${Date.now()}`,
            role: "assistant",
            content,
            timestamp: new Date(),
          }]);
        }
        streamBuf.current = "";
        streamMsgId.current = null;
        streamSource.current = null;
        finishSending();

        // Track token usage
        if (content) {
          const usage = event.payload?.usage;
          const tokens = usage?.total_tokens || estimateTokens(content);
          recordUsage(gatewayId, tokens);
        }

        // Auto-@ detection: check if the AI reply mentions other gateways
        if (content && msg?.role === "assistant") {
          const gws = allGatewaysRef.current;
          const autoMentions = parseMentions(content, gws);
          const autoContent = extractMentionContent(content, gws);
          if (autoMentions.length > 0 && autoContent) {
            for (const autoId of autoMentions) {
              if (autoId === gatewayId) continue;
              const autoGw = gws.find((g) => g.id === autoId);
              if (autoGw && autoGw.serviceState === "running") {
                forwardRef.current(autoGw, autoContent, 0);
              }
            }
          }
        }
      }

      // ── Chat delta (block streaming) ──
      // Skip if agent stream is the active source (agent deltas already handle updates)
      if (event.type === "chat" && event.payload?.state === "delta") {
        if (streamSource.current === "agent") {
          // Agent stream is handling this — skip chat delta to avoid duplication
          console.log("[chat] >>> CHAT DELTA: skipped (agent source)");
        } else {
          const delta = textOf(event.payload?.message?.text || event.payload?.message?.content || "");
          if (delta) {
            streamBuf.current += delta;
            const msgId = streamMsgId.current || `stream-${Date.now()}`;
            if (!streamMsgId.current) {
              streamMsgId.current = msgId;
              streamSource.current = "chat";
              setMessages((prev) => [...prev, {
                id: msgId,
                role: "assistant",
                content: streamBuf.current,
                timestamp: new Date(),
                streaming: true,
              }]);
            } else {
              setMessages((prev) => prev.map((m) =>
                m.id === msgId ? { ...m, content: streamBuf.current } : m
              ));
            }
          }
        }
      }

      // ── Chat error ──
      if (event.type === "chat" && event.payload?.state === "error") {
        const errMsg = textOf(event.payload?.error || event.payload?.message?.text || "Agent error");
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`,
          role: "system",
          content: `Error: ${errMsg}`,
          timestamp: new Date(),
        }]);
        streamBuf.current = "";
        streamMsgId.current = null;
        streamSource.current = null;
        finishSending();
      }

      // ── Chat aborted ──
      if (event.type === "chat" && event.payload?.state === "aborted") {
        const msgId = streamMsgId.current;
        if (msgId) {
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, streaming: false, content: m.content + " [aborted]" } : m
          ));
        }
        streamBuf.current = "";
        streamMsgId.current = null;
        streamSource.current = null;
        finishSending();
      }

      // ── Exec approval requested ──
      if (event.type === "exec.approval.requested") {
        const p = event.payload || {};
        setApprovalQueue((prev) => [...prev, {
          id: p.id || p.approvalId || `approval-${Date.now()}`,
          command: p.command || p.rawCommand || p.argv?.join(" ") || "unknown command",
          cwd: p.cwd,
          host: p.host,
          agent: p.agentId || p.agent,
          session: p.sessionKey || p.session,
          resolved: p.resolved || p.resolvedPath,
          security: p.security,
          expiresAt: p.expiresAt,
        }]);
      }

      // ── Exec finished / denied (system messages) ──
      if (event.type === "exec.finished" || event.type === "exec.denied") {
        const p = event.payload || {};
        const status = event.type === "exec.finished" ? "completed" : "denied";
        setMessages((prev) => [...prev, {
          id: `exec-${Date.now()}`,
          role: "system",
          content: `Exec ${status}: ${p.command || p.runId || ""}`,
          timestamp: new Date(),
        }]);
      }

      // ── Presence / health / tick — ignored for chat UI ──
    });

    return unsub;
  }, []);

  // Exec approval handler
  async function handleApprovalDecision(id: string, decision: "allow-once" | "allow-always" | "deny") {
    setApprovalBusy(true);
    try {
      await rpc.call("exec.approval.resolve", { id, decision });
      setApprovalQueue((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      const errMsg = typeof e === "string" ? e : (e as { message?: string })?.message || "Approval failed";
      setMessages((prev) => [...prev, {
        id: `err-${Date.now()}`,
        role: "system",
        content: `Approval error: ${errMsg}`,
        timestamp: new Date(),
      }]);
    } finally {
      setApprovalBusy(false);
    }
  }

  // Gateway image support capability — probed once per connection
  const imageSupport = useRef<"unknown" | "content" | "attachments" | "none">("unknown");

  async function probeImageSupport(): Promise<"content" | "attachments" | "none"> {
    if (imageSupport.current !== "unknown") return imageSupport.current;

    // Try chat.capabilities RPC (if gateway supports it)
    try {
      const caps = await rpc.call("chat.capabilities", {}) as Record<string, unknown>;
      if (caps?.images || caps?.multimodal || caps?.contentBlocks) {
        imageSupport.current = "content";
        return "content";
      }
    } catch { /* not supported, probe manually */ }

    // Probe: try sending content blocks to a no-op test
    try {
      await rpc.call("chat.send", {
        sessionKey: `probe-${Date.now()}`,
        idempotencyKey: `probe-${Date.now()}`,
        content: [{ type: "text", text: "ping" }],
      });
      imageSupport.current = "content";
      return "content";
    } catch {
      // Gateway rejected `content` param — no image support
      imageSupport.current = "none";
      return "none";
    }
  }

  // Forward a message to another gateway via the RPC pool
  async function forwardToGateway(
    targetGw: { id: string; name: string; emoji: string; serviceState: string; rootDir: string | null; remoteHost?: string; remotePort?: string; remoteToken?: string },
    content: string,
    depth: number
  ) {
    if (depth > 0) return; // prevent circular forwarding

    try {
      const remoteRpc = await pool.getConnection(targetGw);

      // Create a placeholder streaming message from the target gateway
      const msgId = `fwd-${targetGw.id}-${Date.now()}`;
      let fwdBuf = "";

      setMessages((prev) => [...prev, {
        id: msgId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        streaming: true,
        sourceGateway: { id: targetGw.id, name: targetGw.name, emoji: targetGw.emoji },
      }]);

      // Listen for streaming events from the target gateway
      const unsub = remoteRpc.onEvent((event: RpcEvent) => {
        // Agent stream
        if (event.type === "agent" && event.payload?.stream === "assistant") {
          const delta = event.payload?.data?.delta || "";
          if (typeof delta === "string" && delta) {
            fwdBuf += delta;
            setMessages((prev) => prev.map((m) =>
              m.id === msgId ? { ...m, content: fwdBuf } : m
            ));
          }
        }
        // Chat delta
        if (event.type === "chat" && event.payload?.state === "delta") {
          const delta = textOf(event.payload?.message?.text || event.payload?.message?.content || "");
          if (delta) {
            fwdBuf += delta;
            setMessages((prev) => prev.map((m) =>
              m.id === msgId ? { ...m, content: fwdBuf } : m
            ));
          }
        }
        // Chat final
        if (event.type === "chat" && event.payload?.state === "final") {
          const msg = event.payload?.message;
          const finalContent = textOf(msg?.text || msg?.content || "");
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, content: finalContent || fwdBuf || m.content, streaming: false } : m
          ));
          unsub();

          // Check for auto-@ mentions in the AI reply (depth=1 forward only)
          if (finalContent) {
            const autoMentions = parseMentions(finalContent, allGateways);
            const autoContent = extractMentionContent(finalContent, allGateways);
            if (autoMentions.length > 0 && autoContent) {
              for (const autoId of autoMentions) {
                if (autoId === gatewayId || autoId === targetGw.id) continue;
                const autoGw = allGateways.find((g) => g.id === autoId);
                if (autoGw && autoGw.serviceState === "running") {
                  forwardToGateway(autoGw, autoContent, depth + 1);
                }
              }
            }
          }
        }
        // Chat error
        if (event.type === "chat" && event.payload?.state === "error") {
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, content: `Error from ${targetGw.name}: ${textOf(event.payload?.error || "unknown error")}`, streaming: false } : m
          ));
          unsub();
        }
        // Agent lifecycle end
        if (event.type === "agent" && event.payload?.stream === "lifecycle") {
          if (event.payload?.data?.phase === "end" || event.payload?.data?.phase === "error") {
            setMessages((prev) => prev.map((m) =>
              m.id === msgId ? { ...m, streaming: false } : m
            ));
            // Don't unsub — wait for chat.final
            setTimeout(() => unsub(), 5000);
          }
        }
      });

      // Send the message
      const fwdSessionKey = `fwd-${gatewayId}-${Date.now().toString(36)}`;
      const fwdResult = await remoteRpc.call("chat.send", {
        sessionKey: fwdSessionKey,
        idempotencyKey: `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message: content,
      });

      // Handle direct response (non-streaming gateways)
      if (fwdResult && typeof fwdResult === "object") {
        const r = fwdResult as Record<string, unknown>;
        const rawContent = r.text || (r.message as Record<string, unknown>)?.content || (r.message as Record<string, unknown>)?.text || "";
        const replyText = textOf(rawContent);
        if (replyText) {
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, content: replyText, streaming: false } : m
          ));
          unsub();
        }
      }
    } catch (e) {
      const errMsg = typeof e === "string" ? e : (e as { message?: string })?.message || "Forward failed";
      setMessages((prev) => [...prev, {
        id: `fwd-err-${targetGw.id}-${Date.now()}`,
        role: "system",
        content: `Failed to forward to ${targetGw.emoji} ${targetGw.name}: ${errMsg}`,
        timestamp: new Date(),
      }]);
    }
  }
  forwardRef.current = forwardToGateway;

  // ── Message queue: merge and send queued messages ──

  function mergeQueuedMessages(queue: QueuedMessage[]): QueuedMessage {
    return {
      id: `merged-${Date.now()}`,
      text: queue.map((q) => q.text).filter(Boolean).join("\n\n"),
      images: queue.flatMap((q) => q.images),
      files: queue.flatMap((q) => q.files),
    };
  }

  /** Send a message directly (bypasses queue check). Used for merged queued messages. */
  async function sendDirect(merged: QueuedMessage) {
    const text = merged.text.trim();
    const images = merged.images;
    const files = merged.files;
    if (!text && images.length === 0 && files.length === 0) return;

    // Append file paths
    const fileSuffix = files.length > 0
      ? "\n\n" + files.map((f) => `[File: ${f.containerPath}]`).join("\n")
      : "";
    const imagePaths = images.filter((img) => img.containerPath);
    const imageFileSuffix = imagePaths.length > 0
      ? "\n\n" + imagePaths.map((img) => `[Image: ${img.containerPath}]`).join("\n")
      : "";
    const fullText = (text + fileSuffix + imageFileSuffix).trim();

    // Build display content
    const filePart = files.length > 0 ? `[${files.length} file(s)]` : "";
    const imgPart = images.length > 0 ? `[${images.length} image(s)]` : "";
    const attachParts = [imgPart, filePart].filter(Boolean).join(" ");
    const displayContent = attachParts
      ? (text ? `${attachParts} ${text}` : attachParts)
      : text;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: displayContent,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setSending(true);
    streamBuf.current = "";
    streamMsgId.current = null;
    streamSource.current = null;

    recordUsage(gatewayId, estimateTokens(fullText));

    const idempotencyKey = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseParams = {
      sessionKey: sessionKey.current,
      idempotencyKey,
    };

    try {
      let result: unknown;

      if (images.length > 0) {
        const support = await probeImageSupport();
        if (support === "content") {
          const contentBlocks: object[] = images.map((img) => ({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.base64 },
          }));
          contentBlocks.push({ type: "text", text: fullText || "Please describe this image." });
          result = await rpc.call("chat.send", { ...baseParams, content: contentBlocks });
        } else {
          result = await rpc.call("chat.send", { ...baseParams, message: fullText || "Please describe this image." });
        }
      } else {
        result = await rpc.call("chat.send", { ...baseParams, message: fullText });
      }

      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        const rawContent = r.text || (r.message as Record<string, unknown>)?.content || (r.message as Record<string, unknown>)?.text || "";
        const replyText = textOf(rawContent);
        if (replyText) {
          setMessages((prev) => [...prev, {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: replyText,
            timestamp: new Date(),
          }]);
          finishSending();
        }
      }
    } catch (e) {
      const errMsg = typeof e === "string" ? e : (e as { message?: string })?.message || "Send failed";
      setMessages((prev) => [...prev, {
        id: `err-${Date.now()}`,
        role: "system",
        content: `Error: ${errMsg}`,
        timestamp: new Date(),
      }]);
      finishSending();
    }
  }

  /** Replace setSending(false) — checks queue and auto-sends merged messages. */
  function finishSending() {
    setSending(false);
    if (messageQueue.current.length > 0) {
      const merged = mergeQueuedMessages(messageQueue.current);
      messageQueue.current = [];
      requestAnimationFrame(() => sendDirect(merged));
    }
  }

  async function handleSend() {
    const text = input.trim();
    const images = [...imageAttachments];
    const files = [...fileAttachments];
    if (!text && images.length === 0 && files.length === 0) return;

    // If currently sending, enqueue the message instead of blocking
    if (sending) {
      const queued: QueuedMessage = {
        id: `q-${Date.now()}`,
        text,
        images,
        files,
      };
      messageQueue.current = [...messageQueue.current, queued];

      // Show queued message in UI as a normal user message
      const filePart = files.length > 0 ? `[${files.length} file(s)]` : "";
      const imgPart = images.length > 0 ? `[${images.length} image(s)]` : "";
      const attachParts = [imgPart, filePart].filter(Boolean).join(" ");
      const displayContent = attachParts
        ? (text ? `${attachParts} ${text}` : attachParts)
        : text;

      setMessages((prev) => [...prev, {
        id: queued.id,
        role: "user",
        content: displayContent,
        timestamp: new Date(),
      }]);
      setInput("");
      setImageAttachments([]);
      setFileAttachments([]);
      return;
    }

    // Append file paths to the message text so the agent knows where to find them
    const fileSuffix = files.length > 0
      ? "\n\n" + files.map((f) => `[File: ${f.containerPath}]`).join("\n")
      : "";
    // Append image container paths as fallback references
    const imagePaths = images.filter((img) => img.containerPath);
    const imageFileSuffix = imagePaths.length > 0
      ? "\n\n" + imagePaths.map((img) => `[Image: ${img.containerPath}]`).join("\n")
      : "";
    const fullText = (text + fileSuffix + imageFileSuffix).trim();

    // Build content for local UI display
    const filePart = files.length > 0 ? `[${files.length} file(s)]` : "";
    const imgPart = images.length > 0 ? `[${images.length} image(s)]` : "";
    const attachParts = [imgPart, filePart].filter(Boolean).join(" ");
    const displayContent = attachParts
      ? (text ? `${attachParts} ${text}` : attachParts)
      : text;

    // Detect @ mentions — if present, only forward to mentioned gateways, do NOT send to self
    const mentionedIds = parseMentions(fullText, allGateways).filter((id) => id !== gatewayId);
    const isMentionOnly = mentionedIds.length > 0;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: displayContent,
      timestamp: new Date(),
      mentions: mentionedIds.length > 0 ? mentionedIds : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setImageAttachments([]);
    setFileAttachments([]);

    if (isMentionOnly) {
      // @ mention mode: only forward to mentioned gateways, skip current gateway
      const forwardContent = extractMentionContent(fullText, allGateways);
      if (!forwardContent) {
        // Nothing left after stripping mentions
        setMessages((prev) => [...prev, {
          id: `sys-${Date.now()}`,
          role: "system",
          content: "No message content after removing @mentions",
          timestamp: new Date(),
        }]);
        return;
      }

      for (const targetId of mentionedIds) {
        const targetGw = allGateways.find((g) => g.id === targetId);
        if (!targetGw) continue;
        if (targetGw.serviceState !== "running") {
          setMessages((prev) => [...prev, {
            id: `sys-${Date.now()}-${targetId}`,
            role: "system",
            content: `${targetGw.emoji} ${targetGw.name} is not running — message not forwarded`,
            timestamp: new Date(),
          }]);
          continue;
        }
        forwardToGateway(targetGw, forwardContent, 0);
      }
      return;
    }

    // Normal send to current gateway (no @ mentions)

    // Security Officer: check user message before sending
    const currentOfficerId = securityOfficerIdRef.current;
    if (currentOfficerId && currentOfficerId !== gatewayId) {
      const reviewMsgId = `sec-review-${Date.now()}`;
      setMessages((prev) => [...prev, {
        id: reviewMsgId,
        role: "system",
        content: "🛡️ Security review in progress...",
        timestamp: new Date(),
      }]);

      const result = await checkWithSecurityOfficer(fullText);

      // Remove the "in progress" message
      setMessages((prev) => prev.filter((m) => m.id !== reviewMsgId));

      if (!result.approved) {
        // Show rejection as security officer speaking
        const officerGw = allGatewaysRef.current.find((g) => g.id === currentOfficerId);
        setMessages((prev) => [...prev, {
          id: `sec-blocked-${Date.now()}`,
          role: "assistant",
          content: result.reason || "Content not approved",
          timestamp: new Date(),
          sourceGateway: officerGw
            ? { id: officerGw.id, name: officerGw.name, emoji: officerGw.emoji }
            : { id: currentOfficerId, name: "Security Officer", emoji: "🛡️" },
        }]);
        return;
      }
    }

    setSending(true);
    streamBuf.current = "";
    streamMsgId.current = null;
    streamSource.current = null;

    // Track user message tokens
    recordUsage(gatewayId, estimateTokens(fullText));

    const idempotencyKey = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseParams = {
      sessionKey: sessionKey.current,
      idempotencyKey,
    };

    try {
      let result: unknown;

      if (images.length > 0) {
        // Probe Gateway image support (cached after first call)
        const support = await probeImageSupport();

        if (support === "content") {
          // Gateway supports content blocks — send multimodal
          const contentBlocks: object[] = images.map((img) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType,
              data: img.base64,
            },
          }));
          contentBlocks.push({ type: "text", text: fullText || "Please describe this image." });

          result = await rpc.call("chat.send", {
            ...baseParams,
            content: contentBlocks,
          });
        } else {
          // Gateway does NOT support multimodal — send text with file paths as fallback
          result = await rpc.call("chat.send", {
            ...baseParams,
            message: fullText || "Please describe this image.",
          });
          if (imagePaths.length === 0) {
            // No container paths available — images are truly lost
            setMessages((prev) => [...prev, {
              id: `warn-${Date.now()}`,
              role: "system",
              content: "⚠ Current Gateway does not support image attachments. Only text was sent. Please upgrade your OpenClaw Gateway to enable multimodal support.",
              timestamp: new Date(),
            }]);
          }
        }
      } else {
        result = await rpc.call("chat.send", {
          ...baseParams,
          message: fullText,
        });
      }

      console.log("[chat] chat.send response:", result);

      // Some gateway versions return the reply directly in the RPC response
      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        // Extract reply — could be string, ContentBlock, or ContentBlock[]
        const rawContent = r.text || (r.message as Record<string, unknown>)?.content || (r.message as Record<string, unknown>)?.text || "";
        const replyText = textOf(rawContent);
        if (replyText) {
          console.log("[chat] >>> SEND RESPONSE: CREATE msg from RPC result, streamMsgId:", streamMsgId.current);
          setMessages((prev) => [...prev, {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: replyText,
            timestamp: new Date(),
          }]);
          finishSending();
        }
      }
    } catch (e) {
      const errMsg = typeof e === "string" ? e : (e as { message?: string })?.message || "Send failed";
      setMessages((prev) => [...prev, {
        id: `err-${Date.now()}`,
        role: "system",
        content: `Error: ${errMsg}`,
        timestamp: new Date(),
      }]);
      finishSending();
    }
  }

  function handleAbort() {
    rpc.call("chat.abort", { sessionKey: sessionKey.current }).catch(() => {});
    messageQueue.current = [];
    setSending(false);
    streamBuf.current = "";
    streamSource.current = null;
    if (streamMsgId.current) {
      setMessages((prev) => prev.map((m) =>
        m.id === streamMsgId.current ? { ...m, streaming: false, content: m.content + " [aborted]" } : m
      ));
      streamMsgId.current = null;
    }
  }

  // Track IME composition to prevent Enter from sending during Chinese/Japanese input
  const composingRef = useRef(false);

  function handleCompositionStart() {
    composingRef.current = true;
  }

  function handleCompositionEnd() {
    composingRef.current = false;
  }

  // Enter no longer sends — Cmd/Ctrl+Enter sends
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !composingRef.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  // Image attachment handler — reads base64 for preview and copies to workspace for agent access
  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const fileList = Array.from(files);
    for (const file of fileList) {
      // Read base64 for preview
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) continue;

      // Copy to workspace if rootDir is available
      let containerPath: string | undefined;
      if (rootDir) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          // Write the file to a temp location first, then copy to workspace
          // Use the Tauri temp file approach: write base64 to a temp file, then copy
          const binary = atob(match[2]);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: match[1] });
          // Pick alternative: write to tmp via filesystem plugin or use the file path if available
          // In Tauri, input[type=file] provides the real path via webkitRelativePath or we can use convertFileSrc
          // Fallback: save blob to temp and copy
          // Actually, in Tauri desktop, File objects from <input> have a `path` property
          const filePath = (file as unknown as { path?: string }).path;
          if (filePath) {
            containerPath = await invoke<string>("copy_to_workspace", { rootDir, sourcePath: filePath });
          }
          // Fallback: if file.path is unavailable (Tauri v2), send base64 directly
          if (!containerPath) {
            containerPath = await invoke<string>("save_base64_to_workspace", {
              rootDir,
              fileName: file.name,
              base64Data: match[2],
            });
          }
        } catch (err) {
          console.warn("[image] Failed to copy image to workspace:", err);
        }
      }

      setImageAttachments((prev) => [...prev, {
        name: file.name,
        mediaType: match[1],
        base64: match[2],
        containerPath,
      }]);
    }
    // Reset so the same file can be picked again
    e.target.value = "";
  }

  function removeImage(index: number) {
    setImageAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function removeFile(index: number) {
    setFileAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  // File attachment: pick files via native dialog, copy to workspace/tmp/
  async function handleFilePick() {
    if (!rootDir) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const paths = await invoke<string[]>("pick_files");
      if (!paths || paths.length === 0) return;
      for (const sourcePath of paths) {
        try {
          const containerPath = await invoke<string>("copy_to_workspace", { rootDir, sourcePath });
          const name = sourcePath.split("/").pop() || sourcePath;
          setFileAttachments((prev) => [...prev, { name, containerPath }]);
        } catch (err) {
          console.warn("[file] Failed to copy file:", err);
        }
      }
    } catch (err) {
      console.warn("[file] Failed to pick files:", err);
    }
  }

  // Voice input — Web Speech API with macOS fallback
  function handleVoiceInput() {
    // If already listening, stop
    if (voiceListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    // Try Web Speech API first
    const SpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition
      || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new (SpeechRecognition as new () => SpeechRecognition)();
      recognition.lang = "zh-CN";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognitionRef.current = recognition;

      let finalTranscript = "";

      recognition.onstart = () => setVoiceListening(true);

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interim += transcript;
          }
        }
        // Show interim results in real-time, append final after current input
        setInput((prev) => {
          const base = prev.replace(/\u200B.*$/, ""); // remove previous interim marker
          if (interim) {
            return base + finalTranscript + "\u200B" + interim;
          }
          return base + finalTranscript;
        });
      };

      recognition.onend = () => {
        setVoiceListening(false);
        recognitionRef.current = null;
        // Clean up any remaining interim marker
        setInput((prev) => prev.replace(/\u200B/g, ""));
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn("[voice] Speech recognition error:", event.error);
        setVoiceListening(false);
        recognitionRef.current = null;

        // If not-allowed or service-unavailable, try macOS fallback
        if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "no-speech") {
          return;
        }
        fallbackMacOSDictation();
      };

      recognition.start();
      inputRef.current?.focus();
      return;
    }

    // Fallback: macOS system dictation via AppleScript (Fn Fn)
    fallbackMacOSDictation();
  }

  function fallbackMacOSDictation() {
    inputRef.current?.focus();
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("run_shell_command", {
        command: `osascript -e 'tell application "System Events" to key code 63' -e 'delay 0.05' -e 'tell application "System Events" to key code 63'`,
      }).catch(() => {});
    });
  }

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // Not connected yet
  if (!connected) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          {restarting ? (
            <>
              <IconSpinner size={24} className="animate-spin text-accent-emerald" />
              <p className="text-[13px] text-text-tertiary">Gateway restarting...</p>
              <p className="text-[11px] text-text-ghost">
                Waiting for gateway to come back ({restartElapsed}s / {RESTART_GRACE_SECONDS}s)
              </p>
            </>
          ) : connecting ? (
            <>
              <IconSpinner size={24} className="animate-spin text-text-ghost" />
              <p className="text-[13px] text-text-tertiary">Connecting to Gateway...</p>
            </>
          ) : connError ? (
            <>
              <IconXCircle size={24} className="text-accent-red" />
              <p className="text-[13px] text-accent-red">{connError}</p>
              <button
                onClick={connectRpc}
                className="mt-2 rounded-lg bg-bg-elevated px-4 py-2 text-[12px] font-medium text-text-primary ring-1 ring-border-default hover:bg-bg-hover"
              >
                Retry
              </button>
            </>
          ) : serviceState === "loading" ? (
            <>
              <IconSpinner size={24} className="animate-spin text-amber-400" />
              <p className="text-[13px] text-text-tertiary">Loading Gateway...</p>
            </>
          ) : serviceState === "starting" ? (
            <>
              <IconSpinner size={24} className="animate-spin text-accent-emerald" />
              <p className="text-[13px] text-text-secondary">Starting Gateway...</p>
              {startProgress && startProgress.stage === "pulling" && startProgress.percent != null ? (
                <div className="w-full max-w-xs space-y-2 rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-text-secondary">
                      {startProgress.layers_total > 0
                        ? `Pulling layers (${startProgress.layers_done}/${startProgress.layers_total})`
                        : startProgress.image
                          ? `Pulling ${startProgress.image}`
                          : "Pulling..."}
                    </span>
                    <span className="text-[11px] font-medium text-accent-emerald">{startProgress.percent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                    <div
                      className="h-full rounded-full bg-accent-emerald transition-all duration-300"
                      style={{ width: `${startProgress.percent}%` }}
                    />
                  </div>
                  <p className="truncate text-[10px] text-text-ghost">{startProgress.message}</p>
                </div>
              ) : (
                <p className="text-[11px] text-text-ghost">{gatewayType === "local" ? "Starting local process..." : "Running docker compose up"}</p>
              )}
            </>
          ) : serviceState === "stopping" ? (
            <>
              <IconSpinner size={24} className="animate-spin text-amber-400" />
              <p className="text-[13px] text-text-secondary">Stopping Gateway...</p>
              <p className="text-[11px] text-text-ghost">{gatewayType === "local" ? "Stopping local process..." : "Running docker compose down"}</p>
            </>
          ) : serviceState === "error" ? (
            <>
              <IconXCircle size={24} className="text-accent-red" />
              <p className="text-[13px] text-accent-red">Gateway Error</p>
              {lastError && (
                <pre className="mt-1 max-w-md overflow-auto rounded-lg bg-bg-elevated px-3 py-2 text-left text-[11px] leading-relaxed text-text-tertiary ring-1 ring-border-default">
                  {lastError}
                </pre>
              )}
            </>
          ) : serviceState !== "running" ? (
            <>
              <IconChat size={24} className="text-text-ghost" />
              <p className="text-[13px] text-text-tertiary">Gateway is not running</p>
            </>
          ) : (
            <>
              <IconChat size={24} className="text-text-ghost" />
              <p className="text-[13px] text-text-tertiary">Waiting for connection...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const activeApproval = approvalQueue[0];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {/* Security Officer banner */}
          {isSecurityOfficer && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 ring-1 ring-amber-500/20">
              <IconShield size={14} className="shrink-0 text-amber-400" />
              <span className="text-[12px] text-amber-300">
                This gateway is the Security Officer. It only processes security review requests — direct chat is disabled.
              </span>
            </div>
          )}
          {/* Load more button */}
          {hasMore && (
            <div className="flex justify-center pb-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-1.5 rounded-lg bg-bg-elevated px-3 py-1.5 text-[11px] font-medium text-text-tertiary ring-1 ring-border-subtle transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50"
              >
                {loadingMore ? (
                  <IconSpinner size={12} className="animate-spin" />
                ) : (
                  <IconChevronDown size={12} className="rotate-180" />
                )}
                {loadingMore ? "Loading..." : "Load earlier messages"}
              </button>
            </div>
          )}
          {messages.map((msg) => {
            // Tool call indicator
            if (msg.tool) {
              return (
                <div key={msg.id} className="flex items-center gap-2 px-1">
                  {msg.tool.status === "running" ? (
                    <IconSpinner size={12} className="animate-spin text-text-ghost" />
                  ) : msg.tool.status === "error" ? (
                    <IconXCircle size={12} className="text-accent-red" />
                  ) : (
                    <IconCheck size={12} className="text-accent-emerald" />
                  )}
                  <span className="text-[11px] font-mono text-text-tertiary">
                    {msg.tool.name}
                    {msg.tool.status === "running" && "..."}
                  </span>
                </div>
              );
            }

            // System message (errors, exec status)
            if (msg.role === "system") {
              return (
                <div key={msg.id} className="flex justify-center px-1">
                  <span className="rounded-md bg-bg-elevated px-2.5 py-1 text-[11px] text-text-tertiary ring-1 ring-border-subtle">
                    {msg.content}
                    <span className="ml-2 text-[9px] text-text-ghost">
                      {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                </div>
              );
            }

            // User / Assistant messages
            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                gatewayEmoji={gatewayEmoji}
                onAddToContext={(text) => setInput((prev) => prev ? prev + "\n" + text : text)}
                agentIcon={msg.agentName && agentIcons?.[`${gatewayId}:${msg.agentName}`] ? agentIcons[`${gatewayId}:${msg.agentName}`] : undefined}
              />
            );
          })}

          {/* Thinking indicator */}
          {sending && !messages.some((m) => m.streaming) && (
            <div className="flex items-start gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-surface ring-1 ring-border-default">
                <IconBot size={13} className="text-text-tertiary" />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 rounded-xl bg-bg-surface px-3.5 py-2.5 ring-1 ring-border-default">
                  <div className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent-emerald [animation-delay:-0.3s]" />
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent-emerald [animation-delay:-0.15s]" />
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent-emerald" />
                  </div>
                  <span className="text-[13px] text-text-tertiary">
                    Thinking...
                    {thinkingElapsed > 3 && (
                      <span className="ml-1 text-text-ghost">({thinkingElapsed}s)</span>
                    )}
                  </span>
                </div>
                {timedOut && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-500/5 px-3 py-2 ring-1 ring-amber-500/20">
                    <span className="text-[11px] text-amber-300">
                      Response is taking longer than expected
                    </span>
                    <button
                      onClick={() => {
                        setTimedOut(false);
                        setThinkingElapsed(0);
                        const start = Date.now();
                        if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
                        thinkingTimerRef.current = setInterval(() => {
                          const elapsed = Math.floor((Date.now() - start) / 1000);
                          setThinkingElapsed(elapsed);
                          if (elapsed >= THINKING_TIMEOUT_SECONDS) setTimedOut(true);
                        }, 1000);
                      }}
                      className="text-[11px] font-medium text-accent-emerald transition-colors hover:text-accent-emerald/80"
                    >
                      Continue
                    </button>
                    <button
                      onClick={handleAbort}
                      className="text-[11px] font-medium text-accent-red transition-colors hover:text-accent-red/80"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Exec Approval Banner */}
      {activeApproval && (
        <div className="shrink-0 border-t border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="mx-auto max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <IconShield size={14} className="text-amber-400" />
              <span className="text-[12px] font-medium text-amber-300">
                Exec Approval Required
                {approvalQueue.length > 1 && (
                  <span className="ml-1 text-text-tertiary">({approvalQueue.length} pending)</span>
                )}
              </span>
              {activeApproval.expiresAt && (
                <ExpiryTimer expiresAt={activeApproval.expiresAt} />
              )}
            </div>

            {/* Command */}
            <div className="mb-2 rounded-lg bg-bg-deep px-3 py-2 font-mono text-[12px] text-text-primary ring-1 ring-border-default">
              {activeApproval.command}
            </div>

            {/* Meta info */}
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
              {activeApproval.cwd && (
                <span className="flex items-center gap-1">
                  <IconFolder size={10} /> {activeApproval.cwd}
                </span>
              )}
              {activeApproval.host && <span>Host: {activeApproval.host}</span>}
              {activeApproval.agent && <span>Agent: {activeApproval.agent}</span>}
              {activeApproval.resolved && <span>Path: {activeApproval.resolved}</span>}
              {activeApproval.security && <span>Security: {activeApproval.security}</span>}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleApprovalDecision(activeApproval.id, "allow-once")}
                disabled={approvalBusy}
                className="flex items-center gap-1.5 rounded-lg bg-accent-emerald/15 px-3 py-1.5 text-[12px] font-medium text-accent-emerald ring-1 ring-accent-emerald/25 transition-colors hover:bg-accent-emerald/25 disabled:opacity-50"
              >
                <IconCheck size={12} /> Allow Once
              </button>
              <button
                onClick={() => handleApprovalDecision(activeApproval.id, "allow-always")}
                disabled={approvalBusy}
                className="flex items-center gap-1.5 rounded-lg bg-bg-elevated px-3 py-1.5 text-[12px] font-medium text-text-secondary ring-1 ring-border-default transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                <IconCheck size={12} /> Always Allow
              </button>
              <button
                onClick={() => handleApprovalDecision(activeApproval.id, "deny")}
                disabled={approvalBusy}
                className="flex items-center gap-1.5 rounded-lg bg-accent-red/10 px-3 py-1.5 text-[12px] font-medium text-accent-red ring-1 ring-accent-red/20 transition-colors hover:bg-accent-red/20 disabled:opacity-50"
              >
                <IconX size={12} /> Deny
              </button>
              {approvalBusy && <IconSpinner size={14} className="animate-spin text-text-ghost" />}
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-border-subtle px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {/* Status bar: shown while sending */}
          {sending && (
            <div className="flex items-center gap-2 rounded-lg bg-bg-elevated px-3 py-2 ring-1 ring-border-subtle">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent-emerald [animation-delay:-0.3s]" />
                <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent-emerald [animation-delay:-0.15s]" />
                <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent-emerald" />
              </span>
              <span className="text-[12px] text-text-secondary">Responding...</span>
              <span className="flex-1" />
              {messageQueue.current.length > 0 && (
                <span className="rounded-md bg-bg-surface px-1.5 py-0.5 text-[11px] font-medium text-text-tertiary ring-1 ring-border-subtle">
                  {messageQueue.current.length} queued
                </span>
              )}
              <button
                onClick={handleAbort}
                className="flex items-center gap-1 rounded-lg bg-accent-red/15 px-2.5 py-1 text-[11px] font-medium text-accent-red ring-1 ring-accent-red/25 transition-all hover:bg-accent-red/25"
                title="Stop generation and clear queue"
              >
                <IconXCircle size={12} />
                <span>Stop</span>
              </button>
            </div>
          )}

          {/* Image preview strip */}
          {imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {imageAttachments.map((img, i) => (
                <div key={i} className="group relative h-16 w-16 overflow-hidden rounded-lg ring-1 ring-border-default">
                  <img src={`data:${img.mediaType};base64,${img.base64}`} alt={img.name} className="h-full w-full object-cover" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-bg-deep text-text-tertiary opacity-0 ring-1 ring-border-default transition-opacity group-hover:opacity-100"
                  >
                    <IconX size={8} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* File preview strip */}
          {fileAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {fileAttachments.map((file, i) => (
                <div key={i} className="group relative flex items-center gap-1.5 rounded-lg bg-bg-surface px-2.5 py-1.5 ring-1 ring-border-default">
                  <IconFile size={12} className="shrink-0 text-text-ghost" />
                  <span className="max-w-[160px] truncate text-[11px] text-text-secondary">{file.name}</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-text-ghost opacity-0 transition-opacity hover:text-text-tertiary group-hover:opacity-100"
                  >
                    <IconX size={8} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex rounded-xl bg-bg-surface ring-1 ring-border-default transition-all focus-within:ring-border-strong">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);

                // Detect @ mention trigger
                const cursorPos = e.target.selectionStart || 0;
                const textBeforeCursor = val.slice(0, cursorPos);
                const atMatch = textBeforeCursor.match(/@(\S*)$/);
                if (atMatch) {
                  mentionStartPos.current = cursorPos - atMatch[0].length;
                  setMentionQuery(atMatch[1]);
                  setMentionPopupOpen(true);
                  // Calculate anchor position from textarea
                  const rect = e.target.getBoundingClientRect();
                  setMentionAnchor({ left: rect.left + 16, bottom: rect.top });
                } else {
                  setMentionPopupOpen(false);
                  mentionStartPos.current = -1;
                }
              }}
              onKeyDown={handleKeyDown}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder={isSecurityOfficer ? "Security Officer — direct chat disabled" : "Message... (@ to mention, ⌘+Enter to send)"}
              rows={4}
              disabled={isSecurityOfficer}
              className="flex-1 resize-none bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-text-primary placeholder:text-text-ghost focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* @ Mention Popup */}
          {mentionPopupOpen && (
            <MentionPopup
              query={mentionQuery}
              gateways={allGateways}
              currentGatewayId={gatewayId}
              anchorRect={mentionAnchor}
              onClose={() => {
                setMentionPopupOpen(false);
                mentionStartPos.current = -1;
              }}
              onSelect={(gw) => {
                // Replace @query with @GatewayName
                const start = mentionStartPos.current;
                if (start >= 0) {
                  const before = input.slice(0, start);
                  const cursorPos = inputRef.current?.selectionStart || input.length;
                  const after = input.slice(cursorPos);
                  const newText = `${before}@${gw.name} ${after}`;
                  setInput(newText);
                  // Focus and set cursor after the inserted mention
                  setTimeout(() => {
                    const pos = before.length + gw.name.length + 2; // @Name + space
                    inputRef.current?.setSelectionRange(pos, pos);
                    inputRef.current?.focus();
                  }, 0);
                }
                setMentionPopupOpen(false);
                mentionStartPos.current = -1;
              }}
            />
          )}

          {/* Toolbar: left actions + right send */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {/* Hidden file input */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImagePick}
              />
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={isSecurityOfficer}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-30"
                title="Insert image"
              >
                <IconImage size={16} />
              </button>
              <button
                onClick={handleFilePick}
                disabled={!rootDir || isSecurityOfficer}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-30"
                title="Attach file"
              >
                <IconFile size={16} />
              </button>
              <button
                onClick={handleVoiceInput}
                disabled={isSecurityOfficer}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-30 ${
                  voiceListening
                    ? "bg-accent-red/15 text-accent-red ring-1 ring-accent-red/25 animate-pulse"
                    : "text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
                }`}
                title={voiceListening ? "Stop listening" : "Voice input"}
              >
                <IconMic size={16} />
              </button>
            </div>

            {sending ? (
              <button
                onClick={handleSend}
                disabled={isSecurityOfficer || (!input.trim() && imageAttachments.length === 0 && fileAttachments.length === 0)}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-accent-emerald/15 px-4 text-[12px] font-medium text-accent-emerald ring-1 ring-accent-emerald/25 transition-all hover:bg-accent-emerald/25 disabled:opacity-30 disabled:hover:bg-accent-emerald/15"
                title="Queue message (will send when current response completes)"
              >
                <IconSend size={14} />
                <span>Queue</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={isSecurityOfficer || (!input.trim() && imageAttachments.length === 0 && fileAttachments.length === 0)}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-accent-emerald/15 px-4 text-[12px] font-medium text-accent-emerald ring-1 ring-accent-emerald/25 transition-all hover:bg-accent-emerald/25 disabled:opacity-30 disabled:hover:bg-accent-emerald/15"
              >
                <IconSend size={14} />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Message bubble with Markdown rendering and text selection actions */
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) openUrlInWindow(href);
      }}
    >
      {children}
    </a>
  ),
};

function MessageBubble({
  msg,
  gatewayEmoji,
  onAddToContext,
  agentIcon,
}: {
  msg: Message;
  gatewayEmoji: string;
  onAddToContext: (text: string) => void;
  agentIcon?: string;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{ x: number; y: number; text: string } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [actionLoading, setActionLoading] = useState<"pdf" | "wechat" | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Show popup on mouseup when text is selected
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !bubbleRef.current) {
      return;
    }
    // Ensure selection is within this bubble
    if (!bubbleRef.current.contains(sel?.anchorNode as Node)) {
      return;
    }
    const range = sel?.getRangeAt(0);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    // 使用视口坐标，避免被父容器边界限制
    setPopup({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      text,
    });
  }, []);

  // Dismiss popup on click outside
  useEffect(() => {
    if (!popup) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopup(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popup]);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleCopyMessage = useCallback(() => {
    navigator.clipboard.writeText(popup?.text || msg.content);
    showToast("已复制到剪贴板", "success");
    setPopup(null);
  }, [msg.content, popup, showToast]);

  const handleAddToContext = useCallback(() => {
    if (popup) {
      onAddToContext(popup.text);
      setPopup(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [popup, onAddToContext]);

  const handleExportPDF = useCallback(async () => {
    const textToExport = popup?.text || msg.content;
    setActionLoading("pdf");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("export_text_to_pdf", { text: textToExport });
      showToast("PDF 导出成功", "success");
      setPopup(null);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      const errMsg = String(err);
      if (!errMsg.includes("Cancelled")) {
        showToast("导出失败: " + errMsg, "error");
      }
      console.error("Failed to export PDF:", err);
    } finally {
      setActionLoading(null);
    }
  }, [popup, msg.content, showToast]);

  const handleWeChatShare = useCallback(async () => {
    const textToShare = popup?.text || msg.content;
    setActionLoading("wechat");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("share_to_wechat", { text: textToShare });
      showToast("已复制并打开微信", "success");
      setPopup(null);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      showToast("微信分享失败: " + String(err), "error");
      console.error("Failed to share to WeChat:", err);
    } finally {
      setActionLoading(null);
    }
  }, [popup, msg.content, showToast]);

  return (
    <div className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
      {msg.role === "assistant" && (
        <div className="flex shrink-0 items-start gap-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-surface ring-1 ring-border-default">
            <span className="text-[14px] leading-none">{msg.sourceGateway ? msg.sourceGateway.emoji : gatewayEmoji}</span>
          </div>
          {agentIcon && (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-elevated ring-1 ring-border-subtle mt-0.5" title={msg.agentName}>
              <span className="text-[11px] leading-none">{agentIcon}</span>
            </div>
          )}
        </div>
      )}
      <div className="group relative max-w-[75%]">
        {/* Action buttons above the bubble */}
        {msg.role === "assistant" && !msg.streaming && (
          <div className="mb-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={handleCopyMessage}
              className="flex h-5 w-5 items-center justify-center rounded-md text-text-ghost transition-colors hover:bg-bg-hover hover:text-text-secondary"
              title="复制"
            >
              <IconCopy size={11} />
            </button>
            <button
              onClick={handleExportPDF}
              disabled={actionLoading !== null}
              className="flex h-5 w-5 items-center justify-center rounded-md text-text-ghost transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50"
              title="导出 PDF"
            >
              {actionLoading === "pdf" ? <IconSpinner size={11} /> : <IconFile size={11} />}
            </button>
            <button
              onClick={handleWeChatShare}
              disabled={actionLoading !== null}
              className="flex h-5 w-5 items-center justify-center rounded-md text-text-ghost transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50"
              title="微信分享"
            >
              {actionLoading === "wechat" ? <IconSpinner size={11} /> : <IconShare size={11} />}
            </button>
          </div>
        )}
      <div
        ref={bubbleRef}
        onMouseUp={handleMouseUp}
        className={`relative overflow-hidden rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed break-words ${
          msg.role === "user"
            ? "bg-accent-emerald/15 text-text-primary ring-1 ring-accent-emerald/20 whitespace-pre-wrap"
            : msg.sourceGateway
              ? "bg-bg-surface text-text-secondary ring-1 ring-border-default border-l-2 border-l-accent-emerald/40"
              : "bg-bg-surface text-text-secondary ring-1 ring-border-default"
        }`}
      >
        {/* Source gateway header */}
        {msg.sourceGateway && msg.role === "assistant" && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-accent-emerald/80">
            <span>{msg.sourceGateway.emoji}</span>
            <span>{msg.sourceGateway.name}</span>
          </div>
        )}
        {msg.role === "user" ? (
          msg.content
        ) : (
          <div className="prose-chat">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        )}
        {msg.streaming && (
          <span className="ml-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-text-tertiary" />
        )}

        {/* Selection popup */}
        {popup && (
          <div
            ref={popupRef}
            className="fixed z-50 inline-flex items-center gap-1 rounded-lg bg-bg-deep px-1.5 py-1 shadow-lg ring-1 ring-border-default"
            style={{
              left: popup.x,
              top: popup.y,
              transform: "translate(-50%, -100%)",
            }}
          >
            <button
              onClick={handleCopyMessage}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-accent-emerald transition-colors hover:bg-accent-emerald/15"
              title="复制"
            >
              <IconCopy size={10} />
              复制
            </button>
            <button
              onClick={handleExportPDF}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover"
              title="导出 PDF"
            >
              <IconFile size={10} />
              PDF
            </button>
            <button
              onClick={handleWeChatShare}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover"
              title="微信分享"
            >
              <IconShare size={10} />
              微信
            </button>
            <button
              onClick={handleAddToContext}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-accent-emerald transition-colors hover:bg-accent-emerald/15"
            >
              <IconChevronDown size={10} className="rotate-90" />
              Add to input
            </button>
          </div>
        )}
      </div>
      {/* Toast notification */}
      {toast && (
        <div className={`mt-1 rounded-md px-2.5 py-1 text-[11px] font-medium ${
          toast.type === "success" ? "bg-accent-emerald/10 text-accent-emerald" : "bg-accent-red/10 text-accent-red"
        }`}>
          {toast.message}
        </div>
      )}
      </div>
      {/* Timestamp */}
      <div className={`mt-0.5 text-[9px] text-text-ghost ${msg.role === "user" ? "text-right" : ""}`}>
        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      {msg.role === "user" && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-emerald/10 ring-1 ring-accent-emerald/20">
          <IconUser size={14} className="text-accent-emerald/70" />
        </div>
      )}
    </div>
  );
}

/** Countdown timer for exec approval expiry */
function ExpiryTimer({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (remaining <= 0) {
    return <span className="text-[11px] text-accent-red">expired</span>;
  }
  return <span className="text-[11px] text-text-ghost">expires in {remaining}s</span>;
}
