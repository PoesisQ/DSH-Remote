import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  hashAuthToken,
  makeEnvelope,
  makePairingCode,
  makeRelayCredentials,
  openEnvelope,
  parsePairingCode,
  sealEnvelope,
  tokenMatchesHash,
} from "../src/crypto.js";

test("DR2 pairing round-trips and token is verifiable by hash", () => {
  const pairing = makeRelayCredentials("https://example.vercel.app/");
  assert.deepEqual(parsePairingCode(makePairingCode(pairing)), pairing);
  assert.equal(tokenMatchesHash(pairing.authToken, hashAuthToken(pairing.authToken)), true);
  assert.equal(tokenMatchesHash(makeRelayCredentials("https://relay.example.test").authToken, hashAuthToken(pairing.authToken)), false);
});

test("directional AEAD round-trips and rejects tampering/wrong direction", () => {
  const pairing = makeRelayCredentials("https://relay.example.test");
  const envelope = makeEnvelope("msg", { text: "你好" });
  const wire = sealEnvelope(pairing, envelope, "to-pc");
  assert.deepEqual(openEnvelope(pairing, wire, "to-pc"), envelope);
  assert.equal(openEnvelope(pairing, wire, "to-phone"), null);
  const parts = wire.split(".");
  const ciphertext = Buffer.from(parts[3], "base64url");
  ciphertext[0] ^= 1;
  parts[3] = ciphertext.toString("base64url");
  const tampered = parts.join(".");
  assert.equal(openEnvelope(pairing, tampered, "to-pc"), null);
});

test("Node ciphertext decrypts with the browser WebCrypto derivation", async () => {
  const pairing = makeRelayCredentials("https://relay.example.test");
  const envelope = makeEnvelope("chat", { text: "跨实现互通" });
  const wire = sealEnvelope(pairing, envelope, "to-phone");
  const [, id, ivRaw, blobRaw] = wire.split(".");
  const base = await webcrypto.subtle.importKey("raw", Buffer.from(pairing.key, "base64url"), "HKDF", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt: new TextEncoder().encode(`dsh-remote:${pairing.channel}`),
    info: new TextEncoder().encode("dsh-remote/v2:to-phone"),
  }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plaintext = await webcrypto.subtle.decrypt({
    name: "AES-GCM",
    iv: Buffer.from(ivRaw, "base64url"),
    additionalData: new TextEncoder().encode(`dsh-remote/v2|${pairing.channel}|to-phone|${id}`),
    tagLength: 128,
  }, key, Buffer.from(blobRaw, "base64url"));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), envelope);
});

test("expired envelopes are rejected", () => {
  const pairing = makeRelayCredentials("https://relay.example.test");
  const envelope = { ...makeEnvelope("msg", {}), ts: Date.now() - 10_000 };
  assert.equal(openEnvelope(pairing, sealEnvelope(pairing, envelope, "to-pc"), "to-pc", null, { maxAgeMs: 1000 }), null);
});

test("non-canonical Base64 wire aliases are rejected", () => {
  const pairing = makeRelayCredentials("https://relay.example.test");
  const parts = sealEnvelope(pairing, makeEnvelope("msg", {}), "to-pc").split(".");
  parts[2] += "=";
  assert.equal(openEnvelope(pairing, parts.join("."), "to-pc"), null);
});
