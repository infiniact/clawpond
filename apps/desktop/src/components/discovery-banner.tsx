"use client";

import { useState } from "react";

export type DiscoveredGateway = {
  rootDir: string;
  type: string; // "local" | "docker"
  name: string;
};

/** How the discovered gateway relates to existing imports */
export type ConflictKind =
  | "new"                // rootDir & name both new — direct import
  | "name_clash"         // different rootDir but same name as existing
  | "path_exists"        // same rootDir already imported but name differs on disk
  | "duplicate";         // rootDir already imported and name matches on disk (fully duplicated — not shown)

export type ConflictAction = "import" | "overwrite" | "merge" | "delete_old" | "skip" | "rename" | "update_name";

export type DiscoveredItem = DiscoveredGateway & {
  conflict: ConflictKind;
  /** Display name of the existing gateway that conflicts */
  conflictWith?: string;
  /** ID of the existing gateway that conflicts */
  conflictId?: string;
};

export function DiscoveryBanner({
  items,
  onImport,
  onImportAll,
  onDismiss,
}: {
  items: DiscoveredItem[];
  onImport: (gw: DiscoveredItem, action: ConflictAction) => void;
  onImportAll: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (items.length === 0) return null;

  const hasConflicts = items.some((i) => i.conflict !== "new");
  const newCount = items.filter((i) => i.conflict === "new").length;

  return (
    <div className="border-b border-border-default bg-accent-emerald/5 px-4 py-2.5 text-[12px]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[14px]">{"\u{1F50D}"}</span>
        <div className="min-w-0 flex-1">
          <p className="mb-1.5 font-medium text-text-primary">
            {`\u53D1\u73B0 ${items.length} \u4E2A\u78C1\u76D8\u4E0A\u7684 Gateway`}
            {hasConflicts && (
              <span className="ml-1.5 text-accent-amber">{"\u2014 \u90E8\u5206\u9700\u8981\u786E\u8BA4"}</span>
            )}
          </p>
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <DiscoveredRow
                key={item.rootDir}
                item={item}
                expanded={expanded === item.rootDir}
                onToggle={() => setExpanded(expanded === item.rootDir ? null : item.rootDir)}
                onAction={(action) => onImport(item, action)}
              />
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {newCount > 1 && (
            <button
              onClick={onImportAll}
              className="rounded-md bg-accent-emerald/15 px-2.5 py-1 text-[11px] font-medium text-accent-emerald transition-colors hover:bg-accent-emerald/25"
            >
              {hasConflicts ? `\u5BFC\u5165\u65E0\u51B2\u7A81\u7684 ${newCount} \u4E2A` : "\u5168\u90E8\u5BFC\u5165"}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="rounded-md px-1.5 py-1 text-text-ghost transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title={"\u5173\u95ED"}
          >
            {"\u2715"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscoveredRow({
  item,
  expanded,
  onToggle,
  onAction,
}: {
  item: DiscoveredItem;
  expanded: boolean;
  onToggle: () => void;
  onAction: (action: ConflictAction) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[13px]">{item.type === "local" ? "\u{1F99E}" : "\u{1F433}"}</span>
        <span className="font-medium text-text-primary">{item.name}</span>
        <span className="truncate text-text-ghost">{item.rootDir}</span>
        {item.conflict === "new" ? (
          <button
            onClick={() => onAction("import")}
            className="ml-auto shrink-0 rounded-md bg-accent-emerald/15 px-2 py-0.5 text-[11px] font-medium text-accent-emerald transition-colors hover:bg-accent-emerald/25"
          >
            {"\u5BFC\u5165"}
          </button>
        ) : item.conflict === "name_clash" ? (
          <button
            onClick={onToggle}
            className="ml-auto shrink-0 rounded-md bg-accent-amber/15 px-2 py-0.5 text-[11px] font-medium text-accent-amber transition-colors hover:bg-accent-amber/25"
          >
            {expanded ? "\u6536\u8D77" : `\u540D\u79F0\u51B2\u7A81 \u300C${item.conflictWith}\u300D`}
          </button>
        ) : (
          /* path_exists */
          <button
            onClick={onToggle}
            className="ml-auto shrink-0 rounded-md bg-accent-blue/15 px-2 py-0.5 text-[11px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/25"
          >
            {expanded ? "\u6536\u8D77" : `\u5DF2\u5BFC\u5165\u4E3A\u300C${item.conflictWith}\u300D`}
          </button>
        )}
      </div>

      {/* name_clash: same name, different rootDir */}
      {item.conflict === "name_clash" && expanded && (
        <div className="ml-[21px] mt-1 flex flex-wrap items-center gap-2 rounded-md bg-bg-elevated px-3 py-1.5 ring-1 ring-border-default">
          <span className="text-[11px] text-text-secondary">
            {`\u5DF2\u6709\u540C\u540D Gateway\u300C${item.conflictWith}\u300D\uFF0C\u5982\u4F55\u5904\u7406\uFF1F`}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={() => onAction("overwrite")}
              className="rounded-md bg-accent-amber/15 px-2 py-0.5 text-[11px] font-medium text-accent-amber transition-colors hover:bg-accent-amber/25"
              title={"\u7528\u78C1\u76D8\u4E0A\u53D1\u73B0\u7684\u8DEF\u5F84\u8986\u76D6\u5DF2\u6709 Gateway"}
            >
              {"\u8986\u76D6"}
            </button>
            <button
              onClick={() => onAction("merge")}
              className="rounded-md bg-accent-purple/15 px-2 py-0.5 text-[11px] font-medium text-accent-purple transition-colors hover:bg-accent-purple/25"
              title={"\u5408\u5E76\u8BB0\u5FC6\uFF1A\u804A\u5929\u8BB0\u5F55 + \u5DE5\u4F5C\u533A\u6587\u4EF6\uFF0C\u540C\u540D .md \u8FFD\u52A0\u5230\u672B\u5C3E\uFF0C\u5408\u5E76\u540E\u5220\u9664\u539F\u6587\u4EF6"}
            >
              {"\u5408\u5E76\u8BB0\u5FC6"}
            </button>
            <button
              onClick={() => onAction("delete_old")}
              className="rounded-md bg-accent-red/15 px-2 py-0.5 text-[11px] font-medium text-accent-red transition-colors hover:bg-accent-red/25"
              title={"\u5220\u9664\u5DF2\u6709\u7684\u540C\u540D Gateway\uFF0C\u518D\u5BFC\u5165\u65B0\u7684"}
            >
              {"\u5220\u9664\u65E7\u7684"}
            </button>
            <button
              onClick={() => onAction("rename")}
              className="rounded-md bg-accent-emerald/15 px-2 py-0.5 text-[11px] font-medium text-accent-emerald transition-colors hover:bg-accent-emerald/25"
              title={"\u4FDD\u7559\u4E24\u4E2A\uFF0C\u65B0\u5BFC\u5165\u7684\u81EA\u52A8\u6539\u540D"}
            >
              {"\u4E24\u4E2A\u90FD\u4FDD\u7559"}
            </button>
            <button
              onClick={() => onAction("skip")}
              className="rounded-md bg-bg-hover px-2 py-0.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-elevated"
            >
              {"\u8DF3\u8FC7"}
            </button>
          </div>
        </div>
      )}

      {/* path_exists: same rootDir already imported but disk name differs */}
      {item.conflict === "path_exists" && expanded && (
        <div className="ml-[21px] mt-1 flex flex-wrap items-center gap-2 rounded-md bg-bg-elevated px-3 py-1.5 ring-1 ring-border-default">
          <span className="text-[11px] text-text-secondary">
            {`\u8BE5\u8DEF\u5F84\u5DF2\u5BFC\u5165\u4E3A\u300C${item.conflictWith}\u300D\uFF0C\u78C1\u76D8\u540D\u4E3A\u300C${item.name}\u300D`}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={() => onAction("update_name")}
              className="rounded-md bg-accent-blue/15 px-2 py-0.5 text-[11px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/25"
              title={"\u5C06\u5DF2\u5BFC\u5165\u7684 Gateway \u540D\u79F0\u66F4\u65B0\u4E3A\u78C1\u76D8\u76EE\u5F55\u540D"}
            >
              {`\u66F4\u65B0\u4E3A\u300C${item.name}\u300D`}
            </button>
            <button
              onClick={() => onAction("skip")}
              className="rounded-md bg-bg-hover px-2 py-0.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-elevated"
            >
              {"\u4FDD\u6301\u4E0D\u53D8"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
