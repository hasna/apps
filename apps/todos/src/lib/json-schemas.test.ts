import { describe, it, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  JSON_SCHEMA_CATALOG_VERSION,
  SCHEMA_ENTITIES,
  SCHEMA_SEMVER,
  JSON_SCHEMAS,
  SCHEMA_CONTRACT_FIXTURES,
  validateSchemaPayload,
  validateAllContractFixtures,
  checkSchemaCompatibility,
  listJsonSchemas,
  getSchemaSemverGuidance,
  exportSchemasToDirectory,
  wrapWithSchemaVersion,
} from "./json-schemas.js";

describe("json schemas", () => {
  it("defines all required entities", () => {
    expect(SCHEMA_ENTITIES).toHaveLength(10);
    for (const entity of SCHEMA_ENTITIES) {
      expect(JSON_SCHEMAS[entity].schema_version).toMatch(/^(todos|testers)\./);
    }
  });

  it("validates all contract fixtures", () => {
    expect(validateAllContractFixtures()).toEqual([]);
    for (const entity of SCHEMA_ENTITIES) {
      const result = validateSchemaPayload(entity, SCHEMA_CONTRACT_FIXTURES[entity]);
      expect(result.valid).toBe(true);
    }
  });

  it("rejects invalid task payloads", () => {
    const result = validateSchemaPayload("task", { schema_version: "todos.task.v1", title: "x" });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects wrong schema_version", () => {
    const bad = { ...SCHEMA_CONTRACT_FIXTURES.task, schema_version: "todos.task.v99" };
    const result = validateSchemaPayload("task", bad);
    expect(result.valid).toBe(false);
  });

  it("checks compatibility within same major version", () => {
    const r = checkSchemaCompatibility("task", "todos.task.v1", "todos.task.v1");
    expect(r.compatible).toBe(true);
  });

  it("flags major version breaking changes", () => {
    const r = checkSchemaCompatibility("task", "todos.task.v1", "todos.task.v2");
    expect(r.compatible).toBe(false);
    expect(r.breaking_changes.length).toBeGreaterThan(0);
  });

  it("lists schema catalog", () => {
    const list = listJsonSchemas();
    expect(list.length).toBe(10);
    expect(list[0]?.entity).toBeTruthy();
  });

  it("exports schemas to directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-schemas-"));
    const files = exportSchemasToDirectory(dir);
    expect(files.length).toBe(11);
    expect(existsSync(join(dir, "catalog.json"))).toBe(true);
    const catalog = JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8"));
    expect(catalog.catalog_version).toBe(JSON_SCHEMA_CATALOG_VERSION);
    expect(catalog.semver).toBe(SCHEMA_SEMVER);
    rmSync(dir, { recursive: true, force: true });
  });

  it("wraps records with schema_version", () => {
    const wrapped = wrapWithSchemaVersion("task", { id: "1", title: "T" });
    expect(wrapped.schema_version).toBe("todos.task.v1");
  });

  it("documents semver guidance without hosted deps", () => {
    const docs = getSchemaSemverGuidance();
    expect(docs).toContain("Semver");
    expect(docs).not.toMatch(/platform-todos|stripe/i);
  });
});
