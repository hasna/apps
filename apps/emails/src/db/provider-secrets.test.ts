// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// The provider-secret envelope/keyring module has zero coverage despite being
// the ONLY place provider credentials are stored at rest. The contracts that
// matter, and the failure modes a happy-path test would miss:
//
//   - AT-REST ENCRYPTION IS REAL: the stored row must never contain the
//     plaintext, and a single flipped ciphertext byte must make decryption
//     FAIL CLOSED (ProviderSecretsUnavailableError), never return garbage —
//     a tampered envelope that decrypts to garbage would hand the caller a
//     credential-shaped lie;
//   - the keyring migration must be copy-only and idempotent: never
//     overwrite an existing canonical keyring, never delete the legacy file,
//     verify the copy byte-for-byte and that it parses, and record a
//     receipt; dryRun must write nothing;
//   - key material rules: an inline root key must decode to exactly 32
//     bytes (hex or base64), a keyring entry whose key id does not match its
//     content is CORRUPT and must refuse, and a missing active key id is a
//     refusal;
//   - the plaintext migration moves legacy provider columns into envelopes
//     and CLEARS the plaintext columns in one savepoint, and an already
//     encrypted write always wins over leftover plaintext;
//   - rotation stages before activating, and revocation refuses a key that
//     is still referenced — an operator revoking a live key is a permanent
//     data-loss event, so the guard must be exact.
//
// File-backed keyring tests use EMAILS_PROVIDER_SECRETS_KEY_FILE pointing at
// a temp path, so nothing touches a real home keyring. Env mutation is
// restored in afterEach.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase, type Database } from "../db/database.js";
import {
  assertProviderSecretRootKeysAvailable,
  defaultProviderSecretsKeyringPath,
  legacyProviderSecretsKeyringPaths,
  migratePlaintextProviderSecrets,
  migrateProviderSecretsKeyring,
  ProviderSecretsUnavailableError,
  providerSecretsKeyStatus,
  resolveProviderSecretsKeyringPath,
  revokeProviderSecretsRootKey,
  rotateProviderSecretsRootKey,
  storeProviderSecrets,
  getProviderSecrets,
  updateProviderSecrets,
} from "./provider-secrets.js";

let db: Database;
let keyringDir: string;
let keyringFile: string;
let dbFile: string;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  resetDatabase();
  db = getDatabase();
  keyringDir = mkdtempSync(join(tmpdir(), "emails-provider-secrets-test-"));
  keyringFile = join(keyringDir, "keyring.json");
  dbFile = join(keyringDir, "provider-secrets-test.db");
  originalEnv = { ...process.env };
});

afterEach(() => {
  closeDatabase();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("EMAILS_PROVIDER_SECRETS")) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  rmSync(keyringDir, { recursive: true, force: true });
});

function seedProvider(id: string, overrides: Record<string, unknown> = {}): void {
  db.run(
    "INSERT INTO providers (id, name, type, api_key, region, access_key, secret_key, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [
      id,
      overrides["name"] ?? id,
      overrides["type"] ?? "ses",
      overrides["api_key"] ?? null,
      overrides["region"] ?? null,
      overrides["access_key"] ?? null,
      overrides["secret_key"] ?? null,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ],
  );
}

/**
 * Legacy-database fixture: current databases refuse plaintext credential
 * columns via migration-49 triggers. The migration under test exists exactly
 * to repair databases that predate those triggers, so this fixture drops the
 * triggers on the isolated in-memory database to model such a file — the
 * migration path itself is trigger-independent.
 */
function useLegacyPlaintextFixture(): void {
  db.exec("DROP TRIGGER IF EXISTS trg_providers_reject_plaintext_secrets_insert");
  db.exec("DROP TRIGGER IF EXISTS trg_providers_reject_plaintext_secrets_update");
}

/** File-backed database + file-backed keyring, so root-key rotation is reachable. */
function useFileBackedDatabase(): void {
  closeDatabase();
  db = getDatabase(dbFile);
  process.env.EMAILS_PROVIDER_SECRETS_KEY_FILE = keyringFile;
}

function storedRow(providerId: string): Record<string, unknown> | null {
  return db.query("SELECT * FROM provider_secrets WHERE provider_id = ?").get(providerId) as Record<string, unknown> | null;
}

