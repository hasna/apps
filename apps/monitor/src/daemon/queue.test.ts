/**
 * MON-V2-03 — Queue, attempts, leases, fencing, receipts.
 *
 * Gate: concurrent claim fixture yields one lease; duplicate admission returns
 * one run; stale generation writes fail; every terminal transition creates
 * exactly one receipt.
 *
 * The v2 authority tables are seeded directly from the design (mirror of
 * migration 008_monitor_v2.sql, which MON-V2-02 owns). The daemon modules under
 * test reference the same table shapes.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SqliteAdapter } from "../db/sqlite-adapter.js";
import type { DbAdapter } from "../db/adapter.js";
import {
  admitRun,
  claimRun,
  transitionToRetryWait,
  cancelQueuedRun,
} from "./queue.js";
import {
  checkLeaseFence,
  renewLease,
  revokeLease,
  fencingDigest,
} from "./lease-registry.js";
import { transitionToTerminal, getReceiptForRun } from "./receipts.js";

// ── v2 authority schema (mirror of design §5 / migration 008) ─────────────────

const V2_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS slugs (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL UNIQUE,
  description       TEXT,
  desired_state     TEXT    NOT NULL DEFAULT 'stopped'
                    CHECK(desired_state IN ('stopped','draining','running')),
  active_revision_id TEXT,
  execution_epoch   INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS slug_revisions (
  id                TEXT    PRIMARY KEY,
  slug_id           TEXT    NOT NULL REFERENCES slugs(id),
  revision          INTEGER NOT NULL,
  definition_json   TEXT    NOT NULL,
  definition_digest TEXT    NOT NULL,
  created_at        INTEGER NOT NULL,
  created_by        TEXT,
  UNIQUE(slug_id, revision)
);
CREATE TABLE IF NOT EXISTS slug_runs (
  id                TEXT    PRIMARY KEY,
  slug_id           TEXT    NOT NULL REFERENCES slugs(id),
  revision_id       TEXT    NOT NULL REFERENCES slug_revisions(id),
  admission_key     TEXT    NOT NULL UNIQUE,
  state             TEXT    NOT NULL
                    CHECK(state IN ('admitted','leased','running','retry_wait',
                                    'reconciling','cancel_requested','terminal')),
  scheduled_at      INTEGER NOT NULL,
  admitted_at       INTEGER NOT NULL,
  started_at        INTEGER,
  finished_at       INTEGER,
  outcome           TEXT,
  execution_epoch   INTEGER NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempt_id   TEXT,
  terminal_receipt_id TEXT,
  created_at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS slug_attempts (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL REFERENCES slug_runs(id),
  attempt_number    INTEGER NOT NULL,
  state             TEXT    NOT NULL
                    CHECK(state IN ('leased','running','reconciling','succeeded',
                                    'failed','unknown','cancelled','expired')),
  worker_id         TEXT,
  lease_id          TEXT,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER,
  exit_code         INTEGER,
  outcome           TEXT,
  result_digest     TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE(run_id, attempt_number)
);
CREATE TABLE IF NOT EXISTS leases (
  id                  TEXT    PRIMARY KEY,
  attempt_id          TEXT    NOT NULL REFERENCES slug_attempts(id),
  run_id              TEXT    NOT NULL REFERENCES slug_runs(id),
  worker_id           TEXT    NOT NULL,
  generation          INTEGER NOT NULL,
  fencing_token_digest TEXT   NOT NULL,
  heartbeat_at        INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  revoked_at          INTEGER,
  created_at          INTEGER NOT NULL,
  UNIQUE(run_id, generation)
);
CREATE TABLE IF NOT EXISTS receipts (
  id                  TEXT    PRIMARY KEY,
  run_id              TEXT    NOT NULL REFERENCES slug_runs(id),
  attempt_id          TEXT    REFERENCES slug_attempts(id),
  lease_id            TEXT    REFERENCES leases(id),
  lease_generation    INTEGER NOT NULL,
  state               TEXT    NOT NULL,
  reason              TEXT,
  durable_effect_pointer TEXT,
  evidence_pointer    TEXT,
  result_digest       TEXT,
  created_at          INTEGER NOT NULL,
  UNIQUE(run_id)
);
`;

const NOW = 1_700_000_000; // fixed fake clock (seconds)
const TTL = 300;
const SLUG_ID = "slug-1";
const REV_ID = "rev-1";
const EPOCH = 1;
const TOKEN_A = "fence-token-a";
const TOKEN_B = "fence-token-b";

interface Fixture {
  dir: string;
  adapter: DbAdapter;
  second: DbAdapter; // independent connection over the same file
  runId: string;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "monitor-v2-03-"));
  const makeDb = () => {
    const db = new Database(join(dir, "v2.db"), { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA synchronous = NORMAL");
    for (const stmt of V2_SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
      db.run(stmt);
    }
    return new SqliteAdapter(db);
  };
  const adapter = makeDb();
  const second = makeDb();
  return { dir, adapter, second, runId: "" };
}

function seedSlug(adapter: DbAdapter, overrides: { desiredState?: string; epoch?: number } = {}) {
  adapter.run(
    `INSERT INTO slugs (id, name, desired_state, active_revision_id, execution_epoch, created_at, updated_at)
     VALUES (?, 'example', ?, ?, ?, ?, ?)`,
    [SLUG_ID, overrides.desiredState ?? "running", REV_ID, overrides.epoch ?? EPOCH, NOW, NOW],
  );
  adapter.run(
    `INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_at, created_by)
     VALUES (?, ?, 1, '{}', 'digest-1', ?, 'test')`,
    [REV_ID, SLUG_ID, NOW],
  );
}

function seedRun(adapter: DbAdapter, overrides: { state?: string; key?: string } = {}) {
  return admitRun(adapter, {
    slugId: SLUG_ID,
    revisionId: REV_ID,
    admissionKey: overrides.key ?? "admission-1",
    executionEpoch: EPOCH,
    scheduledAt: NOW,
    now: NOW,
  });
}

function seedAdmittedRun(fx: Fixture): string {
  const r = seedRun(fx.adapter);
  fx.runId = r.runId;
  return r.runId;
}

function claimFixture(fx: Fixture, token: string = TOKEN_A) {
  return claimRun(fx.adapter, {
    runId: fx.runId,
    slugId: SLUG_ID,
    workerId: "worker-1",
    executionEpoch: EPOCH,
    maxAttempts: 3,
    fencingToken: token,
    leaseTtlSeconds: TTL,
    capacityAvailable: true,
    now: NOW,
  });
}

function seedAttempt(adapter: DbAdapter, runId: string, number: number, state = "leased") {
  adapter.run(
    `INSERT INTO slug_attempts (id, run_id, attempt_number, state, worker_id, lease_id, started_at, created_at)
     VALUES (?, ?, ?, ?, 'worker-0', NULL, ?, ?)`,
    [`attempt-${number}`, runId, number, state, NOW, NOW],
  );
}

function countRows(adapter: DbAdapter, table: string, where = "1=1", params: unknown[] = []): number {
  const row = adapter.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params);
  return row?.n ?? 0;
}

describe("admission (queue)", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
    seedSlug(fx.adapter);
  });
  afterEach(() => {
    fx.adapter.close();
    fx.second.close();
    rmSync(fx.dir, { recursive: true, force: true });
  });

  it("admitRun creates an admitted run", () => {
    const res = seedRun(fx.adapter);
    expect(res.created).toBe(true);
    const run = fx.adapter.get<{ state: string; admission_key: string }>(
      "SELECT state, admission_key FROM slug_runs WHERE id = ?",
      [res.runId],
    );
    expect(run?.state).toBe("admitted");
    expect(run?.admission_key).toBe("admission-1");
  });

  it("duplicate admission returns the same run and does not duplicate the row", () => {
    const first = seedRun(fx.adapter);
    const second = seedRun(fx.adapter);
    expect(first.runId).toBe(second.runId);
    expect(second.created).toBe(false);
    expect(countRows(fx.adapter, "slug_runs", "admission_key = ?", ["admission-1"])).toBe(1);
  });

  it("duplicate admission from a second connection returns the same run", () => {
    const first = seedRun(fx.adapter);
    const second = seedRun(fx.second);
    expect(first.runId).toBe(second.runId);
    expect(second.created).toBe(false);
    expect(countRows(fx.adapter, "slug_runs")).toBe(1);
  });
});

describe("claim (queue + leases)", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
    seedSlug(fx.adapter);
    seedAdmittedRun(fx);
  });
  afterEach(() => {
    fx.adapter.close();
    fx.second.close();
    rmSync(fx.dir, { recursive: true, force: true });
  });

  it("concurrent claims yield exactly one lease", async () => {
    const claimOn = (adapter: DbAdapter, workerId: string, token: string) =>
      claimRun(adapter, {
        runId: fx.runId,
        slugId: SLUG_ID,
        workerId,
        executionEpoch: EPOCH,
        maxAttempts: 3,
        fencingToken: token,
        leaseTtlSeconds: TTL,
        capacityAvailable: true,
        now: NOW,
      });

    const [a, b] = await Promise.all([
      claimOn(fx.adapter, "worker-a", TOKEN_A),
      claimOn(fx.second, "worker-b", TOKEN_B),
    ]);

    const winners = [a, b].filter((r) => r.ok === true);
    const losers = [a, b].filter((r) => r.ok === false);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as { code: string }).code).toBe("already_claimed");
    expect(countRows(fx.adapter, "leases", "revoked_at IS NULL")).toBe(1);
    expect(countRows(fx.adapter, "slug_attempts")).toBe(1);
    const run = fx.adapter.get<{ state: string }>("SELECT state FROM slug_runs WHERE id = ?", [fx.runId]);
    expect(run?.state).toBe("leased");
  });

  it("a second sequential claim is refused", () => {
    const first = claimFixture(fx);
    expect(first.ok).toBe(true);
    const second = claimFixture(fx);
    expect(second.ok).toBe(false);
    expect((second as { code: string }).code).toBe("already_claimed");
  });

  it("claim without capacity returns no_capacity and creates nothing", () => {
    const res = claimRun(fx.adapter, {
      runId: fx.runId,
      slugId: SLUG_ID,
      workerId: "worker-1",
      executionEpoch: EPOCH,
      maxAttempts: 3,
      fencingToken: TOKEN_A,
      leaseTtlSeconds: TTL,
      capacityAvailable: false,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, code: "no_capacity" });
    expect(countRows(fx.adapter, "slug_attempts")).toBe(0);
    expect(countRows(fx.adapter, "leases")).toBe(0);
    const run = fx.adapter.get<{ state: string }>("SELECT state FROM slug_runs WHERE id = ?", [fx.runId]);
    expect(run?.state).toBe("admitted");
  });

  it("claim with a stale execution epoch is refused", () => {
    const res = claimRun(fx.adapter, {
      runId: fx.runId,
      slugId: SLUG_ID,
      workerId: "worker-1",
      executionEpoch: EPOCH + 1,
      maxAttempts: 3,
      fencingToken: TOKEN_A,
      leaseTtlSeconds: TTL,
      capacityAvailable: true,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, code: "epoch_mismatch" });
  });

  it("claim is refused when the slug desired state is not running", () => {
    fx.adapter.run("UPDATE slugs SET desired_state = 'draining' WHERE id = ?", [SLUG_ID]);
    const res = claimFixture(fx);
    expect(res).toEqual({ ok: false, code: "not_running" });
  });

  it("claim is refused when attempts would exceed maxAttempts", () => {
    seedAttempt(fx.adapter, fx.runId, 1);
    seedAttempt(fx.adapter, fx.runId, 2);
    const res = claimRun(fx.adapter, {
      runId: fx.runId,
      slugId: SLUG_ID,
      workerId: "worker-1",
      executionEpoch: EPOCH,
      maxAttempts: 2,
      fencingToken: TOKEN_A,
      leaseTtlSeconds: TTL,
      capacityAvailable: true,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, code: "retry_exhausted" });
    expect(countRows(fx.adapter, "leases")).toBe(0);
  });

  it("claim is refused when the run is cancel_requested", () => {
    fx.adapter.run("UPDATE slug_runs SET state = 'cancel_requested' WHERE id = ?", [fx.runId]);
    const res = claimFixture(fx);
    expect(res).toEqual({ ok: false, code: "cancel_requested" });
  });
});

describe("leases and fencing (lease-registry)", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
    seedSlug(fx.adapter);
    seedAdmittedRun(fx);
  });
  afterEach(() => {
    fx.adapter.close();
    fx.second.close();
    rmSync(fx.dir, { recursive: true, force: true });
  });

  it("leases carry an increasing generation per attempt and store only a token digest", () => {
    const first = claimFixture(fx);
    expect(first.ok).toBe(true);
    const a = first as { generation: number; leaseId: string };
    expect(a.generation).toBe(1);
    expect(countRows(fx.adapter, "leases", "run_id = ? AND revoked_at IS NULL", [fx.runId])).toBe(1);

    // A replacement worker revokes and re-claims (the reconciler returns the
    // run to admitted before the next claim): generation increments, and the
    // durable row stores the digest, never the raw token.
    revokeLease(fx.adapter, { leaseId: a.leaseId, now: NOW });
    fx.adapter.run("UPDATE slug_runs SET state = 'admitted' WHERE id = ?", [fx.runId]);
    const second = claimFixture(fx, TOKEN_B);
    expect(second.ok).toBe(true);
    const b = second as { generation: number; attemptNumber: number; leaseId: string };
    expect(b.generation).toBe(2);
    expect(b.attemptNumber).toBe(2);
    expect(a.leaseId).not.toBe(b.leaseId);

    const stored = fx.adapter.get<{ fencing_token_digest: string; revoked_at: number | null }>(
      "SELECT fencing_token_digest, revoked_at FROM leases WHERE id = ?",
      [b.leaseId],
    );
    expect(stored?.fencing_token_digest).toBe(fencingDigest(TOKEN_B));
    expect(stored?.fencing_token_digest).not.toBe(TOKEN_B);
    const revoked = fx.adapter.get<{ revoked_at: number | null }>(
      "SELECT revoked_at FROM leases WHERE id = ?",
      [a.leaseId],
    );
    expect(revoked?.revoked_at).toBe(NOW);
    // Generation history is preserved: both rows still exist.
    expect(countRows(fx.adapter, "leases", "run_id = ?", [fx.runId])).toBe(2);
  });

  it("renewal keeps the same generation and advances the expiry", () => {
    const res = claimFixture(fx) as { ok: true; leaseId: string; generation: number };
    const renewed = renewLease(fx.adapter, {
      leaseId: res.leaseId,
      fencingToken: TOKEN_A,
      now: NOW + 100,
      ttlSeconds: TTL,
    });
    expect(renewed.ok).toBe(true);
    const row = fx.adapter.get<{ generation: number; expires_at: number; heartbeat_at: number }>(
      "SELECT generation, expires_at, heartbeat_at FROM leases WHERE id = ?",
      [res.leaseId],
    );
    expect(row?.generation).toBe(res.generation);
    expect(row?.expires_at).toBe(NOW + 100 + TTL);
    expect(row?.heartbeat_at).toBe(NOW + 100);
  });

  it("renewal with the wrong fencing token fails with stale_fence", () => {
    const res = claimFixture(fx) as { ok: true; leaseId: string };
    const renewed = renewLease(fx.adapter, {
      leaseId: res.leaseId,
      fencingToken: "wrong-token",
      now: NOW + 1,
      ttlSeconds: TTL,
    });
    expect(renewed.ok).toBe(false);
    expect((renewed as { code: string }).code).toBe("stale_fence");
  });

  it("a revoked lease fails the fence", () => {
    const res = claimFixture(fx) as { ok: true; leaseId: string };
    revokeLease(fx.adapter, { leaseId: res.leaseId, now: NOW + 10 });
    const check = checkLeaseFence(fx.adapter, {
      runId: fx.runId,
      attemptId: "attempt-1",
      leaseId: res.leaseId,
      generation: 1,
      fencingToken: TOKEN_A,
      now: NOW + 11,
    });
    expect(check.ok).toBe(false);
    expect((check as { reason: string }).reason).toBe("revoked");
  });

  it("an expired lease fails the fence", () => {
    const res = claimFixture(fx) as { ok: true; leaseId: string };
    const check = checkLeaseFence(fx.adapter, {
      runId: fx.runId,
      attemptId: "attempt-1",
      leaseId: res.leaseId,
      generation: 1,
      fencingToken: TOKEN_A,
      now: NOW + TTL + 1,
    });
    expect(check.ok).toBe(false);
    expect((check as { reason: string }).reason).toBe("expired");
  });

  it("stale generation writes fail", () => {
    const first = claimFixture(fx) as { ok: true; leaseId: string; generation: number };
    revokeLease(fx.adapter, { leaseId: first.leaseId, now: NOW });
    // The reconciler returns the run to admitted before the replacement claim.
    fx.adapter.run("UPDATE slug_runs SET state = 'admitted' WHERE id = ?", [fx.runId]);
    const second = claimFixture(fx, TOKEN_B) as { ok: true; generation: number; attemptNumber: number };

    // The old worker still holds generation 1's token and tries to write a
    // terminal receipt for the run. The write is conditional on the CURRENT
    // lease generation, so it must be rejected with stale_fence.
    const staleWrite = transitionToTerminal(fx.adapter, {
      runId: fx.runId,
      attemptId: "attempt-1",
      leaseId: first.leaseId,
      generation: first.generation,
      fencingToken: TOKEN_A,
      state: "succeeded",
      now: NOW + 1,
    });
    expect(staleWrite.ok).toBe(false);
    expect((staleWrite as { code: string }).code).toBe("stale_fence");
    expect(countRows(fx.adapter, "receipts")).toBe(0);
    const run = fx.adapter.get<{ state: string }>("SELECT state FROM slug_runs WHERE id = ?", [fx.runId]);
    expect(run?.state).toBe("leased");
    // The replacement worker's generation is intact.
    expect(second.generation).toBe(2);
    expect(second.attemptNumber).toBe(2);
  });
});

describe("terminal receipts (receipts)", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
    seedSlug(fx.adapter);
    seedAdmittedRun(fx);
  });
  afterEach(() => {
    fx.adapter.close();
    fx.second.close();
    rmSync(fx.dir, { recursive: true, force: true });
  });

  it("every terminal transition creates exactly one receipt", () => {
    const claim = claimFixture(fx) as { ok: true; attemptId: string; leaseId: string; generation: number };
    const first = transitionToTerminal(fx.adapter, {
      runId: fx.runId,
      attemptId: claim.attemptId,
      leaseId: claim.leaseId,
      generation: claim.generation,
      fencingToken: TOKEN_A,
      state: "succeeded",
      reason: "checks passed",
      now: NOW + 5,
    });
    expect(first.ok).toBe(true);
    expect((first as { created: boolean }).created).toBe(true);
    expect(countRows(fx.adapter, "receipts")).toBe(1);

    const run = fx.adapter.get<{ state: string; outcome: string; finished_at: number; terminal_receipt_id: string }>(
      "SELECT state, outcome, finished_at, terminal_receipt_id FROM slug_runs WHERE id = ?",
      [fx.runId],
    );
    expect(run?.state).toBe("terminal");
    expect(run?.outcome).toBe("succeeded");
    expect(run?.finished_at).toBe(NOW + 5);
    expect(run?.terminal_receipt_id).toBe((first as { receiptId: string }).receiptId);

    // A second terminal transition attempt — even a different state — must not
    // create a second receipt.
    const second = transitionToTerminal(fx.adapter, {
      runId: fx.runId,
      attemptId: claim.attemptId,
      leaseId: claim.leaseId,
      generation: claim.generation,
      fencingToken: TOKEN_A,
      state: "failed",
      now: NOW + 6,
    });
    expect(second.ok).toBe(false);
    expect((second as { code: string }).code).toBe("already_terminal");
    expect(countRows(fx.adapter, "receipts")).toBe(1);
  });

  it("receipts link run, attempt, lease, generation and carry the terminal state", () => {
    const claim = claimFixture(fx) as { ok: true; attemptId: string; leaseId: string; generation: number };
    const res = transitionToTerminal(fx.adapter, {
      runId: fx.runId,
      attemptId: claim.attemptId,
      leaseId: claim.leaseId,
      generation: claim.generation,
      fencingToken: TOKEN_A,
      state: "timed_out",
      reason: "execution budget exhausted",
      durableEffectPointer: "effects/run-1/e1",
      evidencePointer: "evidence/run-1/out.txt",
      resultDigest: "sha256:abc",
      exitCode: 124,
      now: NOW + 5,
    }) as { ok: true; receiptId: string };

    const receipt = getReceiptForRun(fx.adapter, fx.runId);
    expect(receipt).toBeDefined();
    expect(receipt?.id).toBe(res.receiptId);
    expect(receipt?.run_id).toBe(fx.runId);
    expect(receipt?.attempt_id).toBe(claim.attemptId);
    expect(receipt?.lease_id).toBe(claim.leaseId);
    expect(receipt?.lease_generation).toBe(claim.generation);
    expect(receipt?.state).toBe("timed_out");
    expect(receipt?.reason).toBe("execution budget exhausted");
    expect(receipt?.durable_effect_pointer).toBe("effects/run-1/e1");
    expect(receipt?.evidence_pointer).toBe("evidence/run-1/out.txt");
    expect(receipt?.result_digest).toBe("sha256:abc");

    const attempt = fx.adapter.get<{ state: string; exit_code: number; finished_at: number }>(
      "SELECT state, exit_code, finished_at FROM slug_attempts WHERE id = ?",
      [claim.attemptId],
    );
    expect(attempt?.state).toBe("expired");
    expect(attempt?.exit_code).toBe(124);
    expect(attempt?.finished_at).toBe(NOW + 5);
  });

  it("a stale-fence terminal write creates no receipt", () => {
    const claim = claimFixture(fx) as { ok: true; attemptId: string; leaseId: string };
    const res = transitionToTerminal(fx.adapter, {
      runId: fx.runId,
      attemptId: claim.attemptId,
      leaseId: claim.leaseId,
      generation: 1,
      fencingToken: "stolen-token",
      state: "succeeded",
      now: NOW + 1,
    });
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe("stale_fence");
    expect(countRows(fx.adapter, "receipts")).toBe(0);
  });

  it("cancelled-before-claim gets exactly one receipt without a lease", () => {
    const res = cancelQueuedRun(fx.adapter, { runId: fx.runId, reason: "stop --cancel", now: NOW + 2 });
    expect(res.ok).toBe(true);
    expect(countRows(fx.adapter, "receipts")).toBe(1);
    const run = fx.adapter.get<{ state: string; outcome: string; terminal_receipt_id: string }>(
      "SELECT state, outcome, terminal_receipt_id FROM slug_runs WHERE id = ?",
      [fx.runId],
    );
    expect(run?.state).toBe("terminal");
    expect(run?.outcome).toBe("cancelled");
    expect(run?.terminal_receipt_id).toBe((res as { receiptId: string }).receiptId);
    const receipt = getReceiptForRun(fx.adapter, fx.runId);
    expect(receipt?.state).toBe("cancelled_before_claim");
    expect(receipt?.attempt_id).toBeNull();
    expect(receipt?.lease_id).toBeNull();
    expect(receipt?.lease_generation).toBe(0);
    expect(countRows(fx.adapter, "slug_attempts")).toBe(0);

    const second = cancelQueuedRun(fx.adapter, { runId: fx.runId, reason: "again", now: NOW + 3 });
    expect(second.ok).toBe(false);
    expect(countRows(fx.adapter, "receipts")).toBe(1);
  });

  it("retry_wait transitions are fence-guarded and bounded", () => {
    const claim = claimFixture(fx) as { ok: true; attemptId: string; leaseId: string; generation: number };

    // Valid lease: transition to retry_wait with the next backoff.
    const ok = transitionToRetryWait(fx.adapter, {
      runId: fx.runId,
      attemptId: claim.attemptId,
      leaseId: claim.leaseId,
      generation: claim.generation,
      fencingToken: TOKEN_A,
      outcome: "failed",
      backoffSeconds: 60,
      now: NOW + 5,
    });
    expect(ok).toEqual({ ok: true, scheduledAt: NOW + 5 + 60 });
    const run = fx.adapter.get<{ state: string; scheduled_at: number; attempt_count: number }>(
      "SELECT state, scheduled_at, attempt_count FROM slug_runs WHERE id = ?",
      [fx.runId],
    );
    expect(run?.state).toBe("retry_wait");
    expect(run?.scheduled_at).toBe(NOW + 5 + 60);
    expect(run?.attempt_count).toBe(1);

    // Yielding for a retry revoked the worker's own lease: the old worker can
    // no longer write with its old lease.
    const stale = transitionToRetryWait(fx.adapter, {
      runId: fx.runId,
      attemptId: claim.attemptId,
      leaseId: claim.leaseId,
      generation: claim.generation,
      fencingToken: TOKEN_A,
      outcome: "failed",
      backoffSeconds: 60,
      now: NOW + 7,
    });
    expect(stale.ok).toBe(false);
    expect((stale as { code: string }).code).toBe("stale_fence");
    const runAfter = fx.adapter.get<{ state: string; scheduled_at: number }>(
      "SELECT state, scheduled_at FROM slug_runs WHERE id = ?",
      [fx.runId],
    );
    expect(runAfter?.state).toBe("retry_wait");
    expect(runAfter?.scheduled_at).toBe(NOW + 5 + 60);

    // The next claim creates a distinguishable attempt with a new lease
    // generation — bounded retries preserve run identity and provenance.
    const retry = claimFixture(fx, TOKEN_B);
    expect(retry.ok).toBe(true);
    const r = retry as { attemptNumber: number; generation: number };
    expect(r.attemptNumber).toBe(2);
    expect(r.generation).toBe(2);
    const oldWrite = transitionToTerminal(fx.adapter, {
      runId: fx.runId,
      attemptId: claim.attemptId,
      leaseId: claim.leaseId,
      generation: claim.generation,
      fencingToken: TOKEN_A,
      state: "succeeded",
      now: NOW + 8,
    });
    expect(oldWrite.ok).toBe(false);
    expect(countRows(fx.adapter, "receipts")).toBe(0);
  });
});
