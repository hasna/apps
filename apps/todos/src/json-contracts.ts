import { getPackageVersion } from "./lib/package-version.js";

export type TodosJsonSurface = "cli" | "api" | "mcp" | "sdk";
export type TodosJsonStability = "stable" | "experimental";
export type TodosJsonFieldType = "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

export interface CreateJsonContractsManifestOptions {
  version?: string;
  generatedAt?: string;
}

export interface TodosJsonContractPackageSource {
  packageName: "@hasna/todos";
  repository: "hasna/todos";
  version: string;
}

export interface TodosJsonFieldContract {
  type: TodosJsonFieldType | readonly TodosJsonFieldType[];
  description: string;
  nullable?: boolean;
}

export interface TodosJsonObjectContract {
  id: string;
  name: string;
  description: string;
  surfaces: TodosJsonSurface[];
  stability: TodosJsonStability;
  required: Record<string, TodosJsonFieldContract>;
  optional: Record<string, TodosJsonFieldContract>;
  additionalProperties: true;
  evolution: {
    additionalFields: "allowed";
    removingRequiredFields: "breaking";
    changingRequiredFieldTypes: "breaking";
    nullableToNonNullable: "breaking";
  };
}

export interface TodosJsonContractsManifest {
  schemaVersion: 1;
  generatedAt: string;
  package: TodosJsonContractPackageSource;
  contracts: TodosJsonObjectContract[];
}

export interface JsonContractValidationIssue {
  field: string;
  expected: readonly TodosJsonFieldType[];
  actual: string;
}

export interface JsonContractValidationResult {
  ok: boolean;
  contractId: string;
  missingRequired: string[];
  typeMismatches: JsonContractValidationIssue[];
}

function source(version: string): TodosJsonContractPackageSource {
  return {
    packageName: "@hasna/todos",
    repository: "hasna/todos",
    version,
  };
}

function field(
  type: TodosJsonFieldContract["type"],
  description: string,
  nullable = false,
): TodosJsonFieldContract {
  return { type, description, nullable };
}

function contract(input: Omit<TodosJsonObjectContract, "additionalProperties" | "evolution">): TodosJsonObjectContract {
  return {
    ...input,
    additionalProperties: true,
    evolution: {
      additionalFields: "allowed",
      removingRequiredFields: "breaking",
      changingRequiredFieldTypes: "breaking",
      nullableToNonNullable: "breaking",
    },
  };
}

const idField = field("string", "Stable UUID or short identifier.");
const nullableIdField = field(["string", "null"], "Stable identifier when attached to another object.", true);
const isoDateField = field("string", "ISO-8601 timestamp string.");
const nullableIsoDateField = field(["string", "null"], "ISO-8601 timestamp string, or null when not set.", true);
const metadataField = field("object", "JSON object metadata. Unknown keys are extension data.");
const tagsField = field("array", "Array of string tags.");

