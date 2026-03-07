/**
 * OpenClaw Gateway WebSocket RPC client.
 *
 * Protocol: OpenClaw Gateway WS Protocol v3
 * Frame types:
 *   Request:  { type: "req", id, method, params }
 *   Response: { type: "res", id, result?, error? }
 *   Event:    { type: "event", event, payload? }
 *
 * Handshake:
 *   1. Server sends connect.challenge { nonce, ts }
 *   2. Client sends connect request with auth token
 *   3. Server responds with hello-ok
 */

export type RpcEvent = {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type DisconnectListener = (reason: string) => void;

export class OpenClawRpc {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<string | number, PendingCall>();
  private listeners = new Set<(event: RpcEvent) => void>();
  private disconnectListeners = new Set<DisconnectListener>();
  private _connected = false;
  private _authenticated = false;
  private token = "";
  private connectId = "";
  private _host = "";
  private _port = "";

  get connected() {
    return this._connected && this._authenticated;
  }

  /** Returns the host:port of the current (or last attempted) connection. */
  get currentTarget(): string {
    return `${this._host}:${this._port}`;
  }

  connect(port: string, token: string, host: string = "127.0.0.1"): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.disconnect();
      }

      this.token = token;
      this._host = host;
      this._port = port;
      this._authenticated = false;

      const url = token
        ? `ws://${host}:${port}?token=${encodeURIComponent(token)}`
        : `ws://${host}:${port}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      // Track whether we resolved/rejected already
      let settled = false;

      ws.onopen = () => {
        this._connected = true;
        console.log("[rpc] ws open");
      };

      ws.onerror = (e) => {
        console.error("[rpc] ws error", e);
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
      };

      ws.onclose = (ev) => {
        console.warn("[rpc] ws close", ev.code, ev.reason);
        const wasAuthenticated = this._authenticated;
        this._connected = false;
        this._authenticated = false;
        // Reject all pending calls
        for (const [, p] of this.pending) {
          p.reject(new Error("Connection closed"));
        }
        this.pending.clear();

        if (!settled) {
          settled = true;
          reject(new Error(ev.reason || "Connection closed before handshake"));
        }

        // Notify disconnect listeners
        const reason = ev.reason || (wasAuthenticated ? "Connection lost" : "Handshake failed");
        for (const listener of this.disconnectListeners) {
          listener(reason);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("[rpc] recv", data.type, data.event || data.method || "");
          // Handle connect.challenge during handshake
          if (!this._authenticated && data.type === "event" && data.event === "connect.challenge") {
            this.handleChallenge(data.payload);
            return;
          }

          // Handle hello-ok response to our connect request
          if (!this._authenticated && data.type === "res" && data.id === this.connectId) {
            if (data.ok === false || data.error) {
              const err = (data.error || data.payload || {}) as Record<string, string>;
              if (!settled) {
                settled = true;
                reject(new Error(err.message || err.code || "Connect rejected"));
              }
              this.ws?.close();
              return;
            }
            // hello-ok
            this._authenticated = true;
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }

          this.handleMessage(data);
        } catch {
          // Ignore non-JSON messages
        }
      };

      // Timeout handshake after 15s
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Handshake timeout"));
          this.ws?.close();
        }
      }, 15000);
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this._connected = false;
      this._authenticated = false;
    }
  }

  /** Call an RPC method and wait for result. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this._authenticated) {
        reject(new Error("Not connected"));
        return;
      }

      const id = this.generateId();
      this.pending.set(id, { resolve, reject });

      this.ws.send(
        JSON.stringify({
          type: "req",
          id,
          method,
          params: params ?? {},
        })
      );

      // Timeout after 60s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 60000);
    });
  }

  /** Send a fire-and-forget notification (no id, no response expected). */
  notify(method: string, params?: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this._authenticated) return;
    this.ws.send(
      JSON.stringify({
        type: "req",
        method,
        params: params ?? {},
      })
    );
  }

  /** Subscribe to server-push events. */
  onEvent(listener: (event: RpcEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to disconnect events. */
  onDisconnect(listener: DisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private generateId(): string {
    return `${this.nextId++}-${Date.now().toString(36)}`;
  }

  private handleChallenge(payload: { nonce: string; ts: number }) {
    this.connectId = this.generateId();

    // Send connect request with token auth (no device identity — requires dangerouslyDisableDeviceAuth)
    const connectReq = {
      type: "req",
      id: this.connectId,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "webchat",
          version: "1.0.0",
          platform: navigator.platform || "desktop",
          mode: "webchat",
        },
        role: "operator",
        scopes: [
          "operator.read",
          "operator.write",
          "operator.admin",
          "operator.approvals",
          "operator.pairing",
        ],
        auth: {
          token: this.token,
        },
        locale: navigator.language || "en",
        userAgent: navigator.userAgent,
      },
    };

    console.log("[rpc] send connect (role=%s, scopes=%d)", connectReq.params.role, connectReq.params.scopes.length);
    this.ws?.send(JSON.stringify(connectReq));
  }

  private handleMessage(data: Record<string, unknown>) {
    // Response frame (has type: "res" and id)
    if (data.type === "res" && data.id != null && this.pending.has(data.id as string | number)) {
      const pending = this.pending.get(data.id as string | number)!;
      this.pending.delete(data.id as string | number);
      if (data.ok === false || data.error) {
        const err = (data.error || data.payload || {}) as Record<string, unknown>;
        pending.reject(new Error((err.message as string) || (err.code as string) || "RPC error"));
      } else {
        pending.resolve(data.payload ?? data.result);
      }
      return;
    }

    // Event frame — keep payload nested so listeners can access payload.stream, payload.data etc.
    if (data.type === "event") {
      const event: RpcEvent = {
        type: (data.event as string) || "unknown",
        payload: data.payload as Record<string, unknown> | undefined,
      };
      for (const listener of this.listeners) {
        listener(event);
      }
      return;
    }

    // Fallback: treat as event for backwards compat
    const event: RpcEvent = {
      type: (data.method as string) || (data.type as string) || "unknown",
      ...((data.params as Record<string, unknown>) ?? data),
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** Singleton instance */
export const rpc = new OpenClawRpc();
