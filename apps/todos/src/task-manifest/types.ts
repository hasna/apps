import type { Database } from "bun:sqlite";
import type { TodosPostgresQueryClient } from "../storage/postgres-sync.js";
import type { TaskPriority, TaskStatus } from "../types/index.js";

export const TODOS_TASK_MANIFEST_ROUTE = "todos.task-manifest.v1" as const;
export const TODOS_TASK_MANIFEST_SCHEMA_VERSION = 1 as const;

export type TodosTaskManifestStatus = TaskStatus;
export type TodosTaskManifestPriority = TaskPriority;
export type TodosTaskManifestVerificationStatus = "passed" | "failed" | "unknown";

export interface TodosTaskManifestComment {
  content: string;
  type?: "comment" | "progress" | "status_change" | "system";
  progress_pct?: number;
  agent_id?: string;
  session_id?: string;
}

export interface TodosTaskManifestVerification {
  command: string;
  status?: TodosTaskManifestVerificationStatus;
  output_summary?: string;
  artifact_path?: string;
  agent_id?: string;
}

export interface TodosTaskManifestTask {
  key: string;
  title: string;
  description?: string;
  status?: TodosTaskManifestStatus;
  priority?: TodosTaskManifestPriority;
  assigned_to?: string;
  created_by?: string;
  tags?: string[];
  metadata?: Record<string, string | number | boolean | null>;
  comments?: TodosTaskManifestComment[];
  verifications?: TodosTaskManifestVerification[];
}

export interface TodosTaskManifestDependency {
  task: string;
  depends_on: string;
}

export interface TodosTaskManifestEffect {
  topic: string;
  payload: Record<string, string | number | boolean | null>;
}

export interface TodosTaskManifest {
  version: 1;
  operation_id: string;
  idempotency_key: string;
  project_id: string;
  task_list_id?: string;
  if_binding_version?: number;
  plan: {
    key: string;
    name: string;
    description?: string;
    status?: "active" | "completed" | "archived";
  };
  tasks: TodosTaskManifestTask[];
  dependencies?: TodosTaskManifestDependency[];
  effects?: TodosTaskManifestEffect[];
}

export interface TodosTaskManifestReadback {
  plans: number;
  tasks: number;
  dependencies: number;
  comments: number;
  verifications: number;
  complete: true;
}

export interface TodosTaskManifestGraph {
  plan_id: string;
  task_ids: Record<string, string>;
  comment_ids: string[];
  verification_ids: string[];
  dependency_ids: string[];
}

export interface TodosTaskManifestReceipt {
  receipt_id: string;
  authority: "todos";
  route: typeof TODOS_TASK_MANIFEST_ROUTE;
  schema_version: 1;
  kind: "apply" | "compensate";
  operation_id: string;
  idempotency_key: string;
  request_digest: string;
  result_digest: string;
  binding_version: number;
  apply_receipt_id: string | null;
  created_at: string;
}

export interface TodosTaskManifestApplyResult {
  duplicate: boolean;
  receipt: TodosTaskManifestReceipt;
  graph: TodosTaskManifestGraph;
  readback: TodosTaskManifestReadback;
  outbox_ids: string[];
  result_digest: string;
}

export interface TodosTaskManifestCompensateRequest {
  receipt_id: string;
  idempotency_key: string;
  if_binding_version: number;
}

export interface TodosTaskManifestCompensationResult {
  duplicate: boolean;
  receipt: TodosTaskManifestReceipt;
  absent: true;
  readback: TodosTaskManifestReadback;
}

export interface TodosTaskManifestCapability {
  authority: "todos";
  route: typeof TODOS_TASK_MANIFEST_ROUTE;
  schema_version: 1;
  backend: "sqlite" | "postgresql" | "http";
  deterministic_ids: true;
  immutable_receipts: true;
  transactional_outbox: true;
  exact_bounded_readback: true;
  conditional_compensation: true;
  transcript_safe: false;
  bounds: {
    tasks: number;
    dependencies: number;
    comments: number;
    verifications: number;
    effects: number;
    metadata_fields: number;
    effect_payload_fields: number;
    request_bytes: number;
    response_bytes: number;
  };
}

export type TodosTaskManifestFaultPoint =
  | "after_plan_write"
  | "after_task_write"
  | "after_dependency_write"
  | "after_comment_write"
  | "after_verification_write"
  | "after_outbox_write"
  | "after_receipt_write";

export interface TodosTaskManifestAuthority {
  capability(): Promise<TodosTaskManifestCapability>;
  apply(input: unknown): Promise<TodosTaskManifestApplyResult>;
  readExact(receiptId: string): Promise<TodosTaskManifestApplyResult>;
  markOutboxDelivered(outboxId: string): Promise<void>;
  compensate(input: TodosTaskManifestCompensateRequest): Promise<TodosTaskManifestCompensationResult>;
}

export interface TodosTaskManifestAuthorityOptions {
  now?: () => string;
  faultInjector?: (point: TodosTaskManifestFaultPoint) => boolean | void | Promise<boolean | void>;
}

export interface SqliteTodosTaskManifestAuthorityOptions extends TodosTaskManifestAuthorityOptions {
  database: Database;
}

export interface TodosTaskManifestPostgresClient extends TodosPostgresQueryClient {
  transaction<T>(fn: (client: TodosPostgresQueryClient) => Promise<T>): Promise<T>;
}

export interface PostgresTodosTaskManifestAuthorityOptions extends TodosTaskManifestAuthorityOptions {
  service?: string;
  tableName?: string;
}

export type TodosTaskManifestErrorCode =
  | "TODOS_TASK_MANIFEST_INVALID_INPUT"
  | "TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED"
  | "TODOS_TASK_MANIFEST_FOREIGN_REFERENCE"
  | "TODOS_TASK_MANIFEST_IDEMPOTENCY_CONFLICT"
  | "TODOS_TASK_MANIFEST_CAS_CONFLICT"
  | "TODOS_TASK_MANIFEST_GRAPH_CONFLICT"
  | "TODOS_TASK_MANIFEST_RECEIPT_NOT_FOUND"
  | "TODOS_TASK_MANIFEST_READBACK_MISMATCH"
  | "TODOS_TASK_MANIFEST_COMPENSATION_REFUSED"
  | "TODOS_TASK_MANIFEST_ATOMICITY_UNAVAILABLE"
  | "TODOS_TASK_MANIFEST_HTTP_ERROR";

export class TodosTaskManifestError extends Error {
  constructor(
    readonly code: TodosTaskManifestErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TodosTaskManifestError";
  }
}

export interface TodosTaskManifestHttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}
