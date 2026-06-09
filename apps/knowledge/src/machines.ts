import { spawnSync } from 'node:child_process';
import { hostname, platform, userInfo } from 'node:os';
import { HASNA_KNOWLEDGE_APP_PATH } from './workspace';

export interface KnowledgeMachineCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type KnowledgeMachineCommandRunner = (command: string) => KnowledgeMachineCommandResult | Promise<KnowledgeMachineCommandResult>;

export type KnowledgeMachinePreflightSource = 'open-machines' | 'local' | 'ssh';
export type KnowledgeMachinePreflightStatus = 'ok' | 'warn' | 'fail';
export const KNOWLEDGE_MACHINES_ADAPTER_CONTRACT_VERSION = 1;
export const KNOWLEDGE_MACHINES_ADAPTER_PACKAGE = '@hasna/machines';
export const KNOWLEDGE_MACHINES_ADAPTER_ENTRYPOINT = '@hasna/machines/consumer';
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

export type KnowledgeMachineRouteSource = 'open-machines' | 'registry' | 'raw';
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

export type KnowledgeMachineWorkspaceSource = 'open-machines' | 'registry' | 'argument' | 'raw';
export type KnowledgeMachineWorkspacePathSource = 'argument' | 'manifest' | 'manifest_metadata' | 'inferred' | 'unresolved' | string;
export type KnowledgeMachineTrustStatus = 'trusted' | 'untrusted' | 'unknown' | string;
export type KnowledgeMachineAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown' | string;
export type KnowledgeMachineWorkspaceDiagnosticStatus =
  | 'ok'
  | 'missing'
  | 'inferred'
  | 'stale'
  | 'untrusted'
  | 'unknown_auth'
  | 'missing_manifest'
  | string;

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
  discoverMachineTopology?: (options?: { includeTailscale?: boolean; runner?: unknown; now?: Date }) => unknown;
  resolveMachineRoute?: (machineId: string, options?: { includeTailscale?: boolean; runner?: unknown; now?: Date }) => unknown;
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

interface OpenMachinesEntry {
  machine_id?: unknown;
  hostname?: unknown;
  platform?: unknown;
  os?: unknown;
  user?: unknown;
  workspace_path?: unknown;
  manifest_declared?: unknown;
  heartbeat_status?: unknown;
  last_heartbeat_at?: unknown;
  tailscale?: unknown;
  ssh?: unknown;
  route_hints?: unknown;
  tags?: unknown;
  metadata?: unknown;
}

interface TailscalePeer {
  HostName?: string;
  DNSName?: string;
  OS?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  Active?: boolean;
  LastSeen?: string;
}

