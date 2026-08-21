// @bun
// src/todos/common.ts
import { createHash } from "crypto";
import * as z from "zod/v4";
var TODOS_CONTRACT_NAMESPACE = "hasna.todos";
var TODOS_CONTRACT_VERSION = "1.0.0";
var TODOS_MANIFEST_VERSION = "1";
var TODOS_TRANSFER_VERSION = "1";
var TodosAudienceSchema = z.enum(["customer", "tenant_admin"]);
var TodosTimestampSchema = z.iso.datetime({ offset: true });
var TodosDateSchema = z.iso.date();
var TodosEntityIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosOwnerIdSchema = z.string().min(2).max(128).regex(/^[a-z][a-z0-9.-]*$/);
var TodosSlugSchema = z.string().min(1).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var TodosRequestIdSchema = z.string().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosIdempotencyKeySchema = z.string().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosSha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
var TodosCursorSchema = z.string().min(1).max(512);
var TodosRelativePathSchema = z.string().min(1).max(1024).superRefine((value, ctx) => {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || value.split("/").some((segment) => segment === "..")) {
    ctx.addIssue({
      code: "custom",
      message: "Paths must be relative and must not traverse parent directories"
    });
  }
});
var TodosPortableScalarSchema = z.union([
  z.string().max(4096),
  z.number().finite(),
  z.boolean(),
  z.null()
]);
var TodosOwnerQualifiedRefSchema = z.strictObject({
  owner: TodosOwnerIdSchema,
  kind: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  id: TodosEntityIdSchema,
  digest: TodosSha256DigestSchema
});
var TodosContentRefSchema = z.strictObject({
  algorithm: z.literal("sha256"),
  digest: TodosSha256DigestSchema,
  mediaType: z.string().min(1).max(160),
  byteLength: z.number().int().nonnegative()
});
var TodosPageRequestSchema = z.strictObject({
  cursor: TodosCursorSchema.nullable(),
  limit: z.number().int().positive().max(500)
});
var TodosResponseMetaSchema = z.strictObject({
  requestId: TodosRequestIdSchema,
  authorityId: TodosOwnerIdSchema,
  contractVersion: z.literal(TODOS_CONTRACT_VERSION),
  manifestVersion: z.literal(TODOS_MANIFEST_VERSION)
});
function canonicalizeTodosValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeTodosValue);
  }
  if (value && typeof value === "object") {
    const record = value;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalizeTodosValue(record[key])]));
  }
  return value;
}
function stableTodosJson(value) {
  return JSON.stringify(canonicalizeTodosValue(value));
}
function sha256TodosValue(value) {
  return createHash("sha256").update(stableTodosJson(value), "utf8").digest("hex");
}
function sha256TodosText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function uniqueSortedTodosStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function sortTodosRecords(records) {
  return [...records].sort((left, right) => stableTodosJson(left).localeCompare(stableTodosJson(right)));
}
// src/todos/errors.ts
import * as z2 from "zod/v4";
var TODOS_ERROR_CODES = [
  "TODOS_INVALID_INPUT",
  "TODOS_AUTHENTICATION_FAILED",
  "TODOS_SCOPE_REQUIRED",
  "TODOS_TENANT_MISMATCH",
  "TODOS_ACCESS_DENIED",
  "TODOS_NOT_FOUND",
  "TODOS_AMBIGUOUS_REFERENCE",
  "TODOS_VERSION_CONFLICT",
  "TODOS_RESOURCE_CONFLICT",
  "TODOS_LOCK_CONFLICT",
  "TODOS_PRECONDITION_FAILED",
  "TODOS_APPROVAL_REQUIRED",
  "TODOS_CAPABILITY_REQUIRED",
  "TODOS_OPERATION_UNSUPPORTED",
  "TODOS_IDEMPOTENCY_REQUIRED",
  "TODOS_IDEMPOTENCY_CONFLICT",
  "TODOS_RATE_LIMITED",
  "TODOS_QUOTA_EXCEEDED",
  "TODOS_UPGRADE_REQUIRED",
  "TODOS_AUTHORITY_MISMATCH",
  "TODOS_AUTHORITY_UNAVAILABLE",
  "TODOS_INTERNAL",
  "TODOS_TRANSFER_INVALID",
  "TODOS_TRANSFER_CHECKSUM_MISMATCH",
  "TODOS_TRANSFER_REFERENCE_MISSING",
  "TODOS_PROJECTION_PREDECESSOR_CONFLICT"
];
var TodosErrorCodeSchema = z2.enum(TODOS_ERROR_CODES);
var TodosErrorDetailSchema = z2.strictObject({
  field: z2.string().min(1).max(256).nullable(),
  reason: z2.string().min(1).max(1024),
  expected: TodosPortableScalarSchema.optional(),
  actual: TodosPortableScalarSchema.optional()
});
var TodosErrorSchema = z2.strictObject({
  code: TodosErrorCodeSchema,
  message: z2.string().min(1).max(2048),
  retryable: z2.boolean(),
  details: z2.array(TodosErrorDetailSchema).max(100)
});
var TodosTransportMetaSchema = z2.strictObject({
  requestId: TodosRequestIdSchema,
  httpStatus: z2.number().int().min(100).max(599).nullable(),
  retryAfterSeconds: z2.number().int().nonnegative().nullable()
});
var TodosErrorEnvelopeSchema = z2.strictObject({
  ok: z2.literal(false),
  error: TodosErrorSchema,
  transport: TodosTransportMetaSchema
});
var RETRYABLE_ERRORS = new Set([
  "TODOS_LOCK_CONFLICT",
  "TODOS_RATE_LIMITED",
  "TODOS_AUTHORITY_UNAVAILABLE",
  "TODOS_INTERNAL"
]);
function createTodosError(code, message, options = {}) {
  return TodosErrorSchema.parse({
    code,
    message,
    retryable: options.retryable ?? RETRYABLE_ERRORS.has(code),
    details: options.details ?? []
  });
}
var ERROR_STATUS = {
  TODOS_INVALID_INPUT: 400,
  TODOS_AUTHENTICATION_FAILED: 401,
  TODOS_SCOPE_REQUIRED: 403,
  TODOS_TENANT_MISMATCH: 403,
  TODOS_ACCESS_DENIED: 403,
  TODOS_NOT_FOUND: 404,
  TODOS_AMBIGUOUS_REFERENCE: 409,
  TODOS_VERSION_CONFLICT: 409,
  TODOS_RESOURCE_CONFLICT: 409,
  TODOS_LOCK_CONFLICT: 409,
  TODOS_PRECONDITION_FAILED: 412,
  TODOS_APPROVAL_REQUIRED: 403,
  TODOS_CAPABILITY_REQUIRED: 403,
  TODOS_OPERATION_UNSUPPORTED: 405,
  TODOS_IDEMPOTENCY_REQUIRED: 400,
  TODOS_IDEMPOTENCY_CONFLICT: 409,
  TODOS_RATE_LIMITED: 429,
  TODOS_QUOTA_EXCEEDED: 429,
  TODOS_UPGRADE_REQUIRED: 426,
  TODOS_AUTHORITY_MISMATCH: 409,
  TODOS_AUTHORITY_UNAVAILABLE: 503,
  TODOS_INTERNAL: 500,
  TODOS_TRANSFER_INVALID: 422,
  TODOS_TRANSFER_CHECKSUM_MISMATCH: 422,
  TODOS_TRANSFER_REFERENCE_MISSING: 422,
  TODOS_PROJECTION_PREDECESSOR_CONFLICT: 409
};
var TODOS_ERROR_CATALOG = Object.freeze(TODOS_ERROR_CODES.map((code) => ({
  code,
  transportStatus: ERROR_STATUS[code],
  retryable: RETRYABLE_ERRORS.has(code)
})));
function getTodosErrorCatalogEntry(code) {
  const entry = TODOS_ERROR_CATALOG.find((candidate) => candidate.code === code);
  if (!entry) {
    throw new Error(`Unknown Todos error code: ${code}`);
  }
  return entry;
}
function createTodosResultSchema(dataSchema) {
  return z2.discriminatedUnion("ok", [
    z2.strictObject({
      ok: z2.literal(true),
      data: dataSchema,
      requestId: TodosRequestIdSchema
    }),
    z2.strictObject({
      ok: z2.literal(false),
      error: TodosErrorSchema,
      requestId: TodosRequestIdSchema
    })
  ]);
}
function createTodosPageSchema(itemSchema) {
  return z2.strictObject({
    items: z2.array(itemSchema),
    count: z2.number().int().nonnegative(),
    nextCursor: z2.string().min(1).max(512).nullable()
  }).superRefine((value, ctx) => {
    if (value.count !== value.items.length) {
      ctx.addIssue({
        code: "custom",
        message: "Page count must equal the number of returned items",
        path: ["count"]
      });
    }
  });
}
var TodosMutationReceiptSchema = z2.strictObject({
  operationId: z2.string().regex(/^todos\.[a-z0-9_]+(?:\.[a-z0-9_]+)+$/),
  resourceId: z2.string().min(1).max(160),
  changed: z2.boolean(),
  replayed: z2.boolean(),
  version: z2.number().int().positive().nullable()
});
// src/todos/identity.ts
import * as z3 from "zod/v4";
var TODOS_IDENTITY_SCHEMA_ID = "hasna.todos.identity_context.v1";
var TodosIdentityRoleSchema = z3.enum([
  "customer_member",
  "customer_manager",
  "tenant_admin"
]);
var TodosScopeSchema = z3.string().min(1).max(160).regex(/^todos:[a-z0-9_*:-]+$/);
var TodosIdentityContextSchema = z3.strictObject({
  issuer: z3.string().min(1).max(256),
  audience: TodosAudienceSchema,
  subject: z3.string().min(1).max(256),
  organizationId: TodosOwnerIdSchema,
  tenantId: TodosOwnerIdSchema,
  roles: z3.array(TodosIdentityRoleSchema).min(1).max(32),
  scopes: z3.array(TodosScopeSchema).min(1).max(256),
  keyId: TodosEntityIdSchema,
  tokenId: TodosEntityIdSchema,
  requestId: TodosRequestIdSchema,
  agentId: TodosEntityIdSchema.nullable(),
  sessionId: TodosEntityIdSchema.nullable(),
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  idempotencyKey: TodosIdempotencyKeySchema.nullable()
}).superRefine((value, ctx) => {
  if (new Set(value.roles).size !== value.roles.length) {
    ctx.addIssue({
      code: "custom",
      message: "Identity roles must be unique",
      path: ["roles"]
    });
  }
  if (new Set(value.scopes).size !== value.scopes.length) {
    ctx.addIssue({
      code: "custom",
      message: "Identity scopes must be unique",
      path: ["scopes"]
    });
  }
  if (value.audience === "tenant_admin" && !value.roles.includes("tenant_admin")) {
    ctx.addIssue({
      code: "custom",
      message: "The tenant_admin audience requires the tenant_admin role",
      path: ["roles"]
    });
  }
});
function scopeMatches(granted, required) {
  if (granted === "todos:*" || granted === required) {
    return true;
  }
  const grantedParts = granted.split(":");
  const requiredParts = required.split(":");
  if (grantedParts.length !== requiredParts.length) {
    return false;
  }
  return grantedParts.every((part, index) => part === "*" || part === requiredParts[index]);
}
function validateTodosIdentityContext(input, requirements) {
  const parsed = TodosIdentityContextSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: createTodosError("TODOS_AUTHENTICATION_FAILED", "Identity context is invalid", {
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || null,
          reason: issue.message
        }))
      })
    };
  }
  const identity = parsed.data;
  if (identity.organizationId !== requirements.organizationId || identity.tenantId !== requirements.tenantId) {
    return {
      success: false,
      error: createTodosError("TODOS_TENANT_MISMATCH", "Identity tenant binding does not match the requested tenant")
    };
  }
  const audienceAllowed = identity.audience === requirements.audience || identity.audience === "tenant_admin" && requirements.audience === "customer";
  if (!audienceAllowed) {
    return {
      success: false,
      error: createTodosError("TODOS_ACCESS_DENIED", "Identity audience cannot access this operation")
    };
  }
  const missingScopes = requirements.requiredScopes.filter((required) => !identity.scopes.some((granted) => scopeMatches(granted, required)));
  if (missingScopes.length > 0) {
    return {
      success: false,
      error: createTodosError("TODOS_SCOPE_REQUIRED", "Identity lacks required scopes", {
        details: missingScopes.map((scope) => ({
          field: "scopes",
          reason: "Required scope is missing",
          expected: scope
        }))
      })
    };
  }
  if (requirements.requireIdempotencyKey === true && identity.idempotencyKey === null) {
    return {
      success: false,
      error: createTodosError("TODOS_IDEMPOTENCY_REQUIRED", "This operation requires an idempotency key")
    };
  }
  return { success: true, identity };
}
// src/todos/authority.ts
import * as z4 from "zod/v4";
var TODOS_AUTHORITY_SCHEMA_IDS = {
  config: "hasna.todos.authority_config.v1",
  handshake: "hasna.todos.authority_handshake.v1",
  serviceStatus: "hasna.todos.service_status.v1"
};
var TodosAuthorityDescriptorSchema = z4.strictObject({
  id: TodosOwnerIdSchema,
  endpoint: z4.url().nullable()
});
var TodosAuthorityConfigShape = {
  authority: TodosAuthorityDescriptorSchema,
  contractVersion: z4.literal(TODOS_CONTRACT_VERSION),
  contractDigest: TodosSha256DigestSchema,
  manifestVersion: z4.literal(TODOS_MANIFEST_VERSION),
  manifestDigest: TodosSha256DigestSchema,
  capabilityIds: z4.array(z4.string().min(1).max(128).regex(/^[a-z][a-z0-9-]*$/)).min(1)
};
function enforceTodosAuthorityInvariants(value, ctx) {
  if (new Set(value.capabilityIds).size !== value.capabilityIds.length) {
    ctx.addIssue({
      code: "custom",
      message: "Capability ids must be unique",
      path: ["capabilityIds"]
    });
  }
  if (value.authority.endpoint !== null && !value.authority.endpoint.startsWith("https://")) {
    ctx.addIssue({
      code: "custom",
      message: "A network authority endpoint must be HTTPS",
      path: ["authority", "endpoint"]
    });
  }
}
var TodosAuthorityConfigSchema = z4.strictObject(TodosAuthorityConfigShape).superRefine(enforceTodosAuthorityInvariants);
var TodosAuthorityHandshakeSchema = z4.strictObject({
  ...TodosAuthorityConfigShape,
  issuedAt: TodosTimestampSchema
}).superRefine(enforceTodosAuthorityInvariants);
var TodosServiceStatusSchema = z4.strictObject({
  status: z4.enum(["healthy", "ready", "unavailable"]),
  authorityId: TodosOwnerIdSchema,
  contractVersion: z4.literal(TODOS_CONTRACT_VERSION),
  manifestVersion: z4.literal(TODOS_MANIFEST_VERSION),
  observedAt: TodosTimestampSchema
});
var TODOS_AUTHORITY_SCHEMAS = Object.freeze({
  [TODOS_AUTHORITY_SCHEMA_IDS.config]: TodosAuthorityConfigSchema,
  [TODOS_AUTHORITY_SCHEMA_IDS.handshake]: TodosAuthorityHandshakeSchema,
  [TODOS_AUTHORITY_SCHEMA_IDS.serviceStatus]: TodosServiceStatusSchema
});
// src/todos/capability-schema.ts
import * as z5 from "zod/v4";
var TODOS_CAPABILITY_SCHEMA_IDS = {
  capability: "hasna.todos.capability.v1",
  manifest: "hasna.todos.capability_manifest.v1"
};
var TodosCapabilitySchema = z5.strictObject({
  id: z5.string().min(1).max(128).regex(/^[a-z][a-z0-9-]*$/),
  availability: z5.enum(["core", "gated"]),
  operationIds: z5.array(z5.string().regex(/^todos\.[a-z0-9_]+(?:\.[a-z0-9_]+)+$/)).min(1),
  audiences: z5.array(TodosAudienceSchema).min(1)
});
var TodosCapabilityManifestSchema = z5.strictObject({
  schema: z5.literal(TODOS_CAPABILITY_SCHEMA_IDS.manifest),
  version: z5.literal(TODOS_MANIFEST_VERSION),
  manifestDigest: z5.string().regex(/^[a-f0-9]{64}$/),
  capabilities: z5.array(TodosCapabilitySchema).min(1)
});
var TODOS_CAPABILITY_SCHEMAS = Object.freeze({
  [TODOS_CAPABILITY_SCHEMA_IDS.capability]: TodosCapabilitySchema,
  [TODOS_CAPABILITY_SCHEMA_IDS.manifest]: TodosCapabilityManifestSchema
});

// src/todos/operations.ts
import * as z11 from "zod/v4";

// src/todos/operation-schemas.ts
import * as z9 from "zod/v4";