describe("keyring path resolution", () => {
  it("composes the canonical default path under HOME", () => {
    const env = { HOME: "/home/ada" } as NodeJS.ProcessEnv;
    expect(defaultProviderSecretsKeyringPath(env)).toBe(
      join("/home/ada", ".hasna", "emails", "open-emails-provider-credentials.keyring.json"),
    );
  });

  it("falls back to USERPROFILE when HOME is absent", () => {
    const env = { USERPROFILE: "C:\\Users\\ada" } as NodeJS.ProcessEnv;
    const path = defaultProviderSecretsKeyringPath(env);
    expect(path).toContain(".hasna");
    expect(path).toContain("open-emails-provider-credentials.keyring.json");
  });

  it("lists the legacy paths in migration order: XDG first, then the old secrets home", () => {
    const env = { HOME: "/home/ada", XDG_CONFIG_HOME: "/home/ada/.config" } as NodeJS.ProcessEnv;
    const paths = legacyProviderSecretsKeyringPaths(env);
    expect(paths).toEqual([
      join("/home/ada/.config", "open-emails-secrets", "open-emails-provider-credentials.keyring.json"),
      join("/home/ada", ".hasna", "secrets", "open-emails-provider-credentials.keyring.json"),
    ]);
  });

  it("omits the XDG path when XDG_CONFIG_HOME is unset", () => {
    const paths = legacyProviderSecretsKeyringPaths({ HOME: "/home/ada" } as NodeJS.ProcessEnv);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain(join(".hasna", "secrets"));
  });

  it("an explicit env override wins unchanged, with no migration", () => {
    writeFileSync(keyringFile, "{}", { mode: 0o600 });
    const resolved = resolveProviderSecretsKeyringPath({ ...process.env, EMAILS_PROVIDER_SECRETS_KEY_FILE: keyringFile }, true);
    expect(resolved).toBe(keyringFile);
  });
});

describe("migrateProviderSecretsKeyring", () => {
  it("reports no source when nothing exists, in dryRun and live mode", () => {
    const env = { HOME: keyringDir } as NodeJS.ProcessEnv;
    expect(migrateProviderSecretsKeyring(env, true)).toEqual({ dryRun: true, from: null, to: defaultProviderSecretsKeyringPath(env) });
    expect(migrateProviderSecretsKeyring(env)).toEqual({ dryRun: false, from: null, to: defaultProviderSecretsKeyringPath(env) });
    // Nothing was written.
    expect(existsSync(defaultProviderSecretsKeyringPath(env))).toBe(false);
  });

  it("dryRun reports the legacy source and writes nothing", () => {
    const env = { HOME: keyringDir } as NodeJS.ProcessEnv;
    const legacy = legacyProviderSecretsKeyringPaths(env)[0]!;
    writeFileSync(legacy, "{}", { mode: 0o600 });
    const report = migrateProviderSecretsKeyring(env, true);
    expect(report.from).toBe(legacy);
    expect(existsSync(defaultProviderSecretsKeyringPath(env))).toBe(false);
    expect(existsSync(join(keyringDir, ".hasna", "emails", ".provider-keyring-migrated.receipt.json"))).toBe(false);
  });

  it("copies, verifies byte-for-byte, enforces 0600, and records a receipt", () => {
    const env = { HOME: keyringDir } as NodeJS.ProcessEnv;
    const legacy = legacyProviderSecretsKeyringPaths(env)[0]!;
    const body = JSON.stringify({ version: 1, active_key_id: "k1", keys: { k1: "AA==" } });
    writeFileSync(legacy, body, { mode: 0o640 });

    const report = migrateProviderSecretsKeyring(env);
    expect(report.from).toBe(legacy);
    const canonical = defaultProviderSecretsKeyringPath(env);
    expect(readFileSync(canonical, "utf8")).toBe(body);
    expect(statSync(canonical).mode & 0o777).toBe(0o600);
    // The legacy file is preserved — copy-only migration.
    expect(existsSync(legacy)).toBe(true);
    expect(existsSync(join(keyringDir, ".hasna", "emails", ".provider-keyring-migrated.receipt.json"))).toBe(true);
  });

  it("is idempotent: a receipt or an existing canonical skips the copy", () => {
    const env = { HOME: keyringDir } as NodeJS.ProcessEnv;
    const legacy = legacyProviderSecretsKeyringPaths(env)[0]!;
    writeFileSync(legacy, "{}", { mode: 0o600 });
    const first = migrateProviderSecretsKeyring(env);
    const second = migrateProviderSecretsKeyring(env);
    expect(first.from).toBe(legacy);
    expect(second.from).toBeNull();
  });

  it("never overwrites an existing canonical keyring", () => {
    const env = { HOME: keyringDir } as NodeJS.ProcessEnv;
    const canonical = defaultProviderSecretsKeyringPath(env);
    writeFileSync(canonical, "CANONICAL", { mode: 0o600 });
    const legacy = legacyProviderSecretsKeyringPaths(env)[0]!;
    writeFileSync(legacy, "LEGACY", { mode: 0o600 });
    const report = migrateProviderSecretsKeyring(env);
    expect(report.from).toBeNull();
    expect(readFileSync(canonical, "utf8")).toBe("CANONICAL");
  });
});

