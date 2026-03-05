"use client";

import { useState } from "react";
import {
  IconHome,
  IconShield,
  IconLadder,
  IconBuilding,
  IconCpu,
  IconCode,
  IconPlus,
  IconChevronRight,
} from "./icons";

const items = [
  { id: "default", icon: IconHome, label: "Default" },
  { id: "crypto", icon: IconShield, label: "加密货..." },
  { id: "proxy", icon: IconLadder, label: "梯子的..." },
  { id: "admin", icon: IconBuilding, label: "行政部" },
  { id: "gpu", icon: IconCpu, label: "GPU集..." },
  { id: "openclaw", icon: IconCode, label: "Open..." },
  { id: "fishpond", icon: IconCode, label: "Fishp..." },
  { id: "clawpond", icon: IconCode, label: "clawp..." },
] as const;

export function Sidebar() {
  const [active, setActive] = useState("openclaw");

  return (
    <nav className="flex h-full w-[60px] shrink-0 flex-col items-center bg-bg-deep py-2">
      {/* Nav items */}
      <div className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={`group relative flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 transition-all duration-150 ${
                isActive
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-tertiary hover:bg-bg-surface hover:text-text-secondary"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-emerald" />
              )}
              <Icon size={17} />
              <span className="max-w-full truncate text-[9px] font-medium leading-none tracking-wide">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-0.5 border-t border-border-subtle px-1 pt-2">
        <SidebarBtn>
          <IconPlus size={15} />
        </SidebarBtn>
        <SidebarBtn>
          <IconChevronRight size={15} />
        </SidebarBtn>
      </div>
    </nav>
  );
}

function SidebarBtn({ children }: { children: React.ReactNode }) {
  return (
    <button className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-surface hover:text-text-secondary">
      {children}
    </button>
  );
}
