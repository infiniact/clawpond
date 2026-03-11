"use client";

import { useState, useCallback } from "react";
import { IconDownload, IconCheck, IconSpinner, IconX, IconXCircle } from "./icons";

type ImageStatus = "idle" | "pulling" | "done" | "error";

type ImageState = {
  status: ImageStatus;
  percent: number;
  layersDone: number;
  layersTotal: number;
  error?: string;
};

const IMAGES = [
  { key: "gateway", image: "ghcr.io/openclaw/openclaw:latest", label: "OpenClaw Gateway" },
  { key: "browser", image: "mcr.microsoft.com/playwright:v1.52.0-noble", label: "Playwright Browser" },
] as const;

type ImageKey = (typeof IMAGES)[number]["key"];

export function UpdateChecker({ onClose }: { onClose: () => void }) {
  const [states, setStates] = useState<Record<ImageKey, ImageState>>({
    gateway: { status: "idle", percent: 0, layersDone: 0, layersTotal: 0 },
    browser: { status: "idle", percent: 0, layersDone: 0, layersTotal: 0 },
  });
  const [pullingAll, setPullingAll] = useState(false);

  const updateImage = useCallback((key: ImageKey, patch: Partial<ImageState>) => {
    setStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const pullImage = useCallback(async (key: ImageKey, image: string) => {
    updateImage(key, { status: "pulling", percent: 0, layersDone: 0, layersTotal: 0, error: undefined });
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
      }>("docker-pull-progress", (event) => {
        updateImage(key, {
          percent: event.payload.percent,
          layersDone: event.payload.layers_done,
          layersTotal: event.payload.layers_total,
        });
      });
      await invoke("docker_pull_image", { image });
      updateImage(key, { status: "done", percent: 100 });
    } catch (err) {
      updateImage(key, { status: "error", error: String(err) });
    } finally {
      unlisten?.();
    }
  }, [updateImage]);

  const pullAll = useCallback(async () => {
    setPullingAll(true);
    for (const img of IMAGES) {
      await pullImage(img.key, img.image);
    }
    setPullingAll(false);
  }, [pullImage]);

  const anyPulling = IMAGES.some((img) => states[img.key].status === "pulling");

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-bg-surface p-6 shadow-2xl ring-1 ring-border-default">
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
          {IMAGES.map((img) => {
            const s = states[img.key];
            return (
              <div key={img.key} className="rounded-lg bg-bg-elevated px-3.5 py-3 ring-1 ring-border-default">
                <div className="flex items-center gap-2.5">
                  {/* Status icon */}
                  {s.status === "done" ? (
                    <IconCheck size={16} className="shrink-0 text-accent-emerald" />
                  ) : s.status === "error" ? (
                    <IconXCircle size={16} className="shrink-0 text-accent-red" />
                  ) : s.status === "pulling" ? (
                    <IconSpinner size={16} className="shrink-0 animate-spin text-accent-blue" />
                  ) : (
                    <IconDownload size={16} className="shrink-0 text-text-ghost" />
                  )}

                  {/* Label */}
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-text-primary">{img.label}</div>
                    <div className="truncate text-[10px] font-mono text-text-ghost">{img.image}</div>
                  </div>

                  {/* Pull button */}
                  <button
                    onClick={() => pullImage(img.key, img.image)}
                    disabled={s.status === "pulling" || pullingAll}
                    className="shrink-0 rounded-md bg-accent-emerald/15 px-2.5 py-1 text-[11px] font-medium text-accent-emerald ring-1 ring-accent-emerald/25 transition-colors hover:bg-accent-emerald/25 disabled:opacity-40"
                  >
                    Pull
                  </button>
                </div>

                {/* Progress bar */}
                {s.status === "pulling" && (
                  <div className="mt-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-ghost">
                        {s.layersTotal > 0
                          ? `Layers ${s.layersDone}/${s.layersTotal}`
                          : "Pulling..."}
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
