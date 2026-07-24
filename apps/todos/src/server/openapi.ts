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
    status: { type: "string" },
    priority: { type: "string" },
    project_id: { type: "string", nullable: true },
    assigned_to: { type: "string", nullable: true },
    agent_id: { type: "string", nullable: true },
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
    agent_id: { type: "string", nullable: true },
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
    agent_id: { type: "string", nullable: true },
    name: { type: "string" },
    description: { type: "string", nullable: true },
    status: { type: "string", enum: ["active", "completed", "archived"] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

const templateTaskSchema = {
  type: "object",
  required: ["id", "template_id", "position", "title_pattern", "priority", "tags", "depends_on_positions", "metadata", "created_at"],
  properties: {
    id: { type: "string" },
    template_id: { type: "string" },
    position: { type: "integer", minimum: 0 },
    title_pattern: { type: "string" },
    description: { type: "string", nullable: true },
    priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
    tags: { type: "array", items: { type: "string" } },
    task_type: { type: "string", nullable: true },
    condition: { type: "string", nullable: true },
    include_template_id: { type: "string", nullable: true },
    depends_on_positions: { type: "array", items: { type: "integer", minimum: 0 } },
    metadata: { type: "object", additionalProperties: true },
    created_at: { type: "string", format: "date-time" },
  },
} as const;

const templateSchema = {
  type: "object",
  required: ["id", "name", "title_pattern", "priority", "tags", "variables", "version", "metadata", "created_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    title_pattern: { type: "string" },
    description: { type: "string", nullable: true },
    priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
    tags: { type: "array", items: { type: "string" } },
    variables: { type: "array", items: { type: "object", properties: { name: { type: "string" }, required: { type: "boolean" }, default: { type: "string" }, description: { type: "string" } } } },
    version: { type: "integer", minimum: 1 },
    project_id: { type: "string", nullable: true },
    plan_id: { type: "string", nullable: true },
    metadata: { type: "object", additionalProperties: true },
    created_at: { type: "string", format: "date-time" },
    tasks: { type: "array", items: { $ref: "#/components/schemas/TemplateTask" } },
  },
} as const;

const templateVariableSchema = {
  type: "object",
  required: ["name", "required"],
  properties: {
    name: { type: "string" },
    required: { type: "boolean" },
    default: { type: "string" },
    description: { type: "string" },
  },
} as const;

const createTemplateTaskInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title_pattern"],
  properties: {
    // position and depends_on_positions are emitted by template-export;
    // depends_on remains the concise authoring form accepted by the API.
    position: { type: "integer", minimum: 0 },
    title_pattern: { type: "string", minLength: 1 },
    description: { type: "string", nullable: true },
    priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
    tags: { type: "array", items: { type: "string", minLength: 1 } },
    task_type: { type: "string", nullable: true },
    condition: { type: "string", nullable: true },
    include_template_id: { type: "string", nullable: true },
    depends_on: { type: "array", items: { type: "integer", minimum: 0 } },
    depends_on_positions: { type: "array", items: { type: "integer", minimum: 0 } },
    metadata: { type: "object", additionalProperties: true },
  },
} as const;

