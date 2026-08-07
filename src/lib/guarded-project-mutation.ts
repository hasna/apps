import { createHash } from "node:crypto";
import type {
  GuardedProjectMutationBounds,
  GuardedProjectMutationControl,
  GuardedProjectMutationDirection,
  GuardedProjectMutationReceipt,
  GuardedProjectMutationReceiptRow,
  JsonObject,
  UpdateWorkspaceInput,
  Workspace,
} from "../types/workspace.js";

export const GUARDED_PROJECT_MUTATION_ROUTE = "projects.guarded-metadata-mutation.v1";
export const GUARDED_PROJECT_MUTATION_EVENT = "guarded_metadata_mutation";
export const GUARDED_PROJECT_MUTATION_ROLLBACK_EVENT = "guarded_metadata_mutation_rollback";

export function assertCompleteStableProjectId(value: string): void {
  if (!/^wks_[A-Za-z0-9][A-Za-z0-9_-]{11,}$/.test(value)) {
    throw new Error("guarded project mutation requires a complete stable project id beginning with wks_; slugs, paths, names, and partial ids are refused");
  }
}

export function assertPositiveBounds(bounds: GuardedProjectMutationBounds): void {
  if (!Number.isInteger(bounds.response_byte_limit) || bounds.response_byte_limit <= 0) {
    throw new Error("response_byte_limit must be a positive integer");
  }
  if (!Number.isInteger(bounds.time_budget_ms) || bounds.time_budget_ms <= 0) {
    throw new Error("time_budget_ms must be a positive integer");
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = (value as Record<string, unknown>)[key];
    if (next !== undefined) out[key] = canonicalize(next);
  }
  return out;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function requestDigest(patch: UpdateWorkspaceInput): string {
  return sha256(canonicalJson(normalizePatch(patch)));
}

export function preconditionDigest(input: { project_id: string; expected_revision: string }): string {
  return sha256(canonicalJson({ project_id: input.project_id, revision: input.expected_revision }));
}

export function deriveGuardedIdempotencyKey(input: {
  operation_id: string;
  step_id: string;
  direction: GuardedProjectMutationDirection;
  target_id: string;
  request_digest: string;
  precondition_digest: string;
}): string {
  return `gpm_${sha256(canonicalJson({
    route: GUARDED_PROJECT_MUTATION_ROUTE,
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: input.direction,
    target_id: input.target_id,
    request_digest: input.request_digest,
    precondition_digest: input.precondition_digest,
  })).slice(0, 48)}`;
}

export function normalizePatch(patch: UpdateWorkspaceInput): UpdateWorkspaceInput {
  const allowed: UpdateWorkspaceInput = {};
  const keys: Array<keyof UpdateWorkspaceInput> = [
    "name",
    "slug",
    "description",
    "kind",
    "status",
    "root_id",
    "recipe_id",
    "canonical_machine",
    "primary_path",
    "git_remote",
    "s3_bucket",
    "s3_prefix",
    "tags",
    "integrations",
    "metadata",
    "agent_id",
    "source",
    "prompt",
    "command",
  ];
  for (const key of keys) {
    if (patch[key] !== undefined) {
      (allowed as Record<string, unknown>)[key] = patch[key];
    }
  }
  return canonicalize(allowed) as UpdateWorkspaceInput;
}

export function workspaceRevision(workspace: Workspace): string {
  if (!workspace.updated_at) throw new Error(`project ${workspace.id} has no authority revision`);
  return workspace.updated_at;
}

export function workspaceSnapshot(workspace: Workspace): JsonObject {
  return canonicalize(workspace) as JsonObject;
}

export function rowToGuardedReceipt(row: GuardedProjectMutationReceiptRow): GuardedProjectMutationReceipt {
  return {
    receipt_id: row.receipt_id,
    operation_id: row.operation_id,
    step_id: row.step_id,
    direction: row.direction as GuardedProjectMutationReceipt["direction"],
    idempotency_key: row.idempotency_key,
    target_id: row.target_id,
    request_digest: row.request_digest,
    precondition_digest: row.precondition_digest,
    expected_revision: row.expected_revision,
    outcome: row.outcome as GuardedProjectMutationReceipt["outcome"],
    reason: row.reason,
    result_project_id: row.result_project_id,
    duplicate_of_receipt_id: row.duplicate_of_receipt_id,
    before: parseJson(row.before_json),
    after: parseJson(row.after_json),
    post_revision: row.post_revision,
    created_at: row.created_at,
  };
}

function parseJson(raw: string | null): JsonObject | null {
  if (!raw) return null;
  return JSON.parse(raw) as JsonObject;
}

export function timedOut(startedAtMs: number, timeBudgetMs: number): boolean {
  return Date.now() - startedAtMs > timeBudgetMs;
}

export function responseControl(
  payload: unknown,
  bounds: GuardedProjectMutationBounds,
  startedAtMs: number,
): GuardedProjectMutationControl {
  assertPositiveBounds(bounds);
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  const elapsed = Math.max(Date.now() - startedAtMs, 0);
  if (bytes > bounds.response_byte_limit) {
    throw new Error(`guarded mutation response byte budget exceeded: ${bytes} > ${bounds.response_byte_limit}`);
  }
  if (elapsed > bounds.time_budget_ms) {
    throw new Error(`guarded mutation time budget exceeded: ${elapsed} > ${bounds.time_budget_ms}`);
  }
  return {
    response_byte_limit: bounds.response_byte_limit,
    time_budget_ms: bounds.time_budget_ms,
    response_bytes: bytes,
    elapsed_ms: elapsed,
    complete: true,
    truncated: false,
  };
}

export function buildReceiptId(input: {
  operation_id: string;
  step_id: string;
  direction: GuardedProjectMutationDirection;
  idempotency_key: string;
  outcome: string;
  target_id: string;
  suffix?: string;
}): string {
  return `gpmr_${sha256(canonicalJson(input)).slice(0, 32)}`;
}
