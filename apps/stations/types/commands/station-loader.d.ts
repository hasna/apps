import { type MachineCommandOptions, type MachineCommandResult } from "../remote.js";
export type StationLoaderShellMode = "login" | "bare";
export type StationLoaderProbeStatus = "OK" | "NOT-LOADED" | "UNKNOWN";
export interface StationLoaderProbeOptions {
    machineId: string;
    shellMode?: StationLoaderShellMode;
    timeoutMs?: number;
    runner?: StationLoaderProbeRunner;
}
export type StationLoaderProbeRunner = (machineId: string, command: string, options?: MachineCommandOptions) => MachineCommandResult;
export interface StationLoaderProbeResult {
    machineId: string;
    shellMode: StationLoaderShellMode;
    status: StationLoaderProbeStatus;
    expectedStatus: StationLoaderProbeStatus;
    assertionPassed: boolean;
    source: MachineCommandResult["source"];
    exitCode: number;
    timedOut: boolean;
    reason: string;
    diagnostic: string | null;
}
export interface StationLoaderProbeSuiteResult {
    machineId: string;
    status: StationLoaderProbeStatus;
    assertionPassed: boolean;
    login: StationLoaderProbeResult;
    bareControl: StationLoaderProbeResult;
    reason: string;
}
export declare const STATION_LOADER_BEHAVIOR_PROBE: string;
export declare function buildStationLoaderProbeCommand(shellMode?: StationLoaderShellMode): string;
export declare function parseStationLoaderProbeStatus(stdout: string): StationLoaderProbeStatus;
export declare function probeStationLoader(options: StationLoaderProbeOptions): StationLoaderProbeResult;
export declare function probeStationLoaderWithBareControl(options: Omit<StationLoaderProbeOptions, "shellMode">): StationLoaderProbeSuiteResult;
export declare function renderStationLoaderProbe(result: StationLoaderProbeResult): string;
export declare function renderStationLoaderProbeSuite(result: StationLoaderProbeSuiteResult): string;
