export interface MachineCommandResult {
    machineId: string;
    source: "local" | "lan" | "tailscale" | "ssh";
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut?: boolean;
    signal?: NodeJS.Signals | null;
    stdoutTruncated?: boolean;
    stderrTruncated?: boolean;
    stdoutChars?: number;
    stderrChars?: number;
    stdoutRedacted?: boolean;
    stderrRedacted?: boolean;
}
export interface MachineCommandOptions {
    timeoutMs?: number;
    killGraceMs?: number;
    maxOutputChars?: number;
    redactOutput?: boolean;
    /** Bounded opaque stdin forwarded to the resolved local or remote command. */
    stdin?: string | Buffer;
    maxInputBytes?: number;
}
export interface ResolvedMachineCommand {
    source: MachineCommandResult["source"];
    command: string;
    args: string[];
    shellCommand: string;
    usesShell: boolean;
}
export type MachineCommandRunner = (machineId: string, command: string, options?: MachineCommandOptions) => MachineCommandResult;
export declare const DEFAULT_MACHINE_COMMAND_MAX_INPUT_BYTES = 1048576;
export declare function resolveMachineCommand(machineId: string, command: string, localMachineId?: string): ResolvedMachineCommand;
export declare function runMachineCommand(machineId: string, command: string, options?: MachineCommandOptions): MachineCommandResult;
export declare function runResolvedMachineCommand(machineId: string, resolved: ResolvedMachineCommand, options?: MachineCommandOptions): MachineCommandResult;
export declare function describeMachineCommandFailure(operation: string, result: MachineCommandResult): string;
export declare function requireMachineCommandSuccess(operation: string, result: MachineCommandResult): MachineCommandResult;