// src/todos/domain.ts
import * as z6 from "zod/v4";
var TODOS_DOMAIN_SCHEMA_IDS = {
  ownerQualifiedRef: "hasna.todos.owner_qualified_ref.v1",
  externalOwnerRef: "hasna.todos.external_owner_ref.v1",
  task: "hasna.todos.task.v1",
  project: "hasna.todos.project.v1",
  taskList: "hasna.todos.task_list.v1",
  plan: "hasna.todos.plan.v1",
  agent: "hasna.todos.agent.v1",
  comment: "hasna.todos.comment.v1",
  dependency: "hasna.todos.dependency.v1",
  activity: "hasna.todos.activity.v1",
  savedView: "hasna.todos.saved_view.v1",
  searchRequest: "hasna.todos.search_request.v1",
  verificationEvidence: "hasna.todos.verification_evidence.v1",
  taskFile: "hasna.todos.task_file.v1",
  run: "hasna.todos.run.v1",
  runEvent: "hasna.todos.run_event.v1",
  runCommand: "hasna.todos.run_command.v1",
  runFile: "hasna.todos.run_file.v1",
  runArtifact: "hasna.todos.run_artifact.v1",
  gitObjectId: "hasna.todos.git_object_id.v1",
  gitCommit: "hasna.todos.git_commit.v1",
  gitRef: "hasna.todos.git_ref.v1",
  traceability: "hasna.todos.traceability.v1",
  taskTemplate: "hasna.todos.task_template.v1",
  approval: "hasna.todos.approval.v1",
  deletionRecord: "hasna.todos.deletion_record.v1",
  taskContext: "hasna.todos.task_context.v1",
  stats: "hasna.todos.stats.v1"
};
var EntityBaseShape = {
  id: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  version: z6.number().int().positive(),
  createdAt: TodosTimestampSchema,
  updatedAt: TodosTimestampSchema
};
var TodosExternalOwnerRefSchema = z6.strictObject({
  owner: TodosOwnerIdSchema,
  id: TodosEntityIdSchema,
  digest: TodosSha256DigestSchema
});
var TodosTaskStatusSchema = z6.enum([
  "pending",
  "ready",
  "in_progress",
  "blocked",
  "completed",
  "failed",
  "cancelled"
]);
var TODOS_TERMINAL_TASK_STATUSES = Object.freeze([
  "completed",
  "failed",
  "cancelled"
]);
var TODOS_TASK_STATUS_TRANSITIONS = Object.freeze({
  pending: ["ready", "in_progress", "blocked", "cancelled"],
  ready: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "completed", "failed", "cancelled"],
  blocked: ["pending", "ready", "in_progress", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
});
function isTodosTerminalTaskStatus(status) {
  return TODOS_TERMINAL_TASK_STATUSES.includes(status);
}
function validateTodosTaskStatusTransition(currentInput, targetInput) {
  const current = TodosTaskStatusSchema.safeParse(currentInput);
  const target = TodosTaskStatusSchema.safeParse(targetInput);
  if (!current.success || !target.success) {
    return {
      success: false,
      reason: "invalid_status",
      allowedTargets: []
    };
  }
  if (current.data === target.data) {
    return {
      success: true,
      replayed: true,
      terminal: isTodosTerminalTaskStatus(current.data)
    };
  }
  const allowedTargets = TODOS_TASK_STATUS_TRANSITIONS[current.data];
  if (isTodosTerminalTaskStatus(current.data)) {
    return {
      success: false,
      reason: "terminal_status",
      allowedTargets
    };
  }
  if (!allowedTargets.includes(target.data)) {
    return {
      success: false,
      reason: "transition_not_allowed",
      allowedTargets
    };
  }
  return {
    success: true,
    replayed: false,
    terminal: isTodosTerminalTaskStatus(target.data)
  };
}
var TodosTaskPrioritySchema = z6.enum(["low", "medium", "high", "critical"]);
var TodosTaskSchema = z6.strictObject({
  ...EntityBaseShape,
  shortId: z6.string().min(1).max(40).nullable(),
  title: z6.string().min(1).max(512),
  description: z6.string().max(1e5).nullable(),
  status: TodosTaskStatusSchema,
  priority: TodosTaskPrioritySchema,
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  planId: TodosEntityIdSchema.nullable(),
  parentTaskId: TodosEntityIdSchema.nullable(),
  assignedAgentId: TodosEntityIdSchema.nullable(),
  fingerprint: z6.string().min(1).max(256).nullable(),
  tags: z6.array(z6.string().min(1).max(96)).max(128),
  acceptanceCriteria: z6.array(z6.string().min(1).max(4096)).max(256),
  dueAt: TodosTimestampSchema.nullable(),
  completedAt: TodosTimestampSchema.nullable(),
  externalOwnerRefs: z6.array(TodosExternalOwnerRefSchema).max(64)
}).superRefine((value, ctx) => {
  if (new Set(value.tags).size !== value.tags.length) {
    ctx.addIssue({ code: "custom", message: "Task tags must be unique", path: ["tags"] });
  }
  if (value.status === "completed" && value.completedAt === null) {
    ctx.addIssue({
      code: "custom",
      message: "Completed tasks require completedAt",
      path: ["completedAt"]
    });
  }
});
var TodosProjectSchema = z6.strictObject({
  ...EntityBaseShape,
  slug: TodosSlugSchema,
  name: z6.string().min(1).max(256),
  description: z6.string().max(20000).nullable(),
  repositoryRef: TodosExternalOwnerRefSchema.nullable(),
  archivedAt: TodosTimestampSchema.nullable()
});
var TodosTaskListSchema = z6.strictObject({
  ...EntityBaseShape,
  projectId: TodosEntityIdSchema.nullable(),
  slug: TodosSlugSchema,
  name: z6.string().min(1).max(256),
  description: z6.string().max(20000).nullable(),
  archivedAt: TodosTimestampSchema.nullable()
});
var TodosPlanStatusSchema = z6.enum(["draft", "active", "completed", "archived"]);
var TodosPlanSchema = z6.strictObject({
  ...EntityBaseShape,
  slug: TodosSlugSchema,
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  name: z6.string().min(1).max(256),
  description: z6.string().max(40000).nullable(),
  status: TodosPlanStatusSchema,
  objective: z6.string().min(1).max(20000),
  taskIds: z6.array(TodosEntityIdSchema).max(1e4),
  completedAt: TodosTimestampSchema.nullable()
});
var TodosAgentStatusSchema = z6.enum(["active", "inactive", "released"]);
var TodosAgentSchema = z6.strictObject({
  ...EntityBaseShape,
  displayName: z6.string().min(1).max(256),
  status: TodosAgentStatusSchema,
  roles: z6.array(TodosIdentityRoleSchema).min(1).max(32),
  activeProjectId: TodosEntityIdSchema.nullable(),
  activeTaskListId: TodosEntityIdSchema.nullable(),
  lastHeartbeatAt: TodosTimestampSchema.nullable(),
  releasedAt: TodosTimestampSchema.nullable()
}).superRefine((value, ctx) => {
  if (new Set(value.roles).size !== value.roles.length) {
    ctx.addIssue({ code: "custom", message: "Agent roles must be unique", path: ["roles"] });
  }
});
var TodosCommentKindSchema = z6.enum(["comment", "progress", "note"]);
var TodosCommentSchema = z6.strictObject({
  ...EntityBaseShape,
  taskId: TodosEntityIdSchema,
  authorRef: TodosExternalOwnerRefSchema,
  kind: TodosCommentKindSchema,
  content: z6.string().min(1).max(1e5),
  progressPercent: z6.number().min(0).max(100).nullable()
});
var TodosDependencyKindSchema = z6.enum(["requires", "blocks"]);
var TodosDependencySchema = z6.strictObject({
  ...EntityBaseShape,
  sourceTaskId: TodosEntityIdSchema,
  targetTaskId: TodosEntityIdSchema,
  kind: TodosDependencyKindSchema
}).superRefine((value, ctx) => {
  if (value.sourceTaskId === value.targetTaskId) {
    ctx.addIssue({
      code: "custom",
      message: "A task cannot depend on itself",
      path: ["targetTaskId"]
    });
  }
});
var TodosActivitySchema = z6.strictObject({
  ...EntityBaseShape,
  actorRef: TodosExternalOwnerRefSchema,
  resourceRef: TodosOwnerQualifiedRefSchema,
  action: z6.string().min(1).max(160).regex(/^[a-z][a-z0-9_.:-]*$/),
  summary: z6.string().min(1).max(4096),
  occurredAt: TodosTimestampSchema
});
var TodosSearchFilterSchema = z6.strictObject({
  projectIds: z6.array(TodosEntityIdSchema).max(256),
  taskListIds: z6.array(TodosEntityIdSchema).max(256),
  planIds: z6.array(TodosEntityIdSchema).max(256),
  agentIds: z6.array(TodosEntityIdSchema).max(256),
  statuses: z6.array(TodosTaskStatusSchema).max(16),
  priorities: z6.array(TodosTaskPrioritySchema).max(8),
  tags: z6.array(z6.string().min(1).max(96)).max(128),
  changedAfter: TodosTimestampSchema.nullable(),
  dueBefore: TodosTimestampSchema.nullable()
});
var TodosSearchRequestSchema = z6.strictObject({
  query: z6.string().min(1).max(4096),
  filters: TodosSearchFilterSchema,
  cursor: TodosCursorSchema.nullable(),
  limit: z6.number().int().positive().max(500)
});
var TodosSavedViewSchema = z6.strictObject({
  ...EntityBaseShape,
  name: z6.string().min(1).max(256),
  description: z6.string().max(4096).nullable(),
  query: TodosSearchRequestSchema,
  audience: z6.enum(["private", "organization"])
});
var TodosVerificationCommandSchema = z6.strictObject({
  command: z6.string().min(1).max(16000),
  exitCode: z6.number().int(),
  durationMs: z6.number().int().nonnegative()
});
var TodosVerificationCheckSchema = z6.strictObject({
  name: z6.string().min(1).max(512),
  status: z6.enum(["passed", "failed", "skipped"]),
  summary: z6.string().max(4096).nullable(),
  durationMs: z6.number().int().nonnegative().nullable()
});
var TodosVerificationEvidenceSchema = z6.strictObject({
  ...EntityBaseShape,
  taskId: TodosEntityIdSchema.nullable(),
  runId: TodosEntityIdSchema.nullable(),
  verifierRef: TodosExternalOwnerRefSchema,
  status: z6.enum(["passed", "failed", "inconclusive"]),
  summary: z6.string().min(1).max(20000),
  confidence: z6.number().min(0).max(1).nullable(),
  commands: z6.array(TodosVerificationCommandSchema).max(256),
  checks: z6.array(TodosVerificationCheckSchema).max(1e4),
  contentRefs: z6.array(TodosContentRefSchema).max(1e4),
  startedAt: TodosTimestampSchema,
  completedAt: TodosTimestampSchema.nullable()
});
var TodosTaskFileSchema = z6.strictObject({
  ...EntityBaseShape,
  taskId: TodosEntityIdSchema,
  logicalName: z6.string().min(1).max(512),
  relativePath: TodosRelativePathSchema.nullable(),
  contentRef: TodosContentRefSchema,
  purpose: z6.enum(["attachment", "evidence", "deliverable"])
});
var TodosRunStatusSchema = z6.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
var TodosRunSchema = z6.strictObject({
  ...EntityBaseShape,
  objective: z6.string().min(1).max(20000),
  status: TodosRunStatusSchema,
  taskIds: z6.array(TodosEntityIdSchema).max(1e4),
  planId: TodosEntityIdSchema.nullable(),
  agentId: TodosEntityIdSchema.nullable(),
  startedAt: TodosTimestampSchema.nullable(),
  completedAt: TodosTimestampSchema.nullable(),
  ledgerDigest: TodosSha256DigestSchema
});
var TodosRunEventSchema = z6.strictObject({
  ...EntityBaseShape,
  runId: TodosEntityIdSchema,
  sequence: z6.number().int().nonnegative(),
  type: z6.string().min(1).max(160).regex(/^[a-z][a-z0-9_.:-]*$/),
  summary: z6.string().min(1).max(20000),
  occurredAt: TodosTimestampSchema,
  evidenceIds: z6.array(TodosEntityIdSchema).max(1e4)
});
var TodosRunCommandSchema = z6.strictObject({
  ...EntityBaseShape,
  runId: TodosEntityIdSchema,
  sequence: z6.number().int().nonnegative(),
  command: z6.string().min(1).max(16000),
  exitCode: z6.number().int().nullable(),
  durationMs: z6.number().int().nonnegative().nullable(),
  outputRefs: z6.array(TodosContentRefSchema).max(1024),
  completedAt: TodosTimestampSchema.nullable()
});
var TodosRunFileSchema = z6.strictObject({
  ...EntityBaseShape,
  runId: TodosEntityIdSchema,
  logicalName: z6.string().min(1).max(512),
  relativePath: TodosRelativePathSchema.nullable(),
  contentRef: TodosContentRefSchema,
  role: z6.enum(["input", "output", "evidence"])
});
var TodosRunArtifactSchema = z6.strictObject({
  ...EntityBaseShape,
  runId: TodosEntityIdSchema,
  name: z6.string().min(1).max(512),
  kind: z6.string().min(1).max(160).regex(/^[a-z][a-z0-9_.:-]*$/),
  contentRef: TodosContentRefSchema,
  verified: z6.boolean(),
  verificationEvidenceId: TodosEntityIdSchema.nullable()
});
var TodosGitObjectIdSchema = z6.strictObject({
  algorithm: z6.enum(["sha1", "sha256"]),
  value: z6.string().regex(/^[a-f0-9]+$/)
}).superRefine((value, ctx) => {
  const expectedLength = value.algorithm === "sha1" ? 40 : 64;
  if (value.value.length !== expectedLength) {
    ctx.addIssue({
      code: "custom",
      message: `Git object id must contain ${expectedLength} hexadecimal characters`,
      path: ["value"]
    });
  }
});
var TodosGitCommitSchema = z6.strictObject({
  ...EntityBaseShape,
  repositoryRef: TodosExternalOwnerRefSchema,
  objectId: TodosGitObjectIdSchema,
  message: z6.string().min(1).max(20000),
  authorRef: TodosExternalOwnerRefSchema,
  committedAt: TodosTimestampSchema,
  changedFiles: z6.array(TodosRelativePathSchema).max(50000)
});
var TodosGitRefSchema = z6.strictObject({
  ...EntityBaseShape,
  repositoryRef: TodosExternalOwnerRefSchema,
  type: z6.enum(["branch", "tag", "pull_request"]),
  name: z6.string().min(1).max(512),
  target: TodosGitObjectIdSchema,
  published: z6.boolean(),
  providerObservedAt: TodosTimestampSchema.nullable()
});
var TodosTraceabilitySchema = z6.strictObject({
  ...EntityBaseShape,
  taskId: TodosEntityIdSchema,
  commitIds: z6.array(TodosEntityIdSchema).max(1e4),
  gitRefIds: z6.array(TodosEntityIdSchema).max(1e4),
  verificationEvidenceIds: z6.array(TodosEntityIdSchema).max(1e4),
  projectionIds: z6.array(TodosEntityIdSchema).max(1e4)
});
var TodosTaskTemplateSchema = z6.strictObject({
  ...EntityBaseShape,
  name: z6.string().min(1).max(256),
  description: z6.string().max(4096).nullable(),
  titlePattern: z6.string().min(1).max(512),
  descriptionPattern: z6.string().max(20000).nullable(),
  priority: TodosTaskPrioritySchema,
  tags: z6.array(z6.string().min(1).max(96)).max(128),
  acceptanceCriteria: z6.array(z6.string().min(1).max(4096)).max(256)
});
var TodosApprovalSchema = z6.strictObject({
  ...EntityBaseShape,
  resourceRef: TodosOwnerQualifiedRefSchema,
  status: z6.enum(["pending", "approved", "rejected", "expired"]),
  reason: z6.string().min(1).max(4096),
  requestedBy: TodosExternalOwnerRefSchema,
  decidedBy: TodosExternalOwnerRefSchema.nullable(),
  requestedAt: TodosTimestampSchema,
  decidedAt: TodosTimestampSchema.nullable(),
  expiresAt: TodosTimestampSchema.nullable()
});
var TodosDeletionRecordSchema = z6.strictObject({
  id: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  entityKind: z6.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  entityIdDigest: TodosSha256DigestSchema,
  priorRecordDigest: TodosSha256DigestSchema,
  tombstoneVersion: z6.number().int().positive(),
  redaction: z6.literal("full"),
  reasonCode: z6.string().min(1).max(128).regex(/^[a-z][a-z0-9_]*$/),
  deletedAt: TodosTimestampSchema
});
var TodosTaskContextSchema = z6.strictObject({
  task: TodosTaskSchema,
  project: TodosProjectSchema.nullable(),
  taskList: TodosTaskListSchema.nullable(),
  plan: TodosPlanSchema.nullable(),
  comments: z6.array(TodosCommentSchema),
  dependencies: z6.array(TodosDependencySchema),
  verificationEvidence: z6.array(TodosVerificationEvidenceSchema),
  files: z6.array(TodosTaskFileSchema),
  traceability: TodosTraceabilitySchema.nullable()
});
var TodosStatsSchema = z6.strictObject({
  asOfDate: TodosDateSchema,
  tasks: z6.strictObject({
    total: z6.number().int().nonnegative(),
    pending: z6.number().int().nonnegative(),
    ready: z6.number().int().nonnegative(),
    inProgress: z6.number().int().nonnegative(),
    blocked: z6.number().int().nonnegative(),
    completed: z6.number().int().nonnegative(),
    failed: z6.number().int().nonnegative(),
    cancelled: z6.number().int().nonnegative()
  }),
  projects: z6.number().int().nonnegative(),
  plans: z6.number().int().nonnegative(),
  activeAgents: z6.number().int().nonnegative(),
  activeRuns: z6.number().int().nonnegative()
});
var TODOS_DOMAIN_SCHEMAS = Object.freeze({
  [TODOS_DOMAIN_SCHEMA_IDS.ownerQualifiedRef]: TodosOwnerQualifiedRefSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.externalOwnerRef]: TodosExternalOwnerRefSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.task]: TodosTaskSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.project]: TodosProjectSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.taskList]: TodosTaskListSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.plan]: TodosPlanSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.agent]: TodosAgentSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.comment]: TodosCommentSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.dependency]: TodosDependencySchema,
  [TODOS_DOMAIN_SCHEMA_IDS.activity]: TodosActivitySchema,
  [TODOS_DOMAIN_SCHEMA_IDS.savedView]: TodosSavedViewSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.searchRequest]: TodosSearchRequestSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.verificationEvidence]: TodosVerificationEvidenceSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.taskFile]: TodosTaskFileSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.run]: TodosRunSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.runEvent]: TodosRunEventSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.runCommand]: TodosRunCommandSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.runFile]: TodosRunFileSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.runArtifact]: TodosRunArtifactSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.gitObjectId]: TodosGitObjectIdSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.gitCommit]: TodosGitCommitSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.gitRef]: TodosGitRefSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.traceability]: TodosTraceabilitySchema,
  [TODOS_DOMAIN_SCHEMA_IDS.taskTemplate]: TodosTaskTemplateSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.approval]: TodosApprovalSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.deletionRecord]: TodosDeletionRecordSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.taskContext]: TodosTaskContextSchema,
  [TODOS_DOMAIN_SCHEMA_IDS.stats]: TodosStatsSchema
});
function classifyFields(portable, referenceOnly = [], excluded = []) {
  return Object.freeze({
    ...Object.fromEntries(portable.map((field) => [field, "portable"])),
    ...Object.fromEntries(referenceOnly.map((field) => [field, "reference_only"])),
    ...Object.fromEntries(excluded.map((field) => [field, "excluded"]))
  });
}
var BASE_FIELDS = ["id", "owner", "version", "createdAt", "updatedAt"];
var TODOS_DOMAIN_FIELD_CLASSIFICATION = Object.freeze({
  [TODOS_DOMAIN_SCHEMA_IDS.ownerQualifiedRef]: classifyFields(["owner", "kind", "id", "digest"]),
  [TODOS_DOMAIN_SCHEMA_IDS.externalOwnerRef]: classifyFields([], ["owner", "id", "digest"]),
  [TODOS_DOMAIN_SCHEMA_IDS.task]: classifyFields([
    ...BASE_FIELDS,
    "shortId",
    "title",
    "description",
    "status",
    "priority",
    "projectId",
    "taskListId",
    "planId",
    "parentTaskId",
    "fingerprint",
    "tags",
    "acceptanceCriteria",
    "dueAt",
    "completedAt"
  ], ["assignedAgentId", "externalOwnerRefs"]),
  [TODOS_DOMAIN_SCHEMA_IDS.project]: classifyFields([...BASE_FIELDS, "slug", "name", "description", "archivedAt"], ["repositoryRef"]),
  [TODOS_DOMAIN_SCHEMA_IDS.taskList]: classifyFields([
    ...BASE_FIELDS,
    "projectId",
    "slug",
    "name",
    "description",
    "archivedAt"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.plan]: classifyFields([
    ...BASE_FIELDS,
    "slug",
    "projectId",
    "taskListId",
    "name",
    "description",
    "status",
    "objective",
    "taskIds",
    "completedAt"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.agent]: classifyFields([], ["id", "owner"], ["version", "createdAt", "updatedAt", "displayName", "status", "roles", "activeProjectId", "activeTaskListId", "lastHeartbeatAt", "releasedAt"]),
  [TODOS_DOMAIN_SCHEMA_IDS.comment]: classifyFields([...BASE_FIELDS, "taskId", "kind", "content", "progressPercent"], ["authorRef"]),
  [TODOS_DOMAIN_SCHEMA_IDS.dependency]: classifyFields([
    ...BASE_FIELDS,
    "sourceTaskId",
    "targetTaskId",
    "kind"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.activity]: classifyFields([...BASE_FIELDS, "resourceRef", "action", "summary", "occurredAt"], ["actorRef"]),
  [TODOS_DOMAIN_SCHEMA_IDS.savedView]: classifyFields([
    ...BASE_FIELDS,
    "name",
    "description",
    "query",
    "audience"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.searchRequest]: classifyFields(["query", "filters", "cursor", "limit"]),
  [TODOS_DOMAIN_SCHEMA_IDS.verificationEvidence]: classifyFields([
    ...BASE_FIELDS,
    "taskId",
    "runId",
    "status",
    "summary",
    "confidence",
    "checks",
    "contentRefs",
    "startedAt",
    "completedAt"
  ], ["verifierRef"], ["commands"]),
  [TODOS_DOMAIN_SCHEMA_IDS.taskFile]: classifyFields([
    ...BASE_FIELDS,
    "taskId",
    "logicalName",
    "contentRef",
    "purpose"
  ], [], ["relativePath"]),
  [TODOS_DOMAIN_SCHEMA_IDS.run]: classifyFields([...BASE_FIELDS, "objective", "status", "taskIds", "planId", "startedAt", "completedAt", "ledgerDigest"], ["agentId"]),
  [TODOS_DOMAIN_SCHEMA_IDS.runEvent]: classifyFields([
    ...BASE_FIELDS,
    "runId",
    "sequence",
    "type",
    "summary",
    "occurredAt",
    "evidenceIds"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.runCommand]: classifyFields([
    ...BASE_FIELDS,
    "runId",
    "sequence",
    "exitCode",
    "durationMs",
    "outputRefs",
    "completedAt"
  ], [], ["command"]),
  [TODOS_DOMAIN_SCHEMA_IDS.runFile]: classifyFields([
    ...BASE_FIELDS,
    "runId",
    "logicalName",
    "contentRef",
    "role"
  ], [], ["relativePath"]),
  [TODOS_DOMAIN_SCHEMA_IDS.runArtifact]: classifyFields([
    ...BASE_FIELDS,
    "runId",
    "name",
    "kind",
    "contentRef",
    "verified",
    "verificationEvidenceId"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.gitObjectId]: classifyFields(["algorithm", "value"]),
  [TODOS_DOMAIN_SCHEMA_IDS.gitCommit]: classifyFields([...BASE_FIELDS, "objectId", "message", "committedAt"], ["repositoryRef", "authorRef"], ["changedFiles"]),
  [TODOS_DOMAIN_SCHEMA_IDS.gitRef]: classifyFields([...BASE_FIELDS, "type", "name", "target", "published", "providerObservedAt"], ["repositoryRef"]),
  [TODOS_DOMAIN_SCHEMA_IDS.traceability]: classifyFields([
    ...BASE_FIELDS,
    "taskId",
    "commitIds",
    "gitRefIds",
    "verificationEvidenceIds",
    "projectionIds"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.taskTemplate]: classifyFields([
    ...BASE_FIELDS,
    "name",
    "description",
    "titlePattern",
    "descriptionPattern",
    "priority",
    "tags",
    "acceptanceCriteria"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.approval]: classifyFields([
    ...BASE_FIELDS,
    "resourceRef",
    "status",
    "reason",
    "requestedAt",
    "decidedAt",
    "expiresAt"
  ], ["requestedBy", "decidedBy"]),
  [TODOS_DOMAIN_SCHEMA_IDS.deletionRecord]: classifyFields([
    "id",
    "owner",
    "entityKind",
    "entityIdDigest",
    "priorRecordDigest",
    "tombstoneVersion",
    "redaction",
    "reasonCode",
    "deletedAt"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.taskContext]: classifyFields([
    "task",
    "project",
    "taskList",
    "plan",
    "comments",
    "dependencies",
    "verificationEvidence",
    "files",
    "traceability"
  ]),
  [TODOS_DOMAIN_SCHEMA_IDS.stats]: classifyFields(["asOfDate", "tasks", "projects", "plans", "activeAgents", "activeRuns"])
});

// src/todos/projection.ts
import * as z7 from "zod/v4";
var TODOS_PROJECTION_SCHEMA_IDS = {
  projection: "hasna.todos.task_to_pr_projection.v1",
  transitionIssue: "hasna.todos.task_to_pr_transition_issue.v1"
};
var TaskToPrOwnerRefSchema = TodosOwnerQualifiedRefSchema.refine((value) => !value.id.includes("/") && !value.id.includes("\\") && !value.id.includes("://"), {
  message: "Projection refs must be opaque owner-qualified identifiers",
  path: ["id"]
});
function createTaskToPrKindRefSchema(kind) {
  return TodosOwnerQualifiedRefSchema.extend({ kind: z7.literal(kind) }).refine((value) => !value.id.includes("/") && !value.id.includes("\\") && !value.id.includes("://"), {
    message: "Projection refs must be opaque owner-qualified identifiers",
    path: ["id"]
  });
}
var TaskToPrTaskRefSchema = createTaskToPrKindRefSchema("task");
var TaskToPrRepositoryRefSchema = createTaskToPrKindRefSchema("repository");
var TaskToPrWorktreeRefSchema = createTaskToPrKindRefSchema("worktree");
var TaskToPrBranchRefSchema = createTaskToPrKindRefSchema("branch");
var TaskToPrPullRequestRefSchema = createTaskToPrKindRefSchema("pull_request");
var TaskToPrProofRefSchema = createTaskToPrKindRefSchema("proof_bundle");
var TaskToPrProjectionPredecessorSchema = z7.strictObject({
  kind: z7.literal("task_to_pr_projection"),
  projectionId: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  version: z7.number().int().positive(),
  digest: TodosSha256DigestSchema
});
var TaskToPrProjectionIdentitySchema = z7.strictObject({
  taskRef: TaskToPrTaskRefSchema,
  repositoryRef: TaskToPrRepositoryRefSchema,
  worktreeRef: TaskToPrWorktreeRefSchema,
  branchRef: TaskToPrBranchRefSchema,
  baseHead: TodosGitObjectIdSchema
});
var TaskToPrProofKindSchema = z7.enum([
  "head_equality",
  "ci",
  "review"
]);
var TaskToPrProofSchema = z7.strictObject({
  ref: TaskToPrProofRefSchema,
  kind: TaskToPrProofKindSchema,
  head: TodosGitObjectIdSchema,
  observedAt: TodosTimestampSchema
});
var TaskToPrHeadBindingSchema = z7.strictObject({
  branchHead: TodosGitObjectIdSchema,
  publishedHead: TodosGitObjectIdSchema.nullable(),
  providerObservedHead: TodosGitObjectIdSchema.nullable(),
  equalityProof: TaskToPrProofSchema.nullable()
}).superRefine((value, ctx) => {
  const exactValues = [
    value.publishedHead,
    value.providerObservedHead,
    value.equalityProof
  ];
  const hasAnyExactValue = exactValues.some((entry) => entry !== null);
  const hasEveryExactValue = exactValues.every((entry) => entry !== null);
  if (hasAnyExactValue && !hasEveryExactValue) {
    ctx.addIssue({
      code: "custom",
      message: "Exact-head binding requires published, provider-observed, and proof values together"
    });
    return;
  }
  if (value.publishedHead && value.providerObservedHead && value.equalityProof) {
    if (!sameTodosGitObjectId(value.branchHead, value.publishedHead) || !sameTodosGitObjectId(value.branchHead, value.providerObservedHead) || !sameTodosGitObjectId(value.branchHead, value.equalityProof.head)) {
      ctx.addIssue({
        code: "custom",
        message: "Exact-head values must equal the branch head"
      });
    }
    if (value.equalityProof.kind !== "head_equality") {
      ctx.addIssue({
        code: "custom",
        message: "The exact-head proof must use kind head_equality",
        path: ["equalityProof", "kind"]
      });
    }
  }
});
function unsignedProjection(value) {
  return {
    schema: value.schema,
    id: value.id,
    owner: value.owner,
    version: value.version,
    sequence: value.sequence,
    predecessor: value.predecessor,
    identity: value.identity,
    pullRequestRef: value.pullRequestRef,
    head: value.head,
    proofs: value.proofs,
    derivedAt: value.derivedAt
  };
}
var TaskToPrProjectionSchema = z7.strictObject({
  schema: z7.literal(TODOS_PROJECTION_SCHEMA_IDS.projection),
  id: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  version: z7.number().int().positive(),
  sequence: z7.number().int().positive(),
  predecessor: TaskToPrProjectionPredecessorSchema.nullable(),
  identity: TaskToPrProjectionIdentitySchema,
  pullRequestRef: TaskToPrPullRequestRefSchema.nullable(),
  head: TaskToPrHeadBindingSchema,
  proofs: z7.array(TaskToPrProofSchema).max(1e4),
  derivedAt: TodosTimestampSchema,
  digest: TodosSha256DigestSchema
}).superRefine((value, ctx) => {
  if (value.version === 1 && value.predecessor !== null) {
    ctx.addIssue({
      code: "custom",
      message: "The first projection version cannot have a predecessor",
      path: ["predecessor"]
    });
  }
  if (value.version > 1 && value.predecessor === null) {
    ctx.addIssue({
      code: "custom",
      message: "Projection versions after one require a predecessor",
      path: ["predecessor"]
    });
  }
  if (value.predecessor && value.predecessor.version !== value.version - 1) {
    ctx.addIssue({
      code: "custom",
      message: "Projection predecessor version must immediately precede the current version",
      path: ["predecessor", "version"]
    });
  }
  if (value.predecessor && (value.predecessor.projectionId !== value.id || value.predecessor.owner !== value.owner)) {
    ctx.addIssue({
      code: "custom",
      message: "Projection predecessor identity must match the projection",
      path: ["predecessor"]
    });
  }
  for (const [field, ref] of Object.entries(value.identity)) {
    if (field === "baseHead")
      continue;
    if (ref.owner !== value.owner) {
      ctx.addIssue({
        code: "custom",
        message: "Every projection identity ref must match the projection owner",
        path: ["identity", field, "owner"]
      });
    }
  }
  if (value.pullRequestRef && value.pullRequestRef.owner !== value.owner) {
    ctx.addIssue({
      code: "custom",
      message: "Projection pull request ownership must match the projection owner",
      path: ["pullRequestRef", "owner"]
    });
  }
  const hasExactHead = value.head.equalityProof !== null;
  if (value.pullRequestRef !== null && !hasExactHead) {
    ctx.addIssue({
      code: "custom",
      message: "Observed pull requests require a complete exact-head binding",
      path: ["head"]
    });
  }
  if (value.pullRequestRef === null && hasExactHead) {
    ctx.addIssue({
      code: "custom",
      message: "Exact-head bindings require an observed pull request",
      path: ["pullRequestRef"]
    });
  }
  const proofRefs = [
    ...value.head.equalityProof ? [value.head.equalityProof] : [],
    ...value.proofs
  ];
  const refKeys = proofRefs.map((proof) => stableTodosJson(proof.ref));
  if (new Set(refKeys).size !== refKeys.length) {
    ctx.addIssue({
      code: "custom",
      message: "Projection proof refs must be unique",
      path: ["proofs"]
    });
  }
  const proofDigests = proofRefs.map((proof) => proof.ref.digest);
  if (new Set(proofDigests).size !== proofDigests.length) {
    ctx.addIssue({
      code: "custom",
      message: "Projection proof digests must be unique",
      path: ["proofs"]
    });
  }
  for (const [index, proof] of proofRefs.entries()) {
    if (proof.ref.owner !== value.owner) {
      ctx.addIssue({
        code: "custom",
        message: "Projection proof ownership must match the projection owner",
        path: [
          ...value.head.equalityProof && index === 0 ? ["head", "equalityProof"] : ["proofs", value.head.equalityProof ? index - 1 : index],
          "ref",
          "owner"
        ]
      });
    }
  }
  for (const [index, proof] of value.proofs.entries()) {
    if (proof.kind === "head_equality") {
      ctx.addIssue({
        code: "custom",
        message: "head_equality belongs in the head binding",
        path: ["proofs", index, "kind"]
      });
    }
    if (!sameTodosGitObjectId(proof.head, value.head.branchHead)) {
      ctx.addIssue({
        code: "custom",
        message: "Projection proofs must bind the current branch head",
        path: ["proofs", index, "head"]
      });
    }
  }
  const expectedDigest = sha256TodosValue(unsignedProjection(value));
  if (value.digest !== expectedDigest) {
    ctx.addIssue({
      code: "custom",
      message: "Projection digest does not match its canonical content",
      path: ["digest"]
    });
  }
});
var TaskToPrTransitionIssueSchema = z7.strictObject({
  path: z7.string().min(1).max(512),
  reason: z7.string().min(1).max(2048)
});
function sameTodosGitObjectId(left, right) {
  return left.algorithm === right.algorithm && left.value === right.value;
}
function computeTaskToPrProjectionDigest(value) {
  return sha256TodosValue(value);
}
function createTaskToPrProjection(value) {
  const normalized = {
    ...value,
    proofs: [...value.proofs].sort((left, right) => stableTodosJson(left).localeCompare(stableTodosJson(right)))
  };
  return TaskToPrProjectionSchema.parse({
    ...normalized,
    digest: computeTaskToPrProjectionDigest(normalized)
  });
}
function addTransitionIssue(issues, path, reason) {
  issues.push({ path, reason });
}
function proofSet(value) {
  return [
    ...value.head.equalityProof ? [value.head.equalityProof] : [],
    ...value.proofs
  ];
}
function refIdentity(ref) {
  return `${ref.owner}\x00${ref.kind}\x00${ref.id}`;
}
function validateTaskToPrProjectionTransition(previousInput, currentInput) {
  const previousParsed = TaskToPrProjectionSchema.safeParse(previousInput);
  const currentParsed = TaskToPrProjectionSchema.safeParse(currentInput);
  const parseIssues = [];
  if (!previousParsed.success) {
    for (const issue of previousParsed.error.issues) {
      addTransitionIssue(parseIssues, `previous.${issue.path.join(".")}`, issue.message);
    }
  }
  if (!currentParsed.success) {
    for (const issue of currentParsed.error.issues) {
      addTransitionIssue(parseIssues, `current.${issue.path.join(".")}`, issue.message);
    }
  }
  if (!previousParsed.success || !currentParsed.success) {
    return {
      success: false,
      error: createTodosError("TODOS_PROJECTION_PREDECESSOR_CONFLICT", "Projection transition contains invalid records"),
      issues: parseIssues
    };
  }
  const previous = previousParsed.data;
  const current = currentParsed.data;
  if (stableTodosJson(previous) === stableTodosJson(current)) {
    return { success: true, replayed: true };
  }
  const issues = [];
  if (current.id !== previous.id || current.owner !== previous.owner) {
    addTransitionIssue(issues, "id", "Projection identity is immutable");
  }
  if (current.version !== previous.version + 1) {
    addTransitionIssue(issues, "version", "Projection version must increase by exactly one");
  }
  if (current.sequence !== previous.sequence + 1) {
    addTransitionIssue(issues, "sequence", "Projection sequence must increase by exactly one");
  }
  if (current.predecessor === null || current.predecessor.kind !== "task_to_pr_projection" || current.predecessor.projectionId !== previous.id || current.predecessor.owner !== previous.owner || current.predecessor.version !== previous.version || current.predecessor.digest !== previous.digest) {
    addTransitionIssue(issues, "predecessor", "Projection predecessor must exactly bind the prior record");
  }
  if (stableTodosJson(current.identity) !== stableTodosJson(previous.identity)) {
    addTransitionIssue(issues, "identity", "Task, repository, worktree, branch, and base binding are immutable");
  }
  if (previous.pullRequestRef !== null && stableTodosJson(current.pullRequestRef) !== stableTodosJson(previous.pullRequestRef)) {
    addTransitionIssue(issues, "pullRequestRef", "Pull request identity is immutable after first observation");
  }
  const headChanged = !sameTodosGitObjectId(previous.head.branchHead, current.head.branchHead);
  const previousProofs = proofSet(previous);
  const currentProofs = proofSet(current);
  if (!headChanged) {
    if (stableTodosJson(current.head) !== stableTodosJson(previous.head)) {
      addTransitionIssue(issues, "head", "An unchanged branch head must retain the complete head binding");
    }
    for (const [index, proof] of previous.proofs.entries()) {
      if (stableTodosJson(current.proofs[index]) !== stableTodosJson(proof)) {
        addTransitionIssue(issues, `proofs.${index}`, "Existing same-head proofs form an immutable prefix");
      }
    }
  } else {
    if (previous.head.equalityProof !== null && current.head.equalityProof === null) {
      addTransitionIssue(issues, "head.equalityProof", "A changed head requires fresh exact-head proof");
    }
    const previousIdentities = new Set(previousProofs.map((proof) => refIdentity(proof.ref)));
    const previousDigests = new Set(previousProofs.map((proof) => proof.ref.digest));
    for (const [index, proof] of currentProofs.entries()) {
      if (previousIdentities.has(refIdentity(proof.ref))) {
        addTransitionIssue(issues, `proofs.${index}.ref`, "A changed head requires fresh proof identities");
      }
      if (previousDigests.has(proof.ref.digest)) {
        addTransitionIssue(issues, `proofs.${index}.ref.digest`, "A changed head requires fresh proof digests");
      }
    }
  }
  if (issues.length > 0) {
    return {
      success: false,
      error: createTodosError("TODOS_PROJECTION_PREDECESSOR_CONFLICT", "Projection transition violates predecessor or immutability rules"),
      issues
    };
  }
  return { success: true, replayed: false };
}
function proofIdentityKey(proof) {
  return refIdentity(proof.ref);
}
function validateTaskToPrProjectionHistory(historyInput, options = {}) {
  if (!Array.isArray(historyInput) || historyInput.length === 0) {
    return {
      success: false,
      error: createTodosError("TODOS_PROJECTION_PREDECESSOR_CONFLICT", "Projection history must contain at least one record"),
      issues: [{ path: "history", reason: "Projection history must be a non-empty array" }]
    };
  }
  const history = [];
  const issues = [];
  for (const [index, input] of historyInput.entries()) {
    const parsed = TaskToPrProjectionSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        addTransitionIssue(issues, `history.${index}.${issue.path.join(".")}`, issue.message);
      }
    } else {
      history.push(parsed.data);
    }
  }
  if (issues.length > 0 || history.length !== historyInput.length) {
    return {
      success: false,
      error: createTodosError("TODOS_PROJECTION_PREDECESSOR_CONFLICT", "Projection history contains invalid records"),
      issues
    };
  }
  const first = history[0];
  if (first.version !== 1 || first.sequence !== 1 || first.predecessor !== null) {
    addTransitionIssue(issues, "history.0", "Projection history must start at version and sequence one without a predecessor");
  }
  if (options.expectedOwner !== undefined && first.owner !== options.expectedOwner) {
    addTransitionIssue(issues, "history.0.owner", "Projection history owner does not match");
  }
  const versions = new Set;
  const sequences = new Set;
  const digests = new Set;
  const headStates = new Set;
  const proofByIdentity = new Map;
  const proofIdentityByDigest = new Map;
  const immutableIdentity = stableTodosJson(first.identity);
  for (const [index, projection] of history.entries()) {
    if (versions.has(projection.version)) {
      addTransitionIssue(issues, `history.${index}.version`, "Projection versions cannot be reused");
    }
    if (sequences.has(projection.sequence)) {
      addTransitionIssue(issues, `history.${index}.sequence`, "Projection sequences cannot be reused");
    }
    if (digests.has(projection.digest)) {
      addTransitionIssue(issues, `history.${index}.digest`, "Projection digests cannot be reused");
    }
    versions.add(projection.version);
    sequences.add(projection.sequence);
    digests.add(projection.digest);
    if (stableTodosJson(projection.identity) !== immutableIdentity) {
      addTransitionIssue(issues, `history.${index}.identity`, "Projection identity must remain immutable across the complete history");
    }
    if (projection.owner !== first.owner || projection.id !== first.id) {
      addTransitionIssue(issues, `history.${index}.owner`, "Projection id and owner must remain immutable across the complete history");
    }
    const headKey = stableTodosJson(projection.head.branchHead);
    const previous = history[index - 1];
    if (previous && !sameTodosGitObjectId(previous.head.branchHead, projection.head.branchHead) && headStates.has(headKey)) {
      addTransitionIssue(issues, `history.${index}.head.branchHead`, "Projection history cannot return to a previously observed branch head");
    }
    headStates.add(headKey);
    for (const proof of proofSet(projection)) {
      const identityKey = proofIdentityKey(proof);
      const proofJson = stableTodosJson(proof);
      const existingProof = proofByIdentity.get(identityKey);
      if (existingProof !== undefined && existingProof !== proofJson) {
        addTransitionIssue(issues, `history.${index}.proofs`, "A proof reference cannot be reused for different proof content");
      }
      const existingIdentity = proofIdentityByDigest.get(proof.ref.digest);
      if (existingIdentity !== undefined && existingIdentity !== identityKey) {
        addTransitionIssue(issues, `history.${index}.proofs`, "A proof digest cannot be reused by a different proof reference");
      }
      proofByIdentity.set(identityKey, proofJson);
      proofIdentityByDigest.set(proof.ref.digest, identityKey);
    }
    if (previous) {
      const transition = validateTaskToPrProjectionTransition(previous, projection);
      if (!transition.success) {
        for (const issue of transition.issues) {
          addTransitionIssue(issues, `history.${index}.${issue.path}`, issue.reason);
        }
      } else if (transition.replayed) {
        addTransitionIssue(issues, `history.${index}`, "Projection history cannot contain duplicate replay records");
      }
    }
  }
  const head = history[history.length - 1];
  if (options.expectedHead && !sameTodosGitObjectId(head.head.branchHead, options.expectedHead)) {
    addTransitionIssue(issues, "history.head", "Projection history head is stale relative to the expected branch head");
  }
  if (issues.length > 0) {
    return {
      success: false,
      error: createTodosError("TODOS_PROJECTION_PREDECESSOR_CONFLICT", "Projection history violates full-chain integrity"),
      issues
    };
  }
  return { success: true, head };
}
var TODOS_PROJECTION_SCHEMAS = Object.freeze({
  [TODOS_PROJECTION_SCHEMA_IDS.projection]: TaskToPrProjectionSchema,
  [TODOS_PROJECTION_SCHEMA_IDS.transitionIssue]: TaskToPrTransitionIssueSchema
});

// src/todos/transfer-schema.ts
import * as z8 from "zod/v4";
var TODOS_TRANSFER_SCHEMA_IDS = {
  bundle: "hasna.todos.transfer_bundle.v1",
  validation: "hasna.todos.transfer_validation.v1",
  importPreview: "hasna.todos.transfer_import_preview.v1",
  importExecution: "hasna.todos.transfer_import_execution.v1",
  executionContext: "hasna.todos.transfer_execution_context.v1",
  checkpoint: "hasna.todos.transfer_checkpoint.v1",
  migrationReceipt: "hasna.todos.migration_receipt.v1"
};
var TODOS_TRANSFER_SECTION_NAMES = [
  "projects",
  "task_lists",
  "plans",
  "tasks",
  "comments",
  "dependencies",
  "activities",
  "verification_evidence",
  "task_files",
  "runs",
  "run_events",
  "run_commands",
  "run_files",
  "run_artifacts",
  "git_commits",
  "git_refs",
  "traceability",
  "task_to_pr_projections",
  "saved_views",
  "task_templates",
  "approvals",
  "deletion_records"
];
var TodosTransferSectionNameSchema = z8.enum(TODOS_TRANSFER_SECTION_NAMES);
var TodosPortableLogicalNameSchema = z8.string().min(1).max(512).refine((value) => !value.includes("/") && !value.includes("\\"), {
  message: "Portable logical names cannot contain path separators"
});
var TodosPortableCommandReceiptSchema = z8.strictObject({
  commandDigest: TodosSha256DigestSchema,
  argumentsDigest: TodosSha256DigestSchema.nullable(),
  exitCode: z8.number().int().nullable(),
  durationMs: z8.number().int().nonnegative().nullable(),
  outputRefs: z8.array(TodosContentRefSchema).max(1024)
});
var TodosPortableVerificationEvidenceSchema = TodosVerificationEvidenceSchema.omit({ commands: true }).extend({
  commandReceipts: z8.array(TodosPortableCommandReceiptSchema).max(256)
});
var TodosPortableTaskFileSchema = z8.strictObject({
  id: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  version: z8.number().int().positive(),
  createdAt: TodosTimestampSchema,
  updatedAt: TodosTimestampSchema,
  taskId: TodosEntityIdSchema,
  logicalName: TodosPortableLogicalNameSchema,
  contentRef: TodosContentRefSchema,
  purpose: z8.enum(["attachment", "evidence", "deliverable"])
});
var TodosPortableRunCommandSchema = z8.strictObject({
  id: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  version: z8.number().int().positive(),
  createdAt: TodosTimestampSchema,
  updatedAt: TodosTimestampSchema,
  runId: TodosEntityIdSchema,
  sequence: z8.number().int().nonnegative(),
  commandDigest: TodosSha256DigestSchema,
  argumentsDigest: TodosSha256DigestSchema.nullable(),
  exitCode: z8.number().int().nullable(),
  durationMs: z8.number().int().nonnegative().nullable(),
  outputRefs: z8.array(TodosContentRefSchema).max(1024),
  completedAt: TodosTimestampSchema.nullable()
});
var TodosPortableRunFileSchema = z8.strictObject({
  id: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  version: z8.number().int().positive(),
  createdAt: TodosTimestampSchema,
  updatedAt: TodosTimestampSchema,
  runId: TodosEntityIdSchema,
  logicalName: TodosPortableLogicalNameSchema,
  contentRef: TodosContentRefSchema,
  role: z8.enum(["input", "output", "evidence"])
});
var TodosPortableRunArtifactSchema = z8.strictObject({
  id: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  version: z8.number().int().positive(),
  createdAt: TodosTimestampSchema,
  updatedAt: TodosTimestampSchema,
  runId: TodosEntityIdSchema,
  logicalName: TodosPortableLogicalNameSchema,
  kind: z8.string().min(1).max(160).regex(/^[a-z][a-z0-9_.:-]*$/),
  contentRef: TodosContentRefSchema,
  verified: z8.boolean(),
  verificationEvidenceId: TodosEntityIdSchema.nullable()
});
var TodosPortableGitCommitSchema = z8.strictObject({
  id: TodosEntityIdSchema,
  owner: TodosOwnerIdSchema,
  version: z8.number().int().positive(),
  createdAt: TodosTimestampSchema,
  updatedAt: TodosTimestampSchema,
  repositoryRef: TodosExternalOwnerRefSchema,
  objectId: TodosGitObjectIdSchema,
  message: z8.string().min(1).max(20000),
  authorRef: TodosExternalOwnerRefSchema,
  committedAt: TodosTimestampSchema,
  changedFileDigests: z8.array(TodosSha256DigestSchema).max(50000)
});
function createTransferSectionSchema(recordSchema) {
  return z8.strictObject({
    owner: TodosOwnerIdSchema,
    count: z8.number().int().nonnegative(),
    digest: TodosSha256DigestSchema,
    records: z8.array(recordSchema)
  });
}
var TodosTransferSectionsSchema = z8.strictObject({
  projects: createTransferSectionSchema(TodosProjectSchema),
  task_lists: createTransferSectionSchema(TodosTaskListSchema),
  plans: createTransferSectionSchema(TodosPlanSchema),
  tasks: createTransferSectionSchema(TodosTaskSchema),
  comments: createTransferSectionSchema(TodosCommentSchema),
  dependencies: createTransferSectionSchema(TodosDependencySchema),
  activities: createTransferSectionSchema(TodosActivitySchema),
  verification_evidence: createTransferSectionSchema(TodosPortableVerificationEvidenceSchema),
  task_files: createTransferSectionSchema(TodosPortableTaskFileSchema),
  runs: createTransferSectionSchema(TodosRunSchema),
  run_events: createTransferSectionSchema(TodosRunEventSchema),
  run_commands: createTransferSectionSchema(TodosPortableRunCommandSchema),
  run_files: createTransferSectionSchema(TodosPortableRunFileSchema),
  run_artifacts: createTransferSectionSchema(TodosPortableRunArtifactSchema),
  git_commits: createTransferSectionSchema(TodosPortableGitCommitSchema),
  git_refs: createTransferSectionSchema(TodosGitRefSchema),
  traceability: createTransferSectionSchema(TodosTraceabilitySchema),
  task_to_pr_projections: createTransferSectionSchema(TaskToPrProjectionSchema),
  saved_views: createTransferSectionSchema(TodosSavedViewSchema),
  task_templates: createTransferSectionSchema(TodosTaskTemplateSchema),
  approvals: createTransferSectionSchema(TodosApprovalSchema),
  deletion_records: createTransferSectionSchema(TodosDeletionRecordSchema)
});
var TodosDependencyClosureEntrySchema = z8.strictObject({
  owner: TodosOwnerIdSchema,
  taskId: TodosEntityIdSchema,
  dependencyTaskIds: z8.array(TodosEntityIdSchema)
});
var TodosAttachmentContentReferenceSchema = z8.strictObject({
  owner: TodosOwnerIdSchema,
  source: z8.strictObject({
    section: z8.enum([
      "verification_evidence",
      "task_files",
      "run_commands",
      "run_files",
      "run_artifacts"
    ]),
    id: TodosEntityIdSchema
  }),
  index: z8.number().int().nonnegative(),
  contentRef: TodosContentRefSchema
});
var TodosTransferRecordRefSchema = z8.strictObject({
  owner: TodosOwnerIdSchema,
  section: TodosTransferSectionNameSchema,
  id: TodosEntityIdSchema,
  kind: z8.literal("task_to_pr_projection").optional(),
  version: z8.number().int().positive().optional(),
  digest: TodosSha256DigestSchema.optional()
});
var TodosTransferReferenceClosureEntrySchema = z8.strictObject({
  source: TodosTransferRecordRefSchema,
  references: z8.array(TodosTransferRecordRefSchema)
});
var TodosTransferReferenceOnlySchema = z8.strictObject({
  owner: TodosOwnerIdSchema,
  agentIds: z8.array(TodosEntityIdSchema),
  externalOwnerRefs: z8.array(TodosExternalOwnerRefSchema),
  ownerQualifiedRefs: z8.array(TodosOwnerQualifiedRefSchema)
});
var TodosTransferBundleSchema = z8.strictObject({
  schema: z8.literal(TODOS_TRANSFER_SCHEMA_IDS.bundle),
  version: z8.literal(TODOS_TRANSFER_VERSION),
  bundleId: TodosEntityIdSchema,
  createdAt: TodosTimestampSchema,
  source: z8.strictObject({
    authorityId: TodosOwnerIdSchema
  }),
  contractVersion: z8.literal(TODOS_CONTRACT_VERSION),
  contractDigest: TodosSha256DigestSchema,
  manifestVersion: z8.literal(TODOS_MANIFEST_VERSION),
  manifestDigest: TodosSha256DigestSchema,
  sections: TodosTransferSectionsSchema,
  dependencyClosure: z8.array(TodosDependencyClosureEntrySchema),
  referenceClosure: z8.array(TodosTransferReferenceClosureEntrySchema),
  attachmentContentReferences: z8.array(TodosAttachmentContentReferenceSchema),
  referenceOnly: TodosTransferReferenceOnlySchema,
  bundleChecksum: TodosSha256DigestSchema
}).superRefine((value, ctx) => {
  const expectedOwner = value.source.authorityId;
  const visit = (input, path) => {
    if (Array.isArray(input)) {
      input.forEach((entry, index) => visit(entry, [...path, index]));
      return;
    }
    if (!input || typeof input !== "object")
      return;
    for (const [key, entry] of Object.entries(input)) {
      const entryPath = [...path, key];
      if (key === "owner" && entry !== expectedOwner) {
        ctx.addIssue({
          code: "custom",
          message: "Every portable owner must equal the bundle source authority",
          path: entryPath
        });
      }
      visit(entry, entryPath);
    }
  };
  visit(value.sections, ["sections"]);
  visit(value.dependencyClosure, ["dependencyClosure"]);
  visit(value.referenceClosure, ["referenceClosure"]);
  visit(value.attachmentContentReferences, ["attachmentContentReferences"]);
  visit(value.referenceOnly, ["referenceOnly"]);
});
function createSection(owner, records) {
  const sortedRecords = sortTodosRecords(records);
  return {
    owner,
    count: sortedRecords.length,
    digest: sha256TodosValue(sortedRecords),
    records: sortedRecords
  };
}
function dependencyEdges(dependencies) {
  const edges = new Map;
  for (const dependency of dependencies) {
    const source = dependency.kind === "requires" ? dependency.sourceTaskId : dependency.targetTaskId;
    const target = dependency.kind === "requires" ? dependency.targetTaskId : dependency.sourceTaskId;
    const targets = edges.get(source) ?? new Set;
    targets.add(target);
    edges.set(source, targets);
  }
  return edges;
}
function computeTodosDependencyClosure(tasks, dependencies) {
  const edges = dependencyEdges(dependencies);
  const visit = (taskId, visited) => {
    const direct = edges.get(taskId) ?? new Set;
    for (const dependencyId of direct) {
      if (visited.has(dependencyId)) {
        continue;
      }
      visited.add(dependencyId);
      visit(dependencyId, visited);
    }
    return visited;
  };
  return [...tasks].sort((left, right) => left.id.localeCompare(right.id)).map((task) => ({
    owner: task.owner,
    taskId: task.id,
    dependencyTaskIds: [...visit(task.id, new Set)].sort((left, right) => left.localeCompare(right))
  }));
}
var OWNER_REF_KIND_TO_SECTION = Object.freeze({
  project: "projects",
  task_list: "task_lists",
  plan: "plans",
  task: "tasks",
  comment: "comments",
  dependency: "dependencies",
  activity: "activities",
  verification_evidence: "verification_evidence",
  task_file: "task_files",
  run: "runs",
  run_event: "run_events",
  run_command: "run_commands",
  run_file: "run_files",
  run_artifact: "run_artifacts",
  git_commit: "git_commits",
  git_ref: "git_refs",
  traceability: "traceability",
  task_to_pr_projection: "task_to_pr_projections",
  saved_view: "saved_views",
  task_template: "task_templates",
  approval: "approvals",
  deletion_record: "deletion_records"
});
function transferRecordKey(ref) {
  return stableTodosJson(ref);
}
function parseTransferRecordKey(key) {
  return TodosTransferRecordRefSchema.parse(JSON.parse(key));
}
function transferRecordRef(owner, section, id) {
  return { owner, section, id };
}
function projectionTransferRecordRef(owner, projection) {
  return {
    owner,
    section: "task_to_pr_projections",
    id: projection.id,
    kind: "task_to_pr_projection",
    version: projection.version,
    digest: projection.digest
  };
}
function ownerRefTarget(ref) {
  const section = OWNER_REF_KIND_TO_SECTION[ref.kind];
  return section ? { owner: ref.owner, section, id: ref.id } : null;
}
function computeTodosTransferReferenceClosure(sections) {
  const direct = new Map;
  const projectionsById = new Map;
  for (const sectionName of TODOS_TRANSFER_SECTION_NAMES) {
    const section = sections[sectionName];
    for (const record2 of section.records) {
      const ref = sectionName === "task_to_pr_projections" ? projectionTransferRecordRef(section.owner, record2) : transferRecordRef(section.owner, sectionName, record2.id);
      direct.set(transferRecordKey(ref), new Set);
      if (sectionName === "task_to_pr_projections") {
        const idKey = stableTodosJson({
          owner: section.owner,
          section: sectionName,
          id: record2.id
        });
        projectionsById.set(idKey, [
          ...projectionsById.get(idKey) ?? [],
          ref
        ]);
      }
    }
  }
  const addReference = (source, target) => {
    const sourceKey = transferRecordKey(source);
    const targets = direct.get(sourceKey) ?? new Set;
    targets.add(transferRecordKey(target));
    direct.set(sourceKey, targets);
  };
  const add = (sourceSection, sourceId, targetSection, targetId, targetOwner = sections[targetSection].owner) => {
    if (!targetId)
      return;
    const source = transferRecordRef(sections[sourceSection].owner, sourceSection, sourceId);
    const target = transferRecordRef(targetOwner, targetSection, targetId);
    if (targetSection === "task_to_pr_projections") {
      const projections = projectionsById.get(stableTodosJson(target));
      if (projections && projections.length > 0) {
        projections.forEach((projection) => addReference(source, projection));
        return;
      }
    }
    addReference(source, target);
  };
  const addOwnerRef = (sourceSection, sourceId, ref) => {
    if (!ref)
      return;
    const target = ownerRefTarget(ref);
    if (target)
      add(sourceSection, sourceId, target.section, target.id, target.owner);
  };
  for (const record2 of sections.task_lists.records) {
    add("task_lists", record2.id, "projects", record2.projectId);
  }
  for (const record2 of sections.plans.records) {
    add("plans", record2.id, "projects", record2.projectId);
    add("plans", record2.id, "task_lists", record2.taskListId);
    for (const taskId of record2.taskIds)
      add("plans", record2.id, "tasks", taskId);
  }
  for (const record2 of sections.tasks.records) {
    add("tasks", record2.id, "projects", record2.projectId);
    add("tasks", record2.id, "task_lists", record2.taskListId);
    add("tasks", record2.id, "plans", record2.planId);
    add("tasks", record2.id, "tasks", record2.parentTaskId);
  }
  for (const record2 of sections.comments.records) {
    add("comments", record2.id, "tasks", record2.taskId);
  }
  for (const record2 of sections.dependencies.records) {
    add("dependencies", record2.id, "tasks", record2.sourceTaskId);
    add("dependencies", record2.id, "tasks", record2.targetTaskId);
  }
  for (const record2 of sections.activities.records) {
    addOwnerRef("activities", record2.id, record2.resourceRef);
  }
  for (const record2 of sections.verification_evidence.records) {
    add("verification_evidence", record2.id, "tasks", record2.taskId);
    add("verification_evidence", record2.id, "runs", record2.runId);
  }
  for (const record2 of sections.task_files.records) {
    add("task_files", record2.id, "tasks", record2.taskId);
  }
  for (const record2 of sections.runs.records) {
    add("runs", record2.id, "plans", record2.planId);
    for (const taskId of record2.taskIds)
      add("runs", record2.id, "tasks", taskId);
  }
  for (const record2 of sections.run_events.records) {
    add("run_events", record2.id, "runs", record2.runId);
    for (const evidenceId of record2.evidenceIds) {
      add("run_events", record2.id, "verification_evidence", evidenceId);
    }
  }
  for (const record2 of sections.run_commands.records) {
    add("run_commands", record2.id, "runs", record2.runId);
  }
  for (const record2 of sections.run_files.records) {
    add("run_files", record2.id, "runs", record2.runId);
  }
  for (const record2 of sections.run_artifacts.records) {
    add("run_artifacts", record2.id, "runs", record2.runId);
    add("run_artifacts", record2.id, "verification_evidence", record2.verificationEvidenceId);
  }
  for (const record2 of sections.traceability.records) {
    add("traceability", record2.id, "tasks", record2.taskId);
    for (const id of record2.commitIds)
      add("traceability", record2.id, "git_commits", id);
    for (const id of record2.gitRefIds)
      add("traceability", record2.id, "git_refs", id);
    for (const id of record2.verificationEvidenceIds) {
      add("traceability", record2.id, "verification_evidence", id);
    }
    for (const id of record2.projectionIds) {
      add("traceability", record2.id, "task_to_pr_projections", id);
    }
  }
  for (const record2 of sections.task_to_pr_projections.records) {
    const source = projectionTransferRecordRef(sections.task_to_pr_projections.owner, record2);
    const taskTarget = ownerRefTarget(record2.identity.taskRef);
    if (taskTarget) {
      addReference(source, transferRecordRef(taskTarget.owner, taskTarget.section, taskTarget.id));
    }
    if (record2.predecessor) {
      addReference(source, {
        owner: record2.predecessor.owner,
        section: "task_to_pr_projections",
        id: record2.predecessor.projectionId,
        kind: record2.predecessor.kind,
        version: record2.predecessor.version,
        digest: record2.predecessor.digest
      });
    }
  }
  for (const record2 of sections.saved_views.records) {
    for (const id of record2.query.filters.projectIds)
      add("saved_views", record2.id, "projects", id);
    for (const id of record2.query.filters.taskListIds)
      add("saved_views", record2.id, "task_lists", id);
    for (const id of record2.query.filters.planIds)
      add("saved_views", record2.id, "plans", id);
  }
  for (const record2 of sections.approvals.records) {
    addOwnerRef("approvals", record2.id, record2.resourceRef);
  }
  const visit = (sourceKey) => {
    const visited = new Set([sourceKey]);
    const pending = [...direct.get(sourceKey) ?? []];
    while (pending.length > 0) {
      const target = pending.shift();
      if (visited.has(target))
        continue;
      visited.add(target);
      pending.push(...direct.get(target) ?? []);
    }
    visited.delete(sourceKey);
    return visited;
  };
  return [...direct.keys()].sort((left, right) => left.localeCompare(right)).map((sourceKey) => ({
    source: parseTransferRecordKey(sourceKey),
    references: [...visit(sourceKey)].sort((left, right) => left.localeCompare(right)).map(parseTransferRecordKey)
  }));
}
function externalOwnerRefKey(ref) {
  return `${ref.owner}\x00${ref.id}\x00${ref.digest}`;
}
function ownerQualifiedRefKey(ref) {
  return `${ref.owner}\x00${ref.kind}\x00${ref.id}\x00${ref.digest}`;
}
function deriveReferenceOnly(owner, input) {
  const agentIds = uniqueSortedTodosStrings([
    ...input.tasks.flatMap((task) => task.assignedAgentId ? [task.assignedAgentId] : []),
    ...input.runs.flatMap((run) => run.agentId ? [run.agentId] : []),
    ...input.saved_views.flatMap((view) => view.query.filters.agentIds)
  ]);
  const refs = [
    ...input.tasks.flatMap((task) => task.externalOwnerRefs),
    ...input.projects.flatMap((project) => project.repositoryRef ? [project.repositoryRef] : []),
    ...input.comments.map((comment) => comment.authorRef),
    ...input.activities.map((activity) => activity.actorRef),
    ...input.verification_evidence.map((evidence) => evidence.verifierRef),
    ...input.git_commits.flatMap((commit) => [commit.repositoryRef, commit.authorRef]),
    ...input.git_refs.map((ref) => ref.repositoryRef),
    ...input.approvals.flatMap((approval) => [
      approval.requestedBy,
      ...approval.decidedBy ? [approval.decidedBy] : []
    ])
  ];
  const byKey = new Map(refs.map((ref) => [externalOwnerRefKey(ref), ref]));
  const ownerQualifiedRefs = [
    ...input.activities.map((activity) => activity.resourceRef),
    ...input.approvals.map((approval) => approval.resourceRef),
    ...input.task_to_pr_projections.flatMap((projection) => [
      projection.identity.taskRef,
      projection.identity.repositoryRef,
      projection.identity.worktreeRef,
      projection.identity.branchRef,
      ...projection.pullRequestRef ? [projection.pullRequestRef] : [],
      ...projection.head.equalityProof ? [projection.head.equalityProof.ref] : [],
      ...projection.proofs.map((proof) => proof.ref)
    ])
  ].filter((ref) => ownerRefTarget(ref) === null);
  const ownerQualifiedByKey = new Map(ownerQualifiedRefs.map((ref) => [ownerQualifiedRefKey(ref), ref]));
  return {
    owner,
    agentIds,
    externalOwnerRefs: [...byKey.values()].sort((left, right) => externalOwnerRefKey(left).localeCompare(externalOwnerRefKey(right))),
    ownerQualifiedRefs: [...ownerQualifiedByKey.values()].sort((left, right) => ownerQualifiedRefKey(left).localeCompare(ownerQualifiedRefKey(right)))
  };
}
function deriveAttachmentContentReferences(owner, input) {
  return [
    ...input.verification_evidence.flatMap((evidence) => [
      ...evidence.contentRefs.map((contentRef, index) => ({
        owner,
        source: { section: "verification_evidence", id: evidence.id },
        index,
        contentRef
      })),
      ...evidence.commandReceipts.flatMap((receipt, receiptIndex) => receipt.outputRefs.map((contentRef, outputIndex) => ({
        owner,
        source: { section: "verification_evidence", id: evidence.id },
        index: evidence.contentRefs.length + receiptIndex * 1024 + outputIndex,
        contentRef
      })))
    ]),
    ...input.task_files.map((file) => ({
      owner,
      source: { section: "task_files", id: file.id },
      index: 0,
      contentRef: file.contentRef
    })),
    ...input.run_commands.flatMap((command) => command.outputRefs.map((contentRef, index) => ({
      owner,
      source: { section: "run_commands", id: command.id },
      index,
      contentRef
    }))),
    ...input.run_files.map((file) => ({
      owner,
      source: { section: "run_files", id: file.id },
      index: 0,
      contentRef: file.contentRef
    })),
    ...input.run_artifacts.map((artifact) => ({
      owner,
      source: { section: "run_artifacts", id: artifact.id },
      index: 0,
      contentRef: artifact.contentRef
    }))
  ].sort((left, right) => stableTodosJson(left).localeCompare(stableTodosJson(right)));
}
function unsignedTransferBundle(value) {
  const { bundleChecksum: _bundleChecksum, ...unsigned } = value;
  return unsigned;
}
function computeTodosTransferBundleChecksum(value) {
  return sha256TodosValue(value);
}
function createTodosTransferBundleWithDigests(input) {
  const owner = input.source.authorityId;
  const sections = {
    projects: createSection(owner, input.records.projects),
    task_lists: createSection(owner, input.records.task_lists),
    plans: createSection(owner, input.records.plans),
    tasks: createSection(owner, input.records.tasks),
    comments: createSection(owner, input.records.comments),
    dependencies: createSection(owner, input.records.dependencies),
    activities: createSection(owner, input.records.activities),
    verification_evidence: createSection(owner, input.records.verification_evidence),
    task_files: createSection(owner, input.records.task_files),
    runs: createSection(owner, input.records.runs),
    run_events: createSection(owner, input.records.run_events),
    run_commands: createSection(owner, input.records.run_commands),
    run_files: createSection(owner, input.records.run_files),
    run_artifacts: createSection(owner, input.records.run_artifacts),
    git_commits: createSection(owner, input.records.git_commits),
    git_refs: createSection(owner, input.records.git_refs),
    traceability: createSection(owner, input.records.traceability),
    task_to_pr_projections: createSection(owner, input.records.task_to_pr_projections),
    saved_views: createSection(owner, input.records.saved_views),
    task_templates: createSection(owner, input.records.task_templates),
    approvals: createSection(owner, input.records.approvals),
    deletion_records: createSection(owner, input.records.deletion_records)
  };
  const unsigned = {
    schema: TODOS_TRANSFER_SCHEMA_IDS.bundle,
    version: TODOS_TRANSFER_VERSION,
    bundleId: input.bundleId,
    createdAt: input.createdAt,
    source: input.source,
    contractVersion: TODOS_CONTRACT_VERSION,
    contractDigest: input.contractDigest,
    manifestVersion: TODOS_MANIFEST_VERSION,
    manifestDigest: input.manifestDigest,
    sections,
    dependencyClosure: computeTodosDependencyClosure(input.records.tasks, input.records.dependencies),
    referenceClosure: computeTodosTransferReferenceClosure(sections),
    attachmentContentReferences: deriveAttachmentContentReferences(owner, input.records),
    referenceOnly: deriveReferenceOnly(owner, input.records)
  };
  return TodosTransferBundleSchema.parse({
    ...unsigned,
    bundleChecksum: computeTodosTransferBundleChecksum(unsigned)
  });
}
var TodosTransferIssueSchema = z8.strictObject({
  code: z8.enum([
    "invalid_bundle",
    "canonical_digest_mismatch",
    "count_mismatch",
    "section_digest_mismatch",
    "bundle_checksum_mismatch",
    "duplicate_record",
    "classification_mismatch",
    "missing_reference",
    "projection_history_mismatch",
    "dependency_cycle",
    "closure_mismatch",
    "reference_closure_mismatch",
    "attachment_reference_mismatch",
    "deletion_redaction_failure"
  ]),
  path: z8.string().min(1).max(512),
  message: z8.string().min(1).max(2048),
  repairable: z8.boolean()
});
var TodosTransferConflictSchema = z8.strictObject({
  resourceKind: z8.string().min(1).max(64),
  resourceId: TodosEntityIdSchema,
  reason: z8.string().min(1).max(2048)
});
var TodosTransferRepairIssueSchema = z8.strictObject({
  section: TodosTransferSectionNameSchema,
  resourceId: TodosEntityIdSchema.nullable(),
  action: z8.enum([
    "supply_reference",
    "remove_cycle",
    "regenerate_digest",
    "regenerate_closure",
    "regenerate_reference_closure",
    "regenerate_classification"
  ]),
  reason: z8.string().min(1).max(2048)
});
var TodosTransferValidationSchema = z8.strictObject({
  schema: z8.literal(TODOS_TRANSFER_SCHEMA_IDS.validation),
  dryRun: z8.literal(true),
  valid: z8.boolean(),
  issues: z8.array(TodosTransferIssueSchema),
  conflicts: z8.array(TodosTransferConflictSchema),
  repairIssues: z8.array(TodosTransferRepairIssueSchema),
  verifiedCounts: z8.record(z8.string(), z8.number().int().nonnegative()),
  verifiedDigests: z8.record(z8.string(), TodosSha256DigestSchema)
});
function addTransferIssue(issues, code, path, message, repairable) {
  issues.push({ code, path, message, repairable });
}
function sectionRecords(bundle, section) {
  return bundle.sections[section].records;
}
var TRANSFER_SECTION_SCHEMA_IDS = Object.freeze({
  projects: TODOS_DOMAIN_SCHEMA_IDS.project,
  task_lists: TODOS_DOMAIN_SCHEMA_IDS.taskList,
  plans: TODOS_DOMAIN_SCHEMA_IDS.plan,
  tasks: TODOS_DOMAIN_SCHEMA_IDS.task,
  comments: TODOS_DOMAIN_SCHEMA_IDS.comment,
  dependencies: TODOS_DOMAIN_SCHEMA_IDS.dependency,
  activities: TODOS_DOMAIN_SCHEMA_IDS.activity,
  verification_evidence: TODOS_DOMAIN_SCHEMA_IDS.verificationEvidence,
  task_files: TODOS_DOMAIN_SCHEMA_IDS.taskFile,
  runs: TODOS_DOMAIN_SCHEMA_IDS.run,
  run_events: TODOS_DOMAIN_SCHEMA_IDS.runEvent,
  run_commands: TODOS_DOMAIN_SCHEMA_IDS.runCommand,
  run_files: TODOS_DOMAIN_SCHEMA_IDS.runFile,
  run_artifacts: TODOS_DOMAIN_SCHEMA_IDS.runArtifact,
  git_commits: TODOS_DOMAIN_SCHEMA_IDS.gitCommit,
  git_refs: TODOS_DOMAIN_SCHEMA_IDS.gitRef,
  traceability: TODOS_DOMAIN_SCHEMA_IDS.traceability,
  saved_views: TODOS_DOMAIN_SCHEMA_IDS.savedView,
  task_templates: TODOS_DOMAIN_SCHEMA_IDS.taskTemplate,
  approvals: TODOS_DOMAIN_SCHEMA_IDS.approval,
  deletion_records: TODOS_DOMAIN_SCHEMA_IDS.deletionRecord
});
function recordsFromBundle(bundle) {
  return Object.fromEntries(TODOS_TRANSFER_SECTION_NAMES.map((name) => [name, sectionRecords(bundle, name)]));
}
var TRANSFER_FIELD_CLASSIFICATION_OVERRIDES = Object.freeze({
  verification_evidence: Object.freeze({
    id: "portable",
    owner: "portable",
    version: "portable",
    createdAt: "portable",
    updatedAt: "portable",
    taskId: "portable",
    runId: "portable",
    verifierRef: "reference_only",
    status: "portable",
    summary: "portable",
    confidence: "portable",
    commandReceipts: "portable",
    checks: "portable",
    contentRefs: "portable",
    startedAt: "portable",
    completedAt: "portable"
  }),
  task_files: Object.freeze({
    id: "portable",
    owner: "portable",
    version: "portable",
    createdAt: "portable",
    updatedAt: "portable",
    taskId: "portable",
    logicalName: "portable",
    contentRef: "portable",
    purpose: "portable"
  }),
  run_commands: Object.freeze({
    id: "portable",
    owner: "portable",
    version: "portable",
    createdAt: "portable",
    updatedAt: "portable",
    runId: "portable",
    sequence: "portable",
    commandDigest: "portable",
    argumentsDigest: "portable",
    exitCode: "portable",
    durationMs: "portable",
    outputRefs: "portable",
    completedAt: "portable"
  }),
  run_files: Object.freeze({
    id: "portable",
    owner: "portable",
    version: "portable",
    createdAt: "portable",
    updatedAt: "portable",
    runId: "portable",
    logicalName: "portable",
    contentRef: "portable",
    role: "portable"
  }),
  run_artifacts: Object.freeze({
    id: "portable",
    owner: "portable",
    version: "portable",
    createdAt: "portable",
    updatedAt: "portable",
    runId: "portable",
    logicalName: "portable",
    kind: "portable",
    contentRef: "portable",
    verified: "portable",
    verificationEvidenceId: "portable"
  }),
  git_commits: Object.freeze({
    id: "portable",
    owner: "portable",
    version: "portable",
    createdAt: "portable",
    updatedAt: "portable",
    repositoryRef: "reference_only",
    objectId: "portable",
    message: "portable",
    authorRef: "reference_only",
    committedAt: "portable",
    changedFileDigests: "portable"
  }),
  task_to_pr_projections: Object.freeze({
    schema: "portable",
    id: "portable",
    owner: "portable",
    version: "portable",
    sequence: "portable",
    predecessor: "portable",
    identity: "portable",
    pullRequestRef: "portable",
    head: "portable",
    proofs: "portable",
    derivedAt: "portable",
    digest: "portable"
  })
});
function validateTransferClassification(bundle, issues, repairIssues) {
  for (const sectionName of TODOS_TRANSFER_SECTION_NAMES) {
    const records = bundle.sections[sectionName].records;
    const seenIds = new Set;
    for (const [index, record2] of records.entries()) {
      const recordId = typeof record2.id === "string" ? record2.id : null;
      const recordIdentity = sectionName === "task_to_pr_projections" && typeof record2.version === "number" ? `${recordId}\x00${record2.version}` : recordId;
      if (recordIdentity && seenIds.has(recordIdentity)) {
        addTransferIssue(issues, "duplicate_record", `sections.${sectionName}.records.${index}.id`, sectionName === "task_to_pr_projections" ? `Section contains duplicate projection id and version: ${recordId}@${record2.version}` : `Section contains duplicate record id: ${recordId}`, false);
      }
      if (recordIdentity)
        seenIds.add(recordIdentity);
      const schemaId = TRANSFER_SECTION_SCHEMA_IDS[sectionName];
      const classification = TRANSFER_FIELD_CLASSIFICATION_OVERRIDES[sectionName] ?? (schemaId ? TODOS_DOMAIN_FIELD_CLASSIFICATION[schemaId] : undefined);
      if (!classification)
        continue;
      for (const field of Object.keys(record2)) {
        const fieldClass = classification[field];
        if (!fieldClass || fieldClass === "excluded") {
          addTransferIssue(issues, "classification_mismatch", `sections.${sectionName}.records.${index}.${field}`, fieldClass === "excluded" ? "Excluded fields cannot enter a transfer bundle" : "Record field is absent from the transfer classification registry", false);
        }
      }
    }
  }
  const expectedReferenceOnly = deriveReferenceOnly(bundle.source.authorityId, recordsFromBundle(bundle));
  if (stableTodosJson(bundle.referenceOnly) !== stableTodosJson(expectedReferenceOnly)) {
    addTransferIssue(issues, "classification_mismatch", "referenceOnly", "Reference-only identities do not exactly match the classified record fields", true);
    repairIssues.push({
      section: "tasks",
      resourceId: null,
      action: "regenerate_classification",
      reason: "Recompute the reference-only identity inventory from classified fields"
    });
  }
}
function validateReferences(bundle, issues) {
  const existing = new Set;
  for (const sectionName of TODOS_TRANSFER_SECTION_NAMES) {
    for (const record2 of bundle.sections[sectionName].records) {
      const owner = bundle.sections[sectionName].owner;
      existing.add(transferRecordKey(transferRecordRef(owner, sectionName, record2.id)));
      if (sectionName === "task_to_pr_projections" && record2.version !== undefined && record2.digest !== undefined) {
        existing.add(transferRecordKey({
          owner,
          section: sectionName,
          id: record2.id,
          kind: "task_to_pr_projection",
          version: record2.version,
          digest: record2.digest
        }));
      }
    }
  }
  const expectedClosure = computeTodosTransferReferenceClosure(bundle.sections);
  for (const entry of expectedClosure) {
    for (const reference of entry.references) {
      if (!existing.has(transferRecordKey(reference))) {
        addTransferIssue(issues, "missing_reference", `referenceClosure.${entry.source.section}.${entry.source.id}`, `Referenced ${reference.section} record is missing: ${reference.id}`, true);
      }
    }
  }
}
function validateTransferredProjectionHistories(bundle, issues) {
  const histories = new Map;
  for (const projection of bundle.sections.task_to_pr_projections.records) {
    const key = stableTodosJson({
      owner: projection.owner,
      id: projection.id
    });
    histories.set(key, [
      ...histories.get(key) ?? [],
      projection
    ]);
  }
  for (const history of histories.values()) {
    const ordered = [...history].sort((left, right) => left.version - right.version);
    const result = validateTaskToPrProjectionHistory(ordered, {
      expectedOwner: bundle.source.authorityId
    });
    if (result.success)
      continue;
    for (const issue of result.issues) {
      addTransferIssue(issues, "projection_history_mismatch", `sections.task_to_pr_projections.${ordered[0]?.id ?? "unknown"}.${issue.path}`, issue.reason, false);
    }
  }
}
function closureContainsCycle(closure) {
  return closure.some((entry) => entry.dependencyTaskIds.includes(entry.taskId));
}
function validateTodosTransferBundleIntegrity(input) {
  const parsed = TodosTransferBundleSchema.safeParse(input);
  if (!parsed.success) {
    return TodosTransferValidationSchema.parse({
      schema: TODOS_TRANSFER_SCHEMA_IDS.validation,
      dryRun: true,
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "invalid_bundle",
        path: issue.path.join(".") || "bundle",
        message: issue.message,
        repairable: false
      })),
      conflicts: [],
      repairIssues: [],
      verifiedCounts: {},
      verifiedDigests: {}
    });
  }
  const bundle = parsed.data;
  const issues = [];
  const repairIssues = [];
  const verifiedCounts = {};
  const verifiedDigests = {};
  for (const sectionName of TODOS_TRANSFER_SECTION_NAMES) {
    const section = bundle.sections[sectionName];
    verifiedCounts[sectionName] = section.records.length;
    const digest = sha256TodosValue(section.records);
    verifiedDigests[sectionName] = digest;
    if (section.count !== section.records.length) {
      addTransferIssue(issues, "count_mismatch", `sections.${sectionName}.count`, "Section count does not match its records", true);
    }
    if (section.digest !== digest) {
      addTransferIssue(issues, "section_digest_mismatch", `sections.${sectionName}.digest`, "Section digest does not match its canonical records", true);
      repairIssues.push({
        section: sectionName,
        resourceId: null,
        action: "regenerate_digest",
        reason: "Recompute the section digest from canonical records"
      });
    }
  }
  const expectedBundleChecksum = computeTodosTransferBundleChecksum(unsignedTransferBundle(bundle));
  if (bundle.bundleChecksum !== expectedBundleChecksum) {
    addTransferIssue(issues, "bundle_checksum_mismatch", "bundleChecksum", "Bundle checksum does not match canonical bundle content", true);
  }
  validateTransferClassification(bundle, issues, repairIssues);
  validateReferences(bundle, issues);
  validateTransferredProjectionHistories(bundle, issues);
  const expectedClosure = computeTodosDependencyClosure(bundle.sections.tasks.records, bundle.sections.dependencies.records);
  if (closureContainsCycle(expectedClosure)) {
    addTransferIssue(issues, "dependency_cycle", "dependencyClosure", "Dependency graph contains a cycle", true);
    repairIssues.push({
      section: "dependencies",
      resourceId: null,
      action: "remove_cycle",
      reason: "Remove at least one dependency edge from every cycle"
    });
  }
  if (stableTodosJson(bundle.dependencyClosure) !== stableTodosJson(expectedClosure)) {
    addTransferIssue(issues, "closure_mismatch", "dependencyClosure", "Dependency closure does not match dependency records", true);
    repairIssues.push({
      section: "dependencies",
      resourceId: null,
      action: "regenerate_closure",
      reason: "Recompute transitive dependency closure"
    });
  }
  const expectedReferenceClosure = computeTodosTransferReferenceClosure(bundle.sections);
  if (stableTodosJson(bundle.referenceClosure) !== stableTodosJson(expectedReferenceClosure)) {
    addTransferIssue(issues, "reference_closure_mismatch", "referenceClosure", "Transitive reference closure does not match all portable foreign keys", true);
    repairIssues.push({
      section: "tasks",
      resourceId: null,
      action: "regenerate_reference_closure",
      reason: "Recompute the complete portable-record reference closure"
    });
  }
  const expectedAttachments = deriveAttachmentContentReferences(bundle.source.authorityId, recordsFromBundle(bundle));
  if (stableTodosJson(bundle.attachmentContentReferences) !== stableTodosJson(expectedAttachments)) {
    addTransferIssue(issues, "attachment_reference_mismatch", "attachmentContentReferences", "Attachment content references do not match file and artifact sections", true);
  }
  const attachmentSources = bundle.attachmentContentReferences.map((reference) => `${reference.owner}\x00${reference.source.section}\x00` + `${reference.source.id}\x00${reference.index}`);
  if (new Set(attachmentSources).size !== attachmentSources.length) {
    addTransferIssue(issues, "attachment_reference_mismatch", "attachmentContentReferences", "Attachment sources must each have exactly one content-addressed reference", false);
  }
  for (const [index, record2] of bundle.sections.deletion_records.records.entries()) {
    if (record2.redaction !== "full") {
      addTransferIssue(issues, "deletion_redaction_failure", `sections.deletion_records.records.${index}.redaction`, "Deletion records must remain fully redacted", false);
    }
  }
  return TodosTransferValidationSchema.parse({
    schema: TODOS_TRANSFER_SCHEMA_IDS.validation,
    dryRun: true,
    valid: issues.length === 0,
    issues,
    conflicts: [],
    repairIssues,
    verifiedCounts,
    verifiedDigests
  });
}
var TodosTransferImportPreviewSchema = z8.strictObject({
  schema: z8.literal(TODOS_TRANSFER_SCHEMA_IDS.importPreview),
  dryRun: z8.literal(true),
  sourceAuthorityId: TodosOwnerIdSchema,
  bundleId: TodosEntityIdSchema,
  bundleChecksum: TodosSha256DigestSchema,
  contractDigest: TodosSha256DigestSchema,
  manifestDigest: TodosSha256DigestSchema,
  targetAuthorityId: TodosOwnerIdSchema,
  importPlanId: TodosEntityIdSchema,
  valid: z8.boolean(),
  conflicts: z8.array(TodosTransferConflictSchema),
  repairIssues: z8.array(TodosTransferRepairIssueSchema),
  sectionCounts: z8.record(z8.string(), z8.number().int().nonnegative()),
  importPlanDigest: TodosSha256DigestSchema
}).superRefine((value, ctx) => {
  const expectedPlanId = computeTodosImportPlanId(value);
  if (value.importPlanId !== expectedPlanId) {
    ctx.addIssue({
      code: "custom",
      message: "Import plan id does not match its source, target, bundle, and canonical digests",
      path: ["importPlanId"]
    });
  }
  const {
    importPlanDigest: _importPlanDigest,
    ...unsigned
  } = value;
  if (value.importPlanDigest !== sha256TodosValue(unsigned)) {
    ctx.addIssue({
      code: "custom",
      message: "Import plan digest does not match canonical preview content",
      path: ["importPlanDigest"]
    });
  }
});
function computeTodosImportPlanId(input) {
  return `import-plan:${sha256TodosValue({
    sourceAuthorityId: input.sourceAuthorityId,
    targetAuthorityId: input.targetAuthorityId,
    bundleId: input.bundleId,
    bundleChecksum: input.bundleChecksum,
    contractDigest: input.contractDigest,
    manifestDigest: input.manifestDigest
  })}`;
}
function createTodosTransferImportPreviewIntegrity(bundle, targetAuthorityId, conflicts = [], validation = validateTodosTransferBundleIntegrity(bundle)) {
  const unsigned = {
    schema: TODOS_TRANSFER_SCHEMA_IDS.importPreview,
    dryRun: true,
    sourceAuthorityId: bundle.source.authorityId,
    bundleId: bundle.bundleId,
    bundleChecksum: bundle.bundleChecksum,
    contractDigest: bundle.contractDigest,
    manifestDigest: bundle.manifestDigest,
    targetAuthorityId,
    importPlanId: computeTodosImportPlanId({
      sourceAuthorityId: bundle.source.authorityId,
      targetAuthorityId,
      bundleId: bundle.bundleId,
      bundleChecksum: bundle.bundleChecksum,
      contractDigest: bundle.contractDigest,
      manifestDigest: bundle.manifestDigest
    }),
    valid: validation.valid && conflicts.length === 0,
    conflicts,
    repairIssues: validation.repairIssues,
    sectionCounts: validation.verifiedCounts
  };
  return TodosTransferImportPreviewSchema.parse({
    ...unsigned,
    importPlanDigest: sha256TodosValue(unsigned)
  });
}
var TodosTransferCheckpointSchema = z8.strictObject({
  schema: z8.literal(TODOS_TRANSFER_SCHEMA_IDS.checkpoint),
  sourceAuthorityId: TodosOwnerIdSchema,
  bundleId: TodosEntityIdSchema,
  bundleChecksum: TodosSha256DigestSchema,
  importPlanId: TodosEntityIdSchema,
  importPlanDigest: TodosSha256DigestSchema,
  contractDigest: TodosSha256DigestSchema,
  manifestDigest: TodosSha256DigestSchema,
  targetAuthorityId: TodosOwnerIdSchema,
  idempotencyKey: TodosIdempotencyKeySchema,
  sequence: z8.number().int().nonnegative(),
  completedSections: z8.array(TodosTransferSectionNameSchema),
  nextSection: TodosTransferSectionNameSchema.nullable(),
  state: z8.enum(["pending", "interrupted", "committed"]),
  digest: TodosSha256DigestSchema
}).superRefine((value, ctx) => {
  if (value.importPlanId !== computeTodosImportPlanId(value)) {
    ctx.addIssue({
      code: "custom",
      message: "Checkpoint import plan id does not match its source, target, bundle, and digests",
      path: ["importPlanId"]
    });
  }
  if (new Set(value.completedSections).size !== value.completedSections.length) {
    ctx.addIssue({
      code: "custom",
      message: "Checkpoint completed sections must be unique",
      path: ["completedSections"]
    });
  }
  const expectedCompleted = TODOS_TRANSFER_SECTION_NAMES.slice(0, value.completedSections.length);
  if (stableTodosJson(value.completedSections) !== stableTodosJson(expectedCompleted)) {
    ctx.addIssue({
      code: "custom",
      message: "Checkpoint completed sections must be the canonical section-order prefix",
      path: ["completedSections"]
    });
  }
  if (value.sequence !== value.completedSections.length) {
    ctx.addIssue({
      code: "custom",
      message: "Checkpoint sequence must equal the number of completed sections",
      path: ["sequence"]
    });
  }
  const expectedNext = TODOS_TRANSFER_SECTION_NAMES[value.completedSections.length] ?? null;
  if (value.state === "committed") {
    if (value.completedSections.length !== TODOS_TRANSFER_SECTION_NAMES.length || value.nextSection !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Committed checkpoints must contain every section and no next section",
        path: ["state"]
      });
    }
  } else if (value.nextSection !== expectedNext) {
    ctx.addIssue({
      code: "custom",
      message: "Non-terminal checkpoints must identify the next canonical section",
      path: ["nextSection"]
    });
  }
  if (value.state === "pending" && (value.sequence !== 0 || value.completedSections.length !== 0)) {
    ctx.addIssue({
      code: "custom",
      message: "Pending is the initial checkpoint state only",
      path: ["state"]
    });
  }
  if (value.state === "interrupted" && value.sequence === 0) {
    ctx.addIssue({
      code: "custom",
      message: "Interrupted checkpoints must contain completed progress",
      path: ["state"]
    });
  }
  const expected = sha256TodosValue({
    schema: value.schema,
    sourceAuthorityId: value.sourceAuthorityId,
    bundleId: value.bundleId,
    bundleChecksum: value.bundleChecksum,
    importPlanId: value.importPlanId,
    importPlanDigest: value.importPlanDigest,
    contractDigest: value.contractDigest,
    manifestDigest: value.manifestDigest,
    targetAuthorityId: value.targetAuthorityId,
    idempotencyKey: value.idempotencyKey,
    sequence: value.sequence,
    completedSections: value.completedSections,
    nextSection: value.nextSection,
    state: value.state
  });
  if (value.digest !== expected) {
    ctx.addIssue({
      code: "custom",
      message: "Checkpoint digest does not match canonical checkpoint content",
      path: ["digest"]
    });
  }
});
function createTodosTransferCheckpoint(input) {
  const unsigned = {
    schema: TODOS_TRANSFER_SCHEMA_IDS.checkpoint,
    ...input,
    completedSections: [...input.completedSections]
  };
  return TodosTransferCheckpointSchema.parse({
    ...unsigned,
    digest: sha256TodosValue(unsigned)
  });
}
function validateTodosTransferCheckpointTransition(previousInput, currentInput) {
  const previousParsed = TodosTransferCheckpointSchema.safeParse(previousInput);
  const currentParsed = TodosTransferCheckpointSchema.safeParse(currentInput);
  if (!previousParsed.success || !currentParsed.success) {
    return false;
  }
  const previous = previousParsed.data;
  const current = currentParsed.data;
  if (previous.bundleId !== current.bundleId || previous.sourceAuthorityId !== current.sourceAuthorityId || previous.bundleChecksum !== current.bundleChecksum || previous.importPlanId !== current.importPlanId || previous.importPlanDigest !== current.importPlanDigest || previous.contractDigest !== current.contractDigest || previous.manifestDigest !== current.manifestDigest || previous.targetAuthorityId !== current.targetAuthorityId || previous.idempotencyKey !== current.idempotencyKey || current.sequence !== previous.sequence + 1 || previous.state === "committed") {
    return false;
  }
  return current.completedSections.length === previous.completedSections.length + 1 && previous.completedSections.every((section, index) => current.completedSections[index] === section) && current.completedSections[current.completedSections.length - 1] === previous.nextSection;
}
var TodosTransferImportExecutionSchema = z8.strictObject({
  schema: z8.literal(TODOS_TRANSFER_SCHEMA_IDS.importExecution),
  sourceAuthorityId: TodosOwnerIdSchema,
  bundleId: TodosEntityIdSchema,
  bundleChecksum: TodosSha256DigestSchema,
  importPlanId: TodosEntityIdSchema,
  importPlanDigest: TodosSha256DigestSchema,
  contractDigest: TodosSha256DigestSchema,
  manifestDigest: TodosSha256DigestSchema,
  targetAuthorityId: TodosOwnerIdSchema,
  idempotencyKey: TodosIdempotencyKeySchema,
  checkpoint: TodosTransferCheckpointSchema.nullable()
}).superRefine((value, ctx) => {
  if (value.importPlanId !== computeTodosImportPlanId(value)) {
    ctx.addIssue({
      code: "custom",
      message: "Execution import plan id does not match its source, target, bundle, and digests",
      path: ["importPlanId"]
    });
  }
  if (!value.checkpoint)
    return;
  for (const [field, checkpointValue] of [
    ["sourceAuthorityId", value.checkpoint.sourceAuthorityId],
    ["bundleId", value.checkpoint.bundleId],
    ["bundleChecksum", value.checkpoint.bundleChecksum],
    ["importPlanId", value.checkpoint.importPlanId],
    ["importPlanDigest", value.checkpoint.importPlanDigest],
    ["contractDigest", value.checkpoint.contractDigest],
    ["manifestDigest", value.checkpoint.manifestDigest],
    ["targetAuthorityId", value.checkpoint.targetAuthorityId],
    ["idempotencyKey", value.checkpoint.idempotencyKey]
  ]) {
    if (value[field] !== checkpointValue) {
      ctx.addIssue({
        code: "custom",
        message: `Execution ${field} must match its checkpoint`,
        path: ["checkpoint", field]
      });
    }
  }
});
var TodosMigrationReceiptSchema = z8.strictObject({
  schema: z8.literal(TODOS_TRANSFER_SCHEMA_IDS.migrationReceipt),
  id: TodosEntityIdSchema,
  receiptSequence: z8.number().int().positive(),
  previousReceiptDigest: TodosSha256DigestSchema.nullable(),
  sourceAuthorityId: TodosOwnerIdSchema,
  targetAuthorityId: TodosOwnerIdSchema,
  bundleId: TodosEntityIdSchema,
  bundleChecksum: TodosSha256DigestSchema,
  importPlanId: TodosEntityIdSchema,
  importPlanDigest: TodosSha256DigestSchema,
  contractDigest: TodosSha256DigestSchema,
  manifestDigest: TodosSha256DigestSchema,
  idempotencyKey: TodosIdempotencyKeySchema,
  status: z8.literal("committed"),
  importedCounts: z8.record(z8.string(), z8.number().int().nonnegative()),
  checkpoint: TodosTransferCheckpointSchema,
  committedAt: TodosTimestampSchema,
  receiptDigest: TodosSha256DigestSchema
}).superRefine((value, ctx) => {
  if (value.receiptSequence === 1 && value.previousReceiptDigest !== null || value.receiptSequence > 1 && value.previousReceiptDigest === null) {
    ctx.addIssue({
      code: "custom",
      message: "Receipt sequence and previous receipt digest must form a chain",
      path: ["previousReceiptDigest"]
    });
  }
  if (value.checkpoint.state !== "committed" || value.checkpoint.sourceAuthorityId !== value.sourceAuthorityId || value.checkpoint.bundleId !== value.bundleId || value.checkpoint.bundleChecksum !== value.bundleChecksum || value.checkpoint.importPlanId !== value.importPlanId || value.checkpoint.importPlanDigest !== value.importPlanDigest || value.checkpoint.contractDigest !== value.contractDigest || value.checkpoint.manifestDigest !== value.manifestDigest || value.checkpoint.targetAuthorityId !== value.targetAuthorityId || value.checkpoint.idempotencyKey !== value.idempotencyKey) {
    ctx.addIssue({
      code: "custom",
      message: "Receipt must bind one committed terminal checkpoint",
      path: ["checkpoint"]
    });
  }
  const importedSections = Object.keys(value.importedCounts).sort((left, right) => left.localeCompare(right));
  const expectedSections = [...TODOS_TRANSFER_SECTION_NAMES].sort((left, right) => left.localeCompare(right));
  if (stableTodosJson(importedSections) !== stableTodosJson(expectedSections)) {
    ctx.addIssue({
      code: "custom",
      message: "Receipt imported counts must cover every portable section exactly",
      path: ["importedCounts"]
    });
  }
  const expected = sha256TodosValue({
    schema: value.schema,
    id: value.id,
    receiptSequence: value.receiptSequence,
    previousReceiptDigest: value.previousReceiptDigest,
    sourceAuthorityId: value.sourceAuthorityId,
    targetAuthorityId: value.targetAuthorityId,
    bundleId: value.bundleId,
    bundleChecksum: value.bundleChecksum,
    importPlanId: value.importPlanId,
    importPlanDigest: value.importPlanDigest,
    contractDigest: value.contractDigest,
    manifestDigest: value.manifestDigest,
    idempotencyKey: value.idempotencyKey,
    status: value.status,
    importedCounts: value.importedCounts,
    checkpoint: value.checkpoint,
    committedAt: value.committedAt
  });
  if (value.receiptDigest !== expected) {
    ctx.addIssue({
      code: "custom",
      message: "Receipt digest does not match canonical receipt content",
      path: ["receiptDigest"]
    });
  }
});
function createTodosMigrationReceipt(input) {
  const unsigned = {
    schema: TODOS_TRANSFER_SCHEMA_IDS.migrationReceipt,
    ...input,
    status: "committed"
  };
  return TodosMigrationReceiptSchema.parse({
    ...unsigned,
    receiptDigest: sha256TodosValue(unsigned)
  });
}
function migrationReceiptIdempotencyTuple(receipt) {
  return {
    sourceAuthorityId: receipt.sourceAuthorityId,
    targetAuthorityId: receipt.targetAuthorityId,
    bundleId: receipt.bundleId,
    bundleChecksum: receipt.bundleChecksum,
    importPlanId: receipt.importPlanId,
    importPlanDigest: receipt.importPlanDigest,
    contractDigest: receipt.contractDigest,
    manifestDigest: receipt.manifestDigest,
    terminalResult: {
      status: receipt.status,
      importedCounts: receipt.importedCounts,
      checkpointDigest: receipt.checkpoint.digest
    }
  };
}
function validateTodosMigrationReceiptChain(input) {
  if (!Array.isArray(input)) {
    return {
      success: false,
      action: "conflict",
      issues: ["Receipt chain must be an array"]
    };
  }
  const receipts = [];
  const issues = [];
  for (const [index, value] of input.entries()) {
    const parsed = TodosMigrationReceiptSchema.safeParse(value);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((issue) => `receipts.${index}.${issue.path.join(".")}: ${issue.message}`));
    } else {
      receipts.push(parsed.data);
    }
  }
  if (issues.length > 0) {
    return { success: false, action: "conflict", issues };
  }
  const ids = new Set;
  const digests = new Set;
  const receiptsByIdempotencyKey = new Map;
  const canonicalReceipts = [];
  let replayReceipt = null;
  for (const [index, receipt] of receipts.entries()) {
    const existingForKey = receiptsByIdempotencyKey.get(receipt.idempotencyKey);
    if (existingForKey) {
      if (stableTodosJson(existingForKey) === stableTodosJson(receipt)) {
        if (index !== receipts.length - 1) {
          issues.push(`receipts.${index}: an exact receipt replay cannot precede another chain entry`);
        } else {
          replayReceipt = existingForKey;
        }
      } else if (stableTodosJson(migrationReceiptIdempotencyTuple(existingForKey)) === stableTodosJson(migrationReceiptIdempotencyTuple(receipt))) {
        issues.push(`receipts.${index}.idempotencyKey: duplicate committed receipt for one canonical import tuple`);
      } else {
        issues.push(`receipts.${index}.idempotencyKey: key is already bound to a different canonical import tuple`);
      }
      continue;
    }
    if (ids.has(receipt.id)) {
      issues.push(`receipts.${index}.id: duplicate receipt id`);
    }
    if (digests.has(receipt.receiptDigest)) {
      issues.push(`receipts.${index}.receiptDigest: duplicate receipt digest`);
    }
    const previous = canonicalReceipts[canonicalReceipts.length - 1];
    if (canonicalReceipts.length === 0) {
      if (receipt.receiptSequence !== 1 || receipt.previousReceiptDigest !== null) {
        issues.push("receipts.0: chain must start at sequence one without a predecessor");
      }
    } else if (!previous || receipt.receiptSequence !== previous.receiptSequence + 1 || receipt.previousReceiptDigest !== previous.receiptDigest || receipt.sourceAuthorityId !== previous.sourceAuthorityId || receipt.targetAuthorityId !== previous.targetAuthorityId || receipt.contractDigest !== previous.contractDigest || receipt.manifestDigest !== previous.manifestDigest) {
      issues.push(`receipts.${index}: receipt predecessor linkage is invalid`);
    }
    ids.add(receipt.id);
    digests.add(receipt.receiptDigest);
    receiptsByIdempotencyKey.set(receipt.idempotencyKey, receipt);
    canonicalReceipts.push(receipt);
  }
  if (issues.length > 0) {
    return { success: false, action: "conflict", issues };
  }
  if (replayReceipt) {
    return {
      success: true,
      action: "replay",
      canonicalReceiptCount: canonicalReceipts.length,
      receipt: replayReceipt
    };
  }
  return {
    success: true,
    action: "valid",
    canonicalReceiptCount: canonicalReceipts.length
  };
}
var TodosTransferExecutionContextSchema = z8.discriminatedUnion("state", [
  z8.strictObject({
    state: z8.literal("uncommitted")
  }),
  z8.strictObject({
    state: z8.literal("committed"),
    receipt: TodosMigrationReceiptSchema
  })
]);
function evaluateTodosImportExecutionIntegrity(requestInput, contextInput) {
  const request = TodosTransferImportExecutionSchema.safeParse(requestInput);
  if (!request.success) {
    return {
      action: "reject",
      error: createTodosError("TODOS_TRANSFER_INVALID", "Import execution request is invalid")
    };
  }
  const context = TodosTransferExecutionContextSchema.safeParse(contextInput);
  if (!context.success) {
    return {
      action: "reject",
      error: createTodosError("TODOS_TRANSFER_INVALID", "Import execution context is invalid")
    };
  }
  if (context.data.state === "uncommitted") {
    return { action: "commit" };
  }
  const existingReceipt = context.data.receipt;
  if (existingReceipt.idempotencyKey !== request.data.idempotencyKey) {
    return { action: "commit" };
  }
  if (existingReceipt.sourceAuthorityId === request.data.sourceAuthorityId && existingReceipt.bundleId === request.data.bundleId && existingReceipt.bundleChecksum === request.data.bundleChecksum && existingReceipt.importPlanId === request.data.importPlanId && existingReceipt.importPlanDigest === request.data.importPlanDigest && existingReceipt.contractDigest === request.data.contractDigest && existingReceipt.manifestDigest === request.data.manifestDigest && existingReceipt.targetAuthorityId === request.data.targetAuthorityId) {
    return { action: "replay", receipt: existingReceipt };
  }
  return {
    action: "reject",
    error: createTodosError("TODOS_IDEMPOTENCY_CONFLICT", "The idempotency key is already committed for different import content")
  };
}
var TODOS_TRANSFER_CLASSIFICATION = Object.freeze({
  version: TODOS_TRANSFER_VERSION,
  portableSections: TODOS_TRANSFER_SECTION_NAMES,
  referenceOnly: Object.freeze([
    "agent_ids",
    "external_owner_ids",
    "owner_qualified_refs"
  ]),
  excludedCategories: Object.freeze([
    "credentials",
    "authentication_tokens",
    "session_state",
    "billing_records",
    "worker_state",
    "lease_state",
    "machine_topology",
    "process_configuration",
    "command_text",
    "command_arguments",
    "filesystem_paths",
    "storage_internals",
    "provider_internals"
  ]),
  fieldClassification: Object.freeze({
    ...TODOS_DOMAIN_FIELD_CLASSIFICATION,
    transferSections: Object.freeze({
      ...TRANSFER_FIELD_CLASSIFICATION_OVERRIDES
    })
  })
});
var TODOS_TRANSFER_SCHEMAS = Object.freeze({
  [TODOS_TRANSFER_SCHEMA_IDS.bundle]: TodosTransferBundleSchema,
  [TODOS_TRANSFER_SCHEMA_IDS.validation]: TodosTransferValidationSchema,
  [TODOS_TRANSFER_SCHEMA_IDS.importPreview]: TodosTransferImportPreviewSchema,
  [TODOS_TRANSFER_SCHEMA_IDS.importExecution]: TodosTransferImportExecutionSchema,
  [TODOS_TRANSFER_SCHEMA_IDS.executionContext]: TodosTransferExecutionContextSchema,
  [TODOS_TRANSFER_SCHEMA_IDS.checkpoint]: TodosTransferCheckpointSchema,
  [TODOS_TRANSFER_SCHEMA_IDS.migrationReceipt]: TodosMigrationReceiptSchema
});

