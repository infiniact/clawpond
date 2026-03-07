"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrlInWindow } from "../lib/open-url";
import {
  IconChat,
  IconChevronRight,
  IconCode,
  IconSend,
  IconBot,
  IconSpinner,
  IconXCircle,
  IconShield,
  IconCheck,
  IconX,
  IconFolder,
  IconChevronDown,
  IconImage,
  IconMic,
} from "./icons";
import { ConfigWizard } from "./config-wizard";
import { OpenClawRpc } from "../lib/openclaw-rpc";
import type { RpcEvent } from "../lib/openclaw-rpc";
import {
  loadMessages,
  saveAllMessages,
  type StoredMessage,
} from "../lib/chat-store";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  streaming?: boolean;
  /** Tool call info displayed inline */
  tool?: { name: string; status: "running" | "done" | "error" };
};

/** Extract plain text from content that may be a string, a content block {type,text}, or an array of blocks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textOf).join("");
  if (content && typeof content === "object" && typeof content.text === "string") return content.text;
  return "";
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
  onToggleTaskPanel,
  taskPanelOpen,
  gatewayName,
  gatewayEmoji,
  configured,
  reconfiguring,
  onCloseReconfig,
  onConfigComplete,
  rootDir,
  serviceState,
  skipDocker,
  fixedRootDir,
  remoteHost,
  remotePort,
  remoteToken,
}: {
  hidden?: boolean;
  onToggleTaskPanel: () => void;
  taskPanelOpen: boolean;
  gatewayName: string;
  gatewayEmoji: string;
  configured: boolean;
  reconfiguring?: boolean;
  onCloseReconfig?: () => void;
  onConfigComplete: (rootDir: string) => void;
  rootDir: string | null;
  serviceState: string;
  skipDocker?: boolean;
  fixedRootDir?: string;
  remoteHost?: string;
  remotePort?: string;
  remoteToken?: string;
}) {
  const isRemote = !!remoteHost;
  const showWizard = !isRemote && (!configured || reconfiguring);
  const showChat = configured && !reconfiguring;

  return (
    <div className={`flex min-w-0 flex-1 flex-col bg-bg-base${hidden ? " hidden" : ""}`}>
      {/* ── Top bar with toggle buttons ── */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <div className="flex items-center gap-2">
          <span className="text-[16px] leading-none">{gatewayEmoji}</span>
          <span className="text-[12px] font-medium text-text-secondary">
            {showWizard ? `${gatewayName} Setup` : gatewayName}
          </span>
        </div>

        <button
          onClick={onToggleTaskPanel}
          className={`flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary ${
            !taskPanelOpen ? "bg-bg-elevated text-text-secondary ring-1 ring-border-default" : ""
          }`}
          title={taskPanelOpen ? "Collapse tasks" : "Expand tasks"}
        >
          <IconChevronRight size={14} className={taskPanelOpen ? "" : "rotate-180"} />
        </button>
      </div>

      {/* ── Content ── */}
      <div className={`flex min-h-0 flex-1 flex-col ${showWizard ? "" : "hidden"}`}>
        <ConfigWizard
          onComplete={onConfigComplete}
          onClose={reconfiguring ? onCloseReconfig : undefined}
          skipDocker={skipDocker}
          fixedRootDir={fixedRootDir}
        />
      </div>
      {configured && (
        <div className={`flex min-h-0 flex-1 flex-col ${showChat ? "" : "hidden"}`}>
          <ChatView rootDir={rootDir} serviceState={serviceState} remoteHost={remoteHost} remotePort={remotePort} remoteToken={remoteToken} hidden={hidden} />
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
  };
}

function fromStored(msg: StoredMessage): Message {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: new Date(msg.timestamp),
    tool: msg.tool,
  };
}

