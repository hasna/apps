import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPostgresPoolConfig,
  ensureMarkdownDataDir,
  listFeedback,
  openMarkdownDatabase,
  resolveMachineId,
  resolveRemoteDatabaseUrl,
  saveFeedback,
  storagePull,
  storageStatus,
} from "./storage.js";

const tempDirs: string[] = [];

function tempEnv(extra: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "open-markdown-storage-"));
  tempDirs.push(dir);
  return {
    HASNA_MARKDOWN_DIR: dir,
    HASNA_MARKDOWN_MACHINE_ID: "machine-test-1",
    ...extra,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("markdown storage", () => {
  test("stores feedback locally with machine identity", () => {
    const env = tempEnv();

    const record = saveFeedback({ message: "Useful service", category: "feature", version: "0.0.0" }, env);
    const rows = listFeedback(env);

    expect(record.machine_id).toBe("machine-test-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: record.id,
      message: "Useful service",
      category: "feature",
      version: "0.0.0",
      machine_id: "machine-test-1",
    });
  });

  test("creates private local storage directory and database files", () => {
    const env = tempEnv();
    const db = openMarkdownDatabase(env);
    db.close();

    const dbPath = join(env.HASNA_MARKDOWN_DIR, "markdown.db");
    expect(statSync(env.HASNA_MARKDOWN_DIR).mode & 0o777).toBe(0o700);
    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
  });

  test("status and ensure create a private local storage directory", () => {
    const env = tempEnv();
    rmSync(env.HASNA_MARKDOWN_DIR, { recursive: true, force: true });

    expect(ensureMarkdownDataDir(env)).toBe(env.HASNA_MARKDOWN_DIR);
    expect(statSync(env.HASNA_MARKDOWN_DIR).mode & 0o777).toBe(0o700);

    rmSync(env.HASNA_MARKDOWN_DIR, { recursive: true, force: true });
    storageStatus(env);
    expect(statSync(env.HASNA_MARKDOWN_DIR).mode & 0o777).toBe(0o700);
  });

  test("ignores empty primary remote env before fallback", () => {
    const remote = resolveRemoteDatabaseUrl({
      HASNA_MARKDOWN_DATABASE_URL: "   ",
      MARKDOWN_DATABASE_URL: "postgres://user:pass@example.com/markdown?sslmode=require",
    });

    expect(remote).toEqual({
      envName: "MARKDOWN_DATABASE_URL",
      url: "postgres://user:pass@example.com/markdown?sslmode=require",
    });
  });

  test("reports local runtime and optional remote role", () => {
    const env = tempEnv({
      HASNA_MARKDOWN_DATABASE_URL: "postgres://user:pass@example.com/markdown?sslmode=require",
    });

    expect(storageStatus(env)).toMatchObject({
      runtimeStorage: "local-sqlite",
      remoteRole: "optional-postgres-mirror",
      remoteConfigured: true,
      remoteEnv: "HASNA_MARKDOWN_DATABASE_URL",
      machineId: "machine-test-1",
      deletePropagation: false,
    });
  });

  test("uses safe Postgres TLS defaults for remote hosts", () => {
    const config = buildPostgresPoolConfig(
      "postgres://user:pass@example.com/markdown?sslmode=require&ssl=true",
      {}
    );

    expect(config.ssl).toBe(true);
    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.connectionString).not.toContain("ssl=");
  });

  test("rejects unsafe remote ssl modes", () => {
    expect(() =>
      buildPostgresPoolConfig("postgres://user:pass@example.com/markdown?sslmode=disable", {})
    ).toThrow("Unsafe sslmode");
  });

  test("returns a clear error when sync is requested without a remote", async () => {
    const result = await storagePull(tempEnv());

    expect(result.remoteConfigured).toBe(false);
    expect(result.errors[0]).toContain("No remote database configured");
  });

  test("returns structured errors for invalid remote setup", async () => {
    const result = await storagePull(tempEnv({
      HASNA_MARKDOWN_DATABASE_URL: "not a url",
    }));

    expect(result.remoteConfigured).toBe(true);
    expect(result.errors[0]).toContain("URL");
  });

  test("resolves configured machine id before hostname fallback", () => {
    expect(resolveMachineId({ OPEN_MACHINES_ID: "machine-open-1" })).toBe("machine-open-1");
    expect(resolveMachineId({ HASNA_MACHINE_ID: "machine-hasna-1", OPEN_MACHINES_ID: "machine-open-1" })).toBe("machine-hasna-1");
  });
});
