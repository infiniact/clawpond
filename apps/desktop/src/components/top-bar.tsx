"use client";

import { IconUser, IconGrid, IconSettings, IconInfo } from "../components/icons";

export function TopBar() {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle bg-bg-deep px-4">
      {/* Left: branding */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[22.37%] bg-bg-elevated ring-1 ring-border-default" role="img" aria-label="Clawpond logo">
          <div className="relative h-5 w-5">
            {[0, 120, 240].map((deg) => (
              <span
                key={deg}
                className="absolute left-1/2 top-1/2 text-[8px] leading-none"
                style={{
                  transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-5px)`,
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

      {/* Right: actions */}
      <div className="flex items-center gap-1">
        <TopBarBtn><IconGrid size={15} /></TopBarBtn>
        <TopBarBtn><IconSettings size={15} /></TopBarBtn>
        <TopBarBtn><IconInfo size={15} /></TopBarBtn>
        <div className="ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent-emerald-dim ring-1 ring-accent-emerald/30">
          <IconUser size={12} className="text-accent-emerald" />
        </div>
      </div>
    </header>
  );
}

function TopBarBtn({ children }: { children: React.ReactNode }) {
  return (
    <button className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary">
      {children}
    </button>
  );
}
