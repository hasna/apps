import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../src/canonical.js";
import {
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
} from "../src/effect-journal.js";
import { InMemorySandboxRepositoryV1 } from "../src/repository-memory.js";
import { SqliteSandboxRepositoryV1 } from "../src/repository-sqlite.js";
import type { SandboxRepositoryV1 } from "../src/repository.js";
import { createRequestDigest, quarantineRequestDigest } from "../src/service.js";
import { SCHEMA_VERSION, type ExternalOperationAnchorRecordV1 } from "../src/types.js";
import {
  activate,
  cleanupContext,
  cleanupGrant,
  checkpointReceipt,
  context,
  createInert,
  createInput,
  digest,
  harness,
  lifecycleContext,
  oid,
  recordDestroyed,
} from "./fixtures.js";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function sqlite(
  databaseTime: () => Date = () => new Date("2030-01-01T00:00:00.000Z"),
): SqliteSandboxRepositoryV1 {
  const root = mkdtempSync(join(tmpdir(), "sandboxes-v1-"));
  temporary.push(root);
  chmodSync(root, 0o700);
  return new SqliteSandboxRepositoryV1(join(root, "sandboxes.db"), {
    allow_unsafe_test_path: true,
    hermetic_test_database_time: databaseTime,
  });
}

async function corpus(repository: SandboxRepositoryV1) {
  const h = harness(repository);
  const inert = await createInert(h);
  const active = await activate(h, inert);
  const resolution = await h.service.resolveOperation(active.activation_operation_id!);
  const events = await h.service.events(active.id);
  const health = await repository.health();
  await repository.close();
  return {
    state: active.state,
    revision: active.revision,
    generation: active.resource_lifecycle_generation,
    operation: resolution.state,
    eventStates: events.map((event) => event.state),
    eventSequences: events.map((event) => event.sequence),
    sandboxCount: health.sandbox_count,
    operationCount: health.operation_count,
    schemaVersion: health.schema_version,
  };
}

async function immutableEvidenceCorpus(
  repository: SandboxRepositoryV1,
  advancePastExpiry: () => void,
) {
  const h = harness(repository);
  const active = await activate(h, await createInert(h, "2030-01-01T00:01:00.000Z"));
  advancePastExpiry();
  await h.service.observeExpired(active.id);
  const physicallyFenced = await h.service.get(active.id);
  const quarantine = lifecycleContext(
    "quarantine",
    oid("op", 952),
    quarantineRequestDigest(active.id, active.expires_at),
    physicallyFenced.resource_lifecycle_generation,
    physicallyFenced.revision,
    3n,
    952,
  );
  await h.service.reconcileExpired(active.id, quarantine);
  const quarantined = await h.service.get(active.id);
  const grant = cleanupGrant(quarantined, {
    kind: "discard_uncheckpointed",
    receipt_sha256: digest("storage-corpus-passkey"),
    recovery_checkpoint_attempted: true,
    promotion_grants_revoked: true,
    permanent_outcome: "discarded_uncheckpointed",
  });
  const destroying = await h.service.destroy(
    quarantined.id,
    grant,
    cleanupContext(quarantined, grant),
  );
  const destroyed = await recordDestroyed(h, destroying);
  const observations = await repository.transaction((tx) =>
    tx.listSafetyFenceObservations(active.id)
  );
  const tombstone = await repository.transaction((tx) => tx.getDestroyTombstone(active.id));
  await repository.close();
  return {
    state: destroyed.state,
    terminalDisposition: destroyed.terminal_disposition,
    observationCount: observations.length,
    observationReasons: observations.map((record) => record.observation.reason),
    tombstone: tombstone === undefined
      ? undefined
      : {
          schemaVersion: tombstone.schema_version,
          resourceId: tombstone.resource_id,
          basisKind: tombstone.cleanup_basis_kind,
          terminalDisposition: tombstone.terminal_disposition,
          generations: [
            tombstone.expected_resource_lifecycle_generation,
            tombstone.destroy_resource_lifecycle_generation,
            tombstone.terminal_resource_lifecycle_generation,
          ],
          digestValid: tombstone.tombstone_sha256.startsWith("sha256:"),
        },
  };
}

function journalRecords(operationId: string, operationStepId: string) {
  const base = {
    schema_version: SCHEMA_VERSION,
    operation_id: operationId,
    operation_step_id: operationStepId,
    operation_execution_epoch: 1n,
    outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
    outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
    journal_sequence: 9_001n,
    prior_frontier_digest: digest("journal-prior-frontier-1"),
    record_digest: digest("journal-record-1"),
    frontier_digest: digest("journal-frontier-1"),
    envelope_digest: digest("journal-envelope-1"),
    recorded_at: "2030-01-01T00:00:00.000Z",
  } as const;
  const dispatched: ExternalOperationAnchorRecordV1 = {
    ...base,
    record_kind: "DISPATCHED",
  };
  const outcome: ExternalOperationAnchorRecordV1 = {
    ...base,
    record_kind: "OUTCOME",
    outcome_kind: "failed_no_effect",
    journal_sequence: 9_002n,
    prior_frontier_digest: base.frontier_digest,
    record_digest: digest("journal-outcome-record-1"),
    frontier_digest: digest("journal-frontier-outcome-1"),
    envelope_digest: digest("journal-outcome-envelope-1"),
  };
  const next: ExternalOperationAnchorRecordV1 = {
    ...dispatched,
    operation_execution_epoch: 2n,
    journal_sequence: 9_003n,
    prior_frontier_digest: outcome.frontier_digest,
    record_digest: digest("journal-record-2"),
    frontier_digest: digest("journal-frontier-2"),
    envelope_digest: digest("journal-envelope-2"),
  };
  return { dispatched, outcome, next };
}

