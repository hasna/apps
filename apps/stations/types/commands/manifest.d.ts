import type { FleetManifest, MachineManifest } from "../types.js";
export interface MachineFriendlyNameResult {
    machine_id: string;
    friendly_name: string | null;
    display_name: string;
    updated_at: string | null;
}
export interface SetMachineFriendlyNameInput {
    machineId: string;
    friendlyName: string;
}
export interface ClearMachineFriendlyNameInput {
    machineId: string;
}
export declare function manifestInit(): string;
export declare function manifestList(): FleetManifest;
export declare function manifestAdd(machine: MachineManifest): FleetManifest;
export declare function manifestBootstrapCurrentMachine(): FleetManifest;
export declare function manifestGet(machineId: string): MachineManifest | null;
export declare function machineFriendlyNameResourceId(machineId: string): string;
export declare function setMachineFriendlyNameMutationArgs(input: SetMachineFriendlyNameInput): Record<string, unknown>;
export declare function clearMachineFriendlyNameMutationArgs(input: ClearMachineFriendlyNameInput): Record<string, unknown>;
export declare function manifestGetFriendlyName(machineId: string): MachineFriendlyNameResult;
export declare function manifestSetFriendlyName(input: SetMachineFriendlyNameInput): MachineFriendlyNameResult;
export declare function manifestClearFriendlyName(input: ClearMachineFriendlyNameInput): MachineFriendlyNameResult;
export declare function manifestRemove(machineId: string): FleetManifest;
export declare function manifestValidate(): FleetManifest;
