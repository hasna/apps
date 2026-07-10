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
import { createRequestDigest } from "../src/service.js";
import { SCHEMA_VERSION, type ExternalOperationAnchorRecordV1 } from "../src/types.js";
import { activate, context, createInert, createInput, digest, harness, oid } from "./fixtures.js";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function sqlite(): SqliteSandboxRepositoryV1 {
  const root = mkdtempSync(join(tmpdir(), "sandboxes-v1-"));
  temporary.push(root);
  chmodSync(root, 0o700);
  return new SqliteSandboxRepositoryV1(join(root, "sandboxes.db"), {
    allow_unsafe_test_path: true,
    hermetic_test_database_time: () => new Date("2030-01-01T00:00:00.000Z"),
  });
}

async function corpus(repository: SandboxRepositoryV1) {
  const h = harness(repository);
  const inert = await createInert(h);
  const active = await activate(h, inert);
  const resolution = h.service.resolveOperation(active.activation_operation_id!);
  const events = h.service.events(active.id);
  const health = repository.health();
  repository.close();
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

function journalRecords(operationId: string, operationStepId: string) {
  const base = {
    schema_version: SCHEMA_VERSION,
    operation_id: operationId,
    operation_step_id: operationStepId,
    operation_execution_epoch: 1n,
    outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
    outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
    anchor_sha256: digest("journal-dispatch-1"),
    frontier_sha256: digest("journal-frontier-1"),
    payload_sha256: digest("journal-payload-1"),
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
    anchor_sha256: digest("journal-outcome-1"),
    frontier_sha256: digest("journal-frontier-outcome-1"),
    payload_sha256: digest("journal-outcome-payload-1"),
  };
  const next: ExternalOperationAnchorRecordV1 = {
    ...dispatched,
    operation_execution_epoch: 2n,
    anchor_sha256: digest("journal-dispatch-2"),
    frontier_sha256: digest("journal-frontier-2"),
    payload_sha256: digest("journal-payload-2"),
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

  test("SQLite migrations are idempotent and integrity-checked", () => {
    const repository = sqlite();
    repository.migrate();
    repository.migrate();
    expect(repository.health()).toMatchObject({ backend: "sqlite", schema_version: 3, integrity: "ok" });
    repository.close();
  });

  test("in-memory SQLite requires an explicit test-only opt in", () => {
    expect(() => new SqliteSandboxRepositoryV1(":memory:")).toThrow("explicit test authorization");
    const repository = new SqliteSandboxRepositoryV1(":memory:", {
      allow_in_memory: true,
      allow_unsafe_test_path: true,
      hermetic_test_database_time: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    repository.migrate();
    expect(repository.health().integrity).toBe("ok");
    repository.close();
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
    first.close();

    const reopened = new SqliteSandboxRepositoryV1(path, {
      allow_unsafe_test_path: true,
      hermetic_test_database_time: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    reopened.migrate();
    const operationId = "op_00000000000000000000000000000014";
    const operation = reopened.transaction((tx) => tx.getOperation(operationId));
    const anchors = reopened.transaction((tx) => tx.listExternalAnchors(operationId));
    expect(operation?.effect_phase).toBe("succeeded");
    expect(anchors.map((anchor) => anchor.record_kind)).toEqual(["DISPATCHED", "OUTCOME"]);
    expect(() => reopened.transaction((tx) => tx.compareAndSwapOperationPhase(
      operationId,
      ["prepared"],
      "dispatched",
      "2030-01-01T00:03:00.000Z",
    ))).toThrow("compare-and-swap failed");
    reopened.close();
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
        begin.dispatch_journal.operation_step_id,
      );
      repository.transaction((tx) => tx.appendExternalAnchor(dispatched));
      repository.transaction((tx) => tx.appendExternalAnchor(structuredClone(dispatched)));
      expect(repository.transaction((tx) => tx.listExternalAnchors(dispatched.operation_id))).toHaveLength(1);

      const changedBytes = {
        ...dispatched,
        recorded_at: "2030-01-01T00:00:00.001Z",
      };
      expect(() => repository.transaction((tx) => tx.appendExternalAnchor(changedBytes)))
        .toThrow("changed bytes");
      expect(() => repository.transaction((tx) => tx.appendExternalAnchor(next)))
        .toThrow("failed_no_effect");

      repository.transaction((tx) => tx.appendExternalAnchor(outcome));
      repository.transaction((tx) => tx.appendExternalAnchor(next));
      expect(repository.transaction((tx) => tx.listExternalAnchors(dispatched.operation_id))).toHaveLength(3);

      const invalidAlias = {
        ...outcome,
        operation_execution_epoch: 2n,
        outcome_kind: "quarantined",
        anchor_sha256: digest("invalid-alias"),
        payload_sha256: canonicalDigest({ invalid: "quarantined" }),
      } as unknown as ExternalOperationAnchorRecordV1;
      expect(() => repository.transaction((tx) => tx.appendExternalAnchor(invalidAlias)))
        .toThrow("OUTCOME kind is not allowed");
      repository.close();
    }
  });
});