// src/todos/operation-schemas.ts
var TODOS_COMMON_SCHEMA_IDS = {
  error: "hasna.todos.error.v1",
  mutationReceipt: "hasna.todos.mutation_receipt.v1"
};
var TODOS_REQUEST_SCHEMA_IDS = {
  empty: "hasna.todos.request.empty.v1",
  ref: "hasna.todos.request.ref.v1",
  versionedRef: "hasna.todos.request.versioned_ref.v1",
  list: "hasna.todos.request.list.v1",
  refList: "hasna.todos.request.ref_list.v1",
  existsMany: "hasna.todos.request.exists_many.v1",
  taskCreate: "hasna.todos.request.task_create.v1",
  taskUpsert: "hasna.todos.request.task_upsert.v1",
  taskUpdate: "hasna.todos.request.task_update.v1",
  taskBatch: "hasna.todos.request.task_batch.v1",
  taskStart: "hasna.todos.request.task_start.v1",
  taskComplete: "hasna.todos.request.task_complete.v1",
  taskFail: "hasna.todos.request.task_fail.v1",
  taskClaim: "hasna.todos.request.task_claim.v1",
  taskChanged: "hasna.todos.request.task_changed.v1",
  taskLock: "hasna.todos.request.task_lock.v1",
  commentCreate: "hasna.todos.request.comment_create.v1",
  dependencyCreate: "hasna.todos.request.dependency_create.v1",
  dependencyDelete: "hasna.todos.request.dependency_delete.v1",
  projectCreate: "hasna.todos.request.project_create.v1",
  projectUpdate: "hasna.todos.request.project_update.v1",
  projectRename: "hasna.todos.request.project_rename.v1",
  taskListCreate: "hasna.todos.request.task_list_create.v1",
  taskListUpdate: "hasna.todos.request.task_list_update.v1",
  planCreate: "hasna.todos.request.plan_create.v1",
  planUpdate: "hasna.todos.request.plan_update.v1",
  agentRegister: "hasna.todos.request.agent_register.v1",
  agentHeartbeat: "hasna.todos.request.agent_heartbeat.v1",
  agentRelease: "hasna.todos.request.agent_release.v1",
  search: "hasna.todos.request.search.v1",
  savedViewCreate: "hasna.todos.request.saved_view_create.v1",
  savedViewUpdate: "hasna.todos.request.saved_view_update.v1",
  savedViewExecute: "hasna.todos.request.saved_view_execute.v1",
  verificationCreate: "hasna.todos.request.verification_create.v1",
  verificationExport: "hasna.todos.request.verification_export.v1",
  taskFileRecord: "hasna.todos.request.task_file_record.v1",
  runStart: "hasna.todos.request.run_start.v1",
  runFinish: "hasna.todos.request.run_finish.v1",
  runEventCreate: "hasna.todos.request.run_event_create.v1",
  runCommandCreate: "hasna.todos.request.run_command_create.v1",
  runFileCreate: "hasna.todos.request.run_file_create.v1",
  runArtifactCreate: "hasna.todos.request.run_artifact_create.v1",
  runArtifactVerify: "hasna.todos.request.run_artifact_verify.v1",
  gitCommitLink: "hasna.todos.request.git_commit_link.v1",
  gitCommitUnlink: "hasna.todos.request.git_commit_unlink.v1",
  gitCommitFind: "hasna.todos.request.git_commit_find.v1",
  gitRefLink: "hasna.todos.request.git_ref_link.v1",
  gitRefFind: "hasna.todos.request.git_ref_find.v1",
  transferExport: "hasna.todos.request.transfer_export.v1",
  transferValidate: "hasna.todos.request.transfer_validate.v1",
  transferImportPreview: "hasna.todos.request.transfer_import_preview.v1",
  transferImportExecute: "hasna.todos.request.transfer_import_execute.v1",
  approvalRequest: "hasna.todos.request.approval_request.v1",
  approvalDecision: "hasna.todos.request.approval_decision.v1",
  approvalExpire: "hasna.todos.request.approval_expire.v1",
  taskTemplateCreate: "hasna.todos.request.task_template_create.v1",
  taskTemplateUpdate: "hasna.todos.request.task_template_update.v1",
  taskTemplateInstantiate: "hasna.todos.request.task_template_instantiate.v1",
  reportGenerate: "hasna.todos.request.report_generate.v1",
  workspaceBootstrap: "hasna.todos.request.workspace_bootstrap.v1",
  serverStart: "hasna.todos.request.server_start.v1",
  databaseBackup: "hasna.todos.request.database_backup.v1",
  databaseRestore: "hasna.todos.request.database_restore.v1",
  databaseCheck: "hasna.todos.request.database_check.v1",
  databaseCompact: "hasna.todos.request.database_compact.v1",
  upgradeValidate: "hasna.todos.request.upgrade_validate.v1",
  upgradeExecute: "hasna.todos.request.upgrade_execute.v1",
  projectionRebuild: "hasna.todos.request.projection_rebuild.v1"
};
var TODOS_RESPONSE_SCHEMA_IDS = {
  serviceStatus: "hasna.todos.response.service_status.v1",
  authority: "hasna.todos.response.authority.v1",
  artifactDocument: "hasna.todos.response.artifact_document.v1",
  capabilityPage: "hasna.todos.response.capability_page.v1",
  capability: "hasna.todos.response.capability.v1",
  taskPage: "hasna.todos.response.task_page.v1",
  task: "hasna.todos.response.task.v1",
  count: "hasna.todos.response.count.v1",
  existsMany: "hasna.todos.response.exists_many.v1",
  mutation: "hasna.todos.response.mutation.v1",
  batch: "hasna.todos.response.batch.v1",
  taskContext: "hasna.todos.response.task_context.v1",
  activityPage: "hasna.todos.response.activity_page.v1",
  commentPage: "hasna.todos.response.comment_page.v1",
  comment: "hasna.todos.response.comment.v1",
  dependencyPage: "hasna.todos.response.dependency_page.v1",
  dependency: "hasna.todos.response.dependency.v1",
  projectPage: "hasna.todos.response.project_page.v1",
  project: "hasna.todos.response.project.v1",
  taskListPage: "hasna.todos.response.task_list_page.v1",
  taskList: "hasna.todos.response.task_list.v1",
  planPage: "hasna.todos.response.plan_page.v1",
  plan: "hasna.todos.response.plan.v1",
  agentPage: "hasna.todos.response.agent_page.v1",
  agent: "hasna.todos.response.agent.v1",
  stats: "hasna.todos.response.stats.v1",
  savedViewPage: "hasna.todos.response.saved_view_page.v1",
  savedView: "hasna.todos.response.saved_view.v1",
  verificationPage: "hasna.todos.response.verification_page.v1",
  verification: "hasna.todos.response.verification.v1",
  verificationExport: "hasna.todos.response.verification_export.v1",
  taskFilePage: "hasna.todos.response.task_file_page.v1",
  taskFile: "hasna.todos.response.task_file.v1",
  runPage: "hasna.todos.response.run_page.v1",
  run: "hasna.todos.response.run.v1",
  runLedger: "hasna.todos.response.run_ledger.v1",
  runEventPage: "hasna.todos.response.run_event_page.v1",
  runEvent: "hasna.todos.response.run_event.v1",
  runCommandPage: "hasna.todos.response.run_command_page.v1",
  runCommand: "hasna.todos.response.run_command.v1",
  runFilePage: "hasna.todos.response.run_file_page.v1",
  runFile: "hasna.todos.response.run_file.v1",
  runArtifactPage: "hasna.todos.response.run_artifact_page.v1",
  runArtifact: "hasna.todos.response.run_artifact.v1",
  gitCommitPage: "hasna.todos.response.git_commit_page.v1",
  gitCommit: "hasna.todos.response.git_commit.v1",
  gitRefPage: "hasna.todos.response.git_ref_page.v1",
  gitRef: "hasna.todos.response.git_ref.v1",
  traceability: "hasna.todos.response.traceability.v1",
  projectionPage: "hasna.todos.response.projection_page.v1",
  projection: "hasna.todos.response.projection.v1",
  transferBundle: "hasna.todos.response.transfer_bundle.v1",
  transferValidation: "hasna.todos.response.transfer_validation.v1",
  transferImportPreview: "hasna.todos.response.transfer_import_preview.v1",
  migrationReceiptPage: "hasna.todos.response.migration_receipt_page.v1",
  migrationReceipt: "hasna.todos.response.migration_receipt.v1",
  deletionRecordPage: "hasna.todos.response.deletion_record_page.v1",
  deletionRecord: "hasna.todos.response.deletion_record.v1",
  approvalPage: "hasna.todos.response.approval_page.v1",
  approval: "hasna.todos.response.approval.v1",
  taskTemplatePage: "hasna.todos.response.task_template_page.v1",
  taskTemplate: "hasna.todos.response.task_template.v1",
  report: "hasna.todos.response.report.v1",
  serverStart: "hasna.todos.response.server_start.v1"
};
var EmptyRequestSchema = z9.strictObject({});
var RefRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema
});
var VersionedRefRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive()
});
var ListRequestSchema = z9.strictObject({
  cursor: TodosCursorSchema.nullable(),
  limit: z9.number().int().positive().max(500),
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  planId: TodosEntityIdSchema.nullable(),
  agentId: TodosEntityIdSchema.nullable(),
  status: z9.string().min(1).max(64).nullable(),
  changedAfter: TodosTimestampSchema.nullable()
});
var RefListRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  cursor: TodosCursorSchema.nullable(),
  limit: z9.number().int().positive().max(500)
});
var ExistsManyRequestSchema = z9.strictObject({
  refs: z9.array(TodosEntityIdSchema).min(1).max(1e4)
});
var TaskCreateInputSchema = z9.strictObject({
  title: z9.string().min(1).max(512),
  description: z9.string().max(1e5).nullable(),
  priority: TodosTaskPrioritySchema,
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  planId: TodosEntityIdSchema.nullable(),
  parentTaskId: TodosEntityIdSchema.nullable(),
  assignedAgentId: TodosEntityIdSchema.nullable(),
  fingerprint: z9.string().min(1).max(256).nullable(),
  tags: z9.array(z9.string().min(1).max(96)).max(128),
  acceptanceCriteria: z9.array(z9.string().min(1).max(4096)).max(256),
  dueAt: TodosTimestampSchema.nullable(),
  externalOwnerRefs: z9.array(TodosExternalOwnerRefSchema).max(64)
});
var TaskUpdateFieldsSchema = z9.strictObject({
  title: z9.string().min(1).max(512).optional(),
  description: z9.string().max(1e5).nullable().optional(),
  priority: TodosTaskPrioritySchema.optional(),
  projectId: TodosEntityIdSchema.nullable().optional(),
  taskListId: TodosEntityIdSchema.nullable().optional(),
  planId: TodosEntityIdSchema.nullable().optional(),
  parentTaskId: TodosEntityIdSchema.nullable().optional(),
  assignedAgentId: TodosEntityIdSchema.nullable().optional(),
  tags: z9.array(z9.string().min(1).max(96)).max(128).optional(),
  acceptanceCriteria: z9.array(z9.string().min(1).max(4096)).max(256).optional(),
  dueAt: TodosTimestampSchema.nullable().optional()
});
var TaskUpdateRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  changes: TaskUpdateFieldsSchema
}).superRefine((value, ctx) => {
  if (Object.keys(value.changes).length === 0) {
    ctx.addIssue({ code: "custom", message: "Task update requires at least one change", path: ["changes"] });
  }
});
var TaskUpsertRequestSchema = z9.strictObject({
  fingerprint: z9.string().min(1).max(256),
  create: TaskCreateInputSchema,
  update: TaskUpdateFieldsSchema,
  expectedVersion: z9.number().int().positive().nullable()
});
var TaskBatchItemSchema = z9.discriminatedUnion("action", [
  z9.strictObject({
    action: z9.literal("create"),
    input: TaskCreateInputSchema
  }),
  z9.strictObject({
    action: z9.literal("update"),
    ref: TodosEntityIdSchema,
    expectedVersion: z9.number().int().positive(),
    changes: TaskUpdateFieldsSchema
  }),
  z9.strictObject({
    action: z9.literal("delete"),
    ref: TodosEntityIdSchema,
    expectedVersion: z9.number().int().positive()
  })
]);
var TaskBatchRequestSchema = z9.strictObject({
  operations: z9.array(TaskBatchItemSchema).min(1).max(500)
});
var TaskTransitionShape = {
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  summary: z9.string().max(4096).nullable()
};
var TaskStartRequestSchema = z9.strictObject({
  ...TaskTransitionShape,
  targetStatus: z9.literal("in_progress")
});
var TaskCompleteRequestSchema = z9.strictObject({
  ...TaskTransitionShape,
  targetStatus: z9.literal("completed")
});
var TaskFailRequestSchema = z9.strictObject({
  ...TaskTransitionShape,
  targetStatus: z9.literal("failed")
});
var TaskClaimRequestSchema = z9.strictObject({
  agentId: TodosEntityIdSchema,
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  planId: TodosEntityIdSchema.nullable(),
  tags: z9.array(z9.string().min(1).max(96)).max(128)
});
var TaskChangedRequestSchema = z9.strictObject({
  changedAfter: TodosTimestampSchema,
  cursor: TodosCursorSchema.nullable(),
  limit: z9.number().int().positive().max(500)
});
var TaskLockRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  ownerRef: TodosExternalOwnerRefSchema,
  expectedVersion: z9.number().int().positive(),
  expiresAt: TodosTimestampSchema.nullable()
});
var CommentCreateRequestSchema = z9.strictObject({
  taskRef: TodosEntityIdSchema,
  authorRef: TodosExternalOwnerRefSchema,
  kind: z9.enum(["comment", "progress", "note"]),
  content: z9.string().min(1).max(1e5),
  progressPercent: z9.number().min(0).max(100).nullable()
});
var DependencyCreateRequestSchema = z9.strictObject({
  sourceTaskRef: TodosEntityIdSchema,
  targetTaskRef: TodosEntityIdSchema,
  kind: z9.enum(["requires", "blocks"])
});
var DependencyDeleteRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive()
});
var ProjectCreateRequestSchema = z9.strictObject({
  slug: TodosSlugSchema,
  name: z9.string().min(1).max(256),
  description: z9.string().max(20000).nullable(),
  repositoryRef: TodosExternalOwnerRefSchema.nullable()
});
var ProjectUpdateRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  name: z9.string().min(1).max(256).optional(),
  description: z9.string().max(20000).nullable().optional(),
  repositoryRef: TodosExternalOwnerRefSchema.nullable().optional()
});
var ProjectRenameRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  slug: TodosSlugSchema,
  name: z9.string().min(1).max(256).nullable()
});
var TaskListCreateRequestSchema = z9.strictObject({
  projectId: TodosEntityIdSchema.nullable(),
  slug: TodosSlugSchema,
  name: z9.string().min(1).max(256),
  description: z9.string().max(20000).nullable()
});
var TaskListUpdateRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  slug: TodosSlugSchema.optional(),
  name: z9.string().min(1).max(256).optional(),
  description: z9.string().max(20000).nullable().optional()
});
var PlanCreateRequestSchema = z9.strictObject({
  slug: TodosSlugSchema,
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  name: z9.string().min(1).max(256),
  description: z9.string().max(40000).nullable(),
  objective: z9.string().min(1).max(20000),
  taskIds: z9.array(TodosEntityIdSchema).max(1e4)
});
var PlanUpdateRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  name: z9.string().min(1).max(256).optional(),
  description: z9.string().max(40000).nullable().optional(),
  status: TodosPlanStatusSchema.optional(),
  objective: z9.string().min(1).max(20000).optional(),
  taskIds: z9.array(TodosEntityIdSchema).max(1e4).optional()
});
var AgentRegisterRequestSchema = z9.strictObject({
  id: TodosEntityIdSchema,
  displayName: z9.string().min(1).max(256),
  roles: z9.array(z9.enum(["customer_member", "customer_manager", "tenant_admin"])).min(1).max(32),
  activeProjectId: TodosEntityIdSchema.nullable(),
  activeTaskListId: TodosEntityIdSchema.nullable()
});
var AgentHeartbeatRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  observedAt: TodosTimestampSchema,
  activeProjectId: TodosEntityIdSchema.nullable(),
  activeTaskListId: TodosEntityIdSchema.nullable()
});
var AgentReleaseRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  releasedAt: TodosTimestampSchema
});
var SavedViewCreateRequestSchema = z9.strictObject({
  name: z9.string().min(1).max(256),
  description: z9.string().max(4096).nullable(),
  query: TodosSearchRequestSchema,
  audience: z9.enum(["private", "organization"])
});
var SavedViewUpdateRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  name: z9.string().min(1).max(256).optional(),
  description: z9.string().max(4096).nullable().optional(),
  query: TodosSearchRequestSchema.optional(),
  audience: z9.enum(["private", "organization"]).optional()
});
var SavedViewExecuteRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  cursor: TodosCursorSchema.nullable(),
  limit: z9.number().int().positive().max(500)
});
var VerificationCreateRequestSchema = z9.strictObject({
  taskId: TodosEntityIdSchema.nullable(),
  runId: TodosEntityIdSchema.nullable(),
  verifierRef: TodosExternalOwnerRefSchema,
  status: z9.enum(["passed", "failed", "inconclusive"]),
  summary: z9.string().min(1).max(20000),
  confidence: z9.number().min(0).max(1).nullable(),
  commands: z9.array(TodosVerificationCommandSchema).max(256),
  checks: z9.array(TodosVerificationCheckSchema).max(1e4),
  contentRefs: z9.array(TodosContentRefSchema).max(1e4),
  startedAt: TodosTimestampSchema,
  completedAt: TodosTimestampSchema.nullable()
});
var VerificationExportRequestSchema = z9.strictObject({
  taskId: TodosEntityIdSchema.nullable(),
  runId: TodosEntityIdSchema.nullable(),
  contentType: z9.literal("application/json")
});
var TaskFileRecordRequestSchema = z9.strictObject({
  taskId: TodosEntityIdSchema,
  logicalName: z9.string().min(1).max(512),
  relativePath: TodosRelativePathSchema.nullable(),
  contentRef: TodosContentRefSchema,
  purpose: z9.enum(["attachment", "evidence", "deliverable"])
});
var RunStartRequestSchema = z9.strictObject({
  objective: z9.string().min(1).max(20000),
  taskIds: z9.array(TodosEntityIdSchema).max(1e4),
  planId: TodosEntityIdSchema.nullable(),
  agentId: TodosEntityIdSchema.nullable()
});
var RunFinishRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  status: z9.enum(["succeeded", "failed", "cancelled"]),
  completedAt: TodosTimestampSchema,
  ledgerDigest: TodosSha256DigestSchema
});
var RunEventCreateRequestSchema = z9.strictObject({
  runId: TodosEntityIdSchema,
  sequence: z9.number().int().nonnegative(),
  type: z9.string().min(1).max(160).regex(/^[a-z][a-z0-9_.:-]*$/),
  summary: z9.string().min(1).max(20000),
  occurredAt: TodosTimestampSchema,
  evidenceIds: z9.array(TodosEntityIdSchema).max(1e4)
});
var RunCommandCreateRequestSchema = z9.strictObject({
  runId: TodosEntityIdSchema,
  sequence: z9.number().int().nonnegative(),
  command: z9.string().min(1).max(16000),
  exitCode: z9.number().int().nullable(),
  durationMs: z9.number().int().nonnegative().nullable(),
  outputRefs: z9.array(TodosContentRefSchema).max(1024),
  completedAt: TodosTimestampSchema.nullable()
});
var RunFileCreateRequestSchema = z9.strictObject({
  runId: TodosEntityIdSchema,
  logicalName: z9.string().min(1).max(512),
  relativePath: TodosRelativePathSchema.nullable(),
  contentRef: TodosContentRefSchema,
  role: z9.enum(["input", "output", "evidence"])
});
var RunArtifactCreateRequestSchema = z9.strictObject({
  runId: TodosEntityIdSchema,
  name: z9.string().min(1).max(512),
  kind: z9.string().min(1).max(160).regex(/^[a-z][a-z0-9_.:-]*$/),
  contentRef: TodosContentRefSchema
});
var RunArtifactVerifyRequestSchema = z9.strictObject({
  runId: TodosEntityIdSchema,
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  verificationEvidenceId: TodosEntityIdSchema
});
var GitCommitLinkRequestSchema = z9.strictObject({
  taskId: TodosEntityIdSchema,
  repositoryRef: TodosExternalOwnerRefSchema,
  objectId: TodosGitObjectIdSchema,
  message: z9.string().min(1).max(20000),
  authorRef: TodosExternalOwnerRefSchema,
  committedAt: TodosTimestampSchema,
  changedFiles: z9.array(TodosRelativePathSchema).max(50000)
});
var GitCommitUnlinkRequestSchema = z9.strictObject({
  taskId: TodosEntityIdSchema,
  commitRef: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive()
});
var GitCommitFindRequestSchema = z9.strictObject({
  repositoryRef: TodosExternalOwnerRefSchema,
  objectId: TodosGitObjectIdSchema
});
var GitRefLinkRequestSchema = z9.strictObject({
  taskId: TodosEntityIdSchema,
  repositoryRef: TodosExternalOwnerRefSchema,
  type: z9.enum(["branch", "tag", "pull_request"]),
  name: z9.string().min(1).max(512),
  target: TodosGitObjectIdSchema,
  published: z9.boolean(),
  providerObservedAt: TodosTimestampSchema.nullable()
});
var GitRefFindRequestSchema = z9.strictObject({
  repositoryRef: TodosExternalOwnerRefSchema,
  type: z9.enum(["branch", "tag", "pull_request"]),
  name: z9.string().min(1).max(512)
});
var TransferExportRequestSchema = z9.strictObject({
  bundleId: TodosEntityIdSchema,
  createdAt: TodosTimestampSchema,
  projectIds: z9.array(TodosEntityIdSchema).max(1e4),
  sectionNames: z9.array(z9.enum(TODOS_TRANSFER_SECTION_NAMES)).min(1)
});
var TransferValidateRequestSchema = z9.strictObject({
  bundle: TodosTransferBundleSchema,
  dryRun: z9.literal(true)
});
var TransferImportPreviewRequestSchema = z9.strictObject({
  bundle: TodosTransferBundleSchema,
  targetAuthorityId: TodosOwnerIdSchema,
  dryRun: z9.literal(true)
});
var TransferImportExecuteRequestSchema = z9.strictObject({
  bundle: TodosTransferBundleSchema,
  targetAuthorityId: TodosOwnerIdSchema,
  importPlanId: TodosEntityIdSchema,
  importPlanDigest: TodosSha256DigestSchema,
  checkpoint: TodosTransferCheckpointSchema.nullable()
}).superRefine((value, ctx) => {
  if (value.importPlanId !== computeTodosImportPlanId({
    sourceAuthorityId: value.bundle.source.authorityId,
    targetAuthorityId: value.targetAuthorityId,
    bundleId: value.bundle.bundleId,
    bundleChecksum: value.bundle.bundleChecksum,
    contractDigest: value.bundle.contractDigest,
    manifestDigest: value.bundle.manifestDigest
  })) {
    ctx.addIssue({
      code: "custom",
      message: "Transfer execution import plan id does not bind this bundle and target",
      path: ["importPlanId"]
    });
  }
  if (!value.checkpoint)
    return;
  if (value.checkpoint.bundleId !== value.bundle.bundleId || value.checkpoint.sourceAuthorityId !== value.bundle.source.authorityId || value.checkpoint.bundleChecksum !== value.bundle.bundleChecksum || value.checkpoint.contractDigest !== value.bundle.contractDigest || value.checkpoint.manifestDigest !== value.bundle.manifestDigest || value.checkpoint.importPlanId !== value.importPlanId || value.checkpoint.importPlanDigest !== value.importPlanDigest || value.checkpoint.targetAuthorityId !== value.targetAuthorityId) {
    ctx.addIssue({
      code: "custom",
      message: "Transfer execution checkpoint does not bind this bundle and import plan",
      path: ["checkpoint"]
    });
  }
});
var ApprovalRequestSchema = z9.strictObject({
  resourceRef: TodosOwnerQualifiedRefSchema,
  reason: z9.string().min(1).max(4096),
  requestedBy: TodosExternalOwnerRefSchema,
  expiresAt: TodosTimestampSchema.nullable()
});
var ApprovalDecisionRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  decidedBy: TodosExternalOwnerRefSchema,
  reason: z9.string().min(1).max(4096)
});
var ApprovalExpireRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  expiredAt: TodosTimestampSchema
});
var TaskTemplateCreateRequestSchema = z9.strictObject({
  name: z9.string().min(1).max(256),
  description: z9.string().max(4096).nullable(),
  titlePattern: z9.string().min(1).max(512),
  descriptionPattern: z9.string().max(20000).nullable(),
  priority: TodosTaskPrioritySchema,
  tags: z9.array(z9.string().min(1).max(96)).max(128),
  acceptanceCriteria: z9.array(z9.string().min(1).max(4096)).max(256)
});
var TaskTemplateUpdateRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  expectedVersion: z9.number().int().positive(),
  name: z9.string().min(1).max(256).optional(),
  description: z9.string().max(4096).nullable().optional(),
  titlePattern: z9.string().min(1).max(512).optional(),
  descriptionPattern: z9.string().max(20000).nullable().optional(),
  priority: TodosTaskPrioritySchema.optional(),
  tags: z9.array(z9.string().min(1).max(96)).max(128).optional(),
  acceptanceCriteria: z9.array(z9.string().min(1).max(4096)).max(256).optional()
});
var TaskTemplateInstantiateRequestSchema = z9.strictObject({
  ref: TodosEntityIdSchema,
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  planId: TodosEntityIdSchema.nullable(),
  variables: z9.record(z9.string(), z9.string().max(4096))
});
var ReportGenerateRequestSchema = z9.strictObject({
  kind: z9.enum(["task_summary", "plan_progress", "run_evidence", "traceability"]),
  projectId: TodosEntityIdSchema.nullable(),
  taskListId: TodosEntityIdSchema.nullable(),
  planId: TodosEntityIdSchema.nullable(),
  taskId: TodosEntityIdSchema.nullable(),
  asOf: TodosTimestampSchema
});
var WorkspaceBootstrapRequestSchema = z9.strictObject({
  projectSlug: TodosSlugSchema,
  projectName: z9.string().min(1).max(256),
  repositoryRef: TodosExternalOwnerRefSchema,
  createDefaultTaskList: z9.boolean()
});
var ServerStartRequestSchema = z9.strictObject({
  interface: z9.enum(["loopback", "workspace"]),
  port: z9.number().int().min(1024).max(65535),
  expectedState: z9.literal("stopped")
});
var DatabaseBackupRequestSchema = z9.strictObject({
  label: z9.string().min(1).max(256),
  createdAt: TodosTimestampSchema
});
var DatabaseRestoreRequestSchema = z9.strictObject({
  backupContentRef: TodosContentRefSchema,
  expectedCurrentDigest: TodosSha256DigestSchema
});
var DatabaseCheckRequestSchema = z9.strictObject({
  expectedSchemaVersion: z9.string().min(1).max(64)
});
var DatabaseCompactRequestSchema = z9.strictObject({
  expectedCurrentDigest: TodosSha256DigestSchema
});
var UpgradeValidateRequestSchema = z9.strictObject({
  targetVersion: z9.string().min(1).max(64),
  packageContentRef: TodosContentRefSchema,
  expectedContractVersion: z9.literal(TODOS_CONTRACT_VERSION)
});
var UpgradeExecuteRequestSchema = z9.strictObject({
  targetVersion: z9.string().min(1).max(64),
  packageContentRef: TodosContentRefSchema,
  validationDigest: TodosSha256DigestSchema
});
var ProjectionRebuildRequestSchema = z9.strictObject({
  taskRefs: z9.array(TodosEntityIdSchema).max(1e4),
  expectedManifestDigest: TodosSha256DigestSchema
});
var CountDataSchema = z9.strictObject({ count: z9.number().int().nonnegative() });
var ExistsManyDataSchema = z9.strictObject({
  results: z9.array(z9.strictObject({
    ref: TodosEntityIdSchema,
    exists: z9.boolean()
  })).min(1)
});
var BatchDataSchema = z9.strictObject({
  receipts: z9.array(TodosMutationReceiptSchema).min(1)
});
var ArtifactDocumentDataSchema = z9.strictObject({
  mediaType: z9.literal("application/json"),
  digest: TodosSha256DigestSchema,
  document: z9.record(z9.string(), z9.unknown())
});
var VerificationExportDataSchema = z9.strictObject({
  records: z9.array(TodosVerificationEvidenceSchema),
  digest: TodosSha256DigestSchema
});
var RunLedgerDataSchema = z9.strictObject({
  run: TodosRunSchema,
  events: z9.array(TodosRunEventSchema),
  commands: z9.array(TodosRunCommandSchema),
  files: z9.array(TodosRunFileSchema),
  artifacts: z9.array(TodosRunArtifactSchema),
  digest: TodosSha256DigestSchema
});
var ReportDataSchema = z9.strictObject({
  reportId: TodosEntityIdSchema,
  kind: z9.enum(["task_summary", "plan_progress", "run_evidence", "traceability"]),
  contentRef: TodosContentRefSchema,
  generatedAt: TodosTimestampSchema
});
var ServerStartDataSchema = z9.strictObject({
  authorityId: TodosOwnerIdSchema,
  interface: z9.enum(["loopback", "workspace"]),
  port: z9.number().int().min(1024).max(65535),
  state: z9.literal("started"),
  startedAt: TodosTimestampSchema
});
var TODOS_REQUEST_SCHEMAS = Object.freeze({
  [TODOS_REQUEST_SCHEMA_IDS.empty]: EmptyRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.ref]: RefRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.versionedRef]: VersionedRefRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.list]: ListRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.refList]: RefListRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.existsMany]: ExistsManyRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskCreate]: TaskCreateInputSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskUpsert]: TaskUpsertRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskUpdate]: TaskUpdateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskBatch]: TaskBatchRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskStart]: TaskStartRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskComplete]: TaskCompleteRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskFail]: TaskFailRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskClaim]: TaskClaimRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskChanged]: TaskChangedRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskLock]: TaskLockRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.commentCreate]: CommentCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.dependencyCreate]: DependencyCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.dependencyDelete]: DependencyDeleteRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.projectCreate]: ProjectCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.projectUpdate]: ProjectUpdateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.projectRename]: ProjectRenameRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskListCreate]: TaskListCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskListUpdate]: TaskListUpdateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.planCreate]: PlanCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.planUpdate]: PlanUpdateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.agentRegister]: AgentRegisterRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.agentHeartbeat]: AgentHeartbeatRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.agentRelease]: AgentReleaseRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.search]: TodosSearchRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.savedViewCreate]: SavedViewCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.savedViewUpdate]: SavedViewUpdateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.savedViewExecute]: SavedViewExecuteRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.verificationCreate]: VerificationCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.verificationExport]: VerificationExportRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskFileRecord]: TaskFileRecordRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.runStart]: RunStartRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.runFinish]: RunFinishRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.runEventCreate]: RunEventCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.runCommandCreate]: RunCommandCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.runFileCreate]: RunFileCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.runArtifactCreate]: RunArtifactCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.runArtifactVerify]: RunArtifactVerifyRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.gitCommitLink]: GitCommitLinkRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.gitCommitUnlink]: GitCommitUnlinkRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.gitCommitFind]: GitCommitFindRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.gitRefLink]: GitRefLinkRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.gitRefFind]: GitRefFindRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.transferExport]: TransferExportRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.transferValidate]: TransferValidateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.transferImportPreview]: TransferImportPreviewRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.transferImportExecute]: TransferImportExecuteRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.approvalRequest]: ApprovalRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.approvalDecision]: ApprovalDecisionRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.approvalExpire]: ApprovalExpireRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskTemplateCreate]: TaskTemplateCreateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskTemplateUpdate]: TaskTemplateUpdateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.taskTemplateInstantiate]: TaskTemplateInstantiateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.reportGenerate]: ReportGenerateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.workspaceBootstrap]: WorkspaceBootstrapRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.serverStart]: ServerStartRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.databaseBackup]: DatabaseBackupRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.databaseRestore]: DatabaseRestoreRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.databaseCheck]: DatabaseCheckRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.databaseCompact]: DatabaseCompactRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.upgradeValidate]: UpgradeValidateRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.upgradeExecute]: UpgradeExecuteRequestSchema,
  [TODOS_REQUEST_SCHEMA_IDS.projectionRebuild]: ProjectionRebuildRequestSchema
});
var TODOS_RESPONSE_SCHEMAS = Object.freeze({
  [TODOS_RESPONSE_SCHEMA_IDS.serviceStatus]: createTodosResultSchema(TodosServiceStatusSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.authority]: createTodosResultSchema(TodosAuthorityHandshakeSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.artifactDocument]: createTodosResultSchema(ArtifactDocumentDataSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.capabilityPage]: createTodosResultSchema(createTodosPageSchema(TodosCapabilitySchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.capability]: createTodosResultSchema(TodosCapabilitySchema),
  [TODOS_RESPONSE_SCHEMA_IDS.taskPage]: createTodosResultSchema(createTodosPageSchema(TodosTaskSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.task]: createTodosResultSchema(TodosTaskSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.count]: createTodosResultSchema(CountDataSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.existsMany]: createTodosResultSchema(ExistsManyDataSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.mutation]: createTodosResultSchema(TodosMutationReceiptSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.batch]: createTodosResultSchema(BatchDataSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.taskContext]: createTodosResultSchema(TodosTaskContextSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.activityPage]: createTodosResultSchema(createTodosPageSchema(TodosActivitySchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.commentPage]: createTodosResultSchema(createTodosPageSchema(TodosCommentSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.comment]: createTodosResultSchema(TodosCommentSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.dependencyPage]: createTodosResultSchema(createTodosPageSchema(TodosDependencySchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.dependency]: createTodosResultSchema(TodosDependencySchema),
  [TODOS_RESPONSE_SCHEMA_IDS.projectPage]: createTodosResultSchema(createTodosPageSchema(TodosProjectSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.project]: createTodosResultSchema(TodosProjectSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.taskListPage]: createTodosResultSchema(createTodosPageSchema(TodosTaskListSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.taskList]: createTodosResultSchema(TodosTaskListSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.planPage]: createTodosResultSchema(createTodosPageSchema(TodosPlanSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.plan]: createTodosResultSchema(TodosPlanSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.agentPage]: createTodosResultSchema(createTodosPageSchema(TodosAgentSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.agent]: createTodosResultSchema(TodosAgentSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.stats]: createTodosResultSchema(TodosStatsSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.savedViewPage]: createTodosResultSchema(createTodosPageSchema(TodosSavedViewSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.savedView]: createTodosResultSchema(TodosSavedViewSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.verificationPage]: createTodosResultSchema(createTodosPageSchema(TodosVerificationEvidenceSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.verification]: createTodosResultSchema(TodosVerificationEvidenceSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.verificationExport]: createTodosResultSchema(VerificationExportDataSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.taskFilePage]: createTodosResultSchema(createTodosPageSchema(TodosTaskFileSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.taskFile]: createTodosResultSchema(TodosTaskFileSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.runPage]: createTodosResultSchema(createTodosPageSchema(TodosRunSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.run]: createTodosResultSchema(TodosRunSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.runLedger]: createTodosResultSchema(RunLedgerDataSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.runEventPage]: createTodosResultSchema(createTodosPageSchema(TodosRunEventSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.runEvent]: createTodosResultSchema(TodosRunEventSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.runCommandPage]: createTodosResultSchema(createTodosPageSchema(TodosRunCommandSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.runCommand]: createTodosResultSchema(TodosRunCommandSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.runFilePage]: createTodosResultSchema(createTodosPageSchema(TodosRunFileSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.runFile]: createTodosResultSchema(TodosRunFileSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.runArtifactPage]: createTodosResultSchema(createTodosPageSchema(TodosRunArtifactSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.runArtifact]: createTodosResultSchema(TodosRunArtifactSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.gitCommitPage]: createTodosResultSchema(createTodosPageSchema(TodosGitCommitSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.gitCommit]: createTodosResultSchema(TodosGitCommitSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.gitRefPage]: createTodosResultSchema(createTodosPageSchema(TodosGitRefSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.gitRef]: createTodosResultSchema(TodosGitRefSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.traceability]: createTodosResultSchema(TodosTraceabilitySchema),
  [TODOS_RESPONSE_SCHEMA_IDS.projectionPage]: createTodosResultSchema(createTodosPageSchema(TaskToPrProjectionSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.projection]: createTodosResultSchema(TaskToPrProjectionSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.transferBundle]: createTodosResultSchema(TodosTransferBundleSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.transferValidation]: createTodosResultSchema(TodosTransferValidationSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.transferImportPreview]: createTodosResultSchema(TodosTransferImportPreviewSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.migrationReceiptPage]: createTodosResultSchema(createTodosPageSchema(TodosMigrationReceiptSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.migrationReceipt]: createTodosResultSchema(TodosMigrationReceiptSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.deletionRecordPage]: createTodosResultSchema(createTodosPageSchema(TodosDeletionRecordSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.deletionRecord]: createTodosResultSchema(TodosDeletionRecordSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.approvalPage]: createTodosResultSchema(createTodosPageSchema(TodosApprovalSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.approval]: createTodosResultSchema(TodosApprovalSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.taskTemplatePage]: createTodosResultSchema(createTodosPageSchema(TodosTaskTemplateSchema)),
  [TODOS_RESPONSE_SCHEMA_IDS.taskTemplate]: createTodosResultSchema(TodosTaskTemplateSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.report]: createTodosResultSchema(ReportDataSchema),
  [TODOS_RESPONSE_SCHEMA_IDS.serverStart]: createTodosResultSchema(ServerStartDataSchema)
});
var TODOS_COMMON_SCHEMAS = Object.freeze({
  [TODOS_COMMON_SCHEMA_IDS.error]: TodosErrorSchema,
  [TODOS_COMMON_SCHEMA_IDS.mutationReceipt]: TodosMutationReceiptSchema
});

// src/todos/provenance.ts
import * as z10 from "zod/v4";
var TODOS_PROVENANCE_SCHEMA_ID = "hasna.todos.contract_provenance.v1";
var TodosFrozenSourceSchema = z10.strictObject({
  repository: z10.string().min(1).max(160),
  commitSha: z10.string().regex(/^[a-f0-9]{40}$/),
  role: z10.enum([
    "contract_base",
    "open_todos_evidence",
    "platform_todos_evidence",
    "e_00115_projection_evidence"
  ])
});
var TodosSourceFreezeSchema = z10.strictObject({
  contracts: TodosFrozenSourceSchema,
  openTodos: TodosFrozenSourceSchema,
  platformTodos: TodosFrozenSourceSchema,
  e00115: TodosFrozenSourceSchema
});
var TODOS_SOURCE_FREEZE = TodosSourceFreezeSchema.parse({
  contracts: {
    repository: "hasna/contracts",
    commitSha: "0c8c5b4205ceaf16b1cee26c30199249055c934e",
    role: "contract_base"
  },
  openTodos: {
    repository: "hasna/todos",
    commitSha: "a18a8b797eb1b05e92964dbf8b036dde972c2314",
    role: "open_todos_evidence"
  },
  platformTodos: {
    repository: "hasna/platform-todos",
    commitSha: "3d0bb21d586eed553e9010fc1187b19415958394",
    role: "platform_todos_evidence"
  },
  e00115: {
    repository: "hasna/contracts",
    commitSha: "142e650c7f13d05ac145bd37e986e68909d571d2",
    role: "e_00115_projection_evidence"
  }
});
var TodosContractProvenanceSchema = z10.strictObject({
  schema: z10.literal(TODOS_PROVENANCE_SCHEMA_ID),
  sourceFreeze: TodosSourceFreezeSchema,
  surfaceMappings: z10.strictObject({
    status: z10.literal("required_target"),
    producerImplementationStatus: z10.literal("not_attested"),
    evidenceUse: z10.literal("design_input_only"),
    sharedHttpPrefix: z10.literal("/v1"),
    localTopologyHttpSurface: z10.null(),
    operatorAudienceIncluded: z10.literal(false)
  })
});
var TODOS_CONTRACT_PROVENANCE = TodosContractProvenanceSchema.parse({
  schema: TODOS_PROVENANCE_SCHEMA_ID,
  sourceFreeze: TODOS_SOURCE_FREEZE,
  surfaceMappings: {
    status: "required_target",
    producerImplementationStatus: "not_attested",
    evidenceUse: "design_input_only",
    sharedHttpPrefix: "/v1",
    localTopologyHttpSurface: null,
    operatorAudienceIncluded: false
  }
});
var TODOS_PROVENANCE_DIGEST = sha256TodosValue(TODOS_CONTRACT_PROVENANCE);
var TODOS_PROVENANCE_SCHEMAS = Object.freeze({
  [TODOS_PROVENANCE_SCHEMA_ID]: TodosContractProvenanceSchema
});

// src/todos/operations.ts
var TODOS_OPERATION_MANIFEST_SCHEMA_ID = "hasna.todos.operation_manifest.v1";
var TODOS_CAPABILITY_IDS = [
  "authority",
  "tasks",
  "projects",
  "task-lists",
  "plans",
  "agents",
  "comments",
  "dependencies",
  "activity",
  "search",
  "saved-views",
  "verification-evidence",
  "task-files",
  "runs",
  "git-traceability",
  "task-to-pr-projection",
  "transfer",
  "deletion-history",
  "cursor-pagination",
  "idempotency",
  "optimistic-concurrency",
  "typed-errors",
  "approvals",
  "task-templates",
  "reports"
];
var TodosCapabilityIdSchema = z11.enum(TODOS_CAPABILITY_IDS);
var TodosTargetSurfaceStatusShape = {
  status: z11.literal("required_target"),
  producerImplementationStatus: z11.literal("not_attested")
};
var TodosHttpSurfaceSchema = z11.strictObject({
  method: z11.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z11.string().min(1).max(512),
  ...TodosTargetSurfaceStatusShape
});
var TodosOperationSchema = z11.strictObject({
  id: z11.string().regex(/^todos\.[a-z0-9_]+(?:\.[a-z0-9_]+)+$/),
  resource: z11.string().min(1).max(96).regex(/^[a-z][a-z0-9_]*$/),
  action: z11.string().min(1).max(96).regex(/^[a-z][a-z0-9_]*$/),
  classification: z11.enum(["shared_customer", "local_topology_only"]),
  audience: TodosAudienceSchema,
  capabilityId: TodosCapabilityIdSchema,
  availability: z11.enum(["core", "gated"]),
  mutability: z11.enum(["read", "write", "delete", "topology"]),
  idempotency: z11.enum(["none", "optional", "required"]),
  concurrency: z11.enum(["none", "version", "lock", "precondition"]),
  concurrencyFields: z11.array(z11.string().regex(/^[a-z][A-Za-z0-9]*$/)).max(8),
  transition: z11.strictObject({
    machine: z11.literal("task_status"),
    targetStatus: z11.enum(["in_progress", "completed", "failed"])
  }).nullable(),
  pagination: z11.enum(["none", "cursor"]),
  requestSchemaId: z11.string().min(1),
  responseSchemaId: z11.string().min(1),
  errorSchemaId: z11.literal(TODOS_COMMON_SCHEMA_IDS.error),
  requiredScopes: z11.array(z11.string().regex(/^todos:[a-z0-9-]+:(?:read|write|admin)$/)).min(1),
  surfaces: z11.strictObject({
    cli: z11.strictObject({
      command: z11.string().min(1).max(256),
      ...TodosTargetSurfaceStatusShape
    }),
    mcp: z11.strictObject({
      tool: z11.string().min(1).max(256).regex(/^[a-z][a-z0-9_]*$/),
      ...TodosTargetSurfaceStatusShape
    }),
    sdk: z11.strictObject({
      method: z11.string().min(1).max(256).regex(/^[a-z][A-Za-z0-9.]*$/),
      ...TodosTargetSurfaceStatusShape
    }),
    http: TodosHttpSurfaceSchema.nullable()
  })
});
var TodosOperationManifestSchema = z11.strictObject({
  schema: z11.literal(TODOS_OPERATION_MANIFEST_SCHEMA_ID),
  version: z11.literal(TODOS_MANIFEST_VERSION),
  provenance: TodosContractProvenanceSchema,
  operations: z11.array(TodosOperationSchema).min(1)
}).superRefine((value, ctx) => {
  const operationIds = value.operations.map((operation) => operation.id);
  if (new Set(operationIds).size !== operationIds.length) {
    ctx.addIssue({ code: "custom", message: "Operation ids must be unique", path: ["operations"] });
  }
  const cliCommands = new Set;
  const mcpTools = new Set;
  const sdkMethods = new Set;
  const httpBindings = new Set;
  for (const [index, operation] of value.operations.entries()) {
    const expectedSurfaces = operationSurfaceNames(operation.id);
    if (operation.surfaces.cli.command !== expectedSurfaces.cli.command) {
      ctx.addIssue({
        code: "custom",
        message: "CLI mapping must be derived from the canonical semantic operation id",
        path: ["operations", index, "surfaces", "cli", "command"]
      });
    }
    if (operation.surfaces.mcp.tool !== expectedSurfaces.mcp.tool) {
      ctx.addIssue({
        code: "custom",
        message: "MCP mapping must be derived from the canonical semantic operation id",
        path: ["operations", index, "surfaces", "mcp", "tool"]
      });
    }
    if (operation.surfaces.sdk.method !== expectedSurfaces.sdk.method) {
      ctx.addIssue({
        code: "custom",
        message: "SDK mapping must be derived from the canonical semantic operation id",
        path: ["operations", index, "surfaces", "sdk", "method"]
      });
    }
    for (const [surfaceName, surfaceValue, seen] of [
      ["cli", operation.surfaces.cli.command, cliCommands],
      ["mcp", operation.surfaces.mcp.tool, mcpTools],
      ["sdk", operation.surfaces.sdk.method, sdkMethods]
    ]) {
      if (seen.has(surfaceValue)) {
        ctx.addIssue({
          code: "custom",
          message: `${surfaceName.toUpperCase()} mappings must be unique`,
          path: ["operations", index, "surfaces", surfaceName]
        });
      }
      seen.add(surfaceValue);
    }
    if (new Set(operation.requiredScopes).size !== operation.requiredScopes.length) {
      ctx.addIssue({
        code: "custom",
        message: "Required scopes must be unique",
        path: ["operations", index, "requiredScopes"]
      });
    }
    if (operation.classification === "shared_customer") {
      if (!operation.surfaces.http || !operation.surfaces.http.path.startsWith("/v1/")) {
        ctx.addIssue({
          code: "custom",
          message: "Shared customer operations require an HTTP path under /v1/",
          path: ["operations", index, "surfaces", "http"]
        });
      } else {
        const binding = `${operation.surfaces.http.method} ${operation.surfaces.http.path}`;
        if (httpBindings.has(binding)) {
          ctx.addIssue({
            code: "custom",
            message: "HTTP method and path mappings must be unique",
            path: ["operations", index, "surfaces", "http"]
          });
        }
        httpBindings.add(binding);
        if (operation.surfaces.http.path.includes("/api/")) {
          ctx.addIssue({
            code: "custom",
            message: "Customer HTTP mappings must not expose producer-specific /api routes",
            path: ["operations", index, "surfaces", "http", "path"]
          });
        }
      }
    } else {
      if (operation.surfaces.http !== null) {
        ctx.addIssue({
          code: "custom",
          message: "Local topology operations cannot have an HTTP mapping",
          path: ["operations", index, "surfaces", "http"]
        });
      }
    }
    if (operation.availability === "gated" && !["approvals", "task-templates", "reports"].includes(operation.capabilityId)) {
      ctx.addIssue({
        code: "custom",
        message: "Only declared gated capabilities may use gated availability",
        path: ["operations", index, "availability"]
      });
    }
    if (operation.mutability === "read") {
      if (operation.idempotency !== "none") {
        ctx.addIssue({
          code: "custom",
          message: "Read operations do not require mutation idempotency",
          path: ["operations", index, "idempotency"]
        });
      }
      if (operation.requiredScopes.some((scope) => scope.endsWith(":write"))) {
        ctx.addIssue({
          code: "custom",
          message: "Read operations cannot require write scopes",
          path: ["operations", index, "requiredScopes"]
        });
      }
    } else {
      if (operation.idempotency !== "required") {
        ctx.addIssue({
          code: "custom",
          message: "Write, delete, and topology operations require idempotency",
          path: ["operations", index, "idempotency"]
        });
      }
      if (operation.requiredScopes.some((scope) => scope.endsWith(":read"))) {
        ctx.addIssue({
          code: "custom",
          message: "Mutating operations cannot use read-only scopes",
          path: ["operations", index, "requiredScopes"]
        });
      }
    }
    if (operation.concurrency === "none" && operation.concurrencyFields.length !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "Operations without concurrency controls cannot declare concurrency fields",
        path: ["operations", index, "concurrencyFields"]
      });
    }
    if (operation.concurrency === "version") {
      if (operation.concurrencyFields.length !== 1 || operation.concurrencyFields[0] !== "expectedVersion") {
        ctx.addIssue({
          code: "custom",
          message: "Version concurrency requires request.expectedVersion",
          path: ["operations", index, "concurrencyFields"]
        });
      }
    } else if (operation.concurrency !== "none" && operation.concurrencyFields.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Lock and precondition concurrency require explicit request fields",
        path: ["operations", index, "concurrencyFields"]
      });
    }
    const requestSchema = TODOS_REQUEST_SCHEMAS[operation.requestSchemaId];
    if (!requestSchema) {
      ctx.addIssue({
        code: "custom",
        message: "Operation request schema is not registered",
        path: ["operations", index, "requestSchemaId"]
      });
    } else {
      const jsonSchema = z11.toJSONSchema(requestSchema, {
        unrepresentable: "any",
        cycles: "ref",
        reused: "ref"
      });
      const properties = jsonSchema.properties ?? {};
      const required = new Set(jsonSchema.required ?? []);
      for (const field of operation.concurrencyFields) {
        if (!(field in properties) || !required.has(field)) {
          ctx.addIssue({
            code: "custom",
            message: `Concurrency field ${field} must be a required request property`,
            path: ["operations", index, "concurrencyFields"]
          });
        }
      }
      const http = operation.surfaces.http;
      if (http) {
        for (const match of http.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
          const field = match[1];
          if (!(field in properties) || !required.has(field)) {
            ctx.addIssue({
              code: "custom",
              message: `HTTP path parameter ${field} must be a required request property`,
              path: ["operations", index, "surfaces", "http", "path"]
            });
          }
        }
      }
    }
    if (operation.transition) {
      const expectedAction = {
        in_progress: "start",
        completed: "complete",
        failed: "fail"
      }[operation.transition.targetStatus];
      if (operation.transition.machine !== "task_status" || operation.resource !== "tasks" || operation.action !== expectedAction || operation.concurrency !== "version") {
        ctx.addIssue({
          code: "custom",
          message: "Task transition metadata must bind start, complete, or fail with version concurrency",
          path: ["operations", index, "transition"]
        });
      }
    }
  }
});
function operationSurfaceNames(id) {
  const parts = id.split(".").slice(1);
  const [head = "operation", ...tail] = parts;
  const sdkTail = tail.map((part) => part.replace(/_([a-z])/g, (_match, char) => char.toUpperCase()));
  return {
    cli: {
      command: `todos ${parts.join(" ").replaceAll("_", "-")}`,
      status: "required_target",
      producerImplementationStatus: "not_attested"
    },
    mcp: {
      tool: id.replaceAll(".", "_"),
      status: "required_target",
      producerImplementationStatus: "not_attested"
    },
    sdk: {
      method: [head.replace(/_([a-z])/g, (_match, char) => char.toUpperCase()), ...sdkTail].join("."),
      status: "required_target",
      producerImplementationStatus: "not_attested"
    }
  };
}
function scopeFor(capabilityId, mutability, audience) {
  if (audience === "tenant_admin") {
    return `todos:${capabilityId}:admin`;
  }
  return `todos:${capabilityId}:${mutability === "read" ? "read" : "write"}`;
}
function shared(input) {
  const id = `todos.${input.resource}.${input.action}`;
  const mutability = input.mutability ?? "read";
  const audience = input.audience ?? "customer";
  const surfaces = operationSurfaceNames(id);
  const concurrency = input.concurrency ?? "none";
  return TodosOperationSchema.parse({
    id,
    resource: input.resource,
    action: input.action,
    classification: "shared_customer",
    audience,
    capabilityId: input.capabilityId,
    availability: input.availability ?? "core",
    mutability,
    idempotency: input.idempotency ?? (mutability === "read" ? "none" : "required"),
    concurrency,
    concurrencyFields: input.concurrencyFields ?? (concurrency === "version" ? ["expectedVersion"] : []),
    transition: input.transition ?? null,
    pagination: input.pagination ?? "none",
    requestSchemaId: input.requestSchemaId,
    responseSchemaId: input.responseSchemaId,
    errorSchemaId: TODOS_COMMON_SCHEMA_IDS.error,
    requiredScopes: [scopeFor(input.capabilityId, mutability, audience)],
    surfaces: {
      ...surfaces,
      http: {
        method: input.httpMethod,
        path: input.httpPath,
        status: "required_target",
        producerImplementationStatus: "not_attested"
      }
    }
  });
}
function localTopology(input) {
  const id = `todos.${input.resource}.${input.action}`;
  const mutability = input.mutability ?? "topology";
  const audience = input.audience ?? "tenant_admin";
  const concurrency = input.concurrency ?? "none";
  return TodosOperationSchema.parse({
    id,
    resource: input.resource,
    action: input.action,
    classification: "local_topology_only",
    audience,
    capabilityId: input.capabilityId,
    availability: input.availability ?? "core",
    mutability,
    idempotency: input.idempotency ?? (mutability === "read" ? "none" : "required"),
    concurrency,
    concurrencyFields: input.concurrencyFields ?? (concurrency === "version" ? ["expectedVersion"] : []),
    transition: input.transition ?? null,
    pagination: input.pagination ?? "none",
    requestSchemaId: input.requestSchemaId,
    responseSchemaId: input.responseSchemaId,
    errorSchemaId: TODOS_COMMON_SCHEMA_IDS.error,
    requiredScopes: [scopeFor(input.capabilityId, mutability, audience)],
    surfaces: {
      ...operationSurfaceNames(id),
      http: null
    }
  });
}
var RQ = TODOS_REQUEST_SCHEMA_IDS;
var RS = TODOS_RESPONSE_SCHEMA_IDS;
var operations = [
  shared({ resource: "service", action: "health", capabilityId: "authority", requestSchemaId: RQ.empty, responseSchemaId: RS.serviceStatus, httpMethod: "GET", httpPath: "/v1/service/health" }),
  shared({ resource: "service", action: "ready", capabilityId: "authority", requestSchemaId: RQ.empty, responseSchemaId: RS.serviceStatus, httpMethod: "GET", httpPath: "/v1/service/ready" }),
  shared({ resource: "service", action: "version", capabilityId: "authority", requestSchemaId: RQ.empty, responseSchemaId: RS.artifactDocument, httpMethod: "GET", httpPath: "/v1/service/version" }),
  shared({ resource: "authority", action: "get", capabilityId: "authority", requestSchemaId: RQ.empty, responseSchemaId: RS.authority, httpMethod: "GET", httpPath: "/v1/authority" }),
  shared({ resource: "manifest", action: "get", capabilityId: "authority", requestSchemaId: RQ.empty, responseSchemaId: RS.artifactDocument, httpMethod: "GET", httpPath: "/v1/manifest" }),
  shared({ resource: "openapi", action: "get", capabilityId: "authority", requestSchemaId: RQ.empty, responseSchemaId: RS.artifactDocument, httpMethod: "GET", httpPath: "/v1/openapi" }),
  shared({ resource: "capabilities", action: "list", capabilityId: "authority", requestSchemaId: RQ.list, responseSchemaId: RS.capabilityPage, httpMethod: "GET", httpPath: "/v1/capabilities", pagination: "cursor" }),
  shared({ resource: "capabilities", action: "get", capabilityId: "authority", requestSchemaId: RQ.ref, responseSchemaId: RS.capability, httpMethod: "GET", httpPath: "/v1/capabilities/{ref}" }),
  shared({ resource: "tasks", action: "list", capabilityId: "tasks", requestSchemaId: RQ.list, responseSchemaId: RS.taskPage, httpMethod: "GET", httpPath: "/v1/tasks", pagination: "cursor" }),
  shared({ resource: "tasks", action: "count", capabilityId: "tasks", requestSchemaId: RQ.list, responseSchemaId: RS.count, httpMethod: "GET", httpPath: "/v1/tasks/count" }),
  shared({ resource: "tasks", action: "exists_many", capabilityId: "tasks", requestSchemaId: RQ.existsMany, responseSchemaId: RS.existsMany, httpMethod: "POST", httpPath: "/v1/tasks/exists-many" }),
  shared({ resource: "tasks", action: "create", capabilityId: "tasks", requestSchemaId: RQ.taskCreate, responseSchemaId: RS.task, httpMethod: "POST", httpPath: "/v1/tasks", mutability: "write" }),
  shared({ resource: "tasks", action: "upsert", capabilityId: "tasks", requestSchemaId: RQ.taskUpsert, responseSchemaId: RS.task, httpMethod: "PUT", httpPath: "/v1/tasks/upsert", mutability: "write", concurrency: "version" }),
  shared({ resource: "tasks", action: "get", capabilityId: "tasks", requestSchemaId: RQ.ref, responseSchemaId: RS.task, httpMethod: "GET", httpPath: "/v1/tasks/{ref}" }),
  shared({ resource: "tasks", action: "update", capabilityId: "tasks", requestSchemaId: RQ.taskUpdate, responseSchemaId: RS.task, httpMethod: "PATCH", httpPath: "/v1/tasks/{ref}", mutability: "write", concurrency: "version" }),
  shared({ resource: "tasks", action: "delete", capabilityId: "tasks", requestSchemaId: RQ.versionedRef, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/tasks/{ref}", mutability: "delete", concurrency: "version" }),
  shared({ resource: "tasks", action: "batch", capabilityId: "tasks", requestSchemaId: RQ.taskBatch, responseSchemaId: RS.batch, httpMethod: "POST", httpPath: "/v1/tasks/batch", mutability: "write", concurrency: "precondition", concurrencyFields: ["operations"] }),
  shared({ resource: "tasks", action: "start", capabilityId: "tasks", requestSchemaId: RQ.taskStart, responseSchemaId: RS.task, httpMethod: "POST", httpPath: "/v1/tasks/{ref}/start", mutability: "write", concurrency: "version", transition: { machine: "task_status", targetStatus: "in_progress" } }),
  shared({ resource: "tasks", action: "complete", capabilityId: "tasks", requestSchemaId: RQ.taskComplete, responseSchemaId: RS.task, httpMethod: "POST", httpPath: "/v1/tasks/{ref}/complete", mutability: "write", concurrency: "version", transition: { machine: "task_status", targetStatus: "completed" } }),
  shared({ resource: "tasks", action: "fail", capabilityId: "tasks", requestSchemaId: RQ.taskFail, responseSchemaId: RS.task, httpMethod: "POST", httpPath: "/v1/tasks/{ref}/fail", mutability: "write", concurrency: "version", transition: { machine: "task_status", targetStatus: "failed" } }),
  shared({ resource: "tasks", action: "claim_next", capabilityId: "tasks", requestSchemaId: RQ.taskClaim, responseSchemaId: RS.task, httpMethod: "POST", httpPath: "/v1/tasks/claim-next", mutability: "write", concurrency: "lock", concurrencyFields: ["agentId"] }),
  shared({ resource: "tasks", action: "next", capabilityId: "tasks", requestSchemaId: RQ.list, responseSchemaId: RS.task, httpMethod: "GET", httpPath: "/v1/tasks/next" }),
  shared({ resource: "tasks", action: "list_ready", capabilityId: "tasks", requestSchemaId: RQ.list, responseSchemaId: RS.taskPage, httpMethod: "GET", httpPath: "/v1/tasks/ready", pagination: "cursor" }),
  shared({ resource: "tasks", action: "list_active", capabilityId: "tasks", requestSchemaId: RQ.list, responseSchemaId: RS.taskPage, httpMethod: "GET", httpPath: "/v1/tasks/active", pagination: "cursor" }),
  shared({ resource: "tasks", action: "list_changed", capabilityId: "tasks", requestSchemaId: RQ.taskChanged, responseSchemaId: RS.taskPage, httpMethod: "GET", httpPath: "/v1/tasks/changed", pagination: "cursor" }),
  shared({ resource: "tasks", action: "lock", capabilityId: "tasks", requestSchemaId: RQ.taskLock, responseSchemaId: RS.mutation, httpMethod: "POST", httpPath: "/v1/tasks/{ref}/lock", mutability: "write", concurrency: "lock", concurrencyFields: ["ownerRef", "expectedVersion"] }),
  shared({ resource: "tasks", action: "unlock", capabilityId: "tasks", requestSchemaId: RQ.taskLock, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/tasks/{ref}/lock", mutability: "write", concurrency: "lock", concurrencyFields: ["ownerRef", "expectedVersion"] }),
  shared({ resource: "tasks", action: "get_context", capabilityId: "tasks", requestSchemaId: RQ.ref, responseSchemaId: RS.taskContext, httpMethod: "GET", httpPath: "/v1/tasks/{ref}/context" }),
  shared({ resource: "history", action: "list", capabilityId: "activity", requestSchemaId: RQ.refList, responseSchemaId: RS.activityPage, httpMethod: "GET", httpPath: "/v1/tasks/{ref}/history", pagination: "cursor" }),
  shared({ resource: "comments", action: "list", capabilityId: "comments", requestSchemaId: RQ.refList, responseSchemaId: RS.commentPage, httpMethod: "GET", httpPath: "/v1/tasks/{ref}/comments", pagination: "cursor" }),
  shared({ resource: "comments", action: "create", capabilityId: "comments", requestSchemaId: RQ.commentCreate, responseSchemaId: RS.comment, httpMethod: "POST", httpPath: "/v1/tasks/{taskRef}/comments", mutability: "write" }),
  shared({ resource: "dependencies", action: "list", capabilityId: "dependencies", requestSchemaId: RQ.refList, responseSchemaId: RS.dependencyPage, httpMethod: "GET", httpPath: "/v1/tasks/{ref}/dependencies", pagination: "cursor" }),
  shared({ resource: "dependencies", action: "list_all", capabilityId: "dependencies", requestSchemaId: RQ.list, responseSchemaId: RS.dependencyPage, httpMethod: "GET", httpPath: "/v1/dependencies", pagination: "cursor" }),
  shared({ resource: "dependencies", action: "create", capabilityId: "dependencies", requestSchemaId: RQ.dependencyCreate, responseSchemaId: RS.dependency, httpMethod: "POST", httpPath: "/v1/dependencies", mutability: "write" }),
  shared({ resource: "dependencies", action: "delete", capabilityId: "dependencies", requestSchemaId: RQ.dependencyDelete, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/dependencies/{ref}", mutability: "delete", concurrency: "version" }),
  shared({ resource: "projects", action: "list", capabilityId: "projects", requestSchemaId: RQ.list, responseSchemaId: RS.projectPage, httpMethod: "GET", httpPath: "/v1/projects", pagination: "cursor" }),
  shared({ resource: "projects", action: "create", capabilityId: "projects", requestSchemaId: RQ.projectCreate, responseSchemaId: RS.project, httpMethod: "POST", httpPath: "/v1/projects", mutability: "write" }),
  shared({ resource: "projects", action: "get", capabilityId: "projects", requestSchemaId: RQ.ref, responseSchemaId: RS.project, httpMethod: "GET", httpPath: "/v1/projects/{ref}" }),
  shared({ resource: "projects", action: "update", capabilityId: "projects", requestSchemaId: RQ.projectUpdate, responseSchemaId: RS.project, httpMethod: "PATCH", httpPath: "/v1/projects/{ref}", mutability: "write", concurrency: "version" }),
  shared({ resource: "projects", action: "rename", capabilityId: "projects", requestSchemaId: RQ.projectRename, responseSchemaId: RS.project, httpMethod: "POST", httpPath: "/v1/projects/{ref}/rename", mutability: "write", concurrency: "version" }),
  shared({ resource: "projects", action: "delete", capabilityId: "projects", requestSchemaId: RQ.versionedRef, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/projects/{ref}", mutability: "delete", concurrency: "version" }),
  shared({ resource: "task_lists", action: "list", capabilityId: "task-lists", requestSchemaId: RQ.list, responseSchemaId: RS.taskListPage, httpMethod: "GET", httpPath: "/v1/task-lists", pagination: "cursor" }),
  shared({ resource: "task_lists", action: "create", capabilityId: "task-lists", requestSchemaId: RQ.taskListCreate, responseSchemaId: RS.taskList, httpMethod: "POST", httpPath: "/v1/task-lists", mutability: "write" }),
  shared({ resource: "task_lists", action: "get", capabilityId: "task-lists", requestSchemaId: RQ.ref, responseSchemaId: RS.taskList, httpMethod: "GET", httpPath: "/v1/task-lists/{ref}" }),
  shared({ resource: "task_lists", action: "update", capabilityId: "task-lists", requestSchemaId: RQ.taskListUpdate, responseSchemaId: RS.taskList, httpMethod: "PATCH", httpPath: "/v1/task-lists/{ref}", mutability: "write", concurrency: "version" }),
  shared({ resource: "task_lists", action: "delete", capabilityId: "task-lists", requestSchemaId: RQ.versionedRef, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/task-lists/{ref}", mutability: "delete", concurrency: "version" }),
  shared({ resource: "plans", action: "list", capabilityId: "plans", requestSchemaId: RQ.list, responseSchemaId: RS.planPage, httpMethod: "GET", httpPath: "/v1/plans", pagination: "cursor" }),
  shared({ resource: "plans", action: "create", capabilityId: "plans", requestSchemaId: RQ.planCreate, responseSchemaId: RS.plan, httpMethod: "POST", httpPath: "/v1/plans", mutability: "write" }),
  shared({ resource: "plans", action: "get", capabilityId: "plans", requestSchemaId: RQ.ref, responseSchemaId: RS.plan, httpMethod: "GET", httpPath: "/v1/plans/{ref}" }),
  shared({ resource: "plans", action: "update", capabilityId: "plans", requestSchemaId: RQ.planUpdate, responseSchemaId: RS.plan, httpMethod: "PATCH", httpPath: "/v1/plans/{ref}", mutability: "write", concurrency: "version" }),
  shared({ resource: "plans", action: "delete", capabilityId: "plans", requestSchemaId: RQ.versionedRef, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/plans/{ref}", mutability: "delete", concurrency: "version" }),
  shared({ resource: "agents", action: "list", capabilityId: "agents", requestSchemaId: RQ.list, responseSchemaId: RS.agentPage, httpMethod: "GET", httpPath: "/v1/agents", pagination: "cursor" }),
  shared({ resource: "agents", action: "register", capabilityId: "agents", requestSchemaId: RQ.agentRegister, responseSchemaId: RS.agent, httpMethod: "POST", httpPath: "/v1/agents", mutability: "write" }),
  shared({ resource: "agents", action: "get", capabilityId: "agents", requestSchemaId: RQ.ref, responseSchemaId: RS.agent, httpMethod: "GET", httpPath: "/v1/agents/{ref}" }),
  shared({ resource: "agents", action: "heartbeat", capabilityId: "agents", requestSchemaId: RQ.agentHeartbeat, responseSchemaId: RS.agent, httpMethod: "POST", httpPath: "/v1/agents/{ref}/heartbeat", mutability: "write", concurrency: "version" }),
  shared({ resource: "agents", action: "release", capabilityId: "agents", requestSchemaId: RQ.agentRelease, responseSchemaId: RS.agent, httpMethod: "POST", httpPath: "/v1/agents/{ref}/release", mutability: "write", concurrency: "version" }),
  shared({ resource: "activity", action: "list", capabilityId: "activity", requestSchemaId: RQ.list, responseSchemaId: RS.activityPage, httpMethod: "GET", httpPath: "/v1/activity", pagination: "cursor" }),
  shared({ resource: "stats", action: "get", capabilityId: "activity", requestSchemaId: RQ.empty, responseSchemaId: RS.stats, httpMethod: "GET", httpPath: "/v1/stats" }),
  shared({ resource: "search", action: "execute", capabilityId: "search", requestSchemaId: RQ.search, responseSchemaId: RS.taskPage, httpMethod: "POST", httpPath: "/v1/search", pagination: "cursor" }),
  shared({ resource: "saved_views", action: "list", capabilityId: "saved-views", requestSchemaId: RQ.list, responseSchemaId: RS.savedViewPage, httpMethod: "GET", httpPath: "/v1/saved-views", pagination: "cursor" }),
  shared({ resource: "saved_views", action: "create", capabilityId: "saved-views", requestSchemaId: RQ.savedViewCreate, responseSchemaId: RS.savedView, httpMethod: "POST", httpPath: "/v1/saved-views", mutability: "write" }),
  shared({ resource: "saved_views", action: "get", capabilityId: "saved-views", requestSchemaId: RQ.ref, responseSchemaId: RS.savedView, httpMethod: "GET", httpPath: "/v1/saved-views/{ref}" }),
  shared({ resource: "saved_views", action: "update", capabilityId: "saved-views", requestSchemaId: RQ.savedViewUpdate, responseSchemaId: RS.savedView, httpMethod: "PATCH", httpPath: "/v1/saved-views/{ref}", mutability: "write", concurrency: "version" }),
  shared({ resource: "saved_views", action: "delete", capabilityId: "saved-views", requestSchemaId: RQ.versionedRef, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/saved-views/{ref}", mutability: "delete", concurrency: "version" }),
  shared({ resource: "saved_views", action: "execute", capabilityId: "saved-views", requestSchemaId: RQ.savedViewExecute, responseSchemaId: RS.taskPage, httpMethod: "POST", httpPath: "/v1/saved-views/{ref}/execute", pagination: "cursor" }),
  shared({ resource: "verification_evidence", action: "list", capabilityId: "verification-evidence", requestSchemaId: RQ.list, responseSchemaId: RS.verificationPage, httpMethod: "GET", httpPath: "/v1/verification-evidence", pagination: "cursor" }),
  shared({ resource: "verification_evidence", action: "create", capabilityId: "verification-evidence", requestSchemaId: RQ.verificationCreate, responseSchemaId: RS.verification, httpMethod: "POST", httpPath: "/v1/verification-evidence", mutability: "write" }),
  shared({ resource: "verification_evidence", action: "get", capabilityId: "verification-evidence", requestSchemaId: RQ.ref, responseSchemaId: RS.verification, httpMethod: "GET", httpPath: "/v1/verification-evidence/{ref}" }),
  shared({ resource: "verification_evidence", action: "export", capabilityId: "verification-evidence", requestSchemaId: RQ.verificationExport, responseSchemaId: RS.verificationExport, httpMethod: "POST", httpPath: "/v1/verification-evidence/export" }),
  shared({ resource: "task_files", action: "list", capabilityId: "task-files", requestSchemaId: RQ.list, responseSchemaId: RS.taskFilePage, httpMethod: "GET", httpPath: "/v1/task-files", pagination: "cursor" }),
  shared({ resource: "task_files", action: "record", capabilityId: "task-files", requestSchemaId: RQ.taskFileRecord, responseSchemaId: RS.taskFile, httpMethod: "POST", httpPath: "/v1/task-files", mutability: "write" }),
  shared({ resource: "runs", action: "list", capabilityId: "runs", requestSchemaId: RQ.list, responseSchemaId: RS.runPage, httpMethod: "GET", httpPath: "/v1/runs", pagination: "cursor" }),
  shared({ resource: "runs", action: "start", capabilityId: "runs", requestSchemaId: RQ.runStart, responseSchemaId: RS.run, httpMethod: "POST", httpPath: "/v1/runs", mutability: "write" }),
  shared({ resource: "runs", action: "get", capabilityId: "runs", requestSchemaId: RQ.ref, responseSchemaId: RS.run, httpMethod: "GET", httpPath: "/v1/runs/{ref}" }),
  shared({ resource: "runs", action: "finish", capabilityId: "runs", requestSchemaId: RQ.runFinish, responseSchemaId: RS.run, httpMethod: "POST", httpPath: "/v1/runs/{ref}/finish", mutability: "write", concurrency: "version" }),
  shared({ resource: "runs", action: "get_ledger", capabilityId: "runs", requestSchemaId: RQ.ref, responseSchemaId: RS.runLedger, httpMethod: "GET", httpPath: "/v1/runs/{ref}/ledger" }),
  shared({ resource: "run_events", action: "list", capabilityId: "runs", requestSchemaId: RQ.refList, responseSchemaId: RS.runEventPage, httpMethod: "GET", httpPath: "/v1/runs/{ref}/events", pagination: "cursor" }),
  shared({ resource: "run_events", action: "create", capabilityId: "runs", requestSchemaId: RQ.runEventCreate, responseSchemaId: RS.runEvent, httpMethod: "POST", httpPath: "/v1/runs/{runId}/events", mutability: "write" }),
  shared({ resource: "run_commands", action: "list", capabilityId: "runs", requestSchemaId: RQ.refList, responseSchemaId: RS.runCommandPage, httpMethod: "GET", httpPath: "/v1/runs/{ref}/commands", pagination: "cursor" }),
  shared({ resource: "run_commands", action: "create", capabilityId: "runs", requestSchemaId: RQ.runCommandCreate, responseSchemaId: RS.runCommand, httpMethod: "POST", httpPath: "/v1/runs/{runId}/commands", mutability: "write" }),
  shared({ resource: "run_files", action: "list", capabilityId: "runs", requestSchemaId: RQ.refList, responseSchemaId: RS.runFilePage, httpMethod: "GET", httpPath: "/v1/runs/{ref}/files", pagination: "cursor" }),
  shared({ resource: "run_files", action: "create", capabilityId: "runs", requestSchemaId: RQ.runFileCreate, responseSchemaId: RS.runFile, httpMethod: "POST", httpPath: "/v1/runs/{runId}/files", mutability: "write" }),
  shared({ resource: "run_artifacts", action: "list", capabilityId: "runs", requestSchemaId: RQ.refList, responseSchemaId: RS.runArtifactPage, httpMethod: "GET", httpPath: "/v1/runs/{ref}/artifacts", pagination: "cursor" }),
  shared({ resource: "run_artifacts", action: "create", capabilityId: "runs", requestSchemaId: RQ.runArtifactCreate, responseSchemaId: RS.runArtifact, httpMethod: "POST", httpPath: "/v1/runs/{runId}/artifacts", mutability: "write" }),
  shared({ resource: "run_artifacts", action: "verify", capabilityId: "runs", requestSchemaId: RQ.runArtifactVerify, responseSchemaId: RS.runArtifact, httpMethod: "POST", httpPath: "/v1/runs/{runId}/artifacts/{ref}/verify", mutability: "write", concurrency: "version" }),
  shared({ resource: "git_commits", action: "list", capabilityId: "git-traceability", requestSchemaId: RQ.list, responseSchemaId: RS.gitCommitPage, httpMethod: "GET", httpPath: "/v1/git/commits", pagination: "cursor" }),
  shared({ resource: "git_commits", action: "link", capabilityId: "git-traceability", requestSchemaId: RQ.gitCommitLink, responseSchemaId: RS.gitCommit, httpMethod: "POST", httpPath: "/v1/git/commits", mutability: "write" }),
  shared({ resource: "git_commits", action: "unlink", capabilityId: "git-traceability", requestSchemaId: RQ.gitCommitUnlink, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/git/commits/{commitRef}", mutability: "delete", concurrency: "version" }),
  shared({ resource: "git_commits", action: "find", capabilityId: "git-traceability", requestSchemaId: RQ.gitCommitFind, responseSchemaId: RS.gitCommit, httpMethod: "POST", httpPath: "/v1/git/commits/find" }),
  shared({ resource: "git_refs", action: "list", capabilityId: "git-traceability", requestSchemaId: RQ.list, responseSchemaId: RS.gitRefPage, httpMethod: "GET", httpPath: "/v1/git/refs", pagination: "cursor" }),
  shared({ resource: "git_refs", action: "link", capabilityId: "git-traceability", requestSchemaId: RQ.gitRefLink, responseSchemaId: RS.gitRef, httpMethod: "POST", httpPath: "/v1/git/refs", mutability: "write" }),
  shared({ resource: "git_refs", action: "find", capabilityId: "git-traceability", requestSchemaId: RQ.gitRefFind, responseSchemaId: RS.gitRef, httpMethod: "POST", httpPath: "/v1/git/refs/find" }),
  shared({ resource: "traceability", action: "get", capabilityId: "git-traceability", requestSchemaId: RQ.ref, responseSchemaId: RS.traceability, httpMethod: "GET", httpPath: "/v1/traceability/{ref}" }),
  shared({ resource: "task_to_pr_projection", action: "list", capabilityId: "task-to-pr-projection", requestSchemaId: RQ.list, responseSchemaId: RS.projectionPage, httpMethod: "GET", httpPath: "/v1/task-to-pr-projections", pagination: "cursor" }),
  shared({ resource: "task_to_pr_projection", action: "get", capabilityId: "task-to-pr-projection", requestSchemaId: RQ.ref, responseSchemaId: RS.projection, httpMethod: "GET", httpPath: "/v1/task-to-pr-projections/{ref}" }),
  shared({ resource: "transfer", action: "export", capabilityId: "transfer", requestSchemaId: RQ.transferExport, responseSchemaId: RS.transferBundle, httpMethod: "POST", httpPath: "/v1/transfer/export" }),
  shared({ resource: "transfer", action: "validate", capabilityId: "transfer", requestSchemaId: RQ.transferValidate, responseSchemaId: RS.transferValidation, httpMethod: "POST", httpPath: "/v1/transfer/validate" }),
  shared({ resource: "transfer", action: "import_preview", capabilityId: "transfer", requestSchemaId: RQ.transferImportPreview, responseSchemaId: RS.transferImportPreview, httpMethod: "POST", httpPath: "/v1/transfer/import/preview" }),
  shared({ resource: "transfer", action: "import_execute", capabilityId: "transfer", requestSchemaId: RQ.transferImportExecute, responseSchemaId: RS.migrationReceipt, httpMethod: "POST", httpPath: "/v1/transfer/import/execute", mutability: "write", concurrency: "precondition", concurrencyFields: ["importPlanId", "importPlanDigest"] }),
  shared({ resource: "migration_receipts", action: "list", capabilityId: "transfer", requestSchemaId: RQ.list, responseSchemaId: RS.migrationReceiptPage, httpMethod: "GET", httpPath: "/v1/migration-receipts", pagination: "cursor" }),
  shared({ resource: "migration_receipts", action: "get", capabilityId: "transfer", requestSchemaId: RQ.ref, responseSchemaId: RS.migrationReceipt, httpMethod: "GET", httpPath: "/v1/migration-receipts/{ref}" }),
  shared({ resource: "deletion_records", action: "list", capabilityId: "deletion-history", requestSchemaId: RQ.list, responseSchemaId: RS.deletionRecordPage, httpMethod: "GET", httpPath: "/v1/deletion-records", pagination: "cursor" }),
  shared({ resource: "deletion_records", action: "get", capabilityId: "deletion-history", requestSchemaId: RQ.ref, responseSchemaId: RS.deletionRecord, httpMethod: "GET", httpPath: "/v1/deletion-records/{ref}" }),
  shared({ resource: "approvals", action: "list", capabilityId: "approvals", requestSchemaId: RQ.list, responseSchemaId: RS.approvalPage, httpMethod: "GET", httpPath: "/v1/approvals", audience: "tenant_admin", availability: "gated", pagination: "cursor" }),
  shared({ resource: "approvals", action: "get", capabilityId: "approvals", requestSchemaId: RQ.ref, responseSchemaId: RS.approval, httpMethod: "GET", httpPath: "/v1/approvals/{ref}", audience: "tenant_admin", availability: "gated" }),
  shared({ resource: "approvals", action: "request", capabilityId: "approvals", requestSchemaId: RQ.approvalRequest, responseSchemaId: RS.approval, httpMethod: "POST", httpPath: "/v1/approvals", audience: "tenant_admin", availability: "gated", mutability: "write" }),
  shared({ resource: "approvals", action: "approve", capabilityId: "approvals", requestSchemaId: RQ.approvalDecision, responseSchemaId: RS.approval, httpMethod: "POST", httpPath: "/v1/approvals/{ref}/approve", audience: "tenant_admin", availability: "gated", mutability: "write", concurrency: "version" }),
  shared({ resource: "approvals", action: "reject", capabilityId: "approvals", requestSchemaId: RQ.approvalDecision, responseSchemaId: RS.approval, httpMethod: "POST", httpPath: "/v1/approvals/{ref}/reject", audience: "tenant_admin", availability: "gated", mutability: "write", concurrency: "version" }),
  shared({ resource: "approvals", action: "expire", capabilityId: "approvals", requestSchemaId: RQ.approvalExpire, responseSchemaId: RS.approval, httpMethod: "POST", httpPath: "/v1/approvals/{ref}/expire", audience: "tenant_admin", availability: "gated", mutability: "write", concurrency: "version" }),
  shared({ resource: "task_templates", action: "list", capabilityId: "task-templates", requestSchemaId: RQ.list, responseSchemaId: RS.taskTemplatePage, httpMethod: "GET", httpPath: "/v1/task-templates", availability: "gated", pagination: "cursor" }),
  shared({ resource: "task_templates", action: "create", capabilityId: "task-templates", requestSchemaId: RQ.taskTemplateCreate, responseSchemaId: RS.taskTemplate, httpMethod: "POST", httpPath: "/v1/task-templates", availability: "gated", mutability: "write" }),
  shared({ resource: "task_templates", action: "get", capabilityId: "task-templates", requestSchemaId: RQ.ref, responseSchemaId: RS.taskTemplate, httpMethod: "GET", httpPath: "/v1/task-templates/{ref}", availability: "gated" }),
  shared({ resource: "task_templates", action: "update", capabilityId: "task-templates", requestSchemaId: RQ.taskTemplateUpdate, responseSchemaId: RS.taskTemplate, httpMethod: "PATCH", httpPath: "/v1/task-templates/{ref}", availability: "gated", mutability: "write", concurrency: "version" }),
  shared({ resource: "task_templates", action: "delete", capabilityId: "task-templates", requestSchemaId: RQ.versionedRef, responseSchemaId: RS.mutation, httpMethod: "DELETE", httpPath: "/v1/task-templates/{ref}", availability: "gated", mutability: "delete", concurrency: "version" }),
  shared({ resource: "task_templates", action: "instantiate", capabilityId: "task-templates", requestSchemaId: RQ.taskTemplateInstantiate, responseSchemaId: RS.taskPage, httpMethod: "POST", httpPath: "/v1/task-templates/{ref}/instantiate", availability: "gated", mutability: "write" }),
  shared({ resource: "reports", action: "generate", capabilityId: "reports", requestSchemaId: RQ.reportGenerate, responseSchemaId: RS.report, httpMethod: "POST", httpPath: "/v1/reports/generate", availability: "gated", mutability: "write" }),
  localTopology({ resource: "workspace", action: "bootstrap", capabilityId: "projects", requestSchemaId: RQ.workspaceBootstrap, responseSchemaId: RS.project, concurrency: "none" }),
  localTopology({ resource: "server", action: "start", capabilityId: "authority", requestSchemaId: RQ.serverStart, responseSchemaId: RS.serverStart, concurrency: "precondition", concurrencyFields: ["expectedState"] }),
  localTopology({ resource: "database", action: "backup", capabilityId: "transfer", requestSchemaId: RQ.databaseBackup, responseSchemaId: RS.artifactDocument, concurrency: "none" }),
  localTopology({ resource: "database", action: "restore", capabilityId: "transfer", requestSchemaId: RQ.databaseRestore, responseSchemaId: RS.mutation, concurrency: "precondition", concurrencyFields: ["expectedCurrentDigest"] }),
  localTopology({ resource: "database", action: "check", capabilityId: "transfer", requestSchemaId: RQ.databaseCheck, responseSchemaId: RS.artifactDocument, mutability: "read", idempotency: "none", concurrency: "none" }),
  localTopology({ resource: "database", action: "compact", capabilityId: "transfer", requestSchemaId: RQ.databaseCompact, responseSchemaId: RS.mutation, concurrency: "precondition", concurrencyFields: ["expectedCurrentDigest"] }),
  localTopology({ resource: "offline_upgrade", action: "validate", capabilityId: "authority", requestSchemaId: RQ.upgradeValidate, responseSchemaId: RS.artifactDocument, mutability: "read", idempotency: "none", concurrency: "none" }),
  localTopology({ resource: "offline_upgrade", action: "execute", capabilityId: "authority", requestSchemaId: RQ.upgradeExecute, responseSchemaId: RS.mutation, concurrency: "precondition", concurrencyFields: ["validationDigest"] }),
  localTopology({ resource: "task_to_pr_projection", action: "rebuild", capabilityId: "task-to-pr-projection", requestSchemaId: RQ.projectionRebuild, responseSchemaId: RS.batch, concurrency: "precondition", concurrencyFields: ["expectedManifestDigest"] })
];
var TODOS_OPERATION_MANIFEST = TodosOperationManifestSchema.parse({
  schema: TODOS_OPERATION_MANIFEST_SCHEMA_ID,
  version: TODOS_MANIFEST_VERSION,
  provenance: TODOS_CONTRACT_PROVENANCE,
  operations
});
var TODOS_OPERATION_MANIFEST_DIGEST = sha256TodosValue(TODOS_OPERATION_MANIFEST);
function getTodosOperation(operationId) {
  return TODOS_OPERATION_MANIFEST.operations.find((operation) => operation.id === operationId);
}
var TODOS_OPERATION_SCHEMAS = Object.freeze({
  [TODOS_OPERATION_MANIFEST_SCHEMA_ID]: TodosOperationManifestSchema
});

// src/todos/capabilities.ts
function operationsForCapability(capabilityId, operations2) {
  switch (capabilityId) {
    case "cursor-pagination":
      return operations2.filter((operation) => operation.pagination === "cursor");
    case "idempotency":
      return operations2.filter((operation) => operation.idempotency !== "none");
    case "optimistic-concurrency":
      return operations2.filter((operation) => operation.concurrency === "version");
    case "typed-errors":
      return [...operations2];
    default:
      return operations2.filter((operation) => operation.capabilityId === capabilityId);
  }
}
function orderedAudiences(operations2) {
  const audiences = new Set(operations2.map((operation) => operation.audience));
  return ["customer", "tenant_admin"].filter((audience) => audiences.has(audience));
}
function deriveTodosCapabilities(manifest = TODOS_OPERATION_MANIFEST) {
  const capabilities = TODOS_CAPABILITY_IDS.map((capabilityId) => {
    const operations2 = operationsForCapability(capabilityId, manifest.operations);
    if (operations2.length === 0) {
      throw new Error(`Capability has no deriving operations: ${capabilityId}`);
    }
    const primaryOperations = manifest.operations.filter((operation) => operation.capabilityId === capabilityId);
    return TodosCapabilitySchema.parse({
      id: capabilityId,
      availability: primaryOperations.length > 0 && primaryOperations.every((operation) => operation.availability === "gated") ? "gated" : "core",
      operationIds: operations2.map((operation) => operation.id).sort((left, right) => left.localeCompare(right)),
      audiences: orderedAudiences(operations2)
    });
  });
  return capabilities.sort((left, right) => left.id.localeCompare(right.id));
}
function createTodosCapabilityManifest(manifest = TODOS_OPERATION_MANIFEST) {
  return TodosCapabilityManifestSchema.parse({
    schema: TODOS_CAPABILITY_SCHEMA_IDS.manifest,
    version: TODOS_MANIFEST_VERSION,
    manifestDigest: sha256TodosValue(manifest),
    capabilities: deriveTodosCapabilities(manifest)
  });
}
var TODOS_CAPABILITY_MANIFEST = createTodosCapabilityManifest();

// src/todos/contract-schema.ts
import * as z12 from "zod/v4";
var TODOS_CONTRACT_SCHEMA_ID = "hasna.todos.contract.v1";
var TodosContractDescriptorSchema = z12.strictObject({
  schema: z12.literal(TODOS_CONTRACT_SCHEMA_ID),
  namespace: z12.literal(TODOS_CONTRACT_NAMESPACE),
  contractVersion: z12.literal(TODOS_CONTRACT_VERSION),
  manifestVersion: z12.literal(TODOS_MANIFEST_VERSION),
  manifestDigest: TodosSha256DigestSchema,
  capabilityManifestDigest: TodosSha256DigestSchema,
  schemaBundleDigest: TodosSha256DigestSchema,
  invariantRegistryDigest: TodosSha256DigestSchema,
  provenanceDigest: TodosSha256DigestSchema,
  generatorIdentityDigest: TodosSha256DigestSchema,
  publicSubpath: z12.literal("@hasna/contracts/todos"),
  rootExported: z12.literal(false),
  authorityInvariant: z12.strictObject({
    count: z12.literal(1)
  }),
  provenance: TodosContractProvenanceSchema
});
var TODOS_CONTRACT_SCHEMAS = Object.freeze({
  [TODOS_CONTRACT_SCHEMA_ID]: TodosContractDescriptorSchema
});

// src/todos/invariants.ts
var TODOS_INVARIANT_REGISTRY_SCHEMA_ID = "hasna.todos.invariant_registry.v1";
function invariant(value) {
  return Object.freeze(value);
}
var PAGE_SCHEMA_IDS = [
  "hasna.todos.response.capability_page.v1",
  "hasna.todos.response.task_page.v1",
  "hasna.todos.response.activity_page.v1",
  "hasna.todos.response.comment_page.v1",
  "hasna.todos.response.dependency_page.v1",
  "hasna.todos.response.project_page.v1",
  "hasna.todos.response.task_list_page.v1",
  "hasna.todos.response.plan_page.v1",
  "hasna.todos.response.agent_page.v1",
  "hasna.todos.response.saved_view_page.v1",
  "hasna.todos.response.verification_page.v1",
  "hasna.todos.response.task_file_page.v1",
  "hasna.todos.response.run_page.v1",
  "hasna.todos.response.run_event_page.v1",
  "hasna.todos.response.run_command_page.v1",
  "hasna.todos.response.run_file_page.v1",
  "hasna.todos.response.run_artifact_page.v1",
  "hasna.todos.response.git_commit_page.v1",
  "hasna.todos.response.git_ref_page.v1",
  "hasna.todos.response.projection_page.v1",
  "hasna.todos.response.migration_receipt_page.v1",
  "hasna.todos.response.deletion_record_page.v1",
  "hasna.todos.response.approval_page.v1",
  "hasna.todos.response.task_template_page.v1"
];
var TODOS_RUNTIME_INVARIANTS = Object.freeze([
  invariant({
    id: "todos.common.relative_path",
    category: "common",
    schemaIds: [
      "hasna.todos.task_file.v1",
      "hasna.todos.run_file.v1",
      "hasna.todos.git_commit.v1",
      "hasna.todos.request.task_file_record.v1",
      "hasna.todos.request.run_file_create.v1",
      "hasna.todos.request.git_commit_link.v1"
    ],
    description: "Non-portable domain paths are relative, traversal-free, and never absolute.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["common.relative_path_semantics"]
  }),
  invariant({
    id: "todos.identity.context_semantics",
    category: "identity",
    schemaIds: ["hasna.todos.identity_context.v1"],
    description: "Identity roles and scopes are unique and administrative audiences carry the administrative role.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["identity.context_semantics"]
  }),
  invariant({
    id: "todos.identity.authorization_binding",
    category: "identity",
    schemaIds: ["hasna.todos.identity_context.v1"],
    description: "Identity tenant, audience, scopes, and idempotency satisfy the requested operation.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["identity.authorization_binding"]
  }),
  invariant({
    id: "todos.authority.endpoint_https_rule",
    category: "authority",
    schemaIds: [
      "hasna.todos.authority_config.v1",
      "hasna.todos.authority_handshake.v1"
    ],
    description: "A network authority endpoint must be HTTPS; a null endpoint is the on-box installation.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "authority.config_semantics",
      "authority.handshake_semantics"
    ]
  }),
  invariant({
    id: "todos.authority.capability_uniqueness",
    category: "authority",
    schemaIds: [
      "hasna.todos.authority_config.v1",
      "hasna.todos.authority_handshake.v1"
    ],
    description: "Authority capability identifiers are unique.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "authority.config_semantics",
      "authority.handshake_semantics"
    ]
  }),
  invariant({
    id: "todos.authority.canonical_binding",
    category: "authority",
    schemaIds: ["hasna.todos.authority_handshake.v1"],
    description: "Authority handshakes bind exact current digests and the sorted capability inventory.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "authority.canonical_binding",
      "authority.validate_canonical_handshake"
    ]
  }),
  invariant({
    id: "todos.domain.task_record",
    category: "domain",
    schemaIds: ["hasna.todos.task.v1"],
    description: "Task tags are unique and completed tasks carry a completion timestamp.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["domain.task_record_semantics"]
  }),
  invariant({
    id: "todos.domain.task_status_transition",
    category: "domain",
    schemaIds: ["hasna.todos.task.v1"],
    description: "Task status transitions follow the closed lifecycle and terminal states do not reopen.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["domain.task_status_transition"]
  }),
  invariant({
    id: "todos.domain.agent_role_uniqueness",
    category: "domain",
    schemaIds: ["hasna.todos.agent.v1"],
    description: "Agent role identifiers are unique.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["domain.agent_role_uniqueness"]
  }),
  invariant({
    id: "todos.domain.dependency_self_reference",
    category: "domain",
    schemaIds: ["hasna.todos.dependency.v1"],
    description: "A dependency cannot point a task at itself.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["domain.dependency_self_reference"]
  }),
  invariant({
    id: "todos.domain.git_object_id",
    category: "domain",
    schemaIds: ["hasna.todos.git_object_id.v1"],
    description: "Git object identifiers have the exact hexadecimal length required by their algorithm.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["domain.git_object_id"]
  }),
  invariant({
    id: "todos.response.page_count",
    category: "response",
    schemaIds: PAGE_SCHEMA_IDS,
    description: "Every page count equals the exact number of returned items.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["response.page_count"]
  }),
  invariant({
    id: "todos.operation.manifest_semantics",
    category: "operation",
    schemaIds: ["hasna.todos.operation_manifest.v1"],
    description: "Operation identifiers and surfaces are unique, derived, mode-correct, and semantically complete.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["operation.manifest_semantics"]
  }),
  invariant({
    id: "todos.operation.task_update_nonempty",
    category: "operation",
    schemaIds: ["hasna.todos.request.task_update.v1"],
    description: "Task update requests contain at least one changed field.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["operation.task_update_nonempty"]
  }),
  invariant({
    id: "todos.operation.transfer_checkpoint_binding",
    category: "operation",
    schemaIds: ["hasna.todos.request.transfer_import_execute.v1"],
    description: "Transfer execution checkpoints bind the source, target, bundle, plan, and canonical digests.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["operation.transfer_checkpoint_binding"]
  }),
  invariant({
    id: "todos.invocation.canonical_digests",
    category: "invocation",
    schemaIds: ["hasna.todos.operation_invocation.v1"],
    description: "Operation invocations bind exact current contract and manifest digests.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "invocation.operation_binding",
      "invocation.validate_operation"
    ]
  }),
  invariant({
    id: "todos.invocation.authority_identity_binding",
    category: "invocation",
    schemaIds: ["hasna.todos.operation_invocation.v1"],
    description: "Invocation authority equals the validated organization and tenant identity.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "invocation.operation_binding",
      "invocation.validate_operation"
    ]
  }),
  invariant({
    id: "todos.invocation.operation_scope_request",
    category: "invocation",
    schemaIds: ["hasna.todos.operation_invocation.v1"],
    description: "The operation, scopes, idempotency, and typed request all match the manifest.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "invocation.operation_binding",
      "invocation.validate_operation"
    ]
  }),
  invariant({
    id: "todos.contract.digest_closure",
    category: "contract",
    schemaIds: ["hasna.todos.contract.v1"],
    description: "The descriptor closes over current manifest, capability, schema, invariant, provenance, and generator digests.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "contract.digest_closure",
      "contract.verify_digest_closure"
    ]
  }),
  invariant({
    id: "todos.transfer.source_authority",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_bundle.v1"],
    description: "Every section, record, nested reference, projection, closure, attachment, and inventory entry has one source authority.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.bundle_owner_binding"]
  }),
  invariant({
    id: "todos.transfer.canonical_digests",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_bundle.v1"],
    description: "Public transfer validation binds exact current contract and manifest digests.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.canonical_digests"]
  }),
  invariant({
    id: "todos.transfer.execution_canonical_digests",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_import_execution.v1"],
    description: "Public import execution binds exact current contract and manifest digests.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.canonical_execution"]
  }),
  invariant({
    id: "todos.transfer.section_integrity",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_bundle.v1"],
    description: "Every section count and digest and the bundle checksum match canonical content.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.integrity"]
  }),
  invariant({
    id: "todos.transfer.classification",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_bundle.v1"],
    description: "Portable records exclude raw commands, arguments, paths, credentials, and execution internals.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.integrity"]
  }),
  invariant({
    id: "todos.transfer.reference_closure",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_bundle.v1"],
    description: "Every portable record participates in a complete transitive reference closure; projection predecessors resolve by exact owner, kind, id, version, and digest.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.integrity"]
  }),
  invariant({
    id: "todos.transfer.dependency_closure",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_bundle.v1"],
    description: "Task dependency closure is complete, deterministic, and acyclic.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.integrity"]
  }),
  invariant({
    id: "todos.transfer.attachment_content_addressing",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_bundle.v1"],
    description: "Evidence, command output, file, and artifact payloads are represented only by SHA-256 content references.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.integrity"]
  }),
  invariant({
    id: "todos.transfer.deletion_redaction",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_bundle.v1"],
    description: "Deletion history contains digest-only full-redaction tombstones and no raw payload.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.integrity"]
  }),
  invariant({
    id: "todos.transfer.import_plan",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_import_preview.v1"],
    description: "Import plans carry a deterministic id plus a content digest binding source and target authorities, canonical digests, bundle content, conflicts, and counts.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.import_plan_digest"]
  }),
  invariant({
    id: "todos.transfer.checkpoint_binding",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_checkpoint.v1"],
    description: "Checkpoints bind source, target, bundle id and digest, import-plan id and digest, contract and manifest digests, and idempotency.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.checkpoint_record"]
  }),
  invariant({
    id: "todos.transfer.checkpoint_monotonicity",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_checkpoint.v1"],
    description: "Checkpoint progress advances one canonical section at a time to one terminal state.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.checkpoint_transition"]
  }),
  invariant({
    id: "todos.transfer.execution_request_binding",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_import_execution.v1"],
    description: "Execution requests and optional checkpoints bind every source, target, digest, plan, bundle, and idempotency field.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.execution_request"]
  }),
  invariant({
    id: "todos.transfer.execution_context_closed",
    category: "transfer",
    schemaIds: ["hasna.todos.transfer_execution_context.v1"],
    description: "Execution context is exactly uncommitted or committed with one valid receipt; all unknown states fail closed.",
    jsonSchemaExpressible: true,
    runtimeValidatorIds: ["transfer.execution_context"]
  }),
  invariant({
    id: "todos.transfer.receipt_binding",
    category: "transfer",
    schemaIds: ["hasna.todos.migration_receipt.v1"],
    description: "Receipts bind source, target, bundle id and digest, import-plan id and digest, contract and manifest digests, counts, and one terminal checkpoint.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.receipt_record"]
  }),
  invariant({
    id: "todos.transfer.receipt_chain",
    category: "transfer",
    schemaIds: ["hasna.todos.migration_receipt.v1"],
    description: "Migration receipts form one strict digest-linked chain where each idempotency key has one canonical import tuple and terminal result; exact receipt replay never appends.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "transfer.receipt_chain",
      "transfer.public_receipt_chain"
    ]
  }),
  invariant({
    id: "todos.transfer.public_canonical_boundaries",
    category: "transfer",
    schemaIds: [
      "hasna.todos.request.transfer_import_execute.v1",
      "hasna.todos.response.migration_receipt.v1",
      "hasna.todos.response.migration_receipt_page.v1",
      "hasna.todos.transfer_checkpoint.v1",
      "hasna.todos.transfer_import_execution.v1",
      "hasna.todos.migration_receipt.v1"
    ],
    description: "Every public checkpoint, execution, receipt, transition, receipt-chain, and operation-map boundary rejects historical contract or manifest digests; version-neutral foundation, registry, and generated schemas remain internal structural inputs.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "operation.public_transfer_import_execute_canonical",
      "transfer.public_checkpoint_canonical",
      "transfer.public_receipt_canonical",
      "transfer.public_execution_request_canonical",
      "transfer.public_checkpoint_transition",
      "transfer.public_receipt_chain"
    ]
  }),
  invariant({
    id: "todos.transfer.replay_binding",
    category: "transfer",
    schemaIds: [
      "hasna.todos.transfer_import_execution.v1",
      "hasna.todos.transfer_execution_context.v1"
    ],
    description: "Only an identical committed import replays; conflicts and unknown context reject.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["transfer.execution_replay"]
  }),
  invariant({
    id: "todos.projection.opaque_refs",
    category: "projection",
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"],
    description: "Projection references are opaque identifiers, never paths or URLs.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["projection.record_binding"]
  }),
  invariant({
    id: "todos.projection.owner_kind_binding",
    category: "projection",
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"],
    description: "All identity, pull-request, proof, and predecessor refs match the projection owner and required kind.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["projection.record_binding"]
  }),
  invariant({
    id: "todos.projection.exact_head",
    category: "projection",
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"],
    description: "Published, provider-observed, and equality-proof heads are complete and equal to the branch head.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["projection.head_binding"]
  }),
  invariant({
    id: "todos.projection.proof_identity",
    category: "projection",
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"],
    description: "Proof references and digests are unique, owner-bound, kind-bound, and tied to the current head.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["projection.record_binding"]
  }),
  invariant({
    id: "todos.projection.digest_predecessor",
    category: "projection",
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"],
    description: "Projection digests cover canonical content and successors bind exact immediate predecessors.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: [
      "projection.record_binding",
      "projection.transition"
    ]
  }),
  invariant({
    id: "todos.projection.full_history",
    category: "projection",
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"],
    description: "Full histories reject missing links, ABA heads, repeats, substitutions, owner or kind drift, and stale heads.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["projection.history"]
  }),
  invariant({
    id: "todos.artifacts.canonical_bytes",
    category: "artifacts",
    schemaIds: ["hasna.todos.contract.v1"],
    description: "Checked-in artifacts match canonical regenerated bytes even when checksums are internally recomputed.",
    jsonSchemaExpressible: false,
    runtimeValidatorIds: ["artifacts.canonical_bytes"]
  })
]);
var TODOS_INVARIANT_REGISTRY = Object.freeze({
  schema: TODOS_INVARIANT_REGISTRY_SCHEMA_ID,
  version: TODOS_MANIFEST_VERSION,
  runtimeValidationRequired: true,
  invariants: TODOS_RUNTIME_INVARIANTS
});
var TODOS_INVARIANT_REGISTRY_DIGEST = sha256TodosValue(TODOS_INVARIANT_REGISTRY);
function todosInvariantIdsForSchema(schemaId) {
  return TODOS_RUNTIME_INVARIANTS.filter((entry) => entry.schemaIds.includes(schemaId)).map((entry) => entry.id).sort((left, right) => left.localeCompare(right));
}

// src/todos/schema-foundation.ts
import * as z14 from "zod/v4";

// src/todos/invocation-envelope.ts
import * as z13 from "zod/v4";
var TODOS_OPERATION_INVOCATION_SCHEMA_ID = "hasna.todos.operation_invocation.v1";
var TodosOperationIdSchema = z13.string().regex(/^todos\.[a-z0-9_]+(?:\.[a-z0-9_]+)+$/);
var TodosOperationInvocationEnvelopeSchema = z13.strictObject({
  authorityId: TodosOwnerIdSchema,
  contractDigest: TodosSha256DigestSchema,
  manifestDigest: TodosSha256DigestSchema,
  operationId: TodosOperationIdSchema,
  identity: TodosIdentityContextSchema,
  request: z13.unknown()
});

// src/todos/schema-foundation.ts
var TODOS_SCHEMA_FOUNDATION_REGISTRY = Object.freeze({
  ...TODOS_AUTHORITY_SCHEMAS,
  ...TODOS_CAPABILITY_SCHEMAS,
  ...TODOS_CONTRACT_SCHEMAS,
  ...TODOS_DOMAIN_SCHEMAS,
  [TODOS_IDENTITY_SCHEMA_ID]: TodosIdentityContextSchema,
  [TODOS_OPERATION_INVOCATION_SCHEMA_ID]: TodosOperationInvocationEnvelopeSchema,
  ...TODOS_COMMON_SCHEMAS,
  ...TODOS_REQUEST_SCHEMAS,
  ...TODOS_RESPONSE_SCHEMAS,
  ...TODOS_OPERATION_SCHEMAS,
  ...TODOS_PROJECTION_SCHEMAS,
  ...TODOS_PROVENANCE_SCHEMAS,
  ...TODOS_TRANSFER_SCHEMAS
});
function buildTodosJsonSchemas(registry) {
  return Object.fromEntries(Object.entries(registry).sort(([left], [right]) => left.localeCompare(right)).map(([schemaId, schema]) => {
    const jsonSchema = z14.toJSONSchema(schema, {
      unrepresentable: "any",
      cycles: "ref",
      reused: "ref"
    });
    const invariantIds = todosInvariantIdsForSchema(schemaId);
    return [
      schemaId,
      {
        ...jsonSchema,
        $id: schemaId,
        ...invariantIds.length > 0 ? { "x-hasna-invariants": invariantIds } : {}
      }
    ];
  }));
}
var TODOS_SCHEMA_FOUNDATION = Object.freeze(buildTodosJsonSchemas(TODOS_SCHEMA_FOUNDATION_REGISTRY));
var TODOS_SCHEMA_BUNDLE_DIGEST = sha256TodosValue(TODOS_SCHEMA_FOUNDATION);

// src/todos/generator-provenance.ts
var TODOS_GENERATOR_VERSION = "1.0.0";
var TODOS_GENERATOR_PROVENANCE_SCHEMA_ID = "hasna.todos.generator_provenance.v1";
var TODOS_GENERATOR_IDENTITY = Object.freeze({
  schema: TODOS_GENERATOR_PROVENANCE_SCHEMA_ID,
  generatorVersion: TODOS_GENERATOR_VERSION,
  sourceFreeze: TODOS_SOURCE_FREEZE,
  sourceModules: Object.freeze([
    {
      module: "src/todos/operations.ts",
      contentDigest: TODOS_OPERATION_MANIFEST_DIGEST
    },
    {
      module: "src/todos/capabilities.ts",
      contentDigest: sha256TodosValue(TODOS_CAPABILITY_MANIFEST)
    },
    {
      module: "src/todos/schema-foundation.ts",
      contentDigest: TODOS_SCHEMA_BUNDLE_DIGEST
    },
    {
      module: "src/todos/invariants.ts",
      contentDigest: TODOS_INVARIANT_REGISTRY_DIGEST
    },
    {
      module: "src/todos/provenance.ts",
      contentDigest: TODOS_PROVENANCE_DIGEST
    }
  ]),
  manifestVersion: TODOS_MANIFEST_VERSION
});
var TODOS_GENERATOR_IDENTITY_DIGEST = sha256TodosValue(TODOS_GENERATOR_IDENTITY);
function buildTodosGeneratorProvenance(contractDigest) {
  return {
    ...TODOS_GENERATOR_IDENTITY,
    identityDigest: TODOS_GENERATOR_IDENTITY_DIGEST,
    outputContractDigest: contractDigest
  };
}

// src/todos/contract.ts
var TODOS_CONTRACT_DESCRIPTOR = TodosContractDescriptorSchema.parse({
  schema: TODOS_CONTRACT_SCHEMA_ID,
  namespace: TODOS_CONTRACT_NAMESPACE,
  contractVersion: TODOS_CONTRACT_VERSION,
  manifestVersion: TODOS_MANIFEST_VERSION,
  manifestDigest: TODOS_OPERATION_MANIFEST_DIGEST,
  capabilityManifestDigest: sha256TodosValue(TODOS_CAPABILITY_MANIFEST),
  schemaBundleDigest: TODOS_SCHEMA_BUNDLE_DIGEST,
  invariantRegistryDigest: TODOS_INVARIANT_REGISTRY_DIGEST,
  provenanceDigest: TODOS_PROVENANCE_DIGEST,
  generatorIdentityDigest: TODOS_GENERATOR_IDENTITY_DIGEST,
  publicSubpath: "@hasna/contracts/todos",
  rootExported: false,
  authorityInvariant: {
    count: 1
  },
  provenance: TODOS_CONTRACT_PROVENANCE
});
var TODOS_CONTRACT_DIGEST = sha256TodosValue(TODOS_CONTRACT_DESCRIPTOR);
function verifyTodosContractDigests() {
  return TODOS_CONTRACT_DESCRIPTOR.manifestDigest === sha256TodosValue(TODOS_OPERATION_MANIFEST) && TODOS_CONTRACT_DESCRIPTOR.capabilityManifestDigest === sha256TodosValue(TODOS_CAPABILITY_MANIFEST) && TODOS_CONTRACT_DESCRIPTOR.schemaBundleDigest === TODOS_SCHEMA_BUNDLE_DIGEST && TODOS_CONTRACT_DESCRIPTOR.invariantRegistryDigest === TODOS_INVARIANT_REGISTRY_DIGEST && TODOS_CONTRACT_DESCRIPTOR.provenanceDigest === TODOS_PROVENANCE_DIGEST && TODOS_CONTRACT_DESCRIPTOR.generatorIdentityDigest === TODOS_GENERATOR_IDENTITY_DIGEST && TODOS_CONTRACT_DIGEST === sha256TodosValue(TODOS_CONTRACT_DESCRIPTOR);
}
function validateTodosContractDescriptor(input) {
  const parsed = TodosContractDescriptorSchema.safeParse(input);
  return parsed.success && sha256TodosValue(parsed.data) === TODOS_CONTRACT_DIGEST && parsed.data.manifestDigest === TODOS_OPERATION_MANIFEST_DIGEST && parsed.data.capabilityManifestDigest === sha256TodosValue(TODOS_CAPABILITY_MANIFEST) && parsed.data.schemaBundleDigest === TODOS_SCHEMA_BUNDLE_DIGEST && parsed.data.invariantRegistryDigest === TODOS_INVARIANT_REGISTRY_DIGEST && parsed.data.provenanceDigest === TODOS_PROVENANCE_DIGEST && parsed.data.generatorIdentityDigest === TODOS_GENERATOR_IDENTITY_DIGEST;
}

// src/todos/canonical-authority.ts
var TODOS_CANONICAL_CAPABILITY_IDS = Object.freeze(TODOS_CAPABILITY_MANIFEST.capabilities.map((capability) => capability.id).sort((left, right) => left.localeCompare(right)));
function canonicalAuthorityIssues(value, ctx) {
  if (value.contractDigest !== TODOS_CONTRACT_DIGEST) {
    ctx.addIssue({
      code: "custom",
      message: "Authority contract digest does not match this contract",
      path: ["contractDigest"]
    });
  }
  if (value.manifestDigest !== TODOS_OPERATION_MANIFEST_DIGEST) {
    ctx.addIssue({
      code: "custom",
      message: "Authority manifest digest does not match this operation manifest",
      path: ["manifestDigest"]
    });
  }
  if (value.capabilityIds.length !== TODOS_CANONICAL_CAPABILITY_IDS.length || value.capabilityIds.some((capabilityId, index) => capabilityId !== TODOS_CANONICAL_CAPABILITY_IDS[index])) {
    ctx.addIssue({
      code: "custom",
      message: "Authority capability ids must exactly equal the sorted canonical capability inventory",
      path: ["capabilityIds"]
    });
  }
}
var TodosCanonicalAuthorityHandshakeSchema = TodosAuthorityHandshakeSchema.superRefine(canonicalAuthorityIssues);
function createTodosAuthorityHandshake(input) {
  return TodosCanonicalAuthorityHandshakeSchema.parse({
    authority: input.authority,
    contractVersion: TODOS_CONTRACT_VERSION,
    contractDigest: TODOS_CONTRACT_DIGEST,
    manifestVersion: TODOS_MANIFEST_VERSION,
    manifestDigest: TODOS_OPERATION_MANIFEST_DIGEST,
    capabilityIds: TODOS_CANONICAL_CAPABILITY_IDS,
    issuedAt: input.issuedAt
  });
}
function validateCanonicalTodosAuthorityHandshake(input) {
  return TodosCanonicalAuthorityHandshakeSchema.safeParse(input).success;
}
// src/todos/transfer.ts
import * as z15 from "zod/v4";
function requireCanonicalTransferDigests(value, ctx) {
  if (value.contractDigest !== TODOS_CONTRACT_DIGEST) {
    ctx.addIssue({
      code: "custom",
      message: "Contract digest must match the current Todos contract",
      path: ["contractDigest"]
    });
  }
  if (value.manifestDigest !== TODOS_OPERATION_MANIFEST_DIGEST) {
    ctx.addIssue({
      code: "custom",
      message: "Manifest digest must match the current Todos operation manifest",
      path: ["manifestDigest"]
    });
  }
}
var TodosTransferCheckpointSchema2 = TodosTransferCheckpointSchema.superRefine(requireCanonicalTransferDigests);
var TodosMigrationReceiptSchema2 = TodosMigrationReceiptSchema.superRefine((value, ctx) => {
  requireCanonicalTransferDigests(value, ctx);
  if (!TodosTransferCheckpointSchema2.safeParse(value.checkpoint).success) {
    ctx.addIssue({
      code: "custom",
      message: "Receipt checkpoint must bind the current Todos contract",
      path: ["checkpoint"]
    });
  }
});
var TodosTransferImportExecutionSchema2 = TodosTransferImportExecutionSchema.superRefine((value, ctx) => {
  requireCanonicalTransferDigests(value, ctx);
  if (value.checkpoint && !TodosTransferCheckpointSchema2.safeParse(value.checkpoint).success) {
    ctx.addIssue({
      code: "custom",
      message: "Execution checkpoint must bind the current Todos contract",
      path: ["checkpoint"]
    });
  }
});
var TodosTransferExecutionContextSchema2 = z15.discriminatedUnion("state", [
  z15.strictObject({
    state: z15.literal("uncommitted")
  }),
  z15.strictObject({
    state: z15.literal("committed"),
    receipt: TodosMigrationReceiptSchema2
  })
]);
var TODOS_TRANSFER_SCHEMAS2 = Object.freeze({
  ...TODOS_TRANSFER_SCHEMAS,
  [TODOS_TRANSFER_SCHEMA_IDS.importExecution]: TodosTransferImportExecutionSchema2,
  [TODOS_TRANSFER_SCHEMA_IDS.executionContext]: TodosTransferExecutionContextSchema2,
  [TODOS_TRANSFER_SCHEMA_IDS.checkpoint]: TodosTransferCheckpointSchema2,
  [TODOS_TRANSFER_SCHEMA_IDS.migrationReceipt]: TodosMigrationReceiptSchema2
});
function createTodosTransferBundle(input) {
  return createTodosTransferBundleWithDigests({
    ...input,
    contractDigest: TODOS_CONTRACT_DIGEST,
    manifestDigest: TODOS_OPERATION_MANIFEST_DIGEST
  });
}
function validateTodosTransferBundle(input) {
  const validation = validateTodosTransferBundleIntegrity(input);
  const parsed = TodosTransferBundleSchema.safeParse(input);
  if (!parsed.success)
    return validation;
  const issues = [...validation.issues];
  if (parsed.data.contractDigest !== TODOS_CONTRACT_DIGEST) {
    issues.push({
      code: "canonical_digest_mismatch",
      path: "contractDigest",
      message: "Bundle contract digest does not match the current Todos contract",
      repairable: false
    });
  }
  if (parsed.data.manifestDigest !== TODOS_OPERATION_MANIFEST_DIGEST) {
    issues.push({
      code: "canonical_digest_mismatch",
      path: "manifestDigest",
      message: "Bundle manifest digest does not match the current Todos operation manifest",
      repairable: false
    });
  }
  return TodosTransferValidationSchema.parse({
    ...validation,
    valid: issues.length === 0,
    issues
  });
}
function createTodosTransferImportPreview(bundle, targetAuthorityId, conflicts = []) {
  return createTodosTransferImportPreviewIntegrity(bundle, targetAuthorityId, conflicts, validateTodosTransferBundle(bundle));
}
function createTodosTransferCheckpoint2(input) {
  return TodosTransferCheckpointSchema2.parse(createTodosTransferCheckpoint(input));
}
function validateTodosTransferCheckpointTransition2(previousInput, currentInput) {
  const previous = TodosTransferCheckpointSchema2.safeParse(previousInput);
  const current = TodosTransferCheckpointSchema2.safeParse(currentInput);
  return previous.success && current.success && validateTodosTransferCheckpointTransition(previous.data, current.data);
}
function createTodosMigrationReceipt2(input) {
  return TodosMigrationReceiptSchema2.parse(createTodosMigrationReceipt(input));
}
function validateTodosMigrationReceiptChain2(input) {
  if (!Array.isArray(input)) {
    return {
      success: false,
      action: "conflict",
      issues: ["Receipt chain must be an array"]
    };
  }
  const receipts = [];
  const issues = [];
  for (const [index, value] of input.entries()) {
    const parsed = TodosMigrationReceiptSchema2.safeParse(value);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((issue) => `receipts.${index}.${issue.path.join(".")}: ${issue.message}`));
    } else {
      receipts.push(parsed.data);
    }
  }
  return issues.length > 0 ? { success: false, action: "conflict", issues } : validateTodosMigrationReceiptChain(receipts);
}
function evaluateTodosImportExecution(requestInput, contextInput) {
  const request = TodosTransferImportExecutionSchema2.safeParse(requestInput);
  const context = TodosTransferExecutionContextSchema2.safeParse(contextInput);
  if (!request.success || !context.success) {
    return {
      action: "reject",
      error: createTodosError("TODOS_TRANSFER_INVALID", "Import execution request is not bound to the current Todos contract")
    };
  }
  return evaluateTodosImportExecutionIntegrity(request.data, context.data);
}
var TODOS_CANONICAL_TRANSFER_BINDING = Object.freeze({
  schema: TODOS_TRANSFER_SCHEMA_IDS.bundle,
  contractDigest: TODOS_CONTRACT_DIGEST,
  manifestDigest: TODOS_OPERATION_MANIFEST_DIGEST
});
// src/todos/public-operation-schemas.ts
var PublicTransferImportExecuteRequestSchema = TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.transferImportExecute].superRefine((value, ctx) => {
  if (value.bundle.contractDigest !== TODOS_CONTRACT_DIGEST) {
    ctx.addIssue({
      code: "custom",
      message: "Transfer bundle must bind the current Todos contract",
      path: ["bundle", "contractDigest"]
    });
  }
  if (value.bundle.manifestDigest !== TODOS_OPERATION_MANIFEST_DIGEST) {
    ctx.addIssue({
      code: "custom",
      message: "Transfer bundle must bind the current Todos operation manifest",
      path: ["bundle", "manifestDigest"]
    });
  }
  if (value.checkpoint && !TodosTransferCheckpointSchema2.safeParse(value.checkpoint).success) {
    ctx.addIssue({
      code: "custom",
      message: "Transfer checkpoint must bind the current Todos contract",
      path: ["checkpoint"]
    });
  }
});
var TODOS_REQUEST_SCHEMAS2 = Object.freeze({
  ...TODOS_REQUEST_SCHEMAS,
  [TODOS_REQUEST_SCHEMA_IDS.transferImportExecute]: PublicTransferImportExecuteRequestSchema
});
var TODOS_RESPONSE_SCHEMAS2 = Object.freeze({
  ...TODOS_RESPONSE_SCHEMAS,
  [TODOS_RESPONSE_SCHEMA_IDS.migrationReceiptPage]: createTodosResultSchema(createTodosPageSchema(TodosMigrationReceiptSchema2)),
  [TODOS_RESPONSE_SCHEMA_IDS.migrationReceipt]: createTodosResultSchema(TodosMigrationReceiptSchema2)
});
// src/todos/runtime-validator-bindings.ts
var PAGE_SCHEMA_IDS2 = [
  "hasna.todos.response.capability_page.v1",
  "hasna.todos.response.task_page.v1",
  "hasna.todos.response.activity_page.v1",
  "hasna.todos.response.comment_page.v1",
  "hasna.todos.response.dependency_page.v1",
  "hasna.todos.response.project_page.v1",
  "hasna.todos.response.task_list_page.v1",
  "hasna.todos.response.plan_page.v1",
  "hasna.todos.response.agent_page.v1",
  "hasna.todos.response.saved_view_page.v1",
  "hasna.todos.response.verification_page.v1",
  "hasna.todos.response.task_file_page.v1",
  "hasna.todos.response.run_page.v1",
  "hasna.todos.response.run_event_page.v1",
  "hasna.todos.response.run_command_page.v1",
  "hasna.todos.response.run_file_page.v1",
  "hasna.todos.response.run_artifact_page.v1",
  "hasna.todos.response.git_commit_page.v1",
  "hasna.todos.response.git_ref_page.v1",
  "hasna.todos.response.projection_page.v1",
  "hasna.todos.response.migration_receipt_page.v1",
  "hasna.todos.response.deletion_record_page.v1",
  "hasna.todos.response.approval_page.v1",
  "hasna.todos.response.task_template_page.v1"
];
function binding(value) {
  return Object.freeze(value);
}
var TODOS_RUNTIME_VALIDATOR_BINDINGS = Object.freeze([
  binding({
    id: "common.relative_path_semantics",
    sourceFile: "common.ts",
    symbol: "TodosRelativePathSchema",
    kind: "refinement",
    invariantIds: ["todos.common.relative_path"],
    schemaIds: [
      "hasna.todos.task_file.v1",
      "hasna.todos.run_file.v1",
      "hasna.todos.git_commit.v1",
      "hasna.todos.request.task_file_record.v1",
      "hasna.todos.request.run_file_create.v1",
      "hasna.todos.request.git_commit_link.v1"
    ]
  }),
  binding({
    id: "identity.context_semantics",
    sourceFile: "identity.ts",
    symbol: "TodosIdentityContextSchema",
    kind: "refinement",
    invariantIds: ["todos.identity.context_semantics"],
    schemaIds: ["hasna.todos.identity_context.v1"]
  }),
  binding({
    id: "identity.authorization_binding",
    sourceFile: "identity.ts",
    symbol: "validateTodosIdentityContext",
    kind: "validator",
    invariantIds: ["todos.identity.authorization_binding"],
    schemaIds: ["hasna.todos.identity_context.v1"]
  }),
  binding({
    id: "authority.config_semantics",
    sourceFile: "authority.ts",
    symbol: "TodosAuthorityConfigSchema",
    kind: "refinement",
    invariantIds: [
      "todos.authority.endpoint_https_rule",
      "todos.authority.capability_uniqueness"
    ],
    schemaIds: ["hasna.todos.authority_config.v1"]
  }),
  binding({
    id: "authority.handshake_semantics",
    sourceFile: "authority.ts",
    symbol: "TodosAuthorityHandshakeSchema",
    kind: "refinement",
    invariantIds: [
      "todos.authority.endpoint_https_rule",
      "todos.authority.capability_uniqueness"
    ],
    schemaIds: ["hasna.todos.authority_handshake.v1"]
  }),
  binding({
    id: "authority.canonical_binding",
    sourceFile: "canonical-authority.ts",
    symbol: "TodosCanonicalAuthorityHandshakeSchema",
    kind: "refinement",
    invariantIds: ["todos.authority.canonical_binding"],
    schemaIds: ["hasna.todos.authority_handshake.v1"]
  }),
  binding({
    id: "authority.validate_canonical_handshake",
    sourceFile: "canonical-authority.ts",
    symbol: "validateCanonicalTodosAuthorityHandshake",
    kind: "validator",
    invariantIds: ["todos.authority.canonical_binding"],
    schemaIds: ["hasna.todos.authority_handshake.v1"]
  }),
  binding({
    id: "domain.task_record_semantics",
    sourceFile: "domain.ts",
    symbol: "TodosTaskSchema",
    kind: "refinement",
    invariantIds: ["todos.domain.task_record"],
    schemaIds: ["hasna.todos.task.v1"]
  }),
  binding({
    id: "domain.task_status_transition",
    sourceFile: "domain.ts",
    symbol: "validateTodosTaskStatusTransition",
    kind: "validator",
    invariantIds: ["todos.domain.task_status_transition"],
    schemaIds: ["hasna.todos.task.v1"]
  }),
  binding({
    id: "domain.agent_role_uniqueness",
    sourceFile: "domain.ts",
    symbol: "TodosAgentSchema",
    kind: "refinement",
    invariantIds: ["todos.domain.agent_role_uniqueness"],
    schemaIds: ["hasna.todos.agent.v1"]
  }),
  binding({
    id: "domain.dependency_self_reference",
    sourceFile: "domain.ts",
    symbol: "TodosDependencySchema",
    kind: "refinement",
    invariantIds: ["todos.domain.dependency_self_reference"],
    schemaIds: ["hasna.todos.dependency.v1"]
  }),
  binding({
    id: "domain.git_object_id",
    sourceFile: "domain.ts",
    symbol: "TodosGitObjectIdSchema",
    kind: "refinement",
    invariantIds: ["todos.domain.git_object_id"],
    schemaIds: ["hasna.todos.git_object_id.v1"]
  }),
  binding({
    id: "response.page_count",
    sourceFile: "errors.ts",
    symbol: "createTodosPageSchema",
    kind: "refinement",
    invariantIds: ["todos.response.page_count"],
    schemaIds: PAGE_SCHEMA_IDS2
  }),
  binding({
    id: "operation.manifest_semantics",
    sourceFile: "operations.ts",
    symbol: "TodosOperationManifestSchema",
    kind: "refinement",
    invariantIds: ["todos.operation.manifest_semantics"],
    schemaIds: ["hasna.todos.operation_manifest.v1"]
  }),
  binding({
    id: "operation.task_update_nonempty",
    sourceFile: "operation-schemas.ts",
    symbol: "TaskUpdateRequestSchema",
    kind: "refinement",
    invariantIds: ["todos.operation.task_update_nonempty"],
    schemaIds: ["hasna.todos.request.task_update.v1"]
  }),
  binding({
    id: "operation.transfer_checkpoint_binding",
    sourceFile: "operation-schemas.ts",
    symbol: "TransferImportExecuteRequestSchema",
    kind: "refinement",
    invariantIds: ["todos.operation.transfer_checkpoint_binding"],
    schemaIds: ["hasna.todos.request.transfer_import_execute.v1"]
  }),
  binding({
    id: "operation.public_transfer_import_execute_canonical",
    sourceFile: "public-operation-schemas.ts",
    symbol: "PublicTransferImportExecuteRequestSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.public_canonical_boundaries"],
    schemaIds: ["hasna.todos.request.transfer_import_execute.v1"]
  }),
  binding({
    id: "invocation.operation_binding",
    sourceFile: "invocation.ts",
    symbol: "TodosOperationInvocationSchema",
    kind: "refinement",
    invariantIds: [
      "todos.invocation.canonical_digests",
      "todos.invocation.authority_identity_binding",
      "todos.invocation.operation_scope_request"
    ],
    schemaIds: ["hasna.todos.operation_invocation.v1"]
  }),
  binding({
    id: "invocation.validate_operation",
    sourceFile: "invocation.ts",
    symbol: "validateTodosOperationInvocation",
    kind: "validator",
    invariantIds: [
      "todos.invocation.canonical_digests",
      "todos.invocation.authority_identity_binding",
      "todos.invocation.operation_scope_request"
    ],
    schemaIds: ["hasna.todos.operation_invocation.v1"]
  }),
  binding({
    id: "contract.verify_digest_closure",
    sourceFile: "contract.ts",
    symbol: "verifyTodosContractDigests",
    kind: "validator",
    invariantIds: ["todos.contract.digest_closure"],
    schemaIds: ["hasna.todos.contract.v1"]
  }),
  binding({
    id: "contract.digest_closure",
    sourceFile: "contract.ts",
    symbol: "validateTodosContractDescriptor",
    kind: "validator",
    invariantIds: ["todos.contract.digest_closure"],
    schemaIds: ["hasna.todos.contract.v1"]
  }),
  binding({
    id: "transfer.bundle_owner_binding",
    sourceFile: "transfer-schema.ts",
    symbol: "TodosTransferBundleSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.source_authority"],
    schemaIds: ["hasna.todos.transfer_bundle.v1"]
  }),
  binding({
    id: "transfer.integrity",
    sourceFile: "transfer-schema.ts",
    symbol: "validateTodosTransferBundleIntegrity",
    kind: "validator",
    invariantIds: [
      "todos.transfer.section_integrity",
      "todos.transfer.classification",
      "todos.transfer.reference_closure",
      "todos.transfer.dependency_closure",
      "todos.transfer.attachment_content_addressing",
      "todos.transfer.deletion_redaction"
    ],
    schemaIds: ["hasna.todos.transfer_bundle.v1"]
  }),
  binding({
    id: "transfer.canonical_digests",
    sourceFile: "transfer.ts",
    symbol: "validateTodosTransferBundle",
    kind: "validator",
    invariantIds: ["todos.transfer.canonical_digests"],
    schemaIds: ["hasna.todos.transfer_bundle.v1"]
  }),
  binding({
    id: "transfer.public_checkpoint_canonical",
    sourceFile: "transfer.ts",
    symbol: "TodosTransferCheckpointSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.public_canonical_boundaries"],
    schemaIds: ["hasna.todos.transfer_checkpoint.v1"]
  }),
  binding({
    id: "transfer.public_receipt_canonical",
    sourceFile: "transfer.ts",
    symbol: "TodosMigrationReceiptSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.public_canonical_boundaries"],
    schemaIds: [
      "hasna.todos.migration_receipt.v1",
      "hasna.todos.response.migration_receipt.v1",
      "hasna.todos.response.migration_receipt_page.v1"
    ]
  }),
  binding({
    id: "transfer.public_execution_request_canonical",
    sourceFile: "transfer.ts",
    symbol: "TodosTransferImportExecutionSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.public_canonical_boundaries"],
    schemaIds: ["hasna.todos.transfer_import_execution.v1"]
  }),
  binding({
    id: "transfer.public_checkpoint_transition",
    sourceFile: "transfer.ts",
    symbol: "validateTodosTransferCheckpointTransition",
    kind: "validator",
    invariantIds: ["todos.transfer.public_canonical_boundaries"],
    schemaIds: ["hasna.todos.transfer_checkpoint.v1"]
  }),
  binding({
    id: "transfer.public_receipt_chain",
    sourceFile: "transfer.ts",
    symbol: "validateTodosMigrationReceiptChain",
    kind: "validator",
    invariantIds: [
      "todos.transfer.public_canonical_boundaries",
      "todos.transfer.receipt_chain"
    ],
    schemaIds: ["hasna.todos.migration_receipt.v1"]
  }),
  binding({
    id: "transfer.import_plan_digest",
    sourceFile: "transfer-schema.ts",
    symbol: "TodosTransferImportPreviewSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.import_plan"],
    schemaIds: ["hasna.todos.transfer_import_preview.v1"]
  }),
  binding({
    id: "transfer.checkpoint_record",
    sourceFile: "transfer-schema.ts",
    symbol: "TodosTransferCheckpointSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.checkpoint_binding"],
    schemaIds: ["hasna.todos.transfer_checkpoint.v1"]
  }),
  binding({
    id: "transfer.checkpoint_transition",
    sourceFile: "transfer-schema.ts",
    symbol: "validateTodosTransferCheckpointTransition",
    kind: "validator",
    invariantIds: ["todos.transfer.checkpoint_monotonicity"],
    schemaIds: ["hasna.todos.transfer_checkpoint.v1"]
  }),
  binding({
    id: "transfer.execution_request",
    sourceFile: "transfer-schema.ts",
    symbol: "TodosTransferImportExecutionSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.execution_request_binding"],
    schemaIds: ["hasna.todos.transfer_import_execution.v1"]
  }),
  binding({
    id: "transfer.execution_context",
    sourceFile: "transfer-schema.ts",
    symbol: "TodosTransferExecutionContextSchema",
    kind: "schema",
    invariantIds: ["todos.transfer.execution_context_closed"],
    schemaIds: ["hasna.todos.transfer_execution_context.v1"]
  }),
  binding({
    id: "transfer.receipt_record",
    sourceFile: "transfer-schema.ts",
    symbol: "TodosMigrationReceiptSchema",
    kind: "refinement",
    invariantIds: ["todos.transfer.receipt_binding"],
    schemaIds: ["hasna.todos.migration_receipt.v1"]
  }),
  binding({
    id: "transfer.receipt_chain",
    sourceFile: "transfer-schema.ts",
    symbol: "validateTodosMigrationReceiptChain",
    kind: "validator",
    invariantIds: ["todos.transfer.receipt_chain"],
    schemaIds: ["hasna.todos.migration_receipt.v1"]
  }),
  binding({
    id: "transfer.execution_replay",
    sourceFile: "transfer-schema.ts",
    symbol: "evaluateTodosImportExecutionIntegrity",
    kind: "validator",
    invariantIds: ["todos.transfer.replay_binding"],
    schemaIds: [
      "hasna.todos.transfer_import_execution.v1",
      "hasna.todos.transfer_execution_context.v1"
    ]
  }),
  binding({
    id: "transfer.canonical_execution",
    sourceFile: "transfer.ts",
    symbol: "evaluateTodosImportExecution",
    kind: "validator",
    invariantIds: ["todos.transfer.execution_canonical_digests"],
    schemaIds: ["hasna.todos.transfer_import_execution.v1"]
  }),
  binding({
    id: "projection.head_binding",
    sourceFile: "projection.ts",
    symbol: "TaskToPrHeadBindingSchema",
    kind: "refinement",
    invariantIds: ["todos.projection.exact_head"],
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"]
  }),
  binding({
    id: "projection.record_binding",
    sourceFile: "projection.ts",
    symbol: "TaskToPrProjectionSchema",
    kind: "refinement",
    invariantIds: [
      "todos.projection.opaque_refs",
      "todos.projection.owner_kind_binding",
      "todos.projection.proof_identity",
      "todos.projection.digest_predecessor"
    ],
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"]
  }),
  binding({
    id: "projection.transition",
    sourceFile: "projection.ts",
    symbol: "validateTaskToPrProjectionTransition",
    kind: "validator",
    invariantIds: ["todos.projection.digest_predecessor"],
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"]
  }),
  binding({
    id: "projection.history",
    sourceFile: "projection.ts",
    symbol: "validateTaskToPrProjectionHistory",
    kind: "validator",
    invariantIds: ["todos.projection.full_history"],
    schemaIds: ["hasna.todos.task_to_pr_projection.v1"]
  }),
  binding({
    id: "artifacts.canonical_bytes",
    sourceFile: "artifacts.ts",
    symbol: "verifyTodosRenderedArtifacts",
    kind: "validator",
    invariantIds: ["todos.artifacts.canonical_bytes"],
    schemaIds: ["hasna.todos.contract.v1"]
  })
]);
// src/todos/invocation.ts
var TodosOperationInvocationSchema = TodosOperationInvocationEnvelopeSchema.superRefine((value, ctx) => {
  if (value.contractDigest !== TODOS_CONTRACT_DIGEST) {
    ctx.addIssue({
      code: "custom",
      message: "Invocation contract digest does not match this contract",
      path: ["contractDigest"]
    });
  }
  if (value.manifestDigest !== TODOS_OPERATION_MANIFEST_DIGEST) {
    ctx.addIssue({
      code: "custom",
      message: "Invocation manifest digest does not match this operation manifest",
      path: ["manifestDigest"]
    });
  }
  if (value.authorityId !== value.identity.organizationId || value.authorityId !== value.identity.tenantId) {
    ctx.addIssue({
      code: "custom",
      message: "Invocation authority must match the validated identity tenant",
      path: ["authorityId"]
    });
  }
  const operation = getTodosOperation(value.operationId);
  if (!operation) {
    ctx.addIssue({
      code: "custom",
      message: "Invocation operation is not declared by the operation manifest",
      path: ["operationId"]
    });
    return;
  }
  const identityResult = validateTodosIdentityContext(value.identity, {
    organizationId: value.authorityId,
    tenantId: value.authorityId,
    audience: operation.audience,
    requiredScopes: operation.requiredScopes,
    requireIdempotencyKey: operation.idempotency === "required"
  });
  if (!identityResult.success) {
    ctx.addIssue({
      code: "custom",
      message: `${identityResult.error.code}: ${identityResult.error.message}`,
      path: ["identity"]
    });
  }
  const requestSchema = TODOS_REQUEST_SCHEMAS[operation.requestSchemaId];
  if (!requestSchema) {
    ctx.addIssue({
      code: "custom",
      message: "Operation request schema is not registered",
      path: ["operationId"]
    });
    return;
  }
  const requestResult = requestSchema.safeParse(value.request);
  if (!requestResult.success) {
    for (const issue of requestResult.error.issues) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: ["request", ...issue.path]
      });
    }
    return;
  }
  if (operation.id === "todos.transfer.validate" || operation.id === "todos.transfer.import_preview" || operation.id === "todos.transfer.import_execute") {
    const request = requestResult.data;
    if (request.bundle.contractDigest !== value.contractDigest || request.bundle.manifestDigest !== value.manifestDigest) {
      ctx.addIssue({
        code: "custom",
        message: "Transfer bundle digests must match the canonical invocation digests",
        path: ["request", "bundle"]
      });
    }
    if (request.targetAuthorityId !== undefined && request.targetAuthorityId !== value.authorityId) {
      ctx.addIssue({
        code: "custom",
        message: "Transfer target authority must match the invocation authority",
        path: ["request", "targetAuthorityId"]
      });
    }
    if (request.checkpoint && request.checkpoint.idempotencyKey !== value.identity.idempotencyKey) {
      ctx.addIssue({
        code: "custom",
        message: "Transfer checkpoint idempotency must match the invocation identity",
        path: ["request", "checkpoint", "idempotencyKey"]
      });
    }
    if (!validateTodosTransferBundle(request.bundle).valid) {
      ctx.addIssue({
        code: "custom",
        message: "Transfer operations require a canonical, fully valid bundle",
        path: ["request", "bundle"]
      });
    }
  }
});
function validateTodosOperationInvocation(input) {
  const parsed = TodosOperationInvocationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: createTodosError("TODOS_INVALID_INPUT", "Todos operation invocation is invalid", {
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || null,
          reason: issue.message
        }))
      })
    };
  }
  const operation = getTodosOperation(parsed.data.operationId);
  if (!operation) {
    return {
      success: false,
      error: createTodosError("TODOS_OPERATION_UNSUPPORTED", "Todos operation is not declared")
    };
  }
  return {
    success: true,
    invocation: parsed.data,
    operation
  };
}
var TODOS_INVOCATION_SCHEMAS = Object.freeze({
  [TODOS_OPERATION_INVOCATION_SCHEMA_ID]: TodosOperationInvocationEnvelopeSchema
});
// src/todos/schema-registry.ts
var TODOS_SCHEMA_REGISTRY = Object.freeze({
  ...TODOS_SCHEMA_FOUNDATION_REGISTRY,
  ...TODOS_INVOCATION_SCHEMAS
});
function buildTodosSchemaBundle() {
  const schemas = buildTodosJsonSchemas(TODOS_SCHEMA_REGISTRY);
  const schemaDigest = sha256TodosValue(schemas);
  if (schemaDigest !== TODOS_SCHEMA_BUNDLE_DIGEST) {
    throw new Error("Canonical Todos runtime schemas diverged from the version-neutral schema foundation");
  }
  return {
    schema: "hasna.todos.schema_bundle.v1",
    contractVersion: TODOS_CONTRACT_VERSION,
    manifestVersion: TODOS_MANIFEST_VERSION,
    schemaDigest,
    invariantRegistryDigest: TODOS_INVARIANT_REGISTRY_DIGEST,
    runtimeValidationRequired: true,
    invariants: TODOS_INVARIANT_REGISTRY,
    schemas
  };
}

