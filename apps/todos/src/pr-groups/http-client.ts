import {
  deterministicLegacyPrGroupIdentity,
  deterministicPrGroupAttemptId,
  deterministicPrGroupEventId,
  deterministicPrGroupId,
} from "./ledger.js";
import {
  PrGroupLedgerError,
  type AdmitPrGroupInput,
  type AppendPrGroupEventInput,
  type PrGroupEventListOptions,
  type PrGroupEventPage,
  type PrGroupLedgerErrorCode,
  type PrGroupMutationResult,
  type PrGroupStateView,
  type RecoverPrGroupInput,
} from "./types.js";

export interface PrGroupHttpClientOptions {
  baseUrl: string;
  apiPrefix?: "/api/pr-groups" | "/v1/pr-groups";
  apiKey?: string;
  expectedAuthority?: "local" | "remote";
  fetchImpl?: typeof fetch;
}

const LEDGER_CODES = new Set<PrGroupLedgerErrorCode>([
  "PR_GROUP_INVALID_INPUT",
  "PR_GROUP_NOT_FOUND",
  "PR_GROUP_IDENTITY_CONFLICT",
  "PR_GROUP_WRITER_FENCED",
  "PR_GROUP_WRITER_ACTIVE",
  "PR_GROUP_TERMINAL",
  "PR_GROUP_INVALID_TRANSITION",
  "PR_GROUP_RECEIPT_REPLAY",
  "PR_GROUP_EXACT_HEAD_REQUIRED",
  "PR_GROUP_REVIEW_REQUIRED",
  "PR_GROUP_OPERATOR_SEPARATION_REQUIRED",
  "PR_GROUP_MERGE_RECEIPT_REQUIRED",
  "PR_GROUP_CLEANUP_BLOCKED",
  "PR_GROUP_ATOMICITY_UNAVAILABLE",
  "PR_GROUP_REMOTE_INVALID_RESPONSE",
  "PR_GROUP_REMOTE_UNAVAILABLE",
]);

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "PR-group API baseUrl must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new PrGroupLedgerError("PR_GROUP_INVALID_INPUT", "PR-group API baseUrl must not contain credentials, query, or fragment");
  }
  return url.origin;
}

type JsonObject = Record<string, unknown>;

const GROUP_STATES = new Set([
  "admitted", "started", "in_progress", "handed_off", "review_requested",
  "reviewed", "repair", "merge_ready", "merge_not_merged", "merged",
  "cancelled", "failed", "no_go", "cleanup_eligible",
]);
const ATTEMPT_STATES = new Set([
  "admitted", "started", "in_progress", "handed_off", "reviewing", "repair",
  "merge_ready", "fenced", "merged", "cancelled", "failed", "no_go",
]);
const EVENT_TYPES = new Set([
  "admission", "started", "progress", "heartbeat", "handoff", "review_requested",
  "review_receipt", "repair_accepted", "repair_rejected",
  "conditional_merge_receipt", "merge_outcome", "recovery", "cancellation",
  "failure", "cleanup_eligible", "terminal_outcome",
]);
const EVENT_OUTCOMES = new Set([
  "approved", "changes_requested", "dismissed", "accepted", "rejected",
  "merged", "not_merged", "cancelled", "failed", "no_go",
]);

function invalid(route: string, message: string): never {
  throw new PrGroupLedgerError(
    "PR_GROUP_REMOTE_INVALID_RESPONSE",
    message,
    { route },
  );
}

function closedObject(
  value: unknown,
  required: readonly string[],
  route: string,
  label: string,
): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(route, `${label} must be a JSON object`);
  }
  const result = value as JsonObject;
  const requiredSet = new Set(required);
  const missing = required.filter((key) => !(key in result));
  const unknown = Object.keys(result).filter((key) => !requiredSet.has(key));
  if (missing.length || unknown.length) {
    return invalid(
      route,
      `${label} has a non-authoritative shape (missing: ${missing.join(",") || "none"}; unknown: ${unknown.join(",") || "none"})`,
    );
  }
  return result;
}

function string(value: unknown, route: string, label: string): string {
  if (typeof value !== "string" || !value) return invalid(route, `${label} must be a non-empty string`);
  return value;
}

function nullableString(value: unknown, route: string, label: string): string | null {
  if (value === null) return null;
  return string(value, route, label);
}

function integer(value: unknown, route: string, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    return invalid(route, `${label} must be an integer >= ${minimum}`);
  }
  return Number(value);
}

function nullableInteger(value: unknown, route: string, label: string): number | null {
  return value === null ? null : integer(value, route, label, 1);
}

function boolean(value: unknown, route: string, label: string): boolean {
  if (typeof value !== "boolean") return invalid(route, `${label} must be boolean`);
  return value;
}

