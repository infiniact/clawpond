"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { IconSettings, IconSun, IconMoon } from "../icons";

function WindowControls() {
  const handleMinimize = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  }, []);

  const handleMaximize = useCallback(async () => {
    const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
    const maximized = await win.isMaximized();
    if (maximized) await win.unmaximize(); else await win.maximize();
  }, []);

  const handleClose = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }, []);

  return (
    <div className="flex items-center">
      {/* Minimize */}
      <button
        onClick={handleMinimize}
        className="flex h-11 w-11 items-center justify-center text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      {/* Maximize / Restore */}
      <button
        onClick={handleMaximize}
        className="flex h-11 w-11 items-center justify-center text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        title="Maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      {/* Close */}
      <button
        onClick={handleClose}
        className="flex h-11 w-11 items-center justify-center text-text-tertiary transition-colors hover:bg-[#e81123] hover:text-white"
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

export function TopBar({ onSettings, theme, onToggleTheme }: { onSettings?: () => void; theme?: "dark" | "light"; onToggleTheme?: () => void }) {
  const [isWindows, setIsWindows] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const platform = await invoke<string>("detect_platform");
        setIsWindows(platform === "windows");
      } catch {
        setIsWindows(navigator.userAgent.toLowerCase().includes("win"));
      }
    })();
  }, []);

  return (
    <header className="flex h-11 shrink-0 items-center border-b border-border-subtle bg-bg-deep">
      {/* Left: branding */}
      <div className="flex items-center gap-2.5 px-4" {...(isWindows ? { "data-tauri-drag-region": "" } : {})}>
        <Image
          src={theme === "light" ? "/logo-light.svg" : "/logo-dark.svg"}
          alt="ClawPond"
          width={24}
          height={24}
          className="shrink-0 rounded-[22.37%] pointer-events-none"
          priority
        />
        <span className="text-[13px] font-semibold tracking-tight text-text-primary select-none">
          ClawPond
        </span>
      </div>

      {/* Center: drag region — only on Windows where native decorations are disabled */}
      <div className="flex-1 h-full" {...(isWindows ? { "data-tauri-drag-region": "" } : {})} />

      {/* Right: theme toggle + settings */}
      <div className="flex items-center gap-2 px-2">
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-elevated ring-1 ring-border-default transition-colors hover:bg-bg-hover"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <IconSun size={14} className="text-text-secondary" />
            ) : (
              <IconMoon size={14} className="text-text-secondary" />
            )}
          </button>
        )}
        {onSettings && (
          <button
            onClick={onSettings}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-elevated ring-1 ring-border-default transition-colors hover:bg-bg-hover"
            title="Settings"
          >
            <IconSettings size={14} className="text-text-secondary" />
          </button>
        )}
      </div>
      {/* Custom window controls — only on Windows (native decorations are disabled) */}
      {isWindows && <WindowControls />}
    </header>
  );
}
