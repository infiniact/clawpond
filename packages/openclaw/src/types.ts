export interface OpenClawConfig {
  /** Gateway endpoint URL */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Model identifier */
  model?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

export interface OpenClawMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenClawResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: OpenClawMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
