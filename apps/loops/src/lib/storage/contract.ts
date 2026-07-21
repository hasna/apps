import type { Store } from "../store.js";

export type LoopStorageBackend = "sqlite" | "postgres";

export type LoopStorageMethodName =
  | "createLoop"
  | "getLoop"
  | "findLoopByName"
  | "requireLoop"
  | "requireUniqueLoop"
  | "listLoops"
  | "dueLoops"
  | "updateLoop"
  | "advanceLoopIfCurrent"
  | "tripCircuitBreakerIfCurrent"
  | "renameLoop"
  | "archiveLoop"
  | "unarchiveLoop"
  | "deleteLoop"
  | "upsertMigrationLoop"
  | "upsertMigrationRun"
  | "upsertMigrationWorkflow"
  | "createWorkflow"
  | "getWorkflow"
  | "requireWorkflow"
  | "listWorkflows"
  | "countWorkflows"
  | "archiveWorkflow"
  | "createWorkflowInvocation"
  | "getWorkflowInvocation"
  | "listWorkflowInvocations"
  | "upsertWorkflowWorkItem"
  | "getWorkflowWorkItem"
  | "listWorkflowWorkItems"
  | "countActiveWorkflowWorkItems"
  | "admitWorkflowWorkItem"
  | "createGoal"
  | "getGoal"
  | "requireGoal"
  | "findGoalByContext"
  | "listGoals"
  | "createGoalPlanNodes"
  | "listGoalPlanNodes"
  | "updateGoalStatus"
  | "updateGoalPlanNode"
  | "recordGoalEvent"
  | "listGoalRuns"
  | "createWorkflowRun"
  | "getWorkflowRun"
  | "requireWorkflowRun"
  | "listWorkflowRuns"
  | "listWorkflowStepRuns"
  | "getWorkflowStepRun"
  | "isWorkflowRunTerminal"
  | "startWorkflowStepRun"
  | "markWorkflowStepPid"
  | "recordWorkflowStepProgress"
  | "recoverWorkflowRun"
  | "finalizeWorkflowStepRun"
  | "skipWorkflowStepRun"
  | "finalizeWorkflowRun"
  | "appendWorkflowEvent"
  | "listWorkflowEvents"
  | "recordRunProcess"
  | "createSkippedRun"
  | "getRun"
  | "getRunBySlot"
  | "nextRetryableRun"
  | "claimRun"
  | "finalizeRun"
  | "heartbeatRunLease"
  | "listRuns"
  | "writeRunReceipt"
  | "getRunReceipt"
  | "listRunReceipts"
  | "recoverExpiredRunLeases"
  | "recoverExpiredRunLeasesDetailed"
  | "countLoops"
  | "countRuns"
  | "pruneHistory"
  | "acquireDaemonLease"
  | "heartbeatDaemonLease"
  | "releaseDaemonLease"
  | "getDaemonLease";

type AsyncStoreMethod<K extends LoopStorageMethodName> = Store[K] extends (...args: infer Args) => infer Result
  ? (...args: Args) => Promise<Result>
  : never;

export interface LoopStorageContract extends Record<LoopStorageMethodName, (...args: never[]) => Promise<unknown>> {
  readonly backend: LoopStorageBackend;
  readonly supportsRemoteRunners: boolean;
  close(): Promise<void>;

