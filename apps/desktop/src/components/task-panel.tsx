"use client";

import {
  IconClock,
  IconPlus,
  IconChevronRight,
} from "./icons";

export function TaskPanel({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-l border-border-subtle bg-bg-deep transition-all duration-200 ${
        collapsed ? "w-0 overflow-hidden border-l-0 opacity-0" : "w-[272px] opacity-100"
      }`}
    >
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <div className="flex items-center gap-2">
          <IconClock size={14} className="text-text-tertiary" />
          <span className="whitespace-nowrap text-[12px] font-semibold text-text-primary">
            Scheduled Tasks
          </span>
        </div>
        <button
          onClick={onToggle}
          className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <IconChevronRight size={14} />
        </button>
      </div>

      {/* Empty state */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-surface ring-1 ring-border-default">
          <IconClock size={22} className="text-text-ghost" />
        </div>
        <p className="mt-4 whitespace-nowrap text-[13px] font-medium text-text-secondary">
          No scheduled tasks
        </p>
        <p className="mt-1 whitespace-nowrap text-center text-[11px] leading-relaxed text-text-ghost">
          Create a task to run automatically
        </p>
      </div>

      {/* Footer */}
      <div className="border-t border-border-subtle p-3">
        <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-default py-2 text-[12px] font-medium text-text-tertiary transition-all hover:border-border-strong hover:bg-bg-surface hover:text-text-secondary">
          <IconPlus size={13} />
          Add Task
        </button>
      </div>
    </aside>
  );
}