interface TailscaleStatus {
  Self?: TailscalePeer;
  Peer?: Record<string, TailscalePeer>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizePlatform(value: string = platform()): string {
  const normalized = value.toLowerCase();
  if (normalized === 'darwin' || normalized === 'macos') return 'macos';
  if (normalized === 'win32' || normalized === 'windows') return 'windows';
  if (normalized === 'linux') return 'linux';
  return value;
}

function defaultRunner(command: string): KnowledgeMachineCommandResult {
  const result = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    env: process.env,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

async function runCommand(runner: KnowledgeMachineCommandRunner, command: string): Promise<KnowledgeMachineCommandResult> {
  return await runner(command);
}

async function hasCommand(command: string, runner: KnowledgeMachineCommandRunner): Promise<boolean> {
  const result = await runCommand(runner, `command -v ${command} >/dev/null 2>&1`);
  return result.exitCode === 0;
}

function parseTailscaleStatus(raw: string): TailscaleStatus | null {
  try {
    const parsed = JSON.parse(raw) as TailscaleStatus;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function peerKey(peer: TailscalePeer | undefined): string | null {
  if (!peer) return null;
  return peer.HostName ?? peer.DNSName?.split('.')[0] ?? null;
}

async function loadTailscalePeers(runner: KnowledgeMachineCommandRunner, warnings: string[]): Promise<{ peers: Map<string, TailscalePeer>; selfKey: string | null }> {
  const peers = new Map<string, TailscalePeer>();
  if (!await hasCommand('tailscale', runner)) {
    warnings.push('tailscale_not_available');
    return { peers, selfKey: null };
  }

  const result = await runCommand(runner, 'tailscale status --json');
  if (result.exitCode !== 0) {
    warnings.push(`tailscale_status_failed:${result.stderr.trim() || result.exitCode}`);
    return { peers, selfKey: null };
  }

  const status = parseTailscaleStatus(result.stdout);
  if (!status) {
    warnings.push('tailscale_status_invalid_json');
    return { peers, selfKey: null };
  }

  const addPeer = (peer?: TailscalePeer) => {
    const key = peerKey(peer);
    if (key && peer) peers.set(key, peer);
  };
  addPeer(status.Self);
  for (const peer of Object.values(status.Peer ?? {})) addPeer(peer);
  return { peers, selfKey: peerKey(status.Self) };
}

function localMachineId(fallback: string | null): string {
  return process.env.HASNA_MACHINE_ID
    ?? process.env.OPEN_MACHINES_MACHINE_ID
    ?? process.env.MACHINE_ID
    ?? fallback
    ?? hostname();
}

function buildLocalEntry(input: {
  machineId: string;
  localMachineId: string;
  peer?: TailscalePeer;
}): KnowledgeMachineEntry {
  const local = input.machineId === input.localMachineId || input.machineId === hostname();
  const dnsName = input.peer?.DNSName?.replace(/\.$/, '') ?? null;
  const tailscaleTarget = dnsName ?? input.peer?.TailscaleIPs?.[0] ?? null;
  const hints: KnowledgeMachineRouteHint[] = [];
  if (local) hints.push({ kind: 'local', target: 'localhost', reachable: true });
  if (tailscaleTarget) hints.push({ kind: 'tailscale', target: tailscaleTarget, reachable: input.peer?.Online ?? null });
  const selectedRoute = hints.find((hint) => hint.kind === 'local') ?? hints.find((hint) => hint.kind === 'tailscale') ?? null;

  return {
    machine_id: input.machineId,
    hostname: input.peer?.HostName ?? (local ? hostname() : input.machineId),
    local,
    platform: input.peer?.OS ? normalizePlatform(input.peer.OS) : local ? normalizePlatform() : null,
    os: input.peer?.OS ?? (local ? platform() : null),
    user: local ? userInfo().username : null,
    workspace_path: null,
    manifest_declared: false,
    heartbeat_status: 'unknown',
    last_heartbeat_at: null,
    tailscale: {
      dns_name: dnsName,
      ips: input.peer?.TailscaleIPs ?? [],
      online: input.peer?.Online ?? null,
      active: input.peer?.Active ?? null,
      last_seen: input.peer?.LastSeen ?? null,
    },
    ssh: {
      address: null,
      route: selectedRoute?.kind === 'local' ? 'local' : selectedRoute?.kind === 'tailscale' ? 'tailscale' : 'unknown',
      command_target: selectedRoute?.target ?? null,
    },
    route_hints: hints,
    tags: [],
    metadata: {},
    source: 'local',
  };
}

function normalizeRouteHints(value: unknown): KnowledgeMachineRouteHint[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = asRecord(entry);
    const kind = asString(record.kind) ?? 'unknown';
    const routeKind: KnowledgeMachineRouteHint['kind'] = kind === 'local' || kind === 'lan' || kind === 'tailscale' || kind === 'ssh' ? kind : 'unknown';
    return {
      kind: routeKind,
      target: asString(record.target) ?? '',
      reachable: asBooleanOrNull(record.reachable),
    };
  }).filter((entry) => entry.target.length > 0);
}

function normalizeOpenMachinesEntry(entry: OpenMachinesEntry, localMachineId: string): KnowledgeMachineEntry {
  const machineId = asString(entry.machine_id) ?? asString(entry.hostname) ?? 'unknown';
  const tailscale = asRecord(entry.tailscale);
  const ssh = asRecord(entry.ssh);
  const heartbeatStatus = asString(entry.heartbeat_status);
  const route = asString(ssh.route);
  return {
    machine_id: machineId,
    hostname: asString(entry.hostname),
    local: machineId === localMachineId,
    platform: asString(entry.platform),
    os: asString(entry.os),
    user: asString(entry.user),
    workspace_path: asString(entry.workspace_path),
    manifest_declared: entry.manifest_declared === true,
    heartbeat_status: heartbeatStatus === 'online' || heartbeatStatus === 'offline' ? heartbeatStatus : 'unknown',
    last_heartbeat_at: asString(entry.last_heartbeat_at),
    tailscale: {
      dns_name: asString(tailscale.dns_name),
      ips: asStringArray(tailscale.ips),
      online: asBooleanOrNull(tailscale.online),
      active: asBooleanOrNull(tailscale.active),
      last_seen: asString(tailscale.last_seen),
    },
    ssh: {
      address: asString(ssh.address),
      route: route === 'local' || route === 'lan' || route === 'tailscale' ? route : 'unknown',
      command_target: asString(ssh.command_target),
    },
    route_hints: normalizeRouteHints(entry.route_hints),
    tags: asStringArray(entry.tags),
    metadata: asRecord(entry.metadata),
    source: 'open-machines',
  };
}

function topologyMessage(source: KnowledgeMachineTopology['source'], count: number): string {
  return `${count} machine${count === 1 ? '' : 's'} discovered via ${source}`;
}

function optionalModuleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot find module '@hasna/machines'") || message.includes("Cannot find module '@hasna/machines/consumer'")
    ? 'module_not_found'
    : message;
}

function adapterMode(options: { adapterMode?: KnowledgeMachinesAdapterMode }): KnowledgeMachinesAdapterMode {
  return options.adapterMode ?? 'auto';
}

function contractVersion(mod: OpenMachinesModule | null): number | null {
  const fromContract = mod?.MACHINES_CONSUMER_CONTRACT?.schema_version;
  if (typeof fromContract === 'number') return fromContract;
  const direct = mod?.MACHINES_CONSUMER_CONTRACT_VERSION;
  return typeof direct === 'number' ? direct : null;
}

function payloadContractVersion(value: Record<string, unknown>): number | null {
  return typeof value.schema_version === 'number' ? value.schema_version : null;
}

function unsupportedContractVersion(version: number | null): number | null {
  return typeof version === 'number' && version > KNOWLEDGE_MACHINES_ADAPTER_CONTRACT_VERSION ? version : null;
}

function adapterStatus(input: {
  mode: KnowledgeMachinesAdapterMode;
  implementation: KnowledgeMachinesAdapterImplementation;
  available: boolean;
  error?: string | null;
  contractVersion?: number | null;
}): KnowledgeMachinesAdapterStatus {
  return {
    package: KNOWLEDGE_MACHINES_ADAPTER_PACKAGE,
    entrypoint: KNOWLEDGE_MACHINES_ADAPTER_ENTRYPOINT,
    mode: input.mode,
    implementation: input.implementation,
    contract_version: input.contractVersion ?? null,
    available: input.available,
    error: input.error ?? null,
  };
}

function disabledAdapterStatus(mode: KnowledgeMachinesAdapterMode, error = 'adapter_disabled'): KnowledgeMachinesAdapterStatus {
  return adapterStatus({
    mode,
    implementation: 'disabled',
    available: false,
    error,
  });
}

function unsupportedContractAdapterStatus(mode: KnowledgeMachinesAdapterMode, mod: OpenMachinesModule | null): KnowledgeMachinesAdapterStatus | null {
  const version = unsupportedContractVersion(contractVersion(mod));
  if (!version) return null;
  return adapterStatus({
    mode,
    implementation: 'disabled',
    available: false,
    error: `unsupported_contract_version:${version}`,
    contractVersion: version,
  });
}

function cliAdapterStatus(mode: KnowledgeMachinesAdapterMode): KnowledgeMachinesAdapterStatus {
  return adapterStatus({
    mode,
    implementation: 'cli',
    available: true,
  });
}

function sdkAdapterStatus(mode: KnowledgeMachinesAdapterMode, mod: OpenMachinesModule | null): KnowledgeMachinesAdapterStatus {
  return adapterStatus({
    mode,
    implementation: 'sdk',
    available: true,
    contractVersion: contractVersion(mod),
  });
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function machinesCliCommand(args: string[]): string {
  return ['machines', ...args].map(shellQuote).join(' ');
}

function preflightTargetIsLocal(machineId: string): boolean {
  return machineId === 'local'
    || machineId === 'localhost'
    || machineId === hostname()
    || machineId === process.env.HASNA_MACHINE_ID
    || machineId === process.env.OPEN_MACHINES_MACHINE_ID
    || machineId === process.env.MACHINE_ID;
}

function defaultPreflightRunner(machineId: string, command: string): KnowledgeMachinePreflightCommandResult {
  const local = preflightTargetIsLocal(machineId);
  const shellCommand = local ? command : `ssh ${shellQuote(machineId)} ${shellQuote(command)}`;
  const result = spawnSync('bash', ['-c', shellCommand], {
    encoding: 'utf8',
    env: process.env,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
    source: local ? 'local' : 'ssh',
  };
}

async function runPreflightCommand(
  runner: KnowledgeMachinePreflightRunner,
  machineId: string,
  command: string,
): Promise<KnowledgeMachinePreflightCommandResult> {
  return await runner(machineId, command);
}

function preflightStatus(required: boolean | undefined, ok: boolean): KnowledgeMachinePreflightStatus {
  if (ok) return 'ok';
  return required === false ? 'warn' : 'fail';
}

function preflightId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.@/-]+/g, '-').replace(/^-+|-+$/g, '');
}

function packageCommand(name: string): string {
  if (name === '@hasna/knowledge') return 'knowledge';
  if (name === '@hasna/machines') return 'machines';
  return name.split('/').pop() ?? name;
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/).find(Boolean) ?? '';
}

