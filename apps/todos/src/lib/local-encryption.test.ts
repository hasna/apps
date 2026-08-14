import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "./config.js";
import {
  EncryptionKeyUnavailableError,
  TODOS_ENCRYPTED_BRIDGE_KIND,
  TODOS_ENCRYPTED_VALUE_KIND,
  createEncryptedBridgeBundle,
  decryptBridgeBundle,
  decryptString,
  decryptValue,
  encryptSensitiveFields,
  encryptString,
  encryptValue,
  encryptionProfileStatus,
  listEncryptionProfiles,
  removeEncryptionProfile,
  upsertEncryptionProfile,
} from "./local-encryption.js";
import { TODOS_LOCAL_BRIDGE_KIND, TODOS_LOCAL_BRIDGE_SCHEMA_VERSION } from "./local-bridge.js";

let home: string;
const previousHome = process.env["HOME"];
const previousKey = process.env["TODOS_TEST_ENCRYPTION_KEY"];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "todos-encryption-home-"));
  process.env["HOME"] = home;
  process.env["TODOS_TEST_ENCRYPTION_KEY"] = "local encryption test key material";
  resetConfig();
});

afterEach(() => {
  resetConfig();
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  if (previousKey === undefined) delete process.env["TODOS_TEST_ENCRYPTION_KEY"];
  else process.env["TODOS_TEST_ENCRYPTION_KEY"] = previousKey;
  rmSync(home, { recursive: true, force: true });
});

describe("local encryption profiles", () => {
  test("stores only profile metadata and encrypts/decrypts local strings", () => {
    const profile = upsertEncryptionProfile({ name: "secure", key_env: "TODOS_TEST_ENCRYPTION_KEY" });
    expect(profile).toMatchObject({
      name: "secure",
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      key_env: "TODOS_TEST_ENCRYPTION_KEY",
    });
    expect(JSON.stringify(profile)).not.toContain("local encryption test key material");

    const envelope = encryptString("sensitive evidence snippet", { profile: "secure" });
    expect(envelope.kind).toBe(TODOS_ENCRYPTED_VALUE_KIND);
    expect(envelope.ciphertext).not.toContain("sensitive evidence");
    expect(decryptString(envelope)).toBe("sensitive evidence snippet");
    expect(listEncryptionProfiles()).toHaveLength(1);
    expect(removeEncryptionProfile("secure")).toBe(true);
  });

  test("reports locked profiles and fails closed when key material is absent", () => {
    upsertEncryptionProfile({ name: "secure", key_env: "TODOS_TEST_ENCRYPTION_KEY" });
    delete process.env["TODOS_TEST_ENCRYPTION_KEY"];

    const status = encryptionProfileStatus("secure");
    expect(status.locked).toBe(true);
    expect(() => encryptString("secret", { profile: "secure" })).toThrow(EncryptionKeyUnavailableError);
  });

  test("encrypts JSON values and sensitive object fields without plaintext leakage", () => {
    upsertEncryptionProfile({ name: "secure", key_env: "TODOS_TEST_ENCRYPTION_KEY" });
    const encrypted = encryptValue({ metadata: { token: "example-token-value" }, note: "safe" }, { profile: "secure" });
    expect(JSON.stringify(encrypted)).not.toContain("example-token-value");
    expect(decryptValue(encrypted)).toEqual({ metadata: { token: "example-token-value" }, note: "safe" });

    const protectedValue = encryptSensitiveFields({
      title: "normal",
      metadata: { api_key: "example-api-key-value" },
    }, { profile: "secure" }) as Record<string, unknown>;
    expect(protectedValue.title).toBe("normal");
    expect(JSON.stringify(protectedValue.metadata)).not.toContain("example-api-key-value");
  });

  test("wraps bridge bundles in encrypted export envelopes", () => {
    upsertEncryptionProfile({ name: "secure", key_env: "TODOS_TEST_ENCRYPTION_KEY" });
    const bundle = {
      schemaVersion: TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
      kind: TODOS_LOCAL_BRIDGE_KIND,
      package: { packageName: "@hasna/todos" as const, repository: "hasna/todos" as const, version: "1.2.3" },
      data: { tasks: [{ title: "secret roadmap" }] },
    };

    const encrypted = createEncryptedBridgeBundle(bundle, { profile: "secure" });
    expect(encrypted.kind).toBe(TODOS_ENCRYPTED_BRIDGE_KIND);
    expect(JSON.stringify(encrypted)).not.toContain("secret roadmap");
    expect(encrypted.warnings.join(" ")).toContain("key material is not stored");
    expect(decryptBridgeBundle<typeof bundle>(encrypted)).toEqual(bundle);
  });
});
