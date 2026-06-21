/**
 * Versioned JSON schemas for OSS todos entities and contract validation.
 * Local-only — no hosted API required to validate or export schemas.
 */

export const JSON_SCHEMA_CATALOG_VERSION = "todos.json_schema_catalog.v1";
export const SCHEMA_SEMVER = "1.0.0";

export const SCHEMA_ENTITIES = [
  "task",
  "project",
  "plan",
  "agent_run",
  "run_record",
  "verification_evidence",
  "handoff",
  "import_export_bundle",
  "mcp_response",
  "tester_issue_report",
] as const;

export type SchemaEntity = (typeof SCHEMA_ENTITIES)[number];

export interface JsonSchemaProperty {
  type?: string | string[];
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export interface JsonSchemaDefinition {
  $schema: string;
  $id: string;
  title: string;
  schema_version: string;
  version: string;
  type: "object";
  required: string[];
  properties: Record<string, JsonSchemaProperty>;
  additionalProperties?: boolean;
}

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  entity: SchemaEntity;
  schema_version: string;
  valid: boolean;
  issues: SchemaValidationIssue[];
}

export interface SchemaCompatibilityResult {
  entity: SchemaEntity;
  from_version: string;
  to_version: string;
  compatible: boolean;
  breaking_changes: string[];
  notes: string[];
}

const ISO_DATE = { type: "string", description: "ISO-8601 timestamp" } as const;

function def(
  entity: SchemaEntity,
  schemaVersion: string,
  title: string,
  required: string[],
  properties: Record<string, JsonSchemaProperty>,
): JsonSchemaDefinition {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://hasna.dev/schemas/todos/${entity}/${schemaVersion}.json`,
    title,
    schema_version: schemaVersion,
    version: SCHEMA_SEMVER,
    type: "object",
    required,
    properties,
    additionalProperties: true,
  };
}

