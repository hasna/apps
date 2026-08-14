import { createHash } from "node:crypto";
import {
  parseContract,
  SCHEMA_IDS,
  type ActorPointer,
  type ContractStatus,
  type DecisionEnvelope,
  type DecisionStatus,
  type EvidenceKind,
  type EvidencePointer,
  type EvidenceRef,
  type ResourcePointer,
  type WorkRun,
} from "@hasna/contracts";
import type {
  AutomationRun,
  AutomationRunStatus,
  QueuedAction,
} from "../types.js";
import type {
  ActionQueueApprovalDecision as ApprovalDecision,
  ActionQueueApprovalGate as ApprovalGate,
} from "./action-queue.js";

const SOURCE_PACKAGE = "@hasna/automations";

const AUTOMATIONS_ACTOR: ActorPointer = {
  kind: "service",
  id: "service_hasna_automations",
  name: SOURCE_PACKAGE,
};

const CONTRACT_URI_PREFIXES = [
  "artifact://",
  "repo://",
  "project://",
  "dashboard://",
  "render://",
  "integration://",
  "task://",
  "todo://",
  "file://",
  "files://",
  "mailery://",
  "conversation://",
  "knowledge://",
  "memento://",
  "https://",
  "http://",
  "git+https://",
] as const;

// ContractStatus intentionally has a smaller vocabulary than AutomationRunStatus.
// Boundary mapping:
// pending -> pending
// materialized -> pending, preserving metadata.originalStatus
// running -> running
// succeeded -> succeeded
// failed -> failed
// cancelled -> cancelled
// dead -> failed, preserving metadata.originalStatus
export const AUTOMATION_RUN_STATUS_TO_CONTRACT_STATUS = {
  pending: "pending",
  materialized: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  dead: "failed",
} as const satisfies Record<AutomationRunStatus, ContractStatus>;

export interface AutomationRunContractOptions {
  actor?: ActorPointer;
  objective?: string;
  decisions?: DecisionEnvelope[];
  evidenceRefs?: EvidencePointer[];
  resourceRefs?: ResourcePointer[];
  metadata?: Record<string, unknown>;
}

export interface ApprovalDecisionContractOptions {
  action?: QueuedAction;
  actor?: ActorPointer;
  gate?: ApprovalGate;
  resourceRefs?: ResourcePointer[];
  metadata?: Record<string, unknown>;
}