function ChatView({ rootDir, serviceState, remoteHost, remotePort, remoteToken, hidden }: { rootDir: string | null; serviceState: string; remoteHost?: string; remotePort?: string; remoteToken?: string; hidden?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartElapsed, setRestartElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const THINKING_TIMEOUT_SECONDS = 30;
  const [approvalQueue, setApprovalQueue] = useState<ExecApproval[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadedOffset, setLoadedOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [imageAttachments, setImageAttachments] = useState<{ name: string; mediaType: string; base64: string }[]>([]);
  const [voiceListening, setVoiceListening] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  // Load persisted messages on mount / rootDir change
  useEffect(() => {
    if (!rootDir) return;
    const { messages: stored, hasMore: more } = loadMessages(rootDir, 0);
    setMessages(stored.map(fromStored));
    setHasMore(more);
    setLoadedOffset(stored.length);
    // Scroll to bottom instantly on initial load — double rAF to ensure React has committed
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "instant" });
      });
    });
  }, [rootDir]);

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
  const handleLoadMore = useCallback(() => {
    if (!rootDir || !hasMore || loadingMore) return;
    setLoadingMore(true);
    const scrollEl = scrollRef.current;
    const prevScrollHeight = scrollEl?.scrollHeight || 0;

    const { messages: older, hasMore: more } = loadMessages(rootDir, loadedOffset);
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
  const prevHiddenRef = useRef(hidden);
  useEffect(() => {
    const wasHidden = prevHiddenRef.current;
    prevHiddenRef.current = hidden;
    if (wasHidden && !hidden) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "instant" });
      });
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
    const isRemote = !!remoteHost;
    console.log(`[connectRpc] called: isRemote=${isRemote}, rootDir=${rootDir}, serviceState=${serviceState}, rpc.connected=${rpc.connected}`);
    if (!isRemote && (!rootDir || serviceState !== "running")) {
      console.log("[connectRpc] bail: not remote and rootDir/serviceState not ready");
      return;
    }
    if (isRemote && serviceState !== "running") {
      console.log("[connectRpc] bail: remote but serviceState not running");
      return;
    }

    // Already connected
    if (rpc.connected) {
      setConnected(true);
      return;
    }

    let port: string;
    let token: string;
    let host: string;

    if (isRemote && remotePort && remoteToken) {
      host = remoteHost;
      port = remotePort;
      token = remoteToken;
    } else {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<{ port: string; token: string }>("read_gateway_info", { rootDir });
      host = "127.0.0.1";
      port = info.port;
      token = info.token;
    }

    setConnecting(true);
    setConnError(null);
    try {
      console.log(`[connectRpc] connecting to ${host}:${port} (isRemote=${isRemote}, rootDir=${rootDir}, token=${token ? token.slice(0, 4) + "***" : "none"})`);
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
  }, [rootDir, remoteHost, remotePort, remoteToken, serviceState, restarting, exitRestartGrace]);

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
      setSending(false);
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
            }]);
          } else {
            setMessages((prev) => prev.map((m) =>
              m.id === msgId ? { ...m, content: streamBuf.current } : m
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
          setSending(false);
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
        setSending(false);
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
        setSending(false);
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
        setSending(false);
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

  async function handleSend() {
    const text = input.trim();
    const images = [...imageAttachments];
    if (!text && images.length === 0) return;
    if (sending) return;

    // Build content for local UI display
    const displayContent = images.length > 0
      ? (text ? `[${images.length} image(s)] ${text}` : `[${images.length} image(s)]`)
      : text;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: displayContent,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setImageAttachments([]);
    setSending(true);
    streamBuf.current = "";
    streamMsgId.current = null;
    streamSource.current = null;

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
          contentBlocks.push({ type: "text", text: text || "Please describe this image." });

          result = await rpc.call("chat.send", {
            ...baseParams,
            content: contentBlocks,
          });
        } else {
          // Gateway does NOT support images — send text only + show warning
          result = await rpc.call("chat.send", {
            ...baseParams,
            message: text || "Please describe this image.",
          });
          setMessages((prev) => [...prev, {
            id: `warn-${Date.now()}`,
            role: "system",
            content: "⚠ Current Gateway does not support image attachments. Only text was sent. Please upgrade your OpenClaw Gateway to enable multimodal support.",
            timestamp: new Date(),
          }]);
        }
      } else {
        result = await rpc.call("chat.send", {
          ...baseParams,
          message: text,
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
          setSending(false);
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
      setSending(false);
    }
  }

  function handleAbort() {
    rpc.call("chat.abort", { sessionKey: sessionKey.current }).catch(() => {});
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

  // Image attachment handler
  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // dataUrl format: "data:<mediaType>;base64,<base64data>"
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          setImageAttachments((prev) => [...prev, {
            name: file.name,
            mediaType: match[1],
            base64: match[2],
          }]);
        }
      };
      reader.readAsDataURL(file);
    });
    // Reset so the same file can be picked again
    e.target.value = "";
  }

  function removeImage(index: number) {
    setImageAttachments((prev) => prev.filter((_, i) => i !== index));
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
                  </span>
                </div>
              );
            }

            // User / Assistant messages
            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onAddToContext={(text) => setInput((prev) => prev ? prev + "\n" + text : text)}
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

          <div className="flex rounded-xl bg-bg-surface ring-1 ring-border-default transition-all focus-within:ring-border-strong">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder="Message ClawKing... (⌘+Enter to send)"
              rows={4}
              disabled={sending}
              className="flex-1 resize-none bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-text-primary placeholder:text-text-ghost focus:outline-none disabled:opacity-50"
            />
          </div>

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
                disabled={sending}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-30"
                title="Insert image"
              >
                <IconImage size={16} />
              </button>
              <button
                onClick={handleVoiceInput}
                disabled={sending}
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
                onClick={handleAbort}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-accent-red/15 px-4 text-[12px] font-medium text-accent-red ring-1 ring-accent-red/25 transition-all hover:bg-accent-red/25"
                title="Abort generation"
              >
                <IconXCircle size={14} />
                <span>Stop</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && imageAttachments.length === 0}
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
  onAddToContext,
}: {
  msg: Message;
  onAddToContext: (text: string) => void;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{ x: number; y: number; text: string } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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
    const parentRect = bubbleRef.current.getBoundingClientRect();
    setPopup({
      x: rect.left - parentRect.left + rect.width / 2,
      y: rect.top - parentRect.top - 8,
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

  const handleCopyMessage = useCallback(() => {
    navigator.clipboard.writeText(msg.content);
    setPopup(null);
  }, [msg.content]);

  const handleAddToContext = useCallback(() => {
    if (popup) {
      onAddToContext(popup.text);
      setPopup(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [popup, onAddToContext]);

  return (
    <div className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
      {msg.role === "assistant" && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-surface ring-1 ring-border-default">
          <IconBot size={14} className="text-text-tertiary" />
        </div>
      )}
      <div
        ref={bubbleRef}
        onMouseUp={handleMouseUp}
        className={`relative max-w-[75%] overflow-hidden rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed break-words ${
          msg.role === "user"
            ? "bg-accent-emerald/15 text-text-primary ring-1 ring-accent-emerald/20 whitespace-pre-wrap"
            : "bg-bg-surface text-text-secondary ring-1 ring-border-default"
        }`}
      >
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
            className="absolute z-50 flex items-center gap-1 rounded-lg bg-bg-deep px-1.5 py-1 shadow-lg ring-1 ring-border-default"
            style={{
              left: popup.x,
              top: popup.y,
              transform: "translate(-50%, -100%)",
            }}
          >
            <button
              onClick={handleAddToContext}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent-emerald transition-colors hover:bg-accent-emerald/15"
            >
              <IconChevronDown size={10} className="rotate-90" />
              Add to input
            </button>
          </div>
        )}
      </div>
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
