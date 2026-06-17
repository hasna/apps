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
});