function extractVersion(value: string): string | null {
  const match = value.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match?.[0] ?? null;
}

function parseKeyValue(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    result[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return result;
}

function makePreflightCheck(input: {
  id: string;
  kind: KnowledgeMachinePreflightCheck['kind'];
  status: KnowledgeMachinePreflightStatus;
  target: string;
  expected?: string | null;
  actual?: string | null;
  detail: string;
  source: KnowledgeMachinePreflightSource;
}): KnowledgeMachinePreflightCheck {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    target: input.target,
    expected: input.expected ?? null,
    actual: input.actual ?? null,
    detail: input.detail,
    source: input.source,
  };
}

async function inspectPreflightCommand(
  machineId: string,
  spec: KnowledgeMachinePreflightCommandSpec,
  runner: KnowledgeMachinePreflightRunner,
): Promise<{ path: string | null; version: string | null; stderr: string; source: KnowledgeMachinePreflightSource }> {
  const script = [
    `cmd=${shellQuote(spec.command)}`,
    'path="$(command -v "$cmd" 2>/dev/null || true)"',
    'printf "path=%s\\n" "$path"',
    `if [ -n "$path" ]; then version="$("$cmd" ${spec.versionArgs ?? '--version'} 2>/dev/null || true)"; printf "version=%s\\n" "$version"; fi`,
  ].join('; ');
  const result = await runPreflightCommand(runner, machineId, script);
  const parsed = parseKeyValue(result.stdout);
  return {
    path: parsed.path || null,
    version: parsed.version ? firstLine(parsed.version) : null,
    stderr: result.stderr,
    source: result.source ?? (preflightTargetIsLocal(machineId) ? 'local' : 'ssh'),
  };
}

function jsonFieldCommand(field: 'name' | 'version'): string {
  const regex = field === 'name'
    ? String.raw`s/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p`
    : String.raw`s/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p`;
  return [
    `if command -v bun >/dev/null 2>&1; then bun -e "const p=JSON.parse(await Bun.file(process.argv[1]).text()); console.log(p.${field} ?? '')" "$pkg" 2>/dev/null`,
    `elif command -v node >/dev/null 2>&1; then node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p.${field} || '')" "$pkg" 2>/dev/null`,
    `else sed -n '${regex}' "$pkg" | head -n 1`,
    'fi',
  ].join('; ');
}

async function inspectPreflightWorkspace(
  machineId: string,
  spec: KnowledgeMachinePreflightWorkspaceSpec,
  runner: KnowledgeMachinePreflightRunner,
): Promise<{ exists: boolean; packageJson: boolean; packageName: string | null; version: string | null; stderr: string; source: KnowledgeMachinePreflightSource }> {
  const script = [
    `path=${shellQuote(spec.path)}`,
    'printf "exists=%s\\n" "$(test -d "$path" && printf yes || printf no)"',
    'pkg="$path/package.json"',
    'printf "package_json=%s\\n" "$(test -f "$pkg" && printf yes || printf no)"',
    `if [ -f "$pkg" ]; then printf "package_name=%s\\n" "$(${jsonFieldCommand('name')})"; printf "version=%s\\n" "$(${jsonFieldCommand('version')})"; fi`,
  ].join('; ');
  const result = await runPreflightCommand(runner, machineId, script);
  const parsed = parseKeyValue(result.stdout);
  return {
    exists: parsed.exists === 'yes',
    packageJson: parsed.package_json === 'yes',
    packageName: parsed.package_name || null,
    version: parsed.version || null,
    stderr: result.stderr,
    source: result.source ?? (preflightTargetIsLocal(machineId) ? 'local' : 'ssh'),
  };
}

async function fallbackCommandChecks(
  machineId: string,
  spec: KnowledgeMachinePreflightCommandSpec,
  runner: KnowledgeMachinePreflightRunner,
): Promise<KnowledgeMachinePreflightCheck[]> {
  const inspection = await inspectPreflightCommand(machineId, spec, runner);
  const found = Boolean(inspection.path);
  const checks = [
    makePreflightCheck({
      id: `command:${preflightId(spec.command)}:path`,
      kind: 'command',
      status: preflightStatus(spec.required, found),
      target: spec.command,
      expected: 'available',
      actual: inspection.path ?? 'missing',
      detail: found ? `found at ${inspection.path}` : inspection.stderr || 'command missing',
      source: inspection.source,
    }),
  ];
  if (spec.expectedVersion) {
    const actualVersion = extractVersion(inspection.version ?? '');
    checks.push(makePreflightCheck({
      id: `command:${preflightId(spec.command)}:version`,
      kind: 'command',
      status: actualVersion === spec.expectedVersion ? 'ok' : preflightStatus(spec.required, false),
      target: spec.command,
      expected: spec.expectedVersion,
      actual: actualVersion ?? inspection.version ?? 'missing',
      detail: actualVersion ? `version output: ${inspection.version}` : 'version unavailable',
      source: inspection.source,
    }));
  }
  return checks;
}

async function fallbackPackageChecks(
  machineId: string,
  spec: KnowledgeMachinePreflightPackageSpec,
  runner: KnowledgeMachinePreflightRunner,
): Promise<KnowledgeMachinePreflightCheck[]> {
  const command = spec.command ?? packageCommand(spec.name);
  const inspection = await inspectPreflightCommand(machineId, { command, expectedVersion: spec.expectedVersion, required: spec.required }, runner);
  const found = Boolean(inspection.path);
  const checks = [
    makePreflightCheck({
      id: `package:${preflightId(spec.name)}:command`,
      kind: 'package',
      status: preflightStatus(spec.required, found),
      target: spec.name,
      expected: command,
      actual: inspection.path ?? 'missing',
      detail: found ? `${command} found at ${inspection.path}` : `${command} command missing`,
      source: inspection.source,
    }),
  ];
  if (spec.expectedVersion) {
    const actualVersion = extractVersion(inspection.version ?? '');
    checks.push(makePreflightCheck({
      id: `package:${preflightId(spec.name)}:version`,
      kind: 'package',
      status: actualVersion === spec.expectedVersion ? 'ok' : preflightStatus(spec.required, false),
      target: spec.name,
      expected: spec.expectedVersion,
      actual: actualVersion ?? inspection.version ?? 'missing',
      detail: actualVersion ? `version output: ${inspection.version}` : 'version unavailable',
      source: inspection.source,
    }));
  }
  return checks;
}

