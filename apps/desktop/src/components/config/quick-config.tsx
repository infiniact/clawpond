"use client";

import { useState, useEffect } from "react";
import {
  IconX,
  IconCheck,
  IconSpinner,
  IconCpu,
  IconHash,
  IconChevronDown,
} from "../icons";
import { PROVIDERS, CHANNELS, type ChannelConfig } from "./config-wizard";

/* ── Model Quick Config Modal ── */

export function QuickModelConfig({
  rootDir,
  onClose,
  onSaved,
}: {
  rootDir: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modelName, setModelName] = useState("");
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiEndpoint, setApiEndpoint] = useState("");

  // Image model state
  const [imageModelName, setImageModelName] = useState("");
  const [imageProviderId, setImageProviderId] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [imageApiEndpoint, setImageApiEndpoint] = useState("");

  // Load current config
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cfg = await invoke<Record<string, unknown>>("read_openclaw_config", { rootDir });
        const agents = cfg?.agents as Record<string, unknown> | undefined;
        const defaults = agents?.defaults as Record<string, unknown> | undefined;
        const rawModel = defaults?.model;
        const currentModel = typeof rawModel === "string"
          ? rawModel
          : typeof rawModel === "object" && rawModel !== null
            ? (rawModel as Record<string, unknown>).primary as string || (rawModel as Record<string, unknown>).id as string || ""
            : "";
        setModelName(currentModel);

        // Derive provider from model prefix
        const prefix = currentModel.split("/")[0];
        const matched = PROVIDERS.find((p) => p.id === prefix || p.id.startsWith(prefix));
        if (matched) {
          setProviderId(matched.id);
          setApiEndpoint(matched.apiBase || "");
        }

        // Read custom provider endpoint from models.providers if present
        const models = cfg?.models as Record<string, unknown> | undefined;
        const providers = models?.providers as Record<string, Record<string, unknown>> | undefined;
        if (providers && prefix && providers[prefix]) {
          setApiEndpoint((providers[prefix].baseUrl as string) || "");
        }

        // Load image model config
        const imageModel = defaults?.imageModel as Record<string, unknown> | undefined;
        const imageModelPrimary = (imageModel?.primary as string) || "";
        if (imageModelPrimary) {
          setImageModelName(imageModelPrimary);
          const imgPrefix = imageModelPrimary.split("/")[0];
          const imgMatched = PROVIDERS.find((p) => p.id === imgPrefix || p.id.startsWith(imgPrefix));
          if (imgMatched) {
            setImageProviderId(imgMatched.id);
            setImageApiEndpoint(imgMatched.apiBase || "");
          }
          if (providers && imgPrefix && providers[imgPrefix]) {
            setImageApiEndpoint((providers[imgPrefix].baseUrl as string) || "");
          }
        }
      } catch {
        // Config might not exist yet
      } finally {
        setLoading(false);
      }
    })();
  }, [rootDir]);

  const needsRestart = !!apiKey || !!imageApiKey; // API keys live in .env — container restart required

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // 1. Read full config, update model
      const cfg = await invoke<Record<string, unknown>>("read_openclaw_config", { rootDir });
      if (!cfg.agents) cfg.agents = {};
      const agents = cfg.agents as Record<string, unknown>;
      if (!agents.defaults) agents.defaults = {};
      const defaults = agents.defaults as Record<string, unknown>;
      defaults.model = modelName;

      // Update imageModel
      if (imageModelName) {
        defaults.imageModel = { primary: imageModelName };
      } else {
        delete defaults.imageModel;
      }

      // 2. Update custom provider if needed
      const provider = PROVIDERS.find((p) => p.id === providerId);
      const providerPrefix = providerId.split("-")[0];
      const builtinProviders = ["anthropic", "openai", "google", "openrouter", "mistral", "xai", "groq", "deepseek", "ollama"];
      if (!builtinProviders.includes(providerPrefix) && apiEndpoint) {
        const modelId = modelName.includes("/") ? modelName.split("/").slice(1).join("/") : modelName;
        if (!cfg.models) cfg.models = {};
        const models = cfg.models as Record<string, unknown>;
        if (!models.providers) models.providers = {};
        const providers = models.providers as Record<string, unknown>;
        providers[providerPrefix] = {
          baseUrl: apiEndpoint,
          api: "openai-completions",
          models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 32768 }],
        };
      }

      // 2b. Update image model custom provider if needed
      if (imageModelName && imageProviderId) {
        const imageProviderPrefix = imageProviderId.split("-")[0];
        if (!builtinProviders.includes(imageProviderPrefix) && imageApiEndpoint) {
          const imgModelId = imageModelName.includes("/") ? imageModelName.split("/").slice(1).join("/") : imageModelName;
          if (!cfg.models) cfg.models = {};
          const models = cfg.models as Record<string, unknown>;
          if (!models.providers) models.providers = {};
          const imgProviders = models.providers as Record<string, unknown>;
          imgProviders[imageProviderPrefix] = {
            baseUrl: imageApiEndpoint,
            api: "openai-completions",
            models: [{ id: imgModelId, name: imgModelId, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 32768 }],
          };
        }
      }

      // 3. Write config — gateway hot-reloads openclaw.json automatically (hybrid mode)
      const configDir = `${rootDir}/config`;
      await invoke("write_openclaw_config", { configDir, configJson: cfg });

      // 4. Update API key in .env if provided
      let needRestart = false;
      if (apiKey && provider?.envKey) {
        await invoke("update_env_value", { rootDir, key: provider.envKey, value: apiKey });
        await invoke("write_auth_profiles", { configDir, provider: providerPrefix, apiKey });
        needRestart = true;
      }

      // 4b. Write image model API key to auth-profiles if using a different provider
      if (imageModelName && imageProviderId) {
        const imgProviderPrefix = imageProviderId.split("-")[0];
        if (imgProviderPrefix !== providerPrefix) {
          const imgProvider = PROVIDERS.find((p) => p.id === imageProviderId);
          const effectiveImageKey = imageApiKey || apiKey;
          if (effectiveImageKey) {
            if (imageApiKey && imgProvider?.envKey) {
              await invoke("update_env_value", { rootDir, key: imgProvider.envKey, value: imageApiKey });
            }
            await invoke("write_auth_profiles", { configDir, provider: imgProviderPrefix, apiKey: effectiveImageKey });
            needRestart = needRestart || !!imageApiKey;
          }
        }
      }

      if (needRestart) {
        // API keys are env vars — need container restart to pick them up
        await invoke("compose_stop", { rootDir });
        await invoke("compose_start", { rootDir });
      }

      onSaved();
      onClose();
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 rounded-xl bg-bg-surface p-6 shadow-2xl ring-1 ring-border-default">
          <IconSpinner size={16} className="animate-spin text-text-ghost" />
          <span className="text-[12px] text-text-tertiary">Loading config...</span>
        </div>
      </div>
    );
  }

  const provider = PROVIDERS.find((p) => p.id === providerId);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconCpu size={16} className="text-text-secondary" />
            <h3 className="text-[14px] font-bold text-text-primary">Model Configuration</h3>
          </div>
          <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-secondary">
            <IconX size={14} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {/* Provider */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-secondary">Provider</label>
            <select
              value={providerId}
              onChange={(e) => {
                const p = PROVIDERS.find((p) => p.id === e.target.value);
                if (p) {
                  setProviderId(p.id);
                  setModelName(p.defaultModel);
                  setApiEndpoint(p.apiBase || "");
                }
              }}
              className="w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default focus:outline-none focus:ring-border-strong"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Model Name */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-secondary">Model</label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="provider/model-name"
              className="w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
            />
          </div>

          {/* API Key */}
          {providerId !== "ollama" && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-text-secondary">
                {provider?.envKey || "API Key"}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Leave empty to keep current"
                className="w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
              />
            </div>
          )}

          {/* Custom Endpoint */}
          {(providerId === "custom" || providerId === "ollama" || apiEndpoint) && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-text-secondary">API Endpoint</label>
              <input
                type="text"
                value={apiEndpoint}
                onChange={(e) => setApiEndpoint(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
              />
            </div>
          )}

          {/* ── Image Model Section ── */}
          <div className="mt-1 border-t border-border-subtle pt-3">
            <p className="mb-2 text-[11px] font-medium text-text-secondary">Image Model (optional)</p>

            {/* Image Provider */}
            <div className="mb-2">
              <label className="mb-1 block text-[11px] font-medium text-text-tertiary">Provider</label>
              <select
                value={imageProviderId}
                onChange={(e) => {
                  const p = PROVIDERS.find((p) => p.id === e.target.value);
                  if (p) {
                    setImageProviderId(p.id);
                    setImageModelName(p.defaultModel);
                    setImageApiEndpoint(p.apiBase || "");
                  } else {
                    setImageProviderId("");
                    setImageModelName("");
                    setImageApiEndpoint("");
                  }
                }}
                className="w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default focus:outline-none focus:ring-border-strong"
              >
                <option value="">None</option>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Image Model Name */}
            {imageProviderId && (
              <div className="mb-2">
                <label className="mb-1 block text-[11px] font-medium text-text-tertiary">Model</label>
                <input
                  type="text"
                  value={imageModelName}
                  onChange={(e) => setImageModelName(e.target.value)}
                  placeholder="provider/model-name"
                  className="w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
                />
              </div>
            )}

            {/* Image API Key */}
            {imageProviderId && imageProviderId !== "ollama" && (
              <div className="mb-2">
                <label className="mb-1 block text-[11px] font-medium text-text-tertiary">
                  {PROVIDERS.find((p) => p.id === imageProviderId)?.envKey || "API Key"}
                </label>
                <input
                  type="password"
                  value={imageApiKey}
                  onChange={(e) => setImageApiKey(e.target.value)}
                  placeholder="Leave empty to keep current"
                  className="w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
                />
              </div>
            )}

            {/* Image Custom Endpoint */}
            {imageProviderId && (imageProviderId === "custom" || imageProviderId === "ollama" || imageApiEndpoint) && (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-tertiary">API Endpoint</label>
                <input
                  type="text"
                  value={imageApiEndpoint}
                  onChange={(e) => setImageApiEndpoint(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full rounded-lg bg-bg-elevated px-3 py-2 text-[12px] text-text-primary ring-1 ring-border-default placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
                />
              </div>
            )}
          </div>
        </div>

        {error && <p className="mt-2 text-[11px] text-accent-red">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary hover:text-text-secondary">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !modelName}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-emerald/15 px-4 py-2 text-[12px] font-semibold text-accent-emerald ring-1 ring-accent-emerald/25 hover:bg-accent-emerald/25 disabled:opacity-40"
          >
            {saving ? <IconSpinner size={13} className="animate-spin" /> : <IconCheck size={13} />}
            {needsRestart ? "Save & Restart" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Channels Quick Config Modal ── */

export function QuickChannelsConfig({
  rootDir,
  onClose,
  onSaved,
}: {
  rootDir: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Record<string, ChannelConfig>>(
    Object.fromEntries(CHANNELS.map((ch) => [ch.id, { enabled: false, values: {} }]))
  );

  // Load current config
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cfg = await invoke<Record<string, unknown>>("read_openclaw_config", { rootDir });
        const chCfg = cfg?.channels as Record<string, Record<string, unknown>> | undefined;
        if (chCfg) {
          setChannels((prev) => {
            const updated = { ...prev };
            for (const [chId, chConf] of Object.entries(chCfg)) {
              if (updated[chId]) {
                updated[chId] = {
                  enabled: chConf.enabled !== false,
                  values: Object.fromEntries(
                    Object.entries(chConf)
                      .filter(([k]) => k !== "enabled")
                      .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v ?? "")])
                  ),
                };
              }
            }
            return updated;
          });
        }
      } catch {
        // Config might not exist yet
      } finally {
        setLoading(false);
      }
    })();
  }, [rootDir]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // Read full config
      const cfg = await invoke<Record<string, unknown>>("read_openclaw_config", { rootDir });

      // Build channels object
      const channelsCfg: Record<string, unknown> = {};
      const pluginEntries: Record<string, { enabled: boolean }> = {};

      for (const ch of CHANNELS) {
        const chConf = channels[ch.id];
        if (!chConf?.enabled) continue;
        const v = chConf.values;

        switch (ch.id) {
          case "telegram":
            channelsCfg.telegram = {
              enabled: true,
              botToken: v.botToken || "",
              dmPolicy: "pairing",
              groupPolicy: "allowlist",
              ...(v.allowedChatIds ? { allowFrom: v.allowedChatIds.split(",").map((s: string) => s.trim()).filter(Boolean) } : {}),
            };
            break;
          case "discord":
            channelsCfg.discord = {
              enabled: true,
              token: v.botToken || "",
              applicationId: v.applicationId || "",
              dmPolicy: "pairing",
              groupPolicy: "allowlist",
              ...(v.allowedGuildIds ? { allowFrom: v.allowedGuildIds.split(",").map((s: string) => s.trim()).filter(Boolean) } : {}),
            };
            break;
          case "slack":
            channelsCfg.slack = {
              enabled: true,
              botToken: v.botToken || "",
              appToken: v.appToken || "",
              ...(v.signingSecret ? { signingSecret: v.signingSecret } : {}),
              dmPolicy: "pairing",
              ...(v.allowedChannelIds ? { allowFrom: v.allowedChannelIds.split(",").map((s: string) => s.trim()).filter(Boolean) } : {}),
            };
            break;
          case "feishu":
            channelsCfg.feishu = {
              enabled: true,
              appId: v.appId || "",
              appSecret: v.appSecret || "",
              domain: "feishu",
              connectionMode: "websocket",
              dmPolicy: "pairing",
              groupPolicy: "open",
              requireMention: true,
              streaming: true,
              typingIndicator: true,
              ...(v.encryptKey ? { encryptKey: v.encryptKey } : {}),
              ...(v.allowedChatIds ? { allowFrom: v.allowedChatIds.split(",").map((s: string) => s.trim()).filter(Boolean) } : {}),
            };
            break;
        }
        pluginEntries[ch.id] = { enabled: true };
      }

      // Update config
      if (Object.keys(channelsCfg).length > 0) {
        cfg.channels = channelsCfg;
        cfg.plugins = { entries: pluginEntries };
      } else {
        delete cfg.channels;
        delete cfg.plugins;
      }

      // Write config — gateway hot-reloads channels automatically (hybrid mode)
      const configDir = `${rootDir}/config`;
      await invoke("write_openclaw_config", { configDir, configJson: cfg });

      onSaved();
      onClose();
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 rounded-xl bg-bg-surface p-6 shadow-2xl ring-1 ring-border-default">
          <IconSpinner size={16} className="animate-spin text-text-ghost" />
          <span className="text-[12px] text-text-tertiary">Loading config...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-bg-surface p-5 shadow-2xl ring-1 ring-border-default">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconHash size={16} className="text-text-secondary" />
            <h3 className="text-[14px] font-bold text-text-primary">Channel Configuration</h3>
          </div>
          <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-secondary">
            <IconX size={14} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {CHANNELS.map((ch) => {
            const chConf = channels[ch.id];
            const isEnabled = chConf?.enabled ?? false;
            return (
              <div
                key={ch.id}
                className={`rounded-lg ring-1 transition-all ${
                  isEnabled ? "bg-bg-elevated ring-accent-emerald/25" : "bg-bg-elevated ring-border-default"
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setChannels((c) => ({
                      ...c,
                      [ch.id]: { ...c[ch.id], enabled: !isEnabled },
                    }))
                  }
                  className="flex w-full items-center justify-between px-3.5 py-2.5"
                >
                  <span className={`text-[12px] font-medium ${isEnabled ? "text-accent-emerald" : "text-text-tertiary"}`}>
                    {isEnabled && <IconCheck size={12} className="mr-1.5 inline" />}
                    {ch.label}
                  </span>
                  <IconChevronDown
                    size={13}
                    className={`text-text-ghost transition-transform ${isEnabled ? "rotate-180" : ""}`}
                  />
                </button>

                {isEnabled && (
                  <div className="space-y-2.5 border-t border-border-subtle px-3.5 pb-3 pt-2.5">
                    {ch.fields.map((f) => (
                      <div key={f.key}>
                        <label className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-text-secondary">
                          {f.label}
                          {f.required && <span className="text-accent-red">*</span>}
                        </label>
                        <input
                          type={f.type || "text"}
                          value={chConf?.values[f.key] ?? ""}
                          onChange={(e) =>
                            setChannels((c) => ({
                              ...c,
                              [ch.id]: {
                                ...c[ch.id],
                                values: { ...c[ch.id].values, [f.key]: e.target.value },
                              },
                            }))
                          }
                          placeholder={f.placeholder}
                          className="w-full rounded-lg bg-bg-surface px-3 py-1.5 text-[12px] text-text-primary ring-1 ring-border-subtle placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
                        />
                        {f.hint && <p className="mt-0.5 text-[10px] text-text-ghost">{f.hint}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-2 text-[11px] text-accent-red">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary hover:text-text-secondary">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-emerald/15 px-4 py-2 text-[12px] font-semibold text-accent-emerald ring-1 ring-accent-emerald/25 hover:bg-accent-emerald/25 disabled:opacity-40"
          >
            {saving ? <IconSpinner size={13} className="animate-spin" /> : <IconCheck size={13} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
