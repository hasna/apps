import type {
  ActionDeadLetter,
  ActionError,
  ActionInvocation,
  ActionResult,
  JsonObject,
  JsonValue,
} from "@hasna/actions";
import type {
  ActionQueueApprovalGate,
  ActionQueueApprovalRequirement,
  QueueEntryStatus,
} from "./lib/action-queue.js";

export const AUTOMATION_SCHEMA_VERSION = "1.0" as const;

export const AUTOMATION_STATUSES = [
  "active",
  "paused",
  "archived",
] as const;

export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const AUTOMATION_RUN_STATUSES = [
  "pending",
  "materialized",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "dead",
] as const;

export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const AUTOMATION_TRIGGER_KINDS = [
  "manual",
  "event",
  "webhook",
  "schedule",
  "api",
] as const;

export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER_KINDS)[number];

export interface AutomationTrigger {
  kind: AutomationTriggerKind;
  source?: string;
  type?: string;
  subject?: string;
  filter?: JsonObject;
  metadata?: JsonObject;
}

export interface EventEnvelopeLike<TData extends JsonObject = JsonObject> {
  id: string;
  source: string;
  type: string;
  time?: string;
  subject?: string;
  data?: TData;
  dedupeKey?: string;
  metadata?: JsonObject;
}

export const WEBHOOK_ROUTE_STATUSES = [
  "active",
  "disabled",
  "archived",
] as const;

export type WebhookRouteStatus = (typeof WEBHOOK_ROUTE_STATUSES)[number];

export type WebhookSignatureAlgorithm = "hmac-sha256";
export type WebhookSignatureEncoding = "hex" | "base64";

export interface WebhookSignatureConfig {
  algorithm: WebhookSignatureAlgorithm;
  secretRef: string;
  header?: string;
  encoding?: WebhookSignatureEncoding;
  prefix?: string;
}

export interface WebhookEventMapping {
  source: string;
  type: string;
  subject?: string;
  subjectPath?: string;
  dataPath?: string;
  idPath?: string;
  timePath?: string;
  dedupeKeyPath?: string;
  dedupeKeyHeader?: string;
  metadata?: JsonObject;
}

export interface WebhookRoute {
  id: string;
  automationId: string;
  path: string;
  status: WebhookRouteStatus;
  signature?: WebhookSignatureConfig;
  mapping: WebhookEventMapping;
  createdAt: string;
  updatedAt: string;
  metadata?: JsonObject;
}

export interface WebhookRequestInput {
  route: WebhookRoute;
  rawBody: string | Uint8Array;
  headers?: Record<string, string | undefined>;
  receivedAt?: string | Date;
}

export interface MaterializedWebhookRequest {
  route: WebhookRoute;
  event: EventEnvelopeLike;
  materialized: MaterializedEventRun[];
}

export type AutomationApprovalGateTemplate = Omit<ActionQueueApprovalGate, "decision"> & {
  decision?: never;
};

export interface AutomationActionStep {
  id: string;
  actionId: string;
  manifestVersion?: string;
  input?: JsonValue;
  dependsOn?: string[];
  /**
   * ADVISORY ONLY: `when` is not evaluated by the control plane today —
   * steps are enqueued unconditionally and dispatch is gated solely on
   * `dependsOn` success. Pending runner support, do not rely on `when` for
   * conditional behavior; put conditions in the owning action's input
   * contract instead.
   */
  when?: JsonObject;
  approval?: ActionQueueApprovalRequirement;
  approvalGate?: AutomationApprovalGateTemplate;
  metadata?: JsonObject;
}

export interface AutomationSpec {
  schemaVersion: typeof AUTOMATION_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description?: string;
  status?: AutomationStatus;
  triggers: AutomationTrigger[];
  actions: AutomationActionStep[];
  concurrency?: {
    key?: string;
    limit?: number;
  };
  audit?: {
    eventSource?: string;
    evidenceRefs?: string[];
  };
  metadata?: JsonObject;
}