export const JSON_SCHEMAS: Record<SchemaEntity, JsonSchemaDefinition> = {
  task: def("task", "todos.task.v1", "Task", ["schema_version", "id", "title", "status", "priority", "version", "created_at", "updated_at"], {
    schema_version: { type: "string", enum: ["todos.task.v1"] },
    id: { type: "string" },
    short_id: { type: ["string", "null"] },
    project_id: { type: ["string", "null"] },
    title: { type: "string" },
    description: { type: ["string", "null"] },
    status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "cancelled"] },
    priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
    tags: { type: "array", items: { type: "string" } },
    metadata: { type: "object", additionalProperties: true },
    version: { type: "integer" },
    created_at: ISO_DATE,
    updated_at: ISO_DATE,
  }),

  project: def("project", "todos.project.v1", "Project", ["schema_version", "id", "name", "path", "created_at", "updated_at"], {
    schema_version: { type: "string", enum: ["todos.project.v1"] },
    id: { type: "string" },
    name: { type: "string" },
    path: { type: "string" },
    description: { type: ["string", "null"] },
    task_prefix: { type: ["string", "null"] },
    task_counter: { type: "integer" },
    created_at: ISO_DATE,
    updated_at: ISO_DATE,
  }),

  plan: def("plan", "todos.plan.v1", "Plan", ["schema_version", "id", "name", "status", "created_at", "updated_at"], {
    schema_version: { type: "string", enum: ["todos.plan.v1"] },
    id: { type: "string" },
    project_id: { type: ["string", "null"] },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    status: { type: "string", enum: ["active", "completed", "archived"] },
    created_at: ISO_DATE,
    updated_at: ISO_DATE,
  }),

  agent_run: def("agent_run", "todos.agent_run.v1", "AgentRun", ["schema_version", "id", "adapter", "status", "created_at", "updated_at"], {
    schema_version: { type: "string", enum: ["todos.agent_run.v1"] },
    id: { type: "string" },
    task_id: { type: ["string", "null"] },
    plan_id: { type: ["string", "null"] },
    agent_id: { type: ["string", "null"] },
    adapter: { type: "string" },
    status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
    evidence: { type: "object", additionalProperties: true },
    retry_count: { type: "integer" },
    max_retries: { type: "integer" },
    created_at: ISO_DATE,
    updated_at: ISO_DATE,
  }),

  run_record: def("run_record", "todos.run_record.v1", "RunRecord", ["schema_version", "id", "status", "started_at", "created_at", "updated_at"], {
    schema_version: { type: "string", enum: ["todos.run_record.v1"] },
    id: { type: "string" },
    agent_run_id: { type: ["string", "null"] },
    agent_id: { type: ["string", "null"] },
    objective: { type: ["string", "null"] },
    status: { type: "string", enum: ["active", "completed", "failed", "archived"] },
    commands: { type: "array", items: { type: "object", additionalProperties: true } },
    files_touched: { type: "array", items: { type: "string" } },
    verification_results: { type: "array", items: { type: "object", additionalProperties: true } },
    artifact_ids: { type: "array", items: { type: "string" } },
    started_at: ISO_DATE,
    created_at: ISO_DATE,
    updated_at: ISO_DATE,
  }),

  verification_evidence: def(
    "verification_evidence",
    "todos.verification.v1",
    "VerificationEvidence",
    ["schema_version", "id", "provider_name", "provider_type", "status", "summary", "started_at", "created_at"],
    {
      schema_version: { type: "string", enum: ["todos.verification.v1"] },
      id: { type: "string" },
      task_id: { type: ["string", "null"] },
      provider_name: { type: "string" },
      provider_type: { type: "string", enum: ["shell", "testbox", "ci_snapshot", "manual"] },
      status: { type: "string", enum: ["passed", "failed", "skipped", "pending"] },
      summary: { type: "string" },
      evidence: { type: "object", additionalProperties: true },
      artifact_id: { type: ["string", "null"] },
      started_at: ISO_DATE,
      completed_at: { type: ["string", "null"] },
      created_at: ISO_DATE,
    },
  ),

  handoff: def("handoff", "todos.handoff.v1", "Handoff", ["schema_version", "id", "summary", "created_at"], {
    schema_version: { type: "string", enum: ["todos.handoff.v1"] },
    id: { type: "string" },
    agent_id: { type: ["string", "null"] },
    project_id: { type: ["string", "null"] },
    summary: { type: "string" },
    completed: { type: "array", items: { type: "string" } },
    in_progress: { type: "array", items: { type: "string" } },
    blockers: { type: "array", items: { type: "string" } },
    next_steps: { type: "array", items: { type: "string" } },
    created_at: ISO_DATE,
  }),

  import_export_bundle: def(
    "import_export_bundle",
    "todos.bundle.v1",
    "ImportExportBundle",
    ["schema_version", "bundle_type", "exported_at"],
    {
      schema_version: { type: "string", enum: ["todos.bundle.v1", "todos.md.v1"] },
      bundle_type: { type: "string", enum: ["tasks", "todos_md", "replay", "full_export"] },
      exported_at: ISO_DATE,
      project_id: { type: ["string", "null"] },
      tasks: { type: "array", items: { type: "object", additionalProperties: true } },
      metadata: { type: "object", additionalProperties: true },
    },
  ),

  mcp_response: def("mcp_response", "todos.mcp_response.v1", "McpToolResponse", ["schema_version", "content"], {
    schema_version: { type: "string", enum: ["todos.mcp_response.v1"] },
    content: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "text"],
        properties: {
          type: { type: "string", enum: ["text"] },
          text: { type: "string" },
        },
      },
    },
    is_error: { type: "boolean" },
  }),

  tester_issue_report: def("tester_issue_report", "testers.issue_report.v1", "TesterIssueReport", ["schema_version", "title", "kind", "severity"], {
    schema_version: { type: "string", enum: ["testers.issue_report.v1"] },
    id: { type: "string" },
    fingerprint: { type: "string" },
    title: { type: "string" },
    summary: { type: ["string", "null"] },
    kind: { type: "string" },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    source: {
      type: "object",
      additionalProperties: true,
      properties: {
        tool: { type: "string" },
        run_id: { type: "string" },
        result_id: { type: "string" },
        scenario_id: { type: "string" },
        scenario_name: { type: "string" },
        project_id: { type: "string" },
        url: { type: "string" },
        page_url: { type: "string" },
        artifact_url: { type: "string" },
        screenshot_url: { type: "string" },
        commit: { type: "string" },
        branch: { type: "string" },
      },
    },
    target: {
      type: "object",
      additionalProperties: true,
      properties: {
        url: { type: "string" },
        route: { type: "string" },
        selector: { type: "string" },
        component: { type: "string" },
        browser: { type: "string" },
        viewport: { type: "string" },
      },
    },
    failure: {
      type: "object",
      additionalProperties: true,
      properties: {
        message: { type: "string" },
        expected: { type: "string" },
        actual: { type: "string" },
        stack: { type: "string" },
        reasoning: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
      },
    },
    evidence: { type: "object", additionalProperties: true },
    labels: { type: "array", items: { type: "string" } },
    metadata: { type: "object", additionalProperties: true },
    occurred_at: ISO_DATE,
  }),
};

