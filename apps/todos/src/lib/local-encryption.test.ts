import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  encryptValue,
  decryptValue,
  encryptSensitiveFields,
  decryptSensitiveFields,
  redactObject,
  applyExportProfile,
  initEncryptionKeyFile,
  loadEncryptionKey,
  getEncryptionKeySource,
  isEncryptedPayload,
  assertExportProfileAllowed,
} from "./local-encryption.js";

let tempHome: string;
const origHome = process.env["HOME"];
const origKey = process.env["TODOS_ENCRYPTION_KEY"];

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "todos-crypto-test-"));
  process.env["HOME"] = tempHome;
  delete process.env["TODOS_ENCRYPTION_KEY"];
});

afterEach(() => {
  process.env["HOME"] = origHome;
  if (origKey) process.env["TODOS_ENCRYPTION_KEY"] = origKey;
  else delete process.env["TODOS_ENCRYPTION_KEY"];
  rmSync(tempHome, { recursive: true, force: true });
});

describe("encryptValue / decryptValue", () => {
  it("round-trips with env key", () => {
    process.env["TODOS_ENCRYPTION_KEY"] = "test-secret-key-material";
    const payload = encryptValue("super-secret-token");
    expect(isEncryptedPayload(payload)).toBe(true);
    expect(decryptValue(payload)).toBe("super-secret-token");
  });

  it("round-trips with file key", () => {
    initEncryptionKeyFile();
    expect(getEncryptionKeySource()).toBe("file");
    const payload = encryptValue("file-key-secret");
    expect(decryptValue(payload)).toBe("file-key-secret");
  });

  it("throws when key missing", () => {
    expect(() => encryptValue("x")).toThrow("Encryption key not configured");
  });

  it("fails decrypt with wrong key", () => {
    process.env["TODOS_ENCRYPTION_KEY"] = "key-a";
    const payload = encryptValue("secret");
    process.env["TODOS_ENCRYPTION_KEY"] = "key-b";
    expect(() => decryptValue(payload)).toThrow();
  });
});

describe("encryptSensitiveFields", () => {
  it("encrypts sensitive metadata keys only", () => {
    process.env["TODOS_ENCRYPTION_KEY"] = "test-key";
    const meta = { title: "Task", api_key: "sk-live-123", count: 5 };
    const encrypted = encryptSensitiveFields(meta);
    expect(encrypted.title).toBe("Task");
    expect(isEncryptedPayload(encrypted.api_key)).toBe(true);
    const decrypted = decryptSensitiveFields(encrypted);
    expect(decrypted.api_key).toBe("sk-live-123");
  });
});

describe("applyExportProfile", () => {
  beforeEach(() => {
    process.env["TODOS_ENCRYPTION_KEY"] = "export-test-key";
  });

  it("redacts sensitive fields by default", () => {
    const { data, warnings } = applyExportProfile(
      { name: "Task", token: "abc", nested: { secret: "xyz" } },
      { profile: "redacted" },
    );
    expect(data.token).toBe("[REDACTED]");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("requires acknowledgement for plaintext export", () => {
    expect(() => applyExportProfile({ token: "abc" }, { profile: "plaintext" })).toThrow("acknowledge-plaintext");
    const { data } = applyExportProfile(
      { token: "abc" },
      { profile: "plaintext", acknowledge_plaintext: true },
    );
    expect(data.token).toBe("abc");
  });

  it("encrypts sensitive fields in encrypted profile", () => {
    const { data } = applyExportProfile(
      { token: "secret-value" },
      { profile: "encrypted" },
    );
    expect(isEncryptedPayload(data.token)).toBe(true);
  });
});

describe("redactObject", () => {
  it("redacts nested sensitive keys", () => {
    const redacted = redactObject({ auth: { api_key: "x", user: "alice" } });
    expect((redacted.auth as Record<string, unknown>).api_key).toBe("[REDACTED]");
    expect((redacted.auth as Record<string, unknown>).user).toBe("alice");
  });
});

describe("assertExportProfileAllowed", () => {
  it("validates profile names", () => {
    expect(assertExportProfileAllowed("redacted")).toBe("redacted");
    expect(() => assertExportProfileAllowed("invalid")).toThrow("Invalid export profile");
  });
});

describe("initEncryptionKeyFile", () => {
  it("creates key file once", () => {
    const path = initEncryptionKeyFile();
    expect(existsSync(path)).toBe(true);
    const key1 = loadEncryptionKey();
    initEncryptionKeyFile();
    const key2 = loadEncryptionKey();
    expect(key1!.equals(key2!)).toBe(true);
  });
});
