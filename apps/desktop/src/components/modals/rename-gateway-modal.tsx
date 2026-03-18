"use client";

import { useState } from "react";
import { IconSpinner } from "../icons";

export function RenameGatewayModal({
  name,
  existingNames,
  onConfirm,
  onCancel,
}: {
  name: string;
  existingNames: string[];
  onConfirm: (newName: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [newName, setNewName] = useState(name);
  const [renaming, setRenaming] = useState(false);

  const trimmed = newName.trim();
  const nameError = trimmed
    ? existingNames.includes(trimmed.toLowerCase()) && trimmed.toLowerCase() !== name.toLowerCase()
      ? "Name already exists"
      : /[^a-zA-Z0-9_-]/.test(trimmed)
        ? "Only letters, numbers, - and _ allowed"
        : null
    : "Name is required";

  async function handleConfirm() {
    if (nameError || !trimmed) return;
    setRenaming(true);
    await onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <h3 className="mb-4 text-[14px] font-bold text-text-primary">{"Rename Gateway"}</h3>

        <label className="mb-1 block text-[11px] font-medium text-text-secondary">New Name</label>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          placeholder="gateway-name"
          autoFocus
          className="mb-1 w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
        />
        {nameError && trimmed && (
          <p className="mb-2 text-[10px] text-accent-red">{nameError}</p>
        )}
        <p className="mb-4 text-[10px] text-text-ghost">
          {"This will stop the gateway, rename the folder, and restart from the new location."}
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={renaming}
            className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary disabled:opacity-40"
          >
            {"Cancel"}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!!nameError || renaming}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-emerald/15 px-4 py-2 text-[12px] font-semibold text-accent-emerald ring-1 ring-accent-emerald/25 transition-all hover:bg-accent-emerald/25 disabled:opacity-40"
          >
            {renaming ? (
              <>
                <IconSpinner size={13} className="animate-spin" />
                {"Renaming..."}
              </>
            ) : (
              "Rename"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
