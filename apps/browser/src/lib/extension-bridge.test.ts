import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  attachExtensionSocket,
  consumeExtensionPairingCode,
  createExtensionPairing,
  detachExtensionSocket,
  dispatchExtensionJob,
  getExtensionBridgeStatus,
  handleExtensionSocketMessage,
  prepareExtensionSocketUpgrade,
  resetExtensionBridgeForTests,
  revokeExtensionToken,
  validateExtensionToken,
} from "./extension-bridge.js";
import { resetDatabase } from "../db/schema.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-extension-bridge-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
  resetExtensionBridgeForTests({ deleteTokens: true });
});

afterEach(() => {
  resetExtensionBridgeForTests({ deleteTokens: true });
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
  delete process.env["BROWSER_ALLOWED_DOMAINS"];
  delete process.env["BROWSER_ALLOW_RISKY_CAPABILITIES"];
  delete process.env["BROWSER_CAPABILITY_TOKEN"];
});

describe("extension bridge pairing", () => {
  it("mints a six-digit code and consumes it once for a persistent token", () => {
    const pairing = createExtensionPairing(60_000);
    expect(pairing.code).toMatch(/^\d{6}$/);

    const token = consumeExtensionPairingCode(pairing.code, "Test Chrome");
    expect(token.token).toStartWith("ob_ext_");
    expect(validateExtensionToken(token.token).token_id).toBe(token.token_id);
    expect(() => consumeExtensionPairingCode(pairing.code)).toThrow();
  });

  it("expires pairing codes", async () => {
    const pairing = createExtensionPairing(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(() => consumeExtensionPairingCode(pairing.code)).toThrow();
  });

  it("rejects invalid pairing TTLs and caps very long TTLs", () => {
    expect(() => createExtensionPairing(0)).toThrow(/TTL/);
    expect(() => createExtensionPairing(Number.POSITIVE_INFINITY)).toThrow(/TTL/);

    const before = Date.now();
    const pairing = createExtensionPairing(999 * 60_000);
    const ttl = new Date(pairing.expires_at).getTime() - before;
    expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 1000);
  });

  it("prepares loopback WebSocket upgrades and rejects non-loopback hosts", () => {
    const pairing = createExtensionPairing(60_000);
    const accepted = prepareExtensionSocketUpgrade(new Request(`ws://127.0.0.1:7030/extension/ws?code=${pairing.code}`));
    expect(accepted.ok).toBe(true);

    const rejected = prepareExtensionSocketUpgrade(new Request("ws://example.com/extension/ws?code=123456"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.response.status).toBe(403);
  });

  it("uses the peer address for loopback checks when Bun provides it", () => {
    const pairing = createExtensionPairing(60_000);
    const spoofedHost = new Request(`ws://127.0.0.1:7030/extension/ws?code=${pairing.code}`);

    const rejected = prepareExtensionSocketUpgrade(spoofedHost, "203.0.113.10");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.response.status).toBe(403);

    const accepted = prepareExtensionSocketUpgrade(spoofedHost, "127.0.0.1");
    expect(accepted.ok).toBe(true);
  });

  it("revokes tokens and disconnects sockets", () => {
    const pairing = createExtensionPairing();
    const token = consumeExtensionPairingCode(pairing.code);
    const data = validateExtensionToken(token.token);
    let closed = false;
    attachExtensionSocket({ send() {}, close() { closed = true; } }, data);

    expect(getExtensionBridgeStatus().connected).toBe(true);
    const result = revokeExtensionToken(token.token_id);
    expect(result.revoked).toEqual([token.token_id]);
    expect(closed).toBe(true);
    expect(getExtensionBridgeStatus().connected).toBe(false);
    expect(() => validateExtensionToken(token.token)).toThrow();
  });
});

