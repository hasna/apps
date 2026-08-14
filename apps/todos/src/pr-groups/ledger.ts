import { createHash } from "node:crypto";
import {
  PR_GROUP_LEDGER_SCHEMA_VERSION,
  PR_GROUP_REPAIR_CYCLE_LIMIT,
  PrGroupLedgerError,
  type AdmitPrGroupInput,
  type AppendPrGroupEventInput,
  type PrGroupAttemptRecord,
  type PrGroupAttemptStatus,
  type PrGroupCiProof,
  type PrGroupCleanupProof,
  type PrGroupEventListOptions,
  type PrGroupEventOutcome,
  type PrGroupEventPage,
  type PrGroupEventRecord,
  type PrGroupEventType,
  type PrGroupLedgerPersistence,
  type PrGroupLedgerTransaction,
  type PrGroupMutationResult,
  type PrGroupRecord,
  type PrGroupState,
  type PrGroupStateView,
  type PrGroupTerminalOutcome,
  type RecoverPrGroupInput,
} from "./types.js";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SAFE_PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FORBIDDEN_METADATA_KEY = /(?:^|[_-])(email|account(?:_?id)?|auth(?:entication|orization)?|token|secret|password|credential|cookie)(?:$|[_-])/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const CREDENTIAL_PATTERN = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,}/i;
const AUTH_PATH_PATTERN = /(?:^|[/\\])(?:\.ssh|\.aws|credentials|auth(?:\.json)?)(?=[/\\\s]|$)/i;
const STATE_VIEW_ATTEMPT_LIMIT = 100;
const STATE_VIEW_EVENT_LIMIT = 500;
export const PR_GROUP_WRITER_STALE_AFTER_MS = 30_000;
const APPENDABLE_EVENT_TYPES = new Set<AppendPrGroupEventInput["event_type"]>([
  "started",
  "progress",
  "heartbeat",
  "handoff",
  "review_requested",
  "review_receipt",
  "repair_accepted",
  "repair_rejected",
  "conditional_merge_receipt",
  "merge_outcome",
  "cancellation",
  "failure",
  "cleanup_eligible",
  "terminal_outcome",
]);
const EVENT_OUTCOMES = new Set<PrGroupEventOutcome>([
  "approved",
  "changes_requested",
  "dismissed",
  "accepted",
  "rejected",
  "merged",
  "not_merged",
  "cancelled",
  "failed",
  "no_go",
]);

const RECEIPT_EVENT_TYPES = new Set<PrGroupEventType>([
  "review_requested",
  "review_receipt",
  "conditional_merge_receipt",
  "merge_outcome",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function requiredReference(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${field} must be a bounded non-empty string`);
  }
  return value.trim();
}

function safeReference(value: unknown, field: string): string {
  const ref = requiredReference(value, field, 256);
  if (!SAFE_REFERENCE_PATTERN.test(ref) || EMAIL_PATTERN.test(ref) ||
      CREDENTIAL_PATTERN.test(ref) || AUTH_PATH_PATTERN.test(ref)) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${field} must be an opaque non-credential reference`);
  }
  return ref;
}

function safeWorktree(value: unknown): string {
  const worktree = requiredReference(value, "worktree", 1_024);
  if (!worktree.startsWith("/") || EMAIL_PATTERN.test(worktree) ||
      CREDENTIAL_PATTERN.test(worktree) || AUTH_PATH_PATTERN.test(worktree)) {
    throw new PrGroupLedgerError(
      "PR_GROUP_INVALID_INPUT",
      "worktree must be an absolute non-credential path",
    );
  }
  return worktree;
}

function safeOptionalReference(value: unknown, field: string): string | null {
  return value === undefined || value === null || value === "" ? null : safeReference(value, field);
}

function safeProfileAlias(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const alias = requiredReference(value, "profile_alias", 64);
  if (!SAFE_PROFILE_PATTERN.test(alias) || EMAIL_PATTERN.test(alias)) {
    throw new PrGroupLedgerError(
      "PR_GROUP_INVALID_INPUT",
      "profile_alias must be an opaque alias and must not contain provider identity",
    );
  }
  return alias;
}

function safeMessage(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const message = requiredReference(value, field, 2_048);
  if (EMAIL_PATTERN.test(message) || CREDENTIAL_PATTERN.test(message) || AUTH_PATH_PATTERN.test(message)) {
    return "[REDACTED]";
  }
  return message;
}

function isoTimestamp(value: string | undefined, field: string): string {
  const timestamp = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${field} must be an ISO timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeRepository(value: string): string {
  const repository = requiredReference(value, "repository", 256)
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/^git@[^:]+:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(repository)) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "repository must be a canonical owner/name reference");
  }
  return repository;
}

function normalizeHead(value: string | null | undefined, required: boolean): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new PrGroupLedgerError("PR_GROUP_EXACT_HEAD_REQUIRED", "this event requires an exact 40-character head SHA");
    }
    return null;
  }
  const head = value.toLowerCase();
  if (!SHA_PATTERN.test(head)) {
    throw new PrGroupLedgerError("PR_GROUP_EXACT_HEAD_REQUIRED", "head_sha must be an exact 40-character lowercase SHA");
  }
  return head;
}

function normalizeBaseSha(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !SHA_PATTERN.test(value.toLowerCase())) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "base_sha must be an exact 40-character SHA or null");
  }
  return value.toLowerCase();
}

function normalizePrNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "pr_number must be a positive integer or null");
  }
  return Number(value);
}

function sanitizeMetadataValue(value: unknown, key = ""): unknown {
  if (FORBIDDEN_METADATA_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (EMAIL_PATTERN.test(value) || CREDENTIAL_PATTERN.test(value) || AUTH_PATH_PATTERN.test(value)) return "[REDACTED]";
    return value.length > 2_048 ? `${value.slice(0, 2_045)}...` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeMetadataValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([childKey, child]) => [childKey, sanitizeMetadataValue(child, childKey)]),
    );
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export function sanitizePrGroupMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return (sanitizeMetadataValue(metadata ?? {}) as Record<string, unknown>) ?? {};
}

export function deterministicPrGroupId(
  rootRequestId: string,
  repository: string,
  leafTaskId: string,
  branch: string,
  prNumber: number | null = null,
): string {
  const root = requiredReference(rootRequestId, "root_request_id", 256);
  const repo = normalizeRepository(repository);
  const leaf = safeReference(leafTaskId, "leaf_task_id");
  const normalizedBranch = safeReference(branch, "branch");
  const pr = normalizePrNumber(prNumber);
  return `prg_${sha256(`pr-group:v1\0${root}\0${repo}\0${leaf}\0${normalizedBranch}\0${pr ?? "none"}`).slice(0, 32)}`;
}

export function deterministicLegacyPrGroupIdentity(rootRequestId: string, repository: string): {
  id: string;
  identity_key: string;
} {
  const identityKey = sha256(`pr-group:v1\0${rootRequestId}\0${repository}`);
  return {
    id: `prg_${identityKey.slice(0, 32)}`,
    identity_key: identityKey,
  };
}

export function deterministicPrGroupAttemptId(
  groupId: string,
  leafTaskId: string,
  dispatchAttempt: string,
): string {
  const group = requiredReference(groupId, "group_id", 96);
  const leaf = requiredReference(leafTaskId, "leaf_task_id", 256);
  const dispatch = safeReference(dispatchAttempt, "dispatch_attempt");
  return `pra_${sha256(`pr-attempt:v1\0${group}\0${leaf}\0${dispatch}`).slice(0, 32)}`;
}

export function deterministicPrGroupEventId(groupId: string, key: string): string {
  return `pre_${sha256(`pr-event:v1\0${groupId}\0${key}`).slice(0, 32)}`;
}

function stateForEvent(type: PrGroupEventType, outcome: PrGroupEventOutcome | null): PrGroupState {
  switch (type) {
    case "admission": return "admitted";
    case "started": return "started";
    case "progress":
    case "heartbeat": return "in_progress";
    case "handoff": return "handed_off";
    case "review_requested": return "review_requested";
    case "review_receipt": return "reviewed";
    case "repair_accepted": return "repair";
    case "repair_rejected": return "no_go";
    case "conditional_merge_receipt": return "merge_ready";
    case "merge_outcome": return outcome === "merged" ? "merged" : "merge_not_merged";
    case "recovery": return "admitted";
    case "cancellation": return "cancelled";
    case "failure": return "failed";
    case "cleanup_eligible": return "cleanup_eligible";
    case "terminal_outcome":
      if (outcome === "merged" || outcome === "cancelled" || outcome === "failed" || outcome === "no_go") return outcome;
      throw new PrGroupLedgerError("PR_GROUP_INVALID_TRANSITION", "terminal_outcome requires merged, cancelled, failed, or no_go");
  }
}

