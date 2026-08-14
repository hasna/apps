import { createHash } from "node:crypto";
import type { ExecutorResult, Loop, StoredWorkflowEvent, WorkflowSpec, WorkflowStep } from "../types.js";
import { ValidationError } from "./errors.js";
import { workflowDefinitionHash } from "./workflow-provenance.js";

export const PRIVATE_OPERATION_EVENT_TYPES = [
  "private_operation_descriptor",
  "private_operation_admitted",
  "private_operation_terminal",
] as const;

export type PrivateOperationEventType = (typeof PRIVATE_OPERATION_EVENT_TYPES)[number];
export type OperationTerminalState = "succeeded" | "failed" | "timed_out" | "cancelled" | "skipped";

export interface OperationAuthorityBinding {
  authorityId: string;
  tenantId: string;
}

export interface PrivateOperationDescriptor {
  schema: "openloops.private_operation_descriptor.v1";
  operationId: string;
  operationTemplateId: string;
  workflowRunId: string;
  workflowId: string;
  workflowDefinitionHash: string;
  entityRevision: string;
  stepId: string;
  attempt: number;
  idempotencyKey: string;
  authority: OperationAuthorityBinding;
  descriptorRef: string;
  descriptorDigest: string;
}

export interface OperationAdmissionReceipt {
  schema: "openloops.operation_receipt.v1";
  receiptId: string;
  receiptKind: "admission";
  operationId: string;
  operationTemplateId: string;
  workflowRunId: string;
  stepId: string;
  authority: OperationAuthorityBinding;
  state: "admitted";
}

