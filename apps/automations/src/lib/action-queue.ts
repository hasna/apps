import {
  assertActionQueueStatus as assertPublishedActionQueueStatus,
  isTerminalActionQueueStatus as isPublishedTerminalActionQueueStatus,
} from "@hasna/actions";
import type {
  ActionQueueApprovalDecision as PublishedActionQueueApprovalDecision,
  ActionQueueApprovalGate as PublishedActionQueueApprovalGate,
  ActionQueueApprovalRequirement as PublishedActionQueueApprovalRequirement,
  ActionQueueStatus,
  ActorRef,
  JsonObject,
} from "@hasna/actions";

export type { ActionQueueStatus };

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

export function assertActionQueueStatus(status: string): ActionQueueStatus {
  return assertPublishedActionQueueStatus(status);
}

export function isTerminalActionQueueStatus(status: ActionQueueStatus): boolean {
  return isPublishedTerminalActionQueueStatus(status);
}
