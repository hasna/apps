import { describe, expect, test, beforeEach } from "bun:test";
import {
  encryptValue,
  decryptValue,
  isEncrypted,
  getCloudMasterKey,
  VaultDecryptionError,
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
    expect(() => decryptValue(tampered, env)).toThrow(VaultDecryptionError);
  });

  test("a mismatched key produces a safe typed error", () => {
    const ct = encryptValue("value", env);
    _resetCloudMasterKey();
    const wrongEnv = { HASNA_SECRETS_MASTER_KEY: Buffer.alloc(32, 8).toString("base64") } as NodeJS.ProcessEnv;
    expect(() => decryptValue(ct, wrongEnv)).toThrow(VaultDecryptionError);
  });

  // The two failure conditions below are DIFFERENT INCIDENTS with opposite
  // remedies, and this pair is what keeps them apart. An absent master key
  // leaves the stored data intact and fully recoverable; VaultDecryptionError's
  // recovery text advises "overwrite/delete and recreate the affected entry",
  // so reporting an unconfigured service as a decryption failure hands the
  // operator instructions that destroy recoverable secrets.
  //
  // Assert the TYPE, not the wording — a message-only fix passes a wording
  // assertion and regresses on the next edit.
  test("a missing master key is NOT reported as a decryption failure", () => {
    const ct = encryptValue("value", env);
    _resetCloudMasterKey();

    let thrown: unknown;
    try {
      decryptValue(ct, {} as NodeJS.ProcessEnv);
      throw new Error("expected decryptValue to throw with no master key configured");
    } catch (error) {
      thrown = error;
    }

    // The fail-closed configuration error must survive, not be reclassified.
    expect(thrown).not.toBeInstanceOf(VaultDecryptionError);
    expect((thrown as Error).message).toMatch(/master key/i);
    expect((thrown as Error).message).toContain("HASNA_SECRETS_MASTER_KEY");

    // The harm itself: an operator whose data is intact must never be told to
    // destroy it. Covers both the message and any recovery text a future typed
    // error might carry.
    const surfaced = `${(thrown as Error).message} ${(thrown as { recovery?: string }).recovery ?? ""}`;
    expect(surfaced).not.toMatch(/delete|recreate|overwrite/i);
  });

  // Positive control for the test above: with the key merely WRONG rather than
  // absent, the entry genuinely cannot be read and the typed error is correct.
  // Without this, the assertion above is satisfied by a change that stops
  // producing VaultDecryptionError at all.
  test("a wrong master key still produces VaultDecryptionError (control)", () => {
    const ct = encryptValue("value", env);
    _resetCloudMasterKey();
    const wrongEnv = { HASNA_SECRETS_MASTER_KEY: Buffer.alloc(32, 3).toString("base64") } as NodeJS.ProcessEnv;

    let thrown: unknown;
    try {
      decryptValue(ct, wrongEnv);
      throw new Error("expected decryptValue to throw with a wrong master key");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(VaultDecryptionError);
    // And it must NOT be mistaken for the configuration error.
    expect((thrown as Error).message).not.toMatch(/requires a master key/i);
  });

  test("decrypts ciphertext with a configured previous master key after rotation", () => {
    const previousKey = Buffer.alloc(32, 8).toString("base64");
    const activeKey = Buffer.alloc(32, 9).toString("base64");
    const ct = encryptValue("synthetic-rotated-value", {
      HASNA_SECRETS_MASTER_KEY: previousKey,
    });

    _resetCloudMasterKey();
    expect(decryptValue(ct, {
      HASNA_SECRETS_MASTER_KEY: activeKey,
      HASNA_SECRETS_PREVIOUS_MASTER_KEYS: JSON.stringify([previousKey]),
    })).toBe("synthetic-rotated-value");
  });

  test("passphrase key derives 32 bytes", () => {
    _resetCloudMasterKey();
    const pEnv = { HASNA_SECRETS_MASTER_KEY: "a-long-operator-passphrase" } as NodeJS.ProcessEnv;
    const ct = encryptValue("x", pEnv);
    _resetCloudMasterKey();
    expect(decryptValue(ct, pEnv)).toBe("x");
  });
});
