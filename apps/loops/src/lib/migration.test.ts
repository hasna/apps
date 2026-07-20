import { describe, expect, test } from "bun:test";
import type { AgentTarget } from "../types.js";
import { ValidationError } from "./errors.js";
import {
  buildImportMigrationPlan,
  exportLoopsMigrationBundle,
  migrationHash,
  validateLoopsMigrationBundle,
} from "./migration.js";
import { Store } from "./store.js";

describe("migration agent target validation", () => {
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
