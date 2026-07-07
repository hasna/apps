import { Store } from "../store.js";
import type { LoopStorageContract, LoopStorageMethodName } from "./contract.js";

type StoreMethod<K extends LoopStorageMethodName> = Store[K] extends (...args: infer Args) => infer Result
  ? { args: Args; result: Result }
  : never;

export class SqliteLoopStorage implements LoopStorageContract {
  readonly backend = "sqlite";
  readonly supportsRemoteRunners = false;

  constructor(readonly store: Store = new Store()) {}

  async close(): Promise<void> {
    this.store.close();
  }

  private async call<K extends LoopStorageMethodName>(
    method: K,
    ...args: StoreMethod<K>["args"]
  ): Promise<StoreMethod<K>["result"]> {
    return (this.store[method] as (...callArgs: StoreMethod<K>["args"]) => StoreMethod<K>["result"])(...args);
  }

  createLoop(...args: StoreMethod<"createLoop">["args"]) { return this.call("createLoop", ...args); }
  getLoop(...args: StoreMethod<"getLoop">["args"]) { return this.call("getLoop", ...args); }
  findLoopByName(...args: StoreMethod<"findLoopByName">["args"]) { return this.call("findLoopByName", ...args); }
  requireLoop(...args: StoreMethod<"requireLoop">["args"]) { return this.call("requireLoop", ...args); }
  listLoops(...args: StoreMethod<"listLoops">["args"]) { return this.call("listLoops", ...args); }
  dueLoops(...args: StoreMethod<"dueLoops">["args"]) { return this.call("dueLoops", ...args); }
  updateLoop(...args: StoreMethod<"updateLoop">["args"]) { return this.call("updateLoop", ...args); }
  renameLoop(...args: StoreMethod<"renameLoop">["args"]) { return this.call("renameLoop", ...args); }
  archiveLoop(...args: StoreMethod<"archiveLoop">["args"]) { return this.call("archiveLoop", ...args); }
  unarchiveLoop(...args: StoreMethod<"unarchiveLoop">["args"]) { return this.call("unarchiveLoop", ...args); }
  deleteLoop(...args: StoreMethod<"deleteLoop">["args"]) { return this.call("deleteLoop", ...args); }
  createWorkflow(...args: StoreMethod<"createWorkflow">["args"]) { return this.call("createWorkflow", ...args); }
  getWorkflow(...args: StoreMethod<"getWorkflow">["args"]) { return this.call("getWorkflow", ...args); }
  listWorkflows(...args: StoreMethod<"listWorkflows">["args"]) { return this.call("listWorkflows", ...args); }
  countWorkflows(...args: StoreMethod<"countWorkflows">["args"]) { return this.call("countWorkflows", ...args); }
  archiveWorkflow(...args: StoreMethod<"archiveWorkflow">["args"]) { return this.call("archiveWorkflow", ...args); }
  createWorkflowInvocation(...args: StoreMethod<"createWorkflowInvocation">["args"]) { return this.call("createWorkflowInvocation", ...args); }
  getWorkflowInvocation(...args: StoreMethod<"getWorkflowInvocation">["args"]) { return this.call("getWorkflowInvocation", ...args); }
  listWorkflowInvocations(...args: StoreMethod<"listWorkflowInvocations">["args"]) { return this.call("listWorkflowInvocations", ...args); }
  upsertWorkflowWorkItem(...args: StoreMethod<"upsertWorkflowWorkItem">["args"]) { return this.call("upsertWorkflowWorkItem", ...args); }
  getWorkflowWorkItem(...args: StoreMethod<"getWorkflowWorkItem">["args"]) { return this.call("getWorkflowWorkItem", ...args); }
  listWorkflowWorkItems(...args: StoreMethod<"listWorkflowWorkItems">["args"]) { return this.call("listWorkflowWorkItems", ...args); }
  countActiveWorkflowWorkItems(...args: StoreMethod<"countActiveWorkflowWorkItems">["args"]) { return this.call("countActiveWorkflowWorkItems", ...args); }
  admitWorkflowWorkItem(...args: StoreMethod<"admitWorkflowWorkItem">["args"]) { return this.call("admitWorkflowWorkItem", ...args); }
  createGoal(...args: StoreMethod<"createGoal">["args"]) { return this.call("createGoal", ...args); }
  getGoal(...args: StoreMethod<"getGoal">["args"]) { return this.call("getGoal", ...args); }
  listGoals(...args: StoreMethod<"listGoals">["args"]) { return this.call("listGoals", ...args); }
  createGoalPlanNodes(...args: StoreMethod<"createGoalPlanNodes">["args"]) { return this.call("createGoalPlanNodes", ...args); }
  listGoalPlanNodes(...args: StoreMethod<"listGoalPlanNodes">["args"]) { return this.call("listGoalPlanNodes", ...args); }
  updateGoalStatus(...args: StoreMethod<"updateGoalStatus">["args"]) { return this.call("updateGoalStatus", ...args); }
  updateGoalPlanNode(...args: StoreMethod<"updateGoalPlanNode">["args"]) { return this.call("updateGoalPlanNode", ...args); }
  recordGoalEvent(...args: StoreMethod<"recordGoalEvent">["args"]) { return this.call("recordGoalEvent", ...args); }
  listGoalRuns(...args: StoreMethod<"listGoalRuns">["args"]) { return this.call("listGoalRuns", ...args); }
  createWorkflowRun(...args: StoreMethod<"createWorkflowRun">["args"]) { return this.call("createWorkflowRun", ...args); }
  getWorkflowRun(...args: StoreMethod<"getWorkflowRun">["args"]) { return this.call("getWorkflowRun", ...args); }
  listWorkflowRuns(...args: StoreMethod<"listWorkflowRuns">["args"]) { return this.call("listWorkflowRuns", ...args); }
  listWorkflowStepRuns(...args: StoreMethod<"listWorkflowStepRuns">["args"]) { return this.call("listWorkflowStepRuns", ...args); }
  getWorkflowStepRun(...args: StoreMethod<"getWorkflowStepRun">["args"]) { return this.call("getWorkflowStepRun", ...args); }
  startWorkflowStepRun(...args: StoreMethod<"startWorkflowStepRun">["args"]) { return this.call("startWorkflowStepRun", ...args); }
  recoverWorkflowRun(...args: StoreMethod<"recoverWorkflowRun">["args"]) { return this.call("recoverWorkflowRun", ...args); }
  finalizeWorkflowStepRun(...args: StoreMethod<"finalizeWorkflowStepRun">["args"]) { return this.call("finalizeWorkflowStepRun", ...args); }
  finalizeWorkflowRun(...args: StoreMethod<"finalizeWorkflowRun">["args"]) { return this.call("finalizeWorkflowRun", ...args); }
  appendWorkflowEvent(...args: StoreMethod<"appendWorkflowEvent">["args"]) { return this.call("appendWorkflowEvent", ...args); }
  listWorkflowEvents(...args: StoreMethod<"listWorkflowEvents">["args"]) { return this.call("listWorkflowEvents", ...args); }
  recordRunProcess(...args: StoreMethod<"recordRunProcess">["args"]) { return this.call("recordRunProcess", ...args); }
  createSkippedRun(...args: StoreMethod<"createSkippedRun">["args"]) { return this.call("createSkippedRun", ...args); }
  getRun(...args: StoreMethod<"getRun">["args"]) { return this.call("getRun", ...args); }
  getRunBySlot(...args: StoreMethod<"getRunBySlot">["args"]) { return this.call("getRunBySlot", ...args); }
  claimRun(...args: StoreMethod<"claimRun">["args"]) { return this.call("claimRun", ...args); }
  finalizeRun(...args: StoreMethod<"finalizeRun">["args"]) { return this.call("finalizeRun", ...args); }
  heartbeatRunLease(...args: StoreMethod<"heartbeatRunLease">["args"]) { return this.call("heartbeatRunLease", ...args); }
  listRuns(...args: StoreMethod<"listRuns">["args"]) { return this.call("listRuns", ...args); }
  writeRunReceipt(...args: StoreMethod<"writeRunReceipt">["args"]) { return this.call("writeRunReceipt", ...args); }
  getRunReceipt(...args: StoreMethod<"getRunReceipt">["args"]) { return this.call("getRunReceipt", ...args); }
  listRunReceipts(...args: StoreMethod<"listRunReceipts">["args"]) { return this.call("listRunReceipts", ...args); }
  recoverExpiredRunLeases(...args: StoreMethod<"recoverExpiredRunLeases">["args"]) { return this.call("recoverExpiredRunLeases", ...args); }
  recoverExpiredRunLeasesDetailed(...args: StoreMethod<"recoverExpiredRunLeasesDetailed">["args"]) { return this.call("recoverExpiredRunLeasesDetailed", ...args); }
  countLoops(...args: StoreMethod<"countLoops">["args"]) { return this.call("countLoops", ...args); }
  countRuns(...args: StoreMethod<"countRuns">["args"]) { return this.call("countRuns", ...args); }
  pruneHistory(...args: StoreMethod<"pruneHistory">["args"]) { return this.call("pruneHistory", ...args); }
  acquireDaemonLease(...args: StoreMethod<"acquireDaemonLease">["args"]) { return this.call("acquireDaemonLease", ...args); }
  heartbeatDaemonLease(...args: StoreMethod<"heartbeatDaemonLease">["args"]) { return this.call("heartbeatDaemonLease", ...args); }
  releaseDaemonLease(...args: StoreMethod<"releaseDaemonLease">["args"]) { return this.call("releaseDaemonLease", ...args); }
  getDaemonLease(...args: StoreMethod<"getDaemonLease">["args"]) { return this.call("getDaemonLease", ...args); }
}

export function createSqliteLoopStorage(path?: string): SqliteLoopStorage {
  return new SqliteLoopStorage(new Store(path));
}