describe("store/get/update round-trip (ephemeral memory keyring)", () => {
  it("stores and returns secrets without leaking plaintext at rest", () => {
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "super-secret-value", access_key: "ak" }, db);
    const got = getProviderSecrets("prov-1", db);
    expect(got.api_key).toBe("super-secret-value");
    expect(got.access_key).toBe("ak");

    const row = storedRow("prov-1")!;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("ak");
  });

  it("normalizes empty strings and unknown fields to null", () => {
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "k", oauth_client_id: "" }, db);
    const got = getProviderSecrets("prov-1", db);
    expect(got.api_key).toBe("k");
    expect(got.oauth_client_id).toBeNull();
    // Every field of the shape is present.
    expect(Object.keys(got).sort()).toEqual(
      ["api_key", "access_key", "secret_key", "oauth_client_id", "oauth_client_secret", "oauth_refresh_token", "oauth_access_token", "oauth_token_expiry"].sort(),
    );
  });

  it("returns all-null for a provider with no stored secrets", () => {
    seedProvider("prov-1");
    const got = getProviderSecrets("prov-1", db);
    expect(got.api_key).toBeNull();
    expect(got.access_key).toBeNull();
  });

  it("deletes the row when storing no secrets", () => {
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "k" }, db);
    expect(storedRow("prov-1")).not.toBeNull();
    storeProviderSecrets("prov-1", {}, db);
    expect(storedRow("prov-1")).toBeNull();
  });

  it("increments the envelope revision on every store", () => {
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "v1" }, db);
    const first = storedRow("prov-1")!;
    storeProviderSecrets("prov-1", { api_key: "v2" }, db);
    const second = storedRow("prov-1")!;
    expect(Number(first["revision"])).toBe(1);
    expect(Number(second["revision"])).toBe(2);
  });

  it("updateProviderSecrets merges rather than replaces", () => {
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "k1", access_key: "a1" }, db);
    updateProviderSecrets("prov-1", { api_key: "k2" }, db);
    const got = getProviderSecrets("prov-1", db);
    expect(got.api_key).toBe("k2");
    expect(got.access_key).toBe("a1");
  });

  it("fails closed on a tampered envelope — never returns garbage", () => {
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "super-secret-value" }, db);
    const row = storedRow("prov-1")!;
    const ciphertext = String(row["ciphertext"]);
    // Flip one character of the base64 ciphertext.
    const flipped = (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1);
    db.run("UPDATE provider_secrets SET ciphertext = ? WHERE provider_id = ?", [flipped, "prov-1"]);
    expect(() => getProviderSecrets("prov-1", db)).toThrow(ProviderSecretsUnavailableError);
  });

  it("fails closed when the row references a root key that is unavailable", () => {
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "k" }, db);
    db.run("UPDATE provider_secrets SET root_key_id = 'epk_deadbeef' WHERE provider_id = 'prov-1'");
    expect(() => assertProviderSecretRootKeysAvailable(db)).toThrow(ProviderSecretsUnavailableError);
    expect(() => getProviderSecrets("prov-1", db)).toThrow(ProviderSecretsUnavailableError);
  });
});

