import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySandboxRepositoryV1 } from "../src/repository-memory.js";
import { SqliteSandboxRepositoryV1 } from "../src/repository-sqlite.js";
import type { SandboxRepositoryV1 } from "../src/repository.js";
import { activate, createInert, harness } from "./fixtures.js";

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
    expect(repository.health()).toMatchObject({ backend: "sqlite", schema_version: 2, integrity: "ok" });
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
    expect(anchors.map((anchor) => anchor.kind)).toEqual(["dispatched", "outcome"]);
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
});
