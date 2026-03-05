"use client";

import { useState } from "react";
import {
  IconSearch,
  IconTag,
  IconCode,
  IconPlus,
  IconStar,
  IconChat,
  IconList,
  IconBot,
  IconLock,
  IconClipboard,
  IconVolume,
  IconMaximize,
  IconBolt,
  IconXCircle,
  IconX,
  IconSpinner,
} from "./icons";

export function ChatArea() {
  const [inputValue, setInputValue] = useState("");

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg-base">
      {/* ── Toolbar ── */}
      <div className="flex h-10 shrink-0 items-center justify-center gap-1.5 border-b border-border-subtle">
        <ToolbarBtn active><IconSearch size={15} /></ToolbarBtn>
        <span className="mx-1 h-3.5 w-px bg-border-default" />
        <ToolbarBtn><IconTag size={15} /></ToolbarBtn>
        <ToolbarBtn>
          <span className="relative">
            <IconCode size={15} />
            <IconStar size={8} className="absolute -right-1.5 -top-1.5 text-accent-amber drop-shadow-[0_0_3px_rgba(251,191,36,0.5)]" />
          </span>
        </ToolbarBtn>
        <ToolbarBtn><IconPlus size={15} /></ToolbarBtn>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex h-9 shrink-0 items-center border-b border-border-subtle px-3">
        <div className="flex items-center gap-2 rounded-md bg-bg-surface px-2.5 py-1 ring-1 ring-border-default">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
          <span className="max-w-[180px] truncate text-[11px] font-medium text-text-primary">
            openclaw如何识别和分配...
          </span>
          <span className="font-mono text-[10px] text-text-ghost">d02f1f</span>
        </div>
        <button className="ml-1.5 flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary">
          <IconPlus size={13} />
        </button>
        <div className="flex-1" />
        <button className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary">
          <IconMaximize size={13} />
        </button>
      </div>

      {/* ── Task status ── */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
        <div className="flex items-center gap-2">
          <IconSpinner size={14} className="animate-spin text-text-secondary" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
            Analyzing Task...
          </span>
          <span className="font-mono text-[10px] text-text-ghost">#6ca575af</span>
        </div>
        <div className="flex-1" />
        <button className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary">
          <IconBolt size={11} />
          Bypass
        </button>
        <button className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-accent-red/80 transition-colors hover:bg-accent-red/10 hover:text-accent-red">
          <IconXCircle size={11} />
          Cancel
        </button>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {/* User message */}
          <div className="mb-8 flex justify-end">
            <div className="max-w-[75%] rounded-2xl rounded-br-md bg-bg-elevated px-4 py-3 text-[13px] leading-relaxed text-text-primary ring-1 ring-border-default">
              openclaw如何识别和分配任务，使各个agent之间能够协作顺畅
            </div>
          </div>

          {/* AI response */}
          <div className="mb-6">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-emerald-dim ring-1 ring-accent-emerald/25">
                <IconCode size={13} className="text-accent-emerald" />
              </div>
              <span className="text-[11px] font-medium text-text-tertiary">
                Claude Opus
              </span>
            </div>
            <div className="rounded-xl rounded-tl-md bg-bg-surface px-5 py-4 text-[13px] leading-[1.7] text-text-secondary ring-1 ring-border-subtle">
              <p className="mb-4 text-text-tertiary">
                Let me research the OpenClaw codebase to understand how task
                identification, distribution, and agent collaboration work.
              </p>

              <h3 className="mb-2 text-[15px] font-bold text-text-primary">
                OpenClaw 任务识别与分配机制 -- Agent 协作架构解析
              </h3>

              <h4 className="mb-2 text-[13px] font-bold text-text-primary">
                一、消息路由：如何识别"该谁处理"
              </h4>

              <p className="mb-1.5">
                <span className="font-semibold text-text-primary">1.1 路由核心：</span>
                <InlineCode>resolveAgentRoute()</InlineCode>
              </p>
              <p className="mb-4">
                每条入站消息到达后，OpenClaw 通过{" "}
                <InlineCode>src/routing/resolve-route.ts</InlineCode> 中的{" "}
                <InlineCode>resolveAgentRoute()</InlineCode> 函数决定由哪个 Agent 处理。
              </p>

              <p className="mb-2 font-semibold text-text-primary">输入上下文包括：</p>
              <ul className="ml-1 space-y-1.5 text-text-secondary">
                <ContextItem code="channel" desc="消息来源渠道（telegram / discord / slack 等）" />
                <ContextItem code="accountId" desc="该渠道上的具体 bot 账号" />
                <ContextItem code="peer" desc="对话对象（DM 用户、群组、频道）" />
                <ContextItem code="guildId" desc="/ teamId -- 平台级组织标识" />
                <ContextItem code="memberRoleIds" desc="Discord 角色信息" />
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom: Mode bar + Input ── */}
      <div className="shrink-0 border-t border-border-subtle bg-bg-deep">
        {/* Mode tabs */}
        <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-amber-dim px-3 py-1 text-[11px] font-semibold text-accent-amber ring-1 ring-accent-amber/20">
            <IconStar size={10} />
            MASTER: CLAUDE OPUS
          </span>
          <ModeTab icon={<IconChat size={11} />} label="CHAT" />
          <ModeTab icon={<IconList size={11} />} label="TASK" />
          <ModeTab icon={<IconBot size={11} />} label="openclaw" suffix={<IconLock size={9} />} />
        </div>

        {/* Input */}
        <div className="px-4 pb-3">
          <div className="rounded-xl bg-bg-surface ring-1 ring-border-default transition-all focus-within:ring-border-strong">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Describe a task for the Master to orchestrate..."
              className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-ghost focus:outline-none"
              rows={2}
            />
            <div className="flex items-center px-3 pb-2.5">
              <div className="flex items-center gap-1">
                <InputBtn><IconBot size={15} /></InputBtn>
                <InputBtn><IconClipboard size={15} /></InputBtn>
                <InputBtn><IconVolume size={15} /></InputBtn>
                <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-bg-elevated px-2.5 py-1 text-[11px] text-text-secondary ring-1 ring-border-default">
                  <IconCode size={11} />
                  Claude Opus
                  <button className="text-text-ghost transition-colors hover:text-text-secondary">
                    <IconX size={9} />
                  </button>
                </span>
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-text-ghost">
                  <kbd className="rounded border border-border-default bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-tertiary">
                    ⌘
                  </kbd>
                  {" "}+ Enter to send
                </span>
                <button className="inline-flex items-center gap-1.5 rounded-lg bg-bg-elevated px-3.5 py-1.5 text-[12px] font-medium text-text-primary ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-border-strong">
                  Chat
                  <IconChat size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function ToolbarBtn({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-bg-elevated text-text-primary ring-1 ring-border-default"
          : "text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
      }`}
    >
      {children}
    </button>
  );
}

function ModeTab({
  icon,
  label,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  suffix?: React.ReactNode;
}) {
  return (
    <button className="inline-flex items-center gap-1.5 rounded-full border border-border-default px-2.5 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:border-border-strong hover:bg-bg-surface hover:text-text-secondary">
      {icon}
      {label}
      {suffix}
    </button>
  );
}

function InputBtn({ children }: { children: React.ReactNode }) {
  return (
    <button className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary">
      {children}
    </button>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-accent-emerald/80 ring-1 ring-border-subtle">
      {children}
    </code>
  );
}

function ContextItem({ code, desc }: { code: string; desc: string }) {
  return (
    <li className="flex items-baseline gap-2 pl-2 text-[12.5px]">
      <span className="text-text-ghost">--</span>
      <InlineCode>{code}</InlineCode>
      <span className="text-text-tertiary">{desc}</span>
    </li>
  );
}