function array(value: unknown, route: string, label: string): unknown[] {
  if (!Array.isArray(value)) return invalid(route, `${label} must be an array`);
  return value;
}

function schemaVersion(value: unknown, route: string, label: string): void {
  if (value !== 1) invalid(route, `${label}.schema_version must equal 1`);
}

function parseCiProof(value: unknown, route: string): void {
  if (value === null) return;
  const proof = closedObject(value, [
    "provider", "provider_run_id", "status", "repository",
    "pr_number", "base_sha", "head_sha",
  ], route, "event.ci_proof");
  string(proof.provider, route, "event.ci_proof.provider");
  string(proof.provider_run_id, route, "event.ci_proof.provider_run_id");
  if (proof.status !== "success") invalid(route, "event.ci_proof.status must equal success");
  string(proof.repository, route, "event.ci_proof.repository");
  integer(proof.pr_number, route, "event.ci_proof.pr_number", 1);
  string(proof.base_sha, route, "event.ci_proof.base_sha");
  string(proof.head_sha, route, "event.ci_proof.head_sha");
}

function parseCleanupProof(value: unknown, route: string): void {
  if (value === null) return;
  const proof = closedObject(value, [
    "worktree_clean", "provider_reachable", "provider_head_sha",
    "pr_policy_satisfied", "terminal_disposition", "writer_retired",
    "review_receipt_key", "conditional_merge_receipt_key", "merge_receipt_key",
  ], route, "event.cleanup_proof");
  if (proof.worktree_clean !== true ||
      proof.provider_reachable !== true ||
      proof.pr_policy_satisfied !== true ||
      proof.writer_retired !== true ||
      !["merged", "cancelled", "failed", "no_go"].includes(String(proof.terminal_disposition))) {
    invalid(route, "event.cleanup_proof contains contradictory safety evidence");
  }
  string(proof.provider_head_sha, route, "event.cleanup_proof.provider_head_sha");
  for (const key of ["review_receipt_key", "conditional_merge_receipt_key", "merge_receipt_key"]) {
    nullableString(proof[key], route, `event.cleanup_proof.${key}`);
  }
}

function parseEvent(value: unknown, route: string, expectedGroupId?: string): JsonObject {
  const event = closedObject(value, [
    "schema_version", "id", "group_id", "attempt_id", "writer_generation",
    "sequence", "idempotency_key", "event_type", "state", "message", "head_sha",
    "receipt_key", "review_receipt_key", "conditional_merge_receipt_key", "outcome",
    "repository", "pr_number", "base_sha", "actor_id", "actor_run_id",
    "expected_reviewer_id", "expected_reviewer_run_id", "repair_cycle",
    "ci_proof", "cleanup_proof", "metadata", "payload_hash", "created_at",
  ], route, "PR-group event");
  schemaVersion(event.schema_version, route, "event");
  string(event.id, route, "event.id");
  const groupId = string(event.group_id, route, "event.group_id");
  if (expectedGroupId && groupId !== expectedGroupId) invalid(route, "event group lineage drifted");
  string(event.attempt_id, route, "event.attempt_id");
  string(event.writer_generation, route, "event.writer_generation");
  integer(event.sequence, route, "event.sequence", 1);
  string(event.idempotency_key, route, "event.idempotency_key");
  if (!EVENT_TYPES.has(String(event.event_type))) invalid(route, "event.event_type is unknown");
  if (!GROUP_STATES.has(String(event.state))) invalid(route, "event.state is unknown");
  for (const key of [
    "message", "head_sha", "receipt_key", "review_receipt_key",
    "conditional_merge_receipt_key", "base_sha", "actor_id", "actor_run_id",
    "expected_reviewer_id", "expected_reviewer_run_id",
  ]) {
    nullableString(event[key], route, `event.${key}`);
  }
  if (event.outcome !== null && !EVENT_OUTCOMES.has(String(event.outcome))) {
    invalid(route, "event.outcome is unknown");
  }
  string(event.repository, route, "event.repository");
  nullableInteger(event.pr_number, route, "event.pr_number");
  if (event.repair_cycle !== null) integer(event.repair_cycle, route, "event.repair_cycle", 1);
  parseCiProof(event.ci_proof, route);
  parseCleanupProof(event.cleanup_proof, route);
  closedObjectLike(event.metadata, route, "event.metadata");
  string(event.payload_hash, route, "event.payload_hash");
  string(event.created_at, route, "event.created_at");

  if (event.event_type === "review_receipt" &&
      (!["approved", "changes_requested", "dismissed"].includes(String(event.outcome)) ||
       event.receipt_key === null || event.head_sha === null ||
       event.actor_id === null || event.actor_run_id === null)) {
    invalid(route, "review receipt is incomplete or contradictory");
  }
  if (event.event_type === "conditional_merge_receipt" &&
      (event.receipt_key === null || event.review_receipt_key === null ||
       event.outcome !== null || event.head_sha === null || event.ci_proof === null ||
       event.actor_id === null || event.actor_run_id === null)) {
    invalid(route, "conditional merge receipt is incomplete or contradictory");
  }
  if (event.event_type === "merge_outcome" &&
      (event.receipt_key === null || event.conditional_merge_receipt_key === null ||
       !["merged", "not_merged"].includes(String(event.outcome)) || event.head_sha === null)) {
    invalid(route, "merge receipt is incomplete or contradictory");
  }
  if (event.event_type === "cleanup_eligible" && event.cleanup_proof === null) {
    invalid(route, "cleanup receipt is missing its durable safety proof");
  }
  if (event.event_type !== "conditional_merge_receipt" && event.ci_proof !== null) {
    invalid(route, "provider CI proof is attached to a non-conditional event");
  }
  if (event.ci_proof !== null) {
    const proof = event.ci_proof as Record<string, unknown>;
    if (proof.repository !== event.repository ||
        proof.pr_number !== event.pr_number ||
        proof.base_sha !== event.base_sha ||
        proof.head_sha !== event.head_sha) {
      invalid(route, "provider CI proof does not match event repository/PR/base/head lineage");
    }
  }
  return event;
}