describe("migratePlaintextProviderSecrets", () => {
  it("moves legacy plaintext columns into envelopes and clears them, once", () => {
    useLegacyPlaintextFixture();
    seedProvider("prov-1", { api_key: "legacy-plaintext-key", secret_key: "legacy-plaintext-secret" });
    seedProvider("prov-2", { api_key: "second-key" });

    const migrated = migratePlaintextProviderSecrets(db);
    expect(migrated).toBe(2);

    const row = storedRow("prov-1")!;
    expect(JSON.stringify(row)).not.toContain("legacy-plaintext-key");
    const cleared = db.query("SELECT api_key, secret_key FROM providers WHERE id = ?").get("prov-1") as { api_key: string | null; secret_key: string | null };
    expect(cleared.api_key).toBeNull();
    expect(cleared.secret_key).toBeNull();

    // Round-trip proves the envelope carries the value.
    expect(getProviderSecrets("prov-1", db).api_key).toBe("legacy-plaintext-key");

    // Idempotent: a second pass migrates nothing.
    expect(migratePlaintextProviderSecrets(db)).toBe(0);
  });

  it("skips providers with no plaintext credentials", () => {
    useLegacyPlaintextFixture();
    seedProvider("prov-1");
    expect(migratePlaintextProviderSecrets(db)).toBe(0);
  });

  it("a previously encrypted write wins over leftover plaintext", () => {
    useLegacyPlaintextFixture();
    seedProvider("prov-1", { api_key: "plaintext-old" });
    storeProviderSecrets("prov-1", { api_key: "encrypted-new" }, db);
    expect(migratePlaintextProviderSecrets(db)).toBe(1);
    expect(getProviderSecrets("prov-1", db).api_key).toBe("encrypted-new");
  });

  it("the current schema refuses plaintext credential columns outright", () => {
    // Positive control for the fixture: WITHOUT the legacy fixture, the
    // migration-49 triggers reject plaintext writes.
    expect(() => seedProvider("prov-1", { api_key: "plaintext" })).toThrow(
      /provider credentials must use the encrypted provider_secrets store/,
    );
  });
});

describe("rotation and revocation (file-backed keyring)", () => {
  it("rotate stages the new key, rewraps every envelope, then activates it", () => {
    useFileBackedDatabase();
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "k1" }, db);
    const statusBefore = providerSecretsKeyStatus(db);
    expect(statusBefore.availableKeyIds).toHaveLength(1);

    const rotated = rotateProviderSecretsRootKey(db);
    expect(rotated.previousKeyId).not.toBe(rotated.activeKeyId);
    expect(rotated.rewrapped).toBe(1);

    const statusAfter = providerSecretsKeyStatus(db);
    expect(statusAfter.activeKeyId).toBe(rotated.activeKeyId);
    expect(statusAfter.availableKeyIds).toContain(rotated.activeKeyId);
    expect(statusAfter.availableKeyIds).toContain(rotated.previousKeyId);

    // The rewrapped envelope still decrypts.
    expect(getProviderSecrets("prov-1", db).api_key).toBe("k1");
    // And the stored row now references the new active key.
    expect(storedRow("prov-1")!["root_key_id"]).toBe(rotated.activeKeyId);
  });

  it("revocation refuses the active key and any still-referenced key", () => {
    useFileBackedDatabase();
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "k1" }, db);
    const { activeKeyId } = providerSecretsKeyStatus(db);

    expect(() => revokeProviderSecretsRootKey(activeKeyId!, db)).toThrow(ProviderSecretsUnavailableError);
    expect(() => revokeProviderSecretsRootKey("epk_nonexistent", db)).toThrow(ProviderSecretsUnavailableError);

    // After rotation the old key is unreferenced and may be revoked.
    const rotated = rotateProviderSecretsRootKey(db);
    expect(() => revokeProviderSecretsRootKey(rotated.previousKeyId, db)).not.toThrow();
    const status = providerSecretsKeyStatus(db);
    expect(status.availableKeyIds).not.toContain(rotated.previousKeyId);
    expect(status.availableKeyIds).toContain(rotated.activeKeyId);
  });

  it("rotation requires a file-backed keyring — refuses inline/memory keys", () => {
    // No EMAILS_PROVIDER_SECRETS_KEY_FILE and a :memory: database: the root
    // keyring is ephemeral, so rotation must refuse rather than rotate
    // something that cannot survive the process.
    seedProvider("prov-1");
    storeProviderSecrets("prov-1", { api_key: "k1" }, db);
    expect(() => rotateProviderSecretsRootKey(db)).toThrow(ProviderSecretsUnavailableError);
  });
});
