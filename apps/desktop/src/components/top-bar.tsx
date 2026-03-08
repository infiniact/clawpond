"use client";

import { IconSettings } from "./icons";

export function TopBar({ onSettings }: { onSettings?: () => void }) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle bg-bg-deep px-4">
      {/* Left: branding */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[22.37%] bg-bg-elevated ring-1 ring-border-default" role="img" aria-label="Clawpond logo">
          <div className="relative h-7 w-7">
            {[0, 120, 240].map((deg) => (
              <span
                key={deg}
                className="absolute left-1/2 top-1/2 text-[7px] leading-none"
                style={{
                  transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-7px)`,
                }}
              >
                🦞
              </span>
            ))}
          </div>
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-text-primary">
          ClawPond
        </span>
      </div>

      {/* Right: settings + ClawKing icon */}
      <div className="flex items-center gap-2">
        {onSettings && (
          <button
            onClick={onSettings}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-elevated ring-1 ring-border-default transition-colors hover:bg-bg-hover"
            title="Settings"
          >
            <IconSettings size={14} className="text-text-secondary" />
          </button>
        )}
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-elevated ring-1 ring-border-default grayscale" role="img" aria-label="ClawKing">
          <span className="text-[14px] leading-none opacity-60">🦞</span>
        </div>
      </div>
    </header>
  );
}
