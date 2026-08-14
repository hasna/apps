import { readFileSync } from "node:fs";
import { RESERVED_PROFILE_IDS } from "../src/contracts";
import {
  INSTALL_POLICY_PACKAGE_PATTERN_SCHEMA,
  MCP_INPUT_SCHEMA_FRAGMENTS,
  validateArgv,
  validateInstallPolicyRules,
  validatePackageSpec,
} from "../src/validation";

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

function normalizedSql(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/\s*([(),=<>])\s*/g, "$1").trim();
}

export function assertPortableOpenApiPattern(pattern: string): void {
  let inCharacterClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === "\\") {
      let end = index;
      while (pattern[end] === "\\") end += 1;
      const escapedToken = (end - index) % 2 === 1;
      if (escapedToken) {
        const token = pattern[end];
        if ((token !== undefined && /^[1-9]$/.test(token))
          || (token === "0" && /^[0-9]$/.test(pattern[end + 1] ?? ""))
          || (token === "k" && pattern[end + 1] === "<")) {
          throw new Error(`OpenAPI pattern uses unsupported lookaround, backreference, or octal semantics: ${pattern}`);
        }
        index = end;
      } else {
        index = end - 1;
      }
      continue;
    }
    if (pattern[index] === "[" && !inCharacterClass) {
      inCharacterClass = true;
      continue;
    }
    if (pattern[index] === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (!inCharacterClass && pattern[index] === "(" && pattern[index + 1] === "?" && /^[=!<]$/.test(pattern[index + 2] ?? "")) {
      throw new Error(`OpenAPI pattern uses unsupported lookaround, backreference, or octal semantics: ${pattern}`);
    }
  }
  try { new RegExp(pattern); } catch { throw new Error(`OpenAPI pattern is not valid ECMAScript: ${pattern}`); }
}

function expectRuntimeRejection(label: string, operation: () => unknown): void {
  try { operation(); } catch { return; }
  throw new Error(`Runtime validation accepted an out-of-contract ${label}`);
}

if (openapi.openapi !== "3.1.0") throw new Error("OpenAPI must be 3.1.0");
if (resident.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error("Resident schema must use JSON Schema 2020-12");
walk(openapi, (value) => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    if ("$ref" in value) resolve(openapi, value, "OpenAPI");
    if (typeof value.pattern === "string") assertPortableOpenApiPattern(value.pattern);
  }
});