describe("storage conformance", () => {
  test("in-memory and SQLite produce the same lifecycle semantics", async () => {
    const memory = await corpus(
      new InMemorySandboxRepositoryV1(() => new Date("2030-01-01T00:00:00.000Z")),
    );
    const disk = await corpus(sqlite());
    expect(disk).toEqual(memory);
  });

  test("immutable safety observations and destroy tombstones match in memory and SQLite", async () => {
    let memoryNow = new Date("2030-01-01T00:00:00.000Z");
    const memory = await immutableEvidenceCorpus(
      new InMemorySandboxRepositoryV1(() => memoryNow),
      () => { memoryNow = new Date("2030-01-01T00:02:00.000Z"); },
    );
    let sqliteNow = new Date("2030-01-01T00:00:00.000Z");
    const disk = await immutableEvidenceCorpus(
      sqlite(() => sqliteNow),
      () => { sqliteNow = new Date("2030-01-01T00:02:00.000Z"); },
    );
    expect(disk).toEqual(memory);
    expect(disk).toMatchObject({
      state: "destroyed",
      observationCount: 1,
      observationReasons: ["deadline"],
      tombstone: {
        basisKind: "discard_uncheckpointed",
        terminalDisposition: "discarded_uncheckpointed",
        digestValid: true,
      },
    });
  });

  test("SQLite migrations are idempotent and integrity-checked", async () => {
    const repository = sqlite();
    repository.migrate();
    repository.migrate();
    expect(await repository.health()).toMatchObject({ backend: "sqlite", schema_version: 7, integrity: "ok" });
    await repository.close();
  });

  test("in-memory SQLite requires an explicit test-only opt in", async () => {
    expect(() => new SqliteSandboxRepositoryV1(":memory:")).toThrow("explicit test authorization");
    const repository = new SqliteSandboxRepositoryV1(":memory:", {
      allow_in_memory: true,
      allow_unsafe_test_path: true,
      hermetic_test_database_time: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    repository.migrate();
    expect((await repository.health()).integrity).toBe("ok");
    await repository.close();
  });

  test("SQLite persists protected effect phases and external frontier anchors across reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "sandboxes-v1-recovery-"));
    temporary.push(root);
    chmodSync(root, 0o700);
    const path = join(root, "sandboxes.db");
    const first = new SqliteSandboxRepositoryV1(path, {
      allow_unsafe_test_path: true,
      hermetic_test_database_time: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    const h = harness(first);
    await createInert(h);
    await first.close();

    const reopened = new SqliteSandboxRepositoryV1(path, {
      allow_unsafe_test_path: true,
      hermetic_test_database_time: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    reopened.migrate();
    const operationId = "op_00000000000000000000000000000014";
    const operation = await reopened.transaction((tx) => tx.getOperation(operationId));
    const anchors = await reopened.transaction((tx) => tx.listExternalAnchors(operationId));
    expect(operation?.effect_phase).toBe("succeeded");
    expect(anchors.map((anchor) => "record_kind" in anchor ? anchor.record_kind : anchor.anchor_kind))
      .toEqual(["DISPATCHED", "OUTCOME", "READ_PROBE"]);
    await expect(reopened.transaction((tx) => tx.compareAndSwapOperationPhase(
      operationId,
      ["prepared"],
      "dispatched",
      "2030-01-01T00:03:00.000Z",
    ))).rejects.toThrow("compare-and-swap failed");
    await reopened.close();
  });

  test("SQLite persists the exact exec stream root, resume token, and next sequence across reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "sandboxes-v1-stream-"));
    temporary.push(root);
    chmodSync(root, 0o700);
    const path = join(root, "sandboxes.db");
    const first = new SqliteSandboxRepositoryV1(path, {
      allow_unsafe_test_path: true,
      hermetic_test_database_time: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    const h = harness(first);
    const active = await activate(h, await createInert(h));
    const state = {
      schema_version: "sandboxes.exec-stream-state/v1" as const,
      resource_id: active.id,
      resource_lifecycle_generation: active.resource_lifecycle_generation,
      exec_id: oid("exec", 990),
      start_operation_id: oid("op", 991),
      start_request_sha256: digest("durable_start_request"),
      phase: "started" as const,
      cursor: "cursor_durable",
      cursor_sha256: digest("cursor_durable"),
      stream_root_sha256: digest("durable_stream_root"),
      resume_token: "resume_durable",
      resume_token_sha256: digest("resume_durable"),
      next_expected_sequence: 7n,
      in_flight_operation_id: null,
      terminal: false,
      updated_at: "2030-01-01T00:00:00.000Z",
    };
    await first.transaction((tx) => tx.compareAndSwapExecStreamState(null, state));
    await first.close();

    const reopened = new SqliteSandboxRepositoryV1(path, {
      allow_unsafe_test_path: true,
      hermetic_test_database_time: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    reopened.migrate();
    expect(await reopened.transaction((tx) => tx.getExecStreamState(active.id, state.exec_id)))
      .toEqual(state);
    await reopened.close();
  });

  test("SQLite rejects a symlink in any database path ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "sandboxes-v1-path-"));
    temporary.push(root);
    const real = join(root, "real");
    mkdirSync(real, { mode: 0o700 });
    const link = join(root, "link");
    symlinkSync(real, link, "dir");
    expect(() => new SqliteSandboxRepositoryV1(join(link, "nested", "sandboxes.db"), {
      allow_unsafe_test_path: true,
    })).toThrow("ancestry cannot contain symlinks");
  });

  test("immutable journal identity, exact replay, and failed_no_effect retry gate match in memory and SQLite", async () => {
    for (const repository of [
      new InMemorySandboxRepositoryV1(() => new Date("2030-01-01T00:00:00.000Z")),
      sqlite(),
    ]) {
      repository.migrate();
      const h = harness(repository);
      const input = createInput();
      const begin = context(
        "begin_create_inert",
        oid("op", 900),
        createRequestDigest(input),
        1n,
        0,
        1n,
        900,
      );
      h.dispatchJournal.failure = new Error("intent-only fixture");
      await expect(h.service.create(input, begin)).rejects.toThrow("intent-only fixture");
      const { dispatched, outcome, next } = journalRecords(
        begin.operation_id,
        begin.dispatch_journal.record.operation_step_id,
      );
      await repository.transaction((tx) => tx.appendExternalAnchor(dispatched));
      await repository.transaction((tx) => tx.appendExternalAnchor(structuredClone(dispatched)));
      expect(await repository.transaction((tx) => tx.listExternalAnchors(dispatched.operation_id))).toHaveLength(1);

      const changedBytes = {
        ...dispatched,
        recorded_at: "2030-01-01T00:00:00.001Z",
      };
      await expect(repository.transaction((tx) => tx.appendExternalAnchor(changedBytes)))
        .rejects.toThrow("changed bytes");
      await expect(repository.transaction((tx) => tx.appendExternalAnchor(next)))
        .rejects.toThrow("failed_no_effect");

      await repository.transaction((tx) => tx.appendExternalAnchor(outcome));
      await repository.transaction((tx) => tx.appendExternalAnchor(next));
      expect(await repository.transaction((tx) => tx.listExternalAnchors(dispatched.operation_id))).toHaveLength(3);

      const invalidAlias = {
        ...outcome,
        operation_execution_epoch: 2n,
        outcome_kind: "quarantined",
        journal_sequence: 9_004n,
        prior_frontier_digest: next.frontier_digest,
        record_digest: canonicalDigest({ invalid: "quarantined" }),
        frontier_digest: digest("invalid-alias-frontier"),
        envelope_digest: digest("invalid-alias-envelope"),
      } as unknown as ExternalOperationAnchorRecordV1;
      await expect(repository.transaction((tx) => tx.appendExternalAnchor(invalidAlias)))
        .rejects.toThrow("OUTCOME kind is not allowed");
      await repository.close();
    }
  });

  test("all repositories reject asynchronous transaction callbacks before atomicity can be lost", async () => {
    for (const repository of [
      new InMemorySandboxRepositoryV1(() => new Date("2030-01-01T00:00:00.000Z")),
      sqlite(),
    ]) {
      repository.migrate();
      await expect(repository.transaction(async () => "not-atomic"))
        .rejects.toThrow("callbacks must be synchronous");
      await repository.close();
    }
  });

  test("memory and SQLite preserve full immutable checkpoint receipts, not digest arrays alone", async () => {
    for (const repository of [
      new InMemorySandboxRepositoryV1(() => new Date("2030-01-01T00:00:00.000Z")),
      sqlite(),
    ]) {
      repository.migrate();
      const h = harness(repository);
      const active = await activate(h, await createInert(h));
      const receipt = checkpointReceipt(active);
      await h.service.recordCheckpointReceipt(active.id, receipt);
      expect(await repository.transaction((tx) => tx.getCheckpointReceipt(receipt.receipt_sha256)))
        .toEqual(receipt);
      await expect(repository.transaction((tx) => tx.putCheckpointReceipt({
        ...receipt,
        storage_version: "changed-version",
      }))).rejects.toThrow("Immutable checkpoint receipt changed bytes");
      await expect(repository.transaction((tx) => tx.putCheckpointReceipt({
        ...receipt,
        receipt_sha256: digest("different-digest-same-receipt-id"),
      }))).rejects.toThrow("identity conflicts");
      await repository.close();
    }
  });
});