function closedObjectLike(value: unknown, route: string, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(route, `${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function parseGroup(value: unknown, route: string): JsonObject {
  const group = closedObject(value, [
    "schema_version", "id", "identity_key", "root_request_id", "repository",
    "leaf_task_id", "branch", "pr_number", "base_sha", "state",
    "active_attempt_id", "active_generation", "repair_cycle_count",
    "repair_cycle_limit", "terminal_attempt_id", "terminal_generation",
    "terminal_outcome", "terminal_head_sha", "terminal_at", "cleanup_eligible_at",
    "revision", "created_at", "updated_at",
  ], route, "PR-group");
  schemaVersion(group.schema_version, route, "group");
  for (const key of ["id", "identity_key", "root_request_id", "repository", "leaf_task_id", "branch", "created_at", "updated_at"]) {
    string(group[key], route, `group.${key}`);
  }
  nullableInteger(group.pr_number, route, "group.pr_number");
  nullableString(group.base_sha, route, "group.base_sha");
  if ((group.pr_number === null) !== (group.base_sha === null)) {
    invalid(route, "group PR number/base SHA lineage is contradictory");
  }
  if (!GROUP_STATES.has(String(group.state))) invalid(route, "group.state is unknown");
  for (const key of [
    "active_attempt_id", "active_generation", "terminal_attempt_id",
    "terminal_generation", "terminal_outcome", "terminal_head_sha",
    "terminal_at", "cleanup_eligible_at",
  ]) {
    nullableString(group[key], route, `group.${key}`);
  }
  integer(group.repair_cycle_count, route, "group.repair_cycle_count");
  if (group.repair_cycle_limit !== 2 || Number(group.repair_cycle_count) > 2) {
    invalid(route, "group repair accounting exceeds the authoritative limit");
  }
  integer(group.revision, route, "group.revision", 1);
  const terminal = group.terminal_outcome !== null;
  if (terminal !== (group.terminal_at !== null) ||
      terminal !== (group.terminal_attempt_id !== null) ||
      terminal !== (group.terminal_generation !== null) ||
      terminal === (group.active_attempt_id !== null) ||
      terminal === (group.active_generation !== null)) {
    invalid(route, "group active/terminal lineage is contradictory");
  }
  return group;
}

function parseAttempt(value: unknown, route: string, group: JsonObject): JsonObject {
  const attempt = closedObject(value, [
    "schema_version", "id", "group_id", "leaf_task_id", "dispatch_attempt",
    "writer_generation", "previous_attempt_id", "worktree", "branch", "repository",
    "pr_number", "base_sha", "provider", "provider_run_id", "profile_alias",
    "status", "admitted_at", "started_at", "last_heartbeat_at", "handed_off_at",
    "fenced_at", "terminal_at", "created_at", "updated_at",
  ], route, "PR-group attempt");
  schemaVersion(attempt.schema_version, route, "attempt");
  for (const key of [
    "id", "group_id", "leaf_task_id", "dispatch_attempt", "writer_generation",
    "worktree", "branch", "repository", "admitted_at", "created_at", "updated_at",
  ]) string(attempt[key], route, `attempt.${key}`);
  for (const key of [
    "previous_attempt_id", "base_sha", "provider", "provider_run_id", "profile_alias",
    "started_at", "last_heartbeat_at", "handed_off_at", "fenced_at", "terminal_at",
  ]) nullableString(attempt[key], route, `attempt.${key}`);
  nullableInteger(attempt.pr_number, route, "attempt.pr_number");
  if (!ATTEMPT_STATES.has(String(attempt.status))) invalid(route, "attempt.status is unknown");
  if (attempt.group_id !== group.id ||
      attempt.leaf_task_id !== group.leaf_task_id ||
      attempt.branch !== group.branch ||
      attempt.repository !== group.repository ||
      attempt.pr_number !== group.pr_number ||
      attempt.base_sha !== group.base_sha) {
    invalid(route, "attempt immutable lineage does not match its owning group");
  }
  return attempt;
}

function parseWorkRun(value: unknown, route: string, group: JsonObject): JsonObject {
  const run = closedObject(value, [
    "kind", "id", "group_id", "task_id", "dispatch_attempt", "writer_generation",
    "previous_run_id", "worktree", "branch", "repository", "pr_number", "base_sha",
    "provider", "provider_run_id", "profile_alias", "status", "admitted_at", "terminal_at",
  ], route, "adapters.work_run");
  for (const key of [
    "id", "group_id", "task_id", "dispatch_attempt", "writer_generation",
    "worktree", "branch", "repository", "admitted_at",
  ]) string(run[key], route, `work_run.${key}`);
  for (const key of [
    "previous_run_id", "base_sha", "provider", "provider_run_id",
    "profile_alias", "terminal_at",
  ]) nullableString(run[key], route, `work_run.${key}`);
  nullableInteger(run.pr_number, route, "work_run.pr_number");
  if ((run.pr_number === null) !== (run.base_sha === null)) {
    invalid(route, "work-run PR number/base SHA lineage is contradictory");
  }
  if (!ATTEMPT_STATES.has(String(run.status))) invalid(route, "work_run.status is unknown");
  if (run.kind !== "WorkRun" || run.group_id !== group.id ||
      run.task_id !== group.leaf_task_id || run.repository !== group.repository ||
      run.pr_number !== group.pr_number || run.base_sha !== group.base_sha) {
    invalid(route, "work-run adapter lineage is contradictory");
  }
  return run;
}

function parseEvidenceRef(value: unknown, route: string, group: JsonObject): JsonObject {
  const ref = closedObject(value, [
    "kind", "id", "group_id", "work_run_id", "sequence", "evidence_type",
    "repository", "pr_number", "base_sha", "head_sha", "receipt_key", "outcome",
    "actor_id", "actor_run_id", "payload_hash", "created_at",
  ], route, "adapters.evidence_ref");
  for (const key of [
    "id", "group_id", "work_run_id", "repository", "payload_hash", "created_at",
  ]) string(ref[key], route, `evidence_ref.${key}`);
  integer(ref.sequence, route, "evidence_ref.sequence", 1);
  if (!EVENT_TYPES.has(String(ref.evidence_type))) invalid(route, "evidence_ref.evidence_type is unknown");
  nullableInteger(ref.pr_number, route, "evidence_ref.pr_number");
  for (const key of [
    "base_sha", "head_sha", "receipt_key", "actor_id", "actor_run_id",
  ]) nullableString(ref[key], route, `evidence_ref.${key}`);
  if ((ref.pr_number === null) !== (ref.base_sha === null)) {
    invalid(route, "evidence PR number/base SHA lineage is contradictory");
  }
  if (ref.outcome !== null && !EVENT_OUTCOMES.has(String(ref.outcome))) {
    invalid(route, "evidence_ref.outcome is unknown");
  }
  if (ref.kind !== "EvidenceRef" || ref.group_id !== group.id ||
      ref.repository !== group.repository || ref.pr_number !== group.pr_number ||
      ref.base_sha !== group.base_sha) {
    invalid(route, "evidence adapter lineage is contradictory");
  }
  return ref;
}

export function parsePrGroupStateView(
  value: unknown,
  expectedAuthority: "local" | "remote" | undefined,
  route: string,
  expectedGroupId?: string,
): PrGroupStateView {
  const view = closedObject(value, [
    "schema_version", "authoritative", "authority", "group", "attempts",
    "latest_event", "review_receipts", "conditional_merge_receipts",
    "merge_receipts", "cleanup_receipts", "cleanup_eligible", "adapters", "diagnostics",
  ], route, "authoritative PR-group view");
  schemaVersion(view.schema_version, route, "view");
  if (view.authoritative !== true || !["local", "remote"].includes(String(view.authority))) {
    invalid(route, "authoritative PR-group response envelope is missing");
  }
  if (expectedAuthority && view.authority !== expectedAuthority) {
    invalid(route, `PR-group authority mismatch: expected ${expectedAuthority}, received ${String(view.authority)}`);
  }
  const group = parseGroup(view.group, route);
  if (expectedGroupId && group.id !== expectedGroupId) invalid(route, "requested PR-group identity drifted");
  const attempts = array(view.attempts, route, "view.attempts").map((entry) => parseAttempt(entry, route, group));
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  if (group.active_attempt_id !== null && !attemptIds.has(group.active_attempt_id)) {
    invalid(route, "active attempt is omitted from the authoritative projection");
  }
  const latestEvent = view.latest_event === null ? null : parseEvent(view.latest_event, route, String(group.id));
  const receiptArrays = [
    ["review_receipts", "review_receipt"],
    ["conditional_merge_receipts", "conditional_merge_receipt"],
    ["merge_receipts", "merge_outcome"],
    ["cleanup_receipts", "cleanup_eligible"],
  ] as const;
  for (const [field, type] of receiptArrays) {
    for (const receipt of array(view[field], route, `view.${field}`)) {
      if (parseEvent(receipt, route, String(group.id)).event_type !== type) {
        invalid(route, `view.${field} contains a different event type`);
      }
    }
  }
  if (boolean(view.cleanup_eligible, route, "view.cleanup_eligible") !== (group.cleanup_eligible_at !== null)) {
    invalid(route, "cleanup projection contradicts the group receipt");
  }

  const adapters = closedObject(view.adapters, [
    "work_runs", "evidence_refs", "proof_bundle", "decision_envelope",
  ], route, "view.adapters");
  const workRuns = array(adapters.work_runs, route, "adapters.work_runs")
    .map((entry) => parseWorkRun(entry, route, group));
  if (workRuns.length !== attempts.length) invalid(route, "work-run adapter projection is incomplete");
  const attemptsById = new Map(attempts.map((attempt) => [String(attempt.id), attempt]));
  if (new Set(workRuns.map((run) => run.id)).size !== workRuns.length) {
    invalid(route, "work-run adapter identities are duplicated");
  }
  const projectedAttemptFields = [
    ["id", "id"],
    ["group_id", "group_id"],
    ["task_id", "leaf_task_id"],
    ["dispatch_attempt", "dispatch_attempt"],
    ["writer_generation", "writer_generation"],
    ["previous_run_id", "previous_attempt_id"],
    ["worktree", "worktree"],
    ["branch", "branch"],
    ["repository", "repository"],
    ["pr_number", "pr_number"],
    ["base_sha", "base_sha"],
    ["provider", "provider"],
    ["provider_run_id", "provider_run_id"],
    ["profile_alias", "profile_alias"],
    ["status", "status"],
    ["admitted_at", "admitted_at"],
    ["terminal_at", "terminal_at"],
  ] as const;
  for (const run of workRuns) {
    const attempt = attemptsById.get(String(run.id));
    if (!attempt ||
        projectedAttemptFields.some(([runField, attemptField]) => run[runField] !== attempt[attemptField])) {
      invalid(route, "work-run adapter does not exactly project its authoritative attempt");
    }
  }
  const evidenceRefs = array(adapters.evidence_refs, route, "adapters.evidence_refs")
    .map((entry) => parseEvidenceRef(entry, route, group));
  if (new Set(evidenceRefs.map((ref) => ref.id)).size !== evidenceRefs.length ||
      new Set(evidenceRefs.map((ref) => ref.sequence)).size !== evidenceRefs.length ||
      evidenceRefs.some((ref) => !attemptIds.has(ref.work_run_id))) {
    invalid(route, "evidence adapter identities are duplicated or detached from their work run");
  }
  for (let index = 1; index < evidenceRefs.length; index += 1) {
    if (Number(evidenceRefs[index - 1]!.sequence) >= Number(evidenceRefs[index]!.sequence)) {
      invalid(route, "evidence adapter sequences are not strictly increasing");
    }
  }
  const proof = closedObject(adapters.proof_bundle, [
    "kind", "id", "group_id", "revision", "evidence_ref_ids", "exact_head", "complete",
  ], route, "adapters.proof_bundle");
  if (proof.kind !== "ProofBundle" ||
      proof.id !== `proof_${String(group.id)}` ||
      proof.group_id !== group.id ||
      proof.revision !== group.revision) {
    invalid(route, "proof-bundle adapter is contradictory");
  }
  const proofEvidenceIds = array(proof.evidence_ref_ids, route, "proof_bundle.evidence_ref_ids")
    .map((id, index) => string(id, route, `proof_bundle.evidence_ref_ids[${index}]`));
  const expectedEvidenceIds = evidenceRefs.map((ref) => String(ref.id));
  if (JSON.stringify(proofEvidenceIds) !== JSON.stringify(expectedEvidenceIds)) {
    invalid(route, "proof-bundle evidence identities do not equal the evidence projection");
  }
  const proofExactHead = nullableString(proof.exact_head, route, "proof_bundle.exact_head");
  const expectedExactHead = group.terminal_head_sha ?? latestEvent?.head_sha ?? null;
  if (proofExactHead !== expectedExactHead) {
    invalid(route, "proof-bundle exact head contradicts the authoritative group/event projection");
  }
  const proofComplete = boolean(proof.complete, route, "proof_bundle.complete");
  const decision = closedObject(adapters.decision_envelope, [
    "kind", "id", "group_id", "state", "active_work_run_id",
    "active_writer_generation", "repair_cycle_count", "repair_cycle_limit",
    "terminal_outcome", "terminal_head_sha", "cleanup_eligible", "revision",
  ], route, "adapters.decision_envelope");
  if (decision.kind !== "DecisionEnvelope" ||
      decision.id !== `decision_${String(group.id)}_${String(group.revision)}` ||
      decision.group_id !== group.id ||
      decision.state !== group.state ||
      decision.active_work_run_id !== group.active_attempt_id ||
      decision.active_writer_generation !== group.active_generation ||
      decision.repair_cycle_count !== group.repair_cycle_count ||
      decision.repair_cycle_limit !== group.repair_cycle_limit ||
      decision.terminal_outcome !== group.terminal_outcome ||
      decision.terminal_head_sha !== group.terminal_head_sha ||
      decision.cleanup_eligible !== view.cleanup_eligible ||
      decision.revision !== group.revision) {
    invalid(route, "decision-envelope adapter is contradictory");
  }
  const diagnostics = closedObject(view.diagnostics, [
    "event_count", "attempts_omitted", "receipt_history_complete", "projection_limits",
  ], route, "view.diagnostics");
  const eventCount = integer(diagnostics.event_count, route, "diagnostics.event_count");
  const attemptsOmitted = boolean(diagnostics.attempts_omitted, route, "diagnostics.attempts_omitted");
  const receiptHistoryComplete = boolean(
    diagnostics.receipt_history_complete,
    route,
    "diagnostics.receipt_history_complete",
  );
  const limits = closedObject(diagnostics.projection_limits, [
    "attempts", "receipts",
  ], route, "diagnostics.projection_limits");
  const attemptLimit = integer(limits.attempts, route, "projection_limits.attempts", 1);
  const receiptLimit = integer(limits.receipts, route, "projection_limits.receipts", 1);
  if (eventCount < evidenceRefs.length || (eventCount === 0) !== (latestEvent === null)) {
    invalid(route, "diagnostics event count contradicts the authoritative event projection");
  }
  if ((attemptsOmitted && attempts.length !== attemptLimit) ||
      (!attemptsOmitted && attempts.length > attemptLimit) ||
      proofComplete !== (eventCount <= receiptLimit && receiptHistoryComplete && !attemptsOmitted)) {
    invalid(route, "proof completeness contradicts the authoritative projection diagnostics");
  }
  if (proofComplete && latestEvent &&
      evidenceRefs.at(-1)?.id !== latestEvent.id) {
    invalid(route, "complete evidence projection omits the authoritative latest event");
  }
  return view as unknown as PrGroupStateView;
}

export function parsePrGroupEventPage(
  value: unknown,
  expectedAuthority: "local" | "remote" | undefined,
  route: string,
  expectedGroupId: string,
): PrGroupEventPage {
  const history = closedObject(value, [
    "schema_version", "authoritative", "authority", "group_id", "events",
    "count", "has_more", "next_sequence",
  ], route, "authoritative PR-group event page");
  schemaVersion(history.schema_version, route, "history");
  if (history.authoritative !== true || !["local", "remote"].includes(String(history.authority)) ||
      (expectedAuthority && history.authority !== expectedAuthority) ||
      history.group_id !== expectedGroupId) {
    invalid(route, "authoritative history authority or group identity drifted");
  }
  const events = array(history.events, route, "history.events")
    .map((entry) => parseEvent(entry, route, expectedGroupId));
  for (let index = 1; index < events.length; index += 1) {
    if (Number(events[index - 1]!.sequence) >= Number(events[index]!.sequence)) {
      invalid(route, "history event sequences must be unique and strictly increasing");
    }
  }
  if (integer(history.count, route, "history.count") !== events.length) {
    invalid(route, "history.count does not match events");
  }
  const hasMore = boolean(history.has_more, route, "history.has_more");
  const nextSequence = history.next_sequence === null
    ? null
    : integer(history.next_sequence, route, "history.next_sequence", 1);
  if ((!hasMore && nextSequence !== null) ||
      (hasMore && (events.length === 0 || nextSequence !== events.at(-1)?.sequence))) {
    invalid(route, "history continuation state is contradictory");
  }
  return history as unknown as PrGroupEventPage;
}

function parseMutationIdentity(
  value: unknown,
  expectedGroupId: string | undefined,
  expectedAttemptId: string | undefined,
  expectedAuthority: "local" | "remote" | undefined,
  route: string,
): PrGroupMutationResult {
  const mutation = closedObject(value, [
    "created", "adopted", "appended", "view", "event",
  ], route, "PR-group mutation result");
  for (const key of ["created", "adopted", "appended"]) boolean(mutation[key], route, `mutation.${key}`);
  const view = parsePrGroupStateView(mutation.view, expectedAuthority, route, expectedGroupId);
  const event = parseEvent(mutation.event, route, view.group.id);
  if ((expectedAttemptId !== undefined && event.attempt_id !== expectedAttemptId) ||
      !view.attempts.some((attempt) => attempt.id === event.attempt_id)) {
    invalid(route, "authoritative PR-group mutation response has inconsistent lineage identity");
  }
  return mutation as unknown as PrGroupMutationResult;
}

function canonicalRequestRepository(value: string): string {
  return value.trim()
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/^git@[^:]+:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function assertAdmitMutationIdentity(
  result: PrGroupMutationResult,
  input: AdmitPrGroupInput,
  route: string,
): PrGroupMutationResult {
  const group = result.view.group;
  const repository = canonicalRequestRepository(input.repository);
  const canonicalGroupId = deterministicPrGroupId(
    input.root_request_id,
    input.repository,
    input.leaf_task_id,
    input.branch,
    input.pr_number ?? null,
  );
  const legacyGroupId = deterministicLegacyPrGroupIdentity(
    input.root_request_id,
    input.repository,
  ).id;
  if (group.id !== canonicalGroupId && group.id !== legacyGroupId) {
    invalid(route, "admission response group ID is not deterministic for the request lineage");
  }
  if (group.root_request_id !== input.root_request_id.trim() ||
      group.repository !== repository ||
      group.leaf_task_id !== input.leaf_task_id.trim() ||
      group.branch !== input.branch.trim() ||
      group.pr_number !== (input.pr_number ?? null) ||
      group.base_sha !== (input.base_sha?.toLowerCase() ?? null)) {
    invalid(route, "admission response group lineage does not match the request");
  }
  const expectedAttemptId = deterministicPrGroupAttemptId(
    group.id,
    input.leaf_task_id,
    input.dispatch_attempt,
  );
  if (result.event.attempt_id !== expectedAttemptId ||
      result.event.id !== deterministicPrGroupEventId(
        group.id,
        `admission:${expectedAttemptId}`,
      ) ||
      result.event.event_type !== "admission") {
    invalid(route, "admission response attempt/event IDs are not deterministic for the request");
  }
  const attempt = result.view.attempts.find((entry) => entry.id === expectedAttemptId);
  if (!attempt ||
      attempt.leaf_task_id !== input.leaf_task_id.trim() ||
      attempt.dispatch_attempt !== input.dispatch_attempt.trim() ||
      attempt.writer_generation !== input.writer_generation.trim() ||
      attempt.previous_attempt_id !== null ||
      attempt.worktree !== input.worktree.trim() ||
      attempt.branch !== input.branch.trim() ||
      attempt.repository !== repository ||
      attempt.pr_number !== (input.pr_number ?? null) ||
      attempt.base_sha !== (input.base_sha?.toLowerCase() ?? null) ||
      attempt.provider !== (input.provider?.trim() || null) ||
      attempt.provider_run_id !== (input.provider_run_id?.trim() || null) ||
      attempt.profile_alias !== (input.profile_alias?.trim() || null)) {
    invalid(route, "admission response attempt lineage does not match the request");
  }
  return result;
}

function assertRecoverMutationIdentity(
  result: PrGroupMutationResult,
  input: RecoverPrGroupInput,
  route: string,
): PrGroupMutationResult {
  const expectedAttemptId = deterministicPrGroupAttemptId(
    input.group_id,
    input.leaf_task_id,
    input.dispatch_attempt,
  );
  if (result.view.group.id !== input.group_id ||
      result.event.attempt_id !== expectedAttemptId ||
      result.event.id !== deterministicPrGroupEventId(input.group_id, input.idempotency_key) ||
      result.event.event_type !== "recovery") {
    invalid(route, "recovery response IDs are not deterministic for the request");
  }
  const group = result.view.group;
  if (group.root_request_id !== input.root_request_id.trim() ||
      group.repository !== canonicalRequestRepository(input.repository) ||
      group.leaf_task_id !== input.leaf_task_id.trim() ||
      group.branch !== input.branch.trim() ||
      group.pr_number !== (input.pr_number ?? null) ||
      group.base_sha !== (input.base_sha?.toLowerCase() ?? null)) {
    invalid(route, "recovery response group lineage does not match the request");
  }
  const attempt = result.view.attempts.find((entry) => entry.id === expectedAttemptId);
  if (!attempt ||
      attempt.leaf_task_id !== input.leaf_task_id.trim() ||
      attempt.dispatch_attempt !== input.dispatch_attempt.trim() ||
      attempt.writer_generation !== input.writer_generation.trim() ||
      attempt.previous_attempt_id !== input.expected_attempt_id.trim() ||
      attempt.worktree !== input.worktree.trim() ||
      attempt.branch !== input.branch.trim() ||
      attempt.repository !== canonicalRequestRepository(input.repository) ||
      attempt.pr_number !== (input.pr_number ?? null) ||
      attempt.base_sha !== (input.base_sha?.toLowerCase() ?? null) ||
      attempt.provider !== (input.provider?.trim() || null) ||
      attempt.provider_run_id !== (input.provider_run_id?.trim() || null) ||
      attempt.profile_alias !== (input.profile_alias?.trim() || null)) {
    invalid(route, "recovery response attempt lineage does not match the request");
  }
  return result;
}

function assertAppendMutationIdentity(
  result: PrGroupMutationResult,
  input: AppendPrGroupEventInput,
  route: string,
): PrGroupMutationResult {
  if (result.event.id !== deterministicPrGroupEventId(input.group_id, input.idempotency_key) ||
      result.event.event_type !== input.event_type) {
    invalid(route, "event response ID/type is not deterministic for the request");
  }
  return result;
}

export class PrGroupHttpClient {
  private readonly baseUrl: string;
  private readonly prefix: "/api/pr-groups" | "/v1/pr-groups";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PrGroupHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.prefix = options.apiPrefix ?? "/api/pr-groups";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const route = `${this.prefix}${path}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.options.apiKey) headers["x-api-key"] = this.options.apiKey;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${route}`, {
        method,
        headers,
        redirect: "manual",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new PrGroupLedgerError(
        "PR_GROUP_REMOTE_UNAVAILABLE",
        "authoritative PR-group API could not be reached; local fallback is disabled",
        { route, cause: cause instanceof Error ? cause.name : "unknown" },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PrGroupLedgerError(
        "PR_GROUP_REMOTE_INVALID_RESPONSE",
        "authoritative PR-group API returned non-JSON data; local fallback is disabled",
        { route, status: response.status },
      );
    }
    if (!response.ok) {
      const envelope = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const code = typeof envelope["code"] === "string" && LEDGER_CODES.has(envelope["code"] as PrGroupLedgerErrorCode)
        ? envelope["code"] as PrGroupLedgerErrorCode
        : "PR_GROUP_REMOTE_UNAVAILABLE";
      throw new PrGroupLedgerError(
        code,
        typeof envelope["error"] === "string" ? envelope["error"] : `authoritative PR-group API returned HTTP ${response.status}`,
        { route, status: response.status, partial: envelope["details"] ?? null },
      );
    }
    return payload as T;
  }

  async admit(input: AdmitPrGroupInput): Promise<PrGroupMutationResult> {
    const result = await this.request<unknown>("POST", "/admit", input);
    return assertAdmitMutationIdentity(parseMutationIdentity(
      result,
      undefined,
      undefined,
      this.options.expectedAuthority,
      "/admit",
    ), input, "/admit");
  }

  async recover(input: RecoverPrGroupInput): Promise<PrGroupMutationResult> {
    const result = await this.request<unknown>(
      "POST",
      `/${encodeURIComponent(input.group_id)}/recover`,
      input,
    );
    return assertRecoverMutationIdentity(parseMutationIdentity(
      result,
      input.group_id,
      undefined,
      this.options.expectedAuthority,
      "/recover",
    ), input, "/recover");
  }

  async append(input: AppendPrGroupEventInput): Promise<PrGroupMutationResult> {
    const result = await this.request<unknown>(
      "POST",
      `/${encodeURIComponent(input.group_id)}/events`,
      input,
    );
    return assertAppendMutationIdentity(parseMutationIdentity(
      result,
      input.group_id,
      input.attempt_id,
      this.options.expectedAuthority,
      "/events",
    ), input, "/events");
  }

  async get(groupId: string): Promise<PrGroupStateView> {
    const payload = await this.request<unknown>(
      "GET",
      `/${encodeURIComponent(groupId)}`,
    );
    const envelope = closedObject(payload, ["view"], `/${groupId}`, "PR-group state response");
    return parsePrGroupStateView(
      envelope.view,
      this.options.expectedAuthority,
      `/${groupId}`,
      groupId,
    );
  }

  async events(groupId: string, options: PrGroupEventListOptions = {}): Promise<PrGroupEventPage> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.after_sequence !== undefined) query.set("after_sequence", String(options.after_sequence));
    const suffix = query.size ? `?${query}` : "";
    const payload = await this.request<unknown>(
      "GET",
      `/${encodeURIComponent(groupId)}/events${suffix}`,
    );
    const envelope = closedObject(
      payload,
      ["history"],
      `/${groupId}/events`,
      "PR-group event history response",
    );
    return parsePrGroupEventPage(
      envelope.history,
      this.options.expectedAuthority,
      `/${groupId}/events`,
      groupId,
    );
  }
}