async function fallbackWorkspaceChecks(
  machineId: string,
  spec: KnowledgeMachinePreflightWorkspaceSpec,
  runner: KnowledgeMachinePreflightRunner,
): Promise<KnowledgeMachinePreflightCheck[]> {
  const inspection = await inspectPreflightWorkspace(machineId, spec, runner);
  const target = spec.label ?? spec.path;
  const checks = [
    makePreflightCheck({
      id: `workspace:${preflightId(target)}:path`,
      kind: 'workspace',
      status: preflightStatus(spec.required, inspection.exists),
      target,
      expected: spec.path,
      actual: inspection.exists ? 'exists' : 'missing',
      detail: inspection.exists ? `workspace exists at ${spec.path}` : inspection.stderr || `workspace missing at ${spec.path}`,
      source: inspection.source,
    }),
  ];
  if (spec.expectedPackageName) {
    checks.push(makePreflightCheck({
      id: `workspace:${preflightId(target)}:package-name`,
      kind: 'workspace',
      status: inspection.packageName === spec.expectedPackageName ? 'ok' : preflightStatus(spec.required, false),
      target,
      expected: spec.expectedPackageName,
      actual: inspection.packageName ?? (inspection.packageJson ? 'missing-name' : 'missing-package-json'),
      detail: inspection.packageJson ? 'package.json inspected' : 'package.json missing',
      source: inspection.source,
    }));
  }
  if (spec.expectedVersion) {
    checks.push(makePreflightCheck({
      id: `workspace:${preflightId(target)}:version`,
      kind: 'workspace',
      status: inspection.version === spec.expectedVersion ? 'ok' : preflightStatus(spec.required, false),
      target,
      expected: spec.expectedVersion,
      actual: inspection.version ?? (inspection.packageJson ? 'missing-version' : 'missing-package-json'),
      detail: inspection.packageJson ? 'package.json inspected' : 'package.json missing',
      source: inspection.source,
    }));
  }
  return checks;
}

function withKnowledgeContext(
  topology: Omit<KnowledgeMachineTopology, 'knowledge' | 'message'>,
  options: KnowledgeMachineTopologyOptions,
): KnowledgeMachineTopology {
  return {
    ...topology,
    knowledge: {
      scope: options.knowledge?.scope ?? 'global',
      app_path: HASNA_KNOWLEDGE_APP_PATH,
      workspace_home: options.knowledge?.workspace_home ?? null,
    },
    message: topologyMessage(topology.source, topology.machines.length),
  };
}

async function loadOpenMachinesModule(): Promise<OpenMachinesModule | null> {
  try {
    const specifier = '@hasna/machines/consumer';
    return await import(specifier) as OpenMachinesModule;
  } catch (error) {
    if (optionalModuleError(error) !== 'module_not_found') throw error;
    const specifier = '@hasna/machines';
    return await import(specifier) as OpenMachinesModule;
  }
}

function normalizeOpenMachinesTopology(value: unknown, options: KnowledgeMachineTopologyOptions, adapter: KnowledgeMachinesAdapterStatus): KnowledgeMachineTopology | null {
  const raw = asRecord(value);
  if (unsupportedContractVersion(payloadContractVersion(raw))) return null;
  const machines = Array.isArray(raw.machines) ? raw.machines as OpenMachinesEntry[] : null;
  const localMachine = asString(raw.local_machine_id);
  if (!machines || !localMachine) return null;
  const topology = {
    ok: true as const,
    source: 'open-machines' as const,
    generated_at: asString(raw.generated_at) ?? (options.now ?? new Date()).toISOString(),
    local_machine_id: localMachine,
    local_hostname: asString(raw.local_hostname) ?? hostname(),
    current_platform: asString(raw.current_platform) ?? normalizePlatform(),
    machines: machines.map((machine) => normalizeOpenMachinesEntry(machine, localMachine)),
    warnings: asStringArray(raw.warnings),
    adapter,
  };
  return withKnowledgeContext(topology, options);
}

function normalizeRouteKind(value: unknown): KnowledgeMachineRouteKind | null {
  return value === 'local'
    || value === 'lan'
    || value === 'tailscale'
    || value === 'ssh'
    || value === 'unknown'
    ? value
    : null;
}

function normalizeOpenMachinesRoute(value: unknown, adapter: KnowledgeMachinesAdapterStatus): KnowledgeMachineRouteResolution | null {
  const raw = asRecord(value);
  if (unsupportedContractVersion(payloadContractVersion(raw))) return null;
  const target = asString(raw.target) ?? asString(raw.command_target);
  if (raw.ok !== true || !target) return null;
  const evidence = typeof raw.evidence === 'object' && raw.evidence !== null
    ? raw.evidence as Record<string, unknown>
    : null;
  const selectedHint = typeof evidence?.selected_hint === 'object' && evidence.selected_hint !== null
    ? evidence.selected_hint as Record<string, unknown>
    : null;
  return {
    target,
    route: normalizeRouteKind(raw.route),
    targetKind: normalizeRouteKind(selectedHint?.kind) ?? normalizeRouteKind(raw.source) ?? normalizeRouteKind(raw.route),
    confidence: asString(raw.confidence),
    source: 'open-machines',
    adapter,
    evidence,
    warnings: asStringArray(raw.warnings),
  };
}

function pathRecord(value: unknown): { path: string | null; source: KnowledgeMachineWorkspacePathSource } {
  const raw = asRecord(value);
  return {
    path: asString(raw.path),
    source: asString(raw.source) ?? 'unresolved',
  };
}

function normalizeWorkspaceDiagnostics(value: unknown): KnowledgeMachineWorkspaceDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const raw = asRecord(entry);
    const id = asString(raw.id);
    const status = asString(raw.status);
    const severity = asString(raw.severity);
    const message = asString(raw.message);
    if (!id || !status || !severity || !message) return [];
    return [{
      id,
      status,
      severity,
      message,
      path: asString(raw.path),
      source: asString(raw.source) ?? 'unknown',
      path_exists: asBooleanOrNull(raw.path_exists),
    }];
  });
}

function normalizeWorkspaceRepairHints(value: unknown): KnowledgeMachineWorkspaceRepairHint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const raw = asRecord(entry);
    const id = asString(raw.id);
    const reason = asString(raw.reason);
    const command = asStringArray(raw.command);
    const shellCommand = asString(raw.shell_command);
    const applyCommand = asStringArray(raw.apply_command);
    const applyShellCommand = asString(raw.apply_shell_command);
    if (!id || !reason || !command.length || !shellCommand || !applyCommand.length || !applyShellCommand) return [];
    return [{
      id,
      reason,
      command,
      shell_command: shellCommand,
      apply_command: applyCommand,
      apply_shell_command: applyShellCommand,
    }];
  });
}

function fallbackWorkspaceRepairHints(input: {
  requestedMachineId: string;
  projectId: string;
  repoName: string;
  openFilesRepoName?: string | null;
  warnings: string[];
  projectRootSource: KnowledgeMachineWorkspacePathSource;
  openFilesRootSource: KnowledgeMachineWorkspacePathSource;
  trustStatus: KnowledgeMachineTrustStatus;
  authStatus: KnowledgeMachineAuthStatus;
}): KnowledgeMachineWorkspaceRepairHint[] {
  const needsRepair = input.projectRootSource === 'inferred'
    || input.openFilesRootSource === 'inferred'
    || input.trustStatus === 'untrusted'
    || input.authStatus === 'unknown'
    || input.warnings.some((warning) => (
      warning.includes('inferred')
      || warning.includes('untrusted')
      || warning.includes('unknown_auth')
      || warning.includes('missing')
    ));
  if (!needsRepair) return [];
  const command = [
    'machines',
    'workspace',
    'repair',
    '--machine',
    input.requestedMachineId,
    '--project',
    input.projectId,
    '--repo',
    input.repoName,
    '--open-files-repo',
    input.openFilesRepoName ?? 'open-files',
    '--json',
  ];
  const applyCommand = [...command, '--apply'];
  return [{
    id: 'machines_workspace_repair',
    reason: 'Workspace paths or trust metadata need confirmation before remote knowledge sync.',
    command,
    shell_command: command.map(shellQuote).join(' '),
    apply_command: applyCommand,
    apply_shell_command: applyCommand.map(shellQuote).join(' '),
  }];
}

