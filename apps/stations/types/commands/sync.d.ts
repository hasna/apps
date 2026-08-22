import { type MachineCommandRunner } from "../remote.js";
import type { SyncResult } from "../types.js";
export declare function buildSyncPlan(machineId?: string, runner?: MachineCommandRunner): SyncResult;
export interface RunSyncOptions {
    apply?: boolean;
    yes?: boolean;
    expectedPlanDigest?: string;
}
export declare function runSync(machineId?: string, options?: RunSyncOptions, runner?: MachineCommandRunner): SyncResult;
export declare function runSyncPlan(plan: SyncResult, options?: RunSyncOptions, runner?: MachineCommandRunner): SyncResult;
