// Coverage lane (tests-coverage-sol workflow, Sol advisory Priority 2): the
// health/version payload builders and the ready gate (src/server/health.ts) and
// the migration-ledger edges (src/db/migration-plan.ts, src/db/database.ts) had
// no direct tests at origin/main. These tests pin the exact
// {status, version, backend} payloads (contract-mandated health_shape), backend
// resolution from the environment, readyResult false when schema_migrations is
// empty or missing and unavailable when the query throws, latestMigrationId,
// idempotent ledger application across close/reopen (INSERT OR IGNORE), and the
// negative arm of backup-on-migration: opening a DB whose plan has no
// shape-changing step must NOT create a backup snapshot. Per Sol: a
// shape-changing migration is NOT invented to make the production trigger appear
// covered — direct backup behavior is covered by test/backup-retention.test.ts.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { healthPayload, readyResult, versionPayload } from "../src/server/health.js";
import { latestMigrationId, MIGRATION_PLAN } from "../src/db/migration-plan.js";
import { migrationsApplied, openDatabase } from "../src/db/database.js";
import { APP_VERSION } from "../src/version.js";
import { getHoldingsBackupDir } from "../src/core/app-home.js";

const URL_KEY = "HASNA_HOLDINGS_DATABASE_URL";
let savedUrl: string | undefined;

beforeEach(() => {
  savedUrl = process.env[URL_KEY];
  delete process.env[URL_KEY];
});
afterEach(() => {
  if (savedUrl === undefined) delete process.env[URL_KEY];
  else process.env[URL_KEY] = savedUrl;
});

describe("healthPayload / versionPayload (§6.2 contract shape)", () => {
  it("healthPayload returns the exact contract shape with the sqlite backend by default", () => {
    expect(healthPayload()).toEqual({ status: "ok", version: APP_VERSION, backend: "sqlite" });
  });

  it("versionPayload returns the same contract shape", () => {
    expect(versionPayload()).toEqual({ status: "ok", version: APP_VERSION, backend: "sqlite" });
  });

  it("an explicit backend is carried through verbatim", () => {
    expect(healthPayload("postgresql")).toEqual({ status: "ok", version: APP_VERSION, backend: "postgresql" });
  });

  it("the backend resolves from the environment when a DATABASE_URL is present", () => {
    process.env[URL_KEY] = "postgres://u:p@h/db?sslmode=verify-full";
    expect(healthPayload().backend).toBe("postgresql");
    expect(versionPayload().backend).toBe("postgresql");
  });
});

describe("readyResult — ready only when the migration ledger is present", () => {
  it("a migrated database (ledger with id >= 1) is ready", () => {
    const db = openDatabase(":memory:");
    try {
      expect(readyResult(db)).toEqual({ ready: true, payload: { status: "ready" } });
    } finally {
      db.close();
    }
  });

  it("a database with NO schema_migrations table reports unavailable (query throws, never ready)", () => {
    const raw = new Database(":memory:");
    try {
      expect(readyResult(raw)).toEqual({ ready: false, payload: { status: "unavailable" } });
    } finally {
      raw.close();
    }
  });

  it("an EMPTY schema_migrations ledger reports unavailable (MAX(id) is null)", () => {
    const raw = new Database(":memory:");
    try {
      raw.run("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT)");
      expect(readyResult(raw)).toEqual({ ready: false, payload: { status: "unavailable" } });
    } finally {
      raw.close();
    }
  });
});

describe("migration plan + ledger (forward-only, idempotent)", () => {
  it("MIGRATION_PLAN ids are unique, strictly forward-only integers, with non-empty descriptions", () => {
    const ids = MIGRATION_PLAN.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    expect([...ids].sort((a, b) => a - b)).toEqual(ids); // ascending = forward-only
    expect(ids.every((id) => Number.isInteger(id) && id >= 1)).toBe(true);
    for (const step of MIGRATION_PLAN) expect(step.description.length).toBeGreaterThan(0);
  });

  it("latestMigrationId equals the last step id and the plan length (forward-only + unique)", () => {
    expect(latestMigrationId()).toBe(MIGRATION_PLAN[MIGRATION_PLAN.length - 1]!.id);
    expect(latestMigrationId()).toBe(MIGRATION_PLAN.length);
    expect(latestMigrationId()).toBeGreaterThanOrEqual(1);
  });

  it("openDatabase records the full plan in the ledger and re-applies idempotently across reopen (INSERT OR IGNORE)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "holdings-ledger-"));
    try {
      const dbPath = join(tmp, "holdings.db");
      const first = openDatabase(dbPath);
      expect(migrationsApplied()).toBe(latestMigrationId());
      const ledger = first.query<{ id: number }, []>("SELECT id FROM schema_migrations ORDER BY id").all();
      expect(ledger.map((row) => row.id)).toEqual(MIGRATION_PLAN.map((step) => step.id));
      first.close();

      // Reopening must not duplicate ledger rows.
      const second = openDatabase(dbPath);
      expect(migrationsApplied()).toBe(latestMigrationId());
      const count = second.query<{ id: number }, []>("SELECT COUNT(*) AS id FROM schema_migrations").get();
      expect(count!.id).toBe(MIGRATION_PLAN.length);
      second.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("openDatabase on a fresh :memory: database applies the plan too", () => {
    const db = openDatabase(":memory:");
    try {
      expect(migrationsApplied()).toBe(latestMigrationId());
    } finally {
      db.close();
    }
  });

  it("NEGATIVE arm: opening a DB whose plan has no shape-changing step creates NO backup snapshot", () => {
    // The only plan step is the initial non-shape-changing create; per §4.4 the
    // pre-migration backup must only run for shape-changing steps. If this test
    // starts producing snapshots, either a shape-changing step was added without
    // its backup semantics being intended for plain opens, or backup is firing
    // on every open.
    const tmp = mkdtempSync(join(tmpdir(), "holdings-nobak-"));
    try {
      const savedHome = process.env["HASNA_HOLDINGS_HOME"];
      process.env["HASNA_HOLDINGS_HOME"] = join(tmp, "home");
      try {
        const dbPath = join(tmp, "holdings.db");
        const db = openDatabase(dbPath);
        db.close();

        const backupsDir = getHoldingsBackupDir();
        if (existsSync(backupsDir)) {
          const snapshots = readdirSync(backupsDir).filter((f) => f.startsWith("holdings-") && f.endsWith("-pre-migration.db"));
          expect(snapshots).toEqual([]);
        }
      } finally {
        if (savedHome === undefined) delete process.env["HASNA_HOLDINGS_HOME"];
        else process.env["HASNA_HOLDINGS_HOME"] = savedHome;
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
