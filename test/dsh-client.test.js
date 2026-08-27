import assert from "node:assert/strict";
import test from "node:test";
import { DshClient } from "../src/dsh-client.js";

test("DSH mux start is idempotent and flapping connections back off", (context) => {
  const OriginalWebSocket = globalThis.WebSocket;
  class FakeWebSocket {
    static instances = [];
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.listeners = new Map();
      FakeWebSocket.instances.push(this);
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    emit(type, value = {}) { this.listeners.get(type)?.(value); }
    close() { this.readyState = 3; this.emit("close"); }
  }
  globalThis.WebSocket = FakeWebSocket;
  context.after(() => { globalThis.WebSocket = OriginalWebSocket; });

  const statuses = [];
  const client = new DshClient("http://127.0.0.1:3080", {
    onStatus: (status) => statuses.push(status),
    logger: { warn() {}, error() {} },
  });
  client.start();
  client.start();
  assert.equal(FakeWebSocket.instances.length, 1);
  const socket = FakeWebSocket.instances[0];
  socket.readyState = 1;
  socket.emit("open");
  socket.close();
  assert.deepEqual(statuses.slice(0, 3), ["mux-open", "mux-close", "mux-reconnect-1000ms"]);
  assert.equal(client.backoffMs, 2000);
  client.stop();
  assert.equal(client.reconnectTimer, null);
});
