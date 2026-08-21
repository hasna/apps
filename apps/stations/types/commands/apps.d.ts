import { type MachineCommandRunner } from "../remote.js";
import { type ExactBunBootstrapSourceLoader, type ExactBunSourceLoader } from "./bun-registry-installer.js";
import type { AppsDiffResult, AppsPlanResult, AppsStatusResult, AppsValidationResult, ExactBunAppsStatusResult, ManifestAppSpec } from "../types.js";
export interface AppsManifestOptions {
    manifestPath?: string;
    env?: NodeJS.ProcessEnv;
    installedState?: ExactBunAppsStatusResult;
    bootstrapSourceLoader?: ExactBunBootstrapSourceLoader;
}
export declare function listApps(machineId?: string, options?: AppsManifestOptions): {
    machineId: string;
    apps: ManifestAppSpec[];
};
export declare function buildAppsPlan(machineId?: string, options?: AppsManifestOptions): AppsPlanResult;
export interface RunAppsInstallOptions {
    apply?: boolean;
    yes?: boolean;
    expectedPlanDigest?: string;
    manifestPath?: string;
    env?: NodeJS.ProcessEnv;
    sourceLoader?: ExactBunSourceLoader;
    installedState?: ExactBunAppsStatusResult;
    bootstrapSourceLoader?: ExactBunBootstrapSourceLoader;
}
export declare function validateAppsCandidate(machineId: string, options?: AppsManifestOptions): AppsValidationResult;
export declare function getAppsStatus(machineId?: string, runner?: MachineCommandRunner, options?: AppsManifestOptions): AppsStatusResult | ExactBunAppsStatusResult;
export declare function diffApps(machineId?: string, runner?: MachineCommandRunner, options?: AppsManifestOptions): AppsDiffResult;
export declare function runAppsInstall(machineId?: string, options?: RunAppsInstallOptions, runner?: MachineCommandRunner): AppsPlanResult;
export declare function runAppsPlan(plan: AppsPlanResult, options?: RunAppsInstallOptions, runner?: MachineCommandRunner): AppsPlanResult;
