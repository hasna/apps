export type ExecutionLane = "LOCAL_FOCUSED" | "CLOUD_FULL" | "LOCAL_DIAGNOSTIC" | "UNCLASSIFIED";
export type ResourceBudget = {
  memoryHighBytes: number;
  memoryMaxBytes: number;
  swapMaxBytes: number;
  pidsMax: number;
  wallTimeMs: number;
};
export interface AggregateControllerReceipt {
  schema: "hasna.test_guard.aggregate_controller_receipt.v1";
  receiptId: string;
  unit: "hasna-tests.slice";
  controlGroup: string;
  loadState: "loaded";
  activeState: "active";
  memoryAccounting: true;
  memoryMaxBytes: number;
  memorySwapMaxBytes: 0;
  tasksMax: number;
  verifiedAtUnixMs: number;
}
export interface ResolvedExecutionDescendant {
  descendantId: string;
  packageId: string;
  targetIds: string[];
  resolved: boolean;
}
export interface ParentAllocationEvidence {
  admissionReceiptId: string;
  allocationId: string;
  leaseId: string;
  cgroupId: string;
}
export interface ResolvedExecutionPlan {
  schema: "hasna.test_guard.execution_plan.v1";
  planId: string;
  intent: "execute" | "diagnostic";
  runner: string;
  invocation: { executable: string; argv: string[] };
  maySpawn: boolean;
  packages: string[];
  targetIds: string[];
  selector: "explicit" | "omitted" | "dynamic";
  packageWide: boolean;
  workspaceWide: boolean;
  recursive: boolean;
  localCi: boolean;
  lifecycleHooks: string[];
  dynamicDiscovery: boolean;
  fanout: number;
  descendants: ResolvedExecutionDescendant[];
  limits: ResourceBudget;
  parent?: ParentAllocationEvidence;
}
export interface LocalAllocationEvidence {
  allocationId: string;
  leaseId: string;
  cgroupId: string;
  leafScopeUnit: string;
  aggregateController: AggregateControllerReceipt;
}
export interface AdmissionContext {
  allocation?: LocalAllocationEvidence;
  parentAdmission?: AdmissionReceipt;
  aggregateController?: AggregateControllerReceipt;
  currentCgroupPath?: string;
}
export interface ClassificationReceipt {
  schema: "hasna.test_guard.classification_receipt.v1";
  receiptId: string;
  planDigest: string;
  lane: ExecutionLane;
  reasons: string[];
}
export interface ParentChildReceipt {
  schema: "hasna.test_guard.parent_child_receipt.v1";
  receiptId: string;
  relation: "NARROWED_IN_PARENT";
  parentAdmissionReceiptId: string;
  childPlanDigest: string;
  allocationId: string;
  leaseId: string;
  cgroupId: string;
  budgetBefore: ResourceBudget;
  budgetConsumed: ResourceBudget;
  budgetAfter: ResourceBudget;
}
export interface AdmissionReceipt {
  schema: "hasna.test_guard.admission_receipt.v1";
  receiptId: string;
  planId: string;
  planDigest: string;
  classificationReceiptId: string;
  lane: ExecutionLane;
  decision: "ADMIT" | "REFUSE";
  reasonCodes: string[];
  allocationId: string | null;
  leaseId: string | null;
  cgroupId: string | null;
  acquiredLocalAllocation: boolean;
  remainingBudget: ResourceBudget;
  parentAdmissionReceiptId: string | null;
  parentChildReceiptId: string | null;
  aggregateControllerReceiptId: string | null;
  aggregateUnit: string | null;
  aggregateControlGroup: string | null;
  parentChildReceipt: ParentChildReceipt | null;
  packages: string[];
  targetIds: string[];
}
export interface TerminalObservation {
  directExitCode: number;
  activeState: string | null;
  subState: string | null;
  controlGroup: string | null;
  cgroupPopulated: boolean | null;
}
export interface TerminalReceipt {
  schema: "hasna.test_guard.terminal_receipt.v1";
  receiptId: string;
  admissionReceiptId: string;
  allocationId: string | null;
  leaseId: string | null;
  cgroupId: string | null;
  directExitCode: number | null;
  activeState: string | null;
  subState: string | null;
  controlGroup: string | null;
  cgroupPopulated: boolean | null;
  outcome: "AMBIGUOUS" | "TERMINAL_EMPTY" | "DESCENDANTS_REMAIN";
  releaseAllocation: boolean;
  reasonCode: string | null;
}
export function parseResolvedExecutionPlan(value: unknown): ResolvedExecutionPlan;
export const AGGREGATE_TEST_SLICE: "hasna-tests.slice";
export function verifyAggregateControllerObservation(
  observation: string,
  options?: { expectedUnit?: string; expectedControlGroup?: string; verifiedAtUnixMs?: number },
): AggregateControllerReceipt;
export function classifyResolvedExecutionPlan(value: unknown): ClassificationReceipt;
export function admitResolvedExecutionPlan(value: unknown, context?: AdmissionContext): AdmissionReceipt;
export function executeAdmittedPlan<T>(
  value: unknown,
  context: AdmissionContext,
  spawn: (admission: AdmissionReceipt) => T | Promise<T>,
): Promise<{ admission: AdmissionReceipt; spawned: boolean; result: T | null }>;
export function createTerminalReceipt(admission: AdmissionReceipt, observation: TerminalObservation): TerminalReceipt;
export function resolveWrapperInvocation(
  argv: string[],
  options?: { packageId?: string; limits?: ResourceBudget; localCi?: boolean; resolvedPlan?: unknown },
): { kind: "PASS_THROUGH" } | { kind: "PLAN" | "REFUSE"; plan: ResolvedExecutionPlan };