const schemas = object(object(openapi.components, "OpenAPI components").schemas, "OpenAPI schemas");
const execRequest = object(schemas.ExecRequest, "ExecRequest");
const execProperties = object(execRequest.properties, "ExecRequest properties");
if (canonical(execProperties.argv as Json) !== canonical(MCP_INPUT_SCHEMA_FRAGMENTS.argv as unknown as Json)) {
  throw new Error("ExecRequest.argv does not exactly match canonical runtime/MCP bounds");
}
if (canonical(schemas.PackageSpec as Json) !== canonical(MCP_INPUT_SCHEMA_FRAGMENTS.packageSpec as unknown as Json)) {
  throw new Error("PackageSpec does not exactly match canonical runtime/MCP bounds");
}
const installPolicyRule = object(schemas.InstallPolicyRule, "InstallPolicyRule");
const installPolicyProperties = object(installPolicyRule.properties, "InstallPolicyRule properties");
const packagePatterns = object(installPolicyProperties.packagePatterns, "InstallPolicyRule.packagePatterns");
if (canonical(packagePatterns.items as Json) !== canonical(INSTALL_POLICY_PACKAGE_PATTERN_SCHEMA as unknown as Json)) {
  throw new Error("InstallPolicyRule.packagePatterns does not exactly match runtime validation");
}
const registries = object(installPolicyProperties.registries, "InstallPolicyRule.registries");
if (canonical(registries.items as Json) !== canonical(MCP_INPUT_SCHEMA_FRAGMENTS.registry as unknown as Json)) {
  throw new Error("InstallPolicyRule.registries does not exactly match the canonical registry fragment");
}
validateArgv(["a".repeat(65_536)]);
validateArgv(Array.from({ length: 128 }, () => "a"));
expectRuntimeRejection("argv element count", () => validateArgv(Array.from({ length: 129 }, () => "a")));
expectRuntimeRejection("argv encoded byte budget", () => validateArgv(["a".repeat(65_537)]));
expectRuntimeRejection("argv NUL", () => validateArgv(["a\0b"]));
const canonicalPackage = {
  manager: "bun", name: "example", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`,
  registry: "https://registry.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false,
};
validatePackageSpec(canonicalPackage);
const canonicalRegistries = [
  "https://registry.example.invalid/",
  "https://registry.example.invalid/path",
  "https://registry.example.invalid/path/",
  "https://registry.example.invalid:8443/Case-Sensitive/V1.2/",
];
for (const registry of canonicalRegistries) {
  const packageResult = validatePackageSpec({ ...canonicalPackage, registry });
  if (packageResult.registry !== registry) throw new Error("Package registry input was silently normalized");
  const policyResult = validateInstallPolicyRules([{ effect: "allow", registries: [registry] }]);
  if (policyResult[0]?.registries?.[0] !== registry) throw new Error("Install policy registry input was silently normalized");
}
const maximumHostname = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(53)}.invalid`;
if (maximumHostname.length !== 253) throw new Error("Maximum registry hostname fixture must be exactly 253 characters");
const maximumHostnameRegistry = `https://${maximumHostname}/`;
const maximumHostnamePackage = validatePackageSpec({ ...canonicalPackage, registry: maximumHostnameRegistry });
if (maximumHostnamePackage.registry !== maximumHostnameRegistry) throw new Error("Maximum hostname package registry was normalized");
const maximumHostnamePolicy = validateInstallPolicyRules([{ effect: "allow", registries: [maximumHostnameRegistry] }]);
if (maximumHostnamePolicy[0]?.registries?.[0] !== maximumHostnameRegistry) throw new Error("Maximum hostname policy registry was normalized");
const oversizedHostnameRegistry = `https://${maximumHostname}a/`;
expectRuntimeRejection("package registry hostname length", () => validatePackageSpec({ ...canonicalPackage, registry: oversizedHostnameRegistry }));
expectRuntimeRejection("install policy registry hostname length", () => validateInstallPolicyRules([
  { effect: "allow", registries: [oversizedHostnameRegistry] },
]));
const nonCanonicalRegistries = [
  "HTTPS://registry.example.invalid/",
  "https://REGISTRY.example.invalid/",
  "https://registry.example.invalid",
  "https://registry.example.invalid:443/",
  "https://registry.example.invalid/path?channel=stable",
  "https://registry.example.invalid/path?",
  "https://registry.example.invalid/path#release",
  "https://registry.example.invalid/path#",
  "https://user:pass@registry.example.invalid/",
  "https://registry.example.invalid/a/../b",
  "https://registry.example.invalid\\path",
  "https://registry.example.invalid/%2e",
  "https://registry.example.invalid/%zz",
  "https://registry.example.invalid/[raw]",
  "https://registry.example.invalid/path|raw",
  "https://registry.example.invalid/path//",
  "https://127.1/",
  "https://0177.1/",
  "https://0x7f.1/",
  "https://127.000.000.001/",
  "https://registry.example.123/",
  "https://registry.example.invalid:444/",
  "https://registry.example.invalid:10443/",
  "https://registry.example.invalid:65535/",
  "https://registry.example.invalid/.well-known/",
  "https://registry.example.invalid/name./",
  " https://registry.example.invalid/",
  "https://registry.example.invalid/ ",
];
for (const registry of nonCanonicalRegistries) {
  expectRuntimeRejection("non-canonical package registry", () => validatePackageSpec({ ...canonicalPackage, registry }));
  expectRuntimeRejection("non-canonical policy registry", () => validateInstallPolicyRules([{ effect: "allow", registries: [registry] }]));
}
validateInstallPolicyRules([{ effect: "allow", packagePatterns: ["a*b*c*d*e*f*g*h*"] }]);
expectRuntimeRejection("install policy package pattern star count", () => validateInstallPolicyRules([
  { effect: "allow", packagePatterns: ["*a*b*c*d*e*f*g*h*"] },
]));
const maximumRegistry = `https://registry.example.invalid/${"a".repeat(512 - "https://registry.example.invalid/".length)}`;
const maximumPackage = validatePackageSpec({
  ...canonicalPackage,
  name: "a".repeat(214),
  version: "a".repeat(128),
  registry: maximumRegistry,
  dependencyClosure: Array.from({ length: 512 }, () => ({ name: "dependency", version: "1.0.0", digest: canonicalPackage.digest })),
});
if (maximumPackage.registry !== maximumRegistry) throw new Error("Maximum-length package registry was normalized");
const maximumPolicy = validateInstallPolicyRules([{ effect: "allow", registries: [maximumRegistry] }]);
if (maximumPolicy[0]?.registries?.[0] !== maximumRegistry) throw new Error("Maximum-length policy registry was normalized");
expectRuntimeRejection("credential-bearing registry", () => validatePackageSpec({ ...canonicalPackage, registry: "https://user:pass@registry.example.invalid/" }));
expectRuntimeRejection("non-HTTPS registry", () => validatePackageSpec({ ...canonicalPackage, registry: "http://registry.example.invalid/" }));
expectRuntimeRejection("registry length", () => validatePackageSpec({
  ...canonicalPackage,
  registry: `https://registry.example.invalid/${"a".repeat(513 - "https://registry.example.invalid/".length)}`,
}));
expectRuntimeRejection("install policy registry length", () => validateInstallPolicyRules([{
  effect: "allow",
  registries: [`https://registry.example.invalid/${"a".repeat(513 - "https://registry.example.invalid/".length)}`],
}]));
expectRuntimeRejection("package name length", () => validatePackageSpec({ ...canonicalPackage, name: "a".repeat(215) }));
expectRuntimeRejection("package version length", () => validatePackageSpec({ ...canonicalPackage, version: "a".repeat(129) }));
expectRuntimeRejection("package digest", () => validatePackageSpec({ ...canonicalPackage, digest: `sha256:${"A".repeat(64)}` }));
expectRuntimeRejection("package digest length", () => validatePackageSpec({ ...canonicalPackage, digest: `sha256:${"a".repeat(65)}` }));
expectRuntimeRejection("dependency count", () => validatePackageSpec({
  ...canonicalPackage,
  dependencyClosure: Array.from({ length: 513 }, () => ({ name: "dependency", version: "1.0.0", digest: canonicalPackage.digest })),
}));
const idReference: ObjectJson = { $ref: "#/components/schemas/Id" };
const idempotencyKeyReference: ObjectJson = { $ref: "#/components/schemas/IdempotencyKey" };
const slugSchema: ObjectJson = { type: "string", minLength: 1, maxLength: 63, pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$" };
// CreateComputer is cross-checked in full: every request-body property, the closed-object guard,
// the exact required set, and the ordered allOf conditionals that mirror ComputersService.createComputer
// (local_vm requires a profile; parentComputerId is grant-bounded; a grantId requires a parent).
const createComputer = object(schemas.CreateComputer, "CreateComputer");
const expectedCreateComputer: ObjectJson = {
  type: "object",
  required: ["slug", "provider", "ownerPrincipalId"],
  additionalProperties: false,
  properties: {
    id: idReference,
    slug: slugSchema,
    provider: { enum: ["local_machine", "local_vm", "aws_ec2"] },
    ownerPrincipalId: idReference,
    parentComputerId: idReference,
    grantId: idReference,
    region: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9_-]*$" },
    profileId: idReference,
    storageGiB: { type: "integer", minimum: 1, maximum: 1048576 },
    uptimeSeconds: { type: "integer", minimum: 1, maximum: 31536000 },
    budgetMicros: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    idempotencyKey: idempotencyKeyReference,
    broadInternet: { type: "boolean" },
  },
  allOf: [
    { if: { properties: { provider: { const: "local_vm" } }, required: ["provider"] }, then: { required: ["profileId"] } },
    { if: { required: ["parentComputerId"] }, then: { required: ["grantId", "region", "profileId", "storageGiB", "uptimeSeconds", "budgetMicros"] } },
    { if: { required: ["grantId"] }, then: { required: ["parentComputerId"] } },
  ],
};
if (canonical(createComputer as Json) !== canonical(expectedCreateComputer as Json)) {
  throw new Error("CreateComputer schema does not exactly match runtime validation");
}
// AdoptComputer is cross-checked in full against ComputersService.adoptComputer's accepted keys.
const adoptComputer = object(schemas.AdoptComputer, "AdoptComputer");
const expectedAdoptComputer: ObjectJson = {
  type: "object",
  required: ["slug", "ownerPrincipalId", "adoptionId"],
  additionalProperties: false,
  properties: {
    id: idReference,
    slug: slugSchema,
    ownerPrincipalId: idReference,
    adoptionId: idReference,
    profileId: idReference,
    idempotencyKey: idempotencyKeyReference,
  },
};
if (canonical(adoptComputer as Json) !== canonical(expectedAdoptComputer as Json)) {
  throw new Error("AdoptComputer schema does not exactly match runtime validation");
}
// CreateComputerProfile is cross-checked in full. Its id must use the CustomProfileId constraint so
// tenant-created profiles cannot shadow a reserved built-in id, matching ComputersService.createProfile
// and SQLiteStorage.createProfile, while built-in profile references elsewhere still use Id.
const createProfileSchema = object(schemas.CreateComputerProfile, "CreateComputerProfile");
const expectedCreateProfile: ObjectJson = {
  type: "object",
  required: ["id", "name", "document"],
  additionalProperties: false,
  properties: {
    id: { $ref: "#/components/schemas/CustomProfileId" },
    name: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$" },
    document: { $ref: "#/components/schemas/ComputerProfileDocument" },
  },
};
if (canonical(createProfileSchema as Json) !== canonical(expectedCreateProfile as Json)) {
  throw new Error("CreateComputerProfile schema does not exactly match runtime validation");
}
// CustomProfileId must retain the canonical Id bounds (via allOf) and exclude exactly the runtime's
// RESERVED_PROFILE_IDS via a not/enum, with no other shape. Built-in profile references keep using Id.
const customProfileId = object(schemas.CustomProfileId, "CustomProfileId");
if (canonical(customProfileId.allOf as Json) !== canonical([idReference] as unknown as Json)) {
  throw new Error("CustomProfileId must retain the canonical Id bounds via allOf");
}
const customProfileNot = object(customProfileId.not, "CustomProfileId.not");
if (canonical(Object.keys(customProfileId).sort() as unknown as Json) !== canonical(["allOf", "not"])
  || canonical(Object.keys(customProfileNot) as unknown as Json) !== canonical(["enum"])) {
  throw new Error("CustomProfileId must exclude reserved ids with exactly an allOf + not(enum) shape");
}
const excludedProfileIds = customProfileNot.enum;
if (!Array.isArray(excludedProfileIds)
  || canonical([...excludedProfileIds].sort() as Json) !== canonical([...RESERVED_PROFILE_IDS].sort() as unknown as Json)) {
  throw new Error("CustomProfileId must exclude exactly the reserved built-in profile ids");
}
if (schemas.Id === undefined) throw new Error("CustomProfileId references a missing Id schema");
const createGrant = object(schemas.CreateComputerGrant, "CreateComputerGrant");
const grantProperties = object(createGrant.properties, "CreateComputerGrant properties");
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
// ComputerProfileDocument is cross-checked in full against ComputersService.validateProfileDocument:
// scalar CPU/memory/disk bounds, the closed-object guard, the required set, and the provider-conditional
// image requirements (local_vm must carry an image; local_machine must not).
const profileDocument = object(schemas.ComputerProfileDocument, "ComputerProfileDocument");
const expectedProfileDocument: ObjectJson = {
  type: "object",
  required: ["provider", "cpus", "memoryGiB", "rootDiskGiB", "homeDiskGiB"],
  additionalProperties: false,
  properties: {
    provider: { enum: ["local_machine", "local_vm"] },
    cpus: { type: "integer", minimum: 1, maximum: 64 },
    memoryGiB: { type: "integer", minimum: 1, maximum: 256 },
    rootDiskGiB: { type: "integer", minimum: 8, maximum: 4096 },
    homeDiskGiB: { type: "integer", minimum: 1, maximum: 4096 },
    imageLocation: { type: "string", format: "uri", pattern: "^https://", maxLength: 2048 },
    imageDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
  },
  allOf: [
    { if: { properties: { provider: { const: "local_vm" } }, required: ["provider"] }, then: { required: ["imageLocation", "imageDigest"] } },
    { if: { properties: { provider: { const: "local_machine" } }, required: ["provider"] }, then: { not: { anyOf: [{ required: ["imageLocation"] }, { required: ["imageDigest"] }] } } },
  ],
};
if (canonical(profileDocument as Json) !== canonical(expectedProfileDocument as Json)) {
  throw new Error("ComputerProfileDocument schema does not exactly match runtime validation");
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
const sqlite2 = readFileSync("migrations/sqlite/0002_provider_assurance.sql", "utf8");
const postgres2 = readFileSync("migrations/postgres/0002_provider_assurance.sql", "utf8");
const sqlite3 = readFileSync("migrations/sqlite/0003_provider_binding_provenance.sql", "utf8");
const postgres3 = readFileSync("migrations/postgres/0003_provider_binding_provenance.sql", "utf8");
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
if (!sqlite2.includes("CREATE TABLE provider_assurance") || !sqlite2.includes("VALUES (2,")) throw new Error("SQLite 0002 assurance migration is incomplete");
if (!postgres2.includes("CREATE TABLE IF NOT EXISTS provider_assurance") || !postgres2.includes("FORCE ROW LEVEL SECURITY") || !postgres2.includes("VALUES (2) ON CONFLICT DO NOTHING")) throw new Error("PostgreSQL 0002 assurance migration is incomplete");
const assuranceProvenance = [
  "CREATE UNIQUE INDEX computers_assurance_provider_key ON computers (tenant_id, id, provider)",
  "CREATE UNIQUE INDEX operations_assurance_computer_key ON operations (tenant_id, id, computer_id)",
  "CREATE UNIQUE INDEX operation_attempts_assurance_operation_key ON operation_attempts (tenant_id, operation_id, id)",
  "FOREIGN KEY (tenant_id, computer_id, provider) REFERENCES computers (tenant_id, id, provider)",
  "FOREIGN KEY (tenant_id, operation_id, computer_id) REFERENCES operations (tenant_id, id, computer_id)",
  "FOREIGN KEY (tenant_id, operation_id, attempt_id) REFERENCES operation_attempts (tenant_id, operation_id, id)",
];
for (const [file, sql] of [["SQLite", sqlite2], ["PostgreSQL", postgres2]] as const) {
  const normalized = normalizedSql(sql).replaceAll(" if not exists ", " ");
  for (const requirement of assuranceProvenance) {
    if (!normalized.includes(normalizedSql(requirement))) throw new Error(`${file} 0002 is missing assurance provenance: ${requirement}`);
  }
  if (!normalized.includes(normalizedSql("provider <> 'local_vm' OR confinement_class = 'unverified_vm'"))) {
    throw new Error(`${file} 0002 is missing the stock local_vm demotion guard`);
  }
}
if (!sqlite3.includes("CREATE TABLE provider_bindings_v3") || !sqlite3.includes("VALUES (3,")) throw new Error("SQLite 0003 provider binding migration is incomplete");
if (!postgres3.includes("ALTER TABLE provider_bindings") || !postgres3.includes("VALUES (3) ON CONFLICT DO NOTHING")) throw new Error("PostgreSQL 0003 provider binding migration is incomplete");
// Both backends must bind live authority per resource with a PARTIAL unique index (released bindings
// are retained for provenance and must not block re-adoption). Neither may keep an unconditional
// (tenant_id, provider, resource_id) uniqueness over all states.
const partialResourceUnique = normalizedSql("CREATE UNIQUE INDEX provider_bindings_active_resource ON provider_bindings (tenant_id, provider, resource_id) WHERE state IN ('unknown', 'active')");
for (const [file, sql] of [["SQLite", sqlite3], ["PostgreSQL", postgres3]] as const) {
  const normalized = normalizedSql(sql).replaceAll(" if not exists ", " ");
  if (!normalized.includes(partialResourceUnique)) throw new Error(`${file} 0003 must bind live provider authority with a partial unique index`);
  if (normalized.includes(normalizedSql("UNIQUE (tenant_id, provider, resource_id)"))) throw new Error(`${file} 0003 must not keep an unconditional provider resource uniqueness`);
}
const bindingProvenance = [
  "FOREIGN KEY (tenant_id, computer_id, provider) REFERENCES computers (tenant_id, id, provider)",
  "FOREIGN KEY (tenant_id, operation_id, computer_id) REFERENCES operations (tenant_id, id, computer_id)",
  "FOREIGN KEY (tenant_id, operation_id, attempt_id) REFERENCES operation_attempts (tenant_id, operation_id, id)",
];
for (const [file, sql] of [["SQLite", sqlite3], ["PostgreSQL", postgres3]] as const) {
  const normalized = normalizedSql(sql).replaceAll(" if not exists ", " ");
  for (const requirement of bindingProvenance) {
    if (!normalized.includes(normalizedSql(requirement))) throw new Error(`${file} 0003 is missing provider binding provenance: ${requirement}`);
  }
}
if (!normalizedSql(postgres2).startsWith("begin;") || !normalizedSql(postgres2).endsWith("commit;")) throw new Error("PostgreSQL 0002 must be transactional");
const normalizedPostgres2 = normalizedSql(postgres2);
const scopedPostgresDemotionRequirements = [
  "rolbypassrls OR executing_role.rolsuper",
  "provider-assurance migration requires a dedicated BYPASSRLS migration role",
  "LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE",
  "CREATE TEMP TABLE provider_assurance_demoted_local_vm",
  "ON COMMIT DROP",
  "INSERT INTO provider_assurance_demoted_local_vm (tenant_id, computer_id) SELECT tenant_id, id FROM computers",
  "WHERE provider = 'local_vm' AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 2)",
  "UPDATE computers c SET confinement_class = 'unverified_vm'",
  "status = CASE WHEN c.status IN ('deleted','deleting') THEN c.status ELSE 'quarantined' END",
  "policy_generation = c.policy_generation + 1",
  "UPDATE resident_enrollments e SET revoked_at = now() FROM provider_assurance_demoted_local_vm d",
  "UPDATE resident_identities i SET revoked_at = now() FROM provider_assurance_demoted_local_vm d",
  "DELETE FROM resident_nonces n USING provider_assurance_demoted_local_vm d",
  "DELETE FROM resident_bindings b USING provider_assurance_demoted_local_vm d",
  "DELETE FROM provider_bindings b USING provider_assurance_demoted_local_vm d",
  "DELETE FROM operation_home_leases l USING provider_assurance_demoted_local_vm d",
  "DELETE FROM home_leases l USING provider_assurance_demoted_local_vm d",
];
for (const requirement of scopedPostgresDemotionRequirements) {
  if (!normalizedPostgres2.includes(normalizedSql(requirement))) throw new Error(`PostgreSQL 0002 demotion scope is incomplete: ${requirement}`);
}
const postgresWriterLock = postgres2.match(/LOCK TABLE\s+computers,([\s\S]*?)IN SHARE ROW EXCLUSIVE MODE;/i)?.[0];
if (postgresWriterLock === undefined) throw new Error("PostgreSQL 0002 is missing the application-writer exclusion lock");
for (const table of ["computers", "operations", "operation_attempts", "provider_bindings", "operation_home_leases", "home_leases", "resident_bindings", "resident_enrollments", "resident_identities", "resident_nonces", "profiles", "profile_revisions"]) {
  if (!new RegExp(`\\b${table}\\b`).test(postgresWriterLock)) throw new Error(`PostgreSQL 0002 writer lock is missing ${table}`);
}
if (normalizedPostgres2.indexOf(normalizedSql("INSERT INTO schema_migrations(version) VALUES (2)"))
  < normalizedPostgres2.indexOf(normalizedSql("DELETE FROM home_leases l USING provider_assurance_demoted_local_vm d"))) {
  throw new Error("PostgreSQL 0002 records migration completion before legacy authority is fenced");
}
for (const broadAuthorityMutation of [
  "UPDATE resident_enrollments e SET revoked_at = now() FROM computers c",
  "UPDATE resident_identities i SET revoked_at = now() FROM computers c",
  "DELETE FROM resident_bindings b USING computers c",
  "DELETE FROM operation_home_leases l USING computers c",
  "DELETE FROM home_leases l USING computers c",
]) {
  if (normalizedPostgres2.includes(normalizedSql(broadAuthorityMutation))) throw new Error(`PostgreSQL 0002 has an unscoped authority mutation: ${broadAuthorityMutation}`);
}
for (const trigger of ["computers_local_vm_unverified_insert", "computers_local_vm_unverified_update", "provider_assurance_local_vm_unverified_insert", "provider_assurance_local_vm_unverified_update"]) {
  if (!sqlite2.includes(`CREATE TRIGGER ${trigger}`)) throw new Error(`SQLite 0002 is missing strict guard ${trigger}`);
}
if (sqlite.includes("provider_assurance") || postgres.includes("provider_assurance")) throw new Error("Canonical 0001 migrations must remain immutable; provider assurance belongs in 0002");

process.stdout.write(`schema checks passed (${operationIds.size} OpenAPI operations, ${coreTables.length} shared tables)\n`);
