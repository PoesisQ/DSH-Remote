// DSH 客户端协议（最小实现，wire 格式与 @deepseek-ai/dsh-host-apiproxy 0.1.1-rc.2 实测一致）：
// - RPC:      POST /api/<method>     {type:"client-request", rpcId, method, payload}
// - 事件流:   ws://…/api/events.mux  {type:"server-request", rpcId, method?, payload}
// - 应答:     POST /api/respond      {type:"client-response", rpcId, result:{ok, value|error}}
export class DshClient {
  constructor(baseUrl = "http://127.0.0.1:3080", { onFrame, onStatus, logger = console } = {}) {
    this.base = String(baseUrl).replace(/\/+$/, "");
    this.onFrame = onFrame ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.logger = logger;
    this.rpcSeq = 0;
    this.ws = null;
    this.closed = false;
    this.started = false;
    this.backoffMs = 1000;
    this.reconnectTimer = null;
    this.stableTimer = null;
  }

  mintRpcId() {
    this.rpcSeq += 1;
    return `dr-${this.rpcSeq}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async rpc(method, payload = {}, { timeoutMs = 20000 } = {}) {
    const body = { type: "client-request", rpcId: this.mintRpcId(), method, payload };
    const res = await fetch(`${this.base}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const msg = await res.json();
    if (msg?.type !== "server-response") throw new Error(`RPC ${method} 响应格式错误`);
    if (!msg.result?.ok) {
      const err = msg.result?.error;
      throw new Error(`RPC ${method} 失败: ${err?.message ?? JSON.stringify(err)}`);
    }
    return msg.result.value;
  }

  /** 应答审批/提问等 server-request（result.value 为对应 payload）。 */
  async respond(rpcId, value) {
    return this.respondResult(rpcId, { ok: true, value });
  }

  async respondError(rpcId, error) {
    return this.respondResult(rpcId, { ok: false, error });
  }

  async respondResult(rpcId, result) {
    const body = { type: "client-response", rpcId, result };
    const res = await fetch(`${this.base}/api/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`respond HTTP ${res.status}`);
    const receipt = await res.json();
    if (receipt?.accepted !== true) throw new Error(`respond 被拒绝: ${receipt?.reason ?? "unknown"}`);
    return receipt;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.closed = false;
    this.connect();
  }

  connect() {
    if (this.closed || !this.started) return;
    let ws;
    try {
      const url = new URL("/api/events.mux", this.base);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(url);
    } catch (err) {
      this.onStatus("mux-error");
      this.logger.warn(`[dsh-client] 无法创建 mux WebSocket: ${err?.message ?? err}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws || this.closed) return;
      clearTimeout(this.stableTimer);
      this.stableTimer = setTimeout(() => {
        if (this.ws === ws && ws.readyState === 1) this.backoffMs = 1000;
      }, 10_000);
      this.onStatus("mux-open");
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws !== ws || this.closed) return;
      let full;
      try {
        full = JSON.parse(String(ev.data));
      } catch {
        this.logger.warn("[dsh-client] 丢弃无法解析的 mux 帧");
        return;
      }
      if (full?.type === "server-request" && typeof full.rpcId === "string" && full.payload) {
        try {
          this.onFrame({ rpcId: full.rpcId, method: full.method, payload: full.payload });
        } catch (err) {
          this.logger.error(`[dsh-client] onFrame 处理异常: ${err?.stack ?? err}`);
        }
      }
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
      if (this.closed) return;
      this.onStatus("mux-close");
      this.scheduleReconnect();
    });
    ws.addEventListener("error", (ev) => {
      if (this.ws !== ws || this.closed) return;
      this.onStatus("mux-error");
      this.logger.warn("[dsh-client] mux WebSocket 错误:", ev?.message ?? ev);
    });
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30000);
    this.onStatus(`mux-reconnect-${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  stop() {
    this.started = false;
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