export const TODOS_JSON_CONTRACTS: TodosJsonObjectContract[] = [
  contract({
    id: "task",
    name: "Task",
    description: "Canonical task object returned by CLI JSON, SDK, API summaries, and MCP task tools.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      short_id: nullableIdField,
      title: field("string", "Human-readable task title."),
      description: field(["string", "null"], "Optional task description.", true),
      status: field("string", "Task lifecycle status."),
      priority: field("string", "Task priority."),
      project_id: nullableIdField,
      plan_id: nullableIdField,
      task_list_id: nullableIdField,
      agent_id: nullableIdField,
      assigned_to: field(["string", "null"], "Assigned agent name or id.", true),
      tags: tagsField,
      metadata: metadataField,
      version: field("integer", "Optimistic locking version."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {
      locked_by: field(["string", "null"], "Agent currently holding the task lock.", true),
      locked_at: nullableIsoDateField,
      started_at: nullableIsoDateField,
      completed_at: nullableIsoDateField,
      due_at: nullableIsoDateField,
    },
  }),
  contract({
    id: "project",
    name: "Project",
    description: "Project object used to scope tasks to a local repository or workspace.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      name: field("string", "Project display name."),
      path: field("string", "Canonical project path."),
      description: field(["string", "null"], "Optional project description.", true),
      task_list_id: nullableIdField,
      task_prefix: field(["string", "null"], "Optional task prefix.", true),
      task_counter: field("integer", "Monotonic project task counter."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {
      sources: field("array", "Optional project source records."),
    },
  }),
  contract({
    id: "agent",
    name: "Agent",
    description: "Registered agent identity and coordination metadata.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      name: field("string", "Normalized agent name."),
      description: field(["string", "null"], "Optional agent description.", true),
      role: field(["string", "null"], "Agent role.", true),
      permissions: field("array", "Permission labels."),
      capabilities: field("array", "Capability labels."),
      status: field("string", "Agent lifecycle status."),
      created_at: isoDateField,
      last_seen_at: isoDateField,
    },
    optional: {
      session_id: nullableIdField,
      working_dir: field(["string", "null"], "Current working directory.", true),
      active_project_id: nullableIdField,
    },
  }),
  contract({
    id: "template",
    name: "Task Template",
    description: "Task template object used to create repeatable task plans.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      name: field("string", "Template name."),
      title_pattern: field("string", "Task title pattern."),
      description: field(["string", "null"], "Optional template description.", true),
      priority: field("string", "Default task priority."),
      tags: tagsField,
      variables: field("array", "Template variable definitions."),
      version: field("integer", "Template version."),
      project_id: nullableIdField,
      plan_id: nullableIdField,
      metadata: metadataField,
      created_at: isoDateField,
    },
    optional: {
      tasks: field("array", "Expanded template task steps."),
    },
  }),
  contract({
    id: "task_list",
    name: "Task List",
    description: "Named task list, optionally scoped to a project.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      project_id: nullableIdField,
      slug: field("string", "Stable URL/CLI-safe list slug."),
      name: field("string", "Task list display name."),
      description: field(["string", "null"], "Optional list description.", true),
      metadata: metadataField,
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "comment",
    name: "Task Comment",
    description: "Comment, progress update, or note attached to a task.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      task_id: idField,
      agent_id: nullableIdField,
      session_id: nullableIdField,
      content: field("string", "Comment body."),
      type: field("string", "Comment type: comment, progress, or note."),
      progress_pct: field(["integer", "number", "null"], "Progress percentage for progress entries.", true),
      created_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "checkpoint",
    name: "Task Run Checkpoint",
    description: "Task runner checkpoint for a named execution step.",
    surfaces: ["api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      task_id: idField,
      agent_id: nullableIdField,
      step: field("string", "Runner step name."),
      status: field("string", "Checkpoint execution status."),
      data: metadataField,
      error: field(["string", "null"], "Step error message when failed.", true),
      attempt: field("integer", "Current attempt number."),
      max_attempts: field("integer", "Maximum allowed attempts."),
      started_at: nullableIsoDateField,
      completed_at: nullableIsoDateField,
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "dispatch",
    name: "Dispatch",
    description: "Queued or completed tmux dispatch/run request.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      title: field(["string", "null"], "Optional dispatch title.", true),
      target_window: field("string", "tmux target window."),
      task_ids: field("array", "Task IDs included in the dispatch."),
      task_list_id: nullableIdField,
      message: field(["string", "null"], "Preformatted message, or null when generated from tasks.", true),
      delay_ms: field(["integer", "null"], "Delay between send and Enter.", true),
      scheduled_at: nullableIsoDateField,
      status: field("string", "Dispatch status."),
      error: field(["string", "null"], "Dispatch error when failed.", true),
      created_at: isoDateField,
      sent_at: nullableIsoDateField,
    },
    optional: {},
  }),
  contract({
    id: "audit_history",
    name: "Audit History",
    description: "Audit log entry for a task mutation.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      task_id: idField,
      action: field("string", "Mutation action name."),
      field: field(["string", "null"], "Changed field name.", true),
      old_value: field(["string", "null"], "Previous value serialized as a string.", true),
      new_value: field(["string", "null"], "New value serialized as a string.", true),
      agent_id: nullableIdField,
      created_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "local_activity_timeline_entry",
    name: "Local Activity Timeline Entry",
    description: "Redacted local timeline entry derived from comments, task audit history, and run evidence.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      source: field("string", "Timeline source table or evidence family."),
      event_type: field("string", "Source-specific event type."),
      entity_type: field("string", "Primary entity type for the entry: task or run."),
      entity_id: idField,
      task_id: idField,
      project_id: nullableIdField,
      plan_id: nullableIdField,
      run_id: nullableIdField,
      agent_id: nullableIdField,
      created_at: isoDateField,
      title: field("string", "Short redacted title for the event."),
      message: field(["string", "null"], "Redacted event body or summary.", true),
      metadata: metadataField,
    },
    optional: {},
  }),
  contract({
    id: "status_summary",
    name: "Status Summary",
    description: "Queue status counts and lightweight next/active work summary.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      pending: field("integer", "Pending task count."),
      in_progress: field("integer", "In-progress task count."),
      completed: field("integer", "Completed task count."),
      total: field("integer", "Total task count for the selected scope."),
      active_work: field("array", "Lightweight active work items."),
      next_task: field(["object", "null"], "Next available task, or null when none is available.", true),
      stale_count: field("integer", "Count of stale in-progress tasks."),
      overdue_recurring: field("integer", "Count of overdue recurring tasks."),
    },
    optional: {
      blocked_tasks: field("array", "Optional blocked task explanation list."),
    },
  }),
  contract({
    id: "context_pack",
    name: "Agent Context Pack",
    description: "Deterministic local task context bundle for agent run-start prompts.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schema_version: field("integer", "Context pack schema version."),
      profile: field("string", "Target agent profile."),
      as_of: isoDateField,
      agent_id: field(["string", "null"], "Agent receiving the context pack.", true),
      task: field("object", "Selected task state."),
      project: field(["object", "null"], "Selected project state.", true),
      plan: field(["object", "null"], "Selected plan state.", true),
      acceptance_criteria: field("array", "Acceptance criteria extracted from task metadata."),
      dependencies: field("object", "Upstream and downstream dependency summaries."),
      comments: field("object", "Recent redacted task comments."),
      relevant_files: field("array", "Relevant files from task, commit, and run evidence."),
      traceability: field("object", "Local commits, refs, and verification evidence."),
      runs: field("object", "Selected local run ledger summaries."),
      prompt_bundle: field("object", "Profile-specific prompt instructions."),
      limits: field("object", "Limits used to build the pack."),
      warnings: field("array", "Omission, staleness, and data-quality warnings."),
    },
    optional: {},
  }),
  contract({
    id: "local_event_hook",
    name: "Local Event Hook",
    description: "Config-backed local-only event hook used by CLI and MCP automation triggers.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      name: field("string", "Stable hook name."),
      enabled: field("boolean", "Whether the hook is active."),
      events: field("array", "Event names this hook subscribes to, or * for all events."),
      target: field("string", "Local delivery target: stdout, file, socket, or script."),
    },
    optional: {
      file_path: field("string", "JSONL output path for file targets."),
      socket_path: field("string", "Unix domain socket path for socket targets."),
      command: field("string", "Local command for script targets."),
      cwd: field("string", "Working directory for script targets."),
      sandbox: field("string", "Runner sandbox profile used before script execution."),
      env: field("object", "Script environment additions."),
      retry: field("object", "Delivery retry and backoff settings."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
  }),
  contract({
    id: "local_event_hook_delivery",
    name: "Local Event Hook Delivery",
    description: "Delivery result for a local-only event hook test or dispatch.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      hook: field("string", "Hook name."),
      event_id: field("string", "Generated event envelope ID."),
      event_type: field("string", "Delivered event type."),
      target: field("string", "Delivery target."),
      status: field("string", "Delivery status: delivered, failed, or skipped."),
      attempts: field("integer", "Number of attempts used."),
      integrity: field("object", "SHA-256 integrity metadata for the redacted event envelope."),
    },
    optional: {
      output_summary: field("string", "Redacted output summary for stdout or script targets."),
      error: field("string", "Redacted delivery failure message."),
    },
  }),
  contract({
    id: "local_encryption_profile",
    name: "Local Encryption Profile",
    description: "Config-backed local encryption profile. Stores algorithm metadata and key environment variable name, never key material.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      name: field("string", "Stable profile name."),
      algorithm: field("string", "Encryption algorithm. Currently aes-256-gcm."),
      kdf: field("string", "Key derivation function. Currently scrypt."),
      key_env: field("string", "Environment variable that supplies key material."),
      salt: field("string", "Nonsecret base64 KDF salt."),
    },
    optional: {
      description: field("string", "Optional profile description."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
  }),
  contract({
    id: "local_encryption_envelope",
    name: "Local Encryption Envelope",
    description: "Encrypted local value envelope for sensitive metadata, evidence snippets, and MCP/CLI field operations.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schemaVersion: field("integer", "Encryption envelope schema version."),
      kind: field("string", "Envelope kind identifier."),
      encryptedAt: isoDateField,
      profile: field("string", "Profile used to encrypt the value."),
      key_env: field("string", "Environment variable required to decrypt."),
      algorithm: field("string", "Encryption algorithm."),
      kdf: field("string", "Key derivation function."),
      salt: field("string", "Nonsecret KDF salt."),
      iv: field("string", "Base64 initialization vector."),
      auth_tag: field("string", "Base64 GCM authentication tag."),
      ciphertext: field("string", "Base64 ciphertext."),
      plaintext_sha256: field("string", "Plaintext checksum verified after decryption."),
    },
    optional: {},
  }),
  contract({
    id: "encrypted_local_bridge_bundle",
    name: "Encrypted Local Bridge Bundle",
    description: "Encrypted bridge export wrapper for moving local tasks, runs, evidence, artifacts, and metadata without plaintext JSON exposure.",
    surfaces: ["cli", "sdk"],
    stability: "stable",
    required: {
      schemaVersion: field("integer", "Encryption wrapper schema version."),
      kind: field("string", "Encrypted bridge bundle kind identifier."),
      encryptedAt: isoDateField,
      package: field("object", "Package source metadata."),
      plaintext: field("object", "Plaintext bundle kind, schema version, and checksum."),
      encryption: field("object", "Encryption envelope metadata and ciphertext."),
      warnings: field("array", "Operator warnings for key handling and decrypt/import."),
    },
    optional: {},
  }),
  contract({
    id: "structured_error",
    name: "Structured Error",
    description: "Structured MCP/SDK-style error response with a stable machine code.",
    surfaces: ["mcp", "sdk"],
    stability: "stable",
    required: {
      code: field("string", "Stable machine-readable error code."),
      message: field("string", "Human-readable error message."),
    },
    optional: {
      suggestion: field("string", "Optional recovery suggestion."),
      retryAfterSeconds: field("integer", "Optional retry delay for cooldown errors."),
    },
  }),
  contract({
    id: "api_error",
    name: "API Error",
    description: "HTTP API and CLI JSON error object for simple error responses.",
    surfaces: ["cli", "api"],
    stability: "stable",
    required: {
      error: field("string", "Human-readable error message."),
    },
    optional: {
      code: field("string", "Optional machine-readable error code."),
      conflict: field("boolean", "Optional conflict flag for registration errors."),
      suggestions: field("array", "Optional recovery suggestions."),
      retry_after: field("integer", "Optional retry delay for rate-limited responses."),
    },
  }),
  contract({
    id: "local_bridge_bundle",
    name: "Local Bridge Bundle",
    description: "Versioned local import/export bundle for moving tasks, projects, plans, runs, and evidence metadata between local stores.",
    surfaces: ["cli", "sdk"],
    stability: "stable",
    required: {
      schemaVersion: field("integer", "Bridge bundle schema version."),
      kind: field("string", "Bundle kind identifier."),
      exportedAt: isoDateField,
      package: field("object", "Package source metadata."),
      source: field("object", "Local source scope for the export."),
      data: field("object", "Exported local records grouped by object type."),
      stats: field("object", "Record counts by object type."),
    },
    optional: {},
  }),
  contract({
    id: "local_bridge_import_result",
    name: "Local Bridge Import Result",
    description: "Dry-run or applied import report with inserted counts, skipped counts, conflicts, and validation issues.",
    surfaces: ["cli", "sdk"],
    stability: "stable",
    required: {
      ok: field("boolean", "Whether the import bundle is valid and has no missing-dependency conflicts."),
      dry_run: field("boolean", "True when no local records were written."),
      inserted: field("object", "Records that would be or were inserted, grouped by object type."),
      skipped: field("object", "Records skipped because they already exist or have missing dependencies."),
      conflicts: field("array", "Conflict records with table, id, and reason."),
      issues: field("array", "Validation issue strings."),
    },
    optional: {},
  }),
  contract({
    id: "cli_mcp_parity_manifest",
    name: "CLI/MCP Parity Manifest",
    description: "Versioned local manifest mapping supported CLI domains to MCP tools, JSON contracts, and documented intentional gaps.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schemaVersion: field("integer", "Parity manifest schema version."),
      generatedAt: isoDateField,
      package: field("object", "Package source metadata."),
      localOnly: field("boolean", "True when the manifest describes local-only package behavior."),
      noNetworkRequired: field("boolean", "True when manifest generation does not require network access."),
      parity: field("array", "Domain-level CLI/MCP parity entries."),
    },
    optional: {},
  }),
  contract({
    id: "project_bootstrap_result",
    name: "Project Bootstrap Result",
    description: "Local project bootstrap and workspace discovery output for CLI, MCP, and SDK callers.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      dryRun: field("boolean", "True when no local project state was written."),
      discovery: field("object", "Detected local workspace roots, package metadata, and monorepo markers."),
      project: field(["object", "null"], "Registered project, or null during dry-run.", true),
      taskList: field(["object", "null"], "Default task list, or null during dry-run.", true),
      sources: field("array", "Project source records after bootstrap."),
      created: field("object", "Flags and source types created by this bootstrap run."),
    },
    optional: {},
  }),
];

