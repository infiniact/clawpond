"use client";

import Image from "next/image";
import { IconSettings, IconSun, IconMoon } from "./icons";

export function TopBar({ onSettings, theme, onToggleTheme }: { onSettings?: () => void; theme?: "dark" | "light"; onToggleTheme?: () => void }) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle bg-bg-deep px-4">
      {/* Left: branding */}
      <div className="flex items-center gap-2.5">
        <Image
          src={theme === "light" ? "/logo-light.svg" : "/logo-dark.svg"}
          alt="ClawPond"
          width={24}
          height={24}
          className="shrink-0 rounded-[22.37%]"
          priority
        />
        <span className="text-[13px] font-semibold tracking-tight text-text-primary">
          ClawPond
        </span>
      </div>

      {/* Right: theme toggle + settings */}
      <div className="flex items-center gap-2">
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
    </header>
  );
}