describe("extension bridge dispatch", () => {
  it("correlates jobs by id and resolves matching results", async () => {
    const pairing = createExtensionPairing();
    const token = consumeExtensionPairingCode(pairing.code);
    const data = validateExtensionToken(token.token);
    const sent: unknown[] = [];
    attachExtensionSocket({
      send(raw: string) {
        const message = JSON.parse(raw);
        sent.push(message);
        if (message.type === "job") {
          queueMicrotask(() => {
            handleExtensionSocketMessage(data.token_id, JSON.stringify({
              type: "result",
              result: { id: message.job.id, ok: true, data: { pong: true } },
            }));
          });
        }
      },
    }, data);

    const result = await dispatchExtensionJob({ id: "job-1", type: "ping" }, { timeoutMs: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ pong: true });
    expect(sent).toHaveLength(2);
  });

  it("rejects timed-out jobs", async () => {
    const pairing = createExtensionPairing();
    const token = consumeExtensionPairingCode(pairing.code);
    attachExtensionSocket({ send() {} }, validateExtensionToken(token.token));

    await expect(dispatchExtensionJob({ id: "slow", type: "ping" }, { timeoutMs: 5 })).rejects.toThrow(/timed out/);
  });

  it("rejects pending jobs when a socket disconnects", async () => {
    const pairing = createExtensionPairing();
    const token = consumeExtensionPairingCode(pairing.code);
    const data = validateExtensionToken(token.token);
    attachExtensionSocket({ send() {} }, data);

    const pending = dispatchExtensionJob({ id: "disconnect", type: "ping" }, { timeoutMs: 1000 });
    detachExtensionSocket(data.token_id);
    await expect(pending).rejects.toThrow(/disconnected/);
  });

  it("rejects unsupported job types before dispatch", async () => {
    const pairing = createExtensionPairing();
    const token = consumeExtensionPairingCode(pairing.code);
    const data = validateExtensionToken(token.token);
    let sentJob = false;
    attachExtensionSocket({ send(raw: string) {
      if (JSON.parse(raw).type === "job") sentJob = true;
    } }, data);

    await expect(dispatchExtensionJob({ id: "bad", type: "unknown" } as any, { timeoutMs: 20 })).rejects.toThrow(/Unsupported extension job type/);
    expect(sentJob).toBe(false);
  });

  it("rejects raw evaluate dispatch as an unsupported job type", async () => {
    const pairing = createExtensionPairing();
    const token = consumeExtensionPairingCode(pairing.code);
    const data = validateExtensionToken(token.token);
    let sentJob = false;
    attachExtensionSocket({ send(raw: string) {
      if (JSON.parse(raw).type === "job") sentJob = true;
    } }, data);

    await expect(dispatchExtensionJob({
      id: "eval",
      type: "evaluate",
      payload: { expression: "document.title" },
    } as any, { timeoutMs: 20 })).rejects.toThrow(/Unsupported extension job type/);
    expect(sentJob).toBe(false);
  });

  it("rejects non-allowlisted navigate jobs before dispatch", async () => {
    process.env["BROWSER_ALLOWED_DOMAINS"] = "example.test";
    const pairing = createExtensionPairing();
    const token = consumeExtensionPairingCode(pairing.code);
    const data = validateExtensionToken(token.token);
    let sentJob = false;
    attachExtensionSocket({ send(raw: string) {
      if (JSON.parse(raw).type === "job") sentJob = true;
    } }, data);

    await expect(dispatchExtensionJob({
      id: "nav-blocked",
      type: "navigate",
      payload: { url: "https://evil.test" },
    }, { timeoutMs: 20 })).rejects.toThrow(/not in BROWSER_ALLOWED_DOMAINS/);
    expect(sentJob).toBe(false);
  });

  it("requires a known allowed current tab URL for non-navigation jobs when domains are allowlisted", async () => {
    process.env["BROWSER_ALLOWED_DOMAINS"] = "example.test";
    const pairing = createExtensionPairing();
    const token = consumeExtensionPairingCode(pairing.code);
    const data = validateExtensionToken(token.token);
    const sent: string[] = [];
    attachExtensionSocket({
      send(raw: string) {
        const message = JSON.parse(raw);
        if (message.type !== "job") return;
        sent.push(message.job.type);
        queueMicrotask(() => {
          handleExtensionSocketMessage(data.token_id, JSON.stringify({
            type: "result",
            result: { id: message.job.id, ok: true, data: {}, url: "https://example.test/page" },
          }));
        });
      },
    }, data);

    await expect(dispatchExtensionJob({
      id: "click-unknown-url",
      type: "click",
      payload: { selector: "#go" },
    }, { timeoutMs: 20 })).rejects.toThrow(/current tab URL is unknown/);
    expect(sent).toEqual([]);

    await dispatchExtensionJob({
      id: "nav-allowed",
      type: "navigate",
      payload: { url: "https://example.test/page" },
    }, { timeoutMs: 100 });
    await dispatchExtensionJob({
      id: "click-known-url",
      type: "click",
      payload: { selector: "#go" },
    }, { timeoutMs: 100 });
    expect(sent).toEqual(["navigate", "click"]);
  });
});
