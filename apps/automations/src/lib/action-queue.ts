import type {
  ActionQueueApprovalDecision as PublishedActionQueueApprovalDecision,
  ActionQueueApprovalGate as PublishedActionQueueApprovalGate,
  ActionQueueApprovalRequirement as PublishedActionQueueApprovalRequirement,
  ActorRef,
  JsonObject,
} from "@hasna/actions";

/**
 * Queue-entry lifecycle vocabulary, aligned to the fleet daemon/queue taxonomy
 * (global-hasna-daemon-worker-taxonomy): every queue entry exposes explicit
 * `admitted`, `leased`, and terminal states.
 *
 * - `admitted` — the entry has been accepted into the queue and awaits an
 *   exclusive lease. Bounded retries re-admit the entry with a
 *   distinguishable attempt number; there is no separate "retrying" state.
 * - `waiting_approval` — the entry is gated on an approval decision before it
 *   can be leased (an admission gate, orthogonal to the lifecycle).
 * - `leased` — a worker holds the exclusive, renewable lease and is executing
 *   the attempt. The lease carries a generation and fencing token, heartbeat
 *   (renewal) and expiry; a stale generation is rejected.
 * - terminal states — `succeeded`, `failed`, `dead` (dead-letter terminal
 *   receipt), `cancelled`. Every terminal attempt leaves a durable terminal
 *   record (`result`, `error`, or dead-letter receipt) on the entry.
 */
export const QUEUE_ENTRY_STATUSES = [
  "admitted",
  "waiting_approval",
  "leased",
  "succeeded",
  "failed",
  "dead",
  "cancelled",
] as const;

export type QueueEntryStatus = (typeof QUEUE_ENTRY_STATUSES)[number];

export const QUEUE_ENTRY_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "dead",
  "cancelled",
] as const;

export type QueueEntryTerminalStatus = (typeof QUEUE_ENTRY_TERMINAL_STATUSES)[number];

export function assertQueueEntryStatus(status: string): QueueEntryStatus {
  if (!(QUEUE_ENTRY_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`unsupported queue entry status: ${status}`);
  }
  return status as QueueEntryStatus;
}

export function isTerminalQueueEntryStatus(status: QueueEntryStatus): boolean {
  return (QUEUE_ENTRY_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export type ActionQueueApprovalMode =
  | PublishedActionQueueApprovalRequirement["mode"]
  | "never"
  | "preview"
  | "step-up";

export interface ActionQueueApprovalRequirement extends Omit<PublishedActionQueueApprovalRequirement, "mode"> {
  mode: ActionQueueApprovalMode;
}

export type ActionQueueApprovalActor = ActorRef | {
  id: string;
  type: "user" | "human" | "agent" | "service" | "system";
  displayName?: string;
  tenantId?: string;
  metadata?: JsonObject;
};

export type ActionQueueApprovalDecisionStatus =
  | PublishedActionQueueApprovalDecision["status"]
  | "expired"
  | "cancelled";

export interface ActionQueueApprovalDecision extends Omit<PublishedActionQueueApprovalDecision, "status"> {
  status: ActionQueueApprovalDecisionStatus;
  requestedBy?: ActionQueueApprovalActor;
  decidedBy?: ActionQueueApprovalActor;
  evidenceRef?: string;
}

export interface ActionQueueApprovalGate extends Omit<PublishedActionQueueApprovalGate, "requirement" | "decision"> {
  requirement: ActionQueueApprovalRequirement;
  decision?: ActionQueueApprovalDecision;
}