function terminalOutcomeFor(
  type: PrGroupEventType,
  outcome: PrGroupEventOutcome | null,
): PrGroupTerminalOutcome | null {
  if (type === "cancellation") return "cancelled";
  if (type === "failure") return "failed";
  if (type === "repair_rejected") return "no_go";
  if (type === "merge_outcome" && outcome === "merged") return "merged";
  if (type === "terminal_outcome" &&
      (outcome === "merged" || outcome === "cancelled" || outcome === "failed" || outcome === "no_go")) {
    return outcome;
  }
  return null;
}

function attemptStatusFor(
  type: PrGroupEventType,
  outcome: PrGroupEventOutcome | null,
  current: PrGroupAttemptStatus,
): PrGroupAttemptStatus {
  switch (type) {
    case "started": return "started";
    case "progress":
    case "heartbeat": return "in_progress";
    case "handoff": return "handed_off";
    case "review_requested":
    case "review_receipt": return "reviewing";
    case "repair_accepted": return "repair";
    case "repair_rejected": return "no_go";
    case "conditional_merge_receipt": return "merge_ready";
    case "merge_outcome": return outcome === "merged" ? "merged" : "handed_off";
    case "cancellation": return "cancelled";
    case "failure": return "failed";
    case "terminal_outcome":
      if (outcome === "merged" || outcome === "cancelled" || outcome === "failed" || outcome === "no_go") return outcome;
      return current;
    default: return current;
  }
}

function payloadForHash(input: Record<string, unknown>): string {
  return sha256(stableJson(input));
}

async function existingEventOrThrow(
  tx: PrGroupLedgerTransaction,
  groupId: string,
  key: string,
  payloadHash: string,
): Promise<PrGroupEventRecord | null> {
  const existing = await tx.getEventByIdempotency(groupId, key);
  if (!existing) return null;
  if (existing.payload_hash !== payloadHash) {
    throw new PrGroupLedgerError(
      "PR_GROUP_RECEIPT_REPLAY",
      "idempotency key was already used with a different payload",
      { group_id: groupId, idempotency_key: key, existing_event_id: existing.id },
    );
  }
  return existing;
}

function assertAttemptIdentity(
  attempt: PrGroupAttemptRecord,
  input: {
    leaf_task_id: string;
    dispatch_attempt: string;
    writer_generation: string;
    worktree: string;
    branch: string;
    repository: string;
    pr_number: number | null;
    base_sha: string | null;
    provider: string | null;
    provider_run_id: string | null;
    profile_alias: string | null;
  },
): void {
  const immutable = {
    leaf_task_id: input.leaf_task_id,
    dispatch_attempt: input.dispatch_attempt,
    writer_generation: input.writer_generation,
    worktree: input.worktree,
    branch: input.branch,
    repository: input.repository,
    pr_number: input.pr_number,
    base_sha: input.base_sha,
    provider: input.provider,
    provider_run_id: input.provider_run_id,
    profile_alias: input.profile_alias,
  };
  for (const [key, value] of Object.entries(immutable)) {
    if (attempt[key as keyof PrGroupAttemptRecord] !== value) {
      throw new PrGroupLedgerError(
        "PR_GROUP_IDENTITY_CONFLICT",
        `deterministic attempt identity conflicts on ${key}`,
        { attempt_id: attempt.id, field: key },
      );
    }
  }
}

function assertGroupLineage(
  group: PrGroupRecord,
  input: {
    root_request_id?: string;
    repository: string;
    leaf_task_id?: string;
    branch?: string;
    pr_number: number | null;
    base_sha: string | null;
  },
): void {
  const immutable: Record<string, unknown> = {
    repository: input.repository,
    pr_number: input.pr_number,
    base_sha: input.base_sha,
  };
  if (input.root_request_id !== undefined) immutable.root_request_id = input.root_request_id;
  if (input.leaf_task_id !== undefined) immutable.leaf_task_id = input.leaf_task_id;
  if (input.branch !== undefined) immutable.branch = input.branch;
  for (const [field, value] of Object.entries(immutable)) {
    if (group[field as keyof PrGroupRecord] !== value) {
      throw new PrGroupLedgerError(
        "PR_GROUP_IDENTITY_CONFLICT",
        `immutable PR-group lineage conflicts on ${field}`,
        { group_id: group.id, field },
      );
    }
  }
}

function normalizeCleanupProof(value: unknown): PrGroupCleanupProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrGroupLedgerError("PR_GROUP_CLEANUP_BLOCKED", "cleanup requires an explicit durable safety proof");
  }
  const proof = value as Record<string, unknown>;
  const allowed = new Set([
    "worktree_clean",
    "provider_reachable",
    "provider_head_sha",
    "pr_policy_satisfied",
    "terminal_disposition",
    "writer_retired",
    "review_receipt_key",
    "conditional_merge_receipt_key",
    "merge_receipt_key",
  ]);
  if (Object.keys(proof).some((key) => !allowed.has(key)) ||
      proof.worktree_clean !== true ||
      proof.provider_reachable !== true ||
      proof.pr_policy_satisfied !== true ||
      proof.writer_retired !== true) {
    throw new PrGroupLedgerError("PR_GROUP_CLEANUP_BLOCKED", "cleanup safety proof is incomplete or contradictory");
  }
  const terminalDisposition = proof.terminal_disposition;
  if (!["merged", "cancelled", "failed", "no_go"].includes(String(terminalDisposition))) {
    throw new PrGroupLedgerError("PR_GROUP_CLEANUP_BLOCKED", "cleanup proof requires a legal terminal disposition");
  }
  if (typeof proof.provider_head_sha !== "string" ||
      !SHA_PATTERN.test(proof.provider_head_sha.toLowerCase())) {
    throw new PrGroupLedgerError(
      "PR_GROUP_CLEANUP_BLOCKED",
      "cleanup proof requires a provider-reachable exact head SHA",
    );
  }
  const providerHeadSha = proof.provider_head_sha.toLowerCase();
  const optionalReceipt = (field: string): string | null => {
    const entry = proof[field];
    return entry === null ? null : safeOptionalReference(entry, field);
  };
  return {
    worktree_clean: true,
    provider_reachable: true,
    provider_head_sha: providerHeadSha,
    pr_policy_satisfied: true,
    terminal_disposition: terminalDisposition as PrGroupTerminalOutcome,
    writer_retired: true,
    review_receipt_key: optionalReceipt("review_receipt_key"),
    conditional_merge_receipt_key: optionalReceipt("conditional_merge_receipt_key"),
    merge_receipt_key: optionalReceipt("merge_receipt_key"),
  };
}

function normalizeCiProof(value: unknown): PrGroupCiProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrGroupLedgerError(
      "PR_GROUP_EXACT_HEAD_REQUIRED",
      "conditional merge requires a typed provider CI success proof",
    );
  }
  const proof = value as Record<string, unknown>;
  const allowed = new Set([
    "provider",
    "provider_run_id",
    "status",
    "repository",
    "pr_number",
    "base_sha",
    "head_sha",
  ]);
  if (Object.keys(proof).some((key) => !allowed.has(key)) || proof.status !== "success") {
    throw new PrGroupLedgerError(
      "PR_GROUP_EXACT_HEAD_REQUIRED",
      "provider CI proof must be a closed successful exact-head envelope",
    );
  }
  const prNumber = normalizePrNumber(proof.pr_number);
  const baseSha = normalizeBaseSha(proof.base_sha);
  if (prNumber === null || baseSha === null) {
    throw new PrGroupLedgerError(
      "PR_GROUP_EXACT_HEAD_REQUIRED",
      "provider CI proof requires concrete PR and base identity",
    );
  }
  return {
    provider: safeReference(proof.provider, "ci_proof.provider"),
    provider_run_id: safeReference(proof.provider_run_id, "ci_proof.provider_run_id"),
    status: "success",
    repository: normalizeRepository(requiredReference(proof.repository, "ci_proof.repository")),
    pr_number: prNumber,
    base_sha: baseSha,
    head_sha: normalizeHead(requiredReference(proof.head_sha, "ci_proof.head_sha"), true)!,
  };
}

