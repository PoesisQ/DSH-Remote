#!/usr/bin/env node
// Node 手机模拟器：与 PWA 使用同一套 DR2 + Vercel HTTP mailbox 协议。
import { readFileSync } from "node:fs";
import { makeEnvelope, openEnvelope, sealEnvelope, SeenCache } from "../src/crypto.js";

const args = process.argv.slice(2);
const configPath = args[0];
if (!configPath) {
  console.error("用法: node test/phone-sim.js <config.json> [--send 文字] [--auto-approval allow|reject] [--auto-question 0,1] [--timeout 秒]");
  process.exit(2);
}

const opts = { sends: [], autoApproval: null, autoQuestion: null, timeoutSec: 30, hello: true };
for (let index = 1; index < args.length; index += 1) {
  if (args[index] === "--send") opts.sends.push(args[++index]);
  else if (args[index] === "--auto-approval") {
    const value = args[++index];
    opts.autoApproval = value === "allow" ? "allowed-once" : value === "reject" ? "rejected" : value;
  } else if (args[index] === "--auto-question") opts.autoQuestion = args[++index];
  else if (args[index] === "--timeout") opts.timeoutSec = Number(args[++index]);
  else if (args[index] === "--no-hello") opts.hello = false;
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const pairing = config.relay;
if (!pairing?.url || !pairing?.channel || !pairing?.authToken || !pairing?.key) {
  throw new Error("配置中没有 DR2 relay 字段，请先运行 dsh-remote --init");
}
const seen = new SeenCache();
let cursor = "0-0";
let stopped = false;

function headers() {
  return { authorization: `Bearer ${pairing.authToken}`, "content-type": "application/json" };
}

async function publish(kind, data, ref) {
  const envelope = makeEnvelope(kind, data, ref);
  const wire = sealEnvelope(pairing, envelope, "to-pc");
  const response = await fetch(`${pairing.url}/api/push`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ channel: pairing.channel, direction: "to-pc", id: envelope.id, wire }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`push HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  console.log(`[→pc] ${kind} ${JSON.stringify(data).slice(0, 200)}`);
}

async function handleEnvelope(envelope) {
  const data = envelope.d ?? {};
  console.log(`[←pc] ${envelope.k}${envelope.r ? ` r=${envelope.r}` : ""} ${JSON.stringify(data).slice(0, 240)}`);
  if (envelope.k === "approval" && opts.autoApproval) {
    await publish("approval-answer", { ref: data.ref, outcome: opts.autoApproval });
  }
  if (envelope.k === "question" && opts.autoQuestion) {
    const picks = opts.autoQuestion.split(",");
    const answers = (data.questions ?? []).map((question, index) => {
      const labels = (question.options ?? []).map((option) => option.label);
      const pick = picks[index];
      return {
        id: question.id,
        selected: pick !== undefined && pick !== "-" && labels[Number(pick)] !== undefined
          ? [labels[Number(pick)]]
          : [],
      };
    });
    await publish("question-answer", { ref: data.ref, answers });
  }
}

async function pullLoop() {
  while (!stopped) {
    try {
      const query = new URLSearchParams({ channel: pairing.channel, direction: "to-phone", after: cursor, limit: "100" });
      const response = await fetch(`${pairing.url}/api/pull?${query}`, {
        headers: headers(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`pull HTTP ${response.status}`);
      const body = await response.json();
      for (const item of body.messages ?? []) {
        const envelope = openEnvelope(pairing, item.wire, "to-phone", seen);
        if (envelope) await handleEnvelope(envelope);
        cursor = item.cursor;
      }
      await new Promise((resolve) => setTimeout(resolve, body.messages?.length ? 400 : 1500));
    } catch (error) {
      console.error(`[sim] 同步失败: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

console.log(`[sim] 中继 ${pairing.url}，信道 ${pairing.channel}`);
pullLoop();
if (opts.hello) await publish("hello", {});
for (const text of opts.sends) await publish("msg", { text, mode: "queue" });

setTimeout(() => {
  stopped = true;
  console.log("[sim] 超时退出");
  process.exit(0);
}, opts.timeoutSec * 1000);
