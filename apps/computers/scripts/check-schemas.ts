import { readFileSync } from "node:fs";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectJson = { [key: string]: Json };

const openapi = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as ObjectJson;
const resident = JSON.parse(readFileSync("schemas/resident-protocol.schema.json", "utf8")) as ObjectJson;

function object(value: Json | undefined, label: string): ObjectJson {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function resolve(document: ObjectJson, value: Json, label: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.$ref !== "string") return value;
  if (!value.$ref.startsWith("#/")) throw new Error(`${label} contains a non-local reference: ${value.$ref}`);
  let target: Json = document;
  for (const raw of value.$ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    target = object(target, value.$ref)[key] as Json;
    if (target === undefined) throw new Error(`${label} contains an unresolved reference: ${value.$ref}`);
  }
  return target;
}

function walk(value: Json, visit: (value: Json) => void): void {
  visit(value);
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) walk(item, visit);
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key] as Json)}`).join(",")}}`;
  return JSON.stringify(value);
}

if (openapi.openapi !== "3.1.0") throw new Error("OpenAPI must be 3.1.0");
if (resident.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error("Resident schema must use JSON Schema 2020-12");
walk(openapi, (value) => {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "$ref" in value) resolve(openapi, value, "OpenAPI");
});

const schemas = object(object(openapi.components, "OpenAPI components").schemas, "OpenAPI schemas");
const createComputer = object(schemas.CreateComputer, "CreateComputer");
const createProperties = object(createComputer.properties, "CreateComputer properties");
const expectedCreateConstraints: Record<string, ObjectJson> = {
  slug: { type: "string", minLength: 1, maxLength: 63, pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$" },
  region: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9_-]*$" },
  storageGiB: { type: "integer", minimum: 1, maximum: 1048576 },
  uptimeSeconds: { type: "integer", minimum: 1, maximum: 31536000 },
  budgetMicros: { type: "integer", minimum: 0, maximum: 9007199254740991 },
};
for (const [field, expected] of Object.entries(expectedCreateConstraints)) {
  const actual = object(createProperties[field], `CreateComputer.${field}`);
  for (const [constraint, value] of Object.entries(expected)) if (actual[constraint] !== value) throw new Error(`CreateComputer.${field}.${constraint} does not match runtime validation`);
}
const delegatedRequirement = { if: { required: ["parentComputerId"] }, then: { required: ["grantId", "region", "profileId", "storageGiB", "uptimeSeconds", "budgetMicros"] } };
if (!Array.isArray(createComputer.allOf) || !createComputer.allOf.some((item) => JSON.stringify(item) === JSON.stringify(delegatedRequirement))) {
  throw new Error("CreateComputer delegated resource requirements do not match runtime validation");
}
const createGrant = object(schemas.CreateComputerGrant, "CreateComputerGrant");
const grantProperties = object(createGrant.properties, "CreateComputerGrant properties");
const idReference: ObjectJson = { $ref: "#/components/schemas/Id" };
const expectedGrantProperties: Record<string, ObjectJson> = {
  id: idReference,
  principalId: idReference,
  ownerPrincipalId: idReference,
  parentComputerId: idReference,
  allowedProviders: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: ["local_machine", "local_vm", "aws_ec2"] } },
  allowedChildOwnerPrincipalIds: { type: "array", minItems: 1, maxItems: 128, uniqueItems: true, items: idReference },
  allowedRegions: { type: "array", minItems: 1, maxItems: 32, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9_-]*$" } },
  allowedProfileIds: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: idReference },
  maxStorageGiB: { type: "integer", minimum: 1, maximum: 1048576 },
  maxUptimeSeconds: { type: "integer", minimum: 1, maximum: 31536000 },
  maxBudgetMicros: { type: "integer", minimum: 0, maximum: 9007199254740991 },
  limit: { type: "integer", minimum: 1, maximum: 1000 },
  expiresAt: { type: "string", format: "date-time" },
};
if (createGrant.additionalProperties !== false || canonical(grantProperties) !== canonical(expectedGrantProperties)) {
  throw new Error("CreateComputerGrant properties do not exactly match runtime validation bounds");
}
const expectedGrantRequired = ["principalId", "ownerPrincipalId", "parentComputerId", "allowedProviders", "allowedChildOwnerPrincipalIds", "allowedRegions", "allowedProfileIds", "maxStorageGiB", "maxUptimeSeconds", "maxBudgetMicros", "limit"];
if (!Array.isArray(createGrant.required) || canonical(createGrant.required) !== canonical(expectedGrantRequired)) {
  throw new Error("CreateComputerGrant required fields do not match runtime validation");
}

