"use client";

import { useState, useEffect, useRef } from "react";

type OSPlatform = "macos" | "windows" | "linux";
function detectOS(): OSPlatform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "macos";
}
import {
  IconDownload,
  IconFolder,
  IconGlobe,
  IconLayers,
  IconHash,
  IconZap,
  IconCheck,
  IconArrowRight,
  IconSpinner,
  IconXCircle,
  IconClipboard,
  IconSettings,
  IconPlay,
  IconCpu,
  IconSearch,
  IconChevronDown,
} from "./icons";

const STEPS = [
  { id: "docker", icon: IconDownload, title: "Docker Environment", desc: "Check Docker and pull the OpenClaw image" },
  { id: "directories", icon: IconFolder, title: "Directories", desc: "Configure data and workspace directories" },
  { id: "gateway", icon: IconGlobe, title: "Gateway", desc: "Configure the OpenClaw gateway service" },
  { id: "model", icon: IconCpu, title: "Chat Model", desc: "Select AI model provider and verify connectivity" },
  { id: "imageModel", icon: IconLayers, title: "Image Model", desc: "Select vision model provider (optional)" },
  { id: "channels", icon: IconHash, title: "Channels", desc: "Connect chat channels" },
  { id: "skills", icon: IconZap, title: "Skills", desc: "Enable agent skills" },
  { id: "onboard", icon: IconSettings, title: "Finish", desc: "Review and start services" },
] as const;

const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.52.0-noble";

export type Provider = {
  id: string;
  label: string;
  envKey: string;
  defaultModel: string;
  apiBase?: string;
};

export type ChannelField = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "number";
  required?: boolean;
  hint?: string;
};

export type ChannelDef = {
  id: string;
  label: string;
  fields: ChannelField[];
};

export const CHANNELS: ChannelDef[] = [
  {
    id: "telegram",
    label: "Telegram",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF...", type: "password", required: true, hint: "From @BotFather" },
      { key: "allowedChatIds", label: "Allowed Chat IDs", placeholder: "-100123456789, 987654321", hint: "Comma-separated. Leave empty to allow all" },
      { key: "rateLimit", label: "Rate Limit (msg/min)", placeholder: "30", type: "number", hint: "Max messages per minute per chat" },
    ],
  },
  {
    id: "discord",
    label: "Discord",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "MTIz...abc", type: "password", required: true, hint: "From Discord Developer Portal" },
      { key: "applicationId", label: "Application ID", placeholder: "1234567890", required: true },
      { key: "allowedGuildIds", label: "Allowed Server IDs", placeholder: "123456789, 987654321", hint: "Comma-separated. Leave empty to allow all" },
      { key: "rateLimit", label: "Rate Limit (msg/min)", placeholder: "20", type: "number", hint: "Max messages per minute per server" },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-...", type: "password", required: true, hint: "Bot User OAuth Token" },
      { key: "appToken", label: "App-Level Token", placeholder: "xapp-...", type: "password", required: true, hint: "For Socket Mode" },
      { key: "signingSecret", label: "Signing Secret", placeholder: "abc123...", type: "password", hint: "For request verification (Events API mode)" },
      { key: "allowedChannelIds", label: "Allowed Channel IDs", placeholder: "C0123ABC, C0456DEF", hint: "Comma-separated. Leave empty to allow all" },
    ],
  },
  {
    id: "feishu",
    label: "飞书",
    fields: [
      { key: "appId", label: "App ID", placeholder: "cli_abc123...", required: true },
      { key: "appSecret", label: "App Secret", placeholder: "xxx", type: "password", required: true },
      { key: "verificationToken", label: "Verification Token", placeholder: "xxx", type: "password", hint: "Event subscription verification" },
      { key: "encryptKey", label: "Encrypt Key", placeholder: "xxx", type: "password", hint: "Optional event encryption key" },
      { key: "allowedChatIds", label: "Allowed Chat IDs", placeholder: "oc_abc123, oc_def456", hint: "Comma-separated. Leave empty to allow all" },
    ],
  },
];

export type ChannelConfig = {
  enabled: boolean;
  values: Record<string, string>;
};

