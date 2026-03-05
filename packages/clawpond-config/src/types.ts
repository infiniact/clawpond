export interface ModelConfig {
  /** Model identifier */
  model: string;
  /** Display name */
  displayName: string;
  /** Max tokens for this model */
  maxTokens?: number;
  /** Temperature setting */
  temperature?: number;
  /** Top-p setting */
  topP?: number;
}

export interface GeneralSettings {
  /** Application language */
  language: string;
  /** Theme: light, dark, or system */
  theme: "light" | "dark" | "system";
  /** Whether to stream responses */
  streaming: boolean;
}

export interface ClawpondConfig {
  /** General application settings */
  general: GeneralSettings;
  /** Available model configurations */
  models: ModelConfig[];
  /** Default model identifier */
  defaultModel?: string;
}
