import assert from "node:assert/strict";
import test from "node:test";
import "../phone/connection.js";
const { ConnectionState } = globalThis.DRConnection;

test("relay success alone never claims the computer is online", () => {
  let now = 0; const c = new ConnectionState(() => now);
  c.reachable(); c.probe("current"); now = 21000;
  assert.match(c.view().text, /电脑未响应/); assert.notEqual(c.view().level, "ok");
  assert.equal(c.accept("old", { protocol: 1, dsh: "ready" }), false);
});

test("only matching fresh probes grant a lease; expiry/reset/failure revoke it", () => {
  let now = 0; const c = new ConnectionState(() => now);
  c.reachable(); c.probe("p"); now = 1000;
  assert.equal(c.accept("p", { protocol: 1, dsh: "ready" }), true);
  assert.equal(c.view().level, "ok");
  now = 67000; assert.notEqual(c.view().level, "ok");
  c.probe("p2"); now += 46000;
  assert.equal(c.accept("p2", { protocol: 1, dsh: "ready" }), false);
  c.reset(); assert.equal(c.accept("p2", { protocol: 1, dsh: "ready" }), false);
  c.failed("offline"); assert.equal(c.view().level, "error");
});

test("DSH unavailable and reconnecting are not green online", () => {
  for (const dsh of ["unavailable", "reconnecting"]) {
    const c = new ConnectionState(() => 0); c.reachable(); c.probe("p");
    assert.equal(c.accept("p", { protocol: 1, dsh }), true);
    assert.equal(c.view().level, "warn"); assert.match(c.view().text, /DSH/);
  }
});