function normalizeOpenMachinesWorkspace(value: unknown, options: KnowledgeMachineWorkspaceOptions, adapter: KnowledgeMachinesAdapterStatus): KnowledgeMachineWorkspaceResolution | null {
  const raw = asRecord(value);
  if (unsupportedContractVersion(payloadContractVersion(raw))) return null;
  const paths = asRecord(raw.paths);
  const project = asRecord(raw.project);
  const machine = asRecord(raw.machine);
  const projectRoot = pathRecord(paths.project_root);
  const workspaceRoot = pathRecord(paths.workspace_root);
  const openFilesRoot = pathRecord(paths.open_files_root);
  if (raw.ok !== true || !projectRoot.path) return null;
  const evidence = typeof raw.evidence === 'object' && raw.evidence !== null
    ? raw.evidence as Record<string, unknown>
    : null;
  const requestedMachineId = asString(raw.requested_machine_id) ?? options.machineId;
  const projectId = asString(project.project_id) ?? options.projectId ?? 'open-knowledge';
  const repoName = asString(project.repo_name) ?? options.repoName ?? options.projectId ?? 'open-knowledge';
  const trustStatus = asString(machine.trust_status) ?? 'unknown';
  const authStatus = asString(machine.auth_status) ?? 'unknown';
  const warnings = asStringArray(raw.warnings);
  const diagnostics = normalizeWorkspaceDiagnostics(raw.diagnostics);
  const repairHints = normalizeWorkspaceRepairHints(raw.repair_hints);
  return {
    ok: true,
    source: 'open-machines',
    adapter,
    requested_machine_id: requestedMachineId,
    machine_id: asString(raw.machine_id),
    project_id: projectId,
    repo_name: repoName,
    project_root: projectRoot.path,
    project_root_source: projectRoot.source,
    workspace_root: workspaceRoot.path,
    workspace_root_source: workspaceRoot.source,
    open_files_root: openFilesRoot.path,
    open_files_root_source: openFilesRoot.source,
    trust_status: trustStatus,
    auth_status: authStatus,
    current: machine.current === true,
    primary: machine.primary === true,
    diagnostics,
    repair_hints: repairHints.length ? repairHints : fallbackWorkspaceRepairHints({
      requestedMachineId,
      projectId,
      repoName,
      openFilesRepoName: options.openFilesRepoName,
      warnings,
      projectRootSource: projectRoot.source,
      openFilesRootSource: openFilesRoot.source,
      trustStatus,
      authStatus,
    }),
    evidence,
    warnings,
  };
}

async function discoverOpenMachinesCliTopology(options: KnowledgeMachineTopologyOptions, adapter: KnowledgeMachinesAdapterStatus): Promise<KnowledgeMachineTopology | null> {
  const runner = options.runner ?? defaultRunner;
  if (!await hasCommand('machines', runner)) return null;
  const args = ['topology', '--json'];
  if (options.includeTailscale === false) args.push('--no-tailscale');
  const result = await runCommand(runner, machinesCliCommand(args));
  if (result.exitCode !== 0) return null;
  return normalizeOpenMachinesTopology(parseJson(result.stdout), options, adapter);
}

async function discoverLocalTopology(options: KnowledgeMachineTopologyOptions, adapter: KnowledgeMachinesAdapterStatus): Promise<KnowledgeMachineTopology> {
  const warnings: string[] = [];
  if (adapter.error) warnings.push(`open_machines_unavailable:${adapter.error}`);
  const runner = options.runner ?? defaultRunner;
  const tailscale = options.includeTailscale === false
    ? { peers: new Map<string, TailscalePeer>(), selfKey: null }
    : await loadTailscalePeers(runner, warnings);
  const localId = localMachineId(tailscale.selfKey);
  const machineIds = new Set<string>([localId, ...tailscale.peers.keys()]);
  const machines = [...machineIds].sort().map((machineId) => buildLocalEntry({
    machineId,
    localMachineId: localId,
    peer: tailscale.peers.get(machineId),
  }));

  return withKnowledgeContext({
    ok: true,
    source: 'local',
    generated_at: (options.now ?? new Date()).toISOString(),
    local_machine_id: localId,
    local_hostname: hostname(),
    current_platform: normalizePlatform(),
    machines,
    warnings,
    adapter,
  }, options);
}

export async function discoverKnowledgeMachineTopology(options: KnowledgeMachineTopologyOptions = {}): Promise<KnowledgeMachineTopology> {
  const mode = adapterMode(options);
  if (mode === 'disabled') return await discoverLocalTopology(options, disabledAdapterStatus(mode));
  const cliStatus = cliAdapterStatus(mode);
  try {
    if (mode !== 'cli') {
      const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
      const mod = await loader();
      const unsupportedStatus = unsupportedContractAdapterStatus(mode, mod);
      if (unsupportedStatus) return await discoverLocalTopology(options, unsupportedStatus);
      const sdkStatus = sdkAdapterStatus(mode, mod);
      if (mod?.discoverMachineTopology) {
        const topology = mod.discoverMachineTopology({
          includeTailscale: options.includeTailscale,
          runner: options.runner,
          now: options.now,
        });
        const normalized = normalizeOpenMachinesTopology(topology, options, sdkStatus);
        if (normalized) return normalized;
        if (mode === 'sdk') return await discoverLocalTopology(options, disabledAdapterStatus(mode, 'invalid_topology_shape'));
        return await discoverOpenMachinesCliTopology(options, cliStatus)
          ?? await discoverLocalTopology(options, disabledAdapterStatus(mode, 'invalid_topology_shape'));
      }
      if (mode === 'sdk') return await discoverLocalTopology(options, disabledAdapterStatus(mode, 'missing_discoverMachineTopology'));
      return await discoverOpenMachinesCliTopology(options, cliStatus)
        ?? await discoverLocalTopology(options, disabledAdapterStatus(mode, 'missing_discoverMachineTopology'));
    }
    return await discoverOpenMachinesCliTopology(options, cliStatus)
      ?? await discoverLocalTopology(options, disabledAdapterStatus(mode, 'machines_cli_unavailable'));
  } catch (error) {
    if (mode === 'sdk') return await discoverLocalTopology(options, disabledAdapterStatus(mode, optionalModuleError(error)));
    return await discoverOpenMachinesCliTopology(options, cliStatus)
      ?? await discoverLocalTopology(options, disabledAdapterStatus(mode, optionalModuleError(error)));
  }
}

