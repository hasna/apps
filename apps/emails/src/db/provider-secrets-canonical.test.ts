/**
 * Canonical provider-secrets keyring root regression tests for @hasna/emails.
 *
 * Convention (ruling #1668): app data lives at the resolver data root (~/.hasna/<app>/ on macOS). The provider-credential
 * keyring (the encrypted root-key file) used to default to
 * ${XDG_CONFIG_HOME}/open-emails-secrets/... or the secrets data root/... — both
 * outside the app's data root. The default is now
 * the emails data root/open-emails-provider-credentials.keyring.json, with a
 * one-time copy+verify+receipt migration from the two old defaults.
 *
 * These tests pin: the canonical default, the env override still winning, the
 * legacy path enumeration, and the migration properties (copy, verify, receipt,
 * source preserved, no overwrite, idempotent, read-only keeps the legacy file).
 */
import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultProviderSecretsKeyringPath,
  legacyProviderSecretsKeyringPaths,
  migrateProviderSecretsKeyring,
  resolveProviderSecretsKeyringPath,
} from "./provider-secrets.js";

interface KeyringFile {
  version: number;
  active_key_id: string;
  keys: Record<string, string>;
}

function makeKeyring(): { json: KeyringFile; raw: Buffer } {
  const key = randomBytes(32);
  const id = `epk_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
  const json: KeyringFile = { version: 1, active_key_id: id, keys: { [id]: key.toString("base64") } };
  return { json, raw: Buffer.from(`${JSON.stringify(json)}\n`) };
}

function fakeEnv(overrides: Record<string, string> = {}, home?: string): { env: NodeJS.ProcessEnv; home: string } {
  const h = home ?? mkdtempSync(join(tmpdir(), "emails-keyring-"));
  return { env: { HOME: h, ...overrides }, home: h };
}

function fakeEnvWithXdg(): { env: NodeJS.ProcessEnv; home: string } {
  const home = mkdtempSync(join(tmpdir(), "emails-keyring-"));
  return fakeEnv({ XDG_CONFIG_HOME: join(home, "xdgconf") }, home);
}

function writeKeyring(path: string, raw: Buffer): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, raw, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function cleanup(fake: { env: NodeJS.ProcessEnv; home: string }): void {
  rmSync(fake.home, { recursive: true, force: true });
}

describe("canonical keyring default", () => {
  test("default path resolves to the resolver data root keyring file", () => {
    const fake = fakeEnv();
    try {
      expect(defaultProviderSecretsKeyringPath(fake.env)).toBe(
        join(fake.home, ".hasna", "emails", "open-emails-provider-credentials.keyring.json"),
      );
    } finally {
      cleanup(fake);
    }
  });

  test("legacy paths are enumerated: XDG first, then the secrets data root", () => {
    const fake = fakeEnvWithXdg();
    try {
      const legacy = legacyProviderSecretsKeyringPaths(fake.env);
      expect(legacy).toEqual([
        join(fake.home, "xdgconf", "open-emails-secrets", "open-emails-provider-credentials.keyring.json"),
        join(fake.home, ".hasna", "secrets", "open-emails-provider-credentials.keyring.json"),
      ]);
    } finally {
      cleanup(fake);
    }
  });

  test("legacy paths without XDG_CONFIG_HOME fall back to the secrets data root only", () => {
    const fake = fakeEnv();
    try {
      expect(legacyProviderSecretsKeyringPaths(fake.env)).toEqual([
        join(fake.home, ".hasna", "secrets", "open-emails-provider-credentials.keyring.json"),
      ]);
    } finally {
      cleanup(fake);
    }
  });

  test("EMAILS_PROVIDER_SECRETS_KEY_FILE override wins and triggers no migration", () => {
    const fake = fakeEnv({ EMAILS_PROVIDER_SECRETS_KEY_FILE: "/tmp/emails-keyring-explicit/keyring.json" });
    try {
      expect(resolveProviderSecretsKeyringPath(fake.env, true)).toBe("/tmp/emails-keyring-explicit/keyring.json");
    } finally {
      cleanup(fake);
    }
  });
});

describe("one-time keyring migration", () => {
  test("migrates a legacy XDG keyring to the canonical root: copy, 0600, receipt, source preserved", () => {
    const fake = fakeEnvWithXdg();
    try {
      const { raw } = makeKeyring();
      const legacy = legacyProviderSecretsKeyringPaths(fake.env)[0]!;
      writeKeyring(legacy, raw);

      const canonical = defaultProviderSecretsKeyringPath(fake.env);
      expect(existsSync(canonical)).toBe(false);

      const resolved = resolveProviderSecretsKeyringPath(fake.env, true);

      expect(resolved).toBe(canonical);
      expect(existsSync(canonical)).toBe(true);
      // Copied content is identical and the mode is 0600 (readKeyringFile enforces it).
      expect(readFileSync(canonical).equals(raw)).toBe(true);
      expect(statSync(canonical).mode & 0o777).toBe(0o600);
      // Receipt recorded.
      expect(
        existsSync(join(fake.home, ".hasna", "emails", ".provider-keyring-migrated.receipt.json")),
      ).toBe(true);
      // Source is never deleted.
      expect(existsSync(legacy)).toBe(true);
    } finally {
      cleanup(fake);
    }
  });

  test("migrates a legacy the secrets data root keyring too", () => {
    const fake = fakeEnv();
    try {
      const { raw } = makeKeyring();
      const legacy = legacyProviderSecretsKeyringPaths(fake.env)[0]!;
      writeKeyring(legacy, raw);

      const resolved = resolveProviderSecretsKeyringPath(fake.env, true);
      expect(resolved).toBe(defaultProviderSecretsKeyringPath(fake.env));
      expect(readFileSync(resolved).equals(raw)).toBe(true);
    } finally {
      cleanup(fake);
    }
  });

  test("is idempotent — a second resolve changes nothing", () => {
    const fake = fakeEnvWithXdg();
    try {
      const { raw } = makeKeyring();
      writeKeyring(legacyProviderSecretsKeyringPaths(fake.env)[0]!, raw);

      const first = resolveProviderSecretsKeyringPath(fake.env, true);
      const canonicalBefore = readFileSync(first);
      const receiptBefore = readFileSync(
        join(fake.home, ".hasna", "emails", ".provider-keyring-migrated.receipt.json"),
      );

      const second = resolveProviderSecretsKeyringPath(fake.env, true);
      expect(second).toBe(first);
      expect(readFileSync(second).equals(canonicalBefore)).toBe(true);
      expect(
        readFileSync(join(fake.home, ".hasna", "emails", ".provider-keyring-migrated.receipt.json")).equals(
          receiptBefore,
        ),
      ).toBe(true);
    } finally {
      cleanup(fake);
    }
  });

  test("never overwrites an existing canonical keyring", () => {
    const fake = fakeEnvWithXdg();
    try {
      const { raw: canonicalRaw } = makeKeyring();
      const canonical = defaultProviderSecretsKeyringPath(fake.env);
      writeKeyring(canonical, canonicalRaw);

      const { raw: legacyRaw } = makeKeyring();
      writeKeyring(legacyProviderSecretsKeyringPaths(fake.env)[0]!, legacyRaw);

      const resolved = resolveProviderSecretsKeyringPath(fake.env, true);
      expect(resolved).toBe(canonical);
      expect(readFileSync(canonical).equals(canonicalRaw)).toBe(true);
    } finally {
      cleanup(fake);
    }
  });

  test("dry-run reports the legacy source and writes nothing", () => {
    const fake = fakeEnvWithXdg();
    try {
      const { raw } = makeKeyring();
      const legacy = legacyProviderSecretsKeyringPaths(fake.env)[0]!;
      writeKeyring(legacy, raw);

      const report = migrateProviderSecretsKeyring(fake.env, true);

      expect(report.dryRun).toBe(true);
      expect(report.from).toBe(legacy);
      expect(existsSync(defaultProviderSecretsKeyringPath(fake.env))).toBe(false);
      expect(
        existsSync(join(fake.home, ".hasna", "emails", ".provider-keyring-migrated.receipt.json")),
      ).toBe(false);
    } finally {
      cleanup(fake);
    }
  });

  test("read-only resolution keeps using the legacy keyring when canonical is absent", () => {
    const fake = fakeEnvWithXdg();
    try {
      const { raw } = makeKeyring();
      const legacy = legacyProviderSecretsKeyringPaths(fake.env)[0]!;
      writeKeyring(legacy, raw);

      const resolved = resolveProviderSecretsKeyringPath(fake.env, false);
      expect(resolved).toBe(legacy);
      expect(existsSync(defaultProviderSecretsKeyringPath(fake.env))).toBe(false);
    } finally {
      cleanup(fake);
    }
  });

  test("fresh resolve with no legacy data returns the canonical path for creation", () => {
    const fake = fakeEnv();
    try {
      const resolved = resolveProviderSecretsKeyringPath(fake.env, true);
      expect(resolved).toBe(defaultProviderSecretsKeyringPath(fake.env));
      expect(existsSync(resolved)).toBe(false);
    } finally {
      cleanup(fake);
    }
  });
});
