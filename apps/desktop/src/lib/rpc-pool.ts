/**
 * RPC Connection Pool — manages WebSocket connections to multiple Gateways.
 * Lazily creates and caches OpenClawRpc instances per gateway.
 */

import { OpenClawRpc } from "./openclaw-rpc";

export type GatewayInfo = {
  id: string;
  name: string;
  emoji: string;
  serviceState: string;
  rootDir: string | null;
  busy?: boolean;
};

export class RpcPool {
  private connections = new Map<string, OpenClawRpc>();
  private connecting = new Map<string, Promise<OpenClawRpc>>();

  /** Get or create a connection to a gateway. Throws if gateway is not running or connection fails. */
  async getConnection(gateway: GatewayInfo): Promise<OpenClawRpc> {
    // Return cached connected instance
    const existing = this.connections.get(gateway.id);
    if (existing?.connected) {
      return existing;
    }

    // If already connecting, wait for that promise
    const pending = this.connecting.get(gateway.id);
    if (pending) {
      return pending;
    }

    // Create new connection
    const connectPromise = this.createConnection(gateway);
    this.connecting.set(gateway.id, connectPromise);

    try {
      const rpc = await connectPromise;
      this.connections.set(gateway.id, rpc);
      return rpc;
    } finally {
      this.connecting.delete(gateway.id);
    }
  }

  private async createConnection(gateway: GatewayInfo): Promise<OpenClawRpc> {
    const rpc = new OpenClawRpc();

    if (!gateway.rootDir) {
      throw new Error("Gateway has no rootDir");
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ port: string; token: string }>("read_gateway_info", { rootDir: gateway.rootDir });

    await rpc.connect(info.port, info.token, "127.0.0.1");
    return rpc;
  }

  /** Disconnect a specific gateway connection. */
  disconnect(gatewayId: string) {
    const conn = this.connections.get(gatewayId);
    if (conn) {
      conn.disconnect();
      this.connections.delete(gatewayId);
    }
  }

  /** Disconnect all connections. */
  disconnectAll() {
    for (const [id, conn] of this.connections) {
      conn.disconnect();
      this.connections.delete(id);
    }
  }

  /** Check if a gateway has an active connection. */
  isConnected(gatewayId: string): boolean {
    return this.connections.get(gatewayId)?.connected ?? false;
  }
}