async function resolveOpenMachinesCliRoute(options: KnowledgeMachineRouteOptions, adapter: KnowledgeMachinesAdapterStatus): Promise<KnowledgeMachineRouteResolution | null> {
  const runner = options.runner ?? defaultRunner;
  if (!await hasCommand('machines', runner)) return null;
  const args = ['route', '--machine', options.machineId, '--json'];
  if (options.includeTailscale === false) args.push('--no-tailscale');
  const result = await runCommand(runner, machinesCliCommand(args));
  if (result.exitCode !== 0) return null;
  return normalizeOpenMachinesRoute(parseJson(result.stdout), adapter);
}

function rawMachineRoute(machineId: string, adapter: KnowledgeMachinesAdapterStatus): KnowledgeMachineRouteResolution {
  return {
    target: machineId,
    route: null,
    targetKind: null,
    confidence: null,
    source: 'raw',
    adapter,
    evidence: null,
    warnings: [],
  };
}

export async function resolveKnowledgeMachineRoute(options: KnowledgeMachineRouteOptions): Promise<KnowledgeMachineRouteResolution> {
  const mode = adapterMode(options);
  if (mode === 'disabled') return rawMachineRoute(options.machineId, disabledAdapterStatus(mode));
  const cliStatus = cliAdapterStatus(mode);
  try {
    if (mode !== 'cli') {
      const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
      const mod = await loader();
      const unsupportedStatus = unsupportedContractAdapterStatus(mode, mod);
      if (unsupportedStatus) return rawMachineRoute(options.machineId, unsupportedStatus);
      const sdkStatus = sdkAdapterStatus(mode, mod);
      if (mod?.resolveMachineRoute) {
        const normalized = normalizeOpenMachinesRoute(mod.resolveMachineRoute(options.machineId, {
          includeTailscale: options.includeTailscale,
          runner: options.runner,
          now: options.now,
        }), sdkStatus);
        if (normalized) return normalized;
        if (mode === 'sdk') return rawMachineRoute(options.machineId, disabledAdapterStatus(mode, 'invalid_route_shape'));
        return await resolveOpenMachinesCliRoute(options, cliStatus)
          ?? rawMachineRoute(options.machineId, disabledAdapterStatus(mode, 'invalid_route_shape'));
      }
      if (mode === 'sdk') return rawMachineRoute(options.machineId, disabledAdapterStatus(mode, 'missing_resolveMachineRoute'));
      return await resolveOpenMachinesCliRoute(options, cliStatus)
        ?? rawMachineRoute(options.machineId, disabledAdapterStatus(mode, 'missing_resolveMachineRoute'));
    }
    return await resolveOpenMachinesCliRoute(options, cliStatus)
      ?? rawMachineRoute(options.machineId, disabledAdapterStatus(mode, 'machines_cli_unavailable'));
  } catch (error) {
    if (mode === 'sdk') {
      return {
        ...rawMachineRoute(options.machineId, disabledAdapterStatus(mode, optionalModuleError(error))),
        warnings: [optionalModuleError(error)],
      };
    }
    return await resolveOpenMachinesCliRoute(options, cliStatus) ?? {
      ...rawMachineRoute(options.machineId, disabledAdapterStatus(mode, optionalModuleError(error))),
      warnings: [optionalModuleError(error)],
    };
  }
}

async function resolveOpenMachinesCliWorkspace(options: KnowledgeMachineWorkspaceOptions, adapter: KnowledgeMachinesAdapterStatus): Promise<KnowledgeMachineWorkspaceResolution | null> {
  const runner = options.runner ?? defaultRunner;
  if (!await hasCommand('machines', runner)) return null;
  const projectId = options.projectId ?? 'open-knowledge';
  const repoName = options.repoName ?? 'open-knowledge';
  const args = [
    'workspace', 'resolve',
    '--machine', options.machineId,
    '--project', projectId,
    '--repo', repoName,
    '--open-files-repo', options.openFilesRepoName ?? 'open-files',
    '--json',
  ];
  if (options.includeTailscale === false) args.push('--no-tailscale');
  const result = await runCommand(runner, machinesCliCommand(args));
  if (result.exitCode !== 0) return null;
  return normalizeOpenMachinesWorkspace(parseJson(result.stdout), options, adapter);
}

function argumentMachineWorkspace(options: KnowledgeMachineWorkspaceOptions): KnowledgeMachineWorkspaceResolution | null {
  const peerWorkspace = options.peerWorkspace?.trim();
  if (!peerWorkspace) return null;
  const adapter = disabledAdapterStatus(adapterMode(options), 'argument_override');
  return {
    ok: true,
    source: 'argument',
    adapter,
    requested_machine_id: options.machineId,
    machine_id: options.machineId,
    project_id: options.projectId ?? 'open-knowledge',
    repo_name: options.repoName ?? 'open-knowledge',
    project_root: peerWorkspace,
    project_root_source: 'argument',
    workspace_root: null,
    workspace_root_source: 'unresolved',
    open_files_root: null,
    open_files_root_source: 'unresolved',
    trust_status: 'unknown',
    auth_status: 'unknown',
    current: false,
    primary: false,
    diagnostics: [],
    repair_hints: [],
    evidence: null,
    warnings: [],
  };
}

function unresolvedMachineWorkspace(options: KnowledgeMachineWorkspaceOptions, warnings: string[], adapter: KnowledgeMachinesAdapterStatus): KnowledgeMachineWorkspaceResolution {
  return {
    ok: false,
    source: 'raw',
    adapter,
    requested_machine_id: options.machineId,
    machine_id: null,
    project_id: options.projectId ?? 'open-knowledge',
    repo_name: options.repoName ?? 'open-knowledge',
    project_root: null,
    project_root_source: 'unresolved',
    workspace_root: null,
    workspace_root_source: 'unresolved',
    open_files_root: null,
    open_files_root_source: 'unresolved',
    trust_status: 'unknown',
    auth_status: 'unknown',
    current: false,
    primary: false,
    diagnostics: [],
    repair_hints: [],
    evidence: null,
    warnings,
  };
}

