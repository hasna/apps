export interface KnowledgeMachineCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export type KnowledgeMachineCommandRunner = (command: string) => KnowledgeMachineCommandResult | Promise<KnowledgeMachineCommandResult>;
export type KnowledgeMachinePreflightSource = 'open-machines' | 'local' | 'ssh';
export type KnowledgeMachinePreflightStatus = 'ok' | 'warn' | 'fail';
export declare const KNOWLEDGE_MACHINES_ADAPTER_CONTRACT_VERSION = 1;
export declare const KNOWLEDGE_MACHINES_ADAPTER_PACKAGE = "@hasna/machines";
export declare const KNOWLEDGE_MACHINES_ADAPTER_ENTRYPOINT = "@hasna/machines/consumer";
export type KnowledgeMachinesAdapterMode = 'auto' | 'sdk' | 'cli' | 'disabled';
export type KnowledgeMachinesAdapterImplementation = 'sdk' | 'cli' | 'disabled';
export interface KnowledgeMachinesAdapterStatus {
    package: typeof KNOWLEDGE_MACHINES_ADAPTER_PACKAGE;
    entrypoint: typeof KNOWLEDGE_MACHINES_ADAPTER_ENTRYPOINT;
    mode: KnowledgeMachinesAdapterMode;
    implementation: KnowledgeMachinesAdapterImplementation;
    contract_version: number | null;
    available: boolean;
    error: string | null;
}
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
    adapterMode?: KnowledgeMachinesAdapterMode;
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
    adapterMode?: KnowledgeMachinesAdapterMode;
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
    adapterMode?: KnowledgeMachinesAdapterMode;
    machineId: string;
    includeTailscale?: boolean;
    runner?: KnowledgeMachineCommandRunner;
    now?: Date;
    loadOpenMachines?: () => Promise<OpenMachinesModule | null>;
}
export type KnowledgeMachineWorkspaceSource = 'open-machines' | 'argument' | 'raw';
export type KnowledgeMachineWorkspacePathSource = 'argument' | 'manifest' | 'manifest_metadata' | 'inferred' | 'unresolved' | string;
export type KnowledgeMachineTrustStatus = 'trusted' | 'untrusted' | 'unknown' | string;
export type KnowledgeMachineAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown' | string;
export type KnowledgeMachineWorkspaceDiagnosticStatus = 'ok' | 'missing' | 'inferred' | 'stale' | 'untrusted' | 'unknown_auth' | 'missing_manifest' | string;
export interface KnowledgeMachineWorkspaceDiagnostic {
    id: string;
    status: KnowledgeMachineWorkspaceDiagnosticStatus;
    severity: 'ok' | 'warn' | 'fail' | string;
    message: string;
    path: string | null;
    source: KnowledgeMachineWorkspacePathSource | 'trust' | 'auth' | string;
    path_exists: boolean | null;
}
export interface KnowledgeMachineWorkspaceRepairHint {
    id: string;
    reason: string;
    command: string[];
    shell_command: string;
    apply_command: string[];
    apply_shell_command: string;
}
export interface KnowledgeMachineWorkspaceOptions {
    adapterMode?: KnowledgeMachinesAdapterMode;
    machineId: string;
    peerWorkspace?: string | null;
    includeTailscale?: boolean;
    runner?: KnowledgeMachineCommandRunner;
    now?: Date;
    loadOpenMachines?: () => Promise<OpenMachinesModule | null>;
    projectId?: string;
    repoName?: string;
    openFilesRepoName?: string;
}
export interface KnowledgeMachineWorkspaceResolution {
    ok: boolean;
    source: KnowledgeMachineWorkspaceSource;
    adapter: KnowledgeMachinesAdapterStatus;
    requested_machine_id: string;
    machine_id: string | null;
    project_id: string;
    repo_name: string;
    project_root: string | null;
    project_root_source: KnowledgeMachineWorkspacePathSource;
    workspace_root: string | null;
    workspace_root_source: KnowledgeMachineWorkspacePathSource;
    open_files_root: string | null;
    open_files_root_source: KnowledgeMachineWorkspacePathSource;
    trust_status: KnowledgeMachineTrustStatus;
    auth_status: KnowledgeMachineAuthStatus;
    current: boolean;
    primary: boolean;
    diagnostics: KnowledgeMachineWorkspaceDiagnostic[];
    repair_hints: KnowledgeMachineWorkspaceRepairHint[];
    evidence: Record<string, unknown> | null;
    warnings: string[];
}
export interface KnowledgeMachineRouteResolution {
    target: string;
    route: KnowledgeMachineRouteKind | null;
    targetKind: KnowledgeMachineRouteKind | null;
    confidence: KnowledgeMachineRouteConfidence | null;
    source: KnowledgeMachineRouteSource;
    adapter: KnowledgeMachinesAdapterStatus;
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
    } & KnowledgeMachinesAdapterStatus;
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
    } & KnowledgeMachinesAdapterStatus;
    message: string;
}
export interface KnowledgeMachinesAdapterDefaults {
    mode?: KnowledgeMachinesAdapterMode;
    includeTailscale?: boolean;
    runner?: KnowledgeMachineCommandRunner;
    preflightRunner?: KnowledgeMachinePreflightRunner;
    now?: Date;
    loadOpenMachines?: () => Promise<OpenMachinesModule | null>;
}
export interface KnowledgeMachinesAdapter {
    readonly mode: KnowledgeMachinesAdapterMode;
    status(): Promise<KnowledgeMachinesAdapterStatus>;
    topology(options?: Omit<KnowledgeMachineTopologyOptions, 'adapterMode'>): Promise<KnowledgeMachineTopology>;
    route(options: Omit<KnowledgeMachineRouteOptions, 'adapterMode'>): Promise<KnowledgeMachineRouteResolution>;
    workspace(options: Omit<KnowledgeMachineWorkspaceOptions, 'adapterMode'>): Promise<KnowledgeMachineWorkspaceResolution>;
    preflight(options?: Omit<KnowledgeMachinePreflightOptions, 'adapterMode'>): Promise<KnowledgeMachinePreflightReport>;
}
interface OpenMachinesModule {
    MACHINES_CONSUMER_CONTRACT?: {
        schema_version?: unknown;
        entrypoint?: unknown;
        capabilities?: unknown;
    };
    MACHINES_CONSUMER_CONTRACT_VERSION?: unknown;
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
    resolveMachineWorkspace?: (options: {
        machineId: string;
        projectId: string;
        repoName?: string;
        openFilesRepoName?: string;
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
export declare function resolveKnowledgeMachineWorkspace(options: KnowledgeMachineWorkspaceOptions): Promise<KnowledgeMachineWorkspaceResolution>;
export declare function preflightKnowledgeMachine(options?: KnowledgeMachinePreflightOptions): Promise<KnowledgeMachinePreflightReport>;
export declare function createKnowledgeMachinesAdapter(defaults?: KnowledgeMachinesAdapterDefaults): KnowledgeMachinesAdapter;
export {};
