import { describe, expect, test, beforeEach } from "bun:test";
import {
  encryptValue,
  decryptValue,
  isEncrypted,
  getCloudMasterKey,
  decryptValueWithMetadata,
  _resetCloudMasterKey,
} from "../src/server/cloud-crypto.js";
import { CloudSecretsStore } from "../src/server/cloud-store.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const env = { HASNA_SECRETS_MASTER_KEY: KEY } as NodeJS.ProcessEnv;

describe("cloud-crypto", () => {
  beforeEach(() => _resetCloudMasterKey());

  test("round-trips a value", () => {
    const ct = encryptValue("sk-live-abc123", env);
    expect(isEncrypted(ct)).toBe(true);
    expect(ct).not.toContain("sk-live-abc123");
    expect(decryptValue(ct, env)).toBe("sk-live-abc123");
  });

  test("distinct ciphertexts for same plaintext (random IV)", () => {
    const a = encryptValue("same", env);
    _resetCloudMasterKey();
    const b = encryptValue("same", env);
    expect(a).not.toBe(b);
  });

  test("fails closed without a key", () => {
    _resetCloudMasterKey();
    expect(() => getCloudMasterKey({} as NodeJS.ProcessEnv)).toThrow(/master key/i);
  });

  test("tampered ciphertext is rejected", () => {
    const ct = encryptValue("value", env);
    const tampered = ct.slice(0, -2) + (ct.endsWith("00") ? "11" : "00");
    expect(() => decryptValue(tampered, env)).toThrow();
  });

  test("reads ciphertext with a previous key and marks it for re-encryption", () => {
    const previousKey = Buffer.alloc(32, 8).toString("base64");
    const previousEnv = { HASNA_SECRETS_MASTER_KEY: previousKey } as NodeJS.ProcessEnv;
    const ct = encryptValue("old-value", previousEnv);

    _resetCloudMasterKey();
    const rotatedEnv = {
      HASNA_SECRETS_MASTER_KEY: KEY,
      HASNA_SECRETS_PREVIOUS_MASTER_KEYS: JSON.stringify([previousKey]),
    } as NodeJS.ProcessEnv;
    expect(decryptValueWithMetadata(ct, rotatedEnv)).toEqual({
      value: "old-value",
      needsReencryption: true,
    });

    _resetCloudMasterKey();
    const rewritten = encryptValue("old-value", rotatedEnv);
    expect(decryptValueWithMetadata(rewritten, rotatedEnv)).toEqual({
      value: "old-value",
      needsReencryption: false,
    });
  });

  test("cloud reads lazily rewrite previous-key ciphertext with the active key", async () => {
    const previousKey = Buffer.alloc(32, 9).toString("base64");
    const ct = encryptValue("recovered-value", {
      HASNA_SECRETS_MASTER_KEY: previousKey,
    } as NodeJS.ProcessEnv);
    const originalActive = process.env.HASNA_SECRETS_MASTER_KEY;
    const originalPrevious = process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS;
    const writes: Array<{ sql: string; params: unknown[] }> = [];

    _resetCloudMasterKey();
    process.env.HASNA_SECRETS_MASTER_KEY = KEY;
    process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS = JSON.stringify([previousKey]);
    try {
      const db = {
        async get() {
          return {
            key: "example/service/live/token",
            value: ct,
            type: "token",
            label: null,
            expires_at: null,
            created_at: "created",
            updated_at: "updated",
          };
        },
        async execute(sql: string, params: unknown[]) {
          writes.push({ sql, params });
        },
      };
      const store = new CloudSecretsStore(db as any);
      expect((await store.getSecret("example/service/live/token", "test-actor"))?.value).toBe("recovered-value");

      const rewrite = writes.find(({ sql }) => sql.startsWith("UPDATE secrets SET value"));
      expect(rewrite).toBeDefined();
      expect(rewrite?.params.slice(1)).toEqual(["example/service/live/token", ct]);

      _resetCloudMasterKey();
      expect(decryptValueWithMetadata(String(rewrite?.params[0]), env)).toEqual({
        value: "recovered-value",
        needsReencryption: false,
      });
    } finally {
      if (originalActive === undefined) delete process.env.HASNA_SECRETS_MASTER_KEY;
      else process.env.HASNA_SECRETS_MASTER_KEY = originalActive;
      if (originalPrevious === undefined) delete process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS;
      else process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS = originalPrevious;
      _resetCloudMasterKey();
    }
  });

  test("rejects an invalid previous-key list", () => {
    const badEnv = {
      HASNA_SECRETS_MASTER_KEY: KEY,
      HASNA_SECRETS_PREVIOUS_MASTER_KEYS: KEY,
    } as NodeJS.ProcessEnv;
    expect(() => getCloudMasterKey(badEnv)).toThrow(/JSON array/);
  });

  test("passphrase key derives 32 bytes", () => {
    _resetCloudMasterKey();
    const pEnv = { HASNA_SECRETS_MASTER_KEY: "a-long-operator-passphrase" } as NodeJS.ProcessEnv;
    const ct = encryptValue("x", pEnv);
    _resetCloudMasterKey();
    expect(decryptValue(ct, pEnv)).toBe("x");
  });
});