export interface EvidenceRefContractOptions {
  id?: string;
  createdAt?: string | Date;
  kind?: EvidenceKind;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export function automationRunStatusToContractStatus(status: AutomationRunStatus): ContractStatus {
  return AUTOMATION_RUN_STATUS_TO_CONTRACT_STATUS[status];
}

export function automationRunToWorkRun(run: AutomationRun, options: AutomationRunContractOptions = {}): WorkRun {
  const status = automationRunStatusToContractStatus(run.status);
  const finishedAt = terminalContractStatus(status) ? run.completedAt ?? run.updatedAt : run.completedAt;
  const evidenceRefs = mergeEvidencePointers([
    runReceiptEvidencePointer(run),
    ...evidencePointersFromRunMetadata(run),
    ...errorEvidencePointers(run),
    ...(options.evidenceRefs ?? []),
  ]);

  const draft = {
    schema: SCHEMA_IDS.workRun,
    id: contractId("automation_run", run.id),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    objective: options.objective ?? `Automation run ${run.id} for ${run.automationId}`,
    status,
    actor: options.actor ?? AUTOMATIONS_ACTOR,
    traceId: run.idempotencyKey ?? run.id,
    startedAt: run.startedAt,
    finishedAt,
    resourceRefs: [
      automationRunResourcePointer(run),
      automationResourcePointer(run.automationId),
      ...triggerResourcePointers(run),
      ...(options.resourceRefs ?? []),
    ],
    decisions: options.decisions ?? [],
    evidenceRefs,
    metadata: pruneUndefined({
      sourcePackage: SOURCE_PACKAGE,
      originalStatus: run.status,
      statusMapping: AUTOMATION_RUN_STATUS_TO_CONTRACT_STATUS,
      automationId: run.automationId,
      triggerKind: run.trigger.kind,
      triggerEventId: run.triggerEventId,
      idempotencyKey: run.idempotencyKey,
      automationMetadata: run.metadata,
      ...options.metadata,
    }),
  };

  return parseContract(SCHEMA_IDS.workRun, draft);
}

export function queuedActionDecisionEnvelopes(actions: QueuedAction[], options: Omit<ApprovalDecisionContractOptions, "action" | "gate"> = {}): DecisionEnvelope[] {
  return actions
    .map((action) => action.approvalGate?.decision
      ? approvalDecisionToDecisionEnvelope(action.approvalGate.decision, {
        ...options,
        action,
        gate: action.approvalGate,
      })
      : undefined)
    .filter((decision): decision is DecisionEnvelope => decision !== undefined);
}

export function approvalDecisionToDecisionEnvelope(
  decision: ApprovalDecision,
  options: ApprovalDecisionContractOptions = {},
): DecisionEnvelope {
  const evidenceRefs = decision.evidenceRef
    ? [evidencePointerFromString(decision.evidenceRef, { summary: "Approval decision evidence" })]
    : [];
  const actionRef = options.action ? actionResourcePointer(options.action) : undefined;
  const status = approvalDecisionStatusToContractStatus(decision.status, actionRef !== undefined);
  const obligations = approvalDecisionObligations(status, decision, options.gate);
  const actor = approvalDecisionActor(decision, options.actor);

  const draft = {
    schema: SCHEMA_IDS.decisionEnvelope,
    id: contractId("approval_decision", decision.id),
    createdAt: decision.requestedAt,
    updatedAt: decision.decidedAt,
    decisionType: "approval" as const,
    status,
    actor,
    traceId: options.action?.automationRunId,
    selected: status === "allowed" && actionRef ? [actionRef] : [],
    skipped: status === "skipped" && actionRef ? [actionRef] : [],
    reason: decision.reason ?? defaultApprovalDecisionReason(decision.status, options.gate),
    obligations,
    evidenceRefs,
    metadata: pruneUndefined({
      sourcePackage: SOURCE_PACKAGE,
      resourceRefs: options.resourceRefs,
      originalApprovalStatus: decision.status,
      approvalMode: options.gate?.requirement.mode,
      requiresApproval: options.gate?.requirement.requiresApproval,
      blockedUntilApproved: options.gate?.blockedUntilApproved,
      actionId: options.action?.actionId,
      stepId: options.action?.stepId,
      requestedBy: decision.requestedBy,
      decisionMetadata: decision.metadata,
      ...options.metadata,
    }),
  };

  return parseContract(SCHEMA_IDS.decisionEnvelope, draft);
}

export function evidenceRefFromString(ref: string, options: EvidenceRefContractOptions = {}): EvidenceRef {
  const createdAt = normalizeTimestamp(options.createdAt);
  const draft = {
    schema: SCHEMA_IDS.evidenceRef,
    id: options.id ?? contractId("evidence", ref),
    createdAt,
    kind: options.kind ?? evidenceKindFromRef(ref),
    uri: contractEvidenceUri(ref),
    summary: options.summary ?? "Automation evidence reference",
    redaction: "unknown" as const,
    tags: ["automations"],
    metadata: pruneUndefined({
      sourcePackage: SOURCE_PACKAGE,
      originalRefStored: isContractUri(ref),
      ...options.metadata,
    }),
  };

  return parseContract(SCHEMA_IDS.evidenceRef, draft);
}

export function evidencePointerFromString(ref: string, options: { kind?: EvidenceKind; summary?: string } = {}): EvidencePointer {
  return {
    id: contractId("evidence", ref),
    kind: options.kind ?? evidenceKindFromRef(ref),
    uri: contractEvidenceUri(ref),
    summary: options.summary,
  };
}

function approvalDecisionStatusToContractStatus(status: ApprovalDecision["status"], hasActionRef: boolean): DecisionStatus {
  switch (status) {
    case "approved":
      return "allowed";
    case "rejected":
    case "expired":
      return "denied";
    case "cancelled":
      return hasActionRef ? "skipped" : "unknown";
    case "pending":
      return "approval_required";
    default:
      return "unknown";
  }
}

function approvalDecisionObligations(status: DecisionStatus, decision: ApprovalDecision, gate: ApprovalGate | undefined): string[] {
  if (status === "approval_required") return [`approval required: ${gate?.requirement.mode ?? "manual"}`];
  if (status === "denied") return [decision.reason ?? `approval ${decision.status}`];
  return [];
}

function defaultApprovalDecisionReason(status: ApprovalDecision["status"], gate: ApprovalGate | undefined): string {
  if (status === "pending") return gate?.requirement.reason ?? "Approval is required before this action can run.";
  if (status === "approved") return "Approval granted.";
  if (status === "rejected") return "Approval rejected.";
  if (status === "expired") return "Approval expired.";
  if (status === "cancelled") return "Approval cancelled.";
  return "Approval decision recorded.";
}

function approvalDecisionActor(decision: ApprovalDecision, fallback: ActorPointer | undefined): ActorPointer {
  if (decision.decidedBy) return actionActorToContractActor(decision.decidedBy) ?? fallback ?? AUTOMATIONS_ACTOR;
  return actorPointerFromMetadata(decision.metadata?.decidedBy) ?? fallback ?? AUTOMATIONS_ACTOR;
}

function actionActorToContractActor(actor: ApprovalDecision["decidedBy"]): ActorPointer | undefined {
  if (!actor) return undefined;
  return pruneUndefined({
    kind: actor.type === "user" ? "human" : actor.type,
    id: actor.id,
    name: actor.displayName,
  }) as ActorPointer;
}

function actorPointerFromMetadata(value: unknown): ActorPointer | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id) return undefined;
  return {
    kind: actorKindFromString(id),
    id,
    name: id,
  };
}

