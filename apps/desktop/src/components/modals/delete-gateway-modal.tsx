"use client";

import { useState } from "react";
import { IconSpinner, IconXCircle } from "../icons";

export function DeleteGatewayModal({
  name,
  hasFiles,
  onConfirm,
  onCancel,
}: {
  name: string;
  hasFiles: boolean;
  onConfirm: (deleteFiles: boolean) => void;
  onCancel: () => void;
}) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    await onConfirm(deleteFiles);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-xs rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <h3 className="mb-2 text-[14px] font-bold text-text-primary">Delete Gateway</h3>
        <p className="mb-4 text-[12px] text-text-secondary">
          Are you sure you want to delete <span className="font-semibold text-text-primary">{name}</span>?
        </p>

        {hasFiles && (
          <label className="mb-4 flex cursor-pointer items-center gap-2.5 rounded-lg bg-bg-elevated px-3 py-2.5 ring-1 ring-border-default transition-colors hover:bg-bg-hover">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-accent-red"
            />
            <div>
              <div className="text-[12px] font-medium text-accent-red">Also delete all config files</div>
              <div className="text-[10px] text-text-ghost">.env, docker-compose.yml, config/, workspace/</div>
            </div>
          </label>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-red/15 px-4 py-2 text-[12px] font-semibold text-accent-red ring-1 ring-accent-red/25 transition-all hover:bg-accent-red/25 disabled:opacity-40"
          >
            {deleting ? (
              <>
                <IconSpinner size={13} className="animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <IconXCircle size={13} />
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
