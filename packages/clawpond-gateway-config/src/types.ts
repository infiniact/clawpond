export interface GatewayEntry {
  /** Unique identifier for this gateway */
  id: string;
  /** Display name */
  name: string;
  /** Gateway endpoint URL */
  endpoint: string;
  /** API key for this gateway */
  apiKey: string;
  /** Whether this gateway is enabled */
  enabled: boolean;
}

export interface GatewayConfig {
  /** All configured gateways */
  gateways: GatewayEntry[];
  /** ID of the default gateway */
  defaultGatewayId?: string;
}