function assertLegalTransition(group: PrGroupRecord, eventType: PrGroupEventType): void {
  if (group.terminal_outcome) {
    if (eventType !== "cleanup_eligible") {
      throw new PrGroupLedgerError(
        "PR_GROUP_TERMINAL",
        "terminal facts are immutable and only one cleanup receipt may follow",
        { group_id: group.id, terminal_outcome: group.terminal_outcome },
      );
    }
    return;
  }
  const allowed: Partial<Record<PrGroupState, ReadonlySet<PrGroupEventType>>> = {
    admitted: new Set(["started", "progress", "heartbeat", "handoff", "cancellation", "failure", "terminal_outcome"]),
    started: new Set(["progress", "heartbeat", "handoff", "cancellation", "failure", "terminal_outcome"]),
    in_progress: new Set(["progress", "heartbeat", "handoff", "cancellation", "failure", "terminal_outcome"]),
    handed_off: new Set(["review_requested", "cancellation", "failure", "terminal_outcome"]),
    review_requested: new Set(["review_receipt", "cancellation", "failure", "terminal_outcome"]),
    reviewed: new Set([
      "review_receipt",
      "repair_accepted",
      "repair_rejected",
      "conditional_merge_receipt",
      "cancellation",
      "failure",
      "terminal_outcome",
    ]),
    repair: new Set(["progress", "heartbeat", "handoff", "repair_rejected", "cancellation", "failure", "terminal_outcome"]),
    merge_ready: new Set(["merge_outcome", "cancellation", "failure", "terminal_outcome"]),
    merge_not_merged: new Set(["review_requested", "cancellation", "failure", "terminal_outcome"]),
  };
  if (!allowed[group.state]?.has(eventType)) {
    throw new PrGroupLedgerError(
      "PR_GROUP_INVALID_TRANSITION",
      `${eventType} is not legal from ${group.state}`,
      { group_id: group.id, state: group.state, event_type: eventType },
    );
  }
}

export class PrGroupLedger {
  constructor(private readonly persistence: PrGroupLedgerPersistence) {}

