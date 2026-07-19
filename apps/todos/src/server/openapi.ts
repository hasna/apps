/**
 * OpenAPI 3.1 document for the versioned `/v1` cloud API. This is the SINGLE
 * source of truth the typed SDK is generated from (see scripts/generate-sdk.ts)
 * and is served live at `GET /openapi.json` and `GET /v1/openapi.json`.
 */
import { getPackageVersion } from "../lib/package-version.js";

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "cancelled"] },
    priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
    project_id: { type: "string", nullable: true },
    assigned_to: { type: "string", nullable: true },
    agent_id: { type: "string", nullable: true, description: "Domain ownership metadata; never used as the authenticated security principal." },
    tags: { type: "array", items: { type: "string" } },
    version: { type: "number" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const projectSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    path: { type: "string" },
    description: { type: "string", nullable: true },
    task_list_id: { type: "string", nullable: true },
    task_prefix: { type: "string", nullable: true },
    task_counter: { type: "number" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const taskListSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    project_id: { type: "string", nullable: true },
    slug: { type: "string" },
    name: { type: "string" },
    description: { type: "string", nullable: true },
    metadata: { type: "object", additionalProperties: true },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const taskCommentSchema = {
  type: "object",
  required: ["id", "task_id", "agent_id", "session_id", "content", "type", "progress_pct", "created_at"],
  properties: {
    id: { type: "string" },
    task_id: { type: "string" },
    agent_id: { type: "string", nullable: true, description: "Effective actor recorded by the server." },
    session_id: { type: "string", nullable: true },
    content: { type: "string" },
    type: { type: "string", enum: ["comment", "progress", "note"] },
    progress_pct: { type: "number", nullable: true },
    created_at: { type: "string", format: "date-time" },
  },
} as const;

const planSchema = {
  type: "object",
  required: ["id", "slug", "name", "status", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    slug: { type: "string", nullable: true },
    project_id: { type: "string", nullable: true },
    task_list_id: { type: "string", nullable: true },
    agent_id: { type: "string", nullable: true, description: "Domain ownership metadata; never used as the authenticated security principal." },
    name: { type: "string" },
    description: { type: "string", nullable: true },
    status: { type: "string", enum: ["active", "completed", "archived"] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

const incidentSeverity = ["info", "low", "medium", "high", "critical"] as const;
const incidentStatus = ["open", "investigating", "contained", "monitoring", "resolved", "superseded"] as const;
const incidentAuthorityPattern = "^[A-Za-z0-9._:-]{1,128}$";
const incidentBlockedScopeSchema = {
  type: "string",
  maxLength: 128,
  pattern: "^(?:agent:[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}|channel:[a-z0-9]+(?:-[a-z0-9]+)*|project:[A-Za-z0-9][A-Za-z0-9_-]{0,119})$",
  "x-incident-scope-patterns": [
    "^agent:[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$",
    "^channel:[a-z0-9]+(?:-[a-z0-9]+)*$",
    "^project:[A-Za-z0-9][A-Za-z0-9_-]{0,119}$",
  ],
  description: "Routable Conversations recipient: agent:<agent-id>, channel:<normalized-channel-name>, or project:<project-id>.",
} as const;

const incidentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "title", "severity", "status", "owner", "affected_scopes", "blocked_scopes",
    "containment", "next_action", "deadline", "closure_evidence", "supersedes_id",
    "superseded_by_id", "resolved_at", "version", "created_at", "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string" },
    severity: { type: "string", enum: incidentSeverity },
    status: { type: "string", enum: incidentStatus },
    owner: { type: "string" },
    affected_scopes: { type: "array", minItems: 1, items: { type: "string" } },
    blocked_scopes: { type: "array", items: incidentBlockedScopeSchema },
    containment: { type: "string", nullable: true },
    next_action: { type: "string", nullable: true },
    deadline: { type: "string", format: "date-time", nullable: true },
    closure_evidence: { type: "array", items: { type: "string" } },
    supersedes_id: { type: "string", format: "uuid", nullable: true },
    superseded_by_id: { type: "string", format: "uuid", nullable: true },
    resolved_at: { type: "string", format: "date-time", nullable: true },
    version: { type: "integer", minimum: 1 },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

const incidentTransitionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "authority_id", "incident_id", "incident_version", "idempotency_key",
    "request_fingerprint", "action", "actor_id", "effective_actor_id", "actor_key_id",
    "actor_act_as", "reason", "before", "after", "created_at",
  ],
  properties: {
    id: { type: "string" },
    authority_id: { type: "string", pattern: incidentAuthorityPattern },
    incident_id: { type: "string", format: "uuid" },
    incident_version: { type: "integer", minimum: 1 },
    idempotency_key: { type: "string" },
    request_fingerprint: { type: "string" },
    action: { type: "string", enum: ["created", "updated", "resolved", "superseded"] },
    actor_id: { type: "string", description: "Authenticated principal." },
    effective_actor_id: { type: "string", description: "Effective actor after explicit administrative act-as." },
    actor_key_id: { type: "string", nullable: true },
    actor_act_as: { type: "boolean" },
    reason: { type: "string" },
    before: { ...incidentSchema, nullable: true },
    after: incidentSchema,
    created_at: { type: "string", format: "date-time" },
  },
} as const;

const incidentProjectionEventSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version", "source", "event_id", "projection_key", "authority_id", "incident_id",
    "transition_id", "incident_version", "occurred_at", "incident",
  ],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    source: { type: "string", enum: ["todos"] },
    event_id: { type: "string" },
    projection_key: { type: "string" },
    authority_id: { type: "string", pattern: incidentAuthorityPattern },
    incident_id: { type: "string", format: "uuid" },
    transition_id: { type: "string" },
    incident_version: { type: "integer", minimum: 1 },
    occurred_at: { type: "string", format: "date-time" },
    incident: incidentSchema,
  },
} as const;

const incidentOutboxSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "event_id", "projection_key", "incident_id", "incident_version", "depends_on_event_id",
    "payload", "status", "attempts", "next_attempt_at", "lease_token", "leased_by",
    "lease_expires_at", "delivery_id", "acked_at", "last_error", "failure_code", "failure_fingerprint",
    "consecutive_failures", "created_at", "updated_at",
  ],
  properties: {
    event_id: { type: "string" },
    projection_key: { type: "string" },
    incident_id: { type: "string", format: "uuid" },
    incident_version: { type: "integer", minimum: 1 },
    depends_on_event_id: { type: "string", nullable: true },
    payload: incidentProjectionEventSchema,
    status: { type: "string", enum: ["pending", "leased", "acked", "dead"] },
    attempts: { type: "integer", minimum: 0 },
    next_attempt_at: { type: "string", format: "date-time" },
    lease_token: { type: "string", nullable: true },
    leased_by: { type: "string", nullable: true },
    lease_expires_at: { type: "string", format: "date-time", nullable: true },
    delivery_id: { type: "string", nullable: true },
    acked_at: { type: "string", format: "date-time", nullable: true },
    last_error: { type: "string", nullable: true },
    failure_code: { type: "string", nullable: true, pattern: "^[A-Z][A-Z0-9_:-]{1,63}$" },
    failure_fingerprint: { type: "string", nullable: true },
    consecutive_failures: { type: "integer", minimum: 0 },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export function buildV1OpenApiDocument(version = getPackageVersion()) {
  const document = {
    openapi: "3.1.0",
    info: {
      title: "Todos V1 API",
      version,
      description:
        "Versioned cloud API for @hasna/todos (A1 pure-remote). Authenticate with an API key via the `x-api-key` header or `Authorization: Bearer <token>`. Every mutation requires an agent-bound principal. A principal with todos:* or * may explicitly act as another actor with `x-todos-act-as`; the append-only activity ledger preserves authenticated and effective attribution. Body `agent_id` values on task and plan records are domain metadata, not security context. Canonical incident operations return the declared retryable INCIDENT_UNAVAILABLE 503 without raw infrastructure details. Generated clients preserve non-2xx JSON as an intentionally untyped ApiError.body because error variants differ by operation.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Task: taskSchema,
        Project: projectSchema,
        TaskList: taskListSchema,
        TaskComment: taskCommentSchema,
        Plan: planSchema,
        Incident: incidentSchema,
        IncidentTransition: incidentTransitionSchema,
        IncidentProjectionEvent: incidentProjectionEventSchema,
        IncidentOutboxRecord: incidentOutboxSchema,
        IncidentMutationResult: {
          type: "object",
          required: ["incident", "transitions", "events", "replayed"],
          properties: {
            incident: { $ref: "#/components/schemas/Incident" },
            transitions: { type: "array", items: { $ref: "#/components/schemas/IncidentTransition" } },
            events: { type: "array", items: { $ref: "#/components/schemas/IncidentProjectionEvent" } },
            replayed: { type: "boolean" },
          },
        },
        CreateIncidentInput: {
          type: "object",
          additionalProperties: false,
          required: ["id", "idempotency_key", "title", "severity", "owner", "affected_scopes", "next_action"],
          properties: {
            id: { type: "string", format: "uuid" },
            idempotency_key: { type: "string", minLength: 8, maxLength: 128 },
            title: { type: "string", maxLength: 200 },
            severity: { type: "string", enum: incidentSeverity },
            status: { type: "string", enum: ["open", "investigating", "contained", "monitoring"] },
            owner: { type: "string", maxLength: 128 },
            affected_scopes: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } },
            blocked_scopes: { type: "array", maxItems: 64, items: incidentBlockedScopeSchema },
            containment: { type: "string", nullable: true },
            next_action: { type: "string" },
            deadline: { type: "string", format: "date-time", nullable: true },
            closure_evidence: { type: "array", maxItems: 64, items: { type: "string" } },
            supersedes_id: { type: "string", format: "uuid", nullable: true },
            supersedes_expected_version: { type: "integer", minimum: 1, nullable: true },
          },
        },
        TransitionIncidentInput: {
          type: "object",
          additionalProperties: false,
          required: ["expected_version", "idempotency_key", "reason"],
          minProperties: 4,
          properties: {
            expected_version: { type: "integer", minimum: 1 },
            idempotency_key: { type: "string", minLength: 8, maxLength: 128 },
            reason: { type: "string" },
            title: { type: "string" },
            severity: { type: "string", enum: incidentSeverity },
            status: { type: "string", enum: ["open", "investigating", "contained", "monitoring", "resolved"] },
            owner: { type: "string" },
            affected_scopes: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } },
            blocked_scopes: { type: "array", maxItems: 64, items: incidentBlockedScopeSchema },
            containment: { type: "string", nullable: true },
            next_action: { type: "string", nullable: true },
            deadline: { type: "string", format: "date-time", nullable: true },
            closure_evidence: { type: "array", maxItems: 64, items: { type: "string" } },
          },
        },
        CreateTaskInput: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "cancelled"] },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            project_id: { type: "string" },
            assigned_to: { type: "string" },
            agent_id: { type: "string", description: "Domain ownership metadata; does not select the authenticated actor." },
            assigned_by: { type: "string", description: "Actor assertion; when present it must match the authenticated effective actor." },
            tags: { type: "array", items: { type: "string" } },
          },
        },
        UpdateTaskInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "cancelled"] },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            project_id: { type: "string", nullable: true },
            assigned_to: { type: "string", nullable: true },
            working_dir: { type: "string", nullable: true },
            plan_id: { type: "string", nullable: true },
            task_list_id: { type: "string", nullable: true },
            cycle_id: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object", additionalProperties: true },
            due_at: { type: "string", format: "date-time", nullable: true },
            estimated_minutes: { type: "number", minimum: 0 },
            sla_minutes: { type: "number", minimum: 0, nullable: true },
            actual_minutes: { type: "number", minimum: 0 },
            completed_at: { type: "string", format: "date-time", nullable: true },
            confidence: { type: "number", minimum: 0, maximum: 1, nullable: true },
            retry_count: { type: "integer", minimum: 0 },
            max_retries: { type: "integer", minimum: 0 },
            retry_after: { type: "string", format: "date-time", nullable: true },
            requires_approval: { type: "boolean" },
            approved_by: { type: "string", minLength: 1, description: "Actor assertion; when present it must match the authenticated effective actor." },
            recurrence_rule: { type: "string", nullable: true },
            version: { type: "integer", minimum: 1 },
            task_type: { type: "string", nullable: true },
          },
        },
        CompleteTaskInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            agent_id: { type: "string", minLength: 1, description: "Optional compatibility hint; when present it must match the authenticated effective actor." },
            attachment_ids: { type: "array", items: { type: "string", minLength: 1 } },
            files_changed: { type: "array", items: { type: "string", minLength: 1 } },
            test_results: { type: "string" },
            commit_hash: { type: "string" },
            notes: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        FailTaskInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            agent_id: { type: "string", minLength: 1, description: "Optional compatibility hint; when present it must match the authenticated effective actor." },
            reason: { type: "string" },
            retry: { type: "boolean" },
            retry_after: { type: "string", format: "date-time" },
            error_code: { type: "string" },
          },
        },
        CreateProjectInput: {
          type: "object",
          additionalProperties: false,
          required: ["name", "path"],
          properties: {
            name: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            path: { type: "string", minLength: 1 },
            description: { type: "string" },
            task_list_id: { type: "string", minLength: 1, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
            task_prefix: { type: "string", minLength: 1 },
          },
        },
        UpdateProjectInput: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1 },
            path: { type: "string", minLength: 1 },
            description: { type: "string", nullable: true },
          },
        },
        RenameProjectInput: {
          type: "object",
          additionalProperties: false,
          required: ["new_slug"],
          properties: {
            new_slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            name: { type: "string", minLength: 1 },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            conflict: { type: "boolean" },
            retryable: { type: "boolean" },
          },
        },
        IncidentUnavailableResponse: {
          type: "object",
          additionalProperties: false,
          required: ["error", "code", "retryable"],
          properties: {
            error: { type: "string", enum: ["canonical incident service is temporarily unavailable"] },
            code: { type: "string", enum: ["INCIDENT_UNAVAILABLE"] },
            retryable: { type: "boolean", enum: [true] },
          },
        },
        CreateTaskListInput: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            project_id: { type: "string" },
            description: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        UpdateTaskListInput: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            name: { type: "string" },
            description: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        CreateTaskCommentInput: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1 },
            agent_id: { type: "string", description: "Optional compatibility hint; when present it must match the authenticated effective actor." },
            session_id: { type: "string" },
            type: { type: "string", enum: ["comment", "progress", "note"] },
            progress_pct: { type: "number" },
          },
        },
        CreatePlanInput: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1 },
            slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            description: { type: "string" },
            project_id: { type: "string", minLength: 1 },
            task_list_id: { type: "string", minLength: 1 },
            agent_id: { type: "string", minLength: 1, description: "Domain ownership metadata; does not select the authenticated actor." },
            status: { type: "string", enum: ["active", "completed", "archived"] },
          },
        },
        UpdatePlanInput: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1 },
            slug: { type: "string", minLength: 1, pattern: ".*[A-Za-z0-9].*" },
            description: { type: "string" },
            task_list_id: { type: "string", minLength: 1 },
            agent_id: { type: "string", minLength: 1, description: "Domain ownership metadata; does not select the authenticated actor." },
            status: { type: "string", enum: ["active", "completed", "archived"] },
          },
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/incidents": {
        get: {
          operationId: "listIncidents",
          summary: "List canonical incidents",
          description: "Reads server-authority-scoped incident rows. Conversations read or acknowledgment state is never canonical.",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: incidentStatus } },
            { name: "severity", in: "query", schema: { type: "string", enum: incidentSeverity } },
            { name: "owner", in: "query", schema: { type: "string" } },
            { name: "scope", in: "query", schema: { type: "string" } },
            { name: "active", in: "query", schema: { type: "boolean" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "before_updated_at", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "before_id", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: {
              type: "object", required: ["incidents", "count"], properties: {
                incidents: { type: "array", items: { $ref: "#/components/schemas/Incident" } },
                count: { type: "integer", minimum: 0 },
              },
            } } } },
          },
        },
        post: {
          operationId: "createIncident",
          summary: "Create or atomically supersede a canonical incident",
          description: "Does not create a task or dispatch an agent. Immutable actor provenance comes from authentication; owner is operational state.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateIncidentInput" } } } },
          responses: {
            "200": { description: "Idempotent replay", content: { "application/json": { schema: { type: "object", required: ["result"], properties: { result: { $ref: "#/components/schemas/IncidentMutationResult" } } } } } },
            "201": { content: { "application/json": { schema: { type: "object", required: ["result"], properties: { result: { $ref: "#/components/schemas/IncidentMutationResult" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/incidents/blockers": {
        get: {
          operationId: "listIncidentBlockers",
          summary: "List active canonical blockers",
          description: "The scope filter matches blocked_scopes only, never merely affected_scopes.",
          parameters: [
            { name: "severity", in: "query", schema: { type: "string", enum: incidentSeverity } },
            { name: "owner", in: "query", schema: { type: "string" } },
            { name: "scope", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "before_updated_at", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "before_id", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { content: { "application/json": { schema: {
            type: "object", required: ["incidents", "count", "active_statuses"], properties: {
              incidents: { type: "array", items: { $ref: "#/components/schemas/Incident" } },
              count: { type: "integer", minimum: 0 },
              active_statuses: { type: "array", items: { type: "string", enum: ["open", "investigating", "contained", "monitoring"] } },
            },
          } } } } },
        },
      },
      "/v1/incidents/{id}": {
        get: {
          operationId: "getIncident",
          summary: "Get a canonical incident",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["incident"], properties: { incident: { $ref: "#/components/schemas/Incident" } } } } } } },
        },
      },
      "/v1/incidents/{id}/transitions": {
        get: {
          operationId: "listIncidentTransitions",
          summary: "List immutable incident transitions",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["transitions", "count"], properties: {
            transitions: { type: "array", items: { $ref: "#/components/schemas/IncidentTransition" } }, count: { type: "integer", minimum: 0 },
          } } } } } },
        },
        post: {
          operationId: "transitionIncident",
          summary: "CAS-transition a canonical incident",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TransitionIncidentInput" } } } },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", required: ["result"], properties: { result: { $ref: "#/components/schemas/IncidentMutationResult" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/incidents/outbox/claim": {
        post: {
          operationId: "claimIncidentOutbox",
          summary: "Lease causally ready incident projections",
          description: "Requires todos:incident-project. A superseding replacement is ineligible until the old superseded event is acknowledged.",
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 }, lease_seconds: { type: "integer", minimum: 5, maximum: 3600 },
          } } } } },
          responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["outbox", "count"], properties: {
            outbox: { type: "array", items: { $ref: "#/components/schemas/IncidentOutboxRecord" } }, count: { type: "integer", minimum: 0 },
          } } } } } },
        },
      },
      "/v1/incidents/outbox": {
        get: {
          operationId: "listDeadIncidentOutbox",
          summary: "List dead incident projection events for operator recovery",
          description: "Requires todos:incident-recover. Dead records never expose a lease token.",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000 } },
            { name: "before_created_at", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "before_event_id", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["outbox", "count"], properties: {
            outbox: { type: "array", items: { $ref: "#/components/schemas/IncidentOutboxRecord" } }, count: { type: "integer", minimum: 0 },
          } } } } } },
        },
      },
      "/v1/incidents/outbox/{event_id}": {
        get: {
          operationId: "getDeadIncidentOutbox",
          summary: "Get one exact dead incident projection event",
          description: "Requires todos:incident-recover. Returns 404 unless the event is dead; lease credentials are never exposed.",
          parameters: [{ name: "event_id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", required: ["outbox"], properties: { outbox: { $ref: "#/components/schemas/IncidentOutboxRecord" } } } } } },
            "404": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/incidents/outbox/status": {
        get: {
          operationId: "getIncidentOutboxStatus",
          summary: "Get authority-scoped incident projection outbox counts",
          description: "Requires todos:incident-project. Returns counts only and never lease credentials.",
          responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["status"], properties: {
            status: { type: "object", additionalProperties: false, required: ["pending", "leased", "acked", "dead", "total"], properties: {
              pending: { type: "integer", minimum: 0 }, leased: { type: "integer", minimum: 0 },
              acked: { type: "integer", minimum: 0 }, dead: { type: "integer", minimum: 0 }, total: { type: "integer", minimum: 0 },
            } },
          } } } } } },
        },
      },
      "/v1/incidents/outbox/{event_id}/ack": {
        post: {
          operationId: "ackIncidentOutbox",
          summary: "Acknowledge an exact projection lease",
          description: "Requires todos:incident-project. The delivery identity must match the exact leased event.",
          parameters: [{ name: "event_id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["lease_token", "delivery_id"], properties: {
            lease_token: { type: "string" }, delivery_id: { type: "string" },
          } } } } },
          responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["outbox"], properties: { outbox: { $ref: "#/components/schemas/IncidentOutboxRecord" } } } } } } },
        },
      },
      "/v1/incidents/outbox/{event_id}/fail": {
        post: {
          operationId: "failIncidentOutbox",
          summary: "Fail an exact projection lease with bounded backoff",
          description: "Requires todos:incident-project. Persists only a stable failure class and bounded redacted summary.",
          parameters: [{ name: "event_id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["lease_token", "failure_code", "failure"], properties: {
            lease_token: { type: "string" }, failure_code: { type: "string", pattern: "^[A-Z][A-Z0-9_:-]{1,63}$" }, failure: { type: "string" },
          } } } } },
          responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["outbox"], properties: { outbox: { $ref: "#/components/schemas/IncidentOutboxRecord" } } } } } } },
        },
      },
      "/v1/incidents/outbox/{event_id}/requeue": {
        post: {
          operationId: "requeueIncidentOutbox",
          summary: "Audit and requeue one exact dead projection",
          description: "Requires todos:incident-recover. Never skips or acknowledges the dead transition.",
          parameters: [{ name: "event_id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["expected_attempts", "idempotency_key", "reason"], properties: {
            expected_attempts: { type: "integer", minimum: 1 }, idempotency_key: { type: "string", minLength: 8 }, reason: { type: "string" },
          } } } } },
          responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["outbox"], properties: { outbox: { $ref: "#/components/schemas/IncidentOutboxRecord" } } } } } } },
        },
      },
      "/v1/tasks": {
        get: {
          operationId: "listTasks",
          summary: "List tasks",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "priority", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "parent_id", in: "query", schema: { type: "string", nullable: true } },
            { name: "include_subtasks", in: "query", schema: { type: "boolean" } },
            { name: "plan_id", in: "query", schema: { type: "string" } },
            { name: "task_list_id", in: "query", schema: { type: "string" } },
            { name: "assigned_to", in: "query", schema: { type: "string" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["tasks", "count", "total"],
                    properties: {
                      tasks: { type: "array", items: { $ref: "#/components/schemas/Task" } },
                      count: { type: "integer", minimum: 0 },
                      total: { type: "integer", minimum: 0 },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createTask",
          summary: "Create a task",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTaskInput" } } },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } },
                },
              },
            },
          },
        },
      },
      "/v1/tasks/{id}": {
        get: {
          operationId: "getTask",
          summary: "Get a task by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } },
                },
              },
            },
          },
        },
        patch: {
          operationId: "updateTask",
          summary: "Update a task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTaskInput" } } },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } },
                },
              },
            },
          },
        },
        delete: {
          operationId: "deleteTask",
          summary: "Delete a task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } },
                },
              },
            },
          },
        },
      },
      "/v1/tasks/{id}/comments": {
        get: {
          operationId: "listTaskComments",
          summary: "List a bounded page of task comments",
          description:
            "Returns the newest page in oldest-to-newest display order. Use next_cursor to request older pages; count is the page size, not a total. Pagination-aware clients must send limit during the mixed-version rollout.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["comments", "count", "has_more", "next_cursor"],
                    properties: {
                      comments: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/TaskComment" } },
                      count: { type: "integer", minimum: 0, maximum: 500 },
                      has_more: { type: "boolean" },
                      next_cursor: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
            "426": {
              description:
                "Upgrade required: a predecessor client omitted limit and the complete legacy history exceeds 500 comments, or the configured storage adapter lacks cursor pagination support.",
            },
          },
        },
        post: {
          operationId: "createTaskComment",
          summary: "Create a task comment",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTaskCommentInput" } } },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["comment"],
                    properties: { comment: { $ref: "#/components/schemas/TaskComment" } },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/tasks/{id}/start": {
        post: {
          operationId: "startTask",
          summary: "Start a task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } } } } } },
        },
      },
      "/v1/tasks/{id}/complete": {
        post: {
          operationId: "completeTask",
          summary: "Complete a task",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CompleteTaskInput" } } },
          },
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { task: { $ref: "#/components/schemas/Task" } } } } } } },
        },
      },
      "/v1/tasks/{id}/fail": {
        post: {
          operationId: "failTask",
          summary: "Mark a task failed and optionally create a retry copy",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { $ref: "#/components/schemas/FailTaskInput" } } },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      result: {
                        type: "object",
                        properties: {
                          task: { $ref: "#/components/schemas/Task" },
                          retryTask: { $ref: "#/components/schemas/Task" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/projects": {
        get: {
          operationId: "listProjects",
          summary: "List projects",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      projects: { type: "array", items: { $ref: "#/components/schemas/Project" } },
                      count: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createProject",
          summary: "Create a project",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProjectInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/projects/{id}": {
        get: {
          operationId: "getProject",
          summary: "Get a project by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } } },
        },
        patch: {
          operationId: "updateProject",
          summary: "Update a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateProjectInput" } } },
          },
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } } },
        },
        delete: {
          operationId: "deleteProject",
          summary: "Delete a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } } } } } },
        },
      },
      "/v1/projects/{id}/rename": {
        post: {
          operationId: "renameProject",
          summary: "Atomically rename a project and its canonical task list",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/RenameProjectInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" }, task_lists_updated: { type: "number" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/plans": {
        get: {
          operationId: "listPlans",
          summary: "List plans",
          parameters: [{ name: "project_id", in: "query", schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { plans: { type: "array", items: { $ref: "#/components/schemas/Plan" } }, count: { type: "number" } } } } } },
          },
        },
        post: {
          operationId: "createPlan",
          summary: "Create a plan",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePlanInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { plan: { $ref: "#/components/schemas/Plan" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/plans/{id}": {
        get: {
          operationId: "getPlan",
          summary: "Get a plan by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { plan: { $ref: "#/components/schemas/Plan" } } } } } } },
        },
        patch: {
          operationId: "updatePlan",
          summary: "Update a plan",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdatePlanInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { plan: { $ref: "#/components/schemas/Plan" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        delete: {
          operationId: "deletePlan",
          summary: "Delete a plan and detach its tasks",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } } } } } },
        },
      },
      "/v1/task-lists": {
        get: {
          operationId: "listTaskLists",
          summary: "List task lists",
          parameters: [{ name: "project_id", in: "query", schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { task_lists: { type: "array", items: { $ref: "#/components/schemas/TaskList" } }, count: { type: "number" } } } } } } },
        },
        post: {
          operationId: "createTaskList",
          summary: "Create a task list",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTaskListInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { task_list: { $ref: "#/components/schemas/TaskList" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/task-lists/{id}": {
        get: {
          operationId: "getTaskList",
          summary: "Get a task list by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { task_list: { $ref: "#/components/schemas/TaskList" } } } } } },
          },
        },
        patch: {
          operationId: "updateTaskList",
          summary: "Update a task list",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTaskListInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { task_list: { $ref: "#/components/schemas/TaskList" } } } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        delete: {
          operationId: "deleteTaskList",
          summary: "Delete a task list",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } } } } } },
        },
      },
      "/v1/stats": {
        get: {
          operationId: "getStats",
          summary: "Aggregate counts",
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { tasks: { type: "number" }, projects: { type: "number" } } } } } } },
        },
      },
      "/v1/import": {
        post: {
          operationId: "importSnapshot",
          summary: "Bulk-ingest a full or partial snapshot (idempotent upsert by id)",
          description:
            "Upserts every record carried in the body by primary key. All record arrays are optional and default to []; a caller may backfill a single object type (e.g. just tasks) or a complete snapshot. Re-posting the same rows never duplicates. Requires dedicated todos:import or administrative scope. Imports always audit as the immutable todos-importer actor and reject x-todos-act-as.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    exportedAt: { type: "string" },
                    source: { type: "string" },
                    tasks: { type: "array", items: { $ref: "#/components/schemas/Task" } },
                    projects: { type: "array", items: { $ref: "#/components/schemas/Project" } },
                    projectMachinePaths: { type: "array", items: { type: "object" } },
                    plans: { type: "array", items: { type: "object" } },
                    agents: { type: "array", items: { type: "object" } },
                    taskLists: { type: "array", items: { type: "object" } },
                    templates: { type: "array", items: { type: "object" } },
                    auditHistory: { type: "array", items: { type: "object" } },
                    tombstones: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      received: { type: "number" },
                      result: {
                        type: "object",
                        properties: {
                          inserted: { type: "number" },
                          updated: { type: "number" },
                          deleted: { type: "number" },
                          skipped: { type: "number" },
                          errors: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const incidentUnavailable = {
    description: "Canonical incident authentication, schema, authority, or store is temporarily unavailable; retry with bounded backoff.",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/IncidentUnavailableResponse" },
      },
    },
  } as const;
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!path.startsWith("/v1/incidents")) continue;
    for (const operation of Object.values(pathItem as Record<string, { responses?: Record<string, unknown> }>)) {
      if (operation.responses) operation.responses["503"] = incidentUnavailable;
    }
  }
  return document;
}
