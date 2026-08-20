import { type MachineCommandResult } from "./remote.js";
import { MACHINES_CONSUMER_CONTRACT_VERSION, type MachinesContractPackage, type MachinesConsumerCapabilities } from "./topology.js";
export type CompatibilityStatus = "ok" | "warn" | "fail";
export type CompatibilitySource = MachineCommandResult["source"];
export interface CompatibilityCommandSpec {
    command: string;
    expectedVersion?: string;
    versionArgs?: string;
    required?: boolean;
}
export interface CompatibilityPackageSpec {
    name: string;
    command?: string;
    expectedVersion?: string;
    required?: boolean;
}
export interface CompatibilityWorkspaceSpec {
    path: string;
    label?: string;
    expectedPackageName?: string;
    expectedVersion?: string;
    required?: boolean;
}
export interface CompatibilityCheck {
    id: string;
    kind: "command" | "package" | "workspace";
    status: CompatibilityStatus;
    target: string;
    expected: string | null;
    actual: string | null;
    detail: string;
    source: CompatibilitySource;
}
export interface MachineCompatibilityReport {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package: MachinesContractPackage;
    capabilities: MachinesConsumerCapabilities;
    ok: boolean;
    machine_id: string;
    source: CompatibilitySource;
    generated_at: string;
    checks: CompatibilityCheck[];
    summary: {
        ok: number;
        warn: number;
        fail: number;
    };
}
export type CompatibilityCommandRunner = (machineId: string, command: string) => MachineCommandResult;
export interface MachineCompatibilityOptions {
    machineId?: string;
    commands?: CompatibilityCommandSpec[];
    packages?: CompatibilityPackageSpec[];
    workspaces?: CompatibilityWorkspaceSpec[];
    runner?: CompatibilityCommandRunner;
    now?: Date;
}
export declare function checkMachineCompatibility(options?: MachineCompatibilityOptions): MachineCompatibilityReport;
