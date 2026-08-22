import { type MachineCommandRunner } from "../remote.js";
import type { SetupResult } from "../types.js";
export declare function buildSetupPlan(machineId?: string): SetupResult;
export interface RunSetupOptions {
    apply?: boolean;
    yes?: boolean;
    expectedPlanDigest?: string;
}
export declare function runSetup(machineId?: string, options?: RunSetupOptions, runner?: MachineCommandRunner): SetupResult;
export declare function runSetupPlan(plan: SetupResult, options?: RunSetupOptions, runner?: MachineCommandRunner): SetupResult;