export function buildV1OpenApiDocument(version = getPackageVersion()) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Todos V1 API",
      version,
      description:
        "Versioned cloud API for @hasna/todos (A1 pure-remote). Authenticate with an API key via the `x-api-key` header or `Authorization: Bearer <token>`.",
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
        Template: templateSchema,
        TemplateTask: templateTaskSchema,
        TemplateVariable: templateVariableSchema,
        CreateTemplateTaskInput: createTemplateTaskInputSchema,
        CreateTaskInput: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            description: { type: "string", nullable: true },
            status: { type: "string" },
            priority: { type: "string" },
            project_id: { type: "string" },
            assigned_to: { type: "string" },
            agent_id: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
        UpdateTaskInput: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
            priority: { type: "string" },
            assigned_to: { type: "string" },
            project_id: { type: "string", nullable: true },
            task_list_id: { type: "string", nullable: true },
            version: { type: "number" },
          },
        },
        CompleteTaskInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            agent_id: { type: "string", minLength: 1 },
            attachment_ids: { type: "array", items: { type: "string", minLength: 1 } },
            files_changed: { type: "array", items: { type: "string", minLength: 1 } },
            test_results: { type: "string" },
            commit_hash: { type: "string" },
            notes: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
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
            agent_id: { type: "string" },
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
            agent_id: { type: "string", minLength: 1 },
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
            agent_id: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["active", "completed", "archived"] },
          },
        },
        CreateTemplateInput: {
          type: "object",
          additionalProperties: false,
          required: ["name", "title_pattern"],
          properties: {
            name: { type: "string", minLength: 1 },
            title_pattern: { type: "string", minLength: 1 },
            description: { type: "string", nullable: true },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            tags: { type: "array", items: { type: "string", minLength: 1 } },
            variables: { type: "array", items: { $ref: "#/components/schemas/TemplateVariable" } },
            project_id: { type: "string", minLength: 1, nullable: true },
            plan_id: { type: "string", minLength: 1, nullable: true },
            metadata: { type: "object", additionalProperties: true },
            tasks: { type: "array", items: { $ref: "#/components/schemas/CreateTemplateTaskInput" } },
          },
        },
        UpdateTemplateInput: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1 },
            title_pattern: { type: "string", minLength: 1 },
            description: { type: "string", nullable: true },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            tags: { type: "array", items: { type: "string", minLength: 1 } },
            variables: { type: "array", items: { type: "object" } },
            project_id: { type: "string", nullable: true },
            plan_id: { type: "string", nullable: true },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        PrGroupCiProof: {
          type: "object",
          additionalProperties: false,
          required: [
            "provider", "provider_run_id", "status", "repository",
            "pr_number", "base_sha", "head_sha",
          ],
          properties: {
            provider: { type: "string", minLength: 1 },
            provider_run_id: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["success"] },
            repository: { type: "string", minLength: 3 },
            pr_number: { type: "integer", minimum: 1 },
            base_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
            head_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
          },
        },
        PrGroupCleanupProof: {
          type: "object",
          additionalProperties: false,
          required: [
            "worktree_clean", "provider_reachable", "provider_head_sha",
            "pr_policy_satisfied", "terminal_disposition", "writer_retired",
            "review_receipt_key", "conditional_merge_receipt_key", "merge_receipt_key",
          ],
          properties: {
            worktree_clean: { type: "boolean", const: true },
            provider_reachable: { type: "boolean", const: true },
            provider_head_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
            pr_policy_satisfied: { type: "boolean", const: true },
            terminal_disposition: { type: "string", enum: ["merged", "cancelled", "failed", "no_go"] },
            writer_retired: { type: "boolean", const: true },
            review_receipt_key: { type: "string", nullable: true },
            conditional_merge_receipt_key: { type: "string", nullable: true },
            merge_receipt_key: { type: "string", nullable: true },
          },
        },
        PrGroupRecord: {
          type: "object",
          additionalProperties: false,
          required: [
            "schema_version", "id", "identity_key", "root_request_id", "repository",
            "leaf_task_id", "branch", "pr_number", "base_sha", "state",
            "active_attempt_id", "active_generation", "repair_cycle_count", "repair_cycle_limit",
            "terminal_attempt_id", "terminal_generation", "terminal_outcome",
            "terminal_head_sha", "terminal_at", "cleanup_eligible_at", "revision",
            "created_at", "updated_at",
          ],
          properties: {
            schema_version: { type: "integer", const: 1 },
            id: { type: "string" },
            identity_key: { type: "string" },
            root_request_id: { type: "string" },
            repository: { type: "string" },
            leaf_task_id: { type: "string" },
            branch: { type: "string" },
            pr_number: { type: "integer", nullable: true },
            base_sha: { type: "string", nullable: true },
            state: {
              type: "string",
              enum: [
                "admitted", "started", "in_progress", "handed_off", "review_requested",
                "reviewed", "repair", "merge_ready", "merge_not_merged", "merged",
                "cancelled", "failed", "no_go", "cleanup_eligible",
              ],
            },
            active_attempt_id: { type: "string", nullable: true },
            active_generation: { type: "string", nullable: true },
            repair_cycle_count: { type: "integer", minimum: 0, maximum: 2 },
            repair_cycle_limit: { type: "integer", const: 2 },
            terminal_attempt_id: { type: "string", nullable: true },
            terminal_generation: { type: "string", nullable: true },
            terminal_outcome: {
              type: "string",
              nullable: true,
              enum: ["merged", "cancelled", "failed", "no_go", null],
            },
            terminal_head_sha: { type: "string", nullable: true },
            terminal_at: { type: "string", nullable: true },
            cleanup_eligible_at: { type: "string", nullable: true },
            revision: { type: "integer", minimum: 1 },
            created_at: { type: "string" },
            updated_at: { type: "string" },
          },
        },
        PrGroupAttemptRecord: {
          type: "object",
          additionalProperties: false,
          required: [
            "schema_version", "id", "group_id", "leaf_task_id", "dispatch_attempt",
            "writer_generation", "previous_attempt_id", "worktree", "branch", "repository",
            "pr_number", "base_sha", "provider", "provider_run_id", "profile_alias",
            "status", "admitted_at", "started_at", "last_heartbeat_at", "handed_off_at",
            "fenced_at", "terminal_at", "created_at", "updated_at",
          ],
          properties: {
            schema_version: { type: "integer", const: 1 },
            id: { type: "string" },
            group_id: { type: "string" },
            leaf_task_id: { type: "string" },
            dispatch_attempt: { type: "string" },
            writer_generation: { type: "string" },
            previous_attempt_id: { type: "string", nullable: true },
            worktree: { type: "string" },
            branch: { type: "string" },
            repository: { type: "string" },
            pr_number: { type: "integer", nullable: true },
            base_sha: { type: "string", nullable: true },
            provider: { type: "string", nullable: true },
            provider_run_id: { type: "string", nullable: true },
            profile_alias: { type: "string", nullable: true },
            status: {
              type: "string",
              enum: [
                "admitted", "started", "in_progress", "handed_off", "reviewing",
                "repair", "merge_ready", "fenced", "merged", "cancelled", "failed", "no_go",
              ],
            },
            admitted_at: { type: "string" },
            started_at: { type: "string", nullable: true },
            last_heartbeat_at: { type: "string", nullable: true },
            handed_off_at: { type: "string", nullable: true },
            fenced_at: { type: "string", nullable: true },
            terminal_at: { type: "string", nullable: true },
            created_at: { type: "string" },
            updated_at: { type: "string" },
          },
        },
        PrGroupEventRecord: {
          type: "object",
          additionalProperties: false,
          required: [
            "schema_version", "id", "group_id", "attempt_id", "writer_generation",
            "sequence", "idempotency_key", "event_type", "state", "message", "head_sha",
            "receipt_key", "review_receipt_key", "conditional_merge_receipt_key", "outcome",
            "repository", "pr_number", "base_sha", "actor_id", "actor_run_id",
            "expected_reviewer_id", "expected_reviewer_run_id", "repair_cycle",
            "ci_proof", "cleanup_proof", "metadata", "payload_hash", "created_at",
          ],
          properties: {
            schema_version: { type: "integer", const: 1 },
            id: { type: "string" },
            group_id: { type: "string" },
            attempt_id: { type: "string" },
            writer_generation: { type: "string" },
            sequence: { type: "integer", minimum: 1 },
            idempotency_key: { type: "string" },
            event_type: {
              type: "string",
              enum: [
                "admission", "started", "progress", "heartbeat", "handoff",
                "review_requested", "review_receipt", "repair_accepted", "repair_rejected",
                "conditional_merge_receipt", "merge_outcome", "recovery", "cancellation",
                "failure", "cleanup_eligible", "terminal_outcome",
              ],
            },
            state: {
              type: "string",
              enum: [
                "admitted", "started", "in_progress", "handed_off", "review_requested",
                "reviewed", "repair", "merge_ready", "merge_not_merged", "merged",
                "cancelled", "failed", "no_go", "cleanup_eligible",
              ],
            },
            message: { type: "string", nullable: true },
            head_sha: { type: "string", nullable: true },
            receipt_key: { type: "string", nullable: true },
            review_receipt_key: { type: "string", nullable: true },
            conditional_merge_receipt_key: { type: "string", nullable: true },
            outcome: {
              type: "string",
              nullable: true,
              enum: [
                "approved", "changes_requested", "dismissed", "accepted", "rejected",
                "merged", "not_merged", "cancelled", "failed", "no_go", null,
              ],
            },
            repository: { type: "string" },
            pr_number: { type: "integer", nullable: true },
            base_sha: { type: "string", nullable: true },
            actor_id: { type: "string", nullable: true },
            actor_run_id: { type: "string", nullable: true },
            expected_reviewer_id: { type: "string", nullable: true },
            expected_reviewer_run_id: { type: "string", nullable: true },
            repair_cycle: { type: "integer", nullable: true },
            ci_proof: {
              oneOf: [
                { $ref: "#/components/schemas/PrGroupCiProof" },
                { type: "null" },
              ],
            },
            cleanup_proof: {
              oneOf: [
                { $ref: "#/components/schemas/PrGroupCleanupProof" },
                { type: "null" },
              ],
            },
            metadata: { type: "object", additionalProperties: true },
            payload_hash: { type: "string" },
            created_at: { type: "string" },
          },
        },
        PrGroupWorkRunAdapter: {
          type: "object",
          additionalProperties: false,
          required: [
            "kind", "id", "group_id", "task_id", "dispatch_attempt", "writer_generation",
            "previous_run_id", "worktree", "branch", "repository", "pr_number", "base_sha",
            "provider", "provider_run_id", "profile_alias", "status", "admitted_at", "terminal_at",
          ],
          properties: {
            kind: { type: "string", const: "WorkRun" },
            id: { type: "string" },
            group_id: { type: "string" },
            task_id: { type: "string" },
            dispatch_attempt: { type: "string" },
            writer_generation: { type: "string" },
            previous_run_id: { type: "string", nullable: true },
            worktree: { type: "string" },
            branch: { type: "string" },
            repository: { type: "string" },
            pr_number: { type: "integer", nullable: true },
            base_sha: { type: "string", nullable: true },
            provider: { type: "string", nullable: true },
            provider_run_id: { type: "string", nullable: true },
            profile_alias: { type: "string", nullable: true },
            status: { type: "string" },
            admitted_at: { type: "string" },
            terminal_at: { type: "string", nullable: true },
          },
        },
        PrGroupEvidenceRefAdapter: {
          type: "object",
          additionalProperties: false,
          required: [
            "kind", "id", "group_id", "work_run_id", "sequence", "evidence_type",
            "repository", "pr_number", "base_sha", "head_sha", "receipt_key",
            "outcome", "actor_id", "actor_run_id", "payload_hash", "created_at",
          ],
          properties: {
            kind: { type: "string", const: "EvidenceRef" },
            id: { type: "string" },
            group_id: { type: "string" },
            work_run_id: { type: "string" },
            sequence: { type: "integer", minimum: 1 },
            evidence_type: { type: "string" },
            repository: { type: "string" },
            pr_number: { type: "integer", nullable: true },
            base_sha: { type: "string", nullable: true },
            head_sha: { type: "string", nullable: true },
            receipt_key: { type: "string", nullable: true },
            outcome: {
              type: "string",
              nullable: true,
              enum: [
                "approved", "changes_requested", "dismissed", "accepted", "rejected",
                "merged", "not_merged", "cancelled", "failed", "no_go", null,
              ],
            },
            actor_id: { type: "string", nullable: true },
            actor_run_id: { type: "string", nullable: true },
            payload_hash: { type: "string" },
            created_at: { type: "string" },
          },
        },
        PrGroupProofBundleAdapter: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "id", "group_id", "revision", "evidence_ref_ids", "exact_head", "complete"],
          properties: {
            kind: { type: "string", const: "ProofBundle" },
            id: { type: "string" },
            group_id: { type: "string" },
            revision: { type: "integer", minimum: 1 },
            evidence_ref_ids: { type: "array", items: { type: "string" } },
            exact_head: { type: "string", nullable: true },
            complete: { type: "boolean" },
          },
        },
        PrGroupDecisionEnvelopeAdapter: {
          type: "object",
          additionalProperties: false,
          required: [
            "kind", "id", "group_id", "state", "active_work_run_id",
            "active_writer_generation", "repair_cycle_count", "repair_cycle_limit",
            "terminal_outcome", "terminal_head_sha", "cleanup_eligible", "revision",
          ],
          properties: {
            kind: { type: "string", const: "DecisionEnvelope" },
            id: { type: "string" },
            group_id: { type: "string" },
            state: { type: "string" },
            active_work_run_id: { type: "string", nullable: true },
            active_writer_generation: { type: "string", nullable: true },
            repair_cycle_count: { type: "integer", minimum: 0, maximum: 2 },
            repair_cycle_limit: { type: "integer", const: 2 },
            terminal_outcome: {
              type: "string",
              nullable: true,
              enum: ["merged", "cancelled", "failed", "no_go", null],
            },
            terminal_head_sha: { type: "string", nullable: true },
            cleanup_eligible: { type: "boolean" },
            revision: { type: "integer", minimum: 1 },
          },
        },
        PrGroupStateView: {
          type: "object",
          additionalProperties: false,
          required: [
            "schema_version", "authoritative", "authority", "group", "attempts",
            "latest_event", "review_receipts", "conditional_merge_receipts",
            "merge_receipts", "cleanup_receipts", "cleanup_eligible", "adapters", "diagnostics",
          ],
          properties: {
            schema_version: { type: "integer", const: 1 },
            authoritative: { type: "boolean", const: true },
            authority: { type: "string", enum: ["local", "remote"] },
            group: { $ref: "#/components/schemas/PrGroupRecord" },
            attempts: { type: "array", maxItems: 100, items: { $ref: "#/components/schemas/PrGroupAttemptRecord" } },
            latest_event: {
              oneOf: [
                { $ref: "#/components/schemas/PrGroupEventRecord" },
                { type: "null" },
              ],
            },
            review_receipts: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/PrGroupEventRecord" } },
            conditional_merge_receipts: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/PrGroupEventRecord" } },
            merge_receipts: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/PrGroupEventRecord" } },
            cleanup_receipts: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/PrGroupEventRecord" } },
            cleanup_eligible: { type: "boolean" },
            adapters: {
              type: "object",
              additionalProperties: false,
              required: ["work_runs", "evidence_refs", "proof_bundle", "decision_envelope"],
              properties: {
                work_runs: { type: "array", maxItems: 100, items: { $ref: "#/components/schemas/PrGroupWorkRunAdapter" } },
                evidence_refs: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/PrGroupEvidenceRefAdapter" } },
                proof_bundle: { $ref: "#/components/schemas/PrGroupProofBundleAdapter" },
                decision_envelope: { $ref: "#/components/schemas/PrGroupDecisionEnvelopeAdapter" },
              },
            },
            diagnostics: {
              type: "object",
              additionalProperties: false,
              required: ["event_count", "attempts_omitted", "receipt_history_complete", "projection_limits"],
              properties: {
                event_count: { type: "integer", minimum: 0 },
                attempts_omitted: { type: "boolean" },
                receipt_history_complete: { type: "boolean" },
                projection_limits: {
                  type: "object",
                  additionalProperties: false,
                  required: ["attempts", "receipts"],
                  properties: {
                    attempts: { type: "integer", minimum: 1 },
                    receipts: { type: "integer", minimum: 1 },
                  },
                },
              },
            },
          },
        },
        PrGroupStateResponse: {
          type: "object",
          additionalProperties: false,
          required: ["view"],
          properties: { view: { $ref: "#/components/schemas/PrGroupStateView" } },
        },
        PrGroupEventPage: {
          type: "object",
          additionalProperties: false,
          required: [
            "schema_version", "authoritative", "authority", "group_id", "events",
            "count", "has_more", "next_sequence",
          ],
          properties: {
            schema_version: { type: "integer", const: 1 },
            authoritative: { type: "boolean", const: true },
            authority: { type: "string", enum: ["local", "remote"] },
            group_id: { type: "string" },
            events: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/PrGroupEventRecord" } },
            count: { type: "integer", minimum: 0, maximum: 500 },
            has_more: { type: "boolean" },
            next_sequence: { type: "integer", nullable: true },
          },
        },
        PrGroupEventHistoryResponse: {
          type: "object",
          additionalProperties: false,
          required: ["history"],
          properties: { history: { $ref: "#/components/schemas/PrGroupEventPage" } },
        },
        AdmitPrGroupInput: {
          type: "object",
          additionalProperties: false,
          required: [
            "root_request_id", "repository", "leaf_task_id", "dispatch_attempt",
            "writer_generation", "worktree", "branch",
          ],
          properties: {
            root_request_id: { type: "string", minLength: 1 },
            repository: { type: "string", minLength: 3 },
            leaf_task_id: { type: "string", minLength: 1 },
            dispatch_attempt: { type: "string", minLength: 1 },
            writer_generation: { type: "string", minLength: 1 },
            worktree: { type: "string", minLength: 1 },
            branch: { type: "string", minLength: 1 },
            pr_number: { type: "integer", nullable: true },
            base_sha: { type: "string", nullable: true },
            provider: { type: "string", nullable: true },
            provider_run_id: { type: "string", nullable: true },
            profile_alias: { type: "string", nullable: true },
            admitted_at: { type: "string" },
          },
        },
        RecoverPrGroupInput: {
          type: "object",
          additionalProperties: false,
          required: [
            "root_request_id", "repository", "leaf_task_id", "expected_attempt_id",
            "dispatch_attempt", "expected_generation", "writer_generation",
            "worktree", "branch", "pr_number", "base_sha", "provider",
            "provider_run_id", "profile_alias", "idempotency_key",
          ],
          properties: {
            root_request_id: { type: "string" },
            repository: { type: "string" },
            leaf_task_id: { type: "string" },
            expected_attempt_id: { type: "string" },
            dispatch_attempt: { type: "string" },
            expected_generation: { type: "string" },
            writer_generation: { type: "string" },
            worktree: { type: "string" },
            branch: { type: "string" },
            pr_number: { type: "integer", nullable: true },
            base_sha: { type: "string", nullable: true },
            provider: { type: "string", nullable: true },
            provider_run_id: { type: "string", nullable: true },
            profile_alias: { type: "string", nullable: true },
            idempotency_key: { type: "string" },
            message: { type: "string", nullable: true },
            metadata: { type: "object", additionalProperties: true },
            recovered_at: { type: "string" },
          },
        },
        AppendPrGroupEventInput: {
          type: "object",
          additionalProperties: false,
          required: ["attempt_id", "writer_generation", "idempotency_key", "event_type"],
          properties: {
            attempt_id: { type: "string" },
            writer_generation: { type: "string" },
            idempotency_key: { type: "string" },
            event_type: {
              type: "string",
              enum: [
                "started", "progress", "heartbeat", "handoff", "review_requested",
                "review_receipt", "repair_accepted", "repair_rejected",
                "conditional_merge_receipt", "merge_outcome", "cancellation",
                "failure", "cleanup_eligible", "terminal_outcome",
              ],
            },
            message: { type: "string", nullable: true },
            head_sha: { type: "string", nullable: true },
            receipt_key: { type: "string", nullable: true },
            review_receipt_key: { type: "string", nullable: true },
            conditional_merge_receipt_key: { type: "string", nullable: true },
            outcome: {
              type: "string",
              nullable: true,
              enum: [
                "approved", "changes_requested", "dismissed", "accepted", "rejected",
                "merged", "not_merged", "cancelled", "failed", "no_go", null,
              ],
            },
            repository: { type: "string" },
            pr_number: { type: "integer", nullable: true },
            base_sha: { type: "string", nullable: true },
            actor_id: { type: "string", nullable: true },
            actor_run_id: { type: "string", nullable: true },
            expected_reviewer_id: { type: "string", nullable: true },
            expected_reviewer_run_id: { type: "string", nullable: true },
            repair_cycle: { type: "integer", nullable: true },
            ci_proof: {
              oneOf: [
                { $ref: "#/components/schemas/PrGroupCiProof" },
                { type: "null" },
              ],
            },
            cleanup_proof: {
              oneOf: [
                { $ref: "#/components/schemas/PrGroupCleanupProof" },
                { type: "null" },
              ],
            },
            metadata: { type: "object", additionalProperties: true },
            created_at: { type: "string" },
          },
        },
        PrGroupMutationResult: {
          type: "object",
          additionalProperties: false,
          required: ["created", "adopted", "appended", "view", "event"],
          properties: {
            created: { type: "boolean" },
            adopted: { type: "boolean" },
            appended: { type: "boolean" },
            view: { $ref: "#/components/schemas/PrGroupStateView" },
            event: { $ref: "#/components/schemas/PrGroupEventRecord" },
          },
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
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
      "/v1/templates": {
        get: {
          operationId: "listTemplates",
          summary: "List reusable task templates",
          parameters: [{ name: "project_id", in: "query", schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { templates: { type: "array", items: { $ref: "#/components/schemas/Template" } }, count: { type: "number" } } } } } } },
        },
        post: {
          operationId: "createTemplate",
          summary: "Create a reusable task template",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTemplateInput" } } } },
          responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { template: { $ref: "#/components/schemas/Template" } } } } } } },
        },
      },
      "/v1/templates/{id}": {
        get: {
          operationId: "getTemplate",
          summary: "Get one reusable task template with its checklist steps",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { template: { $ref: "#/components/schemas/Template" } } } } } } },
        },
        patch: {
          operationId: "updateTemplate",
          summary: "Update reusable template metadata and defaults",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTemplateInput" } } } },
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { template: { $ref: "#/components/schemas/Template" } } } } } } },
        },
        delete: {
          operationId: "deleteTemplate",
          summary: "Delete a reusable task template and its checklist steps",
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
      "/v1/pr-groups/admit": {
        post: {
          operationId: "admitPrGroup",
          summary: "Create or idempotently adopt a deterministic PR group attempt",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AdmitPrGroupInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/PrGroupMutationResult" } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/pr-groups/{id}": {
        get: {
          operationId: "getPrGroupState",
          summary: "Get the authoritative current state of a PR group",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/PrGroupStateResponse" } } } },
            "404": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/pr-groups/{id}/events": {
        get: {
          operationId: "getPrGroupEvents",
          summary: "Get a bounded page of authoritative PR group events",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "after_sequence", in: "query", schema: { type: "integer", minimum: 0 } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/PrGroupEventHistoryResponse" } } } },
            "404": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        post: {
          operationId: "appendPrGroupEvent",
          summary: "Append a fenced lifecycle event or receipt",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AppendPrGroupEventInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/PrGroupMutationResult" } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/pr-groups/{id}/recover": {
        post: {
          operationId: "recoverPrGroup",
          summary: "Fence the prior attempt and create or adopt a recovery generation",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/RecoverPrGroupInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/PrGroupMutationResult" } } } },
            "409": { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
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
            "Upserts every record carried in the body by primary key. All record arrays are optional and default to []; a caller may backfill a single object type (e.g. just tasks) or a complete snapshot. Re-posting the same rows never duplicates. Requires the todos:write scope.",
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
                    templateTasks: { type: "array", items: { $ref: "#/components/schemas/TemplateTask" } },
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
}
