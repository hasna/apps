/**
 * MON-V2-04 cycle-1 regression — the daemon must run against a real
 * migration-008-built store (MON-V2-02), not only against a fresh
 * ensureV2Schema database.
 *
 * The monitor CLI migrates the default store with the transactional migration
 * runner (src/db/migrations/008_monitor_v2.sql); the daemon bin opens that
 * same store and applies ensureV2Schema as an idempotent no-op. The store's
 * constraints are therefore 008's, so every daemon write must satisfy 008's
 * NOT NULL columns. This file reproduces the review's probe: build a database
 * from the byte-faithful migration-008 fixture (migration-008.fixture.sql,
 * copied from PR 482 head 1ff835be), then exercise the daemon's control-plane
 * and cancel/skip paths against it.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeClock } from "./clock.js";
import { ensureV2Schema } from "./schema.js";
import {
  registerSlug,
  setSlugDesiredState,
  admitRun,
  insertTerminalSkipped,
  cancelSlugRuns,
  cancelStaleEpochRuns,
  countReceiptsForRun,
  getRun,
  type SlugRow,
} from "./core.js";

const FIXTURE_PATH = join(import.meta.dir, "migration-008.fixture.sql");
const MIGRATION_008_SQL = readFileSync(FIXTURE_PATH, "utf8");

const MINUTE = 60_000;

/** A definition valid under the wave's own definition schema (MON-V2-01). */
function validDefinition(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name: "pulse",
    cadence: { type: "interval", seconds: 300 },
    execution: { maxAttempts: 1 },
    checks: [
      {
        id: "c1",
        command: { executable: "echo", args: ["ok"], timeoutSeconds: 30 },
        expect: { exit: 0 },
      },
    ],
    checksAggregate: { mode: "all" },
  };
}

/** Build a store exactly as migration 008 leaves it. */
function migration008Db(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run(MIGRATION_008_SQL);
  return db;
}

/** Column metadata from PRAGMA table_info — keyed by name. */
function columns(db: Database, table: string): Record<string, { name: string; notnull: number; dflt_value: string | null }> {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  return Object.fromEntries(rows.map((r) => [r.name, r]));
}

function slugRow(db: Database, name: string) {
  const row = db
    .query<{ id: string; active_revision_id: string | null }, [string]>(
      "SELECT id, active_revision_id FROM slugs WHERE name = ?"
    )
    .get(name)!;
  return row;
}

let db: Database;
let clock: FakeClock;

beforeEach(() => {
  db = migration008Db();
  clock = new FakeClock(1_000_000);
});

afterEach(() => {
  db.close();
});