  async get(groupId: string): Promise<PrGroupStateView> {
    const id = requiredReference(groupId, "group_id", 96);
    const group = await this.persistence.getGroup(id);
    if (!group) {
      throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group not found: ${id}`, { group_id: id });
    }
    const [allAttempts, eventWindow, receiptWindow, eventCount, latestEvent] = await Promise.all([
      this.persistence.listAttempts(id),
      this.persistence.listEvents(id, { limit: STATE_VIEW_EVENT_LIMIT + 1 }),
      this.persistence.listReceiptEvents(id, STATE_VIEW_EVENT_LIMIT + 1),
      this.persistence.countEvents(id),
      this.persistence.getLatestEvent(id),
    ]);
    const attemptsOmitted = allAttempts.length > STATE_VIEW_ATTEMPT_LIMIT;
    const attempts = allAttempts.slice(-STATE_VIEW_ATTEMPT_LIMIT);
    const visibleAttemptIds = new Set(attempts.map((attempt) => attempt.id));
    const events = eventWindow
      .filter((event) => visibleAttemptIds.has(event.attempt_id))
      .slice(0, STATE_VIEW_EVENT_LIMIT);
    const receipts = receiptWindow
      .filter((event) => visibleAttemptIds.has(event.attempt_id))
      .slice(0, STATE_VIEW_EVENT_LIMIT);
    const receiptHistoryComplete = !attemptsOmitted && receiptWindow.length <= STATE_VIEW_EVENT_LIMIT;
    const evidenceRefs = events.map((event) => ({
      kind: "EvidenceRef" as const,
      id: event.id,
      group_id: event.group_id,
      work_run_id: event.attempt_id,
      sequence: event.sequence,
      evidence_type: event.event_type,
      repository: event.repository,
      pr_number: event.pr_number,
      base_sha: event.base_sha,
      head_sha: event.head_sha,
      receipt_key: event.receipt_key,
      outcome: event.outcome,
      actor_id: event.actor_id,
      actor_run_id: event.actor_run_id,
      payload_hash: event.payload_hash,
      created_at: event.created_at,
    }));
    return {
      schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
      authoritative: true,
      authority: this.persistence.authority,
      group,
      attempts,
      latest_event: latestEvent,
      review_receipts: receipts.filter((event) => event.event_type === "review_receipt"),
      conditional_merge_receipts: receipts.filter((event) => event.event_type === "conditional_merge_receipt"),
      merge_receipts: receipts.filter((event) => event.event_type === "merge_outcome"),
      cleanup_receipts: receipts.filter((event) => event.event_type === "cleanup_eligible"),
      cleanup_eligible: group.cleanup_eligible_at !== null,
      adapters: {
        work_runs: attempts.map((attempt) => ({
          kind: "WorkRun",
          id: attempt.id,
          group_id: attempt.group_id,
          task_id: attempt.leaf_task_id,
          dispatch_attempt: attempt.dispatch_attempt,
          writer_generation: attempt.writer_generation,
          previous_run_id: attempt.previous_attempt_id,
          worktree: attempt.worktree,
          branch: attempt.branch,
          repository: attempt.repository,
          pr_number: attempt.pr_number,
          base_sha: attempt.base_sha,
          provider: attempt.provider,
          provider_run_id: attempt.provider_run_id,
          profile_alias: attempt.profile_alias,
          status: attempt.status,
          admitted_at: attempt.admitted_at,
          terminal_at: attempt.terminal_at,
        })),
        evidence_refs: evidenceRefs,
        proof_bundle: {
          kind: "ProofBundle",
          id: `proof_${group.id}`,
          group_id: group.id,
          revision: group.revision,
          evidence_ref_ids: evidenceRefs.map((ref) => ref.id),
          exact_head: group.terminal_head_sha ?? latestEvent?.head_sha ?? null,
          complete: eventCount <= STATE_VIEW_EVENT_LIMIT && receiptHistoryComplete && !attemptsOmitted,
        },
        decision_envelope: {
          kind: "DecisionEnvelope",
          id: `decision_${group.id}_${group.revision}`,
          group_id: group.id,
          state: group.state,
          active_work_run_id: group.active_attempt_id,
          active_writer_generation: group.active_generation,
          repair_cycle_count: group.repair_cycle_count,
          repair_cycle_limit: group.repair_cycle_limit,
          terminal_outcome: group.terminal_outcome,
          terminal_head_sha: group.terminal_head_sha,
          cleanup_eligible: group.cleanup_eligible_at !== null,
          revision: group.revision,
        },
      },
      diagnostics: {
        event_count: eventCount,
        attempts_omitted: attemptsOmitted,
        receipt_history_complete: receiptHistoryComplete,
        projection_limits: {
          attempts: STATE_VIEW_ATTEMPT_LIMIT,
          receipts: STATE_VIEW_EVENT_LIMIT,
        },
      },
    };
  }

  async events(groupId: string, options: PrGroupEventListOptions = {}): Promise<PrGroupEventPage> {
    const id = requiredReference(groupId, "group_id", 96);
    const group = await this.persistence.getGroup(id);
    if (!group) {
      throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group not found: ${id}`, { group_id: id });
    }
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "event limit must be an integer between 1 and 500");
    }
    const afterSequence = options.after_sequence ?? 0;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "after_sequence must be a non-negative integer");
    }
    const rows = await this.persistence.listEvents(id, {
      after_sequence: afterSequence,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    return {
      schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
      authoritative: true,
      authority: this.persistence.authority,
      group_id: id,
      events,
      count: events.length,
      has_more: hasMore,
      next_sequence: hasMore ? events.at(-1)?.sequence ?? null : null,
    };
  }

  async admit(raw: AdmitPrGroupInput): Promise<PrGroupMutationResult> {
    const admittedAt = isoTimestamp(raw.admitted_at, "admitted_at");
    const rootRequestId = safeReference(raw.root_request_id, "root_request_id");
    const repository = normalizeRepository(raw.repository);
    const leafTaskId = safeReference(raw.leaf_task_id, "leaf_task_id");
    const dispatchAttempt = safeReference(raw.dispatch_attempt, "dispatch_attempt");
    const writerGeneration = safeReference(raw.writer_generation, "writer_generation");
    const worktree = safeWorktree(raw.worktree);
    const branch = safeReference(raw.branch, "branch");
    const prNumber = normalizePrNumber(raw.pr_number);
    const baseSha = normalizeBaseSha(raw.base_sha);
    if ((prNumber === null) !== (baseSha === null)) {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        "pr_number and base_sha must be admitted together when PR identity is known",
      );
    }
    const canonicalGroupId = deterministicPrGroupId(
      rootRequestId,
      repository,
      leafTaskId,
      branch,
      prNumber,
    );
    const legacyIdentity = deterministicLegacyPrGroupIdentity(rootRequestId, repository);
    const provider = safeOptionalReference(raw.provider, "provider");
    const providerRunId = safeOptionalReference(raw.provider_run_id, "provider_run_id");
    const profileAlias = safeProfileAlias(raw.profile_alias);
    const canonicalIdentityKey = sha256(
      `pr-group:v1\0${rootRequestId}\0${repository}\0${leafTaskId}\0${branch}\0${prNumber ?? "none"}\0${baseSha ?? "none"}`,
    );
    const metadata = {};

    const event = await this.persistence.transaction(async (tx) => {
      let groupId = canonicalGroupId;
      let identityKey = canonicalIdentityKey;
      let usesLegacyIdentity = false;
      let group = await tx.getGroup(groupId, true);
      if (!group && legacyIdentity.id !== canonicalGroupId) {
        const legacyGroup = await tx.getGroup(legacyIdentity.id, true);
        if (legacyGroup &&
            legacyGroup.identity_key === legacyIdentity.identity_key &&
            legacyGroup.root_request_id === rootRequestId &&
            legacyGroup.repository === repository &&
            legacyGroup.leaf_task_id === leafTaskId &&
            legacyGroup.branch === branch &&
            legacyGroup.pr_number === prNumber &&
            legacyGroup.base_sha === baseSha) {
          group = legacyGroup;
          groupId = legacyIdentity.id;
          identityKey = legacyIdentity.identity_key;
          usesLegacyIdentity = true;
        } else if (legacyGroup &&
            legacyGroup.identity_key === legacyIdentity.identity_key &&
            legacyGroup.root_request_id === rootRequestId &&
            legacyGroup.repository === repository &&
            legacyGroup.leaf_task_id === leafTaskId &&
            legacyGroup.branch === branch) {
          throw new PrGroupLedgerError(
            "PR_GROUP_IDENTITY_CONFLICT",
            "legacy PR identity cannot be rebound from null or a different PR/base without splitting authority",
            {
              group_id: legacyGroup.id,
              persisted_pr_number: legacyGroup.pr_number,
              requested_pr_number: prNumber,
              persisted_base_sha: legacyGroup.base_sha,
              requested_base_sha: baseSha,
            },
          );
        }
      }
      const attemptId = deterministicPrGroupAttemptId(groupId, leafTaskId, dispatchAttempt);
      const idempotencyKey = `admission:${attemptId}`;
      const eventPayloadHash = payloadForHash({
        attempt_id: attemptId,
        writer_generation: writerGeneration,
        event_type: "admission",
        message: null,
        head_sha: null,
        receipt_key: null,
        review_receipt_key: null,
        conditional_merge_receipt_key: null,
        outcome: null,
        repository,
        pr_number: prNumber,
        base_sha: baseSha,
        actor_id: null,
        actor_run_id: null,
        expected_reviewer_id: null,
        expected_reviewer_run_id: null,
        repair_cycle: null,
        ci_proof: null,
        cleanup_proof: null,
        metadata,
      });
      let created = false;
      if (!group) {
        if (prNumber === null || baseSha === null) {
          throw new PrGroupLedgerError(
            "PR_GROUP_IDENTITY_CONFLICT",
            "new PR-group admissions require concrete PR number and base SHA identity",
            { root_request_id: rootRequestId, repository, leaf_task_id: leafTaskId, branch },
          );
        }
        const candidate: PrGroupRecord = {
          schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
          id: groupId,
          identity_key: identityKey,
          root_request_id: rootRequestId,
          repository,
          leaf_task_id: leafTaskId,
          branch,
          pr_number: prNumber,
          base_sha: baseSha,
          state: "admitted",
          active_attempt_id: attemptId,
          active_generation: writerGeneration,
          repair_cycle_count: 0,
          repair_cycle_limit: PR_GROUP_REPAIR_CYCLE_LIMIT,
          terminal_attempt_id: null,
          terminal_generation: null,
          terminal_outcome: null,
          terminal_head_sha: null,
          terminal_at: null,
          cleanup_eligible_at: null,
          revision: 1,
          created_at: admittedAt,
          updated_at: admittedAt,
        };
        created = await tx.insertGroup(candidate);
        group = created ? candidate : await tx.getGroup(groupId, true);
      }
      if (!group) {
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "group create-or-adopt lost its authoritative row");
      }
      if (group.identity_key !== identityKey) {
        throw new PrGroupLedgerError(
          "PR_GROUP_IDENTITY_CONFLICT",
          "deterministic PR group identity conflicts with an existing group",
          { group_id: groupId },
        );
      }
      assertGroupLineage(group, {
        root_request_id: rootRequestId,
        repository,
        leaf_task_id: leafTaskId,
        branch,
        pr_number: prNumber,
        base_sha: baseSha,
      });

      const identity = {
        leaf_task_id: leafTaskId,
        dispatch_attempt: dispatchAttempt,
        writer_generation: writerGeneration,
        worktree,
        branch,
        repository,
        pr_number: prNumber,
        base_sha: baseSha,
        provider,
        provider_run_id: providerRunId,
        profile_alias: profileAlias,
      };
      let attempt = await tx.getAttempt(attemptId);
      if (attempt) assertAttemptIdentity(attempt, identity);
      const existingAdmission = await tx.getEventByIdempotency(groupId, idempotencyKey);
      if (existingAdmission) {
        if (usesLegacyIdentity) {
          if (!attempt ||
              existingAdmission.event_type !== "admission" ||
              existingAdmission.attempt_id !== attemptId ||
              existingAdmission.writer_generation !== writerGeneration) {
            throw new PrGroupLedgerError(
              "PR_GROUP_RECEIPT_REPLAY",
              "legacy admission receipt does not match the upgraded immutable attempt",
              { group_id: groupId, idempotency_key: idempotencyKey },
            );
          }
          return { event: existingAdmission, created: false, adopted: true, appended: false };
        }
        const existing = await existingEventOrThrow(tx, groupId, idempotencyKey, eventPayloadHash);
        return { event: existing!, created: false, adopted: true, appended: false };
      }
      if (group.terminal_outcome) {
        throw new PrGroupLedgerError(
          "PR_GROUP_TERMINAL",
          "terminal PR group history cannot be reopened",
          { group_id: groupId, terminal_outcome: group.terminal_outcome },
        );
      }
      if (group.active_attempt_id !== attemptId || group.active_generation !== writerGeneration) {
        throw new PrGroupLedgerError(
          "PR_GROUP_WRITER_FENCED",
          "another active writer generation owns this PR group",
          {
            group_id: groupId,
            attempted_generation: writerGeneration,
            active_generation: group.active_generation,
            active_attempt_id: group.active_attempt_id,
          },
        );
      }
      if (!attempt) {
        attempt = {
          schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
          id: attemptId,
          group_id: groupId,
          leaf_task_id: leafTaskId,
          dispatch_attempt: dispatchAttempt,
          writer_generation: writerGeneration,
          previous_attempt_id: null,
          worktree,
          branch,
          repository,
          pr_number: prNumber,
          base_sha: baseSha,
          provider,
          provider_run_id: providerRunId,
          profile_alias: profileAlias,
          status: "admitted",
          admitted_at: admittedAt,
          started_at: null,
          last_heartbeat_at: null,
          handed_off_at: null,
          fenced_at: null,
          terminal_at: null,
          created_at: admittedAt,
          updated_at: admittedAt,
        };
        if (!await tx.insertAttempt(attempt)) {
          const raced = await tx.getAttempt(attemptId);
          if (!raced) {
            throw new PrGroupLedgerError(
              "PR_GROUP_IDENTITY_CONFLICT",
              "attempt uniqueness conflicts with another immutable PR-group attempt",
            );
          }
          assertAttemptIdentity(raced, identity);
          attempt = raced;
        }
      }

      const admissionEvent: PrGroupEventRecord = {
        schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
        id: deterministicPrGroupEventId(groupId, idempotencyKey),
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: writerGeneration,
        sequence: await tx.nextSequence(groupId),
        idempotency_key: idempotencyKey,
        event_type: "admission",
        state: "admitted",
        message: null,
        head_sha: null,
        receipt_key: null,
        review_receipt_key: null,
        conditional_merge_receipt_key: null,
        outcome: null,
        repository,
        pr_number: prNumber,
        base_sha: baseSha,
        actor_id: null,
        actor_run_id: null,
        expected_reviewer_id: null,
        expected_reviewer_run_id: null,
        repair_cycle: null,
        ci_proof: null,
        cleanup_proof: null,
        metadata,
        payload_hash: eventPayloadHash,
        created_at: admittedAt,
      };
      if (!await tx.insertEvent(admissionEvent)) {
        const raced = await existingEventOrThrow(tx, groupId, idempotencyKey, eventPayloadHash);
        if (raced) return { event: raced, created: false, adopted: true, appended: false };
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "admission event insert was not durable");
      }
      return { event: admissionEvent, created, adopted: false, appended: true };
    });

    return { ...event, view: await this.get(event.event.group_id) };
  }

  async recover(raw: RecoverPrGroupInput): Promise<PrGroupMutationResult> {
    const groupId = requiredReference(raw.group_id, "group_id", 96);
    const rootRequestId = safeReference(raw.root_request_id, "root_request_id");
    const repository = normalizeRepository(raw.repository);
    const leafTaskId = safeReference(raw.leaf_task_id, "leaf_task_id");
    const expectedAttemptId = requiredReference(raw.expected_attempt_id, "expected_attempt_id", 96);
    const dispatchAttempt = safeReference(raw.dispatch_attempt, "dispatch_attempt");
    const expectedGeneration = safeReference(raw.expected_generation, "expected_generation");
    const writerGeneration = safeReference(raw.writer_generation, "writer_generation");
    if (expectedGeneration === writerGeneration) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "recovery must create a new writer generation");
    }
    const worktree = safeWorktree(raw.worktree);
    const branch = safeReference(raw.branch, "branch");
    const prNumber = normalizePrNumber(raw.pr_number);
    const baseSha = normalizeBaseSha(raw.base_sha);
    if ((prNumber === null) !== (baseSha === null)) {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        "pr_number and base_sha must be supplied together during recovery",
      );
    }
    const expectedGroupId = deterministicPrGroupId(rootRequestId, repository, leafTaskId, branch, prNumber);
    const canonicalIdentityKey = sha256(
      `pr-group:v1\0${rootRequestId}\0${repository}\0${leafTaskId}\0${branch}\0${prNumber ?? "none"}\0${baseSha ?? "none"}`,
    );
    const legacyIdentity = deterministicLegacyPrGroupIdentity(rootRequestId, repository);
    const expectedIdentityKey = groupId === expectedGroupId
      ? canonicalIdentityKey
      : groupId === legacyIdentity.id
        ? legacyIdentity.identity_key
        : null;
    if (!expectedIdentityKey) {
      throw new PrGroupLedgerError(
        "PR_GROUP_IDENTITY_CONFLICT",
        "recovery lineage derives a different deterministic PR-group identity",
      );
    }
    const provider = safeOptionalReference(raw.provider, "provider");
    const providerRunId = safeOptionalReference(raw.provider_run_id, "provider_run_id");
    const profileAlias = safeProfileAlias(raw.profile_alias);
    const idempotencyKey = safeReference(raw.idempotency_key, "idempotency_key");
    const recoveredAtWasSupplied = raw.recovered_at !== undefined;
    const recoveredAt = isoTimestamp(raw.recovered_at, "recovered_at");
    const attemptId = deterministicPrGroupAttemptId(groupId, leafTaskId, dispatchAttempt);
    const message = safeMessage(raw.message, "message");
    const metadata = sanitizePrGroupMetadata(raw.metadata);
    const eventPayloadHash = payloadForHash({
      group_id: groupId,
      root_request_id: rootRequestId,
      repository,
      leaf_task_id: leafTaskId,
      expected_attempt_id: expectedAttemptId,
      dispatch_attempt: dispatchAttempt,
      expected_generation: expectedGeneration,
      attempt_id: attemptId,
      writer_generation: writerGeneration,
      worktree,
      branch,
      pr_number: prNumber,
      base_sha: baseSha,
      provider,
      provider_run_id: providerRunId,
      profile_alias: profileAlias,
      idempotency_key: idempotencyKey,
      event_type: "recovery",
      message,
      metadata,
      recovered_at: recoveredAtWasSupplied ? recoveredAt : null,
    });

    const result = await this.persistence.transaction(async (tx) => {
      const group = await tx.getGroup(groupId, true);
      if (!group) throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group not found: ${groupId}`);
      if (group.identity_key !== expectedIdentityKey) {
        throw new PrGroupLedgerError(
          "PR_GROUP_IDENTITY_CONFLICT",
          "recovery group identity is incompatible with its canonical or legacy lineage",
          { group_id: groupId },
        );
      }
      assertGroupLineage(group, {
        root_request_id: rootRequestId,
        repository,
        leaf_task_id: leafTaskId,
        branch,
        pr_number: prNumber,
        base_sha: baseSha,
      });
      const existingAttempt = await tx.getAttempt(attemptId);
      if (existingAttempt) {
        assertAttemptIdentity(existingAttempt, {
          leaf_task_id: leafTaskId,
          dispatch_attempt: dispatchAttempt,
          writer_generation: writerGeneration,
          worktree,
          branch,
          repository,
          pr_number: prNumber,
          base_sha: baseSha,
          provider,
          provider_run_id: providerRunId,
          profile_alias: profileAlias,
        });
      }
      const previous = await tx.getAttempt(expectedAttemptId);
      if (!previous || previous.group_id !== groupId) {
        throw new PrGroupLedgerError(
          "PR_GROUP_IDENTITY_CONFLICT",
          "recovery expected attempt is not owned by this PR group",
          { group_id: groupId, expected_attempt_id: expectedAttemptId },
        );
      }
      if (previous.writer_generation !== expectedGeneration ||
          previous.leaf_task_id !== leafTaskId ||
          previous.branch !== branch ||
          previous.repository !== repository ||
          previous.pr_number !== prNumber ||
          previous.base_sha !== baseSha ||
          previous.provider !== provider ||
          previous.profile_alias !== profileAlias) {
        throw new PrGroupLedgerError(
          "PR_GROUP_IDENTITY_CONFLICT",
          "recovery expected attempt lineage or writer fence does not match",
          { group_id: groupId, expected_attempt_id: expectedAttemptId },
        );
      }

      const existingEvent = await existingEventOrThrow(tx, groupId, idempotencyKey, eventPayloadHash);
      if (existingEvent) {
        if (!existingAttempt ||
            existingAttempt.previous_attempt_id !== expectedAttemptId ||
            group.active_attempt_id !== attemptId ||
            group.active_generation !== writerGeneration ||
            existingEvent.attempt_id !== attemptId ||
            existingEvent.writer_generation !== writerGeneration) {
          throw new PrGroupLedgerError(
            "PR_GROUP_RECEIPT_REPLAY",
            "recovery replay does not match the complete adopted generation lineage",
            { group_id: groupId, attempt_id: attemptId },
          );
        }
        return { event: existingEvent, created: false, adopted: true, appended: false };
      }
      if (group.terminal_outcome) {
        throw new PrGroupLedgerError("PR_GROUP_TERMINAL", "terminal PR group history cannot be recovered", {
          group_id: groupId,
          terminal_outcome: group.terminal_outcome,
        });
      }
      if (recoveredAt < group.updated_at) {
        throw new PrGroupLedgerError(
          "PR_GROUP_INVALID_TRANSITION",
          "recovery timestamp cannot precede the current authoritative group state",
          { group_id: groupId, recovered_at: recoveredAt, updated_at: group.updated_at },
        );
      }
      if (existingAttempt) {
        throw new PrGroupLedgerError(
          "PR_GROUP_RECEIPT_REPLAY",
          "recovery attempt already exists but the supplied idempotency key is new",
          { group_id: groupId, attempt_id: attemptId },
        );
      }
      if (group.active_generation !== expectedGeneration ||
          group.active_attempt_id !== expectedAttemptId) {
        throw new PrGroupLedgerError(
          "PR_GROUP_WRITER_FENCED",
          "recovery expected generation does not own the active writer lease",
          {
            group_id: groupId,
            expected_generation: expectedGeneration,
            active_generation: group.active_generation,
          },
        );
      }
      const leaseReference = previous.last_heartbeat_at ?? previous.updated_at ?? previous.admitted_at;
      const staleAt = Date.parse(leaseReference) + PR_GROUP_WRITER_STALE_AFTER_MS;
      if (Date.parse(recoveredAt) < staleAt) {
        throw new PrGroupLedgerError(
          "PR_GROUP_WRITER_ACTIVE",
          "active writer cannot be recovered before its authoritative stale-writer lease expires",
          {
            group_id: groupId,
            expected_attempt_id: expectedAttemptId,
            lease_reference: leaseReference,
            stale_at: new Date(staleAt).toISOString(),
            recovered_at: recoveredAt,
          },
        );
      }
      previous.status = "fenced";
      previous.fenced_at = recoveredAt;
      previous.updated_at = recoveredAt;
      await tx.updateAttempt(previous);

      const attempt: PrGroupAttemptRecord = {
        schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
        id: attemptId,
        group_id: groupId,
        leaf_task_id: leafTaskId,
        dispatch_attempt: dispatchAttempt,
        writer_generation: writerGeneration,
        previous_attempt_id: previous.id,
        worktree,
        branch,
        repository,
        pr_number: prNumber,
        base_sha: baseSha,
        provider,
        provider_run_id: providerRunId,
        profile_alias: profileAlias,
        status: "admitted",
        admitted_at: recoveredAt,
        started_at: null,
        last_heartbeat_at: null,
        handed_off_at: null,
        fenced_at: null,
        terminal_at: null,
        created_at: recoveredAt,
        updated_at: recoveredAt,
      };
      if (!await tx.insertAttempt(attempt)) {
        throw new PrGroupLedgerError("PR_GROUP_IDENTITY_CONFLICT", "recovery attempt identity already exists");
      }
      group.active_attempt_id = attemptId;
      group.active_generation = writerGeneration;
      group.state = "admitted";
      group.revision += 1;
      group.updated_at = recoveredAt;
      await tx.updateGroup(group);

      const event: PrGroupEventRecord = {
        schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
        id: deterministicPrGroupEventId(groupId, idempotencyKey),
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: writerGeneration,
        sequence: await tx.nextSequence(groupId),
        idempotency_key: idempotencyKey,
        event_type: "recovery",
        state: "admitted",
        message,
        head_sha: null,
        receipt_key: null,
        review_receipt_key: null,
        conditional_merge_receipt_key: null,
        outcome: null,
        repository,
        pr_number: prNumber,
        base_sha: baseSha,
        actor_id: null,
        actor_run_id: null,
        expected_reviewer_id: null,
        expected_reviewer_run_id: null,
        repair_cycle: null,
        ci_proof: null,
        cleanup_proof: null,
        metadata: { ...metadata, previous_attempt_id: previous.id },
        payload_hash: eventPayloadHash,
        created_at: recoveredAt,
      };
      if (!await tx.insertEvent(event)) {
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "recovery event insert was not durable");
      }
      return { event, created: true, adopted: false, appended: true };
    });

    return { ...result, view: await this.get(groupId) };
  }

  async append(raw: AppendPrGroupEventInput): Promise<PrGroupMutationResult> {
    const groupId = requiredReference(raw.group_id, "group_id", 96);
    const attemptId = requiredReference(raw.attempt_id, "attempt_id", 96);
    const writerGeneration = safeReference(raw.writer_generation, "writer_generation");
    const idempotencyKey = safeReference(raw.idempotency_key, "idempotency_key");
    const createdAtWasSupplied = raw.created_at !== undefined;
    const createdAt = isoTimestamp(raw.created_at, "created_at");
    const eventType = raw.event_type;
    if (!APPENDABLE_EVENT_TYPES.has(eventType)) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "event_type is not a supported append-only lifecycle event");
    }
    const headSha = normalizeHead(raw.head_sha, RECEIPT_EVENT_TYPES.has(eventType));
    const receiptKey = safeOptionalReference(raw.receipt_key, "receipt_key");
    const reviewReceiptKey = safeOptionalReference(raw.review_receipt_key, "review_receipt_key");
    const conditionalMergeReceiptKey = safeOptionalReference(
      raw.conditional_merge_receipt_key,
      "conditional_merge_receipt_key",
    );
    const outcome = raw.outcome ?? null;
    if (outcome !== null && !EVENT_OUTCOMES.has(outcome)) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "outcome is not supported for PR-group events");
    }
    const message = safeMessage(raw.message, "message");
    const metadata = sanitizePrGroupMetadata(raw.metadata);
    const suppliedRepository = raw.repository === undefined ? null : normalizeRepository(raw.repository);
    const suppliedPrNumber = raw.pr_number === undefined ? undefined : normalizePrNumber(raw.pr_number);
    const suppliedBaseSha = raw.base_sha === undefined ? undefined : normalizeBaseSha(raw.base_sha);
    let actorId = safeOptionalReference(raw.actor_id, "actor_id");
    let actorRunId = safeOptionalReference(raw.actor_run_id, "actor_run_id");
    const authenticatedActorId = safeOptionalReference(raw.authenticated_actor_id, "authenticated_actor_id");
    const authenticatedActorRunId = safeOptionalReference(
      raw.authenticated_actor_run_id,
      "authenticated_actor_run_id",
    );
    if (authenticatedActorId) {
      if (actorId && actorId !== authenticatedActorId) {
        throw new PrGroupLedgerError(
          "PR_GROUP_IDENTITY_CONFLICT",
          "event actor does not match the authenticated server principal",
        );
      }
      actorId = authenticatedActorId;
    }
    if (authenticatedActorRunId) {
      if (actorRunId && actorRunId !== authenticatedActorRunId) {
        throw new PrGroupLedgerError(
          "PR_GROUP_IDENTITY_CONFLICT",
          "event actor run does not match the authenticated server principal",
        );
      }
      actorRunId = authenticatedActorRunId;
    }
    const expectedReviewerId = safeOptionalReference(raw.expected_reviewer_id, "expected_reviewer_id");
    const expectedReviewerRunId = safeOptionalReference(
      raw.expected_reviewer_run_id,
      "expected_reviewer_run_id",
    );
    const repairCycle = raw.repair_cycle === undefined || raw.repair_cycle === null
      ? null
      : Number(raw.repair_cycle);
    if (repairCycle !== null && (!Number.isSafeInteger(repairCycle) || repairCycle < 1)) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "repair_cycle must be a positive integer");
    }
    const cleanupProof = eventType === "cleanup_eligible"
      ? normalizeCleanupProof(raw.cleanup_proof)
      : null;
    if (eventType !== "cleanup_eligible" && raw.cleanup_proof !== undefined && raw.cleanup_proof !== null) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "cleanup_proof is reserved for cleanup_eligible");
    }
    const ciProof = eventType === "conditional_merge_receipt"
      ? normalizeCiProof(raw.ci_proof)
      : null;
    if (eventType !== "conditional_merge_receipt" && raw.ci_proof !== undefined && raw.ci_proof !== null) {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        "ci_proof is reserved for conditional_merge_receipt",
      );
    }

    if (["review_receipt", "conditional_merge_receipt", "merge_outcome"].includes(eventType) && !receiptKey) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${eventType} requires receipt_key`);
    }
    if (receiptKey && !["review_receipt", "conditional_merge_receipt", "merge_outcome"].includes(eventType)) {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        "receipt_key is reserved for review, conditional merge, and merge receipts",
      );
    }
    if (eventType === "review_receipt" &&
        outcome !== "approved" && outcome !== "changes_requested" && outcome !== "dismissed") {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_TRANSITION",
        "review_receipt outcome must be approved, changes_requested, or dismissed",
      );
    }
    if (eventType === "merge_outcome" && outcome !== "merged" && outcome !== "not_merged") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_TRANSITION", "merge_outcome outcome must be merged or not_merged");
    }
    if (eventType === "repair_accepted" && outcome !== "accepted") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_TRANSITION", "repair_accepted outcome must be accepted");
    }
    if (eventType === "repair_rejected" && outcome !== "rejected") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_TRANSITION", "repair_rejected outcome must be rejected");
    }
    if (eventType === "cancellation" && outcome !== null && outcome !== "cancelled") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_TRANSITION", "cancellation outcome must be cancelled or omitted");
    }
    if (eventType === "failure" && outcome !== null && outcome !== "failed") {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_TRANSITION", "failure outcome must be failed or omitted");
    }
    if (eventType === "terminal_outcome" &&
        outcome !== "cancelled" && outcome !== "failed" && outcome !== "no_go") {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_TRANSITION",
        "merged terminal outcomes require merge_outcome and all other terminal outcomes must be cancelled, failed, or no_go",
      );
    }
    const noOutcomeEvents = new Set<PrGroupEventType>([
      "started",
      "progress",
      "heartbeat",
      "handoff",
      "review_requested",
      "conditional_merge_receipt",
      "cleanup_eligible",
    ]);
    if (noOutcomeEvents.has(eventType) && outcome !== null) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_TRANSITION", `${eventType} cannot carry an outcome`);
    }
    if (eventType === "conditional_merge_receipt" && !reviewReceiptKey) {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        "conditional_merge_receipt requires review_receipt_key",
      );
    }
    if (eventType === "merge_outcome" && !conditionalMergeReceiptKey) {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        "merge_outcome requires conditional_merge_receipt_key",
      );
    }
    if (eventType !== "conditional_merge_receipt" && reviewReceiptKey) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "review_receipt_key is reserved for conditional merge");
    }
    if (eventType !== "merge_outcome" && conditionalMergeReceiptKey) {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        "conditional_merge_receipt_key is reserved for merge outcomes",
      );
    }
    if ((eventType === "conditional_merge_receipt" || eventType === "merge_outcome") &&
        (!actorId || !actorRunId)) {
      throw new PrGroupLedgerError(
        "PR_GROUP_OPERATOR_SEPARATION_REQUIRED",
        `${eventType} requires a durable merge-operator identity and run`,
      );
    }
    if (!["repair_accepted", "repair_rejected"].includes(eventType) && repairCycle !== null) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "repair_cycle is reserved for repair accounting events");
    }
    if (["repair_accepted", "repair_rejected"].includes(eventType) && repairCycle === null) {
      throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", `${eventType} requires repair_cycle`);
    }
    if (["review_receipt", "conditional_merge_receipt", "merge_outcome"].includes(eventType) &&
        (!actorId || !actorRunId)) {
      throw new PrGroupLedgerError(
        "PR_GROUP_INVALID_INPUT",
        `${eventType} requires exact actor and actor-run identities`,
      );
    }

    const result = await this.persistence.transaction(async (tx) => {
      const group = await tx.getGroup(groupId, true);
      if (!group) throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group not found: ${groupId}`);
      const attempt = await tx.getAttempt(attemptId);
      if (!attempt || attempt.group_id !== groupId) {
        throw new PrGroupLedgerError("PR_GROUP_NOT_FOUND", `PR group attempt not found: ${attemptId}`);
      }
      if (attempt.writer_generation !== writerGeneration) {
        throw new PrGroupLedgerError("PR_GROUP_WRITER_FENCED", "attempt writer generation does not match", {
          attempt_id: attemptId,
          attempted_generation: writerGeneration,
        });
      }

      if (attempt.repository !== group.repository ||
          attempt.leaf_task_id !== group.leaf_task_id ||
          attempt.branch !== group.branch ||
          attempt.pr_number !== group.pr_number ||
          attempt.base_sha !== group.base_sha) {
        throw new PrGroupLedgerError(
          "PR_GROUP_IDENTITY_CONFLICT",
          "attempt lineage does not match its owning PR group",
          { group_id: groupId, attempt_id: attemptId },
        );
      }

      if (RECEIPT_EVENT_TYPES.has(eventType)) {
        if (!suppliedRepository || suppliedPrNumber === undefined || suppliedBaseSha === undefined) {
          throw new PrGroupLedgerError(
            "PR_GROUP_IDENTITY_CONFLICT",
            `${eventType} requires the complete repository, PR, and base lineage`,
          );
        }
        assertGroupLineage(group, {
          repository: suppliedRepository,
          pr_number: suppliedPrNumber,
          base_sha: suppliedBaseSha,
        });
      }
      const eventRepository = group.repository;
      const eventPrNumber = group.pr_number;
      const eventBaseSha = group.base_sha;
      const payloadHash = payloadForHash({
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: writerGeneration,
        idempotency_key: idempotencyKey,
        event_type: eventType,
        message,
        head_sha: headSha,
        receipt_key: receiptKey,
        review_receipt_key: reviewReceiptKey,
        conditional_merge_receipt_key: conditionalMergeReceiptKey,
        outcome,
        repository: eventRepository,
        pr_number: eventPrNumber,
        base_sha: eventBaseSha,
        actor_id: actorId,
        actor_run_id: actorRunId,
        expected_reviewer_id: expectedReviewerId,
        expected_reviewer_run_id: expectedReviewerRunId,
        repair_cycle: repairCycle,
        ci_proof: ciProof,
        cleanup_proof: cleanupProof,
        metadata,
        created_at: createdAtWasSupplied ? createdAt : null,
      });
      const existing = await existingEventOrThrow(tx, groupId, idempotencyKey, payloadHash);
      if (existing) return { event: existing, created: false, adopted: true, appended: false };
      if (group.terminal_outcome) {
        if (eventType !== "cleanup_eligible" ||
            group.terminal_attempt_id !== attemptId ||
            group.terminal_generation !== writerGeneration) {
          throw new PrGroupLedgerError(
            "PR_GROUP_TERMINAL",
            "terminal PR group history cannot be reopened or mutated by another generation",
            { group_id: groupId, terminal_outcome: group.terminal_outcome },
          );
        }
      } else if (group.active_attempt_id !== attemptId || group.active_generation !== writerGeneration) {
        throw new PrGroupLedgerError(
          "PR_GROUP_WRITER_FENCED",
          "stale writer generation cannot append PR group evidence",
          {
            group_id: groupId,
            attempted_generation: writerGeneration,
            active_generation: group.active_generation,
            active_attempt_id: group.active_attempt_id,
          },
        );
      }
      if (createdAt < group.updated_at) {
        throw new PrGroupLedgerError(
          "PR_GROUP_INVALID_TRANSITION",
          "event timestamp cannot precede the current authoritative group state",
          { group_id: groupId, created_at: createdAt, updated_at: group.updated_at },
        );
      }

      if (receiptKey) {
        const receiptReplay = await tx.findEventByReceiptKey(receiptKey);
        if (receiptReplay) {
          throw new PrGroupLedgerError(
            "PR_GROUP_RECEIPT_REPLAY",
            "receipt_key is already bound to another event",
            { receipt_key: receiptKey, existing_event_id: receiptReplay.id },
          );
        }
      }
      assertLegalTransition(group, eventType);
      let latestReview: PrGroupEventRecord | null = null;
      if (eventType === "review_receipt") {
        const request = await tx.findEvent(groupId, {
          event_type: "review_requested",
          attempt_id: attemptId,
        });
        if (!request || request.head_sha !== headSha) {
          throw new PrGroupLedgerError(
            "PR_GROUP_EXACT_HEAD_REQUIRED",
            "review receipt requires the latest review request bound to the same attempt and exact head",
            { group_id: groupId, attempt_id: attemptId, head_sha: headSha },
          );
        }
        if ((request.expected_reviewer_id && request.expected_reviewer_id !== actorId) ||
            (request.expected_reviewer_run_id && request.expected_reviewer_run_id !== actorRunId)) {
          throw new PrGroupLedgerError(
            "PR_GROUP_IDENTITY_CONFLICT",
            "review receipt actor/run does not match the requested reviewer authority",
            { group_id: groupId, attempt_id: attemptId },
          );
        }
      }
      if (eventType === "conditional_merge_receipt") {
        latestReview = await tx.findEvent(groupId, {
          event_type: "review_receipt",
          attempt_id: attemptId,
        });
        const latestRequest = await tx.findEvent(groupId, {
          event_type: "review_requested",
          attempt_id: attemptId,
        });
        if (!latestReview ||
            !latestRequest ||
            latestRequest.head_sha !== headSha ||
            latestReview.head_sha !== headSha ||
            latestReview.outcome !== "approved" ||
            latestReview.receipt_key !== reviewReceiptKey) {
          throw new PrGroupLedgerError(
            "PR_GROUP_REVIEW_REQUIRED",
            "conditional merge requires the latest sequence-aware review to be the bound exact-head approval",
            { group_id: groupId, attempt_id: attemptId, head_sha: headSha },
          );
        }
        if (latestReview.actor_id === actorId || latestReview.actor_run_id === actorRunId) {
          throw new PrGroupLedgerError(
            "PR_GROUP_OPERATOR_SEPARATION_REQUIRED",
            "conditional merge operator must be distinct from the exact-head reviewer",
            { group_id: groupId, attempt_id: attemptId, reviewer_id: latestReview.actor_id },
          );
        }
        if (!ciProof ||
            ciProof.repository !== eventRepository ||
            ciProof.pr_number !== eventPrNumber ||
            ciProof.base_sha !== eventBaseSha ||
            ciProof.head_sha !== headSha) {
          throw new PrGroupLedgerError(
            "PR_GROUP_EXACT_HEAD_REQUIRED",
            "conditional merge requires successful provider CI proof bound to the same repository, PR, base, and head",
            { group_id: groupId, attempt_id: attemptId, head_sha: headSha },
          );
        }
      }
      if (eventType === "merge_outcome") {
        const mergeReceipt = await tx.findEvent(groupId, {
          event_type: "conditional_merge_receipt",
          attempt_id: attemptId,
          head_sha: headSha,
          receipt_key: conditionalMergeReceiptKey!,
        });
        if (!mergeReceipt) {
          throw new PrGroupLedgerError(
            "PR_GROUP_MERGE_RECEIPT_REQUIRED",
            "merge outcome requires the bound exact-head conditional receipt from the same actor/run",
            { group_id: groupId, attempt_id: attemptId, head_sha: headSha },
          );
        }
        if (mergeReceipt.actor_id !== actorId || mergeReceipt.actor_run_id !== actorRunId) {
          throw new PrGroupLedgerError(
            "PR_GROUP_OPERATOR_SEPARATION_REQUIRED",
            "merge outcome must be emitted by the exact conditional-merge operator and run",
            { group_id: groupId, attempt_id: attemptId, head_sha: headSha },
          );
        }
      }
      if (eventType === "repair_accepted" || eventType === "repair_rejected") {
        latestReview = await tx.findEvent(groupId, {
          event_type: "review_receipt",
          attempt_id: attemptId,
        });
        if (!latestReview ||
            (latestReview.outcome !== "changes_requested" && latestReview.outcome !== "dismissed")) {
          throw new PrGroupLedgerError(
            "PR_GROUP_INVALID_TRANSITION",
            "repair accounting requires the latest review to be non-approving",
          );
        }
        if (eventType === "repair_accepted" &&
            (group.repair_cycle_count >= group.repair_cycle_limit ||
             repairCycle !== group.repair_cycle_count + 1)) {
          throw new PrGroupLedgerError(
            "PR_GROUP_INVALID_TRANSITION",
            "repair cycle must advance exactly once and cannot exceed the acceptance-scope limit",
            {
              repair_cycle_count: group.repair_cycle_count,
              repair_cycle_limit: group.repair_cycle_limit,
              attempted_cycle: repairCycle,
            },
          );
        }
        if (eventType === "repair_rejected" && repairCycle !== group.repair_cycle_count) {
          throw new PrGroupLedgerError(
            "PR_GROUP_INVALID_TRANSITION",
            "repair rejection must bind the current durable repair cycle",
          );
        }
      }
      if (eventType === "cleanup_eligible") {
        if (group.cleanup_eligible_at) {
          throw new PrGroupLedgerError(
            "PR_GROUP_TERMINAL",
            "cleanup eligibility is already recorded; replay the original idempotency key",
            { group_id: groupId, cleanup_eligible_at: group.cleanup_eligible_at },
          );
        }
        if (!group.terminal_outcome || group.active_generation !== null || group.active_attempt_id !== null) {
          throw new PrGroupLedgerError("PR_GROUP_CLEANUP_BLOCKED", "cleanup requires a terminal group with no active writer");
        }
        if (!cleanupProof ||
            cleanupProof.terminal_disposition !== group.terminal_outcome ||
            (group.terminal_head_sha !== null && cleanupProof.provider_head_sha !== group.terminal_head_sha)) {
          throw new PrGroupLedgerError(
            "PR_GROUP_CLEANUP_BLOCKED",
            "cleanup proof does not match the immutable terminal disposition and exact head",
          );
        }
        if (group.terminal_outcome === "merged") {
          const head = group.terminal_head_sha;
          const review = await tx.findEvent(groupId, {
            event_type: "review_receipt",
            head_sha: head,
            outcome: "approved",
            receipt_key: cleanupProof.review_receipt_key ?? undefined,
          });
          const conditional = await tx.findEvent(groupId, {
            event_type: "conditional_merge_receipt",
            head_sha: head,
            receipt_key: cleanupProof.conditional_merge_receipt_key ?? undefined,
          });
          const merged = await tx.findEvent(groupId, {
            event_type: "merge_outcome",
            head_sha: head,
            outcome: "merged",
            receipt_key: cleanupProof.merge_receipt_key ?? undefined,
          });
          if (!cleanupProof.review_receipt_key ||
              !cleanupProof.conditional_merge_receipt_key ||
              !cleanupProof.merge_receipt_key ||
              !review || !conditional || !merged ||
              conditional.review_receipt_key !== review.receipt_key ||
              merged.conditional_merge_receipt_key !== conditional.receipt_key) {
            throw new PrGroupLedgerError(
              "PR_GROUP_CLEANUP_BLOCKED",
              "merged cleanup requires the exact bound review, conditional merge, and merge receipts",
            );
          }
        } else if (group.terminal_outcome === "no_go") {
          const review = group.terminal_head_sha === null
            ? null
            : await tx.findEvent(groupId, {
              event_type: "review_receipt",
              head_sha: group.terminal_head_sha,
              receipt_key: cleanupProof.review_receipt_key ?? undefined,
            });
          if (!cleanupProof.review_receipt_key ||
              cleanupProof.conditional_merge_receipt_key !== null ||
              cleanupProof.merge_receipt_key !== null ||
              cleanupProof.provider_head_sha !== group.terminal_head_sha ||
              !review ||
              review.outcome === "approved") {
            throw new PrGroupLedgerError(
              "PR_GROUP_CLEANUP_BLOCKED",
              "NO-GO cleanup requires the exact non-approving review receipt and terminal head",
            );
          }
        } else {
          throw new PrGroupLedgerError(
            "PR_GROUP_CLEANUP_BLOCKED",
            "cancelled and failed cleanup requires a future durable unique-work consumption proof",
          );
        }
      }

      const reviewExhausted = eventType === "review_receipt" &&
        outcome !== "approved" &&
        group.repair_cycle_count >= group.repair_cycle_limit;
      const state = reviewExhausted ? "no_go" : stateForEvent(eventType, outcome);
      const event: PrGroupEventRecord = {
        schema_version: PR_GROUP_LEDGER_SCHEMA_VERSION,
        id: deterministicPrGroupEventId(groupId, idempotencyKey),
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: writerGeneration,
        sequence: await tx.nextSequence(groupId),
        idempotency_key: idempotencyKey,
        event_type: eventType,
        state,
        message,
        head_sha: headSha,
        receipt_key: receiptKey,
        review_receipt_key: reviewReceiptKey,
        conditional_merge_receipt_key: conditionalMergeReceiptKey,
        outcome,
        repository: eventRepository,
        pr_number: eventPrNumber,
        base_sha: eventBaseSha,
        actor_id: actorId,
        actor_run_id: actorRunId,
        expected_reviewer_id: expectedReviewerId,
        expected_reviewer_run_id: expectedReviewerRunId,
        repair_cycle: repairCycle,
        ci_proof: ciProof,
        cleanup_proof: cleanupProof,
        metadata,
        payload_hash: payloadHash,
        created_at: createdAt,
      };
      if (!await tx.insertEvent(event)) {
        const raced = await existingEventOrThrow(tx, groupId, idempotencyKey, payloadHash);
        if (raced) return { event: raced, created: false, adopted: true, appended: false };
        throw new PrGroupLedgerError("PR_GROUP_ATOMICITY_UNAVAILABLE", "event append was not durable");
      }

      group.state = state;
      if (eventType === "repair_accepted") group.repair_cycle_count = repairCycle!;
      const terminalOutcome = reviewExhausted
        ? "no_go"
        : terminalOutcomeFor(eventType, outcome);
      if (terminalOutcome) {
        group.terminal_outcome = terminalOutcome;
        group.terminal_attempt_id = attemptId;
        group.terminal_generation = writerGeneration;
        group.terminal_head_sha =
          terminalOutcome === "merged" || terminalOutcome === "no_go" ? headSha : null;
        group.terminal_at = createdAt;
        group.active_attempt_id = null;
        group.active_generation = null;
      }
      if (eventType === "cleanup_eligible") group.cleanup_eligible_at = createdAt;
      group.revision += 1;
      group.updated_at = createdAt;
      await tx.updateGroup(group);

      attempt.status = reviewExhausted
        ? "no_go"
        : attemptStatusFor(eventType, outcome, attempt.status);
      if (eventType === "started" && !attempt.started_at) attempt.started_at = createdAt;
      if (eventType === "heartbeat" || eventType === "progress") attempt.last_heartbeat_at = createdAt;
      if (eventType === "handoff") attempt.handed_off_at = createdAt;
      if (terminalOutcome) attempt.terminal_at = createdAt;
      attempt.updated_at = createdAt;
      await tx.updateAttempt(attempt);
      return { event, created: true, adopted: false, appended: true };
    });

    return { ...result, view: await this.get(groupId) };
  }
}