export interface AutomationRecord {
  id: string;
  spec: AutomationSpec;
  status: AutomationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  trigger: AutomationTrigger;
  triggerEventId?: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  metadata?: JsonObject;
}

export interface QueuedAction {
  id: string;
  automationRunId: string;
  stepId: string;
  actionId: string;
  idempotencyKey: string;
  status: QueueEntryStatus;
  invocation: ActionInvocation<JsonValue>;
  /** Distinguishable attempt identity: bounded retries advance this number. */
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
  /** The worker holding the exclusive lease, when the entry is leased. */
  leasedBy?: string;
  leasedAt?: string;
  leaseExpiresAt?: string;
  /**
   * Monotonic lease generation, incremented on every lease acquisition.
   * A lease holder presents the generation it observed at lease time as the
   * fencing token; a stale generation is rejected by the store.
   */
  leaseGeneration?: number;
  /** The fencing token of the current lease (equals `leaseGeneration`). */
  fencingToken?: number;
  approvalGate?: ActionQueueApprovalGate;
  result?: ActionResult;
  error?: ActionError;
  /** Dead-letter terminal receipt for entries settled as `dead`. */
  deadLetter?: ActionDeadLetter;
  metadata?: JsonObject;
}

export interface AutomationReplayRequest {
  id: string;
  sourceRunId: string;
  requestedAt: string;
  requestedBy?: string;
  mode: "failed-actions" | "dead-actions" | "entire-run";
  reason?: string;
  metadata?: JsonObject;
}

export interface AutomationsStatus {
  service: "automations";
  schemaVersion: typeof AUTOMATION_SCHEMA_VERSION;
  dataDir: string;
  dbPath: string;
  counts: {
    automations: number;
    runs: number;
    /** Total queue entries (admitted + leased + terminal). */
    queueDepth: number;
    /** Entries admitted and awaiting an exclusive lease. */
    admitted: number;
    /** Entries leased to a worker and in flight. */
    leased: number;
    /** Entries in a terminal state (succeeded/failed/dead/cancelled). */
    terminal: number;
    /** Dead-letter terminal entries awaiting replay. */
    deadLetter: number;
    replayRequests: number;
    webhookRoutes: number;
  };
  daemon: {
    leaseId?: string;
    pid?: number;
    hostname?: string;
    heartbeatAt?: string;
    expiresAt?: string;
    active: boolean;
    metadata?: JsonObject;
  };
}

export interface QueueLeaseOptions {
  runnerId: string;
  leaseMs?: number;
  now?: string | Date;
}

export interface ActionFailureOptions {
  actionId: string;
  runnerId: string;
  fencingToken?: number;
  error: ActionError;
  now?: string | Date;
  retryBackoffMs?: number;
}

export interface ActionLeaseRenewalOptions {
  actionId: string;
  runnerId: string;
  fencingToken: number;
  leaseMs?: number;
  now?: string | Date;
}

export interface ActionCompletionOptions {
  actionId: string;
  runnerId: string;
  result?: ActionResult;
  now?: string | Date;
}

export interface MaterializedEventRun {
  automation: AutomationRecord;
  run: AutomationRun;
  actions: QueuedAction[];
}

export interface AutomationRuntimeBinding {
  kind: "open-loops" | "local" | "external";
  name: string;
  description?: string;
  handoff: "lease-queue" | "webhook" | "sdk";
  metadata?: JsonObject;
}

/**
 * A typed action receipt is deliberately separate from the queue status.  A
 * delivery may have persisted some sink receipts while still requiring a
 * retry or operator attention; callers must not collapse that state into a
 * successful run.
 */
export type TypedActionReceiptStatus = "succeeded" | "partial" | "failed";

export interface TypedActionDeliveryReceipt {
  sink: string;
  status: "succeeded" | "failed";
  receipt?: JsonObject;
  error?: ActionError;
}

export interface TypedActionExecutionResult {
  status?: TypedActionReceiptStatus;
  summary?: string;
  output?: JsonValue;
  receipts?: TypedActionDeliveryReceipt[];
  metadata?: JsonObject;
  error?: ActionError;
}
