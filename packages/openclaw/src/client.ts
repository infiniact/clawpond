import type { OpenClawConfig, OpenClawMessage, OpenClawResponse } from "./types";

export class OpenClawClient {
  private config: OpenClawConfig;

  constructor(config: OpenClawConfig) {
    this.config = config;
  }

  get endpoint(): string {
    return this.config.endpoint;
  }

  get model(): string | undefined {
    return this.config.model;
  }

  async chat(messages: OpenClawMessage[]): Promise<OpenClawResponse> {
    const response = await fetch(`${this.config.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
      }),
      signal: this.config.timeout
        ? AbortSignal.timeout(this.config.timeout)
        : undefined,
    });

    if (!response.ok) {
      throw new Error(`OpenClaw request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}