describe("daemon against a migration-008-built store", () => {
  it("registerSlug stores description and created_by without violating 008 NOT NULL columns", () => {
    const { slug, activeRevision } = registerSlug(db, clock, {
      name: "pulse",
      definition: validDefinition(),
    });
    const stored = db
      .query<{ description: string }, [string]>("SELECT description FROM slugs WHERE id = ?")
      .get(slug.id)!;
    expect(stored.description).toBe("");
    const revision = db
      .query<{ created_by: string }, [string]>(
        "SELECT created_by FROM slug_revisions WHERE id = ?"
      )
      .get(activeRevision.id)!;
    expect(revision.created_by).toBe("");
    expect(getRun(db, slug.id)).toBeNull();
  });

  it("insertTerminalSkipped writes a receipt with a non-null lease_generation", () => {
    const { slug, activeRevision } = registerSlug(db, clock, {
      name: "pulse",
      definition: validDefinition(),
    });
    setSlugDesiredState(db, clock, slug.id, "running");
    const running = db
      .query<SlugRow, [string]>("SELECT * FROM slugs WHERE id = ?")
      .get(slug.id)!;
    const run = insertTerminalSkipped(db, clock, {
      slug: running,
      revision: activeRevision,
      scheduledAt: clock.now(),
      epoch: slug.execution_epoch,
    });
    expect(run).not.toBeNull();
    expect(run!.outcome).toBe("skipped_overlap");
    expect(countReceiptsForRun(db, run!.id)).toBe(1);
    const receipt = db
      .query<{ lease_generation: number }, [string]>(
        "SELECT lease_generation FROM receipts WHERE run_id = ?"
      )
      .get(run!.id)!;
    expect(receipt.lease_generation).toBe(0);
  });

  it("cancelSlugRuns writes receipts with non-null lease_generation", () => {
    const { slug, activeRevision } = registerSlug(db, clock, {
      name: "pulse",
      definition: validDefinition(),
    });
    setSlugDesiredState(db, clock, slug.id, "running");
    const running = db
      .query<SlugRow, [string]>("SELECT * FROM slugs WHERE id = ?")
      .get(slug.id)!;
    const admitted = admitRun(db, clock, {
      slug: running,
      revision: activeRevision,
      scheduledAt: clock.now(),
      epoch: running.execution_epoch,
      source: "interval",
    });
    expect(admitted.ok).toBe(true);
    const result = cancelSlugRuns(db, clock, slug.id);
    expect(result.cancelledQueued).toBe(1);
    const receipt = db
      .query<{ lease_generation: number; reason: string }, [string]>(
        "SELECT lease_generation, reason FROM receipts WHERE run_id = ?"
      )
      .get(admitted.run!.id)!;
    expect(receipt.lease_generation).toBe(0);
    expect(receipt.reason).toBe("cancelled_before_claim");
  });

  it("cancelStaleEpochRuns writes receipts with non-null lease_generation", () => {
    const { slug, activeRevision } = registerSlug(db, clock, {
      name: "pulse",
      definition: validDefinition(),
    });
    setSlugDesiredState(db, clock, slug.id, "running");
    // Admit under epoch 0, then bump the slug's epoch so the run is stale.
    const running = db
      .query<SlugRow, [string]>("SELECT * FROM slugs WHERE id = ?")
      .get(slug.id)!;
    const admitted = admitRun(db, clock, {
      slug: running,
      revision: activeRevision,
      scheduledAt: clock.now(),
      epoch: running.execution_epoch,
      source: "interval",
    });
    expect(admitted.ok).toBe(true);
    db.run("UPDATE slugs SET execution_epoch = execution_epoch + 1 WHERE id = ?", [slug.id]);
    const cancelled = cancelStaleEpochRuns(db, clock, slug.id);
    expect(cancelled).toBe(1);
    const receipt = db
      .query<{ lease_generation: number }, [string]>(
        "SELECT lease_generation FROM receipts WHERE run_id = ?"
      )
      .get(admitted.run!.id)!;
    expect(receipt.lease_generation).toBe(0);
  });

  it("ensureV2Schema on top of a migration-008 store is a no-op that keeps 008 constraints", () => {
    // The daemon bin opens the migrated store and applies ensureV2Schema.
    ensureV2Schema(db);
    const slugs = columns(db, "slugs");
    const receipts = columns(db, "receipts");
    const runs = columns(db, "slug_runs");
    const effects = columns(db, "slug_effects");
    expect(slugs["description"]!.notnull).toBe(1);
    expect(slugs["description"]!.dflt_value).toBe("''");
    expect(receipts["lease_generation"]!.notnull).toBe(1);
    expect(runs["revision_id"]!.notnull).toBe(0);
    expect(effects["target"]!.notnull).toBe(1);
    expect(effects["target"]!.dflt_value).toBe("''");
  });

  it("either application order produces the same constraints (008 first vs ensureV2Schema first)", () => {
    const orderA = migration008Db();
    try {
      ensureV2Schema(orderA);
    } finally {
      orderA.close();
    }

    const orderB = new Database(":memory:");
    try {
      orderB.run("PRAGMA foreign_keys = ON");
      ensureV2Schema(orderB);
      orderB.run(MIGRATION_008_SQL);
      const slugsB = columns(orderB, "slugs");
      const receiptsB = columns(orderB, "receipts");
      expect(slugsB["description"]!.notnull).toBe(1);
      expect(receiptsB["lease_generation"]!.notnull).toBe(1);
      // A write through registerSlug must succeed on the ensureV2Schema-first store too.
      registerSlug(orderB, new FakeClock(2_000_000), {
        name: "pulse",
        definition: validDefinition(),
      });
    } finally {
      orderB.close();
    }
  });
});
