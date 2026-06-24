import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testHome: string;

beforeEach(() => {
  testHome = join(tmpdir(), `open-secrets-legacy-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
});

describe("legacy ~/.open-secrets migration", () => {
  it("copies a legacy ~/.open-secrets/vault.db into the canonical ~/.hasna/secrets vault", () => {
    const legacyPath = join(testHome, ".open-secrets", "vault.db");
    createVault(legacyPath, [
      { key: "legacy/api_key", value: "legacy-secret-value", type: "api_key", label: "Legacy API key" },
    ]);
    const beforeMtime = statSync(legacyPath).mtimeMs;

    const result = readVaultFromSpawnedProcess(testHome);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("legacy-secret-value");
    expect(result.parsed.path).toBe(join(testHome, ".hasna", "secrets", "vault.db"));
    expect(result.parsed.secrets).toContainEqual({
      key: "legacy/api_key",
      value: "legacy-secret-value",
      type: "api_key",
      label: "Legacy API key",
    });
    expect(existsSync(legacyPath)).toBe(true);
    expect(statSync(legacyPath).mtimeMs).toBe(beforeMtime);
    expect(readdirSync(join(testHome, ".open-secrets")).sort()).toEqual(["vault.db"]);
  });

  it("merges legacy rows without overwriting canonical rows and backs up existing canonical data", () => {
    const canonicalPath = join(testHome, ".hasna", "secrets", "vault.db");
    const legacyPath = join(testHome, ".open-secrets", "vault.db");
    createVault(canonicalPath, [
      { key: "shared/token", value: "canonical-value", type: "token", label: "Canonical token" },
      { key: "canonical/only", value: "canonical-only-value", type: "other" },
    ]);
    createVault(legacyPath, [
      { key: "shared/token", value: "legacy-value-should-not-win", type: "token", label: "Legacy token" },
      { key: "legacy/only", value: "legacy-only-value", type: "password", label: "Legacy only" },
    ]);

    const result = readVaultFromSpawnedProcess(testHome);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("legacy-value-should-not-win");
    expect(result.parsed.secrets).toContainEqual({
      key: "shared/token",
      value: "canonical-value",
      type: "token",
      label: "Canonical token",
    });
    expect(result.parsed.secrets).toContainEqual({
      key: "legacy/only",
      value: "legacy-only-value",
      type: "password",
      label: "Legacy only",
    });
    expect(existsSync(legacyPath)).toBe(true);
    const canonicalFiles = readdirSync(join(testHome, ".hasna", "secrets"));
    const backupFiles = canonicalFiles.filter((name) => /^vault\.db\.pre-open-secrets-migration-\d+\.bak$/.test(name));
    expect(backupFiles).toHaveLength(1);
    const backupPath = join(testHome, ".hasna", "secrets", backupFiles[0]);
    expect((statSync(backupPath).mode & 0o777).toString(8)).toBe("600");
    expect(readVaultRows(backupPath)).toContainEqual({
      key: "shared/token",
      value: "canonical-value",
      type: "token",
      label: "Canonical token",
    });

    const secondRun = readVaultFromSpawnedProcess(testHome);
    expect(secondRun.exitCode).toBe(0);
    expect(secondRun.parsed.secrets).toHaveLength(3);
    const canonicalFilesAfterSecondRun = readdirSync(join(testHome, ".hasna", "secrets"));
    expect(canonicalFilesAfterSecondRun.filter((name) => /^vault\.db\.pre-open-secrets-migration-\d+\.bak$/.test(name))).toHaveLength(1);
  });

  it("does not resurrect an imported legacy secret after canonical deletion", () => {
    const legacyPath = join(testHome, ".open-secrets", "vault.db");
    createVault(legacyPath, [
      { key: "legacy/delete-me", value: "legacy-delete-value", type: "token", label: "Delete me" },
    ]);

    const firstRun = readVaultFromSpawnedProcess(testHome);
    expect(firstRun.exitCode).toBe(0);
    expect(firstRun.parsed.secrets.map((entry) => entry.key)).toContain("legacy/delete-me");

    const deleted = runInSpawnedProcess(testHome, `
      import { deleteSecret, listSecrets } from "./src/store.js";
      deleteSecret("legacy/delete-me");
      console.log(JSON.stringify({ keys: listSecrets().map((entry) => entry.key) }));
    `);
    expect(deleted.exitCode).toBe(0);
    expect(deleted.parsed.keys).not.toContain("legacy/delete-me");

    const secondRun = readVaultFromSpawnedProcess(testHome);
    expect(secondRun.exitCode).toBe(0);
    expect(secondRun.parsed.secrets.map((entry) => entry.key)).not.toContain("legacy/delete-me");
    expect(existsSync(legacyPath)).toBe(true);
  });

  it("skips a corrupt legacy DB without blocking canonical startup", () => {
    const canonicalPath = join(testHome, ".hasna", "secrets", "vault.db");
    const legacyPath = join(testHome, ".open-secrets", "vault.db");
    createVault(canonicalPath, [
      { key: "canonical/only", value: "canonical-only-value", type: "other" },
    ]);
    mkdirSync(join(legacyPath, ".."), { recursive: true });
    writeFileSync(legacyPath, "not a sqlite database", { mode: 0o600 });

    const result = readVaultFromSpawnedProcess(testHome);

    expect(result.exitCode).toBe(0);
    expect(result.parsed.secrets).toContainEqual({
      key: "canonical/only",
      value: "canonical-only-value",
      type: "other",
      label: null,
    });
  });

  it("skips a legacy DB that attaches but fails integrity checks", () => {
    const canonicalPath = join(testHome, ".hasna", "secrets", "vault.db");
    const legacyPath = join(testHome, ".open-secrets", "vault.db");
    createVault(canonicalPath, [
      { key: "canonical/only", value: "canonical-only-value", type: "other" },
    ]);
    createVault(legacyPath, [
      { key: "legacy/only", value: "legacy-only-value", type: "password", label: "Legacy only" },
    ]);
    const bytes = readFileSync(legacyPath);
    bytes[100] = bytes[100] ^ 0xff;
    writeFileSync(legacyPath, bytes, { mode: 0o600 });

    const result = readVaultFromSpawnedProcess(testHome);

    expect(result.exitCode).toBe(0);
    expect(result.parsed.secrets).toContainEqual({
      key: "canonical/only",
      value: "canonical-only-value",
      type: "other",
      label: null,
    });
    expect(result.parsed.secrets.map((entry) => entry.key)).not.toContain("legacy/only");
  });

  it("does not migrate legacy data when an explicit database override is set", () => {
    const overridePath = join(testHome, "custom", "vault.db");
    const legacyPath = join(testHome, ".open-secrets", "vault.db");
    createVault(legacyPath, [
      { key: "legacy/only", value: "legacy-only-value", type: "password", label: "Legacy only" },
    ]);

    const result = readVaultFromSpawnedProcess(testHome, { OPEN_SECRETS_DB: overridePath });

    expect(result.exitCode).toBe(0);
    expect(result.parsed.path).toBe(overridePath);
    expect(result.parsed.secrets).toEqual([]);
    expect(existsSync(legacyPath)).toBe(true);
  });

  it("does not migrate legacy data when HASNA_SECRETS_DB_PATH is set", () => {
    const overridePath = join(testHome, "custom-hasna", "vault.db");
    const legacyPath = join(testHome, ".open-secrets", "vault.db");
    createVault(legacyPath, [
      { key: "legacy/only", value: "legacy-only-value", type: "password", label: "Legacy only" },
    ]);

    const result = readVaultFromSpawnedProcess(testHome, { HASNA_SECRETS_DB_PATH: overridePath });

    expect(result.exitCode).toBe(0);
    expect(result.parsed.path).toBe(overridePath);
    expect(result.parsed.secrets).toEqual([]);
    expect(existsSync(legacyPath)).toBe(true);
  });
});

function createVault(
  path: string,
  rows: Array<{ key: string; value: string; type: string; label?: string }>
): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new Database(path, { create: true });
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        type       TEXT NOT NULL DEFAULT 'other',
        label      TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        action    TEXT NOT NULL,
        key       TEXT NOT NULL,
        agent     TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    for (const row of rows) {
      db.prepare(`
        INSERT INTO secrets (key, value, type, label, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?)
      `).run(row.key, row.value, row.type, row.label ?? null, now, now);
    }
  } finally {
    db.close();
  }
}

function readVaultRows(path: string): Array<Record<string, string | null>> {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare("SELECT key, value, type, label FROM secrets ORDER BY key").all() as Array<Record<string, string | null>>;
  } finally {
    db.close();
  }
}

function readVaultFromSpawnedProcess(
  home: string,
  env: Record<string, string> = {}
): { exitCode: number | null; stderr: string; parsed: { path: string; secrets: Array<Record<string, string | undefined>> } } {
  return runInSpawnedProcess(home, `
    import { getVaultPath, listSecrets } from "./src/store.js";
    const secrets = listSecrets().map((entry) => ({
      key: entry.key,
      value: entry.value,
      type: entry.type,
      label: entry.label,
    }));
    console.log(JSON.stringify({ path: getVaultPath(), secrets }));
  `, env);
}

function runInSpawnedProcess(
  home: string,
  script: string,
  env: Record<string, string> = {}
): { exitCode: number | null; stderr: string; parsed: any } {
  const spawnEnv = { ...process.env, HOME: home, HASNA_SECRETS_KEY_DIR: join(home, ".hasna", "secrets"), ...env };
  if (!("HASNA_SECRETS_DB_PATH" in env)) delete spawnEnv.HASNA_SECRETS_DB_PATH;
  if (!("OPEN_SECRETS_DB" in env)) delete spawnEnv.OPEN_SECRETS_DB;
  const proc = Bun.spawnSync({
    cmd: [
      "bun",
      "--eval",
      script,
    ],
    cwd: join(import.meta.dir, ".."),
    env: spawnEnv,
  });
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  const stderr = new TextDecoder().decode(proc.stderr);
  return {
    exitCode: proc.exitCode,
    stderr,
    parsed: stdout ? JSON.parse(stdout) : {},
  };
}
