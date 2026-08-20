import { type MachineCommandResult, type MachineCommandRunner } from "../remote.js";
export declare const DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS = 131072;
export declare const DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS = 65536;
export declare const MACHINE_EXEC_MUTATION_OPERATION = "machines_exec";
export interface MachineExecInput {
    machineId: string;
    timeoutMs: number;
    argv?: string[];
    script?: string;
    maxOutputChars?: number;
}
export interface BoundedStream {
    text: string;
    truncated: boolean;
}
export interface MachineExecResult {
    machine_id: string;
    source: MachineCommandResult["source"];
    exit_code: number;
    timed_out: boolean;
    signal: NodeJS.Signals | null;
    stdout: BoundedStream;
    stderr: BoundedStream;
    redacted: true;
}
export declare function machineExecResourceId(input: MachineExecInput): string;
export declare function machineExecMutationArgs(input: MachineExecInput): Record<string, unknown>;
export type MachineExecScriptChunkReader = (buffer: Buffer) => number;
export declare function readBoundedMachineExecScript(readChunk?: MachineExecScriptChunkReader, maxChars?: number): string;
export declare function resolveMachineExecCommand(input: MachineExecInput): string;
export declare function runMachineExec(input: MachineExecInput, runner?: MachineCommandRunner): MachineExecResult;