function actorKindFromString(value: string): ActorPointer["kind"] {
  if (value.startsWith("agent:")) return "agent";
  if (value.startsWith("service:") || value.startsWith("cli:")) return "service";
  if (value.startsWith("system:")) return "system";
  return "human";
}

function runReceiptEvidencePointer(run: AutomationRun): EvidencePointer {
  return {
    id: contractId("automation_run_receipt", run.id),
    kind: "artifact",
    uri: `artifact://automations/runs/${encodeURIComponent(run.id)}`,
    summary: `Automation run receipt for ${run.id}`,
  };
}

function evidencePointersFromRunMetadata(run: AutomationRun): EvidencePointer[] {
  const refs = run.metadata?.evidenceRefs;
  if (!Array.isArray(refs)) return [];
  return refs
    .filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
    .map((ref) => evidencePointerFromString(ref));
}

function errorEvidencePointers(run: AutomationRun): EvidencePointer[] {
  if (!run.error) return [];
  return [{
    id: contractId("automation_run_error", run.id),
    kind: "log",
    uri: `artifact://automations/runs/${encodeURIComponent(run.id)}/error`,
    summary: run.error,
  }];
}

function automationRunResourcePointer(run: AutomationRun): ResourcePointer {
  return {
    kind: "run",
    id: run.id,
    name: `Automation run ${run.id}`,
    uri: `artifact://automations/runs/${encodeURIComponent(run.id)}`,
    externalId: run.id,
    sourcePackage: SOURCE_PACKAGE,
    tags: [],
  };
}

function automationResourcePointer(automationId: string): ResourcePointer {
  return {
    kind: "workflow",
    id: automationId,
    name: automationId,
    uri: `artifact://automations/specs/${encodeURIComponent(automationId)}`,
    externalId: automationId,
    sourcePackage: SOURCE_PACKAGE,
    tags: [],
  };
}

function triggerResourcePointers(run: AutomationRun): ResourcePointer[] {
  if (!run.triggerEventId) return [];
  return [{
    kind: "event",
    id: run.triggerEventId,
    name: run.trigger.type ?? run.triggerEventId,
    externalId: run.triggerEventId,
    sourcePackage: SOURCE_PACKAGE,
    tags: [run.trigger.kind],
  }];
}

function actionResourcePointer(action: QueuedAction): ResourcePointer {
  return {
    kind: "action",
    id: action.id,
    name: action.actionId,
    uri: `artifact://automations/actions/${encodeURIComponent(action.id)}`,
    externalId: action.actionId,
    sourcePackage: SOURCE_PACKAGE,
    tags: [action.status, action.stepId],
  };
}

function mergeEvidencePointers(pointers: EvidencePointer[]): EvidencePointer[] {
  const seen = new Set<string>();
  const merged: EvidencePointer[] = [];
  for (const pointer of pointers) {
    if (seen.has(pointer.id)) continue;
    seen.add(pointer.id);
    merged.push(pointer);
  }
  return merged;
}

function contractEvidenceUri(ref: string): string {
  if (isContractUri(ref)) return ref;
  return `artifact://automations/evidence/${sha256(ref)}`;
}

function isContractUri(ref: string): boolean {
  return CONTRACT_URI_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

function evidenceKindFromRef(ref: string): EvidenceKind {
  if (ref.startsWith("http://") || ref.startsWith("https://")) return "url";
  if (ref.startsWith("file://") || ref.startsWith("files://")) return "file";
  if (ref.startsWith("repo://")) return "diff";
  if (ref.startsWith("artifact://")) return "artifact";
  return "other";
}

function terminalContractStatus(status: ContractStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "blocked" || status === "skipped";
}

function contractId(prefix: string, value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized ? `${prefix}_${normalized}` : `${prefix}_${sha256(value).slice(0, 16)}`;
}

function normalizeTimestamp(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  return value ?? new Date().toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
