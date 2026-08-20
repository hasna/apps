import type { MachinePlatform } from "./types.js";
export declare const MACHINES_CONSUMER_CONTRACT_VERSION = 1;
export declare const MACHINES_PACKAGE_NAME = "@hasna/machines";
export declare const MACHINES_CONSUMER_ENTRYPOINT = "@hasna/machines/consumer";
export declare const MACHINES_CONSUMER_SCHEMA_URI = "https://schemas.example.com/machines/consumer/v1/machines-consumer.schema.json";
export declare const MACHINES_CONSUMER_SCHEMA_ARTIFACT = "schemas/machines-consumer.schema.json";
export declare const DEFAULT_MACHINE_RESOLVER_TTL_MS: number;
export declare const DEFAULT_HEARTBEAT_ONLINE_TTL_MS: number;
export declare const DEFAULT_MACHINE_LIST_LIMIT = 10;
export declare const MACHINE_LIST_ORDER = "updated_at_desc";
export interface TopologyCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export type TopologyCommandRunner = (command: string) => TopologyCommandResult;
export interface MachineTopologyOptions {
    includeTailscale?: boolean;
    runner?: TopologyCommandRunner;
    now?: Date;
    resolverTtlMs?: number | null;
    heartbeatTtlMs?: number | null;
    limit?: number | null;
    offset?: number;
}
export interface MachineRouteHint {
    kind: "local" | "lan" | "tailscale" | "ssh";
    target: string;
    reachable: boolean | null;
}
export interface MachineTopologyEntry {
    machine_id: string;
    /** Legacy manifest identities retained during a canonical stationNN re-key. */
    aliases?: string[];
    friendly_name: string | null;
    display_name: string;
    updated_at: string | null;
    hostname: string | null;
    platform: MachinePlatform | string | null;
    os: string | null;
    user: string | null;
    workspace_path: string | null;
    manifest_declared: boolean;
    heartbeat_status: "online" | "offline" | "unknown";
    last_heartbeat_at: string | null;
    agent: {
        pid: number | null;
        daemon_version: string | null;
        mode: string | null;
        private_metadata: boolean;
        platform: string | null;
        os_version: string | null;
        os_build: string | null;
        arch: string | null;
        uptime_seconds: number | null;
        tool_versions: Record<string, unknown> | null;
        tailscale: Record<string, unknown> | null;
        storage_sync_status: string | null;
        storage_sync_last_error: string | null;
        doctor_summary: Record<string, unknown> | null;
    };
    tailscale: {
        dns_name: string | null;
        ips: string[];
        online: boolean | null;
        active: boolean | null;
        last_seen: string | null;
    };
    ssh: {
        address: string | null;
        route: MachineRouteKind;
        command_target: string | null;
    };
    route_hints: MachineRouteHint[];
    tags: string[];
    metadata: Record<string, unknown>;
}
export interface MachinesContractPackage {
    name: typeof MACHINES_PACKAGE_NAME;
    version: string;
}
export interface MachinesConsumerCapabilities {
    topology: true;
    compatibility: true;
    route_resolution: true;
    cli_json_fallback: true;
    workspace_path_mapping?: true;
    workspace_diagnostics?: true;
    schema_artifacts?: true;
    cacheability_metadata?: true;
    resolver_snapshots?: true;
    field_capability_descriptors?: true;
    project_assignments?: true;
    friendly_machine_names?: true;
    machine_list_pagination?: true;
    note_machine_context?: true;
    machine_trash_policies?: true;
    machine_details?: true;
    browserplan_fleet?: true;
    machine_health?: true;
    fleet_routing?: true;
    command_matrix?: true;
    loop_preflight?: true;
    dispatch_fleet_smoke?: true;
}
export type MachinesConsumerEnvelope = "topology" | "route" | "workspace" | "compatibility" | "resolver_snapshot" | "project_assignments" | "note_machine_context" | "machine_trash_policies" | "machine_details" | "browserplan_fleet" | "machine_health" | "routing" | "command_matrix" | "loop_preflight";
export interface MachinesConsumerFieldCapabilities {
    topology: {
        machine_identity: true;
        friendly_names: true;
        display_name_fallback: true;
        recent_ordering: true;
        pagination: true;
        route_hints: true;
        tailscale_status: true;
        manifest_metadata: true;
    };
    route: {
        cacheability: true;
        confidence: true;
        resolver_evidence: true;
    };
    workspace: {
        cacheability: true;
        path_mapping: true;
        diagnostics: true;
        repair_hints: true;
        trust_auth: true;
    };
    compatibility: {
        commands: true;
        packages: true;
        workspaces: true;
    };
    resolver_snapshot: {
        cacheability: true;
        redacted_provenance: true;
    };
    project_assignments: {
        open_projects_compatibility: true;
        machine_project_index: true;
        manifest_metadata_source: true;
    };
    note_machine_context: {
        ownership_machine_ids: true;
        source_target_machine_ids: true;
        display_name_fallback: true;
        sync_targets: true;
        actor_context: true;
        unknown_machine_fallback: true;
    };
    machine_trash_policies: {
        per_machine: true;
        retention_metadata: true;
        manifest_metadata_source: true;
        display_name_fallback: true;
    };
    machine_details: {
        friendly_name_fallback: true;
        status_label: true;
        safe_display_metadata: true;
        role_capabilities: true;
        recent_sync_timestamps: true;
        source_metadata: true;
    };
    browserplan_fleet: {
        machine001_machine011_target: true;
        spark_exclusion: true;
        remote_operation_hooks: true;
        install_state_detection: true;
        route_reachability: true;
        workspace_summary: true;
    };
    agent_abstractions: {
        compact_json_defaults: true;
        bounded_machine_lists: true;
        raw_artifact_refs: true;
        private_route_redaction: true;
        dry_run_plans: true;
        authenticated_execution_probe: true;
        loop_readiness: true;
        command_matrix: true;
        machine_health: true;
        fleet_routing: true;
    };
    dispatch_fleet_smoke?: {
        dry_run: true;
        redacted_output: true;
        package_version: true;
        route_health: true;
        daemon_restart_readiness: true;
    };
}
export interface MachinesConsumerContract {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package_name: typeof MACHINES_PACKAGE_NAME;
    entrypoint: typeof MACHINES_CONSUMER_ENTRYPOINT;
    schema_uri: typeof MACHINES_CONSUMER_SCHEMA_URI;
    schema_artifact: typeof MACHINES_CONSUMER_SCHEMA_ARTIFACT;
    capabilities: MachinesConsumerCapabilities;
    field_capabilities: MachinesConsumerFieldCapabilities;
    cacheability: {
        default_ttl_ms: typeof DEFAULT_MACHINE_RESOLVER_TTL_MS;
        stale_requires_refresh: true;
    };
    envelopes: MachinesConsumerEnvelope[];
    stable_exports: string[];
}
export declare const MACHINES_CONSUMER_CAPABILITIES: MachinesConsumerCapabilities;
export declare const MACHINES_CONSUMER_FIELD_CAPABILITIES: MachinesConsumerFieldCapabilities;
export declare const MACHINES_CONSUMER_CONTRACT: MachinesConsumerContract;
export declare function getMachinesConsumerCapabilities(): MachinesConsumerCapabilities;
export interface MachineTopology {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package: MachinesContractPackage;
    capabilities: MachinesConsumerCapabilities;
    generated_at: string;
    local_machine_id: string;
    local_hostname: string;
    current_platform: MachinePlatform | string;
    manifest_path_known: boolean;
    pagination: MachineListPagination;
    machines: MachineTopologyEntry[];
    warnings: string[];
}
export interface MachineListPagination {
    limit: number | null;
    offset: number;
    total: number;
    count: number;
    hasMore: boolean;
    nextOffset: number | null;
    has_more: boolean;
    next_offset: number | null;
    order: typeof MACHINE_LIST_ORDER;
}
export type MachineRouteKind = "local" | "lan" | "tailscale" | "ssh" | "unknown";
export type MachineRouteConfidence = "exact" | "high" | "medium" | "low" | "none";
export type MachineResolverAuthority = "machines" | "manifest" | "manifest_metadata" | "live_topology" | "argument" | "inferred" | "fallback" | "unresolved" | "mixed" | "unknown";
export interface MachineResolverCacheability {
    observed_at: string;
    verified_at: string | null;
    expires_at: string | null;
    ttl_ms: number | null;
    source_authority: MachineResolverAuthority;
    confidence: MachineRouteConfidence;
    cacheable: boolean;
    stale: boolean;
    reasons: string[];
}
export interface MachineRouteResolution {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package: MachinesContractPackage;
    ok: boolean;
    machine_id: string | null;
    requested_machine_id: string;
    generated_at: string;
    route: MachineRouteKind;
    source: MachineRouteKind;
    target: string | null;
    command_target: string | null;
    confidence: MachineRouteConfidence;
    local: boolean;
    evidence: {
        topology: boolean;
        matched_by: "machine_id" | "alias" | "hostname" | "tailscale" | "route_target" | "local_alias" | "fallback" | null;
        manifest_declared: boolean | null;
        heartbeat_status: MachineTopologyEntry["heartbeat_status"] | null;
        tailscale_online: boolean | null;
        selected_hint: MachineRouteHint | null;
    };
    cacheability: MachineResolverCacheability;
    warnings: string[];
}
export interface MachineRouteOptions extends MachineTopologyOptions {
    topology?: MachineTopology;
}
export interface PublicOutputOptions {
    privateMetadata?: boolean;
}
export type MachineWorkspacePathSource = "argument" | "manifest" | "manifest_metadata" | "inferred" | "unresolved";
export type MachineWorkspaceTrustStatus = "trusted" | "untrusted" | "unknown";
export type MachineWorkspaceAuthStatus = "authenticated" | "unauthenticated" | "unknown";
export interface MachineWorkspacePath {
    path: string | null;
    source: MachineWorkspacePathSource;
}
export type MachineWorkspaceDiagnosticStatus = "ok" | "missing" | "inferred" | "stale" | "untrusted" | "unknown_auth" | "missing_manifest";
export interface MachineWorkspaceDiagnostic {
    id: string;
    status: MachineWorkspaceDiagnosticStatus;
    severity: "ok" | "warn" | "fail";
    message: string;
    path: string | null;
    source: MachineWorkspacePathSource | "manifest" | "trust" | "auth";
    path_exists: boolean | null;
}
export interface MachineWorkspaceRepairHint {
    id: string;
    reason: string;
    command: string[];
    shell_command: string;
    apply_command: string[];
    apply_shell_command: string;
}
export interface MachineWorkspaceProject {
    project_id: string;
    repo_name: string | null;
    canonical: boolean;
}
export interface MachineWorkspaceResolution {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package: MachinesContractPackage;
    ok: boolean;
    requested_machine_id: string;
    machine_id: string | null;
    generated_at: string;
    project: MachineWorkspaceProject;
    machine: {
        current: boolean;
        primary: boolean;
        trust_status: MachineWorkspaceTrustStatus;
        auth_status: MachineWorkspaceAuthStatus;
    };
    paths: {
        workspace_root: MachineWorkspacePath;
        project_root: MachineWorkspacePath;
        open_files_root: MachineWorkspacePath;
    };
    diagnostics: MachineWorkspaceDiagnostic[];
    repair_hints: MachineWorkspaceRepairHint[];
    evidence: {
        topology: boolean;
        matched_by: MachineRouteResolution["evidence"]["matched_by"];
        manifest_declared: boolean | null;
        metadata_keys: string[];
    };
    cacheability: MachineResolverCacheability;
    warnings: string[];
}
export interface MachineWorkspaceOptions extends MachineTopologyOptions {
    machineId: string;
    projectId: string;
    repoName?: string;
    openFilesRepoName?: string;
    primaryMachineId?: string;
    workspaceRoot?: string;
    projectRoot?: string;
    openFilesRoot?: string;
    topology?: MachineTopology;
}
export declare function discoverMachineTopology(options?: MachineTopologyOptions): MachineTopology;
export declare function redactTopologyForOutput(topology: MachineTopology, options?: PublicOutputOptions): MachineTopology;
/** Resolve a topology machine by its canonical id or a retained manifest alias. */
export declare function findMachineTopologyEntry(topology: MachineTopology, machineId: string): MachineTopologyEntry | null;
export declare function resolveMachineRoute(machineId: string, options?: MachineRouteOptions): MachineRouteResolution;
export declare function redactRouteForOutput(route: MachineRouteResolution, options?: PublicOutputOptions): MachineRouteResolution;
export declare function resolveMachineWorkspace(options: MachineWorkspaceOptions): MachineWorkspaceResolution;
export interface MachineResolverSnapshotRoute {
    ok: boolean;
    source: MachineRouteKind;
    route: MachineRouteKind;
    target: string | null;
    command_target: string | null;
    confidence: MachineRouteConfidence;
    local: boolean;
    cacheability: MachineResolverCacheability;
}
export interface MachineResolverSnapshotWorkspace {
    ok: boolean;
    project: MachineWorkspaceProject;
    machine: MachineWorkspaceResolution["machine"];
    paths: MachineWorkspaceResolution["paths"];
    diagnostics: MachineWorkspaceDiagnostic[];
    repair_hints: MachineWorkspaceRepairHint[];
    cacheability: MachineResolverCacheability;
}
export interface MachineResolverSnapshot {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package: MachinesContractPackage;
    generated_at: string;
    requested_machine_id: string;
    machine_id: string | null;
    route: MachineResolverSnapshotRoute;
    workspace: MachineResolverSnapshotWorkspace | null;
    cacheability: MachineResolverCacheability;
    warnings: string[];
    provenance: {
        route: {
            schema_version: number;
            generated_at: string;
            evidence: {
                matched_by: MachineRouteResolution["evidence"]["matched_by"];
                manifest_declared: boolean | null;
                heartbeat_status: MachineTopologyEntry["heartbeat_status"] | null;
                tailscale_online: boolean | null;
                selected_hint_kind: MachineRouteKind | null;
            };
        };
        workspace: {
            schema_version: number;
            generated_at: string;
            metadata_keys: string[];
            matched_by: MachineRouteResolution["evidence"]["matched_by"];
            manifest_declared: boolean | null;
        } | null;
    };
}
export interface CreateMachineResolverSnapshotOptions {
    route: MachineRouteResolution;
    workspace?: MachineWorkspaceResolution | null;
    now?: Date;
    resolverTtlMs?: number | null;
}
export declare function createMachineResolverSnapshot(options: CreateMachineResolverSnapshotOptions): MachineResolverSnapshot;
export declare function getLocalMachineTopology(options?: MachineTopologyOptions): MachineTopologyEntry;
