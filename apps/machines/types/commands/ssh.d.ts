import { type MachineRouteOptions } from "../topology.js";
export declare const UNSAFE_SSH_TARGET_ERROR = "Unsafe SSH target";
export interface ResolvedSshTarget {
    machineId: string;
    target: string;
    route: "lan" | "tailscale" | "local" | "ssh";
    confidence: "exact" | "high" | "medium" | "low" | "none";
    warnings: string[];
}
export interface SshCommandPlan extends ResolvedSshTarget {
    command: "ssh";
    args: string[];
    shellCommand: string;
}
export declare function validateSshTarget(target: string): string;
export declare function resolveSshTarget(machineId: string, options?: MachineRouteOptions): ResolvedSshTarget;
export declare function buildSshCommand(machineId: string, remoteCommand?: string, options?: MachineRouteOptions): string;
export declare function buildSshCommandArgs(machineId: string, remoteCommand?: string, options?: MachineRouteOptions): string[];
export declare function buildSshCommandPlan(machineId: string, remoteCommand?: string, options?: MachineRouteOptions): SshCommandPlan;
