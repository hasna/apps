import type { Database } from "bun:sqlite";
import { z } from "zod";
export declare const ROSTER_RECORD_SCHEMA_ID = "hasna.roster_record.v1";
export declare const ROSTER_CONFIG_SCHEMA_ID = "hasna.station_roster.v1";
export declare const ROSTER_RECONCILE_OPERATION = "roster_reconcile_apply";
export declare const rosterConfigSchema: z.ZodEffects<z.ZodObject<{
    $schema: z.ZodLiteral<"hasna.station_roster.v1">;
    machineId: z.ZodOptional<z.ZodString>;
    applyMode: z.ZodEnum<["manual", "auto"]>;
    tickSeconds: z.ZodNumber;
    settleSeconds: z.ZodNumber;
    batchSize: z.ZodNumber;
    maxActiveAgents: z.ZodNumber;
    leaseSeconds: z.ZodNumber;
    backoff: z.ZodObject<{
        maxAttempts: z.ZodNumber;
        windowMinutes: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        maxAttempts: number;
        windowMinutes: number;
    }, {
        maxAttempts: number;
        windowMinutes: number;
    }>;
    gate: z.ZodObject<{
        minMemAvailableGb: z.ZodNumber;
        maxSwapUsedGb: z.ZodNumber;
        maxPsiFullAvg60: z.ZodNumber;
        maxSwapGrowthGbPerBatch: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        minMemAvailableGb: number;
        maxSwapUsedGb: number;
        maxPsiFullAvg60: number;
        maxSwapGrowthGbPerBatch: number;
    }, {
        minMemAvailableGb: number;
        maxSwapUsedGb: number;
        maxPsiFullAvg60: number;
        maxSwapGrowthGbPerBatch: number;
    }>;
    conversations: z.ZodObject<{
        channel: z.ZodString;
        bin: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        bin: string;
        channel: string;
    }, {
        channel: string;
        bin?: string | undefined;
    }>;
    todos: z.ZodObject<{
        project: z.ZodString;
        taskList: z.ZodOptional<z.ZodString>;
        bin: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        bin: string;
        project: string;
        taskList?: string | undefined;
    }, {
        project: string;
        bin?: string | undefined;
        taskList?: string | undefined;
    }>;
    functionalChecks: z.ZodDefault<z.ZodArray<z.ZodEnum<["todos", "conversations"]>, "many">>;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        target: z.ZodString;
        profile: z.ZodString;
        heartbeatPath: z.ZodOptional<z.ZodString>;
        heartbeatFreshSeconds: z.ZodOptional<z.ZodNumber>;
        memoryHigh: z.ZodString;
        memoryMax: z.ZodString;
        memorySwapMax: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        target: string;
        profile: string;
        memoryHigh: string;
        memoryMax: string;
        memorySwapMax: string;
        heartbeatPath?: string | undefined;
        heartbeatFreshSeconds?: number | undefined;
    }, {
        id: string;
        target: string;
        profile: string;
        memoryHigh: string;
        memoryMax: string;
        memorySwapMax: string;
        heartbeatPath?: string | undefined;
        heartbeatFreshSeconds?: number | undefined;
    }>, "many">;
    recordsPath: z.ZodOptional<z.ZodString>;
    heartbeatPath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    entries: {
        id: string;
        target: string;
        profile: string;
        memoryHigh: string;
        memoryMax: string;
        memorySwapMax: string;
        heartbeatPath?: string | undefined;
        heartbeatFreshSeconds?: number | undefined;
    }[];
    todos: {
        bin: string;
        project: string;
        taskList?: string | undefined;
    };
    $schema: "hasna.station_roster.v1";
    applyMode: "auto" | "manual";
    tickSeconds: number;
    settleSeconds: number;
    batchSize: number;
    maxActiveAgents: number;
    leaseSeconds: number;
    backoff: {
        maxAttempts: number;
        windowMinutes: number;
    };
    gate: {
        minMemAvailableGb: number;
        maxSwapUsedGb: number;
        maxPsiFullAvg60: number;
        maxSwapGrowthGbPerBatch: number;
    };
    conversations: {
        bin: string;
        channel: string;
    };
    functionalChecks: ("todos" | "conversations")[];
    machineId?: string | undefined;
    recordsPath?: string | undefined;
    heartbeatPath?: string | undefined;
}, {
    entries: {
        id: string;
        target: string;
        profile: string;
        memoryHigh: string;
        memoryMax: string;
        memorySwapMax: string;
        heartbeatPath?: string | undefined;
        heartbeatFreshSeconds?: number | undefined;
    }[];
    todos: {
        project: string;
        bin?: string | undefined;
        taskList?: string | undefined;
    };
    $schema: "hasna.station_roster.v1";
    applyMode: "auto" | "manual";
    tickSeconds: number;
    settleSeconds: number;
    batchSize: number;
    maxActiveAgents: number;
    leaseSeconds: number;
    backoff: {
        maxAttempts: number;
        windowMinutes: number;
    };
    gate: {
        minMemAvailableGb: number;
        maxSwapUsedGb: number;
        maxPsiFullAvg60: number;
        maxSwapGrowthGbPerBatch: number;
    };
    conversations: {
        channel: string;
        bin?: string | undefined;
    };
    machineId?: string | undefined;
    recordsPath?: string | undefined;
    functionalChecks?: ("todos" | "conversations")[] | undefined;
    heartbeatPath?: string | undefined;
}>, {
    entries: {
        id: string;
        target: string;
        profile: string;
        memoryHigh: string;
        memoryMax: string;
        memorySwapMax: string;
        heartbeatPath?: string | undefined;
        heartbeatFreshSeconds?: number | undefined;
    }[];
    todos: {
        bin: string;
        project: string;
        taskList?: string | undefined;
    };
    $schema: "hasna.station_roster.v1";
    applyMode: "auto" | "manual";
    tickSeconds: number;
    settleSeconds: number;
    batchSize: number;
    maxActiveAgents: number;
    leaseSeconds: number;
    backoff: {
        maxAttempts: number;
        windowMinutes: number;
    };
    gate: {
        minMemAvailableGb: number;
        maxSwapUsedGb: number;
        maxPsiFullAvg60: number;
        maxSwapGrowthGbPerBatch: number;
    };
    conversations: {
        bin: string;
        channel: string;
    };
    functionalChecks: ("todos" | "conversations")[];
    machineId?: string | undefined;
    recordsPath?: string | undefined;
    heartbeatPath?: string | undefined;
}, {
    entries: {
        id: string;
        target: string;
        profile: string;
        memoryHigh: string;
        memoryMax: string;
        memorySwapMax: string;
        heartbeatPath?: string | undefined;
        heartbeatFreshSeconds?: number | undefined;
    }[];
    todos: {
        project: string;
        bin?: string | undefined;
        taskList?: string | undefined;
    };
    $schema: "hasna.station_roster.v1";
    applyMode: "auto" | "manual";
    tickSeconds: number;
    settleSeconds: number;
    batchSize: number;
    maxActiveAgents: number;
    leaseSeconds: number;
    backoff: {
        maxAttempts: number;
        windowMinutes: number;
    };
    gate: {
        minMemAvailableGb: number;
        maxSwapUsedGb: number;
        maxPsiFullAvg60: number;
        maxSwapGrowthGbPerBatch: number;
    };
    conversations: {
        channel: string;
        bin?: string | undefined;
    };
    machineId?: string | undefined;
    recordsPath?: string | undefined;
    functionalChecks?: ("todos" | "conversations")[] | undefined;
    heartbeatPath?: string | undefined;
}>;
export type RosterConfig = z.infer<typeof rosterConfigSchema>;
export type RosterEntry = RosterConfig["entries"][number];
export type RosterClassification = "steady" | "recovery" | "boot";
export type RosterRunStatus = "succeeded" | "planned" | "blocked" | "failed" | "lease-held";
export interface CommandResult {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: string;
}
export type RosterCommandRunner = (command: string, args: string[], timeoutMs?: number) => CommandResult;
export interface HostResourceSample {
    memAvailableGb: number;
    swapUsedGb: number;
    psiFullAvg60: number;
}
export interface RosterGateDecision extends HostResourceSample {
    allowed: boolean;
    swapGrowthGb: number;
    reasons: string[];
    sampledAt: string;
}
export interface TmuxPane {
    target: string;
    session: string;
    dead: boolean;
    currentCommand: string;
    pid: number | null;
    startCommand: string;
}
export interface RosterEntryObservation {
    id: string;
    target: string;
    classification: RosterClassification;
    active: boolean;
    safeToRespawn: boolean;
    pane: TmuxPane | null;
    heartbeatFresh: boolean | null;
    heartbeatAgeMs: number | null;
    hasLaunchRecord: boolean;
    state: "ready" | "missing" | "unsafe" | "crashlooping";
    failedAttempts: number;
    firstMissingAt: number | null;
}
export interface RosterPlanEntry {
    id: string;
    target: string;
    classification: RosterClassification;
    action: "none" | "launch" | "blocked";
    reason: string;
}
export interface RosterRecord {
    schema: typeof ROSTER_RECORD_SCHEMA_ID;
    id: string;
    createdAt: string;
    machine: string;
    classification: RosterClassification;
    result: RosterRunStatus;
    mode: "manual" | "apply" | "auto";
    drillLevel?: string;
    gate: RosterGateDecision;
    plan: RosterPlanEntry[];
    entries: Array<{
        id: string;
        state: RosterEntryObservation["state"];
        classification: RosterClassification;
        attempts: number;
        error?: string;
        mttrMs?: number;
    }>;
    launched: string[];
    crashlooping: string[];
    functionalChecks: Record<string, "ok" | "failed">;
    conversationPosted: boolean;
    mttrMs?: number;
}
export interface RosterRunResult {
    runId: string;
    status: RosterRunStatus;
    mode: "manual" | "apply" | "auto";
    classification: RosterClassification;
    gate: RosterGateDecision | null;
    plan: RosterPlanEntry[];
    observations: RosterEntryObservation[];
    launched: string[];
    crashlooping: string[];
    functionalChecks: Record<string, "ok" | "failed">;
    conversationPosted: boolean;
    heartbeatWritten: boolean;
    record: RosterRecord | null;
    warnings: string[];
}
export interface RosterRunOptions {
    apply?: boolean;
    drillLevel?: string;
    db?: Database;
    runner?: RosterCommandRunner;
    now?: () => Date;
    sleep?: (milliseconds: number) => Promise<void>;
    resourceProbe?: () => HostResourceSample;
    heartbeatStat?: (path: string) => {
        mtimeMs: number;
    } | null;
    owner?: string;
}
export declare function readRosterConfig(path?: string): RosterConfig;
export declare function defaultRosterCommandRunner(command: string, args: string[], timeoutMs?: number): CommandResult;
export declare function parseTmuxPanes(output: string): TmuxPane[];
/** Read only live kernel counters; the controller never gates from a saved snapshot. */
export declare function probeHostResources(readText?: (path: string) => string): HostResourceSample;
export declare function evaluateRosterGate(sample: HostResourceSample, thresholds: RosterConfig["gate"], previousSwapUsedGb: number | null, sampledAt?: string): RosterGateDecision;
export declare function buildRosterLaunchCommand(entry: RosterEntry): string[];
export declare function buildTmuxRespawnArgs(entry: RosterEntry): string[];
export declare function runRosterReconcile(config: RosterConfig, options?: RosterRunOptions): Promise<RosterRunResult>;
export declare function resetRosterCrashloop(config: RosterConfig, entryId: string, db?: Database): boolean;
export declare function runRosterDaemon(configPath?: string, options?: Omit<RosterRunOptions, "apply"> & {
    once?: boolean;
    onResult?: (result: RosterRunResult) => void;
    authorizeApply?: (config: RosterConfig) => void;
}): Promise<void>;
export declare function rosterConfigResourceId(configPath: string): string;
export declare function rosterConfigApprovalArgs(configPath: string, entryId?: string): Record<string, unknown>;