export const PROVIDERS: Provider[] = [
  { id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY", defaultModel: "anthropic/claude-sonnet-4-20250514" },
  { id: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY", defaultModel: "openai/gpt-4o" },
  { id: "google", label: "Google Gemini", envKey: "GEMINI_API_KEY", defaultModel: "google/gemini-2.5-pro" },
  { id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY", defaultModel: "openrouter/anthropic/claude-sonnet-4-5" },
  { id: "mistral", label: "Mistral", envKey: "MISTRAL_API_KEY", defaultModel: "mistral/mistral-large-latest" },
  { id: "xai", label: "xAI (Grok)", envKey: "XAI_API_KEY", defaultModel: "xai/grok-3" },
  { id: "groq", label: "Groq", envKey: "GROQ_API_KEY", defaultModel: "groq/llama-4-maverick" },
  { id: "deepseek", label: "DeepSeek", envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek/deepseek-chat", apiBase: "https://api.deepseek.com/v1" },
  { id: "moonshot", label: "Moonshot / Kimi", envKey: "MOONSHOT_API_KEY", defaultModel: "moonshot/kimi-k2.5", apiBase: "https://api.moonshot.ai/v1" },
  { id: "zhipu", label: "智谱 GLM", envKey: "ZHIPU_API_KEY", defaultModel: "zhipu/glm-4-plus", apiBase: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "zhipu-coding", label: "智谱 Coding", envKey: "ZHIPU_API_KEY", defaultModel: "zhipu/codegeex-4", apiBase: "https://open.bigmodel.cn/api/coding/paas/v4" },
  { id: "zhipu-intl", label: "智谱海外 (z.ai)", envKey: "ZHIPU_API_KEY", defaultModel: "zhipu/glm-4-plus", apiBase: "https://open.z.ai/api/paas/v4" },
  { id: "zhipu-intl-coding", label: "智谱海外 Coding (z.ai)", envKey: "ZHIPU_API_KEY", defaultModel: "zhipu/codegeex-4", apiBase: "https://open.z.ai/api/coding/paas/v4" },
  { id: "minimax", label: "MiniMax (海外)", envKey: "MINIMAX_API_KEY", defaultModel: "minimax/MiniMax-M2.1", apiBase: "https://api.minimax.chat/v1" },
  { id: "minimax-coding", label: "MiniMax Coding (海外)", envKey: "MINIMAX_API_KEY", defaultModel: "minimax/MiniMax-M2.1-Coder", apiBase: "https://api.minimax.chat/v1" },
  { id: "minimax-cn", label: "MiniMax (大陆)", envKey: "MINIMAX_API_KEY", defaultModel: "minimax/MiniMax-M2.1", apiBase: "https://api.minimaxi.com/v1" },
  { id: "minimax-coding-cn", label: "MiniMax Coding (大陆)", envKey: "MINIMAX_API_KEY", defaultModel: "minimax/MiniMax-M2.1-Coder", apiBase: "https://api.minimaxi.com/v1" },
  { id: "volcengine", label: "火山引擎 (豆包)", envKey: "VOLCENGINE_API_KEY", defaultModel: "volcengine/doubao-pro-32k", apiBase: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "volcengine-coding", label: "火山引擎 Coding", envKey: "VOLCENGINE_API_KEY", defaultModel: "volcengine/doubao-coder", apiBase: "https://ark.cn-beijing.volces.com/api/coding/v3" },
  { id: "qwen", label: "通义千问 (Qwen)", envKey: "DASHSCOPE_API_KEY", defaultModel: "qwen/qwen-max", apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "ollama", label: "Ollama (本地)", envKey: "", defaultModel: "ollama/llama3" },
  { id: "custom", label: "Custom", envKey: "", defaultModel: "" },
];

export function ConfigWizard({ onComplete, onClose, skipDocker, fixedRootDir, sharedDir }: { onComplete: (rootDir: string) => void; onClose?: () => void; skipDocker?: boolean; fixedRootDir?: string; sharedDir?: string }) {
  const activeSteps = STEPS.filter((s) => {
    if (skipDocker && s.id === "docker") return false;
    if (fixedRootDir && s.id === "directories") return false;
    return true;
  });
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  // For pond gateways (fixedRootDir set), auto-assign unique ports to avoid conflicts with ClawKing (18789/18790)
  const isPond = !!fixedRootDir && fixedRootDir !== "~/clawpond/clawking";
  const [config, setConfig] = useState(() => {
    let gatewayPort = "18789";
    let bridgePort = "18790";
    if (isPond) {
      // Derive a deterministic port offset from the directory name to reduce collisions
      const dirName = fixedRootDir!.split("/").pop() || "";
      let hash = 0;
      for (let i = 0; i < dirName.length; i++) {
        hash = ((hash << 5) - hash + dirName.charCodeAt(i)) | 0;
      }
      const offset = (Math.abs(hash) % 900) + 1; // 1-900 range
      gatewayPort = String(18789 + offset * 2);
      bridgePort = String(18790 + offset * 2);
    }
    return {
      // Docker
      image: "ghcr.io/openclaw/openclaw:latest",
      // Directories
      rootDir: fixedRootDir || "~/clawpond/clawking",
      // Gateway
      gatewayPort,
      bridgePort,
      gatewayBind: "lan",
      gatewayToken: "",
      // Chat Model
      modelProvider: "anthropic" as string,
      modelName: "anthropic/claude-sonnet-4-20250514",
      apiKey: "",
      apiEndpoint: "",
      // Image Model
      imageModelProvider: "" as string,
      imageModelName: "",
      imageApiKey: "",
      imageApiEndpoint: "",
      // Channels & skills
      channels: Object.fromEntries(CHANNELS.map((ch) => [ch.id, { enabled: false, values: {} } as ChannelConfig])) as Record<string, ChannelConfig>,
      skills: [] as string[],
    };
  });

  // Derive OpenClaw directories from rootDir
  const configDir = `${config.rootDir}/config`;
  const workspaceDir = `${config.rootDir}/workspace`;
  const [imageExists, setImageExists] = useState<boolean | null>(null);
  const [playwrightImageExists, setPlaywrightImageExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{
    percent: number;
    status: string;
    layers_done: number;
    layers_total: number;
    currentImage: string;
  } | null>(null);
  const [dockerStatus, setDockerStatus] = useState<{
    checking: boolean;
    docker: boolean | null;
    dockerVersion: string | null;
    compose: boolean | null;
    composeVersion: string | null;
  }>({ checking: true, docker: null, dockerVersion: null, compose: null, composeVersion: null });
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelFetching, setModelFetching] = useState(false);
  const [modelVerified, setModelVerified] = useState<boolean | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelTesting, setModelTesting] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [imageModelList, setImageModelList] = useState<string[]>([]);
  const [imageModelFetching, setImageModelFetching] = useState(false);
  const [imageModelVerified, setImageModelVerified] = useState<boolean | null>(null);
  const [imageModelError, setImageModelError] = useState<string | null>(null);
  const [imageModelTesting, setImageModelTesting] = useState(false);
  const [imageModelTestResult, setImageModelTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [portErrors, setPortErrors] = useState<{ gateway: string | null; bridge: string | null }>({ gateway: null, bridge: null });

  // Debounced port conflict checking
  useEffect(() => {
    const timer = setTimeout(async () => {
      const gp = parseInt(config.gatewayPort, 10);
      const bp = parseInt(config.bridgePort, 10);
      const errors: { gateway: string | null; bridge: string | null } = { gateway: null, bridge: null };

      if (config.gatewayPort && config.bridgePort && gp === bp) {
        errors.gateway = "Same as bridge port";
        errors.bridge = "Same as gateway port";
        setPortErrors(errors);
        return;
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (config.gatewayPort && !isNaN(gp) && gp > 0 && gp <= 65535) {
          const available = await invoke<boolean>("check_port_available", { port: gp });
          if (!available) errors.gateway = `Port ${gp} is already in use`;
        }
        if (config.bridgePort && !isNaN(bp) && bp > 0 && bp <= 65535) {
          const available = await invoke<boolean>("check_port_available", { port: bp });
          if (!available) errors.bridge = `Port ${bp} is already in use`;
        }
      } catch {
        // Ignore errors during port check
      }
      setPortErrors(errors);
    }, 500);
    return () => clearTimeout(timer);
  }, [config.gatewayPort, config.bridgePort]);

  useEffect(() => {
    checkDocker();
  }, []);

  // Pre-fill form from existing config if a gateway was previously configured
  useEffect(() => {
    if (fixedRootDir) return; // New gateways don't have existing config
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const detected = await invoke<string | null>("detect_config");
        if (!detected) return;
        const existing = await invoke<{
          image: string | null;
          gateway_port: string | null;
          bridge_port: string | null;
          gateway_bind: string | null;
          model_name: string | null;
          channels: Record<string, Record<string, unknown>> | null;
        }>("read_existing_config", { rootDir: detected });

        // Pre-read full config for image model
        let imageModelPrimary = "";
        try {
          const fullCfg = await invoke<Record<string, unknown>>("read_openclaw_config", { rootDir: detected });
          const agents = fullCfg?.agents as Record<string, unknown> | undefined;
          const defaults = agents?.defaults as Record<string, unknown> | undefined;
          const imageModel = defaults?.imageModel as Record<string, unknown> | undefined;
          imageModelPrimary = (imageModel?.primary as string) || "";
        } catch {
          // Config might not exist yet
        }

        setConfig((prev) => {
          const updated = { ...prev, rootDir: detected };
          if (existing.image) updated.image = existing.image;
          if (existing.gateway_port) updated.gatewayPort = existing.gateway_port;
          if (existing.bridge_port) updated.bridgePort = existing.bridge_port;
          if (existing.gateway_bind) updated.gatewayBind = existing.gateway_bind;
          if (existing.model_name) {
            updated.modelName = existing.model_name;
            // Derive provider from model name prefix (e.g. "anthropic/claude-..." -> "anthropic")
            const prefix = existing.model_name.split("/")[0];
            const matchedProvider = PROVIDERS.find((p) => p.id === prefix || p.id.startsWith(prefix));
            if (matchedProvider) {
              updated.modelProvider = matchedProvider.id;
              updated.apiEndpoint = matchedProvider.apiBase || "";
            }
          }
          // Pre-fill image model from agents.defaults.imageModel.primary
          if (imageModelPrimary) {
            updated.imageModelName = imageModelPrimary;
            const imgPrefix = imageModelPrimary.split("/")[0];
            const imgProvider = PROVIDERS.find((p) => p.id === imgPrefix || p.id.startsWith(imgPrefix));
            if (imgProvider) {
              updated.imageModelProvider = imgProvider.id;
              updated.imageApiEndpoint = imgProvider.apiBase || "";
            }
          }
          // Pre-fill channel configs (excluding secret fields like tokens/keys)
          if (existing.channels) {
            const secretKeys = new Set(["botToken", "token", "appToken", "signingSecret", "appSecret", "encryptKey", "verificationToken"]);
            for (const [chId, chConf] of Object.entries(existing.channels)) {
              if (updated.channels[chId]) {
                updated.channels[chId].enabled = !!(chConf as Record<string, unknown>).enabled;
                const values: Record<string, string> = {};
                for (const [k, v] of Object.entries(chConf as Record<string, unknown>)) {
                  if (k !== "enabled" && !secretKeys.has(k) && typeof v === "string") {
                    values[k] = v;
                  } else if (!secretKeys.has(k) && Array.isArray(v)) {
                    values[k] = v.join(", ");
                  }
                }
                updated.channels[chId].values = values;
              }
            }
          }
          return updated;
        });
      } catch {
        // Detection failed — keep defaults
      }
    })();
  }, [fixedRootDir]);

  // Check if Docker images already exist locally
  useEffect(() => {
    if (!config.image) {
      setImageExists(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const [openclawExists, pwExists] = await Promise.all([
          invoke<boolean>("docker_image_exists", { image: config.image }),
          invoke<boolean>("docker_image_exists", { image: PLAYWRIGHT_IMAGE }),
        ]);
        if (!cancelled) {
          setImageExists(openclawExists);
          setPlaywrightImageExists(pwExists);
        }
      } catch {
        if (!cancelled) {
          setImageExists(null);
          setPlaywrightImageExists(null);
        }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [config.image]);

  async function checkDocker() {
    setDockerStatus({ checking: true, docker: null, dockerVersion: null, compose: null, composeVersion: null });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{
        docker_installed: boolean;
        docker_version: string | null;
        compose_installed: boolean;
        compose_version: string | null;
      }>("check_docker");
      setDockerStatus({
        checking: false,
        docker: result.docker_installed,
        dockerVersion: result.docker_version,
        compose: result.compose_installed,
        composeVersion: result.compose_version,
      });
    } catch {
      setDockerStatus({ checking: false, docker: null, dockerVersion: null, compose: null, composeVersion: null });
    }
  }

  const step = activeSteps[currentStep];
  const isLast = currentStep === activeSteps.length - 1;

  // Per-step validation — determines whether the "Next" button is enabled
  const canProceed = (() => {
    switch (step.id) {
      case "docker":
        return !!dockerStatus.docker && !!dockerStatus.compose && !!imageExists && !!playwrightImageExists;
      case "directories":
        return config.rootDir.trim().length > 0;
      case "gateway": {
        const gp = parseInt(config.gatewayPort, 10);
        const bp = parseInt(config.bridgePort, 10);
        return (
          !isNaN(gp) && gp > 0 && gp <= 65535 &&
          !isNaN(bp) && bp > 0 && bp <= 65535 &&
          !portErrors.gateway && !portErrors.bridge
        );
      }
      case "model": {
        const provider = PROVIDERS.find((p) => p.id === config.modelProvider);
        const needsKey = provider && provider.envKey !== "";
        return (
          config.modelProvider.length > 0 &&
          config.modelName.trim().length > 0 &&
          (!needsKey || config.apiKey.trim().length > 0)
        );
      }
      // imageModel, channels, skills, onboard are optional / always passable
      default:
        return true;
    }
  })();

  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function handleNext() {
    setCompleted((prev) => new Set(prev).add(currentStep));
    if (isLast) {
      setStarting(true);
      setStartError(null);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const provider = PROVIDERS.find((p) => p.id === config.modelProvider);

        // Auto-generate gateway token if empty
        const gatewayToken = config.gatewayToken || crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

        // 1. Write .env + docker-compose.yml (Docker infra + API key)
        await invoke("write_compose_config", {
          rootDir: config.rootDir,
          image: config.image,
          configDir: configDir,
          workspaceDir: workspaceDir,
          gatewayPort: config.gatewayPort,
          bridgePort: config.bridgePort,
          gatewayBind: config.gatewayBind,
          gatewayToken,
          providerEnvKey: provider?.envKey || "",
          providerApiKey: config.apiKey,
          sharedDir: sharedDir || "",
        });

        // 2. Build openclaw.json following the official OpenClaw schema
        const openclawConfig: Record<string, unknown> = {
          agents: {
            defaults: {
              model: config.modelName,
              workspace: "/home/node/.openclaw/workspace",
            },
          },
          gateway: {
            mode: "local",
            auth: {
              mode: "token",
              token: gatewayToken,
            },
            controlUi: {
              dangerouslyDisableDeviceAuth: true,
              allowInsecureAuth: true,
              dangerouslyAllowHostHeaderOriginFallback: true,
              allowedOrigins: [
                "*",
              ],
            },
          },
        };

        // Add custom provider definition if the provider needs a custom baseUrl
        // Built-in providers (anthropic, openai, google, openrouter, mistral, xai, groq, deepseek)
        // don't need a models.providers entry.
        const builtinProviders = ["anthropic", "openai", "google", "openrouter", "mistral", "xai", "groq", "deepseek", "ollama"];
        const providerPrefix = config.modelProvider.split("-")[0];
        if (!builtinProviders.includes(providerPrefix)) {
          const apiBase = config.apiEndpoint || provider?.apiBase || "";
          if (apiBase) {
            // Extract the model ID (part after "provider/")
            const modelId = config.modelName.includes("/") ? config.modelName.split("/").slice(1).join("/") : config.modelName;
            openclawConfig.models = {
              providers: {
                [providerPrefix]: {
                  baseUrl: apiBase,
                  api: "openai-completions",
                  models: [{
                    id: modelId,
                    name: modelId,
                    reasoning: false,
                    input: ["text"],
                    contextWindow: 128000,
                    maxTokens: 32768,
                  }],
                },
              },
            };
          }
        }

        // Add imageModel to agents.defaults if configured
        if (config.imageModelName) {
          (openclawConfig.agents as Record<string, unknown> as { defaults: Record<string, unknown> }).defaults.imageModel = {
            primary: config.imageModelName,
          };

          // Add image model custom provider if needed and different from chat model provider
          const imageProviderPrefix = config.imageModelProvider.split("-")[0];
          if (!builtinProviders.includes(imageProviderPrefix)) {
            const imgApiBase = config.imageApiEndpoint || PROVIDERS.find((p) => p.id === config.imageModelProvider)?.apiBase || "";
            if (imgApiBase) {
              const imgModelId = config.imageModelName.includes("/") ? config.imageModelName.split("/").slice(1).join("/") : config.imageModelName;
              if (!openclawConfig.models) openclawConfig.models = { providers: {} };
              const models = openclawConfig.models as Record<string, unknown>;
              if (!models.providers) models.providers = {};
              const providers = models.providers as Record<string, unknown>;
              providers[imageProviderPrefix] = {
                baseUrl: imgApiBase,
                api: "openai-completions",
                models: [{
                  id: imgModelId,
                  name: imgModelId,
                  reasoning: false,
                  input: ["text"],
                  contextWindow: 128000,
                  maxTokens: 32768,
                }],
              };
            }
          }
        }

        // Add channel configs matching OpenClaw schema
        const channels: Record<string, unknown> = {};
        const pluginEntries: Record<string, { enabled: boolean }> = {};

        for (const ch of CHANNELS) {
          const chConf = config.channels[ch.id];
          if (!chConf?.enabled) continue;
          const v = chConf.values;

          switch (ch.id) {
            case "telegram":
              channels.telegram = {
                enabled: true,
                botToken: v.botToken || "",
                dmPolicy: "pairing",
                groupPolicy: "allowlist",
                ...(v.allowedChatIds ? { allowFrom: v.allowedChatIds.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
              };
              break;
            case "discord":
              channels.discord = {
                enabled: true,
                token: v.botToken || "",
                applicationId: v.applicationId || "",
                dmPolicy: "pairing",
                groupPolicy: "allowlist",
                ...(v.allowedGuildIds ? { allowFrom: v.allowedGuildIds.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
              };
              break;
            case "slack":
              channels.slack = {
                enabled: true,
                botToken: v.botToken || "",
                appToken: v.appToken || "",
                ...(v.signingSecret ? { signingSecret: v.signingSecret } : {}),
                dmPolicy: "pairing",
                ...(v.allowedChannelIds ? { allowFrom: v.allowedChannelIds.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
              };
              break;
            case "feishu":
              channels.feishu = {
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
                ...(v.allowedChatIds ? { allowFrom: v.allowedChatIds.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
              };
              break;
          }

          pluginEntries[ch.id] = { enabled: true };
        }

        if (Object.keys(channels).length > 0) {
          openclawConfig.channels = channels;
          openclawConfig.plugins = { entries: pluginEntries };
        }

        await invoke("write_openclaw_config", {
          configDir: configDir,
          configJson: openclawConfig,
        });

        // 3. Write auth-profiles.json for agent API key resolution
        await invoke("write_auth_profiles", {
          configDir: configDir,
          provider: providerPrefix,
          apiKey: config.apiKey,
        });

        // 3b. Write image model API key to auth-profiles if using a different provider
        if (config.imageModelName && config.imageModelProvider) {
          const imageProviderPrefix = config.imageModelProvider.split("-")[0];
          if (imageProviderPrefix !== providerPrefix) {
            const imageProvider = PROVIDERS.find((p) => p.id === config.imageModelProvider);
            const effectiveImageKey = config.imageApiKey || config.apiKey;
            if (effectiveImageKey) {
              if (config.imageApiKey && imageProvider?.envKey) {
                await invoke("update_env_value", { rootDir: config.rootDir, key: imageProvider.envKey, value: config.imageApiKey });
              }
              await invoke("write_auth_profiles", {
                configDir: configDir,
                provider: imageProviderPrefix,
                apiKey: effectiveImageKey,
              });
            }
          }
        }

        // 4. Start services
        await invoke("compose_start", { rootDir: config.rootDir });
        onComplete(config.rootDir);
      } catch (e) {
        setStartError(typeof e === "string" ? e : "Failed to start service.");
      } finally {
        setStarting(false);
      }
    } else {
      setCurrentStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  }

  async function handlePullImage() {
    setLoading(true);
    setPullError(null);
    setPullProgress({ percent: 0, status: "Starting...", layers_done: 0, layers_total: 0, currentImage: config.image });

    let unlisten: (() => void) | undefined;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      // Determine which images need pulling
      const needOpenClaw = !imageExists;
      const needPlaywright = !playwrightImageExists;
      const totalImages = (needOpenClaw ? 1 : 0) + (needPlaywright ? 1 : 0);
      let pulledCount = 0;

      unlisten = await listen<{
        percent: number;
        status: string;
        layers_done: number;
        layers_total: number;
        current_layer: string | null;
      }>("docker-pull-progress", (event) => {
        // Scale progress: each image gets an equal share of 0-100
        const imagePercent = event.payload.percent;
        const overallPercent = totalImages > 0
          ? Math.round((pulledCount * 100 + imagePercent) / totalImages)
          : imagePercent;
        setPullProgress((prev) => ({
          percent: overallPercent,
          status: event.payload.status,
          layers_done: event.payload.layers_done,
          layers_total: event.payload.layers_total,
          currentImage: prev?.currentImage || config.image,
        }));
      });

      // Pull OpenClaw image
      if (needOpenClaw) {
        setPullProgress((prev) => ({ ...prev!, currentImage: config.image }));
        await invoke("docker_pull_image", { image: config.image });
        pulledCount++;
        setImageExists(true);
      }

      // Pull Playwright image
      if (needPlaywright) {
        setPullProgress({ percent: totalImages > 1 ? 50 : 0, status: "Starting Playwright pull...", layers_done: 0, layers_total: 0, currentImage: PLAYWRIGHT_IMAGE });
        await invoke("docker_pull_image", { image: PLAYWRIGHT_IMAGE });
        pulledCount++;
        setPlaywrightImageExists(true);
      }

      setPullProgress({ percent: 100, status: "All images pulled successfully", layers_done: 0, layers_total: 0, currentImage: "" });
    } catch (e) {
      setPullError(typeof e === "string" ? e : "Failed to pull image.");
      setPullProgress(null);
    } finally {
      unlisten?.();
      setLoading(false);
    }
  }

  async function handleFetchModels() {
    const provider = PROVIDERS.find((p) => p.id === config.modelProvider);
    const endpoint = config.apiEndpoint || provider?.apiBase || "";
    setModelFetching(true);
    setModelError(null);
    setModelList([]);
    setModelVerified(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ models: string[]; error: string | null }>("fetch_provider_models", {
        provider: config.modelProvider,
        apiKey: config.apiKey,
        customEndpoint: endpoint,
      });
      if (result.error) {
        setModelError(result.error);
      } else {
        setModelList(result.models);
        setModelVerified(true);
        if (result.models.length > 0) {
          if (!config.modelName || config.modelName === provider?.defaultModel) {
            setConfig((c) => ({ ...c, modelName: result.models[0] }));
          }
        }
      }
    } catch (e) {
      setModelError(typeof e === "string" ? e : "Failed to fetch models.");
    } finally {
      setModelFetching(false);
    }
  }

  function selectProvider(p: Provider) {
    setConfig((c) => ({ ...c, modelProvider: p.id, modelName: p.defaultModel, apiEndpoint: p.apiBase || "" }));
    setModelList([]);
    setModelVerified(null);
    setModelError(null);
    setModelTestResult(null);
  }

  async function handleTestModel() {
    const provider = PROVIDERS.find((p) => p.id === config.modelProvider);
    const endpoint = config.apiEndpoint || provider?.apiBase || "";
    setModelTesting(true);
    setModelTestResult(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ success: boolean; message: string | null; error: string | null }>("test_provider_model", {
        provider: config.modelProvider,
        apiKey: config.apiKey,
        customEndpoint: endpoint,
        model: config.modelName,
      });
      setModelTestResult({
        success: result.success,
        message: result.message ?? undefined,
        error: result.error ?? undefined,
      });
    } catch (e) {
      setModelTestResult({ success: false, error: typeof e === "string" ? e : "Test failed" });
    } finally {
      setModelTesting(false);
    }
  }

  function selectImageProvider(p: Provider) {
    setConfig((c) => ({ ...c, imageModelProvider: p.id, imageModelName: p.defaultModel, imageApiEndpoint: p.apiBase || "" }));
    setImageModelList([]);
    setImageModelVerified(null);
    setImageModelError(null);
    setImageModelTestResult(null);
  }

  async function handleFetchImageModels() {
    const provider = PROVIDERS.find((p) => p.id === config.imageModelProvider);
    const endpoint = config.imageApiEndpoint || provider?.apiBase || "";
    const effectiveKey = config.imageApiKey || config.apiKey;
    setImageModelFetching(true);
    setImageModelError(null);
    setImageModelList([]);
    setImageModelVerified(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ models: string[]; error: string | null }>("fetch_provider_models", {
        provider: config.imageModelProvider,
        apiKey: effectiveKey,
        customEndpoint: endpoint,
      });
      if (result.error) {
        setImageModelError(result.error);
      } else {
        setImageModelList(result.models);
        setImageModelVerified(true);
        if (result.models.length > 0) {
          if (!config.imageModelName || config.imageModelName === provider?.defaultModel) {
            setConfig((c) => ({ ...c, imageModelName: result.models[0] }));
          }
        }
      }
    } catch (e) {
      setImageModelError(typeof e === "string" ? e : "Failed to fetch models.");
    } finally {
      setImageModelFetching(false);
    }
  }

  async function handleTestImageModel() {
    const provider = PROVIDERS.find((p) => p.id === config.imageModelProvider);
    const endpoint = config.imageApiEndpoint || provider?.apiBase || "";
    const effectiveKey = config.imageApiKey || config.apiKey;
    setImageModelTesting(true);
    setImageModelTestResult(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ success: boolean; message: string | null; error: string | null }>("test_provider_model", {
        provider: config.imageModelProvider,
        apiKey: effectiveKey,
        customEndpoint: endpoint,
        model: config.imageModelName,
      });
      setImageModelTestResult({
        success: result.success,
        message: result.message ?? undefined,
        error: result.error ?? undefined,
      });
    } catch (e) {
      setImageModelTestResult({ success: false, error: typeof e === "string" ? e : "Test failed" });
    } finally {
      setImageModelTesting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Step indicator ── */}
      <div className="relative flex shrink-0 items-center justify-center gap-1 border-b border-border-subtle px-6 py-3">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Close"
          >
            <IconXCircle size={14} />
          </button>
        )}
        {activeSteps.map((s, i) => {
          const StepIcon = s.icon;
          const done = completed.has(i);
          const active = i === currentStep;
          return (
            <div key={s.id} className="flex items-center">
              <button
                onClick={() => (done || i <= currentStep) && setCurrentStep(i)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                  active
                    ? "bg-bg-elevated text-text-primary ring-1 ring-border-default"
                    : done
                      ? "text-accent-emerald"
                      : "text-text-ghost"
                } ${done || i <= currentStep ? "cursor-pointer hover:text-text-secondary" : "cursor-default"}`}
              >
                {done ? (
                  <IconCheck size={12} className="text-accent-emerald" />
                ) : (
                  <StepIcon size={12} />
                )}
                <span className="hidden sm:inline">{s.title}</span>
              </button>
              {i < activeSteps.length - 1 && (
                <span className={`mx-1 h-px w-4 ${done ? "bg-accent-emerald/40" : "bg-border-subtle"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Step content ── */}
      <div className="flex flex-1 items-start justify-center overflow-y-auto pt-10">
        <div className="w-full max-w-md px-6">
          {/* Step header */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-surface ring-1 ring-border-default">
              <step.icon size={22} className="text-text-secondary" />
            </div>
            <h2 className="text-[16px] font-bold text-text-primary">{step.title}</h2>
            <p className="mt-1 text-[12px] text-text-tertiary">{step.desc}</p>
          </div>

          {/* Step body */}
          <div className="space-y-3">
            {/* ── Step 1: Docker Environment ── */}
            {step.id === "docker" && (
              <>
                {/* Docker environment check */}
                <div className="space-y-2 rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <p className="text-[11px] font-medium text-text-secondary">Environment Check</p>
                  <div className="space-y-1.5">
                    <EnvRow label="Docker" checking={dockerStatus.checking} ok={dockerStatus.docker} version={dockerStatus.dockerVersion} />
                    <EnvRow label="Docker Compose" checking={dockerStatus.checking} ok={dockerStatus.compose} version={dockerStatus.composeVersion} />
                  </div>
                  {!dockerStatus.checking && (!dockerStatus.docker || !dockerStatus.compose) && (
                    <DockerInstallHint dockerMissing={!dockerStatus.docker} composeMissing={!dockerStatus.compose} />
                  )}
                  {!dockerStatus.checking && (
                    <button onClick={checkDocker} className="mt-1 text-[11px] font-medium text-accent-emerald hover:underline">
                      Re-check
                    </button>
                  )}
                </div>

                <Field
                  label="OpenClaw Image"
                  value={config.image}
                  onChange={(v) => setConfig((c) => ({ ...c, image: v }))}
                  placeholder="ghcr.io/openclaw/openclaw:latest"
                  disabled={loading}
                  hint="Official image from GitHub Container Registry"
                />

                {/* Image status rows */}
                <div className="space-y-1.5 rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <p className="text-[11px] font-medium text-text-secondary">Required Images</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-[11px] text-text-tertiary">{config.image}</span>
                      {imageExists ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-accent-emerald">
                          <IconCheck size={11} />
                          Ready
                        </span>
                      ) : (
                        <span className="text-[11px] text-text-ghost">Not found</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="truncate text-[11px] text-text-tertiary">{PLAYWRIGHT_IMAGE}</span>
                      {playwrightImageExists ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-accent-emerald">
                          <IconCheck size={11} />
                          Ready
                        </span>
                      ) : (
                        <span className="text-[11px] text-text-ghost">Not found</span>
                      )}
                    </div>
                  </div>
                </div>

                {loading && pullProgress ? (
                  <div className="space-y-2 rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-text-secondary">
                        {pullProgress.layers_total > 0
                          ? `Pulling layers (${pullProgress.layers_done}/${pullProgress.layers_total})`
                          : "Pulling..."}
                      </span>
                      <span className="text-[11px] font-medium text-accent-emerald">{pullProgress.percent}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                      <div
                        className="h-full rounded-full bg-accent-emerald transition-all duration-300"
                        style={{ width: `${pullProgress.percent}%` }}
                      />
                    </div>
                    <p className="truncate text-[10px] text-text-ghost">
                      {pullProgress.currentImage ? `${pullProgress.currentImage} — ` : ""}{pullProgress.status}
                    </p>
                  </div>
                ) : pullProgress?.percent === 100 || (imageExists && playwrightImageExists) ? (
                  <div className="flex items-center gap-2 rounded-lg bg-accent-emerald/10 px-3.5 py-2.5 ring-1 ring-accent-emerald/20">
                    <IconCheck size={14} className="shrink-0 text-accent-emerald" />
                    <span className="text-[12px] font-medium text-accent-emerald">
                      {pullProgress?.percent === 100 ? "All images pulled successfully" : "All images ready"}
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={handlePullImage}
                    disabled={dockerStatus.checking || !dockerStatus.docker}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-bg-elevated py-2.5 text-[12px] font-medium text-text-primary ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-border-strong disabled:opacity-50"
                  >
                    <IconDownload size={14} />
                    {imageExists && !playwrightImageExists ? "Pull Playwright Image" : !imageExists && playwrightImageExists ? "Pull OpenClaw Image" : "Pull All Images"}
                  </button>
                )}

                {pullError && <p className="text-[11px] leading-relaxed text-accent-red">{pullError}</p>}
              </>
            )}

            {/* ── Step 2: Directories ── */}
            {step.id === "directories" && (
              <>
                <Field
                  label="Root Directory"
                  value={config.rootDir}
                  onChange={(v) => setConfig((c) => ({ ...c, rootDir: v }))}
                  placeholder="~/clawpond/clawking"
                  hint="All ClawKing data will be stored under this directory"
                />
                <div className="rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <p className="text-[11px] font-medium text-text-secondary">Mapped to OpenClaw</p>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-tertiary">OPENCLAW_CONFIG_DIR</span>
                      <code className="font-mono text-[10px] text-text-secondary">{configDir}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-tertiary">OPENCLAW_WORKSPACE_DIR</span>
                      <code className="font-mono text-[10px] text-text-secondary">{workspaceDir}</code>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <p className="text-[11px] font-medium text-text-secondary">Directory Structure</p>
                  <pre className="mt-2 font-mono text-[10px] leading-relaxed text-text-tertiary">
{`${config.rootDir}/
├── config/          ← OPENCLAW_CONFIG_DIR
│   ├── identity/
│   ├── agents/main/
│   ├── openclaw.json
│   └── ...
└── workspace/       ← OPENCLAW_WORKSPACE_DIR`}
                  </pre>
                </div>
              </>
            )}

            {/* ── Step 3: Gateway ── */}
            {step.id === "gateway" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Gateway Port"
                    value={config.gatewayPort}
                    onChange={(v) => setConfig((c) => ({ ...c, gatewayPort: v }))}
                    placeholder="18789"
                    hint="Control UI & API"
                    error={portErrors.gateway ?? undefined}
                  />
                  <Field
                    label="Bridge Port"
                    value={config.bridgePort}
                    onChange={(v) => setConfig((c) => ({ ...c, bridgePort: v }))}
                    placeholder="18790"
                    hint="Agent bridge"
                    error={portErrors.bridge ?? undefined}
                  />
                </div>
                <Field
                  label="Bind Mode"
                  value={config.gatewayBind}
                  onChange={(v) => setConfig((c) => ({ ...c, gatewayBind: v }))}
                  placeholder="lan"
                  hint={`"lan" for local network, "loopback" for localhost only`}
                />
                <Field
                  label="Gateway Token"
                  value={config.gatewayToken}
                  onChange={(v) => setConfig((c) => ({ ...c, gatewayToken: v }))}
                  placeholder="Auto-generated if empty"
                  type="password"
                  hint="Used to authenticate with the Control UI"
                />
                <div className="rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <p className="text-[11px] font-medium text-text-secondary">Docker Compose Services</p>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-text-tertiary">openclaw-gateway</span>
                      <code className="font-mono text-[10px] text-text-secondary">:{config.gatewayPort}</code>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-text-tertiary">openclaw-cli</span>
                      <span className="text-[10px] text-text-ghost">network: gateway</span>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-text-ghost">
                    Control UI: http://localhost:{config.gatewayPort}/?token=...
                  </p>
                </div>
              </>
            )}

            {/* ── Step 4: Model ── */}
            {step.id === "model" && (
              <>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-text-secondary">Provider</label>
                  <SearchableSelect
                    value={config.modelProvider}
                    onChange={(id) => {
                      const p = PROVIDERS.find((p) => p.id === id);
                      if (p) selectProvider(p);
                    }}
                    options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                    placeholder="Search providers..."
                  />
                  {(() => {
                    const p = PROVIDERS.find((p) => p.id === config.modelProvider);
                    return p?.apiBase ? (
                      <p className="mt-1 text-[10px] text-text-ghost">Endpoint: {p.apiBase}</p>
                    ) : null;
                  })()}
                </div>

                {config.modelProvider === "custom" && (
                  <Field
                    label="API Endpoint"
                    value={config.apiEndpoint}
                    onChange={(v) => setConfig((c) => ({ ...c, apiEndpoint: v }))}
                    placeholder="https://api.example.com/v1"
                    hint="OpenAI-compatible endpoint"
                  />
                )}
                {config.modelProvider === "ollama" && (
                  <Field
                    label="Ollama Endpoint"
                    value={config.apiEndpoint}
                    onChange={(v) => setConfig((c) => ({ ...c, apiEndpoint: v }))}
                    placeholder="http://127.0.0.1:11434"
                    hint="Leave empty for local default"
                  />
                )}

                {/* API Key — not needed for ollama */}
                {config.modelProvider !== "ollama" && (
                  <Field
                    label={`${PROVIDERS.find((p) => p.id === config.modelProvider)?.envKey || "API Key"}`}
                    value={config.apiKey}
                    onChange={(v) => { setConfig((c) => ({ ...c, apiKey: v })); setModelVerified(null); setModelList([]); }}
                    placeholder="sk-..."
                    type="password"
                  />
                )}

                {/* Fetch models button */}
                <button
                  onClick={handleFetchModels}
                  disabled={modelFetching || (config.modelProvider !== "ollama" && !config.apiKey)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-bg-elevated py-2.5 text-[12px] font-medium text-text-primary ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-border-strong disabled:opacity-50"
                >
                  {modelFetching ? (
                    <>
                      <IconSpinner size={14} className="animate-spin" />
                      Fetching models...
                    </>
                  ) : modelVerified ? (
                    <>
                      <IconCheck size={14} className="text-accent-emerald" />
                      Connected — {modelList.length} models
                    </>
                  ) : (
                    <>
                      <IconCpu size={14} />
                      Verify & Fetch Models
                    </>
                  )}
                </button>

                {modelError && <p className="text-[11px] leading-relaxed text-accent-red">{modelError}</p>}

                {/* Model selector — only show after successful fetch */}
                {modelList.length > 0 && (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-text-secondary">Model</label>
                    <SearchableSelect
                      value={config.modelName}
                      onChange={(v) => { setConfig((c) => ({ ...c, modelName: v })); setModelTestResult(null); }}
                      options={modelList.map((m) => ({ value: m, label: m }))}
                      placeholder="Search models..."
                    />
                  </div>
                )}

                {/* Test model button — show after model is selected */}
                {modelList.length > 0 && config.modelName && (
                  <>
                    <button
                      onClick={handleTestModel}
                      disabled={modelTesting}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-bg-elevated py-2.5 text-[12px] font-medium text-text-primary ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-border-strong disabled:opacity-50"
                    >
                      {modelTesting ? (
                        <>
                          <IconSpinner size={14} className="animate-spin" />
                          Testing model...
                        </>
                      ) : modelTestResult?.success ? (
                        <>
                          <IconCheck size={14} className="text-accent-emerald" />
                          Test passed
                        </>
                      ) : (
                        <>
                          <IconPlay size={14} />
                          Test Model
                        </>
                      )}
                    </button>
                    {modelTestResult?.success && modelTestResult.message && (
                      <p className="text-[11px] text-accent-emerald">{modelTestResult.message}</p>
                    )}
                    {modelTestResult && !modelTestResult.success && modelTestResult.error && (
                      <p className="text-[11px] leading-relaxed text-accent-red">{modelTestResult.error}</p>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Step 5: Image Model (Optional) ── */}
            {step.id === "imageModel" && (
              <>
                <p className="text-[11px] text-text-ghost">
                  This step is optional. Skip if you don&apos;t need a separate vision/image model.
                </p>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-text-secondary">Provider</label>
                  <SearchableSelect
                    value={config.imageModelProvider}
                    onChange={(id) => {
                      const p = PROVIDERS.find((p) => p.id === id);
                      if (p) selectImageProvider(p);
                    }}
                    options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                    placeholder="Search providers..."
                  />
                  {(() => {
                    const p = PROVIDERS.find((p) => p.id === config.imageModelProvider);
                    return p?.apiBase ? (
                      <p className="mt-1 text-[10px] text-text-ghost">Endpoint: {p.apiBase}</p>
                    ) : null;
                  })()}
                </div>

                {config.imageModelProvider === "custom" && (
                  <Field
                    label="API Endpoint"
                    value={config.imageApiEndpoint}
                    onChange={(v) => setConfig((c) => ({ ...c, imageApiEndpoint: v }))}
                    placeholder="https://api.example.com/v1"
                    hint="OpenAI-compatible endpoint"
                  />
                )}
                {config.imageModelProvider === "ollama" && (
                  <Field
                    label="Ollama Endpoint"
                    value={config.imageApiEndpoint}
                    onChange={(v) => setConfig((c) => ({ ...c, imageApiEndpoint: v }))}
                    placeholder="http://127.0.0.1:11434"
                    hint="Leave empty for local default"
                  />
                )}

                {config.imageModelProvider && config.imageModelProvider !== "ollama" && (
                  <Field
                    label={`${PROVIDERS.find((p) => p.id === config.imageModelProvider)?.envKey || "API Key"}`}
                    value={config.imageApiKey}
                    onChange={(v) => { setConfig((c) => ({ ...c, imageApiKey: v })); setImageModelVerified(null); setImageModelList([]); }}
                    placeholder="Leave empty to reuse chat model key"
                    type="password"
                  />
                )}

                {config.imageModelProvider && (
                  <button
                    onClick={handleFetchImageModels}
                    disabled={imageModelFetching || (config.imageModelProvider !== "ollama" && !config.imageApiKey && !config.apiKey)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-bg-elevated py-2.5 text-[12px] font-medium text-text-primary ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-border-strong disabled:opacity-50"
                  >
                    {imageModelFetching ? (
                      <>
                        <IconSpinner size={14} className="animate-spin" />
                        Fetching models...
                      </>
                    ) : imageModelVerified ? (
                      <>
                        <IconCheck size={14} className="text-accent-emerald" />
                        Connected — {imageModelList.length} models
                      </>
                    ) : (
                      <>
                        <IconCpu size={14} />
                        Verify & Fetch Models
                      </>
                    )}
                  </button>
                )}

                {imageModelError && <p className="text-[11px] leading-relaxed text-accent-red">{imageModelError}</p>}

                {imageModelList.length > 0 && (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-text-secondary">Model</label>
                    <SearchableSelect
                      value={config.imageModelName}
                      onChange={(v) => { setConfig((c) => ({ ...c, imageModelName: v })); setImageModelTestResult(null); }}
                      options={imageModelList.map((m) => ({ value: m, label: m }))}
                      placeholder="Search models..."
                    />
                  </div>
                )}

                {imageModelList.length > 0 && config.imageModelName && (
                  <>
                    <button
                      onClick={handleTestImageModel}
                      disabled={imageModelTesting}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-bg-elevated py-2.5 text-[12px] font-medium text-text-primary ring-1 ring-border-default transition-all hover:bg-bg-hover hover:ring-border-strong disabled:opacity-50"
                    >
                      {imageModelTesting ? (
                        <>
                          <IconSpinner size={14} className="animate-spin" />
                          Testing model...
                        </>
                      ) : imageModelTestResult?.success ? (
                        <>
                          <IconCheck size={14} className="text-accent-emerald" />
                          Test passed
                        </>
                      ) : (
                        <>
                          <IconPlay size={14} />
                          Test Model
                        </>
                      )}
                    </button>
                    {imageModelTestResult?.success && imageModelTestResult.message && (
                      <p className="text-[11px] text-accent-emerald">{imageModelTestResult.message}</p>
                    )}
                    {imageModelTestResult && !imageModelTestResult.success && imageModelTestResult.error && (
                      <p className="text-[11px] leading-relaxed text-accent-red">{imageModelTestResult.error}</p>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Step 6: Channels (was 5) ── */}
            {step.id === "channels" && (
              <>
                <p className="text-[12px] text-text-tertiary">Enable and configure chat channels:</p>
                <div className="space-y-2">
                  {CHANNELS.map((ch) => {
                    const chConf = config.channels[ch.id];
                    const isEnabled = chConf?.enabled ?? false;
                    return (
                      <div
                        key={ch.id}
                        className={`rounded-lg ring-1 transition-all ${
                          isEnabled ? "bg-bg-surface ring-accent-emerald/25" : "bg-bg-surface ring-border-default"
                        }`}
                      >
                        {/* Channel header toggle */}
                        <button
                          type="button"
                          onClick={() =>
                            setConfig((c) => ({
                              ...c,
                              channels: {
                                ...c.channels,
                                [ch.id]: { ...c.channels[ch.id], enabled: !isEnabled },
                              },
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

                        {/* Channel config fields */}
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
                                    setConfig((c) => ({
                                      ...c,
                                      channels: {
                                        ...c.channels,
                                        [ch.id]: {
                                          ...c.channels[ch.id],
                                          values: { ...c.channels[ch.id].values, [f.key]: e.target.value },
                                        },
                                      },
                                    }))
                                  }
                                  placeholder={f.placeholder}
                                  className="w-full rounded-lg bg-bg-elevated px-3 py-1.5 text-[12px] text-text-primary ring-1 ring-border-subtle placeholder:text-text-ghost focus:outline-none focus:ring-border-strong"
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
              </>
            )}

            {/* ── Step 6: Skills ── */}
            {step.id === "skills" && (
              <>
                <p className="text-[12px] text-text-tertiary">Enable agent skills:</p>
                <div className="grid grid-cols-2 gap-2">
                  {["Web Search", "Code Exec", "File I/O", "API Call", "RAG", "Vision"].map((sk) => (
                    <ToggleChip
                      key={sk}
                      label={sk}
                      active={config.skills.includes(sk)}
                      onToggle={() =>
                        setConfig((c) => ({
                          ...c,
                          skills: c.skills.includes(sk)
                            ? c.skills.filter((x) => x !== sk)
                            : [...c.skills, sk],
                        }))
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {/* ── Step 7: Finish ── */}
            {step.id === "onboard" && (
              <>
                <div className="rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <p className="text-[11px] font-medium text-text-secondary">Configuration Summary</p>
                  <div className="mt-2 space-y-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="text-text-ghost">Image</span>
                      <code className="font-mono text-[10px] text-text-secondary">{config.image}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-ghost">Root</span>
                      <code className="font-mono text-[10px] text-text-secondary">{config.rootDir}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-ghost">Gateway</span>
                      <code className="font-mono text-[10px] text-text-secondary">:{config.gatewayPort}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-ghost">Model</span>
                      <code className="font-mono text-[10px] text-text-secondary">
                        {PROVIDERS.find((p) => p.id === config.modelProvider)?.label} / {config.modelName}
                      </code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-ghost">Image Model</span>
                      <code className="font-mono text-[10px] text-text-secondary">
                        {config.imageModelName
                          ? `${PROVIDERS.find((p) => p.id === config.imageModelProvider)?.label || config.imageModelProvider} / ${config.imageModelName}`
                          : "Not configured"}
                      </code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-ghost">Channels</span>
                      <code className="font-mono text-[10px] text-text-secondary">
                        {(() => {
                          const enabled = CHANNELS.filter((ch) => config.channels[ch.id]?.enabled);
                          return enabled.length > 0 ? enabled.map((ch) => ch.label).join(", ") : "None";
                        })()}
                      </code>
                    </div>
                  </div>
                </div>

                <p className="text-[12px] leading-relaxed text-text-secondary">
                  Clicking <strong className="text-text-primary">Complete Setup</strong> will generate:
                </p>
                <div className="rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <code className="shrink-0 rounded bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-tertiary">.env</code>
                      <span className="text-text-ghost">Docker 环境变量、API Key</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="shrink-0 rounded bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-tertiary">docker-compose.yml</code>
                      <span className="text-text-ghost">容器编排配置</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="shrink-0 rounded bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-tertiary">config/openclaw.json</code>
                      <span className="text-text-ghost">模型、频道、技能配置</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-bg-surface px-3.5 py-3 ring-1 ring-border-default">
                  <p className="text-[11px] font-medium text-text-secondary">Need more configuration?</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
                    After setup, run the full onboarding wizard for advanced options:
                  </p>
                  <div className="mt-2">
                    <CmdBlock
                      cmd="docker compose run --rm openclaw-cli onboard"
                      label="Advanced onboarding (sandbox, extra mounts, etc.)"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Navigation */}
          <div className="mt-8 flex flex-col gap-2">
            {startError && <p className="text-[11px] text-accent-red">{startError}</p>}
            <div className="flex items-center justify-between">
              <button
                onClick={handleBack}
                disabled={currentStep === 0 || starting}
                className="rounded-lg px-4 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary disabled:invisible"
              >
                Back
              </button>
              <button
                onClick={handleNext}
                disabled={starting || !canProceed}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-emerald/15 px-5 py-2 text-[12px] font-semibold text-accent-emerald ring-1 ring-accent-emerald/25 transition-all hover:bg-accent-emerald/25 disabled:opacity-50"
              >
                {starting ? (
                  <>
                    <IconSpinner size={13} className="animate-spin" />
                    Starting...
                  </>
                ) : isLast ? (
                  <>
                    Complete Setup
                    <IconPlay size={13} />
                  </>
                ) : (
                  <>
                    Next
                    <IconArrowRight size={13} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-text-secondary">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full rounded-lg bg-bg-surface px-3 py-2 text-[12px] text-text-primary ring-1 placeholder:text-text-ghost focus:outline-none disabled:opacity-50 ${
          error
            ? "ring-red-500 focus:ring-red-500"
            : "ring-border-default focus:ring-border-strong"
        }`}
      />
      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
      {!error && hint && <p className="mt-1 text-[10px] text-text-ghost">{hint}</p>}
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-center rounded-lg py-2 text-[12px] font-medium transition-all ${
        active
          ? "bg-accent-emerald/15 text-accent-emerald ring-1 ring-accent-emerald/25"
          : "bg-bg-surface text-text-tertiary ring-1 ring-border-default hover:bg-bg-elevated hover:text-text-secondary"
      }`}
    >
      {active && <IconCheck size={12} className="mr-1.5" />}
      {label}
    </button>
  );
}

function EnvRow({
  label,
  checking,
  ok,
  version,
}: {
  label: string;
  checking: boolean;
  ok: boolean | null;
  version?: string | null;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      {checking ? (
        <IconSpinner size={12} className="animate-spin text-text-ghost" />
      ) : ok ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-accent-emerald">
          <IconCheck size={11} />
          {version ? <span className="max-w-[160px] truncate text-[10px] font-normal text-text-ghost">{version}</span> : "Installed"}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[11px] font-medium text-accent-red">
          <IconXCircle size={11} />
          Not found
        </span>
      )}
    </div>
  );
}

function DockerInstallHint({ dockerMissing, composeMissing }: { dockerMissing: boolean; composeMissing: boolean }) {
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const p = await invoke<string>("detect_platform");
        setPlatform(p);
      } catch {
        setPlatform(detectOS());
      }
    })();
  }, []);

  if (!platform) return null;

  if (platform === "windows") {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[11px] font-medium text-accent-red">
          Missing dependencies detected. Please install Docker Desktop for Windows:
        </p>
        <div className="space-y-1">
          <LinkBlock
            url="https://docs.docker.com/desktop/setup/install/windows-install/"
            label="Download Docker Desktop for Windows (includes Docker Compose)"
          />
          <p className="text-[10px] text-text-ghost">
            Docker Desktop includes both Docker Engine and Docker Compose. After installation, launch Docker Desktop and ensure it is running.
          </p>
        </div>
      </div>
    );
  }

  if (platform.startsWith("linux")) {
    const isDeb = platform === "linux-deb";
    const isRpm = platform === "linux-rpm";
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[11px] font-medium text-accent-red">
          Missing dependencies detected. Install via terminal:
        </p>
        <div className="space-y-1">
          {dockerMissing && isDeb && (
            <CmdBlock cmd="sudo apt-get update && sudo apt-get install -y docker.io" label="Install Docker (Debian/Ubuntu)" />
          )}
          {dockerMissing && isRpm && (
            <CmdBlock cmd="sudo dnf install -y docker-ce docker-ce-cli containerd.io" label="Install Docker (Fedora/RHEL)" />
          )}
          {dockerMissing && !isDeb && !isRpm && (
            <CmdBlock cmd="curl -fsSL https://get.docker.com | sh" label="Install Docker (Linux)" />
          )}
          {composeMissing && isDeb && (
            <CmdBlock cmd="sudo apt-get install -y docker-compose-plugin" label="Install Docker Compose (Debian/Ubuntu)" />
          )}
          {composeMissing && isRpm && (
            <CmdBlock cmd="sudo dnf install -y docker-compose-plugin" label="Install Docker Compose (Fedora/RHEL)" />
          )}
          {composeMissing && !isDeb && !isRpm && (
            <CmdBlock cmd="sudo mkdir -p /usr/local/lib/docker/cli-plugins && sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m) -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose" label="Install Docker Compose (Linux)" />
          )}
        </div>
        <p className="text-[10px] text-text-ghost">
          After installation, ensure Docker is running: <code className="rounded bg-bg-elevated px-1 py-px font-mono text-[10px]">sudo systemctl start docker</code>
        </p>
      </div>
    );
  }

  // macOS (default)
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] font-medium text-accent-red">
        Missing dependencies detected. Install via terminal:
      </p>
      <div className="space-y-1">
        {dockerMissing && (
          <CmdBlock cmd="brew install colima docker && colima start" label="Install Docker runtime (macOS)" />
        )}
        {composeMissing && (
          <CmdBlock cmd="brew install docker-compose" label="Install Docker Compose" />
        )}
      </div>
    </div>
  );
}

function LinkBlock({ url, label }: { url: string; label: string }) {
  async function handleOpen() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_url_in_window", { url, title: label });
    } catch {
      window.open(url, "_blank");
    }
  }

  return (
    <div>
      <p className="mb-0.5 text-[10px] text-text-ghost">{label}</p>
      <div className="flex items-center gap-1.5 rounded-md bg-bg-elevated px-2.5 py-1.5 ring-1 ring-border-subtle">
        <button
          onClick={handleOpen}
          className="flex-1 text-left font-mono text-[11px] text-accent-emerald hover:underline"
        >
          {url}
        </button>
      </div>
    </div>
  );
}

function CmdBlock({ cmd, label }: { cmd: string; label: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <p className="mb-0.5 text-[10px] text-text-ghost">{label}</p>
      <div className="flex items-center gap-1.5 rounded-md bg-bg-elevated px-2.5 py-1.5 ring-1 ring-border-subtle">
        <code className="flex-1 select-all font-mono text-[11px] text-text-secondary">{cmd}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded p-0.5 text-text-ghost transition-colors hover:text-text-secondary"
          title="Copy to clipboard"
        >
          {copied ? <IconCheck size={12} className="text-accent-emerald" /> : <IconClipboard size={12} />}
        </button>
      </div>
    </div>
  );
}

function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="flex w-full items-center justify-between rounded-lg bg-bg-surface px-3.5 py-2.5 text-[12px] text-text-primary ring-1 ring-border-default transition-colors hover:ring-border-strong focus:outline-none focus:ring-border-strong"
      >
        <span className="truncate">{selectedLabel}</span>
        <IconChevronDown size={14} className={`ml-2 shrink-0 text-text-ghost transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg bg-bg-surface shadow-lg ring-1 ring-border-default">
          <div className="flex items-center gap-2.5 border-b border-border-subtle px-3.5 py-2.5">
            <IconSearch size={14} className="shrink-0 text-text-ghost" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-transparent text-[12px] text-text-primary placeholder:text-text-ghost focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setSearch("");
                } else if (e.key === "Enter" && filtered.length > 0) {
                  onChange(filtered[0].value);
                  setOpen(false);
                  setSearch("");
                }
              }}
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3.5 py-2.5 text-[11px] text-text-ghost">No results</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12px] transition-colors hover:bg-bg-hover ${
                    o.value === value ? "text-accent-emerald" : "text-text-primary"
                  }`}
                >
                  {o.value === value && <IconCheck size={12} className="shrink-0" />}
                  <span className={o.value === value ? "" : "pl-[20px]"}>{o.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
