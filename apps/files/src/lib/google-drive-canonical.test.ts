/**
 * Canonical Google Drive token-store root regression tests for @hasna/files.
 *
 * Fleet law: app data lives at ~/.hasna/<app>/. The Google Drive connector
 * token store (OAuth tokens.json / config.json per profile) used to default to
 * ~/.hasna/connectors/{googledrive,connect-googledrive} — outside the app data
 * root. The default is now the files data root/connectors/, with a one-time
 * copy+verify+receipt migration from the legacy default (dry-run supported).
 *
 * These tests pin: the canonical default dirs, the env overrides still
 * winning, and the migration properties (copy, verify, receipt, source
 * preserved, no overwrite, idempotent, resumable, dry-run writes nothing).
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { googleDriveConnectorDirs, migrateGoogleDriveTokenStore } from "./google-drive-client.js";

function fakeEnv(overrides: Record<string, string> = {}): { env: NodeJS.ProcessEnv; home: string } {
  const home = mkdtempSync(join(tmpdir(), "files-canonical-"));
  return { env: { HOME: home, ...overrides }, home };
}

function cleanup(fake: { env: NodeJS.ProcessEnv; home: string }): void {
  rmSync(fake.home, { recursive: true, force: true });
}

function writeJson(path: string, content: string): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

describe("canonical google drive connector dirs", () => {
  test("default dirs resolve to the files data root/connectors with legacy fallbacks appended", () => {
    const fake = fakeEnv();
    try {
      const dirs = googleDriveConnectorDirs(fake.env);
      expect(dirs).toEqual([
        join(fake.home, ".hasna", "files", "connectors", "googledrive"),
        join(fake.home, ".hasna", "files", "connectors", "connect-googledrive"),
        join(fake.home, ".hasna", "connectors", "googledrive"),
        join(fake.home, ".hasna", "connectors", "connect-googledrive"),
      ]);
    } finally {
      cleanup(fake);
    }
  });

  test("HASNA_GOOGLE_DRIVE_CONNECTOR_DIR wins and triggers no migration", () => {
    const fake = fakeEnv({ HASNA_GOOGLE_DRIVE_CONNECTOR_DIR: "/tmp/gd-explicit" });
    try {
      expect(googleDriveConnectorDirs(fake.env)).toEqual(["/tmp/gd-explicit"]);
      const result = migrateGoogleDriveTokenStore(fake.env);
      expect(result.migrated).toBe(false);
      expect(result.filesCopied).toEqual([]);
    } finally {
      cleanup(fake);
    }
  });

  test("GOOGLE_DRIVE_CONNECTOR_DIR wins", () => {
    const fake = fakeEnv({ GOOGLE_DRIVE_CONNECTOR_DIR: "/tmp/gd-explicit-2" });
    try {
      expect(googleDriveConnectorDirs(fake.env)).toEqual(["/tmp/gd-explicit-2"]);
    } finally {
      cleanup(fake);
    }
  });

  test("HASNA_CONNECTORS_DIR wins and appends the googledrive subdirs", () => {
    const fake = fakeEnv({ HASNA_CONNECTORS_DIR: "/tmp/connectors-dir" });
    try {
      expect(googleDriveConnectorDirs(fake.env)).toEqual([
        join("/tmp/connectors-dir", "googledrive"),
        join("/tmp/connectors-dir", "connect-googledrive"),
      ]);
    } finally {
      cleanup(fake);
    }
  });
});

describe("one-time google drive token store migration", () => {
  const seedLegacy = (fake: { env: NodeJS.ProcessEnv; home: string }): string => {
    const legacy = join(fake.home, ".hasna", "connectors", "googledrive");
    writeJson(join(legacy, "credentials.json"), JSON.stringify({ clientId: "fixture", clientSecret: "fixture" }));
    writeJson(
      join(legacy, "profiles", "default", "tokens.json"),
      JSON.stringify({ accessToken: "fixture", refreshToken: "fixture" }),
    );
    writeJson(join(legacy, "profiles", "default", "config.json"), JSON.stringify({ scope: "fixture" }));
    return legacy;
  };

  test("copies legacy profiles into the canonical root, verifies, receipts, keeps the source", () => {
    const fake = fakeEnv();
    try {
      const legacy = seedLegacy(fake);
      const dest = join(fake.home, ".hasna", "files", "connectors", "googledrive");

      const result = migrateGoogleDriveTokenStore(fake.env);

      expect(result.migrated).toBe(true);
      expect(result.conflicts).toEqual([]);
      expect(result.filesCopied.sort()).toEqual(["credentials.json", "profiles/default/config.json", "profiles/default/tokens.json"]);
      expect(existsSync(join(dest, "credentials.json"))).toBe(true);
      expect(existsSync(join(dest, "profiles", "default", "tokens.json"))).toBe(true);
      expect(readFileSync(join(dest, "profiles", "default", "tokens.json")).toString()).toContain("refreshToken");
      // Receipt recorded.
      expect(
        existsSync(join(fake.home, ".hasna", "files", "connectors", ".googledrive-migrated.receipt.json")),
      ).toBe(true);
      // Source is never deleted.
      expect(existsSync(legacy)).toBe(true);
      expect(existsSync(join(legacy, "profiles", "default", "tokens.json"))).toBe(true);
    } finally {
      cleanup(fake);
    }
  });

  test("is idempotent and resumable — a second run copies nothing", () => {
    const fake = fakeEnv();
    try {
      seedLegacy(fake);
      const first = migrateGoogleDriveTokenStore(fake.env);
      const second = migrateGoogleDriveTokenStore(fake.env);
      expect(second.migrated).toBe(false);
      expect(second.filesCopied).toEqual([]);
      expect(first.filesCopied.length).toBe(3);
    } finally {
      cleanup(fake);
    }
  });

  test("never overwrites existing canonical data — differing files are conflicts, not copies", () => {
    const fake = fakeEnv();
    try {
      seedLegacy(fake);
      const dest = join(fake.home, ".hasna", "files", "connectors", "googledrive");
      // Canonical data exists first and differs from the legacy copy.
      writeJson(join(dest, "credentials.json"), JSON.stringify({ clientId: "canonical" }));

      const result = migrateGoogleDriveTokenStore(fake.env);
      expect(result.conflicts).toContain("credentials.json");
      // The canonical file is untouched.
      expect(readFileSync(join(dest, "credentials.json")).toString()).toContain("canonical");
      // The non-conflicting files still land.
      expect(result.filesCopied).toContain("profiles/default/tokens.json");
    } finally {
      cleanup(fake);
    }
  });

  test("dry-run copies nothing and reports what would be copied", () => {
    const fake = fakeEnv();
    try {
      seedLegacy(fake);
      const dest = join(fake.home, ".hasna", "files", "connectors", "googledrive");

      const result = migrateGoogleDriveTokenStore(fake.env, true);

      expect(result.dryRun).toBe(true);
      expect(result.filesCopied.length).toBe(3);
      expect(existsSync(join(dest, "credentials.json"))).toBe(false);
      expect(
        existsSync(join(fake.home, ".hasna", "files", "connectors", ".googledrive-migrated.receipt.json")),
      ).toBe(false);
    } finally {
      cleanup(fake);
    }
  });

  test("no migration when there is no legacy store", () => {
    const fake = fakeEnv();
    try {
      const result = migrateGoogleDriveTokenStore(fake.env);
      expect(result.migrated).toBe(false);
      expect(result.filesCopied).toEqual([]);
      expect(existsSync(join(fake.home, ".hasna", "files"))).toBe(false);
    } finally {
      cleanup(fake);
    }
  });
});