// src/todos/artifacts.ts
var TODOS_GENERATED_ARTIFACT_ROOT = "generated/todos/v1";
function prettyTodosJson(value) {
  return `${JSON.stringify(canonicalizeTodosValue(value), null, 2)}
`;
}
function schemaRef(schemaId) {
  return { $ref: `#/components/schemas/${schemaId}` };
}
function schemaPropertyRef(schemaId, field) {
  return {
    $ref: `#/components/schemas/${schemaId}/properties/${field}`
  };
}
function jsonSchemaKind(schema, root, seen = new Set) {
  if (schema.type === "array")
    return "array";
  if (schema.type === "object")
    return "object";
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/")) {
    if (seen.has(schema.$ref))
      return "scalar";
    seen.add(schema.$ref);
    const target = schema.$ref.slice(2).split("/").reduce((value, segment) => value && typeof value === "object" ? value[segment.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined, root);
    if (target && typeof target === "object") {
      return jsonSchemaKind(target, root, seen);
    }
  }
  for (const branchKey of ["anyOf", "oneOf"]) {
    const branches = schema[branchKey];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        if (branch && typeof branch === "object") {
          const kind = jsonSchemaKind(branch, root, seen);
          if (kind !== "scalar")
            return kind;
        }
      }
    }
  }
  return "scalar";
}
function requestParameters(operation, schemas) {
  const http = operation.surfaces.http;
  if (!http)
    return [];
  const requestSchema = schemas[operation.requestSchemaId];
  if (!requestSchema) {
    throw new Error(`Operation ${operation.id} request schema is missing from the schema bundle`);
  }
  const properties = requestSchema.properties ?? {};
  const required = new Set(Array.isArray(requestSchema.required) ? requestSchema.required.filter((value) => typeof value === "string") : []);
  const pathFields = new Set([...http.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]));
  const parameters = [];
  for (const field of pathFields) {
    if (!properties[field]) {
      throw new Error(`Operation ${operation.id} path field ${field} is absent from its request schema`);
    }
    parameters.push({
      name: field,
      in: "path",
      required: true,
      schema: schemaPropertyRef(operation.requestSchemaId, field)
    });
  }
  if (http.method !== "GET")
    return parameters;
  for (const [field, propertySchema] of Object.entries(properties)) {
    if (pathFields.has(field))
      continue;
    const base = {
      name: field,
      in: "query",
      required: required.has(field)
    };
    const propertyRef = schemaPropertyRef(operation.requestSchemaId, field);
    const kind = jsonSchemaKind(propertySchema, requestSchema);
    if (kind === "object") {
      parameters.push({
        ...base,
        content: {
          "application/json": {
            schema: propertyRef
          }
        }
      });
    } else if (kind === "array") {
      parameters.push({
        ...base,
        style: "form",
        explode: true,
        schema: propertyRef
      });
    } else {
      parameters.push({
        ...base,
        schema: propertyRef
      });
    }
  }
  return parameters;
}
function invocationHeaderParameters(operation) {
  const parameters = [
    {
      name: "X-Todos-Authority-Id",
      in: "header",
      required: true,
      schema: { type: "string", pattern: "^[a-z][a-z0-9.-]*$" }
    },
    {
      name: "X-Todos-Contract-Digest",
      in: "header",
      required: true,
      schema: { type: "string", const: TODOS_CONTRACT_DIGEST }
    },
    {
      name: "X-Todos-Manifest-Digest",
      in: "header",
      required: true,
      schema: { type: "string", const: TODOS_OPERATION_MANIFEST_DIGEST }
    },
    {
      name: "X-Todos-Operation-Id",
      in: "header",
      required: true,
      schema: { type: "string", const: operation.id }
    },
    {
      name: "X-Todos-Request-Id",
      in: "header",
      required: true,
      schema: {
        type: "string",
        minLength: 8,
        maxLength: 160,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
      }
    }
  ];
  if (operation.idempotency !== "none") {
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: operation.idempotency === "required",
      schema: {
        type: "string",
        minLength: 8,
        maxLength: 160,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
      }
    });
  }
  return parameters;
}
function invocationContextBindings(operation) {
  const http = operation.surfaces.http;
  if (!http) {
    throw new Error(`Operation ${operation.id} does not declare an HTTP surface`);
  }
  return {
    schema: schemaRef(TODOS_OPERATION_INVOCATION_SCHEMA_ID),
    fields: {
      authorityId: {
        source: { in: "header", name: "X-Todos-Authority-Id" },
        target: "authorityId"
      },
      contractDigest: {
        source: { in: "header", name: "X-Todos-Contract-Digest" },
        target: "contractDigest"
      },
      manifestDigest: {
        source: { in: "header", name: "X-Todos-Manifest-Digest" },
        target: "manifestDigest"
      },
      operationId: {
        source: { in: "header", name: "X-Todos-Operation-Id" },
        target: "operationId"
      },
      identity: {
        source: { in: "security", name: "bearerAuth" },
        target: "identity",
        validated: true
      },
      requestId: {
        source: { in: "header", name: "X-Todos-Request-Id" },
        target: "identity.requestId"
      },
      idempotencyKey: operation.idempotency === "none" ? null : {
        source: { in: "header", name: "Idempotency-Key" },
        target: "identity.idempotencyKey",
        required: operation.idempotency === "required"
      },
      request: {
        source: {
          in: http.method === "GET" ? "query" : "body",
          ...http.method === "GET" ? {} : { mediaType: "application/json" }
        },
        target: "request"
      }
    }
  };
}
function buildTodosOpenApi() {
  const schemaBundle = buildTodosSchemaBundle();
  const paths = {};
  for (const operation of TODOS_OPERATION_MANIFEST.operations) {
    const http = operation.surfaces.http;
    if (!http) {
      continue;
    }
    const method = http.method.toLowerCase();
    paths[http.path] ??= {};
    paths[http.path][method] = {
      operationId: operation.id,
      summary: `${operation.resource}.${operation.action}`,
      tags: [operation.capabilityId],
      security: [{ bearerAuth: [] }],
      parameters: [
        ...requestParameters(operation, schemaBundle.schemas),
        ...invocationHeaderParameters(operation)
      ],
      ...http.method === "GET" ? {
        "x-todos-request-schema": schemaRef(operation.requestSchemaId)
      } : {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef(operation.requestSchemaId)
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Typed Todos response",
          content: {
            "application/json": {
              schema: schemaRef(operation.responseSchemaId)
            }
          }
        },
        default: {
          description: "Typed Todos error",
          content: {
            "application/json": {
              schema: schemaRef(operation.errorSchemaId)
            }
          }
        }
      },
      "x-todos-audience": operation.audience,
      "x-todos-required-scopes": operation.requiredScopes,
      "x-todos-identity-context-schema": schemaRef(TODOS_IDENTITY_SCHEMA_ID),
      "x-todos-invocation-context-schema": schemaRef(TODOS_OPERATION_INVOCATION_SCHEMA_ID),
      "x-todos-invocation-bindings": invocationContextBindings(operation),
      "x-todos-idempotency": operation.idempotency,
      "x-todos-concurrency": operation.concurrency
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/contracts Todos",
      version: TODOS_CONTRACT_VERSION,
      description: "Pure customer contract for Todos local and cloud authorities."
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "TodosIdentityContext"
        }
      },
      schemas: schemaBundle.schemas
    },
    "x-hasna-invariants": TODOS_INVARIANT_REGISTRY,
    "x-todos-schema-digest": schemaBundle.schemaDigest,
    "x-todos-invariant-registry-digest": schemaBundle.invariantRegistryDigest,
    "x-todos-runtime-validation-required": true,
    paths
  };
}
function buildTodosSurfaceMap() {
  return {
    schema: "hasna.todos.surface_map.v1",
    version: TODOS_MANIFEST_VERSION,
    provenance: TODOS_CONTRACT_PROVENANCE,
    provenanceDigest: TODOS_PROVENANCE_DIGEST,
    operations: TODOS_OPERATION_MANIFEST.operations.map((operation) => ({
      id: operation.id,
      cli: operation.surfaces.cli,
      mcp: operation.surfaces.mcp,
      sdk: operation.surfaces.sdk,
      http: operation.surfaces.http
    }))
  };
}
function buildTodosConformanceProfile() {
  const shared2 = TODOS_OPERATION_MANIFEST.operations.filter((operation) => operation.classification === "shared_customer").map((operation) => operation.id);
  const localTopology2 = TODOS_OPERATION_MANIFEST.operations.filter((operation) => operation.classification === "local_topology_only").map((operation) => operation.id);
  return {
    schema: "hasna.todos.conformance.v1",
    contractVersion: TODOS_CONTRACT_VERSION,
    manifestVersion: TODOS_MANIFEST_VERSION,
    authority: {
      count: 1
    },
    sharedCustomerOperationIds: shared2,
    localTopologyOperationIds: localTopology2,
    invariants: {
      sharedHttpPrefix: "/v1/",
      localTopologyHttpSurface: null,
      customerAudiences: ["customer", "tenant_admin"],
      capabilitySource: "operation_manifest",
      errorVocabulary: "typed"
    }
  };
}
function sampleOwnerRef(kind, id, owner = "hasna.todos") {
  return {
    owner,
    kind,
    id,
    digest: sha256TodosText(`${owner}:${kind}:${id}`)
  };
}
function sampleExternalOwnerRef(id) {
  return {
    owner: "tenant-a",
    id,
    digest: sha256TodosText(`tenant-a:${id}`)
  };
}
function sampleProjection() {
  const branchHead = { algorithm: "sha1", value: "a".repeat(40) };
  const equalityProof = {
    ref: sampleOwnerRef("proof_bundle", "proof-head-equality"),
    kind: "head_equality",
    head: branchHead,
    observedAt: "2026-07-24T00:00:00.000Z"
  };
  return createTaskToPrProjection({
    schema: "hasna.todos.task_to_pr_projection.v1",
    id: "projection-1",
    owner: "hasna.todos",
    version: 1,
    sequence: 1,
    predecessor: null,
    identity: {
      taskRef: sampleOwnerRef("task", "task-1"),
      repositoryRef: sampleOwnerRef("repository", "repo-1"),
      worktreeRef: sampleOwnerRef("worktree", "worktree-1"),
      branchRef: sampleOwnerRef("branch", "branch-1"),
      baseHead: { algorithm: "sha1", value: "b".repeat(40) }
    },
    pullRequestRef: sampleOwnerRef("pull_request", "pr-1"),
    head: {
      branchHead,
      publishedHead: branchHead,
      providerObservedHead: branchHead,
      equalityProof
    },
    proofs: [{
      ref: sampleOwnerRef("proof_bundle", "proof-ci-1"),
      kind: "ci",
      head: branchHead,
      observedAt: "2026-07-24T00:00:00.000Z"
    }],
    derivedAt: "2026-07-24T00:00:00.000Z"
  });
}
function invalidProjectionSuccessor(previous) {
  const unsigned = {
    schema: previous.schema,
    id: previous.id,
    owner: previous.owner,
    version: 2,
    sequence: 2,
    predecessor: {
      kind: "task_to_pr_projection",
      projectionId: previous.id,
      owner: previous.owner,
      version: previous.version,
      digest: sha256TodosText("wrong-predecessor")
    },
    identity: previous.identity,
    pullRequestRef: previous.pullRequestRef,
    head: previous.head,
    proofs: previous.proofs,
    derivedAt: "2026-07-24T00:01:00.000Z"
  };
  return createTaskToPrProjection(unsigned);
}
function transferRecords() {
  const createdAt = "2026-07-24T00:00:00.000Z";
  const project = {
    id: "project-1",
    owner: "tenant-a",
    version: 1,
    createdAt,
    updatedAt: createdAt,
    slug: "contract-fixture",
    name: "Contract fixture",
    description: "Small transfer fixture",
    repositoryRef: sampleExternalOwnerRef("repository-1"),
    archivedAt: null
  };
  const taskBase = {
    owner: "tenant-a",
    version: 1,
    createdAt,
    updatedAt: createdAt,
    shortId: null,
    description: null,
    status: "pending",
    priority: "medium",
    projectId: project.id,
    taskListId: null,
    planId: null,
    parentTaskId: null,
    assignedAgentId: null,
    fingerprint: null,
    tags: [],
    acceptanceCriteria: [],
    dueAt: null,
    completedAt: null,
    externalOwnerRefs: []
  };
  const tasks = [
    { ...taskBase, id: "task-1", title: "Prepare contract" },
    { ...taskBase, id: "task-2", title: "Verify contract" }
  ];
  const dependency = {
    id: "dependency-1",
    owner: "tenant-a",
    version: 1,
    createdAt,
    updatedAt: createdAt,
    sourceTaskId: "task-2",
    targetTaskId: "task-1",
    kind: "requires"
  };
  const taskFile = {
    id: "task-file-1",
    owner: "tenant-a",
    version: 1,
    createdAt,
    updatedAt: createdAt,
    taskId: "task-1",
    logicalName: "contract.json",
    contentRef: {
      algorithm: "sha256",
      digest: sha256TodosText("contract-fixture-content"),
      mediaType: "application/json",
      byteLength: 128
    },
    purpose: "deliverable"
  };
  return {
    projects: [project],
    task_lists: [],
    plans: [],
    tasks,
    comments: [],
    dependencies: [dependency],
    activities: [],
    verification_evidence: [],
    task_files: [taskFile],
    runs: [],
    run_events: [],
    run_commands: [],
    run_files: [],
    run_artifacts: [],
    git_commits: [],
    git_refs: [],
    traceability: [],
    task_to_pr_projections: [],
    saved_views: [],
    task_templates: [],
    approvals: [],
    deletion_records: [{
      id: "deletion-1",
      owner: "tenant-a",
      entityKind: "task",
      entityIdDigest: sha256TodosText("deleted-task"),
      priorRecordDigest: sha256TodosText("deleted-task-record"),
      tombstoneVersion: 1,
      redaction: "full",
      reasonCode: "customer_request",
      deletedAt: createdAt
    }]
  };
}
function sampleTransferBundle() {
  return createTodosTransferBundle({
    bundleId: "bundle-1",
    createdAt: "2026-07-24T00:00:00.000Z",
    source: {
      authorityId: "tenant-a"
    },
    records: transferRecords()
  });
}
function buildTodosFixtures() {
  const localAuthority = createTodosAuthorityHandshake({
    authority: {
      id: "tenant-a-local",
      endpoint: null
    },
    issuedAt: "2026-07-24T00:00:00.000Z"
  });
  const cloudAuthority = createTodosAuthorityHandshake({
    authority: {
      id: "tenant-a-cloud",
      endpoint: "https://todos.example.invalid/v1"
    },
    issuedAt: "2026-07-24T00:00:00.000Z"
  });
  const identity = TodosIdentityContextSchema.parse({
    issuer: "https://identity.example.invalid",
    audience: "customer",
    subject: "user-1",
    organizationId: "tenant-a",
    tenantId: "tenant-a",
    roles: ["customer_member"],
    scopes: ["todos:*"],
    keyId: "key-1",
    tokenId: "token-1",
    requestId: "request-1",
    agentId: null,
    sessionId: null,
    projectId: "project-1",
    taskListId: null,
    idempotencyKey: "request-key-1"
  });
  const invalidIdentity = { ...identity };
  delete invalidIdentity.tenantId;
  const transfer = sampleTransferBundle();
  const invalidTransfer = structuredClone(transfer);
  invalidTransfer.sections.tasks.count += 1;
  const projection = sampleProjection();
  return {
    "fixtures/authority.local.valid.json": localAuthority,
    "fixtures/authority.cloud.valid.json": cloudAuthority,
    "fixtures/identity.valid.json": identity,
    "fixtures/identity.invalid.json": invalidIdentity,
    "fixtures/transfer.valid.json": transfer,
    "fixtures/transfer.invalid.json": invalidTransfer,
    "fixtures/projection.valid.json": projection,
    "fixtures/projection-transition.invalid.json": {
      previous: projection,
      current: invalidProjectionSuccessor(projection)
    }
  };
}
function baseArtifactValues() {
  return {
    "contract.json": {
      descriptor: TODOS_CONTRACT_DESCRIPTOR,
      digest: TODOS_CONTRACT_DIGEST
    },
    "operation-manifest.json": TODOS_OPERATION_MANIFEST,
    "capability-manifest.json": TODOS_CAPABILITY_MANIFEST,
    "invariant-registry.json": TODOS_INVARIANT_REGISTRY,
    "generator-provenance.json": buildTodosGeneratorProvenance(TODOS_CONTRACT_DIGEST),
    "openapi.json": buildTodosOpenApi(),
    "schema-bundle.json": buildTodosSchemaBundle(),
    "surface-map.json": buildTodosSurfaceMap(),
    "transfer-classification.json": TODOS_TRANSFER_CLASSIFICATION,
    "conformance-profile.json": buildTodosConformanceProfile(),
    "source-freeze.json": TODOS_SOURCE_FREEZE,
    ...buildTodosFixtures()
  };
}
function verifyTodosRenderedArtifacts(rendered) {
  const issues = [];
  const canonical = renderTodosArtifacts();
  const canonicalPaths = [...new Set([
    ...Object.keys(canonical),
    ...Object.keys(rendered)
  ])].sort((left, right) => left.localeCompare(right));
  for (const path of canonicalPaths) {
    if (rendered[path] !== canonical[path]) {
      issues.push(`Canonical artifact mismatch: ${path}`);
    }
  }
  const checksumsText = rendered["checksums.json"];
  if (!checksumsText) {
    return { valid: false, issues: ["checksums.json is missing"] };
  }
  let checksums;
  try {
    checksums = JSON.parse(checksumsText);
  } catch {
    return { valid: false, issues: ["checksums.json is not valid JSON"] };
  }
  const expectedPaths = Object.keys(rendered).filter((path) => path !== "checksums.json").sort((left, right) => left.localeCompare(right));
  const checksumPaths = Object.keys(checksums.files ?? {}).sort((left, right) => left.localeCompare(right));
  if (stableTodosJson(expectedPaths) !== stableTodosJson(checksumPaths)) {
    issues.push("Checksum file list does not cover every artifact exactly");
  }
  for (const path of expectedPaths) {
    if (checksums.files?.[path] !== sha256TodosText(rendered[path])) {
      issues.push(`Checksum mismatch: ${path}`);
    }
  }
  if (checksums.aggregateDigest !== sha256TodosValue(checksums.files ?? {})) {
    issues.push("Checksum aggregate digest is invalid");
  }
  const parse = (path) => {
    const content = rendered[path];
    if (!content) {
      issues.push(`${path} is missing`);
      return null;
    }
    try {
      return JSON.parse(content);
    } catch {
      issues.push(`${path} is not valid JSON`);
      return null;
    }
  };
  const contract = parse("contract.json");
  if (!contract || contract.digest !== TODOS_CONTRACT_DIGEST || !validateTodosContractDescriptor(contract.descriptor)) {
    issues.push("Contract descriptor or digest is invalid");
  }
  const manifest = parse("operation-manifest.json");
  if (!manifest || sha256TodosValue(manifest) !== TODOS_OPERATION_MANIFEST_DIGEST) {
    issues.push("Operation manifest digest is invalid");
  }
  const capabilities = parse("capability-manifest.json");
  if (!capabilities || sha256TodosValue(capabilities) !== TODOS_CONTRACT_DESCRIPTOR.capabilityManifestDigest) {
    issues.push("Capability manifest digest is invalid");
  }
  const schemaBundle = parse("schema-bundle.json");
  if (!schemaBundle || schemaBundle.schemaDigest !== TODOS_SCHEMA_BUNDLE_DIGEST || sha256TodosValue(schemaBundle.schemas) !== TODOS_SCHEMA_BUNDLE_DIGEST) {
    issues.push("Schema bundle digest is invalid");
  }
  const invariants = parse("invariant-registry.json");
  if (!invariants || sha256TodosValue(invariants) !== TODOS_INVARIANT_REGISTRY_DIGEST) {
    issues.push("Invariant registry digest is invalid");
  }
  const provenance = parse("generator-provenance.json");
  const {
    identityDigest: provenanceIdentityDigest,
    outputContractDigest: provenanceContractDigest,
    ...generatorIdentity
  } = provenance ?? {};
  if (!provenance || provenanceIdentityDigest !== TODOS_GENERATOR_IDENTITY_DIGEST || sha256TodosValue(generatorIdentity) !== TODOS_GENERATOR_IDENTITY_DIGEST || provenanceContractDigest !== TODOS_CONTRACT_DIGEST) {
    issues.push("Generator provenance is invalid");
  }
  const sourceFreeze = parse("source-freeze.json");
  if (!sourceFreeze || stableTodosJson(sourceFreeze) !== stableTodosJson(TODOS_SOURCE_FREEZE)) {
    issues.push("Source freeze is invalid");
  }
  const surfaceMap = parse("surface-map.json");
  if (!surfaceMap || surfaceMap.provenanceDigest !== TODOS_PROVENANCE_DIGEST || stableTodosJson(surfaceMap.provenance) !== stableTodosJson(TODOS_CONTRACT_PROVENANCE)) {
    issues.push("Surface-map provenance is invalid");
  }
  return {
    valid: issues.length === 0,
    issues
  };
}
function renderTodosArtifacts() {
  const values = baseArtifactValues();
  const rendered = Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([path, value]) => [path, prettyTodosJson(value)]));
  const checksums = Object.fromEntries(Object.entries(rendered).sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => [path, sha256TodosText(content)]));
  return {
    ...rendered,
    "checksums.json": prettyTodosJson({
      schema: "hasna.todos.artifact_checksums.v1",
      algorithm: "sha256",
      files: checksums,
      aggregateDigest: sha256TodosValue(checksums)
    })
  };
}
export {
  verifyTodosRenderedArtifacts,
  verifyTodosContractDigests,
  validateTodosTransferCheckpointTransition2 as validateTodosTransferCheckpointTransition,
  validateTodosTransferBundle,
  validateTodosTaskStatusTransition,
  validateTodosOperationInvocation,
  validateTodosMigrationReceiptChain2 as validateTodosMigrationReceiptChain,
  validateTodosIdentityContext,
  validateTodosContractDescriptor,
  validateTaskToPrProjectionTransition,
  validateTaskToPrProjectionHistory,
  validateCanonicalTodosAuthorityHandshake,
  uniqueSortedTodosStrings,
  todosInvariantIdsForSchema,
  stableTodosJson,
  sortTodosRecords,
  sha256TodosValue,
  sha256TodosText,
  sameTodosGitObjectId,
  renderTodosArtifacts,
  isTodosTerminalTaskStatus,
  getTodosOperation,
  getTodosErrorCatalogEntry,
  evaluateTodosImportExecution,
  deriveTodosCapabilities,
  createTodosTransferImportPreview,
  createTodosTransferCheckpoint2 as createTodosTransferCheckpoint,
  createTodosTransferBundle,
  createTodosResultSchema,
  createTodosPageSchema,
  createTodosMigrationReceipt2 as createTodosMigrationReceipt,
  createTodosError,
  createTodosCapabilityManifest,
  createTodosAuthorityHandshake,
  createTaskToPrProjection,
  computeTodosTransferReferenceClosure,
  computeTodosTransferBundleChecksum,
  computeTodosImportPlanId,
  computeTodosDependencyClosure,
  computeTaskToPrProjectionDigest,
  canonicalizeTodosValue,
  buildTodosSurfaceMap,
  buildTodosOpenApi,
  buildTodosGeneratorProvenance,
  buildTodosFixtures,
  buildTodosConformanceProfile,
  TodosVerificationEvidenceSchema,
  TodosVerificationCommandSchema,
  TodosVerificationCheckSchema,
  TodosTransportMetaSchema,
  TodosTransferValidationSchema,
  TodosTransferSectionsSchema,
  TodosTransferSectionNameSchema,
  TodosTransferRepairIssueSchema,
  TodosTransferReferenceOnlySchema,
  TodosTransferReferenceClosureEntrySchema,
  TodosTransferRecordRefSchema,
  TodosTransferIssueSchema,
  TodosTransferImportPreviewSchema,
  TodosTransferImportExecutionSchema2 as TodosTransferImportExecutionSchema,
  TodosTransferExecutionContextSchema2 as TodosTransferExecutionContextSchema,
  TodosTransferConflictSchema,
  TodosTransferCheckpointSchema2 as TodosTransferCheckpointSchema,
  TodosTransferBundleSchema,
  TodosTraceabilitySchema,
  TodosTimestampSchema,
  TodosTaskTemplateSchema,
  TodosTaskStatusSchema,
  TodosTaskSchema,
  TodosTaskPrioritySchema,
  TodosTaskListSchema,
  TodosTaskFileSchema,
  TodosTaskContextSchema,
  TodosStatsSchema,
  TodosSourceFreezeSchema,
  TodosSlugSchema,
  TodosSha256DigestSchema,
  TodosServiceStatusSchema,
  TodosSearchRequestSchema,
  TodosSearchFilterSchema,
  TodosScopeSchema,
  TodosSavedViewSchema,
  TodosRunStatusSchema,
  TodosRunSchema,
  TodosRunFileSchema,
  TodosRunEventSchema,
  TodosRunCommandSchema,
  TodosRunArtifactSchema,
  TodosResponseMetaSchema,
  TodosRequestIdSchema,
  TodosRelativePathSchema,
  TodosProjectSchema,
  TodosPortableVerificationEvidenceSchema,
  TodosPortableTaskFileSchema,
  TodosPortableScalarSchema,
  TodosPortableRunFileSchema,
  TodosPortableRunCommandSchema,
  TodosPortableRunArtifactSchema,
  TodosPortableGitCommitSchema,
  TodosPortableCommandReceiptSchema,
  TodosPlanStatusSchema,
  TodosPlanSchema,
  TodosPageRequestSchema,
  TodosOwnerQualifiedRefSchema,
  TodosOwnerIdSchema,
  TodosOperationSchema,
  TodosOperationManifestSchema,
  TodosOperationInvocationSchema,
  TodosOperationInvocationEnvelopeSchema,
  TodosMutationReceiptSchema,
  TodosMigrationReceiptSchema2 as TodosMigrationReceiptSchema,
  TodosIdentityRoleSchema,
  TodosIdentityContextSchema,
  TodosIdempotencyKeySchema,
  TodosHttpSurfaceSchema,
  TodosGitRefSchema,
  TodosGitObjectIdSchema,
  TodosGitCommitSchema,
  TodosExternalOwnerRefSchema,
  TodosErrorSchema,
  TodosErrorEnvelopeSchema,
  TodosErrorDetailSchema,
  TodosErrorCodeSchema,
  TodosEntityIdSchema,
  TodosDependencySchema,
  TodosDependencyKindSchema,
  TodosDependencyClosureEntrySchema,
  TodosDeletionRecordSchema,
  TodosDateSchema,
  TodosCursorSchema,
  TodosContractProvenanceSchema,
  TodosContractDescriptorSchema,
  TodosContentRefSchema,
  TodosCommentSchema,
  TodosCommentKindSchema,
  TodosCapabilitySchema,
  TodosCapabilityManifestSchema,
  TodosCapabilityIdSchema,
  TodosCanonicalAuthorityHandshakeSchema,
  TodosAuthorityHandshakeSchema,
  TodosAuthorityDescriptorSchema,
  TodosAuthorityConfigSchema,
  TodosAudienceSchema,
  TodosAttachmentContentReferenceSchema,
  TodosApprovalSchema,
  TodosAgentStatusSchema,
  TodosAgentSchema,
  TodosActivitySchema,
  TaskToPrWorktreeRefSchema,
  TaskToPrTransitionIssueSchema,
  TaskToPrTaskRefSchema,
  TaskToPrRepositoryRefSchema,
  TaskToPrPullRequestRefSchema,
  TaskToPrProofSchema,
  TaskToPrProofRefSchema,
  TaskToPrProofKindSchema,
  TaskToPrProjectionSchema,
  TaskToPrProjectionPredecessorSchema,
  TaskToPrProjectionIdentitySchema,
  TaskToPrOwnerRefSchema,
  TaskToPrHeadBindingSchema,
  TaskToPrBranchRefSchema,
  TODOS_TRANSFER_VERSION,
  TODOS_TRANSFER_SECTION_NAMES,
  TODOS_TRANSFER_SCHEMA_IDS,
  TODOS_TRANSFER_SCHEMAS2 as TODOS_TRANSFER_SCHEMAS,
  TODOS_TRANSFER_CLASSIFICATION,
  TODOS_TERMINAL_TASK_STATUSES,
  TODOS_TASK_STATUS_TRANSITIONS,
  TODOS_SOURCE_FREEZE,
  TODOS_RUNTIME_VALIDATOR_BINDINGS,
  TODOS_RUNTIME_INVARIANTS,
  TODOS_RESPONSE_SCHEMA_IDS,
  TODOS_RESPONSE_SCHEMAS2 as TODOS_RESPONSE_SCHEMAS,
  TODOS_REQUEST_SCHEMA_IDS,
  TODOS_REQUEST_SCHEMAS2 as TODOS_REQUEST_SCHEMAS,
  TODOS_PROVENANCE_SCHEMA_ID,
  TODOS_PROVENANCE_SCHEMAS,
  TODOS_PROVENANCE_DIGEST,
  TODOS_PROJECTION_SCHEMA_IDS,
  TODOS_PROJECTION_SCHEMAS,
  TODOS_OPERATION_SCHEMAS,
  TODOS_OPERATION_MANIFEST_SCHEMA_ID,
  TODOS_OPERATION_MANIFEST_DIGEST,
  TODOS_OPERATION_MANIFEST,
  TODOS_OPERATION_INVOCATION_SCHEMA_ID,
  TODOS_MANIFEST_VERSION,
  TODOS_INVOCATION_SCHEMAS,
  TODOS_INVARIANT_REGISTRY_SCHEMA_ID,
  TODOS_INVARIANT_REGISTRY_DIGEST,
  TODOS_INVARIANT_REGISTRY,
  TODOS_IDENTITY_SCHEMA_ID,
  TODOS_GENERATOR_VERSION,
  TODOS_GENERATOR_PROVENANCE_SCHEMA_ID,
  TODOS_GENERATOR_IDENTITY_DIGEST,
  TODOS_GENERATOR_IDENTITY,
  TODOS_GENERATED_ARTIFACT_ROOT,
  TODOS_ERROR_CODES,
  TODOS_ERROR_CATALOG,
  TODOS_DOMAIN_SCHEMA_IDS,
  TODOS_DOMAIN_SCHEMAS,
  TODOS_DOMAIN_FIELD_CLASSIFICATION,
  TODOS_CONTRACT_VERSION,
  TODOS_CONTRACT_SCHEMA_ID,
  TODOS_CONTRACT_SCHEMAS,
  TODOS_CONTRACT_PROVENANCE,
  TODOS_CONTRACT_NAMESPACE,
  TODOS_CONTRACT_DIGEST,
  TODOS_CONTRACT_DESCRIPTOR,
  TODOS_COMMON_SCHEMA_IDS,
  TODOS_COMMON_SCHEMAS,
  TODOS_CAPABILITY_SCHEMA_IDS,
  TODOS_CAPABILITY_SCHEMAS,
  TODOS_CAPABILITY_MANIFEST,
  TODOS_CAPABILITY_IDS,
  TODOS_CANONICAL_TRANSFER_BINDING,
  TODOS_CANONICAL_CAPABILITY_IDS,
  TODOS_AUTHORITY_SCHEMA_IDS,
  TODOS_AUTHORITY_SCHEMAS
};
