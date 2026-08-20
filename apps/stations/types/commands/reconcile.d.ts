import { type RolloutRecordDoc, type RolloutResult, type RolloutVerification } from "../distribution.js";
import { type ExactBunBootstrapSourceLoader, type ExactBunSourceLoader } from "./bun-registry-installer.js";
import { type MachineCommandRunner } from "../remote.js";
import type { ExactBunAppsPlan, ExactBunAppsStatusResult, ExactBunRegistryPlanStep, FleetManifest, FreezeEntry } from "../types.js";
export interface ExecResult {
    status: number | null;
    stdout: string;
    stderr: string;
}
export type ExecFn = (command: string, args: string[]) => ExecResult;
export declare function defaultExec(command: string, args: string[]): ExecResult;
export interface InstalledPackage {
    name: string;
    version: string;
}
/** Parse `bun pm ls -g` output lines like `├── @hasna/todos@0.1.2`. */
export declare function parseBunGlobalList(output: string): InstalledPackage[];
export declare function getInstalledGlobalPackages(exec?: ExecFn): {
    installed: InstalledPackage[];
    warnings: string[];
};
export declare function readInstalledSnapshot(path: string): InstalledPackage[];
export interface DesiredPackage {
    name: string;
    version?: string;
    appId: string;
    bin: string;
    /** False for library-only packages: skip `<bin> --version` verification. */
    verify: boolean;
    mcpHealthUrl?: string;
    exactBunRegistry?: ExactBunRegistryPlanStep;
}
export declare function defaultBinForPackage(packageName: string): string;
/** Fleet-wide packages plus per-machine overrides (machine wins by name); bun-managed only. */
export declare function resolveDesiredPackages(manifest: FleetManifest, machineId: string): DesiredPackage[];
export type ReconcileActionKind = "install" | "update" | "skip" | "freeze-blocked";
export interface ReconcilePlanAction {
    package: string;
    appId: string;
    bin: string;
    /** False for library-only packages: skip `<bin> --version` verification. */
    verify: boolean;
    mcpHealthUrl?: string;
    action: ReconcileActionKind;
    desiredVersion: string | null;
    installedVersion: string | null;
    reason: string;
    exactBunRegistry?: ExactBunRegistryPlanStep;
}
export interface ReconcilePlan {
    machineId: string;
    generatedAt: string;
    actions: ReconcilePlanAction[];
    warnings: string[];
    exactBunPlan?: ExactBunAppsPlan;
}
export interface BuildReconcilePlanOptions {
    manifest?: FleetManifest;
    manifestPath?: string;
    machineId?: string;
    installed?: InstalledPackage[];
    freezes?: FreezeEntry[];
    freezePath?: string;
    packageFilter?: string;
    /** Versions announced by release.published events; used when the manifest tracks the package without a pin. */
    eventVersions?: Record<string, string>;
    exec?: ExecFn;
    now?: Date;
    exactInstalledState?: ExactBunAppsStatusResult;
}
export declare function buildReconcilePlan(options?: BuildReconcilePlanOptions): ReconcilePlan;
export type RolloutEventSeverity = "debug" | "info" | "notice" | "warning" | "error" | "critical";
export interface RolloutEmitInput {
    source: string;
    type: string;
    subject?: string;
    severity?: RolloutEventSeverity;
    message?: string;
    data: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
export interface RolloutEmitter {
    emit(input: RolloutEmitInput, options?: {
        deliver?: boolean;
    }): Promise<unknown> | unknown;
}
export type McpHealth = NonNullable<RolloutVerification["mcpHealth"]>;
export declare function defaultMcpHealthCheck(url: string): Promise<McpHealth>;
export interface ExecuteReconcileOptions {
    dryRun?: boolean;
    exec?: ExecFn;
    emitter?: RolloutEmitter | null;
    deliver?: boolean;
    /** Where terminal rollout records are appended as JSONL; null disables persistence. */
    recordsPath?: string | null;
    healthCheck?: (url: string) => Promise<McpHealth>;
    now?: () => Date;
    manifest?: FleetManifest;
    manifestPath?: string;
    exactSourceLoader?: ExactBunSourceLoader;
    exactBootstrapSourceLoader?: ExactBunBootstrapSourceLoader;
    exactInstalledState?: ExactBunAppsStatusResult;
    exactRunner?: MachineCommandRunner;
}
export interface ReconcileActionResult extends ReconcilePlanAction {
    status: RolloutResult;
    error?: string;
    verifiedBy?: RolloutVerification;
    rolledBackTo?: string | null;
}
export interface ReconcileResult {
    machineId: string;
    mode: "dry-run" | "apply";
    plan: ReconcilePlan;
    results: ReconcileActionResult[];
    records: RolloutRecordDoc[];
    emitted: number;
    warnings: string[];
}
export declare function appendRolloutRecord(record: RolloutRecordDoc, path?: string): string;
export declare function readRolloutRecords(path?: string): RolloutRecordDoc[];
export declare function executeReconcilePlan(plan: ReconcilePlan, options?: ExecuteReconcileOptions): Promise<ReconcileResult>;
export interface ReleaseEventEnvelope {
    id?: string;
    type: string;
    source?: string;
    data?: Record<string, unknown>;
}
export interface ReleaseEventTrigger {
    packageFilter: string;
    eventVersions: Record<string, string>;
}
/**
 * Extract a reconcile trigger from a `release.published` event envelope.
 * Returns null when the event is not a release.published event or the payload
 * is missing the required package/version fields.
 */
export declare function releaseEventTrigger(event: ReleaseEventEnvelope): ReleaseEventTrigger | null;
export interface ReconcileFromEventOptions extends Omit<BuildReconcilePlanOptions, "now">, ExecuteReconcileOptions {
}
/**
 * Reconcile in response to a `release.published` event. The manifest stays the
 * source of truth: pinned versions win, and unpinned tracked packages adopt
 * the event's version. Returns null for non-release.published events.
 */
export declare function reconcileFromReleaseEvent(event: ReleaseEventEnvelope, options?: ReconcileFromEventOptions): Promise<ReconcileResult | null>;