function expectedTypes(contract: TodosJsonFieldContract): readonly TodosJsonFieldType[] {
  const types = Array.isArray(contract.type) ? [...contract.type] : [contract.type];
  if (contract.nullable && !types.includes("null")) return [...types, "null"];
  return types;
}

function actualType(value: unknown): TodosJsonFieldType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (typeof value === "object") return "object";
  return "string";
}

function matchesType(value: unknown, expected: readonly TodosJsonFieldType[]): boolean {
  const actual = actualType(value);
  if (expected.includes(actual)) return true;
  return actual === "integer" && expected.includes("number");
}

export function getJsonContract(contractId: string): TodosJsonObjectContract | null {
  return TODOS_JSON_CONTRACTS.find((contractItem) => contractItem.id === contractId) ?? null;
}

export function validateJsonContract(contractId: string, value: unknown): JsonContractValidationResult {
  const contractItem = getJsonContract(contractId);
  if (!contractItem) {
    throw new Error(`Unknown JSON contract: ${contractId}`);
  }

  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const missingRequired: string[] = [];
  const typeMismatches: JsonContractValidationIssue[] = [];

  for (const [fieldName, fieldContract] of Object.entries(contractItem.required)) {
    if (!(fieldName in record)) {
      missingRequired.push(fieldName);
      continue;
    }
    const expected = expectedTypes(fieldContract);
    const valueType = actualType(record[fieldName]);
    if (!matchesType(record[fieldName], expected)) {
      typeMismatches.push({ field: fieldName, expected, actual: valueType });
    }
  }

  return {
    ok: missingRequired.length === 0 && typeMismatches.length === 0,
    contractId,
    missingRequired,
    typeMismatches,
  };
}

export function createJsonContractsManifest(
  options: CreateJsonContractsManifestOptions = {},
): TodosJsonContractsManifest {
  const version = options.version ?? getPackageVersion(import.meta.url);
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    package: source(version),
    contracts: TODOS_JSON_CONTRACTS,
  };
}

export const TODOS_JSON_CONTRACTS_MANIFEST = createJsonContractsManifest({
  generatedAt: "1970-01-01T00:00:00.000Z",
});
