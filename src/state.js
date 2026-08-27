// 小型本地状态文件：保存 Vercel Stream 游标与尚未成功上传的密文 outbox。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const STREAM_CURSOR_RE = /^(?:0-0|[1-9][0-9]*-[0-9]+)$/;
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_WIRE_CHARS = 80 * 1024;
const MAX_SEEN_IDS = 512;

export function isStreamCursor(value) {
  return typeof value === "string" && STREAM_CURSOR_RE.test(value);
}

export function cursorIsAfter(candidate, previous) {
  if (!isStreamCursor(candidate) || !isStreamCursor(previous)) return false;
  const [candidateTime, candidateSequence] = candidate.split("-").map(BigInt);
  const [previousTime, previousSequence] = previous.split("-").map(BigInt);
  return candidateTime > previousTime || (candidateTime === previousTime && candidateSequence > previousSequence);
}

function validWireItem(item) {
  return item
    && typeof item.id === "string"
    && MESSAGE_ID_RE.test(item.id)
    && typeof item.wire === "string"
    && item.wire.length <= MAX_WIRE_CHARS
    && item.wire.startsWith(`v2.${item.id}.`);
}

function validSeenIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && MESSAGE_ID_RE.test(id)))].slice(-MAX_SEEN_IDS);
}

export class JsonStateStore {
  constructor(path, { logger = console } = {}) {
    this.path = path;
    this.logger = logger;
  }

  load(channel, relayUrl) {
    if (!this.path || !existsSync(this.path)) return this.fresh(channel, relayUrl);
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      if (value?.version !== 1 || value.channel !== channel) return this.fresh(channel, relayUrl);
      if (relayUrl && value.relayUrl && value.relayUrl !== relayUrl) {
        throw Object.assign(new Error("状态文件属于另一个中继，请为不同应用使用独立配置目录；未修改原队列"), { code: "STATE_RELAY_MISMATCH" });
      }
      const outbox = Array.isArray(value.outbox) ? value.outbox.filter(validWireItem).slice(-1000) : [];
      const cursorToPc = isStreamCursor(value.cursorToPc) ? value.cursorToPc : "0-0";
      if (cursorToPc !== value.cursorToPc || outbox.length !== (Array.isArray(value.outbox) ? value.outbox.length : 0)) {
        this.logger.warn("[state] 已丢弃损坏的游标或发送队列条目");
      }
      return {
        version: 1,
        channel,
        ...(relayUrl ? { relayUrl } : {}),
        cursorToPc,
        outbox,
        seenToPc: validSeenIds(value.seenToPc),
      };
    } catch (err) {
      if (err.code === "STATE_RELAY_MISMATCH") throw err;
      // Replaying old control commands is more dangerous than stopping for recovery.
      throw Object.assign(new Error("状态文件无法读取；已保留原文件并停止，避免旧指令被重新执行。请备份后按恢复说明处理。"), { code: "STATE_UNREADABLE", cause: err });
    }
  }

  fresh(channel, relayUrl) {
    return { version: 1, channel, ...(relayUrl ? { relayUrl } : {}), cursorToPc: "0-0", outbox: [], seenToPc: [] };
  }

  save(value) {
    if (!this.path) return;
    const serialized = JSON.stringify(value) + "\n";
    if (serialized === this.lastSaved) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, serialized, { mode: 0o600 });
    renameSync(temporary, this.path);
    this.lastSaved = serialized;
  }
}
