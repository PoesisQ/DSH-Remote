// Pure connection state, shared by the browser and deterministic Node tests.
(function (root) {
  "use strict";
  class ConnectionState {
    constructor(now = () => performance.now()) { this.now = now; this.reset(); }
    reset() { this.relay = false; this.error = ""; this.pending = null; this.lastProbe = -Infinity; this.firstProbe = null; this.lastReply = -Infinity; this.dsh = "unknown"; }
    needsProbe() { return this.now() - this.lastProbe >= 30000 && (!this.pending || this.now() - this.pending.at > 45000); }
    probe(id) { this.pending = { id, at: this.now() }; this.lastProbe = this.now(); this.firstProbe ??= this.now(); }
    accept(ref, data) {
      if (!this.pending || ref !== this.pending.id || this.now() - this.pending.at > 45000 || data?.protocol !== 1) return false;
      if (!["ready", "unavailable", "reconnecting"].includes(data.dsh)) return false;
      this.pending = null; this.lastReply = this.now(); this.dsh = data.dsh; return true;
    }
    reachable() { this.relay = true; this.error = ""; }
    failed(message) { this.relay = false; this.error = message; }
    view() {
      if (!this.relay) return { text: this.error || "正在连接云端…", level: this.error ? "error" : "warn" };
      if (this.now() - this.lastReply <= 65000) {
        if (this.dsh === "ready") return { text: "电脑在线", level: "ok" };
        return { text: this.dsh === "reconnecting" ? "电脑在线 · DSH 重连中" : "电脑在线 · DSH 未启动", level: "warn" };
      }
      return { text: this.firstProbe === null || this.now() - this.firstProbe < 20000 ? "云端可达 · 确认电脑中…" : "云端可达 · 电脑未响应", level: "warn" };
    }
  }
  root.DRConnection = { ConnectionState };
})(typeof window === "undefined" ? globalThis : window);
