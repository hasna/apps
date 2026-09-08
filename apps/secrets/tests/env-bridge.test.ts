import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { exportEnv, importEnv } from "../src/env.js";
import { getStore, type Store } from "../src/store/index.js";
import { startLoopbackVault } from "./loopback-vault-fixture.mjs";

let _store: Store;
const getSecret: Store["getSecret"] = (...args) => _store.getSecret(...args);
const setSecret: Store["setSecret"] = (...args) => _store.setSecret(...args);

let testDir: string;
let vault: Awaited<ReturnType<typeof startLoopbackVault>>;
let savedEnv: NodeJS.ProcessEnv;
let secretsDir: string;

beforeEach(async () => {
  savedEnv = { ...process.env };
  testDir = join(tmpdir(), `secrets-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  secretsDir = join(testDir, ".secrets");
  mkdirSync(secretsDir, { recursive: true });
  vault = await startLoopbackVault(testDir);
  for (const key of Object.keys(process.env)) if (/^(HASNA_|SECRETS_|OPEN_SECRETS_|AWS_|DATABASE_URL$|PG|XDG_)/.test(key)) delete process.env[key];
  Object.assign(process.env, vault.env(), { HASNA_SECRETS_TEST_ISOLATION: "1" });
  _store = getStore();
});

afterEach(async () => {
  try { await vault.stop(); } finally {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("env-file bridge", () => {
  it("exports canonical Hasna prod keys to prod.env", async () => {
    await setSecret("hasna/xyz/opensource/example/prod/rds", "postgres://example", "credential");

    const result = await exportEnv({ dir: secretsDir, force: true });
    const envPath = join(secretsDir, "hasna/xyz/opensource/example/prod.env");

    expect(result.exported).toBe(1);
    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, "utf-8")).toContain(
      'HASNA_XYZ_OPENSOURCE_EXAMPLE_PROD_RDS="postgres://example"'
    );
  });

  it("round-trips canonical Hasna prod env files", async () => {
    const envDir = join(secretsDir, "hasna/xyz/opensource/example");
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      join(envDir, "prod.env"),
      'HASNA_XYZ_OPENSOURCE_EXAMPLE_PROD_RDS="postgres://example"\n'
    );

    const result = await importEnv({ dir: secretsDir });

    expect(result.imported).toBe(1);
    expect((await getSecret("hasna/xyz/opensource/example/prod/rds"))!.value).toBe("postgres://example");
  });

  it("exports pr-number env keys with valid env var names", async () => {
    await setSecret("hasna/xyz/opensource/example/pr-123/database_url", "preview", "credential");

    await exportEnv({ dir: secretsDir, force: true });
    const envPath = join(secretsDir, "hasna/xyz/opensource/example/pr-123.env");

    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, "utf-8")).toContain(
      'HASNA_XYZ_OPENSOURCE_EXAMPLE_PR_123_DATABASE_URL="preview"'
    );
  });

  it("imports pr-number env files into canonical keys", async () => {
    const envDir = join(secretsDir, "hasna/xyz/opensource/example");
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      join(envDir, "pr-123.env"),
      'HASNA_XYZ_OPENSOURCE_EXAMPLE_PR_123_DATABASE_URL="preview"\n'
    );

    await importEnv({ dir: secretsDir });

    expect((await getSecret("hasna/xyz/opensource/example/pr-123/database_url"))!.value).toBe(
      "preview"
    );
  });
});
