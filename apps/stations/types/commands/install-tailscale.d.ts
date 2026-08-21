import { type MachineCommandRunner } from "../remote.js";
import type { SetupResult } from "../types.js";
export declare function buildTailscaleInstallPlan(machineId?: string): SetupResult;
export interface RunTailscaleInstallOptions {
    apply?: boolean;
    yes?: boolean;
    expectedPlanDigest?: string;
}
export declare function runTailscaleInstall(machineId?: string, options?: RunTailscaleInstallOptions, runner?: MachineCommandRunner): SetupResult;
export declare function runTailscaleInstallPlan(plan: SetupResult, options?: RunTailscaleInstallOptions, runner?: MachineCommandRunner): SetupResult;
