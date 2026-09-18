import { describe, expect, test } from "bun:test";
import openApi from "../../openapi/loops.json" with { type: "json" };
import { validateImportRequest } from "../lib/import-validation.js";
import type { ImportInput } from "./http.js";

type JsonSchema = {
  $ref?: string;
  oneOf?: JsonSchema[];
  type?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  minimum?: number;
  format?: string;
};

const schemas = (openApi as { components: { schemas: Record<string, JsonSchema> } }).components.schemas;

function resolve(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.match(/^#\/components\/schemas\/(.+)$/)?.[1];
  if (!name || !schemas[name]) throw new Error(`unresolved schema ref ${schema.$ref}`);
  return schemas[name];
}

function schemaAccepts(value: unknown, input: JsonSchema): boolean {
  const schema = resolve(input);
  if (schema.oneOf) return schema.oneOf.filter((candidate) => schemaAccepts(value, candidate)).length === 1;
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "string") {
    if (typeof value !== "string" || (schema.minLength !== undefined && value.length < schema.minLength)) return false;
    if (schema.format === "date-time" && !Number.isFinite(Date.parse(value))) return false;
    return true;
  }
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "integer") {
    return Number.isSafeInteger(value) && (schema.minimum === undefined || Number(value) >= schema.minimum);
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    return schema.items === undefined || value.every((entry) => schemaAccepts(entry, schema.items!));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    if (schema.required?.some((key) => !(key in row))) return false;
    for (const [key, entry] of Object.entries(row)) {
      const property = schema.properties?.[key];
      if (property) {
        if (!schemaAccepts(entry, property)) return false;
      } else if (schema.additionalProperties === false) {
        return false;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        if (!schemaAccepts(entry, schema.additionalProperties)) return false;
      }
    }
    return true;
  }
  return true;
}

const completeImport: ImportInput = {
  workflows: [{
    id: "workflow-complete",
    name: "workflow-complete",
    version: 1,
    status: "active",
    steps: [{ id: "step", target: { type: "command", command: "true" } }],
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
  }],
  loops: [{
    id: "loop-complete",
    name: "loop-complete",
    labels: [],
    status: "paused",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "workflow", workflowId: "workflow-complete" },
    catchUp: "none",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 0,
    leaseMs: 60_000,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
  }],
  runs: [{
    id: "run-complete",
    loopId: "loop-complete",
    loopName: "loop-complete",
    scheduledFor: "2026-09-18T00:00:00.000Z",
    attempt: 1,
    status: "succeeded",
    finishedAt: "2026-09-18T00:00:01.000Z",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:01.000Z",
  }],
};

function sdkImport(_input: ImportInput): void {}

// Compile-time regressions: public projection rows are not import rows.
// @ts-expect-error import workflows require timestamps and a full step contract
sdkImport({ workflows: [{ id: "w", name: "w", version: 1, status: "active", steps: [] }] });
// @ts-expect-error import loops require schedule, target, retry/lease policy, and timestamps
sdkImport({ loops: [{ id: "l", name: "l", labels: [], status: "paused" }] });
// @ts-expect-error import runs require loop name, schedule identity, attempt, and timestamps
sdkImport({ runs: [{ id: "r", loopId: "l", status: "succeeded" }] });

describe("strict import request contract", () => {
  test("OpenAPI uses dedicated full-row schemas instead of public projections", () => {
    const input = schemas.ImportInput;
    expect(input.properties?.workflows?.items).toEqual({ $ref: "#/components/schemas/ImportWorkflow" });
    expect(input.properties?.loops?.items).toEqual({ $ref: "#/components/schemas/ImportLoop" });
    expect(input.properties?.runs?.items).toEqual({ $ref: "#/components/schemas/ImportRun" });
    expect(schemas.ImportWorkflow.required).toEqual(expect.arrayContaining(["steps", "createdAt", "updatedAt"]));
    expect(schemas.ImportLoop.required).toEqual(expect.arrayContaining([
      "schedule", "target", "catchUp", "catchUpLimit", "overlap", "maxAttempts", "retryDelayMs", "leaseMs", "createdAt", "updatedAt",
    ]));
  });

  test("OpenAPI and server both reject the formerly SDK-valid incomplete projection payload", () => {
    const incomplete = {
      workflows: [{ id: "w", name: "w", version: 1, status: "active", steps: [] }],
      loops: [{ id: "l", name: "l", labels: [], status: "paused" }],
      runs: [{ id: "r", loopId: "l", status: "succeeded" }],
    };
    expect(schemaAccepts(incomplete, schemas.ImportInput)).toBe(false);
    expect(() => validateImportRequest(incomplete)).toThrow("migration import request is invalid");
  });

  test("OpenAPI, generated SDK type, and server accept the same complete rows", () => {
    expect(schemaAccepts(completeImport, schemas.ImportInput)).toBe(true);
    expect(validateImportRequest(completeImport)).toMatchObject({
      workflows: [{ id: "workflow-complete" }],
      loops: [{ id: "loop-complete" }],
      runs: [{ id: "run-complete" }],
    });
  });
});