/** Contract fixtures used by compatibility tests. */
export const SCHEMA_CONTRACT_FIXTURES: Record<SchemaEntity, Record<string, unknown>> = {
  task: {
    schema_version: "todos.task.v1",
    id: "abc12345-0000-4000-8000-000000000001",
    title: "Example task",
    status: "pending",
    priority: "medium",
    version: 1,
    tags: [],
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  project: {
    schema_version: "todos.project.v1",
    id: "proj-001",
    name: "todos-example",
    path: "/tmp/todos-example",
    task_counter: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  plan: {
    schema_version: "todos.plan.v1",
    id: "plan-001",
    name: "Release v1",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  agent_run: {
    schema_version: "todos.agent_run.v1",
    id: "run-001",
    adapter: "codex",
    status: "queued",
    retry_count: 0,
    max_retries: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  run_record: {
    schema_version: "todos.run_record.v1",
    id: "rec-001",
    status: "active",
    commands: [],
    files_touched: [],
    verification_results: [],
    artifact_ids: [],
    started_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  verification_evidence: {
    schema_version: "todos.verification.v1",
    id: "ver-001",
    provider_name: "shell",
    provider_type: "shell",
    status: "passed",
    summary: "bun test passed",
    evidence: {},
    started_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  handoff: {
    schema_version: "todos.handoff.v1",
    id: "ho-001",
    summary: "Session handoff",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  import_export_bundle: {
    schema_version: "todos.bundle.v1",
    bundle_type: "tasks",
    exported_at: "2026-01-01T00:00:00.000Z",
    tasks: [],
  },
  mcp_response: {
    schema_version: "todos.mcp_response.v1",
    content: [{ type: "text", text: "ok" }],
  },
  tester_issue_report: {
    schema_version: "testers.issue_report.v1",
    title: "Checkout button fails",
    kind: "assertion_failure",
    severity: "high",
    fingerprint: "checkout-button-1234",
    source: {
      tool: "testers",
      run_id: "run-001",
      scenario_id: "scenario-001",
      url: "https://preview.example.com/checkout",
    },
    failure: {
      message: "Expected checkout button to become enabled",
      steps: ["Open checkout", "Fill required fields"],
    },
    labels: ["checkout", "regression"],
  },
};

function typeMatches(value: unknown, expected: string | string[]): boolean {
  const types = Array.isArray(expected) ? expected : [expected];
  if (types.includes("null") && value === null) return true;
  if (value === null) return types.includes("null");
  if (types.includes("integer") && typeof value === "number" && Number.isInteger(value)) return true;
  if (types.includes("number") && typeof value === "number") return true;
  const jsType = Array.isArray(value) ? "array" : typeof value;
  return types.includes(jsType);
}

function validateProperty(
  value: unknown,
  prop: JsonSchemaProperty,
  path: string,
  issues: SchemaValidationIssue[],
): void {
  if (value === undefined || value === null) {
    if (prop.type && !typeMatches(value, prop.type)) {
      issues.push({ path, message: `Expected type ${JSON.stringify(prop.type)}` });
    }
    return;
  }

  if (prop.enum && !prop.enum.includes(value as string)) {
    issues.push({ path, message: `Must be one of: ${prop.enum.join(", ")}` });
  }

  if (prop.type && !typeMatches(value, prop.type)) {
    issues.push({ path, message: `Expected type ${JSON.stringify(prop.type)}, got ${typeof value}` });
    return;
  }

  if (prop.type === "array" && Array.isArray(value) && prop.items) {
    for (let i = 0; i < value.length; i++) {
      validateProperty(value[i], prop.items, `${path}[${i}]`, issues);
    }
  }

  if (prop.type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (prop.required) {
      for (const key of prop.required) {
        if (!(key in obj)) issues.push({ path: `${path}.${key}`, message: "Required property missing" });
      }
    }
    if (prop.properties) {
      for (const [key, sub] of Object.entries(prop.properties)) {
        if (key in obj) validateProperty(obj[key], sub, `${path}.${key}`, issues);
      }
    }
  }
}

export function validateSchemaPayload(
  entity: SchemaEntity,
  payload: unknown,
): SchemaValidationResult {
  const schema = JSON_SCHEMAS[entity];
  const issues: SchemaValidationIssue[] = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      entity,
      schema_version: schema.schema_version,
      valid: false,
      issues: [{ path: "$", message: "Payload must be an object" }],
    };
  }

  const obj = payload as Record<string, unknown>;

  for (const key of schema.required) {
    if (!(key in obj)) issues.push({ path: key, message: "Required field missing" });
  }

  if ("schema_version" in obj && obj.schema_version !== schema.schema_version) {
    issues.push({
      path: "schema_version",
      message: `Expected ${schema.schema_version}, got ${String(obj.schema_version)}`,
    });
  }

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (key in obj) validateProperty(obj[key], prop, key, issues);
  }

  return {
    entity,
    schema_version: schema.schema_version,
    valid: issues.length === 0,
    issues,
  };
}

export function validateAllContractFixtures(): SchemaValidationIssue[] {
  const all: SchemaValidationIssue[] = [];
  for (const entity of SCHEMA_ENTITIES) {
    const result = validateSchemaPayload(entity, SCHEMA_CONTRACT_FIXTURES[entity]);
    if (!result.valid) {
      all.push(...result.issues.map((i) => ({ path: `${entity}.${i.path}`, message: i.message })));
    }
  }
  return all;
}

export function checkSchemaCompatibility(
  entity: SchemaEntity,
  fromVersion: string,
  toVersion: string,
): SchemaCompatibilityResult {
  const schema = JSON_SCHEMAS[entity];
  const breaking: string[] = [];
  const notes: string[] = [];

  if (fromVersion === toVersion) {
    return { entity, from_version: fromVersion, to_version: toVersion, compatible: true, breaking_changes: [], notes: ["Same version"] };
  }

  if (fromVersion !== schema.schema_version || toVersion !== schema.schema_version) {
    notes.push("Cross-version compatibility requires migration mapping (not yet published for this entity)");
  }

  // v1 policy: additive changes only within same major schema id prefix
  const fromMajor = fromVersion.match(/\.v(\d+)$/)?.[1] ?? "0";
  const toMajor = toVersion.match(/\.v(\d+)$/)?.[1] ?? "0";
  if (fromMajor !== toMajor) {
    breaking.push(`Schema major version change: v${fromMajor} → v${toMajor}`);
  }

  return {
    entity,
    from_version: fromVersion,
    to_version: toVersion,
    compatible: breaking.length === 0,
    breaking_changes: breaking,
    notes: [
      ...notes,
      "Semver: patch = docs/fixtures, minor = additive optional fields, major = required field or enum changes",
    ],
  };
}

export function listJsonSchemas(): Array<{ entity: SchemaEntity; schema_version: string; $id: string; title: string }> {
  return SCHEMA_ENTITIES.map((entity) => ({
    entity,
    schema_version: JSON_SCHEMAS[entity].schema_version,
    $id: JSON_SCHEMAS[entity].$id,
    title: JSON_SCHEMAS[entity].title,
  }));
}

export function getJsonSchema(entity: SchemaEntity): JsonSchemaDefinition {
  return JSON_SCHEMAS[entity];
}

export function getSchemaSemverGuidance(): string {
  return `# @hasna/todos JSON Schema Semver

Catalog version: \`${JSON_SCHEMA_CATALOG_VERSION}\` · Semver: \`${SCHEMA_SEMVER}\`

## Versioning rules

- **schema_version** (e.g. \`todos.task.v1\`) — contract namespace; bump when required fields or enums change.
- **Catalog semver** (\`${SCHEMA_SEMVER}\`) — registry release version for docs/fixtures/export bundle.

| Change type | Bump | Example |
|-------------|------|---------|
| New optional field | minor | Add \`priority_score\` to task export |
| New enum value | minor | Add task status \`approved\` with migration |
| Remove/rename required field | major | \`todos.task.v1\` → \`todos.task.v2\` |
| Fixture/docs only | patch | Clarify ISO date format |

## Consumer guidance

1. Read \`schema_version\` on every payload before parsing.
2. Reject unknown major versions; accept unknown optional fields.
3. Use \`validate_schema_payload\` MCP tool or \`todos schema validate\` CLI for local checks.
4. Import/export bundles must declare \`bundle_type\` and \`exported_at\`.

## Entities

${SCHEMA_ENTITIES.map((e) => `- **${e}**: \`${JSON_SCHEMAS[e].schema_version}\``).join("\n")}
`;
}

export function exportSchemasToDirectory(dir: string): string[] {
  const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const entity of SCHEMA_ENTITIES) {
    const path = join(dir, `${entity}.${JSON_SCHEMAS[entity].schema_version.replace(/\./g, "-")}.json`);
    writeFileSync(path, JSON.stringify(JSON_SCHEMAS[entity], null, 2));
    written.push(path);
  }
  const catalogPath = join(dir, "catalog.json");
  writeFileSync(catalogPath, JSON.stringify({
    catalog_version: JSON_SCHEMA_CATALOG_VERSION,
    semver: SCHEMA_SEMVER,
    entities: listJsonSchemas(),
    exported_at: new Date().toISOString(),
  }, null, 2));
  written.push(catalogPath);
  return written;
}

/** Wrap a DB/API record with schema_version for export consumers. */
export function wrapWithSchemaVersion<T extends Record<string, unknown>>(
  entity: SchemaEntity,
  record: T,
): T & { schema_version: string } {
  return { schema_version: JSON_SCHEMAS[entity].schema_version, ...record };
}
