export const PR_GROUP_LEDGER_SCHEMA_VERSION = 1 as const;
export const PR_GROUP_REPAIR_CYCLE_LIMIT = 2 as const;

export type PrGroupState =
  | "admitted"
  | "started"
  | "in_progress"
  | "handed_off"
  | "review_requested"
  | "reviewed"
  | "repair"
  | "merge_ready"
  | "merge_not_merged"
  | "merged"
  | "cancelled"
  | "failed"
  | "no_go"
  | "cleanup_eligible";

export type PrGroupTerminalOutcome = "merged" | "cancelled" | "failed" | "no_go";

export type PrGroupAttemptStatus =
  | "admitted"
  | "started"
  | "in_progress"
  | "handed_off"
  | "reviewing"
  | "repair"
  | "merge_ready"
  | "fenced"
  | "merged"
  | "cancelled"
  | "failed"
  | "no_go";

export type PrGroupEventType =
  | "admission"
  | "started"
  | "progress"
  | "heartbeat"
  | "handoff"
  | "review_requested"
  | "review_receipt"
  | "repair_accepted"
  | "repair_rejected"
  | "conditional_merge_receipt"
  | "merge_outcome"
  | "recovery"
  | "cancellation"
  | "failure"
  | "cleanup_eligible"
  | "terminal_outcome";

export type PrGroupEventOutcome =
  | "approved"
  | "changes_requested"
  | "dismissed"
  | "accepted"
  | "rejected"
  | "merged"
  | "not_merged"
  | PrGroupTerminalOutcome;

