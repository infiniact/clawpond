"use client";

import { useState, useCallback, useEffect } from "react";
import { IconDownload, IconCheck, IconSpinner, IconX, IconXCircle } from "../icons";

type ImageStatus = "idle" | "checking" | "pulling" | "done" | "error";
type UpdateState = "unknown" | "not_installed" | "up_to_date" | "update_available";

type ImageState = {
  status: ImageStatus;
  percent: number;
  layersDone: number;
  layersTotal: number;
  bytesDownloaded: number;
  bytesTotal: number;
  error?: string;
  updateState: UpdateState;
  localDigest?: string;
  remoteDigest?: string;
};

type ImageEntry = {
  key: string;
  image: string;
  label: string;
};

const GATEWAY_IMAGE: ImageEntry = { key: "gateway", image: "ghcr.io/openclaw/openclaw:latest", label: "OpenClaw Gateway" };

function shortDigest(digest: string | undefined): string {
  if (!digest) return "-";
  // sha256:abc123... → abc123...（取前12位）
  const raw = digest.replace(/^sha256:/, "");
  return raw.slice(0, 12);
}

export function UpdateChecker({ onClose }: { onClose: () => void }) {
  const [images, setImages] = useState<ImageEntry[]>([
    GATEWAY_IMAGE,
    { key: "browser", image: "mcr.microsoft.com/playwright:v1.52.0-noble", label: "Playwright Browser" },
  ]);
  const [states, setStates] = useState<Record<string, ImageState>>({
    gateway: { status: "checking", percent: 0, layersDone: 0, layersTotal: 0, bytesDownloaded: 0, bytesTotal: 0, updateState: "unknown" },
    browser: { status: "checking", percent: 0, layersDone: 0, layersTotal: 0, bytesDownloaded: 0, bytesTotal: 0, updateState: "unknown" },
  });
  const [pullingAll, setPullingAll] = useState(false);

  const updateImage = useCallback((key: string, patch: Partial<ImageState>) => {
    setStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  // Resolve playwright image and check updates on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");

        // Resolve latest playwright image
        let browserImage = "mcr.microsoft.com/playwright:v1.52.0-noble";
        try {
          const resolved = await invoke<string>("resolve_playwright_image");
          if (!cancelled && resolved) {
            browserImage = resolved;
            setImages((prev) =>
              prev.map((img) => (img.key === "browser" ? { ...img, image: resolved } : img))
            );
          }
        } catch {
          // Keep fallback
        }

        // Check update status for all images
        const imageMap: Record<string, string> = {
          gateway: GATEWAY_IMAGE.image,
          browser: browserImage,
        };

        for (const [key, image] of Object.entries(imageMap)) {
          if (cancelled) break;
          try {
            const info = await invoke<{
              installed: boolean;
              local_digest: string | null;
              remote_digest: string | null;
              needs_update: boolean;
            }>("check_image_update", { image });

            if (!cancelled) {
              const updateState: UpdateState = !info.installed
                ? "not_installed"
                : info.needs_update
                  ? "update_available"
                  : "up_to_date";
              updateImage(key, {
                status: "idle",
                updateState,
                localDigest: info.local_digest ?? undefined,
                remoteDigest: info.remote_digest ?? undefined,
              });
            }
          } catch {
            if (!cancelled) {
              updateImage(key, { status: "idle", updateState: "unknown" });
            }
          }
        }
      } catch {
        if (!cancelled) {
          updateImage("gateway", { status: "idle", updateState: "unknown" });
          updateImage("browser", { status: "idle", updateState: "unknown" });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pullImage = useCallback(async (key: string, image: string) => {
    updateImage(key, { status: "pulling", percent: 0, layersDone: 0, layersTotal: 0, bytesDownloaded: 0, bytesTotal: 0, error: undefined });
    let unlisten: (() => void) | undefined;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{
        percent: number;
        status: string;
        layers_done: number;
        layers_total: number;
        current_layer: string | null;
        bytes_downloaded: number;
        bytes_total: number;
      }>("docker-pull-progress", (event) => {
        updateImage(key, {
          percent: event.payload.percent,
          layersDone: event.payload.layers_done,
          layersTotal: event.payload.layers_total,
          bytesDownloaded: event.payload.bytes_downloaded,
          bytesTotal: event.payload.bytes_total,
        });
      });
      await invoke("docker_pull_image", { image });

      // Re-check digest after pull
      try {
        const info = await invoke<{
          installed: boolean;
          local_digest: string | null;
          remote_digest: string | null;
          needs_update: boolean;
        }>("check_image_update", { image });
        updateImage(key, {
          status: "done",
          percent: 100,
          updateState: "up_to_date",
          localDigest: info.local_digest ?? undefined,
          remoteDigest: info.remote_digest ?? undefined,
        });
      } catch {
        updateImage(key, { status: "done", percent: 100, updateState: "up_to_date" });
      }
    } catch (err) {
      updateImage(key, { status: "error", error: String(err) });
    } finally {
      unlisten?.();
    }
  }, [updateImage]);

  const pullAll = useCallback(async () => {
    setPullingAll(true);
    for (const img of images) {
      await pullImage(img.key, img.image);
    }
    setPullingAll(false);
  }, [pullImage, images]);

  const anyPulling = images.some((img) => states[img.key]?.status === "pulling");

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl bg-bg-surface p-6 shadow-2xl ring-1 ring-border-default">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-text-primary">Check for Updates</h2>
          <button onClick={onClose} className="text-text-ghost hover:text-text-secondary">
            <IconX size={16} />
          </button>
        </div>

        {/* Pull All */}
        <button
          onClick={pullAll}
          disabled={anyPulling || pullingAll}
          className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-blue px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-accent-blue/90 disabled:opacity-40"
        >
          {pullingAll ? (
            <>
              <IconSpinner size={14} className="animate-spin" />
              Pulling All...
            </>
          ) : (
            <>
              <IconDownload size={14} />
              Pull All
            </>
          )}
        </button>

        {/* Image rows */}
        <div className="space-y-3">
          {images.map((img) => {
            const s = states[img.key];
            if (!s) return null;
            return (
              <div key={img.key} className="rounded-lg bg-bg-elevated px-3.5 py-3 ring-1 ring-border-default">
                <div className="flex items-center gap-2.5">
                  {/* Status icon */}
                  {s.status === "done" ? (
                    <IconCheck size={16} className="shrink-0 text-accent-emerald" />
                  ) : s.status === "error" ? (
                    <IconXCircle size={16} className="shrink-0 text-accent-red" />
                  ) : s.status === "pulling" || s.status === "checking" ? (
                    <IconSpinner size={16} className="shrink-0 animate-spin text-accent-blue" />
                  ) : (
                    <IconDownload size={16} className="shrink-0 text-text-ghost" />
                  )}

                  {/* Label + update state */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-text-primary">{img.label}</span>
                      {s.status !== "checking" && s.status !== "pulling" && (
                        <UpdateBadge state={s.updateState} />
                      )}
                    </div>
                    <div className="truncate text-[10px] font-mono text-text-ghost">{img.image}</div>
                  </div>

                  {/* Pull button */}
                  <button
                    onClick={() => pullImage(img.key, img.image)}
                    disabled={s.status === "pulling" || s.status === "checking" || pullingAll}
                    className="shrink-0 rounded-md bg-accent-emerald/15 px-2.5 py-1 text-[11px] font-medium text-accent-emerald ring-1 ring-accent-emerald/25 transition-colors hover:bg-accent-emerald/25 disabled:opacity-40"
                  >
                    Pull
                  </button>
                </div>

                {/* Digest details — shown when we have digest info and not currently pulling */}
                {s.status !== "pulling" && s.status !== "checking" && (s.localDigest || s.remoteDigest) && (
                  <div className="mt-2 space-y-0.5 rounded-md bg-bg-deep/60 px-2.5 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-ghost">Local</span>
                      <span className={`font-mono text-[10px] ${s.localDigest ? "text-text-secondary" : "text-text-ghost"}`}>
                        {shortDigest(s.localDigest)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-ghost">Remote</span>
                      <span className={`font-mono text-[10px] ${s.remoteDigest ? "text-text-secondary" : "text-text-ghost"}`}>
                        {shortDigest(s.remoteDigest)}
                      </span>
                    </div>
                    {s.localDigest && s.remoteDigest && s.localDigest !== s.remoteDigest && (
                      <div className="mt-0.5 text-[9px] text-accent-blue">Digest mismatch — pull to update</div>
                    )}
                    {s.localDigest && s.remoteDigest && s.localDigest === s.remoteDigest && (
                      <div className="mt-0.5 text-[9px] text-accent-emerald">Digests match</div>
                    )}
                  </div>
                )}

                {/* Progress bar */}
                {s.status === "pulling" && (
                  <div className="mt-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-ghost">
                        {s.layersTotal > 0
                          ? `Layers ${s.layersDone}/${s.layersTotal}`
                          : "Pulling..."}
                        {s.bytesTotal > 0 && (
                          <span className="ml-1.5 font-mono">
                            {formatBytes(s.bytesDownloaded)}/{formatBytes(s.bytesTotal)}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] font-medium text-accent-emerald">{s.percent}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-deep">
                      <div
                        className="h-full rounded-full bg-accent-emerald transition-all duration-300"
                        style={{ width: `${s.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Error message */}
                {s.status === "error" && s.error && (
                  <p className="mt-2 truncate text-[10px] text-accent-red">{s.error}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-default px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function UpdateBadge({ state }: { state: UpdateState }) {
  switch (state) {
    case "up_to_date":
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-accent-emerald/15 px-1.5 py-0.5 text-[9px] font-medium text-accent-emerald">
          <IconCheck size={9} />
          Up to date
        </span>
      );
    case "update_available":
      return (
        <span className="inline-flex items-center rounded-full bg-accent-blue/15 px-1.5 py-0.5 text-[9px] font-medium text-accent-blue">
          Update available
        </span>
      );
    case "not_installed":
      return (
        <span className="inline-flex items-center rounded-full bg-bg-deep px-1.5 py-0.5 text-[9px] font-medium text-text-ghost">
          Not installed
        </span>
      );
    default:
      return null;
  }
}
