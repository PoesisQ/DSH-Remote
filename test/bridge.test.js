import assert from "node:assert/strict";
import test from "node:test";
import { makeRelayCredentials } from "../src/crypto.js";
import { RemoteBridge } from "../src/bridge.js";

function bridgeFixture() {
  const published = [];
  const responses = [];
  const bridge = new RemoteBridge({
    config: {
      dshUrl: "http://127.0.0.1:3080",
      relay: { ...makeRelayCredentials("https://relay.example.test"), idlePollMs: 15_000, activePollMs: 1_500 },
      push: { otherSessions: false },
    },
    logger: { log() {}, warn() {}, error() {} },
  });
  bridge.relay = { publish: (kind, data, ref) => published.push({ kind, data, ref }) };
  bridge.client = {
    respond: async (rpcId, value) => responses.push({ rpcId, value }),
    respondError: async (rpcId, error) => responses.push({ rpcId, error }),
  };
  bridge.sessions.set("session-12345678", { id: "session-12345678", title: "test" });
  bridge.currentSessionId = "session-12345678";
  return { bridge, published, responses };
}

test("presence reports actual DSH health even when muted and rejects stale probes", async () => {
  const { bridge } = bridgeFixture(); const replies = [];
  bridge.muted = true;
  bridge.relay.publishPresence = async (data, ref) => replies.push({ data, ref });
  bridge.client.ws = { readyState: 1 };
  bridge.client.rpc = async (_method, _payload, options) => { assert.equal(options.timeoutMs, 4000); return {}; };
  await bridge.onEnvelope({ k: "presence", id: "probe-one", ts: Date.now() });
  assert.equal(replies[0].data.dsh, "ready"); assert.equal(replies[0].ref, "probe-one");
  bridge.client.rpc = async () => { throw new Error("DSH stopped"); };
  await bridge.onEnvelope({ k: "presence", id: "probe-two", ts: Date.now() });
  assert.equal(replies[1].data.dsh, "unavailable");
  await bridge.onEnvelope({ k: "presence", id: "old", ts: Date.now() - 60000 });
  assert.equal(replies.length, 2);
});

test("hello snapshots bypass chat mute", async () => {
  const { bridge, published } = bridgeFixture(); bridge.muted = true;
  bridge.refreshSessions = async () => {};
  bridge.client.rpc = async () => ({ version: "test", cwd: "/test" });
  await bridge.sendHello(); assert.equal(published.at(-1).kind, "hello");
});

test("usage is nonblocking, answers each client and ignores expired requests", async () => {
  const { bridge } = bridgeFixture(); let finish, reads = 0; const replies = [];
  bridge.muted = true;
  const reading = new Promise(resolve => { finish = resolve; });
  bridge.usage = { read: () => { reads++; return reading; } };
  bridge.relay.publishTransient = async (kind, data, ref) => replies.push({ kind, data, ref });
  assert.equal(bridge.onEnvelope({ k: "usage", id: "one", ts: Date.now() }), undefined);
  bridge.onEnvelope({ k: "usage", id: "two", ts: Date.now() }); assert.equal(reads, 2);
  finish({ protocol: 1, status: "not-configured" }); await Promise.all(bridge.usageReplies.values());
  assert.equal(replies[0].kind, "usage"); assert.equal(replies[0].ref, "one");
  assert.equal(replies[1].ref, "two");
  bridge.onEnvelope({ k: "usage", id: "old", ts: Date.now() - 61000 }); assert.equal(reads, 2);
});

test("replayed approval request reuses one random reference", () => {
  const { bridge, published } = bridgeFixture();
  const payload = { sessionId: "session-12345678", approvalId: "approval-1", toolName: "bash" };
  bridge.onApprovalRequested("rpc-1", payload);
  bridge.onApprovalRequested("rpc-1", payload);
  assert.equal(bridge.pendingApprovals.size, 1);
  assert.match(published[0].data.ref, /^a-[A-Za-z0-9_-]{8}$/);
  assert.equal(published[0].data.ref, published[1].data.ref);
});

test("question answers are validated before DSH respond", async () => {
  const { bridge, published, responses } = bridgeFixture();
  bridge.onQuestionRequested("question-rpc", {
    sessionId: "session-12345678",
    questions: [{ id: "choice", question: "继续？", options: [{ label: "继续" }, { label: "停止" }] }],
  });
  const ref = published.at(-1).data.ref;
  bridge.onQuestionAnswer(ref, [{ id: "choice", selected: ["不存在"] }], false);
  assert.equal(responses.length, 0);
  assert.equal(bridge.pendingQuestions.has(ref), true);
  bridge.onQuestionAnswer(ref, [{ id: "choice", selected: ["继续"] }], false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(responses.length, 1);
  assert.equal(bridge.pendingQuestions.has(ref), false);
  assert.deepEqual(responses[0].value.answer.answers, [{ id: "choice", selected: ["继续"] }]);
});
