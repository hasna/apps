import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDb } from "../src/db.js";
import { exportEnv, importEnv } from "../src/env.js";
import { LocalStore } from "../src/store/index.js";

const _store = new LocalStore();
const getSecret = _store.getSecret.bind(_store);
const setSecret = _store.setSecret.bind(_store);

let testDir: string;
let secretsDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `open-secrets-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  secretsDir = join(testDir, ".secrets");
  mkdirSync(secretsDir, { recursive: true });
  process.env.OPEN_SECRETS_DB = join(testDir, "vault.db");
  resetDb();
});

afterEach(async () => {
  resetDb();
  delete process.env.OPEN_SECRETS_DB;
  rmSync(testDir, { recursive: true, force: true });
});

describe("env-file bridge", () => {
  it("exports canonical Hasna prod keys to prod.env", async () => {
    await setSecret("hasna/xyz/opensource/files/prod/rds", "postgres://example", "credential");

    const result = await exportEnv({ dir: secretsDir, force: true });
    const envPath = join(secretsDir, "hasna/xyz/opensource/files/prod.env");

    expect(result.exported).toBe(1);
    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, "utf-8")).toContain(
      'HASNA_XYZ_OPENSOURCE_FILES_PROD_RDS="postgres://example"'
    );
  });

  it("round-trips canonical Hasna prod env files", async () => {
    const envDir = join(secretsDir, "hasna/xyz/opensource/files");
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      join(envDir, "prod.env"),
      'HASNA_XYZ_OPENSOURCE_FILES_PROD_RDS="postgres://example"\n'
    );

    const result = await importEnv({ dir: secretsDir });

    expect(result.imported).toBe(1);
    expect((await getSecret("hasna/xyz/opensource/files/prod/rds"))!.value).toBe("postgres://example");
  });

  it("exports pr-number env keys with valid env var names", async () => {
    await setSecret("hasna/xyz/opensource/files/pr-123/database_url", "postgres://preview", "credential");

    await exportEnv({ dir: secretsDir, force: true });
    const envPath = join(secretsDir, "hasna/xyz/opensource/files/pr-123.env");

    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, "utf-8")).toContain(
      'HASNA_XYZ_OPENSOURCE_FILES_PR_123_DATABASE_URL="postgres://preview"'
    );
  });

  it("imports pr-number env files into canonical keys", async () => {
    const envDir = join(secretsDir, "hasna/xyz/opensource/files");
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      join(envDir, "pr-123.env"),
      'HASNA_XYZ_OPENSOURCE_FILES_PR_123_DATABASE_URL="postgres://preview"\n'
    );

    await importEnv({ dir: secretsDir });

    expect((await getSecret("hasna/xyz/opensource/files/pr-123/database_url"))!.value).toBe(
      "postgres://preview"
    );
  });
});