export async function resolveKnowledgeMachineWorkspace(options: KnowledgeMachineWorkspaceOptions): Promise<KnowledgeMachineWorkspaceResolution> {
  const argument = argumentMachineWorkspace(options);
  if (argument) return argument;
  const mode = adapterMode(options);
  if (mode === 'disabled') return unresolvedMachineWorkspace(options, ['adapter_disabled'], disabledAdapterStatus(mode));
  const cliStatus = cliAdapterStatus(mode);
  try {
    if (mode !== 'cli') {
      const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
      const mod = await loader();
      const unsupportedStatus = unsupportedContractAdapterStatus(mode, mod);
      if (unsupportedStatus) return unresolvedMachineWorkspace(options, [`unsupported_contract_version:${unsupportedStatus.contract_version}`], unsupportedStatus);
      const sdkStatus = sdkAdapterStatus(mode, mod);
      if (mod?.resolveMachineWorkspace) {
        const normalized = normalizeOpenMachinesWorkspace(mod.resolveMachineWorkspace({
          machineId: options.machineId,
          projectId: options.projectId ?? 'open-knowledge',
          repoName: options.repoName ?? 'open-knowledge',
          openFilesRepoName: options.openFilesRepoName ?? 'open-files',
          includeTailscale: options.includeTailscale,
          runner: options.runner,
          now: options.now,
        }), options, sdkStatus);
        if (normalized) return normalized;
        if (mode === 'sdk') return unresolvedMachineWorkspace(options, ['invalid_workspace_shape'], disabledAdapterStatus(mode, 'invalid_workspace_shape'));
        return await resolveOpenMachinesCliWorkspace(options, cliStatus)
          ?? unresolvedMachineWorkspace(options, ['invalid_workspace_shape'], disabledAdapterStatus(mode, 'invalid_workspace_shape'));
      }
      if (mode === 'sdk') return unresolvedMachineWorkspace(options, ['missing_resolveMachineWorkspace'], disabledAdapterStatus(mode, 'missing_resolveMachineWorkspace'));
      return await resolveOpenMachinesCliWorkspace(options, cliStatus)
        ?? unresolvedMachineWorkspace(options, ['missing_resolveMachineWorkspace'], disabledAdapterStatus(mode, 'missing_resolveMachineWorkspace'));
    }
    return await resolveOpenMachinesCliWorkspace(options, cliStatus)
      ?? unresolvedMachineWorkspace(options, ['machines_cli_unavailable'], disabledAdapterStatus(mode, 'machines_cli_unavailable'));
  } catch (error) {
    if (mode === 'sdk') return unresolvedMachineWorkspace(options, [optionalModuleError(error)], disabledAdapterStatus(mode, optionalModuleError(error)));
    return await resolveOpenMachinesCliWorkspace(options, cliStatus)
      ?? unresolvedMachineWorkspace(options, [optionalModuleError(error)], disabledAdapterStatus(mode, optionalModuleError(error)));
  }
}

function withPreflightKnowledgeContext(
  report: Omit<KnowledgeMachinePreflightReport, 'knowledge' | 'message'>,
  options: KnowledgeMachinePreflightOptions,
): KnowledgeMachinePreflightReport {
  return {
    ...report,
    knowledge: {
      scope: options.knowledge?.scope ?? 'global',
      app_path: HASNA_KNOWLEDGE_APP_PATH,
      workspace_home: options.knowledge?.workspace_home ?? null,
    },
    message: report.ok
      ? `Machine ${report.machine_id} passed knowledge preflight`
      : `Machine ${report.machine_id} failed knowledge preflight: ${report.summary.fail} failing check(s)`,
  };
}

function normalizeOpenMachinesPreflight(value: unknown, options: KnowledgeMachinePreflightOptions, adapter: KnowledgeMachinesAdapterStatus): KnowledgeMachinePreflightReport | null {
  const raw = asRecord(value);
  if (unsupportedContractVersion(payloadContractVersion(raw))) return null;
  const checksRaw = Array.isArray(raw.checks) ? raw.checks : null;
  const machineId = asString(raw.machine_id) ?? asString(raw.machineId);
  if (!checksRaw || !machineId) return null;
  const checks = checksRaw.map((entry) => {
    const record = asRecord(entry);
    const status = asString(record.status);
    const kind = asString(record.kind);
    const source = asString(record.source);
    return makePreflightCheck({
      id: asString(record.id) ?? 'unknown',
      kind: kind === 'command' || kind === 'package' || kind === 'workspace' ? kind : 'command',
      status: status === 'ok' || status === 'warn' || status === 'fail' ? status : 'fail',
      target: asString(record.target) ?? 'unknown',
      expected: asString(record.expected),
      actual: asString(record.actual),
      detail: asString(record.detail) ?? '',
      source: source === 'local' || source === 'ssh' || source === 'open-machines' ? source : 'open-machines',
    });
  });
  const summary = {
    ok: checks.filter((check) => check.status === 'ok').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  };
  return withPreflightKnowledgeContext({
    ok: summary.fail === 0,
    source: 'open-machines',
    machine_id: machineId,
    generated_at: asString(raw.generated_at) ?? (options.now ?? new Date()).toISOString(),
    checks,
    summary,
    adapter,
  }, options);
}

function machinesCliPreflightRunner(options: KnowledgeMachinePreflightOptions): KnowledgeMachineCommandRunner {
  if (!options.runner) return defaultRunner;
  return async (command) => {
    const result = await options.runner?.('local', command);
    return {
      stdout: result?.stdout ?? '',
      stderr: result?.stderr ?? '',
      exitCode: result?.exitCode ?? 1,
    };
  };
}

function machinesCliPackageSpec(spec: KnowledgeMachinePreflightPackageSpec): string {
  return [spec.name, spec.command, spec.expectedVersion].filter((value): value is string => Boolean(value)).join(':');
}

function machinesCliWorkspaceSpec(spec: KnowledgeMachinePreflightWorkspaceSpec): string {
  const suffix = [spec.expectedPackageName, spec.expectedVersion].filter((value): value is string => Boolean(value)).join(':');
  const path = suffix ? `${spec.path}:${suffix}` : spec.path;
  return spec.label ? `${spec.label}=${path}` : path;
}

async function preflightOpenMachinesCli(options: KnowledgeMachinePreflightOptions, adapter: KnowledgeMachinesAdapterStatus): Promise<KnowledgeMachinePreflightReport | null> {
  const runner = machinesCliPreflightRunner(options);
  if (!await hasCommand('machines', runner)) return null;
  const args = [
    'compatibility',
    '--json',
    '--machine', options.machineId ?? 'local',
  ];
  for (const spec of options.commands ?? []) {
    args.push('--command', spec.expectedVersion ? `${spec.command}:${spec.expectedVersion}` : spec.command);
  }
  for (const spec of options.packages ?? []) args.push('--package', machinesCliPackageSpec(spec));
  for (const spec of options.workspaces ?? []) args.push('--workspace', machinesCliWorkspaceSpec(spec));
  const result = await runCommand(runner, machinesCliCommand(args));
  if (result.exitCode !== 0) return null;
  return normalizeOpenMachinesPreflight(parseJson(result.stdout), options, adapter);
}

