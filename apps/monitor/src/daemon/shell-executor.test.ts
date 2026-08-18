/**
 * MON-V2-04 cycle-1 regression — the executor must implement the MON-V2-01
 * CommandSpec contract: argv-only execution with no shell. Shell strings,
 * `sh -c` mode, and shell interpolation are not part of the v2 definition
 * schema and must never reach a shell at runtime.
 *
 * Two layers are exercised:
 * 1. registration (the primary gate) — registerSlug rejects definitions
 *    whose commands are not valid CommandSpecs;
 * 2. the executor (the defensive gate) — a revision stored before the schema
 *    applied (raw rows written directly, bypassing registerSlug) is refused
 *    with a check failure, never executed through a shell.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { FakeClock } from "./clock.js";
import { ensureV2Schema } from "./schema.js";
import {
  registerSlug,
  setSlugDesiredState,
  admitRun,
  type RevisionRow,
  type SlugRow,
} from "./core.js";
import { CommandCheckExecutor } from "./shell-executor.js";
import type { ExecContext } from "./worker.js";

const MINUTE = 60_000;

function baseDefinition(command: unknown): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name: "pulse",
    cadence: { type: "interval", seconds: 300 },
    execution: { maxAttempts: 1 },
    checks: [{ id: "c1", command, expect: { exit: 0 } }],
    checksAggregate: { mode: "all" },
  };
}

let db: Database;
let clock: FakeClock;

beforeEach(() => {
  db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  ensureV2Schema(db);
  clock = new FakeClock(1_000_000);
});

afterEach(() => {
  db.close();
});

/** Register, start, and admit one due run for a definition, returning its ExecContext. */
function admitExecContext(definition: Record<string, unknown>): ExecContext {
  const { slug, activeRevision } = registerSlug(db, clock, { name: "pulse", definition });
  setSlugDesiredState(db, clock, slug.id, "running");
  // Re-read the slug after the state change — admitRun verifies the CURRENT
  // desired_state on the row it is given.
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
  if (!admitted.ok || !admitted.run) throw new Error("admission failed");
  return { runId: admitted.run.id, slugId: slug.id, attemptNumber: 1 };
}

/**
 * Simulate a revision stored BEFORE the definition schema applied: the rows
 * are written directly so a shell-string command reaches the executor. The
 * executor must refuse it, never shell it.
 */
function admitLegacyRawDefinition(definition: Record<string, unknown>): ExecContext {
  const slugId = "slug-legacy";
  const revisionId = "rev-legacy";
  const runId = "run-legacy";
  db.run(
    "INSERT INTO slugs (id, name, description, desired_state, active_revision_id, execution_epoch, created_at, updated_at) VALUES (?, ?, '', 'running', NULL, 0, 1, 1)",
    [slugId, "pulse"]
  );
  db.run(
    "INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_at, created_by) VALUES (?, ?, 1, ?, 'digest', 1, '')",
    [revisionId, slugId, JSON.stringify(definition)]
  );
  db.run("UPDATE slugs SET active_revision_id = ? WHERE id = ?", [revisionId, slugId]);
  db.run(
    "INSERT INTO slug_runs (id, slug_id, revision_id, admission_key, state, scheduled_at, admitted_at, execution_epoch, attempt_count, created_at) VALUES (?, ?, ?, 'ak-legacy', 'admitted', 1, 1, 0, 0, 1)",
    [runId, slugId, revisionId]
  );
  return { runId, slugId, attemptNumber: 1 };
}

describe("CommandCheckExecutor", () => {
  it("executes a CommandSpec check via argv and reports its stdout", async () => {
    const ctx = admitExecContext(baseDefinition({ executable: "echo", args: ["ok"], timeoutSeconds: 30 }));
    const executor = new CommandCheckExecutor(db);
    const result = await executor.execute(ctx);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok");
  });

  it("propagates a non-zero exit from the executed program", async () => {
    const ctx = admitExecContext(baseDefinition({ executable: "bun", args: ["-e", "process.exit(3)"], timeoutSeconds: 30 }));
    const executor = new CommandCheckExecutor(db);
    const result = await executor.execute(ctx);
    expect(result.exitCode).toBe(3);
  });

  it("refuses a stored shell-string command instead of executing it through a shell", async () => {
    const ctx = admitLegacyRawDefinition(baseDefinition("echo ok"));
    const executor = new CommandCheckExecutor(db);
    const result = await executor.execute(ctx);
    expect(result.exitCode).not.toBe(0);
    expect((result.stderr ?? "").toLowerCase()).toContain("shell");
  });

  it("refuses stored sh -c mode even when spelled as an argv CommandSpec", async () => {
    const ctx = admitLegacyRawDefinition(
      baseDefinition({ executable: "sh", args: ["-c", "echo ok"], timeoutSeconds: 30 })
    );
    const executor = new CommandCheckExecutor(db);
    const result = await executor.execute(ctx);
    expect(result.exitCode).not.toBe(0);
    expect((result.stderr ?? "").toLowerCase()).toContain("shell");
  });

  it("refuses stored args that carry shell interpolation", async () => {
    const ctx = admitLegacyRawDefinition(baseDefinition({ executable: "echo", args: ["$(id)"], timeoutSeconds: 30 }));
    const executor = new CommandCheckExecutor(db);
    const result = await executor.execute(ctx);
    expect(result.exitCode).not.toBe(0);
    expect((result.stderr ?? "").toLowerCase()).toContain("shell");
  });
});

describe("registerSlug definition validation (primary gate)", () => {
  it("rejects a shell-string command at registration", () => {
    expect(() => registerSlug(db, clock, { name: "pulse", definition: baseDefinition("echo ok") })).toThrow(
      /invalid definition/
    );
  });

  it("rejects sh -c mode at registration", () => {
    expect(() =>
      registerSlug(db, clock, {
        name: "pulse",
        definition: baseDefinition({ executable: "sh", args: ["-c", "echo ok"], timeoutSeconds: 30 }),
      })
    ).toThrow(/invalid definition/);
  });

  it("rejects shell interpolation in args at registration", () => {
    expect(() =>
      registerSlug(db, clock, {
        name: "pulse",
        definition: baseDefinition({ executable: "echo", args: ["$(id)"], timeoutSeconds: 30 }),
      })
    ).toThrow(/invalid definition/);
  });
});
