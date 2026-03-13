"use client";

import { useState } from "react";
import { IconPlus, IconSearch } from "../icons";
import { EMOJI_OPTIONS, FEATURED_COUNT } from "../../lib/emoji-data";

export function AddGatewayModal({
  onConfirm,
  onCancel,
  existingNames,
}: {
  onConfirm: (name: string, emoji: string) => void;
  onCancel: () => void;
  existingNames: string[];
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("\u{1F916}");
  const [emojiSearch, setEmojiSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const trimmed = name.trim();
  const nameError = trimmed
    ? existingNames.includes(trimmed.toLowerCase())
      ? "Name already exists"
      : /[^a-zA-Z0-9_-]/.test(trimmed)
        ? "Only letters, numbers, - and _ allowed"
        : null
    : null;

  const canConfirm = !!trimmed && !nameError;

  const filtered = emojiSearch
    ? EMOJI_OPTIONS.filter((e) =>
        e.kw.toLowerCase().includes(emojiSearch.toLowerCase()) ||
        e.emoji.includes(emojiSearch)
      )
    : showAll
      ? EMOJI_OPTIONS
      : EMOJI_OPTIONS.slice(0, FEATURED_COUNT);

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(trimmed, emoji);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <h3 className="mb-4 text-[14px] font-bold text-text-primary">
          Add Docker Gateway
        </h3>

        {/* Name */}
        <label className="mb-1 block text-[11px] font-medium text-text-secondary">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-gateway"
          autoFocus
          className="mb-1 w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) handleConfirm();
            if (e.key === "Escape") onCancel();
          }}
        />
        {nameError && <p className="mb-2 text-[10px] text-accent-red">{nameError}</p>}
        {trimmed && !nameError && (
          <p className="mb-2 text-[10px] text-text-ghost">
            ~/clawpond/clawking/pond/{trimmed}
          </p>
        )}

        {/* Icon picker */}
        <label className="mb-1 block text-[11px] font-medium text-text-secondary">Icon</label>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-elevated text-[20px] ring-1 ring-border-default">
            {emoji}
          </span>
          <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-bg-elevated px-2.5 py-1.5 ring-1 ring-border-default focus-within:ring-accent-emerald/50">
            <IconSearch size={12} className="shrink-0 text-text-ghost" />
            <input
              type="text"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              placeholder="Search icons..."
              className="w-full bg-transparent text-[11px] text-text-primary placeholder:text-text-ghost focus:outline-none"
            />
          </div>
        </div>
        <div className="mb-2 grid grid-cols-10 gap-1">
          {filtered.map((e) => (
            <button
              key={e.emoji}
              type="button"
              onClick={() => setEmoji(e.emoji)}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-[14px] transition-all hover:bg-bg-hover ${
                emoji === e.emoji ? "bg-accent-emerald/15 ring-1 ring-accent-emerald/30" : ""
              }`}
            >
              {e.emoji}
            </button>
          ))}
        </div>
        {!emojiSearch && !showAll && EMOJI_OPTIONS.length > FEATURED_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mb-3 w-full text-center text-[11px] font-medium text-accent-emerald hover:underline"
          >
            Show more ({EMOJI_OPTIONS.length - FEATURED_COUNT} more)
          </button>
        )}
        {emojiSearch && filtered.length === 0 && (
          <p className="mb-3 text-center text-[11px] text-text-ghost">No matching icons</p>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-emerald/15 px-4 py-2 text-[12px] font-semibold text-accent-emerald ring-1 ring-accent-emerald/25 transition-all hover:bg-accent-emerald/25 disabled:opacity-40"
          >
            <IconPlus size={13} />
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
