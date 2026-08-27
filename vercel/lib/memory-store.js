// 单元测试和本地 handler 测试使用；生产环境使用 redis-store.js。
import { streamKey } from "./namespace.js";
export class MemoryStreamStore {
  constructor(namespace = "", streams = new Map()) {
    this.namespace = namespace;
    this.streams = streams;
    this.sequence = 0;
  }

  key(channel, direction) {
    return streamKey(channel, direction, this.namespace);
  }

  async push(channel, direction, message) {
    const now = Date.now();
    this.sequence += 1;
    const cursor = `${now}-${this.sequence}`;
    const key = this.key(channel, direction);
    const stream = this.streams.get(key) ?? [];
    stream.push({ cursor, ...message });
    if (stream.length > 2000) stream.splice(0, stream.length - 2000);
    this.streams.set(key, stream);
    return cursor;
  }

  async pull(channel, direction, after, limit) {
    const stream = this.streams.get(this.key(channel, direction)) ?? [];
    const [afterTime, afterSequence] = after.split("-").map(BigInt);
    const start = after === "0-0" ? 0 : stream.findIndex((item) => {
      const [time, sequence] = item.cursor.split("-").map(BigInt);
      return time > afterTime || (time === afterTime && sequence > afterSequence);
    });
    if (start < 0) return [];
    return stream.slice(start, start + limit);
  }

  async ping() {
    return "PONG";
  }
}
