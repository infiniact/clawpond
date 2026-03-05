import type { ChatChannel, ChatToolsConfig } from "./types";

export class ChatToolsManager {
  private config: ChatToolsConfig;

  constructor(config?: ChatToolsConfig) {
    this.config = config ?? { channels: [] };
  }

  getAll(): ChatChannel[] {
    return this.config.channels;
  }

  getById(id: string): ChatChannel | undefined {
    return this.config.channels.find((c) => c.id === id);
  }

  getByGateway(gatewayId: string): ChatChannel[] {
    return this.config.channels.filter((c) => c.gatewayId === gatewayId);
  }

  getEnabled(): ChatChannel[] {
    return this.config.channels.filter((c) => c.enabled);
  }

  add(channel: ChatChannel): void {
    this.config.channels.push(channel);
  }

  remove(id: string): void {
    this.config.channels = this.config.channels.filter((c) => c.id !== id);
  }

  update(id: string, updates: Partial<Omit<ChatChannel, "id">>): void {
    const channel = this.getById(id);
    if (channel) {
      Object.assign(channel, updates);
    }
  }

  toJSON(): ChatToolsConfig {
    return structuredClone(this.config);
  }
}