export interface PrGroupRecord {
  schema_version: typeof PR_GROUP_LEDGER_SCHEMA_VERSION;
  id: string;
  identity_key: string;
  root_request_id: string;
  repository: string;
  leaf_task_id: string;
  branch: string;
  pr_number: number | null;
  base_sha: string | null;
  state: PrGroupState;
  active_attempt_id: string | null;
  active_generation: string | null;
  repair_cycle_count: number;
  repair_cycle_limit: typeof PR_GROUP_REPAIR_CYCLE_LIMIT;
  terminal_attempt_id: string | null;
  terminal_generation: string | null;
  terminal_outcome: PrGroupTerminalOutcome | null;
  terminal_head_sha: string | null;
  terminal_at: string | null;
  cleanup_eligible_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface PrGroupAttemptRecord {
  schema_version: typeof PR_GROUP_LEDGER_SCHEMA_VERSION;
  id: string;
  group_id: string;
  leaf_task_id: string;
  dispatch_attempt: string;
  writer_generation: string;
  previous_attempt_id: string | null;
  worktree: string;
  branch: string;
  repository: string;
  pr_number: number | null;
  base_sha: string | null;
  provider: string | null;
  provider_run_id: string | null;
  profile_alias: string | null;
  status: PrGroupAttemptStatus;
  admitted_at: string;
  started_at: string | null;
  last_heartbeat_at: string | null;
  handed_off_at: string | null;
  fenced_at: string | null;
  terminal_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrGroupEventRecord {
  schema_version: typeof PR_GROUP_LEDGER_SCHEMA_VERSION;
  id: string;
  group_id: string;
  attempt_id: string;
  writer_generation: string;
  sequence: number;
  idempotency_key: string;
  event_type: PrGroupEventType;
  state: PrGroupState;
  message: string | null;
  head_sha: string | null;
  receipt_key: string | null;
  review_receipt_key: string | null;
  conditional_merge_receipt_key: string | null;
  outcome: PrGroupEventOutcome | null;
  repository: string;
  pr_number: number | null;
  base_sha: string | null;
  actor_id: string | null;
  actor_run_id: string | null;
  expected_reviewer_id: string | null;
  expected_reviewer_run_id: string | null;
  repair_cycle: number | null;
  ci_proof: PrGroupCiProof | null;
  cleanup_proof: PrGroupCleanupProof | null;
  metadata: Record<string, unknown>;
  payload_hash: string;
  created_at: string;
}

export interface PrGroupStateView {
  schema_version: typeof PR_GROUP_LEDGER_SCHEMA_VERSION;
  authoritative: true;
  authority: "local" | "remote";
  group: PrGroupRecord;
  attempts: PrGroupAttemptRecord[];
  latest_event: PrGroupEventRecord | null;
  review_receipts: PrGroupEventRecord[];
  conditional_merge_receipts: PrGroupEventRecord[];
  merge_receipts: PrGroupEventRecord[];
  cleanup_receipts: PrGroupEventRecord[];
  cleanup_eligible: boolean;
  adapters: PrGroupAdapterViews;
  diagnostics: {
    event_count: number;
    attempts_omitted: boolean;
    receipt_history_complete: boolean;
    projection_limits: {
      attempts: number;
      receipts: number;
    };
  };
}

export interface PrGroupWorkRunAdapter {
  kind: "WorkRun";
  id: string;
  group_id: string;
  task_id: string;
  dispatch_attempt: string;
  writer_generation: string;
  previous_run_id: string | null;
  worktree: string;
  branch: string;
  repository: string;
  pr_number: number | null;
  base_sha: string | null;
  provider: string | null;
  provider_run_id: string | null;
  profile_alias: string | null;
  status: PrGroupAttemptStatus;
  admitted_at: string;
  terminal_at: string | null;
}

export interface PrGroupEvidenceRefAdapter {
  kind: "EvidenceRef";
  id: string;
  group_id: string;
  work_run_id: string;
  sequence: number;
  evidence_type: PrGroupEventType;
  repository: string;
  pr_number: number | null;
  base_sha: string | null;
  head_sha: string | null;
  receipt_key: string | null;
  outcome: PrGroupEventOutcome | null;
  actor_id: string | null;
  actor_run_id: string | null;
  payload_hash: string;
  created_at: string;
}

export interface PrGroupProofBundleAdapter {
  kind: "ProofBundle";
  id: string;
  group_id: string;
  revision: number;
  evidence_ref_ids: string[];
  exact_head: string | null;
  complete: boolean;
}

export interface PrGroupDecisionEnvelopeAdapter {
  kind: "DecisionEnvelope";
  id: string;
  group_id: string;
  state: PrGroupState;
  active_work_run_id: string | null;
  active_writer_generation: string | null;
  repair_cycle_count: number;
  repair_cycle_limit: typeof PR_GROUP_REPAIR_CYCLE_LIMIT;
  terminal_outcome: PrGroupTerminalOutcome | null;
  terminal_head_sha: string | null;
  cleanup_eligible: boolean;
  revision: number;
}

export interface PrGroupAdapterViews {
  work_runs: PrGroupWorkRunAdapter[];
  evidence_refs: PrGroupEvidenceRefAdapter[];
  proof_bundle: PrGroupProofBundleAdapter;
  decision_envelope: PrGroupDecisionEnvelopeAdapter;
}

export interface PrGroupEventPage {
  schema_version: typeof PR_GROUP_LEDGER_SCHEMA_VERSION;
  authoritative: true;
  authority: "local" | "remote";
  group_id: string;
  events: PrGroupEventRecord[];
  count: number;
  has_more: boolean;
  next_sequence: number | null;
}

export interface AdmitPrGroupInput {
  root_request_id: string;
  repository: string;
  leaf_task_id: string;
  dispatch_attempt: string;
  writer_generation: string;
  worktree: string;
  branch: string;
  pr_number?: number | null;
  base_sha?: string | null;
  provider?: string | null;
  provider_run_id?: string | null;
  profile_alias?: string | null;
  admitted_at?: string;
}

export interface RecoverPrGroupInput {
  group_id: string;
  root_request_id: string;
  repository: string;
  leaf_task_id: string;
  expected_attempt_id: string;
  dispatch_attempt: string;
  expected_generation: string;
  writer_generation: string;
  worktree: string;
  branch: string;
  pr_number: number | null;
  base_sha: string | null;
  provider: string | null;
  provider_run_id: string | null;
  profile_alias: string | null;
  idempotency_key: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  recovered_at?: string;
}

export interface AppendPrGroupEventInput {
  group_id: string;
  attempt_id: string;
  writer_generation: string;
  idempotency_key: string;
  event_type: Exclude<PrGroupEventType, "admission" | "recovery">;
  message?: string | null;
  head_sha?: string | null;
  receipt_key?: string | null;
  review_receipt_key?: string | null;
  conditional_merge_receipt_key?: string | null;
  outcome?: PrGroupEventOutcome | null;
  repository?: string;
  pr_number?: number | null;
  base_sha?: string | null;
  actor_id?: string | null;
  actor_run_id?: string | null;
  expected_reviewer_id?: string | null;
  expected_reviewer_run_id?: string | null;
  authenticated_actor_id?: string | null;
  authenticated_actor_run_id?: string | null;
  repair_cycle?: number | null;
  ci_proof?: PrGroupCiProof | null;
  cleanup_proof?: PrGroupCleanupProof | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface PrGroupCiProof {
  provider: string;
  provider_run_id: string;
  status: "success";
  repository: string;
  pr_number: number;
  base_sha: string;
  head_sha: string;
}

export interface PrGroupCleanupProof {
  worktree_clean: true;
  provider_reachable: true;
  provider_head_sha: string;
  pr_policy_satisfied: true;
  terminal_disposition: PrGroupTerminalOutcome;
  writer_retired: true;
  review_receipt_key: string | null;
  conditional_merge_receipt_key: string | null;
  merge_receipt_key: string | null;
}

export interface PrGroupMutationResult {
  created: boolean;
  adopted: boolean;
  appended: boolean;
  view: PrGroupStateView;
  event: PrGroupEventRecord;
}

export interface PrGroupEventListOptions {
  limit?: number;
  after_sequence?: number;
}

export type PrGroupLedgerErrorCode =
  | "PR_GROUP_INVALID_INPUT"
  | "PR_GROUP_NOT_FOUND"
  | "PR_GROUP_IDENTITY_CONFLICT"
  | "PR_GROUP_WRITER_FENCED"
  | "PR_GROUP_WRITER_ACTIVE"
  | "PR_GROUP_TERMINAL"
  | "PR_GROUP_INVALID_TRANSITION"
  | "PR_GROUP_RECEIPT_REPLAY"
  | "PR_GROUP_EXACT_HEAD_REQUIRED"
  | "PR_GROUP_REVIEW_REQUIRED"
  | "PR_GROUP_OPERATOR_SEPARATION_REQUIRED"
  | "PR_GROUP_MERGE_RECEIPT_REQUIRED"
  | "PR_GROUP_CLEANUP_BLOCKED"
  | "PR_GROUP_ATOMICITY_UNAVAILABLE"
  | "PR_GROUP_REMOTE_INVALID_RESPONSE"
  | "PR_GROUP_REMOTE_UNAVAILABLE";

export class PrGroupLedgerError extends Error {
  constructor(
    public readonly code: PrGroupLedgerErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = "PrGroupLedgerError";
  }
}

export interface PrGroupLedgerTransaction {
  getGroup(id: string, forUpdate?: boolean): Promise<PrGroupRecord | null>;
  insertGroup(group: PrGroupRecord): Promise<boolean>;
  updateGroup(group: PrGroupRecord): Promise<void>;
  getAttempt(id: string): Promise<PrGroupAttemptRecord | null>;
  listAttempts(groupId: string): Promise<PrGroupAttemptRecord[]>;
  insertAttempt(attempt: PrGroupAttemptRecord): Promise<boolean>;
  updateAttempt(attempt: PrGroupAttemptRecord): Promise<void>;
  getEventByIdempotency(groupId: string, key: string): Promise<PrGroupEventRecord | null>;
  findEventByReceiptKey(receiptKey: string): Promise<PrGroupEventRecord | null>;
  findEvent(groupId: string, filters: {
    event_type: PrGroupEventType;
    attempt_id?: string;
    head_sha?: string | null;
    outcome?: PrGroupEventOutcome | null;
    receipt_key?: string;
  }): Promise<PrGroupEventRecord | null>;
  listEvents(groupId: string, options?: PrGroupEventListOptions): Promise<PrGroupEventRecord[]>;
  nextSequence(groupId: string): Promise<number>;
  insertEvent(event: PrGroupEventRecord): Promise<boolean>;
}

export interface PrGroupLedgerPersistence {
  readonly authority: "local" | "remote";
  transaction<T>(fn: (tx: PrGroupLedgerTransaction) => Promise<T>): Promise<T>;
  getGroup(id: string): Promise<PrGroupRecord | null>;
  listAttempts(groupId: string): Promise<PrGroupAttemptRecord[]>;
  listEvents(groupId: string, options?: PrGroupEventListOptions): Promise<PrGroupEventRecord[]>;
  listReceiptEvents(groupId: string, limit: number): Promise<PrGroupEventRecord[]>;
  countEvents(groupId: string): Promise<number>;
  getLatestEvent(groupId: string): Promise<PrGroupEventRecord | null>;
}
