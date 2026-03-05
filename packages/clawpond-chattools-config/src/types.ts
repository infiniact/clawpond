export type ChannelType = "webchat" | "api" | "webhook" | "custom";

export interface ChatChannel {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Channel type */
  type: ChannelType;
  /** Gateway ID this channel uses */
  gatewayId: string;
  /** Model override for this channel */
  model?: string;
  /** System prompt for this channel */
  systemPrompt?: string;
  /** Whether this channel is enabled */
  enabled: boolean;
}

export interface ChatToolsConfig {
  /** All configured chat channels */
  channels: ChatChannel[];
}
