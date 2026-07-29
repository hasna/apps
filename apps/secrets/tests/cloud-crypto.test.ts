import { describe, expect, test, beforeEach } from "bun:test";
import {
  encryptValue,
  decryptValue,
  isEncrypted,
  getCloudMasterKey,
  _resetCloudMasterKey,
} from "../src/server/cloud-crypto.js";

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

  test("passphrase key derives 32 bytes", () => {
    _resetCloudMasterKey();
    const pEnv = { HASNA_SECRETS_MASTER_KEY: "a-long-operator-passphrase" } as NodeJS.ProcessEnv;
    const ct = encryptValue("x", pEnv);
    _resetCloudMasterKey();
    expect(decryptValue(ct, pEnv)).toBe("x");
  });

  test("decrypts values written with the legacy key alias after the canonical key is added", () => {
    const legacyKey = Buffer.alloc(32, 8).toString("base64");
    const canonicalKey = Buffer.alloc(32, 9).toString("base64");
    const ct = encryptValue("fleet-credential", { SECRETS_MASTER_KEY: legacyKey });

    _resetCloudMasterKey();
    expect(decryptValue(ct, {
      HASNA_SECRETS_MASTER_KEY: canonicalKey,
      SECRETS_MASTER_KEY: legacyKey,
    })).toBe("fleet-credential");
  });

  test("uses the canonical key for new writes when both key names are configured", () => {
    const legacyKey = Buffer.alloc(32, 8).toString("base64");
    const canonicalKey = Buffer.alloc(32, 9).toString("base64");
    const ct = encryptValue("new-credential", {
      HASNA_SECRETS_MASTER_KEY: canonicalKey,
      SECRETS_MASTER_KEY: legacyKey,
    });

    _resetCloudMasterKey();
    expect(decryptValue(ct, { HASNA_SECRETS_MASTER_KEY: canonicalKey })).toBe("new-credential");
    _resetCloudMasterKey();
    expect(() => decryptValue(ct, { SECRETS_MASTER_KEY: legacyKey })).toThrow();
  });
});