const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const operationIds = new Set<string>();
for (const [path, rawPathItem] of Object.entries(object(openapi.paths, "OpenAPI paths"))) {
  const pathItem = object(rawPathItem, `path ${path}`);
  for (const [method, rawOperation] of Object.entries(pathItem)) {
    if (!methods.has(method)) continue;
    const operation = object(rawOperation, `${method.toUpperCase()} ${path}`);
    if (typeof operation.operationId !== "string" || operation.operationId.length === 0 || operationIds.has(operation.operationId)) {
      throw new Error(`${method.toUpperCase()} ${path} has a missing or duplicate operationId`);
    }
    operationIds.add(operation.operationId);
    const responses = object(operation.responses, `${operation.operationId} responses`);
    if (Object.keys(responses).length === 0) throw new Error(`${operation.operationId} has no responses`);
    for (const [status, response] of Object.entries(responses)) {
      if (!/^(?:[1-5][0-9]{2}|default)$/.test(status)) throw new Error(`${operation.operationId} has invalid response status ${status}`);
      object(resolve(openapi, response, `${operation.operationId} response ${status}`), `${operation.operationId} response ${status}`);
    }
    if (operation.requestBody !== undefined) {
      const requestBody = object(resolve(openapi, operation.requestBody, `${operation.operationId} requestBody`), `${operation.operationId} requestBody`);
      const media = object(object(requestBody.content, `${operation.operationId} content`)["application/json"], `${operation.operationId} JSON content`);
      const schema = object(resolve(openapi, media.schema as Json, `${operation.operationId} schema`), `${operation.operationId} schema`);
      if (schema.type === "object" && schema.additionalProperties !== false) throw new Error(`${operation.operationId} request object must reject unknown fields`);
    }
  }
}

const residentRequired = object(resident, "resident schema").required;
if (!Array.isArray(residentRequired) || resident.additionalProperties !== false) throw new Error("Resident envelope schema must be closed and fully required");
for (const name of ["operationId", "attemptId", "tenantId", "computerId", "certificateId", "policyGeneration", "fence", "sequence", "nonce", "issuedAt", "expiresAt", "capability", "payloadDigest"]) {
  if (!residentRequired.includes(name)) throw new Error(`Resident schema missing required ${name}`);
}

const sqlite = readFileSync("migrations/sqlite/0001_initial.sql", "utf8");
const postgres = readFileSync("migrations/postgres/0001_initial.sql", "utf8");
const coreTables = ["computers", "computer_create_grants", "child_reservations", "assignments", "idempotency_keys", "operations", "operation_attempts", "provider_bindings", "operation_home_leases", "home_leases", "resident_bindings", "resident_enrollments", "resident_identities", "resident_nonces", "install_policy_revisions", "install_tickets", "volumes", "snapshots", "profiles", "profile_revisions", "grants", "sessions", "audit_events", "outbox_events"];
for (const table of coreTables) {
  for (const [file, sql] of [["SQLite", sqlite], ["PostgreSQL", postgres]] as const) {
    if (!sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) throw new Error(`${file} migration is missing ${table}`);
  }
}
for (const [file, sql] of [["SQLite", sqlite], ["PostgreSQL", postgres]] as const) {
  if (!sql.includes("provider = 'local_machine' AND confinement_class = 'dedicated_machine'")) throw new Error(`${file} is missing provider/confinement invariants`);
  for (const value of ["'create'", "'restore'", "'unknown'", "'cancelled'"]) if (!sql.includes(value)) throw new Error(`${file} is missing operation enum ${value}`);
}
if (!postgres.includes("FORCE ROW LEVEL SECURITY") || !postgres.includes("NULLIF(current_setting('computers.tenant_id', true), '')")) throw new Error("PostgreSQL RLS is not fail closed");
for (const table of coreTables) if (!postgres.includes(`'${table}'`)) throw new Error(`PostgreSQL RLS table list is missing ${table}`);
if (postgres.includes("controller_keys")) throw new Error("PostgreSQL must require an external controller-key provider");
if (!postgres.includes("migration role") || !postgres.includes("application role") || !postgres.includes("runtime PostgreSQL support is unready")) throw new Error("PostgreSQL role/readiness contract is incomplete");

process.stdout.write(`schema checks passed (${operationIds.size} OpenAPI operations, ${coreTables.length} shared tables)\n`);