export interface OperationTerminalReceipt {
  schema: "openloops.operation_receipt.v1";
  receiptId: string;
  receiptKind: "terminal";
  operationId: string;
  operationTemplateId: string;
  workflowRunId: string;
  stepId: string;
  authority: OperationAuthorityBinding;
  state: OperationTerminalState;
  resultRef: string;
  outputRef?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface OperationReceiptLookupCaps {
  maxCalls: number;
  maxRecords: number;
  maxBytes: number;
  maxWallMs: number;
}

export interface OperationReceiptState {
  descriptor: PrivateOperationDescriptor;
  admission?: OperationAdmissionReceipt;
  terminal?: OperationTerminalReceipt;
}

export const DEFAULT_OPERATION_LOOKUP_CAPS: Readonly<OperationReceiptLookupCaps> = Object.freeze({
  maxCalls: 1,
  maxRecords: 512,
  maxBytes: 512 * 1024,
  maxWallMs: 100,
});

export type LoopMutationAction = "pause" | "resume" | "stop";
export type LoopMutationTerminalState = "succeeded" | "dry_run";

export interface LoopMutationEnvelope {
  schema: "openloops.loop_mutation.v1";
  operationId: string;
  stepId: string;
  targetId: string;
  action: LoopMutationAction;
  expectedRevision: string;
  approvedPlanDigest: string;
  manifestDigest: string;
  descriptorRef: string;
  descriptorDigest: string;
  dryRun?: boolean;
}

export interface LoopMutationBinding extends LoopMutationEnvelope {
  authority: OperationAuthorityBinding;
  bindingDigest: string;
  leaseId: string;
}

export interface PublicLoopMutationBinding extends Omit<LoopMutationBinding, "descriptorRef"> {
  descriptorCommitment: string;
}

export interface LoopMutationAdmissionReceipt {
  schema: "openloops.loop_mutation_receipt.v1";
  receiptId: string;
  receiptKind: "admission";
  operationId: string;
  stepId: string;
  targetId: string;
  action: LoopMutationAction;
  expectedRevision: string;
  authority: OperationAuthorityBinding;
  bindingDigest: string;
  descriptorCommitment: string;
  descriptorDigest: string;
  state: "admitted";
  createdAt: string;
}

export interface LoopMutationTerminalReceipt {
  schema: "openloops.loop_mutation_receipt.v1";
  receiptId: string;
  receiptKind: "terminal";
  operationId: string;
  stepId: string;
  targetId: string;
  action: LoopMutationAction;
  expectedRevision: string;
  authority: OperationAuthorityBinding;
  bindingDigest: string;
  state: LoopMutationTerminalState;
  resultRevision: string;
  resultStatus: Loop["status"];
  createdAt: string;
}

export interface LoopMutationResult {
  binding: LoopMutationBinding;
  admission: LoopMutationAdmissionReceipt;
  terminal: LoopMutationTerminalReceipt;
  loop: Loop;
  replayed: boolean;
}

export interface PublicLoopMutationResult extends Omit<LoopMutationResult, "binding"> {
  binding: PublicLoopMutationBinding;
}

export interface LoopMutationLookupCaps {
  maxCalls: number;
  maxRecords: number;
  maxBytes: number;
  maxWallMs: number;
}

export const DEFAULT_LOOP_MUTATION_LOOKUP_CAPS: Readonly<LoopMutationLookupCaps> = Object.freeze({
  maxCalls: 2,
  maxRecords: 2,
  maxBytes: 64 * 1024,
  maxWallMs: 250,
});

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function stableHash(namespace: string, value: unknown): string {
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
  return `${namespace}:sha256:${digest}`;
}

export function privateOperationDescriptorDigest(target: WorkflowStep["target"]): string {
  return stableHash("descriptor", target).replace("descriptor:", "");
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`invalid private operation ${field}`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ValidationError(`invalid private operation ${field}`);
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function authorityBinding(value: unknown): OperationAuthorityBinding {
  if (!isRecord(value)) throw new ValidationError("invalid private operation authority");
  return {
    authorityId: requiredText(value.authorityId, "authorityId"),
    tenantId: requiredText(value.tenantId, "tenantId"),
  };
}

function digest(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(text)) {
    throw new ValidationError(`invalid private operation ${field}`);
  }
  return text;
}

function loopId(value: unknown): string {
  const text = requiredText(value, "targetId");
  if (!/^[a-f0-9]{32}$/.test(text)) throw new ValidationError("loop mutation requires a full stable target id");
  return text;
}

const LOOP_MUTATION_DESCRIPTOR_REF_PREFIX = "owner-operation-target:";
const LOOP_MUTATION_DESCRIPTOR_ID_MAX_LENGTH = 96;

function loopMutationDescriptorRef(value: unknown): string {
  const text = requiredText(value, "descriptorRef");
  if (!text.startsWith(LOOP_MUTATION_DESCRIPTOR_REF_PREFIX)) {
    throw new ValidationError("invalid private operation descriptorRef");
  }
  const id = text.slice(LOOP_MUTATION_DESCRIPTOR_REF_PREFIX.length);
  if (
    id.length === 0 ||
    id.length > LOOP_MUTATION_DESCRIPTOR_ID_MAX_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ||
    /(?:^|[-_.])(?:bearer|token|secret|credential|api[-_]?key)(?:$|[-_.])/i.test(id) ||
    /^(?:gh[pousr]_|sk-(?:proj-)?|xox[a-z]-|(?:AKIA|ASIA)[A-Z0-9]|BEGIN[-_.]PRIVATE[-_.]KEY|PRIVATE[-_.]KEY)/i.test(id) ||
    /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(id)
  ) {
    throw new ValidationError("invalid private operation descriptorRef");
  }
  return text;
}

export function loopMutationDescriptorCommitment(descriptorRef: string): string {
  return stableHash("loop-mutation-descriptor-ref", descriptorRef);
}

export function isPrivateOperationEventType(value: string): value is PrivateOperationEventType {
  return PRIVATE_OPERATION_EVENT_TYPES.some((eventType) => eventType === value);
}

export function operationTemplateId(workflow: Pick<WorkflowSpec, "id" | "version">, step: Pick<WorkflowStep, "id">): string {
  return stableHash("op-template", {
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    stepId: step.id,
  });
}

export function loopOperationTemplateId(loop: { id: string; updatedAt: string }): string {
  return stableHash("op-template", { loopId: loop.id, entityRevision: loop.updatedAt });
}

export function createPrivateOperationDescriptor(input: {
  workflow: WorkflowSpec;
  workflowRunId: string;
  step: WorkflowStep;
  attempt?: number;
  idempotencyKey: string;
  authority: OperationAuthorityBinding;
}): PrivateOperationDescriptor {
  const definitionHash = workflowDefinitionHash(input.workflow);
  const descriptorBase = {
    operationTemplateId: operationTemplateId(input.workflow, input.step),
    workflowRunId: requiredText(input.workflowRunId, "workflowRunId"),
    workflowId: requiredText(input.workflow.id, "workflowId"),
    workflowDefinitionHash: definitionHash,
    entityRevision: requiredText(input.workflow.updatedAt, "entityRevision"),
    stepId: requiredText(input.step.id, "stepId"),
    attempt: positiveInteger(input.attempt ?? 1, "attempt"),
    idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
    authority: authorityBinding(input.authority),
    descriptorRef: `owner-operation-target:${requiredText(input.step.id, "stepId")}`,
    descriptorDigest: privateOperationDescriptorDigest(input.step.target),
  };
  return {
    schema: "openloops.private_operation_descriptor.v1",
    operationId: stableHash("operation", descriptorBase),
    ...descriptorBase,
  };
}

export function operationAdmissionReceipt(descriptor: PrivateOperationDescriptor): OperationAdmissionReceipt {
  return {
    schema: "openloops.operation_receipt.v1",
    receiptId: stableHash("operation-receipt", {
      operationId: descriptor.operationId,
      receiptKind: "admission",
    }),
    receiptKind: "admission",
    operationId: descriptor.operationId,
    operationTemplateId: descriptor.operationTemplateId,
    workflowRunId: descriptor.workflowRunId,
    stepId: descriptor.stepId,
    authority: descriptor.authority,
    state: "admitted",
  };
}

function operationResultReference(result: Pick<ExecutorResult, "status" | "exitCode" | "durationMs" | "stdout" | "stderr" | "error">): string {
  return stableHash("operation-result", {
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  });
}

export function operationTerminalReceipt(
  descriptor: PrivateOperationDescriptor,
  result: Pick<ExecutorResult, "status" | "exitCode" | "durationMs" | "stdout" | "stderr" | "error">,
): OperationTerminalReceipt {
  const resultRef = operationResultReference(result);
  const hasOutput = Boolean(result.stdout || result.stderr);
  return {
    schema: "openloops.operation_receipt.v1",
    receiptId: stableHash("operation-receipt", {
      operationId: descriptor.operationId,
      receiptKind: "terminal",
      state: result.status,
      resultRef,
    }),
    receiptKind: "terminal",
    operationId: descriptor.operationId,
    operationTemplateId: descriptor.operationTemplateId,
    workflowRunId: descriptor.workflowRunId,
    stepId: descriptor.stepId,
    authority: descriptor.authority,
    state: result.status,
    resultRef,
    ...(hasOutput ? { outputRef: stableHash("operation-output", { stdout: result.stdout, stderr: result.stderr }) } : {}),
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
  };
}

export function parsePrivateOperationDescriptor(value: unknown): PrivateOperationDescriptor {
  if (!isRecord(value) || value.schema !== "openloops.private_operation_descriptor.v1") {
    throw new ValidationError("invalid private operation descriptor");
  }
  const parsed: PrivateOperationDescriptor = {
    schema: "openloops.private_operation_descriptor.v1",
    operationId: requiredText(value.operationId, "operationId"),
    operationTemplateId: requiredText(value.operationTemplateId, "operationTemplateId"),
    workflowRunId: requiredText(value.workflowRunId, "workflowRunId"),
    workflowId: requiredText(value.workflowId, "workflowId"),
    workflowDefinitionHash: requiredText(value.workflowDefinitionHash, "workflowDefinitionHash"),
    entityRevision: requiredText(value.entityRevision, "entityRevision"),
    stepId: requiredText(value.stepId, "stepId"),
    attempt: positiveInteger(value.attempt, "attempt"),
    idempotencyKey: requiredText(value.idempotencyKey, "idempotencyKey"),
    authority: authorityBinding(value.authority),
    descriptorRef: requiredText(value.descriptorRef, "descriptorRef"),
    descriptorDigest: digest(value.descriptorDigest, "descriptorDigest"),
  };
  const expectedId = stableHash("operation", {
    operationTemplateId: parsed.operationTemplateId,
    workflowRunId: parsed.workflowRunId,
    workflowId: parsed.workflowId,
    workflowDefinitionHash: parsed.workflowDefinitionHash,
    entityRevision: parsed.entityRevision,
    stepId: parsed.stepId,
    attempt: parsed.attempt,
    idempotencyKey: parsed.idempotencyKey,
    authority: parsed.authority,
    descriptorRef: parsed.descriptorRef,
    descriptorDigest: parsed.descriptorDigest,
  });
  if (parsed.operationId !== expectedId) throw new ValidationError("private operation id mismatch");
  return parsed;
}

function parseOperationReceipt(value: unknown): OperationAdmissionReceipt | OperationTerminalReceipt {
  if (!isRecord(value) || value.schema !== "openloops.operation_receipt.v1") {
    throw new ValidationError("invalid operation receipt");
  }
  const common = {
    receiptId: requiredText(value.receiptId, "receiptId"),
    operationId: requiredText(value.operationId, "operationId"),
    operationTemplateId: requiredText(value.operationTemplateId, "operationTemplateId"),
    workflowRunId: requiredText(value.workflowRunId, "workflowRunId"),
    stepId: requiredText(value.stepId, "stepId"),
    authority: authorityBinding(value.authority),
  };
  if (value.receiptKind === "admission" && value.state === "admitted") {
    const receipt: OperationAdmissionReceipt = {
      schema: "openloops.operation_receipt.v1",
      receiptKind: "admission",
      state: "admitted",
      ...common,
    };
    const expected = operationAdmissionReceipt({
      schema: "openloops.private_operation_descriptor.v1",
      ...common,
      workflowId: "receipt-validation",
      workflowDefinitionHash: "receipt-validation",
      entityRevision: "receipt-validation",
      attempt: 1,
      idempotencyKey: "receipt-validation",
      descriptorRef: "owner-operation-target:receipt-validation",
      descriptorDigest: "0".repeat(64),
    }).receiptId;
    if (receipt.receiptId !== expected) throw new ValidationError("operation admission receipt id mismatch");
    return receipt;
  }
  if (
    value.receiptKind !== "terminal" ||
    !["succeeded", "failed", "timed_out", "cancelled", "skipped"].includes(String(value.state))
  ) {
    throw new ValidationError("invalid operation terminal receipt");
  }
  const resultRef = requiredText(value.resultRef, "resultRef");
  return {
    schema: "openloops.operation_receipt.v1",
    receiptKind: "terminal",
    state: value.state as OperationTerminalState,
    resultRef,
    ...common,
    ...(value.outputRef === undefined ? {} : { outputRef: requiredText(value.outputRef, "outputRef") }),
    ...(value.exitCode === undefined ? {} : { exitCode: Number(value.exitCode) }),
    ...(value.durationMs === undefined ? {} : { durationMs: Number(value.durationMs) }),
  };
}

export function parseOperationAdmissionReceipt(value: unknown): OperationAdmissionReceipt {
  const receipt = parseOperationReceipt(value);
  if (receipt.receiptKind !== "admission") throw new ValidationError("operation admission receipt required");
  return receipt;
}

export function parseOperationTerminalReceipt(value: unknown): OperationTerminalReceipt {
  const receipt = parseOperationReceipt(value);
  if (receipt.receiptKind !== "terminal") throw new ValidationError("operation terminal receipt required");
  return receipt;
}

export function lookupOperationReceiptState(
  events: readonly StoredWorkflowEvent[],
  query: {
    workflowRunId: string;
    stepId: string;
    authority: OperationAuthorityBinding;
    operationId?: string;
  },
  caps: OperationReceiptLookupCaps = DEFAULT_OPERATION_LOOKUP_CAPS,
): OperationReceiptState {
  const startedAt = Date.now();
  if (!Number.isInteger(caps.maxCalls) || caps.maxCalls < 1) {
    throw new ValidationError("operation receipt lookup call cap exceeded");
  }
  if (events.length > caps.maxRecords) throw new ValidationError("operation receipt lookup record cap exceeded");
  let bytes = 0;
  let descriptor: PrivateOperationDescriptor | undefined;
  let admission: OperationAdmissionReceipt | undefined;
  let terminal: OperationTerminalReceipt | undefined;
  for (const event of events) {
    if (Date.now() - startedAt > caps.maxWallMs) throw new ValidationError("operation receipt lookup wall-time cap exceeded");
    bytes += Buffer.byteLength(JSON.stringify(event));
    if (bytes > caps.maxBytes) throw new ValidationError("operation receipt lookup byte cap exceeded");
    if (!isPrivateOperationEventType(event.eventType) || event.stepId !== query.stepId) continue;
    if (event.workflowRunId !== query.workflowRunId) throw new ValidationError("operation receipt workflow scope mismatch");
    if (event.eventType === "private_operation_descriptor") {
      const candidate = parsePrivateOperationDescriptor(event.payload);
      if (descriptor) throw new ValidationError("duplicate private operation descriptor");
      descriptor = candidate;
      continue;
    }
    const receipt = parseOperationReceipt(event.payload);
    if (event.eventType === "private_operation_admitted") {
      if (receipt.receiptKind !== "admission") throw new ValidationError("operation admission event payload mismatch");
      if (admission) throw new ValidationError("duplicate operation admission receipt");
      admission = receipt;
      continue;
    }
    if (receipt.receiptKind !== "terminal") throw new ValidationError("operation terminal event payload mismatch");
    if (terminal) throw new ValidationError("duplicate operation terminal receipt");
    terminal = receipt;
  }
  if (!descriptor) throw new ValidationError("private operation descriptor missing");
  if (
    descriptor.authority.authorityId !== query.authority.authorityId ||
    descriptor.authority.tenantId !== query.authority.tenantId
  ) {
    throw new ValidationError("private operation authority mismatch");
  }
  if (query.operationId && descriptor.operationId !== query.operationId) {
    throw new ValidationError("private operation scope mismatch");
  }
  for (const receipt of [admission, terminal]) {
    if (!receipt) continue;
    if (
      receipt.operationId !== descriptor.operationId ||
      receipt.workflowRunId !== descriptor.workflowRunId ||
      receipt.stepId !== descriptor.stepId ||
      receipt.authority.authorityId !== descriptor.authority.authorityId ||
      receipt.authority.tenantId !== descriptor.authority.tenantId
    ) {
      throw new ValidationError("operation receipt binding mismatch");
    }
  }
  return { descriptor, admission, terminal };
}

export function normalizeLoopMutationEnvelope(
  value: unknown,
  authority: OperationAuthorityBinding,
): LoopMutationBinding {
  if (!isRecord(value) || value.schema !== "openloops.loop_mutation.v1") {
    throw new ValidationError("invalid loop mutation envelope");
  }
  const action = value.action;
  if (action !== "pause" && action !== "resume" && action !== "stop") {
    throw new ValidationError("invalid loop mutation action");
  }
  const normalized: LoopMutationEnvelope = {
    schema: "openloops.loop_mutation.v1",
    operationId: requiredText(value.operationId, "operationId"),
    stepId: requiredText(value.stepId, "stepId"),
    targetId: loopId(value.targetId),
    action,
    expectedRevision: requiredText(value.expectedRevision, "expectedRevision"),
    approvedPlanDigest: digest(value.approvedPlanDigest, "approvedPlanDigest"),
    manifestDigest: digest(value.manifestDigest, "manifestDigest"),
    descriptorRef: loopMutationDescriptorRef(value.descriptorRef),
    descriptorDigest: digest(value.descriptorDigest, "descriptorDigest"),
    ...(value.dryRun === true ? { dryRun: true } : {}),
  };
  const normalizedAuthority = authorityBinding(authority);
  const bindingDigest = stableHash("loop-mutation-binding", {
    ...normalized,
    dryRun: normalized.dryRun === true,
    authority: normalizedAuthority,
  });
  return {
    ...normalized,
    authority: normalizedAuthority,
    bindingDigest,
    leaseId: stableHash("loop-mutation-lease", {
      tenantId: normalizedAuthority.tenantId,
      targetId: normalized.targetId,
      operationId: normalized.operationId,
      stepId: normalized.stepId,
    }),
  };
}

export function loopMutationAdmissionReceipt(
  binding: LoopMutationBinding,
  createdAt: string,
): LoopMutationAdmissionReceipt {
  return {
    schema: "openloops.loop_mutation_receipt.v1",
    receiptId: stableHash("loop-mutation-receipt", {
      bindingDigest: binding.bindingDigest,
      receiptKind: "admission",
    }),
    receiptKind: "admission",
    operationId: binding.operationId,
    stepId: binding.stepId,
    targetId: binding.targetId,
    action: binding.action,
    expectedRevision: binding.expectedRevision,
    authority: binding.authority,
    bindingDigest: binding.bindingDigest,
    descriptorCommitment: loopMutationDescriptorCommitment(binding.descriptorRef),
    descriptorDigest: binding.descriptorDigest,
    state: "admitted",
    createdAt,
  };
}

export function publicLoopMutationResult(result: LoopMutationResult): PublicLoopMutationResult {
  const { descriptorRef, ...binding } = result.binding;
  return {
    binding: {
      ...binding,
      descriptorCommitment: loopMutationDescriptorCommitment(descriptorRef),
    },
    admission: result.admission,
    terminal: result.terminal,
    loop: result.loop,
    replayed: result.replayed,
  };
}

export function loopMutationTerminalReceipt(
  binding: LoopMutationBinding,
  loop: Loop,
  createdAt: string,
): LoopMutationTerminalReceipt {
  const state: LoopMutationTerminalState = binding.dryRun ? "dry_run" : "succeeded";
  return {
    schema: "openloops.loop_mutation_receipt.v1",
    receiptId: stableHash("loop-mutation-receipt", {
      bindingDigest: binding.bindingDigest,
      receiptKind: "terminal",
      state,
      resultRevision: loop.updatedAt,
      resultStatus: loop.status,
    }),
    receiptKind: "terminal",
    operationId: binding.operationId,
    stepId: binding.stepId,
    targetId: binding.targetId,
    action: binding.action,
    expectedRevision: binding.expectedRevision,
    authority: binding.authority,
    bindingDigest: binding.bindingDigest,
    state,
    resultRevision: loop.updatedAt,
    resultStatus: loop.status,
    createdAt,
  };
}

export function privateOperationEventsForWorkflowRun(input: {
  workflow: WorkflowSpec;
  workflowRunId: string;
  attempt?: number;
  idempotencyKey: string;
  authority: OperationAuthorityBinding;
}): Array<{ eventType: "private_operation_descriptor"; stepId: string; payload: Record<string, unknown> }> {
  return input.workflow.steps.map((step) => {
    const descriptor = createPrivateOperationDescriptor({ ...input, step });
    return {
      eventType: "private_operation_descriptor",
      stepId: step.id,
      payload: JSON.parse(JSON.stringify(descriptor)) as Record<string, unknown>,
    };
  });
}
