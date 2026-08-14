import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, resetDatabaseSingleton } from "../src/db/database.js";
import { resolveDatabaseUrl } from "../src/config.js";
import { assertStdioSafety } from "../src/mcp/index.js";
import { resolveBindHost } from "../src/mcp/http.js";
import { appendAudit, verifyAuditChain } from "../src/db/audit.js";
import { seedFixture, type Fixture } from "./helpers.js";

const STORAGE_ENV = [
  "HASNA_TREASURY_STORAGE_MODE",
  "HASNA_TREASURY_DATABASE_URL",
  "HASNA_TREASURY_DATABASE_URL_FILE",
  "TREASURY_DATABASE_URL",
  "TREASURY_DATABASE_URL_FILE",
  "HASNA_TREASURY_MCP_BIND_HOST",
  "TREASURY_MCP_BIND_HOST",
  "HASNA_TREASURY_API_CREDENTIALS",
  "HASNA_TREASURY_API_KEY",
  "PGSSLROOTCERT",
  "NODE_EXTRA_CA_CERTS",
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of STORAGE_ENV) snap[k] = process.env[k];
  return snap;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of STORAGE_ENV) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe("security fix: file-mounted DSN reaches the cloud pool (high)", () => {
  let env: Record<string, string | undefined>;
  let dir: string;
  beforeEach(() => {
    env = snapshotEnv();
    dir = mkdtempSync(join(tmpdir(), "treasury-dsnfile-"));
    resetDatabaseSingleton();
    // No CA sources — makes verify-full resolution throw a *TLS* error, which
    // only happens if the file DSN was actually resolved and passed to the pool.
    delete process.env["PGSSLROOTCERT"];
    delete process.env["NODE_EXTRA_CA_CERTS"];
    delete process.env["HASNA_TREASURY_DATABASE_URL"];
    delete process.env["TREASURY_DATABASE_URL"];
  });
  afterEach(() => {
    resetDatabaseSingleton();
    rmSync(dir, { recursive: true, force: true });
    restoreEnv(env);
  });

  it("config resolveDatabaseUrl reads the *_DATABASE_URL_FILE mount", () => {
    const file = join(dir, "database_url");
    const dsn = "postgres://u:p@db:5432/treasury?sslmode=verify-full";
    writeFileSync(file, `${dsn}\n`, { mode: 0o400 });
    process.env["HASNA_TREASURY_DATABASE_URL_FILE"] = file;
    expect(resolveDatabaseUrl()).toBe(dsn);
  });

  it("openCloud resolves the file-mounted DSN and reaches pool/TLS setup (not the env-only 'needs a database URL' failure)", async () => {
    const file = join(dir, "database_url");
    // Only the *_FILE mount is set — exactly how docker-compose injects it.
    writeFileSync(file, "postgres://u:p@127.0.0.1:1/treasury?sslmode=verify-full", { mode: 0o400 });
    process.env["HASNA_TREASURY_STORAGE_MODE"] = "cloud";
    process.env["HASNA_TREASURY_DATABASE_URL_FILE"] = file;

    let caught: unknown;
    try {
      await openDatabase({ mode: "cloud", fresh: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    // Regression guard: the old code called createCloudPoolFromEnv, which
    // re-resolved env-only and threw "needs a database URL" because the DSN was
    // file-mounted. The fix passes the file DSN straight through, so we get PAST
    // resolution to TLS setup (verify-full with no CA bundle available here).
    expect(msg).not.toMatch(/needs a database url/i);
    expect(msg).toMatch(/CA bundle/i);
  });
});

describe("security fix: stdio transport is gated to local mode (low)", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => {
    env = snapshotEnv();
    delete process.env["HASNA_TREASURY_API_CREDENTIALS"];
    delete process.env["HASNA_TREASURY_API_KEY"];
    delete process.env["HASNA_TREASURY_DATABASE_URL"];
    delete process.env["TREASURY_DATABASE_URL"];
  });
  afterEach(() => restoreEnv(env));

  it("allows stdio (SYSTEM bypass) in local mode with auth off", () => {
    process.env["HASNA_TREASURY_STORAGE_MODE"] = "local";
    expect(() => assertStdioSafety()).not.toThrow();
  });

  it("refuses stdio in cloud mode (would grant unauthenticated bypass to production Postgres)", () => {
    process.env["HASNA_TREASURY_STORAGE_MODE"] = "cloud";
    process.env["HASNA_TREASURY_DATABASE_URL"] = "postgres://u:p@db/treasury?sslmode=verify-full";
    expect(() => assertStdioSafety()).toThrow(/cloud mode/i);
  });

  it("refuses stdio when API credentials are configured (stdio cannot authenticate a bearer)", () => {
    process.env["HASNA_TREASURY_STORAGE_MODE"] = "local";
    process.env["HASNA_TREASURY_API_CREDENTIALS"] = JSON.stringify([{ id: "c", token: "t", roles: ["treasurer"] }]);
    expect(() => assertStdioSafety()).toThrow(/credentials/i);
  });
});

describe("security fix: MCP bind host honors the container override (medium)", () => {
  let env: Record<string, string | undefined>;
  beforeEach(() => (env = snapshotEnv()));
  afterEach(() => restoreEnv(env));

  it("defaults to loopback but binds 0.0.0.0 when the compose-set env is present", () => {
    delete process.env["HASNA_TREASURY_MCP_BIND_HOST"];
    delete process.env["TREASURY_MCP_BIND_HOST"];
    expect(resolveBindHost()).toBe("127.0.0.1");
    process.env["HASNA_TREASURY_MCP_BIND_HOST"] = "0.0.0.0";
    expect(resolveBindHost()).toBe("0.0.0.0");
  });
});

describe("security fix: audit hash-chain stays linear under concurrency (low)", () => {
  let fx: Fixture;
  beforeEach(async () => (fx = await seedFixture()));
  afterEach(() => fx.cleanup());

  it("rejects a second row that forks the chain from the same prev_hash (UNIQUE prev_hash)", async () => {
    const last = await fx.db.get<{ row_hash: string }>("SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1");
    const prev = last!.row_hash;
    // First fork branch inserts fine.
    await fx.db.run(
      "INSERT INTO audit_log (entity_id, actor_id, action, detail, prev_hash, row_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [null, "a", "x", "branch-1", prev, "hash-branch-1", new Date().toISOString()],
    );
    // Second branch off the SAME prev_hash must fail loudly, not silently fork.
    await expect(
      fx.db.run(
        "INSERT INTO audit_log (entity_id, actor_id, action, detail, prev_hash, row_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [null, "b", "x", "branch-2", prev, "hash-branch-2", new Date().toISOString()],
      ),
    ).rejects.toThrow();
  });

  it("appendAudit stays serialized and the chain verifies", async () => {
    await appendAudit(fx.db, { entity_id: fx.usId, actor_id: "tester", action: "test.a", detail: "1" });
    await appendAudit(fx.db, { entity_id: fx.usId, actor_id: "tester", action: "test.b", detail: "2" });
    expect((await verifyAuditChain(fx.db)).ok).toBe(true);
  });
});
