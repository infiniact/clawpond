import type { GatewayConfig, GatewayEntry } from "./types";

export class GatewayManager {
  private config: GatewayConfig;

  constructor(config?: GatewayConfig) {
    this.config = config ?? { gateways: [] };
  }

  getAll(): GatewayEntry[] {
    return this.config.gateways;
  }

  getById(id: string): GatewayEntry | undefined {
    return this.config.gateways.find((g) => g.id === id);
  }

  getDefault(): GatewayEntry | undefined {
    if (!this.config.defaultGatewayId) return this.config.gateways[0];
    return this.getById(this.config.defaultGatewayId);
  }

  add(entry: GatewayEntry): void {
    this.config.gateways.push(entry);
  }

  remove(id: string): void {
    this.config.gateways = this.config.gateways.filter((g) => g.id !== id);
    if (this.config.defaultGatewayId === id) {
      this.config.defaultGatewayId = undefined;
    }
  }

  update(id: string, updates: Partial<Omit<GatewayEntry, "id">>): void {
    const entry = this.getById(id);
    if (entry) {
      Object.assign(entry, updates);
    }
  }

  setDefault(id: string): void {
    this.config.defaultGatewayId = id;
  }

  toJSON(): GatewayConfig {
    return structuredClone(this.config);
  }
}
