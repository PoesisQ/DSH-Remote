// Vercel HTTPS + Redis Stream 中继（电脑端）。
// - 发往手机的密文先写本地 outbox，成功 POST 后才删除。
// - 发往电脑的密文按 Redis Stream cursor 补拉，手机离线不影响历史保留。
import { makeEnvelope, openEnvelope, sealEnvelope, SeenCache } from "./crypto.js";
import { cursorIsAfter, isStreamCursor, JsonStateStore } from "./state.js";

const DEFAULT_IDLE_POLL_MS = 15_000;
const DEFAULT_ACTIVE_POLL_MS = 1_500;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_PULL = 100;

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class VercelRelay {
  constructor(pairing, {
    onEnvelope = () => {},
    onStatus = () => {},
    logger = console,
    statePath,
    idlePollMs = DEFAULT_IDLE_POLL_MS,
    activePollMs = DEFAULT_ACTIVE_POLL_MS,
  } = {}) {
    this.pairing = pairing;
    this.onEnvelope = onEnvelope;
    this.onStatus = onStatus;
    this.logger = logger;
    this.idlePollMs = Number.isFinite(Number(idlePollMs)) ? Math.min(300_000, Math.max(1000, Number(idlePollMs))) : DEFAULT_IDLE_POLL_MS;
    this.activePollMs = Number.isFinite(Number(activePollMs)) ? Math.min(60_000, Math.max(500, Number(activePollMs))) : DEFAULT_ACTIVE_POLL_MS;
    this.stateStore = new JsonStateStore(statePath, { logger });
    this.state = this.stateStore.load(pairing.channel, pairing.url);
    this.stateStore.save(this.state);
    this.seen = new SeenCache();
    for (const id of this.state.seenToPc) this.seen.add(id);
    this.abort = null;
    this.loopPromise = null;
    this.draining = false;
    this.started = false;
    this._ready = false;
    this.activeUntil = 0;
    this.consecutiveFailures = 0;
  }

  get ready() {
    return this._ready;
  }

  headers() {
    return {
      authorization: `Bearer ${this.pairing.authToken}`,
      "content-type": "application/json",
      "cache-control": "no-store",
    };
  }

  api(path) {
    return `${this.pairing.url}${path}`;
  }

  markUp() {
    this.consecutiveFailures = 0;
    if (!this._ready) {
      this._ready = true;
      this.onStatus("relay-up");
    }
  }

  markFailure(err) {
    this.consecutiveFailures += 1;
    if (this._ready) this.onStatus("relay-offline");
    this._ready = false;
    this.onStatus(`relay-error:${err?.message ?? err}`);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.abort = new AbortController();
    this.loopPromise = this.pollLoop(this.abort.signal);
    this.drainOutbox();
  }

  close() {
    this.started = false;
    this.abort?.abort();
    this.abort = null;
    return this.loopPromise ?? Promise.resolve();
  }

  wakeFast(durationMs = ACTIVE_WINDOW_MS) {
    this.activeUntil = Math.max(this.activeUntil, Date.now() + durationMs);
  }

  /** 同步入本地 outbox；实际 HTTP 上传异步重试。 */
  publish(kind, data, ref) {
    if (this.state.outbox.length >= 1000) {
      throw new Error("本地发送队列已满（1000 条），停止接收新推送以避免静默丢失");
    }
    const envelope = makeEnvelope(kind, data, ref);
    const wire = sealEnvelope(this.pairing, envelope, "to-phone");
    this.state.outbox.push({ id: envelope.id, wire });
    this.stateStore.save(this.state);
    this.wakeFast();
    this.drainOutbox();
    return true;
  }

  async postWire(item, signal) {
    const response = await fetch(this.api("/api/push"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        channel: this.pairing.channel,
        direction: "to-phone",
        id: item.id,
        wire: item.wire,
      }),
      signal: requestSignal(signal),
    });
    if (!response.ok) throw new Error(`push HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
    const receipt = await response.json();
    if (receipt?.ok !== true) throw new Error("push 响应格式错误");
  }

  async publishPresence(data, ref) {
    return this.publishTransient("presence", data, ref);
  }

  async publishTransient(kind, data, ref) {
    if (!["presence", "usage"].includes(kind)) throw new Error("unsupported control message");
    if (!this.started) return;
    const env = makeEnvelope(kind, data, ref);
    try {
      await this.postWire({ id: env.id, wire: sealEnvelope(this.pairing, env, "to-phone") }, this.abort?.signal);
      this.markUp();
    } catch (err) {
      if (this.started) this.markFailure(err);
    }
  }

  async drainOutbox() {
    if (this.draining || this.state.outbox.length === 0) return;
    this.draining = true;
    try {
      while (this.state.outbox.length > 0 && this.started) {
        const item = this.state.outbox[0];
        try {
          await this.postWire(item, this.abort?.signal);
          this.markUp();
          this.state.outbox.shift();
          this.stateStore.save(this.state);
        } catch (err) {
          if (this.started) this.markFailure(err);
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async pullOnce(signal = this.abort?.signal) {
    const query = new URLSearchParams({
      channel: this.pairing.channel,
      direction: "to-pc",
      after: this.state.cursorToPc,
      limit: String(MAX_PULL),
    });
    const response = await fetch(this.api(`/api/pull?${query}`), {
      headers: this.headers(),
      signal: requestSignal(signal),
    });
    if (!response.ok) throw new Error(`pull HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
    const payload = await response.json();
    if (payload?.ok !== true || !Array.isArray(payload.messages)) throw new Error("pull 响应格式错误");

    let advanced = 0;
    let rejectedCursors = 0;
    let businessActivity = false;
    for (const item of payload.messages) {
      if (!item || !isStreamCursor(item.cursor) || !cursorIsAfter(item.cursor, this.state.cursorToPc)) {
        rejectedCursors += 1;
        continue;
      }
      const envelope = typeof item.wire === "string" ? openEnvelope(this.pairing, item.wire, "to-pc") : null;
      if (envelope && !this.seen.has(envelope.id)) {
        await this.onEnvelope(envelope);
        if (!["presence", "usage"].includes(envelope.k)) businessActivity = true;
        this.seen.add(envelope.id);
        this.state.seenToPc.push(envelope.id);
        this.state.seenToPc = [...new Set(this.state.seenToPc)].slice(-512);
      }
      // 无效密文和重复消息也要越过，否则会永久阻塞同一游标。
      this.state.cursorToPc = item.cursor;
      this.stateStore.save(this.state);
      advanced += 1;
    }
    if (rejectedCursors > 0) this.logger.warn(`[relay] 丢弃 ${rejectedCursors} 条未前进或格式错误的游标`);
    if (businessActivity) this.wakeFast();
    this.markUp();
    return advanced;
  }

  async pollLoop(signal) {
    while (!signal.aborted) {
      try {
        const count = await this.pullOnce(signal);
        await this.drainOutbox();
        if (count >= MAX_PULL) continue;
      } catch (err) {
        if (signal.aborted) break;
        this.markFailure(err);
      }
      const normal = Date.now() < this.activeUntil ? this.activePollMs : this.idlePollMs;
      const backoff = this.consecutiveFailures > 0
        ? Math.min(60_000, normal * 2 ** Math.min(this.consecutiveFailures, 4))
        : normal;
      await delay(backoff, signal);
    }
  }
}

export function startRelay(pairing, options = {}) {
  const relay = new VercelRelay(pairing, options);
  relay.start();
  return relay;
}
