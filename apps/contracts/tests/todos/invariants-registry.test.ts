// Agent-authored test-gap analysis (no SOL spec): the SOL consult (gpt-5.6-sol,
// max reasoning) was admitted but produced no answer within its bounds, so this
// file was authored by the writing agent and must not be attributed to SOL.
//
// Target: src/todos/invariants.ts — the runtime invariant registry. The
// artifacts-package tests pin the registry DIGEST (bytes), but not the
// registry's SEMANTICS: that every invariant resolves to a real schema, that
// ids are unique, that lookup is sorted, and that every invariant carries the
// validators and description the runtime-validation contract requires. A
// digest-only gate cannot tell a coherent edit from a broken one. Deterministic
// registry-level assertions, no fixtures.

import { describe, expect, test } from "bun:test";
import {
  TODOS_INVARIANT_REGISTRY,
  TODOS_INVARIANT_REGISTRY_SCHEMA_ID,
  TODOS_RUNTIME_INVARIANTS,
  todosInvariantIdsForSchema,
} from "../../src/todos/invariants";
import { TODOS_SCHEMA_REGISTRY } from "../../src/todos/schema-registry";

const INVARIANT_CATEGORIES = [
  "common",
  "identity",
  "authority",
  "domain",
  "response",
  "operation",
  "invocation",
  "contract",
  "transfer",
  "projection",
  "artifacts",
] as const;

describe("invariant registry coherence", () => {
  test("every invariant id is unique", () => {
    const ids = TODOS_RUNTIME_INVARIANTS.map((invariant) => invariant.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every referenced schema id exists in the schema registry", () => {
    const known = new Set(Object.keys(TODOS_SCHEMA_REGISTRY));
    for (const invariant of TODOS_RUNTIME_INVARIANTS) {
      for (const schemaId of invariant.schemaIds) {
        expect(known.has(schemaId), `${invariant.id} -> ${schemaId}`).toBe(true);
      }
    }
  });

  test("every invariant has a non-empty description and at least one validator", () => {
    for (const invariant of TODOS_RUNTIME_INVARIANTS) {
      expect(invariant.description.trim().length, invariant.id).toBeGreaterThan(0);
      expect(invariant.runtimeValidatorIds.length, invariant.id).toBeGreaterThan(0);
    }
  });

  test("every invariant category is a declared category", () => {
    for (const invariant of TODOS_RUNTIME_INVARIANTS) {
      expect(INVARIANT_CATEGORIES).toContain(invariant.category);
    }
  });

  test("the registry envelope declares its schema id and runtime-validation requirement", () => {
    expect(TODOS_INVARIANT_REGISTRY.schema).toBe(TODOS_INVARIANT_REGISTRY_SCHEMA_ID);
    expect(TODOS_INVARIANT_REGISTRY.runtimeValidationRequired).toBe(true);
    expect(TODOS_INVARIANT_REGISTRY.invariants).toBe(TODOS_RUNTIME_INVARIANTS);
  });
});

describe("todosInvariantIdsForSchema", () => {
  test("returns the invariant ids bound to a schema, sorted", () => {
    const ids = todosInvariantIdsForSchema("hasna.todos.identity_context.v1");
    expect(ids).toEqual(["todos.identity.authorization_binding", "todos.identity.context_semantics"]);
  });

  test("returns ids for common invariants bound to task files", () => {
    const ids = todosInvariantIdsForSchema("hasna.todos.task_file.v1");
    expect(ids).toContain("todos.common.relative_path");
  });

  test("returns an empty list for an unknown schema", () => {
    expect(todosInvariantIdsForSchema("hasna.todos.no_such_schema.v1")).toEqual([]);
  });

  test("every schema in the registry with invariants resolves through the lookup", () => {
    // Round-trip: whatever the registry binds to a schema, the lookup returns.
    for (const invariant of TODOS_RUNTIME_INVARIANTS) {
      for (const schemaId of invariant.schemaIds) {
        expect(todosInvariantIdsForSchema(schemaId)).toContain(invariant.id);
      }
    }
  });
});
