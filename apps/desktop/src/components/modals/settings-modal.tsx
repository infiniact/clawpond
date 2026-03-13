"use client";

import { IconX, IconDownload } from "../icons";

export function SettingsModal({
  settingsDraft,
  onSettingsDraftChange,
  browserRunning,
  onSave,
  onClose,
  onCheckUpdates,
}: {
  settingsDraft: string;
  onSettingsDraftChange: (v: string) => void;
  browserRunning: boolean;
  onSave: () => void;
  onClose: () => void;
  onCheckUpdates: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-bg-surface p-6 shadow-2xl ring-1 ring-border-default">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-text-primary">Global Settings</h2>
          <button onClick={onClose} className="text-text-ghost hover:text-text-secondary">
            <IconX size={16} />
          </button>
        </div>

        <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
          Shared Directory
        </label>
        <p className="mb-2 text-[11px] text-text-ghost">
          A host directory mounted into all Docker gateways at <code className="rounded bg-bg-elevated px-1 py-0.5 font-mono text-[10px]">/home/node/.openclaw/shared</code>. Leave empty to disable.
        </p>
        <input
          type="text"
          value={settingsDraft}
          onChange={(e) => onSettingsDraftChange(e.target.value)}
          placeholder="~/clawpond/shared"
          className="mb-4 w-full rounded-lg border border-border-default bg-bg-deep px-3 py-2 text-[12px] text-text-primary placeholder:text-text-ghost focus:border-accent-blue focus:outline-none"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
          Shared Browser
        </label>
        <p className="mb-2 text-[11px] text-text-ghost">
          All gateways share a Playwright browser container. The browser relay port is derived from each gateway&apos;s port (gateway_port + 3).
        </p>
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-bg-elevated px-3 py-2.5 ring-1 ring-border-default">
          <span className={`inline-block h-2 w-2 rounded-full ${browserRunning ? "bg-accent-emerald" : "bg-text-ghost"}`} />
          <span className="text-[12px] font-medium text-text-primary">
            {browserRunning ? "Browser Running" : "Browser Stopped"}
          </span>
        </div>

        <div className="mb-4">
          <button
            onClick={onCheckUpdates}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-bg-elevated px-3 py-2.5 text-[12px] font-medium text-text-primary ring-1 ring-border-default transition-colors hover:bg-bg-hover"
          >
            <IconDownload size={14} className="text-accent-emerald" />
            Check for Updates
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-default px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="rounded-lg bg-accent-blue px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-blue/90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
