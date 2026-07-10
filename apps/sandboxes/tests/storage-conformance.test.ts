import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
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
  return new SqliteSandboxRepositoryV1(join(root, "sandboxes.db"));
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
    const memory = await corpus(new InMemorySandboxRepositoryV1());
    const disk = await corpus(sqlite());
    expect(disk).toEqual(memory);
  });

  test("SQLite migrations are idempotent and integrity-checked", () => {
    const repository = sqlite();
    repository.migrate();
    repository.migrate();
    expect(repository.health()).toMatchObject({ backend: "sqlite", schema_version: 1, integrity: "ok" });
    repository.close();
  });

  test("in-memory SQLite requires an explicit test-only opt in", () => {
    expect(() => new SqliteSandboxRepositoryV1(":memory:")).toThrow("explicit test authorization");
    const repository = new SqliteSandboxRepositoryV1(":memory:", { allow_in_memory: true });
    repository.migrate();
    expect(repository.health().integrity).toBe("ok");
    repository.close();
  });
});
