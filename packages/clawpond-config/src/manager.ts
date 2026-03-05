import type { ClawpondConfig, GeneralSettings, ModelConfig } from "./types";

const DEFAULT_CONFIG: ClawpondConfig = {
  general: {
    language: "zh-CN",
    theme: "system",
    streaming: true,
  },
  models: [],
};

export class ConfigManager {
  private config: ClawpondConfig;

  constructor(config?: Partial<ClawpondConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getGeneral(): GeneralSettings {
    return this.config.general;
  }

  updateGeneral(updates: Partial<GeneralSettings>): void {
    Object.assign(this.config.general, updates);
  }

  getModels(): ModelConfig[] {
    return this.config.models;
  }

  addModel(model: ModelConfig): void {
    this.config.models.push(model);
  }

  removeModel(modelId: string): void {
    this.config.models = this.config.models.filter((m) => m.model !== modelId);
  }

  getDefaultModel(): string | undefined {
    return this.config.defaultModel;
  }

  setDefaultModel(modelId: string): void {
    this.config.defaultModel = modelId;
  }

  toJSON(): ClawpondConfig {
    return structuredClone(this.config);
  }
}