  createLoop: AsyncStoreMethod<"createLoop">;
  getLoop: AsyncStoreMethod<"getLoop">;
  findLoopByName: AsyncStoreMethod<"findLoopByName">;
  requireLoop: AsyncStoreMethod<"requireLoop">;
  requireUniqueLoop: AsyncStoreMethod<"requireUniqueLoop">;
  listLoops: AsyncStoreMethod<"listLoops">;
  dueLoops: AsyncStoreMethod<"dueLoops">;
  updateLoop: AsyncStoreMethod<"updateLoop">;
  advanceLoopIfCurrent: AsyncStoreMethod<"advanceLoopIfCurrent">;
  tripCircuitBreakerIfCurrent: AsyncStoreMethod<"tripCircuitBreakerIfCurrent">;
  renameLoop: AsyncStoreMethod<"renameLoop">;
  archiveLoop: AsyncStoreMethod<"archiveLoop">;
  unarchiveLoop: AsyncStoreMethod<"unarchiveLoop">;
  deleteLoop: AsyncStoreMethod<"deleteLoop">;
  upsertMigrationLoop: AsyncStoreMethod<"upsertMigrationLoop">;
  upsertMigrationRun: AsyncStoreMethod<"upsertMigrationRun">;
  upsertMigrationWorkflow: AsyncStoreMethod<"upsertMigrationWorkflow">;
  createWorkflow: AsyncStoreMethod<"createWorkflow">;
  getWorkflow: AsyncStoreMethod<"getWorkflow">;
  requireWorkflow: AsyncStoreMethod<"requireWorkflow">;
  listWorkflows: AsyncStoreMethod<"listWorkflows">;
  countWorkflows: AsyncStoreMethod<"countWorkflows">;
  archiveWorkflow: AsyncStoreMethod<"archiveWorkflow">;
  createWorkflowInvocation: AsyncStoreMethod<"createWorkflowInvocation">;
  getWorkflowInvocation: AsyncStoreMethod<"getWorkflowInvocation">;
  listWorkflowInvocations: AsyncStoreMethod<"listWorkflowInvocations">;
  upsertWorkflowWorkItem: AsyncStoreMethod<"upsertWorkflowWorkItem">;
  getWorkflowWorkItem: AsyncStoreMethod<"getWorkflowWorkItem">;
  listWorkflowWorkItems: AsyncStoreMethod<"listWorkflowWorkItems">;
  countActiveWorkflowWorkItems: AsyncStoreMethod<"countActiveWorkflowWorkItems">;
  admitWorkflowWorkItem: AsyncStoreMethod<"admitWorkflowWorkItem">;
  createGoal: AsyncStoreMethod<"createGoal">;
  getGoal: AsyncStoreMethod<"getGoal">;
  requireGoal: AsyncStoreMethod<"requireGoal">;
  findGoalByContext: AsyncStoreMethod<"findGoalByContext">;
  listGoals: AsyncStoreMethod<"listGoals">;
  createGoalPlanNodes: AsyncStoreMethod<"createGoalPlanNodes">;
  listGoalPlanNodes: AsyncStoreMethod<"listGoalPlanNodes">;
  updateGoalStatus: AsyncStoreMethod<"updateGoalStatus">;
  updateGoalPlanNode: AsyncStoreMethod<"updateGoalPlanNode">;
  recordGoalEvent: AsyncStoreMethod<"recordGoalEvent">;
  listGoalRuns: AsyncStoreMethod<"listGoalRuns">;
  createWorkflowRun: AsyncStoreMethod<"createWorkflowRun">;
  getWorkflowRun: AsyncStoreMethod<"getWorkflowRun">;
  requireWorkflowRun: AsyncStoreMethod<"requireWorkflowRun">;
  listWorkflowRuns: AsyncStoreMethod<"listWorkflowRuns">;
  listWorkflowStepRuns: AsyncStoreMethod<"listWorkflowStepRuns">;
  getWorkflowStepRun: AsyncStoreMethod<"getWorkflowStepRun">;
  isWorkflowRunTerminal: AsyncStoreMethod<"isWorkflowRunTerminal">;
  startWorkflowStepRun: AsyncStoreMethod<"startWorkflowStepRun">;
  markWorkflowStepPid: AsyncStoreMethod<"markWorkflowStepPid">;
  recordWorkflowStepProgress: AsyncStoreMethod<"recordWorkflowStepProgress">;
  recoverWorkflowRun: AsyncStoreMethod<"recoverWorkflowRun">;
  finalizeWorkflowStepRun: AsyncStoreMethod<"finalizeWorkflowStepRun">;
  skipWorkflowStepRun: AsyncStoreMethod<"skipWorkflowStepRun">;
  finalizeWorkflowRun: AsyncStoreMethod<"finalizeWorkflowRun">;
  appendWorkflowEvent: AsyncStoreMethod<"appendWorkflowEvent">;
  listWorkflowEvents: AsyncStoreMethod<"listWorkflowEvents">;
  recordRunProcess: AsyncStoreMethod<"recordRunProcess">;
  createSkippedRun: AsyncStoreMethod<"createSkippedRun">;
  getRun: AsyncStoreMethod<"getRun">;
  getRunBySlot: AsyncStoreMethod<"getRunBySlot">;
  nextRetryableRun: AsyncStoreMethod<"nextRetryableRun">;
  claimRun: AsyncStoreMethod<"claimRun">;
  finalizeRun: AsyncStoreMethod<"finalizeRun">;
  heartbeatRunLease: AsyncStoreMethod<"heartbeatRunLease">;
  listRuns: AsyncStoreMethod<"listRuns">;
  writeRunReceipt: AsyncStoreMethod<"writeRunReceipt">;
  getRunReceipt: AsyncStoreMethod<"getRunReceipt">;
  listRunReceipts: AsyncStoreMethod<"listRunReceipts">;
  recoverExpiredRunLeases: AsyncStoreMethod<"recoverExpiredRunLeases">;
  recoverExpiredRunLeasesDetailed: AsyncStoreMethod<"recoverExpiredRunLeasesDetailed">;
  countLoops: AsyncStoreMethod<"countLoops">;
  countRuns: AsyncStoreMethod<"countRuns">;
  pruneHistory: AsyncStoreMethod<"pruneHistory">;
  acquireDaemonLease: AsyncStoreMethod<"acquireDaemonLease">;
  heartbeatDaemonLease: AsyncStoreMethod<"heartbeatDaemonLease">;
  releaseDaemonLease: AsyncStoreMethod<"releaseDaemonLease">;
  getDaemonLease: AsyncStoreMethod<"getDaemonLease">;
}

export interface StorageMigration {
  readonly id: string;
  readonly checksum: string;
  readonly sql: string;
}

export interface AppliedStorageMigration {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface StorageMigrationPlanItem {
  readonly migration: StorageMigration;
  readonly state: "already_applied" | "pending";
}

export interface StorageMigrationResult {
  readonly backend: LoopStorageBackend;
  readonly dryRun: boolean;
  readonly applied: AppliedStorageMigration[];
  readonly plan: StorageMigrationPlanItem[];
}

export interface SchemaMigrationStorage {
  readonly backend: LoopStorageBackend;
  readonly migrations: readonly StorageMigration[];
  listAppliedMigrations(): Promise<AppliedStorageMigration[]>;
  migrate(opts?: { dryRun?: boolean; through?: string }): Promise<StorageMigrationResult>;
  close(): Promise<void>;
}

export type RunnerMachineStatus = "active" | "draining" | "offline";
export type RunnerLeaseStatus = "active" | "released" | "expired" | "stolen";

export interface RunnerMachineRecord {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  capabilities: Record<string, unknown>;
  status: RunnerMachineStatus;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunnerLeaseRecord {
  id: string;
  runnerId: string;
  loopRunId?: string;
  workflowRunId?: string;
  claimToken: string;
  status: RunnerLeaseStatus;
  heartbeatAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEventRecord {
  id: string;
  actor: string;
  action: string;
  subjectType: string;
  subjectId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
