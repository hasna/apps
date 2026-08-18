/**
 * MON-V2-02 tests for src/slugs/repository.ts.
 *
 * Runs the real migration runner (runMigrations) against a temp database —
 * migrations 001-008 — then exercises the SlugRepository: slug lifecycle,
 * revision uniqueness, idempotent control requests and admissions, run
 * transitions, attempts, leases, effects, receipts, and daemon state.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runMigrations } from "../db/client.js";
import { SqliteAdapter } from "../db/sqlite-adapter.js";
import { SlugRepository } from "./repository.js";

const scratch = mkdtempSync(join(tmpdir(), "monitor-v2-repo-"));

let db: Database;
let repo: SlugRepository;

beforeAll(() => {
  db = new Database(join(scratch, "repo.db"), { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  runMigrations(db);
  repo = new SlugRepository(new SqliteAdapter(db));
});

afterAll(() => {
  db.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("SlugRepository", () => {
  it("creates and reads slugs; duplicate names are rejected", () => {
    const slug = repo.createSlug({ name: "check-http", description: "HTTP health check" });
    expect(slug.name).toBe("check-http");
    expect(slug.desired_state).toBe("stopped");
    expect(slug.execution_epoch).toBe(0);

    const byName = repo.getSlugByName("check-http");
    expect(byName?.id).toBe(slug.id);
    expect(repo.getSlug(slug.id)?.description).toBe("HTTP health check");
    expect(repo.listSlugs().map((s) => s.name)).toContain("check-http");

    expect(() => repo.createSlug({ name: "check-http" })).toThrow(/UNIQUE constraint failed/);
  });

  it("creates revisions with per-slug unique revision numbers", () => {
    const slug = repo.createSlug({ name: "revision-target" });
    const r1 = repo.createRevision({
      slugId: slug.id,
      revision: 1,
      definitionJson: '{"cadence":"5m"}',
      definitionDigest: "sha256-a",
      createdBy: "monitor-v2-execute",
    });
    expect(r1.revision).toBe(1);
    expect(r1.definition_digest).toBe("sha256-a");

    const r2 = repo.createRevision({
      slugId: slug.id,
      revision: 2,
      definitionJson: '{"cadence":"10m"}',
      definitionDigest: "sha256-b",
      createdBy: "monitor-v2-execute",
    });
    expect(r2.revision).toBe(2);

    expect(() =>
      repo.createRevision({
        slugId: slug.id,
        revision: 1,
        definitionJson: "{}",
        definitionDigest: "dup",
        createdBy: "monitor-v2-execute",
      })
    ).toThrow(/UNIQUE constraint failed/);

    // A different slug may reuse revision number 1.
    const other = repo.createSlug({ name: "revision-target-2" });
    const rOther = repo.createRevision({
      slugId: other.id,
      revision: 1,
      definitionJson: "{}",
      definitionDigest: "sha256-c",
      createdBy: "monitor-v2-execute",
    });
    expect(rOther.revision).toBe(1);

    expect(repo.getRevision(slug.id, 2)?.definition_digest).toBe("sha256-b");
    expect(repo.listRevisions(slug.id)).toHaveLength(2);
  });

  it("tracks the active revision and desired state", () => {
    const slug = repo.createSlug({ name: "active-revision-target" });
    const rev = repo.createRevision({
      slugId: slug.id,
      revision: 1,
      definitionJson: "{}",
      definitionDigest: "d",
      createdBy: "test",
    });
    expect(repo.getActiveRevision(slug.id)).toBeNull();

    repo.setActiveRevision(slug.id, rev.id);
    expect(repo.getActiveRevision(slug.id)?.id).toBe(rev.id);

    repo.setDesiredState(slug.id, "running");
    expect(repo.getSlug(slug.id)?.desired_state).toBe("running");

    repo.bumpExecutionEpoch(slug.id);
    expect(repo.getSlug(slug.id)?.execution_epoch).toBe(1);
  });

  it("deduplicates control requests by slug and idempotency key", () => {
    const slug = repo.createSlug({ name: "control-dedupe" });
    const first = repo.recordControlRequest({
      slugId: slug.id,
      idempotencyKey: "start-1",
      operation: "start",
      requestDigest: "digest-1",
      resultJson: "{}",
    });
    expect(first.created).toBe(true);

    const second = repo.recordControlRequest({
      slugId: slug.id,
      idempotencyKey: "start-1",
      operation: "start",
      requestDigest: "digest-1",
      resultJson: "{}",
    });
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);

    // Same key on a different slug is a distinct request.
    const other = repo.createSlug({ name: "control-dedupe-2" });
    const third = repo.recordControlRequest({
      slugId: other.id,
      idempotencyKey: "start-1",
      operation: "start",
      requestDigest: "digest-1",
      resultJson: "{}",
    });
    expect(third.created).toBe(true);
    expect(third.request.id).not.toBe(first.request.id);
  });

  it("deduplicates run admission by admission key", () => {
    const slug = repo.createSlug({ name: "admission-dedupe" });
    const rev = repo.createRevision({
      slugId: slug.id,
      revision: 1,
      definitionJson: "{}",
      definitionDigest: "d",
      createdBy: "test",
    });
    const first = repo.createRun({
      slugId: slug.id,
      revisionId: rev.id,
      admissionKey: "admission-abc",
      scheduledAt: 1720000000,
      executionEpoch: 1,
    });
    expect(first.created).toBe(true);
    expect(first.run.admission_key).toBe("admission-abc");

    const second = repo.createRun({
      slugId: slug.id,
      revisionId: rev.id,
      admissionKey: "admission-abc",
      scheduledAt: 1720000000,
      executionEpoch: 1,
    });
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);

    expect(repo.getRunByAdmissionKey("admission-abc")?.id).toBe(first.run.id);
    expect(repo.listRuns(slug.id, { state: "admitted" }).map((r) => r.id)).toContain(first.run.id);
  });

  it("transitions run state and records outcome", () => {
    const slug = repo.createSlug({ name: "run-transition" });
    const { run } = repo.createRun({
      slugId: slug.id,
      admissionKey: "admission-transition",
      scheduledAt: 1720000000,
      executionEpoch: 1,
    });
    const updated = repo.transitionRun(run.id, {
      state: "terminal",
      outcome: "succeeded",
      startedAt: 1720000001,
      finishedAt: 1720000005,
    });
    expect(updated?.state).toBe("terminal");
    expect(updated?.outcome).toBe("succeeded");
    expect(repo.getRun(run.id)?.finished_at).toBe(1720000005);
  });

  it("keeps attempt numbers unique per run and records the latest", () => {
    const slug = repo.createSlug({ name: "attempt-target" });
    const { run } = repo.createRun({
      slugId: slug.id,
      admissionKey: "admission-attempts",
      scheduledAt: 1720000000,
      executionEpoch: 1,
    });
    const a1 = repo.createAttempt({ runId: run.id, attemptNumber: 1, workerId: "w1" });
    expect(a1.attempt_number).toBe(1);
    const a2 = repo.createAttempt({ runId: run.id, attemptNumber: 2, workerId: "w1" });
    expect(a2.attempt_number).toBe(2);

    expect(() => repo.createAttempt({ runId: run.id, attemptNumber: 1, workerId: "w1" })).toThrow(
      /UNIQUE constraint failed/
    );

    repo.updateAttemptState(a1.id, { state: "succeeded", exitCode: 0, outcome: "ok", finishedAt: 1720000002 });
    expect(repo.getAttempt(a1.id)?.state).toBe("succeeded");
    expect(repo.getLatestAttempt(run.id)?.id).toBe(a2.id);
    expect(repo.getAttemptsByRun(run.id)).toHaveLength(2);
  });

  it("creates leases with generation uniqueness and active-lease exclusivity", () => {
    const slug = repo.createSlug({ name: "lease-target" });
    const { run } = repo.createRun({
      slugId: slug.id,
      admissionKey: "admission-lease",
      scheduledAt: 1720000000,
      executionEpoch: 1,
    });
    const attempt = repo.createAttempt({ runId: run.id, attemptNumber: 1, workerId: "w1" });

    const lease = repo.createLease({
      attemptId: attempt.id,
      runId: run.id,
      workerId: "w1",
      generation: 1,
      fencingTokenDigest: "fence-1",
      expiresAt: 1720000100,
    });
    expect(lease.generation).toBe(1);
    expect(repo.getActiveLease(run.id)?.id).toBe(lease.id);

    // A second non-revoked lease on the same attempt is rejected (design §5:
    // only one non-revoked active lease per attempt).
    expect(() =>
      repo.createLease({
        attemptId: attempt.id,
        runId: run.id,
        workerId: "w2",
        generation: 2,
        fencingTokenDigest: "fence-2",
        expiresAt: 1720000200,
      })
    ).toThrow(/UNIQUE constraint failed/);

    // A second attempt on the same run may take generation 2.
    const attempt2 = repo.createAttempt({ runId: run.id, attemptNumber: 2, workerId: "w2" });
    const lease2 = repo.createLease({
      attemptId: attempt2.id,
      runId: run.id,
      workerId: "w2",
      generation: 2,
      fencingTokenDigest: "fence-2",
      expiresAt: 1720000200,
    });
    expect(lease2.generation).toBe(2);

    // Generation 1 replay on the same run is rejected even for a new attempt.
    expect(() =>
      repo.createLease({
        attemptId: attempt2.id,
        runId: run.id,
        workerId: "w3",
        generation: 1,
        fencingTokenDigest: "fence-1",
        expiresAt: 1720000300,
      })
    ).toThrow(/UNIQUE constraint failed/);

    repo.revokeLease(lease.id);
    expect(repo.getActiveLease(run.id)?.id).toBe(lease2.id);

    repo.renewLease(lease2.id, 1720000400, 1720000350);
    const renewed = repo.getActiveLease(run.id);
    expect(renewed?.expires_at).toBe(1720000400);
    expect(renewed?.heartbeat_at).toBe(1720000350);
  });

  it("deduplicates effects by effect key and records state transitions", () => {
    const slug = repo.createSlug({ name: "effect-target" });
    const { run } = repo.createRun({
      slugId: slug.id,
      admissionKey: "admission-effect",
      scheduledAt: 1720000000,
      executionEpoch: 1,
    });
    const attempt = repo.createAttempt({ runId: run.id, attemptNumber: 1, workerId: "w1" });

    const first = repo.createEffect({
      runId: run.id,
      attemptId: attempt.id,
      effectKey: "todos:createTask:task-42",
      integration: "todos",
      operation: "createTask",
      target: "task-42",
      requestDigest: "digest",
    });
    expect(first.created).toBe(true);

    const second = repo.createEffect({
      runId: run.id,
      attemptId: attempt.id,
      effectKey: "todos:createTask:task-42",
      integration: "todos",
      operation: "createTask",
      target: "task-42",
      requestDigest: "digest",
    });
    expect(second.created).toBe(false);
    expect(second.effect.id).toBe(first.effect.id);

    repo.updateEffect(first.effect.id, {
      state: "confirmed",
      externalId: "ext-1",
      resultPointer: "ev:123",
    });
    const effect = repo.getEffectByKey("todos:createTask:task-42");
    expect(effect?.state).toBe("confirmed");
    expect(effect?.external_id).toBe("ext-1");
    expect(effect?.result_pointer).toBe("ev:123");
  });

  it("creates exactly one receipt per run", () => {
    const slug = repo.createSlug({ name: "receipt-target" });
    const { run } = repo.createRun({
      slugId: slug.id,
      admissionKey: "admission-receipt",
      scheduledAt: 1720000000,
      executionEpoch: 1,
    });
    const attempt = repo.createAttempt({ runId: run.id, attemptNumber: 1, workerId: "w1" });
    const lease = repo.createLease({
      attemptId: attempt.id,
      runId: run.id,
      workerId: "w1",
      generation: 1,
      fencingTokenDigest: "fence",
      expiresAt: 1720000100,
    });

    const first = repo.createReceipt({
      runId: run.id,
      attemptId: attempt.id,
      leaseId: lease.id,
      leaseGeneration: 1,
      reason: "completed",
      durableEffectPointer: "ev:1",
      evidencePointer: "rec:1",
      resultDigest: "digest",
    });
    expect(first.created).toBe(true);
    expect(first.receipt.state).toBe("terminal");

    const second = repo.createReceipt({
      runId: run.id,
      attemptId: attempt.id,
      leaseId: lease.id,
      leaseGeneration: 1,
      reason: "completed",
      resultDigest: "digest",
    });
    expect(second.created).toBe(false);
    expect(second.receipt.id).toBe(first.receipt.id);

    expect(repo.getReceiptByRun(run.id)?.reason).toBe("completed");
  });

  it("upserts daemon state by id", () => {
    const first = repo.upsertDaemonState({
      daemonId: "daemon-1",
      state: "running",
      workerCapacity: 2,
      heartbeatAt: 1720000000,
    });
    expect(first.state).toBe("running");

    const second = repo.upsertDaemonState({
      daemonId: "daemon-1",
      state: "draining",
      leaderEpoch: 1,
      workerCapacity: 0,
      heartbeatAt: 1720000010,
      drainStartedAt: 1720000010,
    });
    expect(second.state).toBe("draining");
    expect(second.leader_epoch).toBe(1);
    expect(repo.getDaemonState(first.id)?.drain_started_at).toBe(1720000010);
  });
});
