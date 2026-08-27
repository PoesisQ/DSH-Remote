// Account snapshots are separate from chat history and connection presence.
(function (root) {
  "use strict";
  const finite = n => typeof n === "number" && Number.isFinite(n);
  const money = (n, currency, digits = 2) => finite(n) ? `${currency === "CNY" ? "¥" : currency ? currency + " " : ""}${n.toFixed(digits)}` : "—";
  const hhmm = n => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  function validSnapshot(d) {
    return d && finite(d.sampledAt) && ["off", "peak"].includes(d.nowPeriod) &&
      [d.balance, d.totalCost, d.totalTokens].every(n => n === null || finite(n)) &&
      [d.currency, d.costCurrency].every(c => c === null || typeof c === "string" && /^[A-Z]{3}$/.test(c));
  }
  class UsageState {
    constructor(now = Date.now) { this.now = now; this.reset(); }
    reset(saved = null) {
      this.record = saved && ["ok", "unavailable", "not-configured"].includes(saved.status) && (!saved.snapshot || validSnapshot(saved.snapshot)) ? saved : null;
      this.pending = null; this.lastRequest = -Infinity; this.failed = false;
    }
    due(force = false) { return (!this.pending || this.now() - this.pending.at > 60000) && this.now() - this.lastRequest >= (force ? 15000 : 120000); }
    request(id) { this.pending = { id, at: this.now() }; this.lastRequest = this.now(); this.failed = false; }
    fail(id) { if (this.pending?.id === id) { this.pending = null; this.failed = true; } }
    accept(ref, data) {
      if (!this.pending || this.pending.id !== ref || this.now() - this.pending.at > 60000 || data?.protocol !== 1 || !["ok", "unavailable", "not-configured"].includes(data.status)) return false;
      if (data.status === "ok" && (!validSnapshot(data.snapshot) || data.snapshot.sampledAt > this.now() + 300000)) return false;
      this.record = { status: data.status, snapshot: data.status === "ok" ? data.snapshot : this.record?.snapshot || null };
      this.pending = null; this.failed = false; return true;
    }
    view() {
      const d = this.record?.snapshot, now = this.now(), age = d ? now - d.sampledAt : Infinity;
      const busy = !!this.pending && now - this.pending.at <= 60000;
      const stale = !!d && (age > 300000 || age < -300000 || this.record.status !== "ok" || this.failed);
      let period = d?.nowPeriod, range = "时段规则暂不可用";
      const s = d?.schedule;
      if (s?.timezone === "Asia/Shanghai" && s.utcOffsetMinutes === 480 && Number.isInteger(s.offStartMinute) && Number.isInteger(s.offEndMinute) && s.offStartMinute >= 0 && s.offStartMinute < s.offEndMinute && s.offEndMinute <= 1440) {
        if (!stale) { const time = new Date(now + s.utcOffsetMinutes * 60000), minute = time.getUTCHours() * 60 + time.getUTCMinutes(); period = minute >= s.offStartMinute && minute < s.offEndMinute ? "off" : "peak"; }
        range = `北京时间 · 谷时 ${hhmm(s.offStartMinute)}–${hhmm(s.offEndMinute)} · 其余为峰时`;
      }
      const status = busy ? "正在同步电脑用量…" : this.record?.status === "not-configured" ? "电脑端尚未配置用量脚本" : this.record?.status === "unavailable" ? "电脑用量暂不可用，可稍后刷新" : stale ? "历史快照 · 等待电脑更新" : this.failed || this.pending ? "未收到用量回复，请检查电脑连接" : !d ? "等待电脑同步用量" : d.balance === null ? "余额查询暂不可用 · 用量已同步" : "来自电脑端用量组件";
      return { d, busy, stale, status, period, range,
        balance: money(d?.balance, d?.currency), cost: money(d?.totalCost, d?.costCurrency, 4),
        periodLabel: d ? `${stale ? "上次：" : ""}${period === "off" ? "谷时" : "峰时"}` : "用量与余额",
        sampled: d ? new Date(d.sampledAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + " 北京时间" : "尚无快照",
      };
    }
  }
  root.DRUsage = { UsageState, money };
})(typeof window === "undefined" ? globalThis : window);
