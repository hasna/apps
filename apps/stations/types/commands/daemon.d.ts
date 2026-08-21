export type DaemonServicePlatform = "macos" | "linux";
export type DaemonServiceMode = "user" | "system";
export type DaemonServiceAction = "install" | "uninstall" | "restart" | "status" | "logs";
export interface DaemonServiceOptions {
    action: DaemonServiceAction;
    platform?: DaemonServicePlatform | "darwin";
    mode?: DaemonServiceMode;
    serviceName?: string;
    executable?: string;
    intervalMs?: number;
    storagePush?: boolean;
    doctorSummary?: boolean;
    privateMetadata?: boolean | readonly string[];
    env?: readonly string[];
}
export interface DaemonServiceCommand {
    id: string;
    description: string;
    program: string;
    args: string[];
    sudo: boolean;
    mutates: boolean;
    allowFailure?: boolean;
    env?: Record<string, string>;
}
export interface DaemonServiceFile {
    id: string;
    description: string;
    path: string;
    mode: string;
    content: string;
}
export interface DaemonServicePlan {
    platform: DaemonServicePlatform;
    mode: DaemonServiceMode;
    action: DaemonServiceAction;
    serviceName: string;
    serviceId: string;
    executable: string;
    intervalMs: number;
    commands: DaemonServiceCommand[];
    files: DaemonServiceFile[];
    warnings: string[];
    manualSteps: string[];
}
export interface DaemonServiceRunOptions {
    apply?: boolean;
    yes?: boolean;
}
export interface DaemonServiceCommandResult {
    id: string;
    command: string[];
    skipped: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error?: string;
}
export interface DaemonServiceRunResult {
    mode: "plan" | "apply";
    applied: boolean;
    plan: DaemonServicePlan;
    filesWritten: string[];
    commands: DaemonServiceCommandResult[];
    warnings: string[];
}
export declare function buildDaemonServicePlan(options: DaemonServiceOptions): DaemonServicePlan;
export declare function runDaemonServicePlan(plan: DaemonServicePlan, options?: DaemonServiceRunOptions): DaemonServiceRunResult;
export declare function buildDaemonInstallPlan(options?: Omit<DaemonServiceOptions, "action">): DaemonServicePlan;
export declare function buildDaemonUninstallPlan(options?: Omit<DaemonServiceOptions, "action">): DaemonServicePlan;
export declare function buildDaemonRestartPlan(options?: Omit<DaemonServiceOptions, "action">): DaemonServicePlan;
export declare function buildDaemonStatusPlan(options?: Omit<DaemonServiceOptions, "action">): DaemonServicePlan;
export declare function buildDaemonLogsPlan(options?: Omit<DaemonServiceOptions, "action">): DaemonServicePlan;
export declare function renderLaunchdPlist(options?: Omit<DaemonServiceOptions, "action">): string;
export declare function renderSystemdUnit(options?: Omit<DaemonServiceOptions, "action">): string;