async function fallbackPreflight(options: KnowledgeMachinePreflightOptions, adapter: KnowledgeMachinesAdapterStatus): Promise<KnowledgeMachinePreflightReport> {
  const machineId = options.machineId ?? hostname();
  const runner = options.runner ?? defaultPreflightRunner;
  const commands = options.commands ?? [{ command: 'bun', required: true }, { command: 'knowledge', required: true }];
  const packages = options.packages ?? [{ name: '@hasna/knowledge', command: 'knowledge', required: true }];
  const workspaces = options.workspaces ?? [];
  const checks: KnowledgeMachinePreflightCheck[] = [];
  for (const spec of commands) checks.push(...await fallbackCommandChecks(machineId, spec, runner));
  for (const spec of packages) checks.push(...await fallbackPackageChecks(machineId, spec, runner));
  for (const spec of workspaces) checks.push(...await fallbackWorkspaceChecks(machineId, spec, runner));
  if (adapter.error) {
    checks.push(makePreflightCheck({
      id: 'adapter:@hasna/machines',
      kind: 'package',
      status: 'warn',
      target: '@hasna/machines',
      expected: 'optional',
      actual: adapter.error,
      detail: 'Using knowledge local/ssh compatibility fallback',
      source: preflightTargetIsLocal(machineId) ? 'local' : 'ssh',
    }));
  }
  const summary = {
    ok: checks.filter((check) => check.status === 'ok').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  };
  return withPreflightKnowledgeContext({
    ok: summary.fail === 0,
    source: 'local',
    machine_id: machineId,
    generated_at: (options.now ?? new Date()).toISOString(),
    checks,
    summary,
    adapter,
  }, options);
}

export async function preflightKnowledgeMachine(options: KnowledgeMachinePreflightOptions = {}): Promise<KnowledgeMachinePreflightReport> {
  const mode = adapterMode(options);
  if (mode === 'disabled') return await fallbackPreflight(options, disabledAdapterStatus(mode));
  const cliStatus = cliAdapterStatus(mode);
  try {
    if (mode !== 'cli') {
      const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
      const mod = await loader();
      const unsupportedStatus = unsupportedContractAdapterStatus(mode, mod);
      if (unsupportedStatus) return await fallbackPreflight(options, unsupportedStatus);
      const sdkStatus = sdkAdapterStatus(mode, mod);
      if (mod?.checkMachineCompatibility) {
        const report = mod.checkMachineCompatibility({
          machineId: options.machineId,
          commands: options.commands,
          packages: options.packages,
          workspaces: options.workspaces,
          runner: options.runner,
          now: options.now,
        });
        const normalized = normalizeOpenMachinesPreflight(report, options, sdkStatus);
        if (normalized) return normalized;
        if (mode === 'sdk') return await fallbackPreflight(options, disabledAdapterStatus(mode, 'invalid_compatibility_shape'));
        return await preflightOpenMachinesCli(options, cliStatus)
          ?? await fallbackPreflight(options, disabledAdapterStatus(mode, 'invalid_compatibility_shape'));
      }
      if (mode === 'sdk') return await fallbackPreflight(options, disabledAdapterStatus(mode, 'missing_checkMachineCompatibility'));
      return await preflightOpenMachinesCli(options, cliStatus)
        ?? await fallbackPreflight(options, disabledAdapterStatus(mode, 'missing_checkMachineCompatibility'));
    }
    return await preflightOpenMachinesCli(options, cliStatus)
      ?? await fallbackPreflight(options, disabledAdapterStatus(mode, 'machines_cli_unavailable'));
  } catch (error) {
    if (mode === 'sdk') return await fallbackPreflight(options, disabledAdapterStatus(mode, optionalModuleError(error)));
    return await preflightOpenMachinesCli(options, cliStatus)
      ?? await fallbackPreflight(options, disabledAdapterStatus(mode, optionalModuleError(error)));
  }
}

function mergeAdapterTopologyOptions(defaults: KnowledgeMachinesAdapterDefaults, options: Omit<KnowledgeMachineTopologyOptions, 'adapterMode'> = {}): KnowledgeMachineTopologyOptions {
  return {
    ...options,
    adapterMode: defaults.mode ?? 'auto',
    includeTailscale: options.includeTailscale ?? defaults.includeTailscale,
    runner: options.runner ?? defaults.runner,
    now: options.now ?? defaults.now,
    loadOpenMachines: options.loadOpenMachines ?? defaults.loadOpenMachines,
  };
}

function mergeAdapterRouteOptions(defaults: KnowledgeMachinesAdapterDefaults, options: Omit<KnowledgeMachineRouteOptions, 'adapterMode'>): KnowledgeMachineRouteOptions {
  return {
    ...options,
    adapterMode: defaults.mode ?? 'auto',
    includeTailscale: options.includeTailscale ?? defaults.includeTailscale,
    runner: options.runner ?? defaults.runner,
    now: options.now ?? defaults.now,
    loadOpenMachines: options.loadOpenMachines ?? defaults.loadOpenMachines,
  };
}

function mergeAdapterWorkspaceOptions(defaults: KnowledgeMachinesAdapterDefaults, options: Omit<KnowledgeMachineWorkspaceOptions, 'adapterMode'>): KnowledgeMachineWorkspaceOptions {
  return {
    ...options,
    adapterMode: defaults.mode ?? 'auto',
    includeTailscale: options.includeTailscale ?? defaults.includeTailscale,
    runner: options.runner ?? defaults.runner,
    now: options.now ?? defaults.now,
    loadOpenMachines: options.loadOpenMachines ?? defaults.loadOpenMachines,
  };
}

function mergeAdapterPreflightOptions(defaults: KnowledgeMachinesAdapterDefaults, options: Omit<KnowledgeMachinePreflightOptions, 'adapterMode'> = {}): KnowledgeMachinePreflightOptions {
  return {
    ...options,
    adapterMode: defaults.mode ?? 'auto',
    commands: options.commands,
    packages: options.packages,
    workspaces: options.workspaces,
    runner: options.runner ?? defaults.preflightRunner,
    now: options.now ?? defaults.now,
    loadOpenMachines: options.loadOpenMachines ?? defaults.loadOpenMachines,
  };
}

export function createKnowledgeMachinesAdapter(defaults: KnowledgeMachinesAdapterDefaults = {}): KnowledgeMachinesAdapter {
  const mode = defaults.mode ?? 'auto';
  return {
    mode,
    async status() {
      if (mode === 'disabled') return disabledAdapterStatus(mode);
      if (mode === 'cli') return cliAdapterStatus(mode);
      try {
        const loader = defaults.loadOpenMachines ?? loadOpenMachinesModule;
        const mod = await loader();
        const unsupportedStatus = unsupportedContractAdapterStatus(mode, mod);
        if (unsupportedStatus) return unsupportedStatus;
        if (mod) return sdkAdapterStatus(mode, mod);
        if (mode === 'sdk') return disabledAdapterStatus(mode, 'module_not_found');
        return cliAdapterStatus(mode);
      } catch (error) {
        return disabledAdapterStatus(mode, optionalModuleError(error));
      }
    },
    topology(options = {}) {
      return discoverKnowledgeMachineTopology(mergeAdapterTopologyOptions(defaults, options));
    },
    route(options) {
      return resolveKnowledgeMachineRoute(mergeAdapterRouteOptions(defaults, options));
    },
    workspace(options) {
      return resolveKnowledgeMachineWorkspace(mergeAdapterWorkspaceOptions(defaults, options));
    },
    preflight(options = {}) {
      return preflightKnowledgeMachine(mergeAdapterPreflightOptions(defaults, options));
    },
  };
}
