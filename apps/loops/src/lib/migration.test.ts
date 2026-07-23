import { describe, expect, test } from "bun:test";
import type { AgentTarget } from "../types.js";
import { ValidationError } from "./errors.js";
import {
  LEGACY_OPEN_LOOPS_MIGRATION_SCHEMA,
  LOOPS_MIGRATION_SCHEMA,
  buildImportMigrationPlan,
  exportLoopsMigrationBundle,
  migrationHash,
  validateLoopsMigrationBundle,
} from "./migration.js";
import { Store } from "./store.js";

describe("migration agent target validation", () => {
  test("writes the canonical schema and accepts a correctly hashed legacy bundle during the compatibility window", () => {
    const store = new Store(":memory:");
    try {
      const bundle = exportLoopsMigrationBundle(store, { includeRuns: false });
      expect(bundle.schema).toBe(LOOPS_MIGRATION_SCHEMA);

      bundle.schema = LEGACY_OPEN_LOOPS_MIGRATION_SCHEMA;
      const { hash: _hash, ...body } = bundle;
      bundle.hash = migrationHash(body);
      expect(validateLoopsMigrationBundle(bundle).schema).toBe(LEGACY_OPEN_LOOPS_MIGRATION_SCHEMA);
    } finally {
      store.close();
    }
  });

  test("rejects a rehashed legacy bundle with unmanaged agent extraArgs", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "migration-agent",
        schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
        target: { type: "agent", provider: "codewith", prompt: "do not execute" },
      });
      const bundle = exportLoopsMigrationBundle(store, { includeRuns: false });
      const target = bundle.data.loops[0]!.target as AgentTarget;
      target.extraArgs = ["--durable", "true"];
      const { hash: _hash, ...body } = bundle;
      bundle.hash = migrationHash(body);

      expect(() => validateLoopsMigrationBundle(bundle)).toThrow(ValidationError);
      const destination = new Store(":memory:");
      try {
        expect(() => buildImportMigrationPlan(destination, bundle)).toThrow(ValidationError);
      } finally {
        destination.close();
      }
    } finally {
      store.close();
    }
  });
});
