export interface KnowledgeMachineCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export type KnowledgeMachineCommandRunner = (command: string) => KnowledgeMachineCommandResult | Promise<KnowledgeMachineCommandResult>;
export type KnowledgeMachinePreflightSource = 'open-machines' | 'local' | 'ssh';
export type KnowledgeMachinePreflightStatus = 'ok' | 'warn' | 'fail';
export interface KnowledgeMachinePreflightCommandResult extends KnowledgeMachineCommandResult {
    source?: KnowledgeMachinePreflightSource;
}
export type KnowledgeMachinePreflightRunner = (machineId: string, command: string) => KnowledgeMachinePreflightCommandResult | Promise<KnowledgeMachinePreflightCommandResult>;
export interface KnowledgeMachinePreflightCommandSpec {
    command: string;
    expectedVersion?: string;
    versionArgs?: string;
    required?: boolean;
}
export interface KnowledgeMachinePreflightPackageSpec {
    name: string;
    command?: string;
    expectedVersion?: string;
    required?: boolean;
}
export interface KnowledgeMachinePreflightWorkspaceSpec {
    path: string;
    label?: string;
    expectedPackageName?: string;
    expectedVersion?: string;
    required?: boolean;
}
export interface KnowledgeMachineTopologyOptions {
    includeTailscale?: boolean;
    runner?: KnowledgeMachineCommandRunner;
    now?: Date;
    loadOpenMachines?: () => Promise<OpenMachinesModule | null>;
    knowledge?: {
        scope: string;
        workspace_home: string;
    };
}
export interface KnowledgeMachinePreflightOptions {
    machineId?: string;
    commands?: KnowledgeMachinePreflightCommandSpec[];
    packages?: KnowledgeMachinePreflightPackageSpec[];
    workspaces?: KnowledgeMachinePreflightWorkspaceSpec[];
    runner?: KnowledgeMachinePreflightRunner;
    now?: Date;
    loadOpenMachines?: () => Promise<OpenMachinesModule | null>;
    knowledge?: {
        scope: string;
        workspace_home: string;
    };
}
export type KnowledgeMachineRouteSource = 'open-machines' | 'raw';
export type KnowledgeMachineRouteKind = 'local' | 'lan' | 'tailscale' | 'ssh' | 'unknown';
export type KnowledgeMachineRouteConfidence = 'exact' | 'high' | 'medium' | 'low' | 'none' | string;
export interface KnowledgeMachineRouteOptions {
    machineId: string;
    includeTailscale?: boolean;
    runner?: KnowledgeMachineCommandRunner;
    now?: Date;
    loadOpenMachines?: () => Promise<OpenMachinesModule | null>;
}
export interface KnowledgeMachineRouteResolution {
    target: string;
    route: KnowledgeMachineRouteKind | null;
    targetKind: KnowledgeMachineRouteKind | null;
    confidence: KnowledgeMachineRouteConfidence | null;
    source: KnowledgeMachineRouteSource;
    evidence: Record<string, unknown> | null;
    warnings: string[];
}
export interface KnowledgeMachineRouteHint {
    kind: 'local' | 'lan' | 'tailscale' | 'ssh' | 'unknown';
    target: string;
    reachable: boolean | null;
}
export interface KnowledgeMachineEntry {
    machine_id: string;
    hostname: string | null;
    local: boolean;
    platform: string | null;
    os: string | null;
    user: string | null;
    workspace_path: string | null;
    manifest_declared: boolean;
    heartbeat_status: 'online' | 'offline' | 'unknown';
    last_heartbeat_at: string | null;
    tailscale: {
        dns_name: string | null;
        ips: string[];
        online: boolean | null;
        active: boolean | null;
        last_seen: string | null;
    };
    ssh: {
        address: string | null;
        route: 'local' | 'lan' | 'tailscale' | 'unknown';
        command_target: string | null;
    };
    route_hints: KnowledgeMachineRouteHint[];
    tags: string[];
    metadata: Record<string, unknown>;
    source: 'open-machines' | 'local';
}
export interface KnowledgeMachineTopology {
    ok: true;
    source: 'open-machines' | 'local';
    generated_at: string;
    local_machine_id: string;
    local_hostname: string;
    current_platform: string;
    knowledge: {
        scope: string;
        app_path: string;
        workspace_home: string | null;
    };
    machines: KnowledgeMachineEntry[];
    warnings: string[];
    adapter: {
        package: '@hasna/machines';
        available: boolean;
        error: string | null;
    };
    message: string;
}
export interface KnowledgeMachinePreflightCheck {
    id: string;
    kind: 'command' | 'package' | 'workspace';
    status: KnowledgeMachinePreflightStatus;
    target: string;
    expected: string | null;
    actual: string | null;
    detail: string;
    source: KnowledgeMachinePreflightSource;
}
export interface KnowledgeMachinePreflightReport {
    ok: boolean;
    source: 'open-machines' | 'local';
    machine_id: string;
    generated_at: string;
    knowledge: {
        scope: string;
        app_path: string;
        workspace_home: string | null;
    };
    checks: KnowledgeMachinePreflightCheck[];
    summary: {
        ok: number;
        warn: number;
        fail: number;
    };
    adapter: {
        package: '@hasna/machines';
        available: boolean;
        error: string | null;
    };
    message: string;
}
interface OpenMachinesModule {
    discoverMachineTopology?: (options?: {
        includeTailscale?: boolean;
        runner?: unknown;
        now?: Date;
    }) => unknown;
    resolveMachineRoute?: (machineId: string, options?: {
        includeTailscale?: boolean;
        runner?: unknown;
        now?: Date;
    }) => unknown;
    checkMachineCompatibility?: (options?: {
        machineId?: string;
        commands?: KnowledgeMachinePreflightCommandSpec[];
        packages?: KnowledgeMachinePreflightPackageSpec[];
        workspaces?: KnowledgeMachinePreflightWorkspaceSpec[];
        runner?: unknown;
        now?: Date;
    }) => unknown;
}
export declare function discoverKnowledgeMachineTopology(options?: KnowledgeMachineTopologyOptions): Promise<KnowledgeMachineTopology>;
export declare function resolveKnowledgeMachineRoute(options: KnowledgeMachineRouteOptions): Promise<KnowledgeMachineRouteResolution>;
export declare function preflightKnowledgeMachine(options?: KnowledgeMachinePreflightOptions): Promise<KnowledgeMachinePreflightReport>;
export {};
