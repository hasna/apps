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
  discoverMachineTopology?: (options?: { includeTailscale?: boolean; runner?: unknown; now?: Date }) => unknown;
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
  return message.includes("Cannot find module '@hasna/machines'") ? 'module_not_found' : message;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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
  const specifier = '@hasna/machines';
  return await import(specifier) as OpenMachinesModule;
}

function normalizeOpenMachinesTopology(value: unknown, options: KnowledgeMachineTopologyOptions): KnowledgeMachineTopology | null {
  const raw = asRecord(value);
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
    adapter: {
      package: '@hasna/machines' as const,
      available: true,
      error: null,
    },
  };
  return withKnowledgeContext(topology, options);
}

async function discoverLocalTopology(options: KnowledgeMachineTopologyOptions, adapterError: string | null): Promise<KnowledgeMachineTopology> {
  const warnings: string[] = [];
  if (adapterError) warnings.push(`open_machines_unavailable:${adapterError}`);
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
    adapter: {
      package: '@hasna/machines',
      available: false,
      error: adapterError,
    },
  }, options);
}

export async function discoverKnowledgeMachineTopology(options: KnowledgeMachineTopologyOptions = {}): Promise<KnowledgeMachineTopology> {
  try {
    const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
    const mod = await loader();
    if (mod?.discoverMachineTopology) {
      const topology = mod.discoverMachineTopology({
        includeTailscale: options.includeTailscale,
        runner: options.runner,
        now: options.now,
      });
      const normalized = normalizeOpenMachinesTopology(topology, options);
      if (normalized) return normalized;
      return await discoverLocalTopology(options, 'invalid_topology_shape');
    }
    return await discoverLocalTopology(options, 'missing_discoverMachineTopology');
  } catch (error) {
    return await discoverLocalTopology(options, optionalModuleError(error));
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

function normalizeOpenMachinesPreflight(value: unknown, options: KnowledgeMachinePreflightOptions): KnowledgeMachinePreflightReport | null {
  const raw = asRecord(value);
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
    adapter: {
      package: '@hasna/machines',
      available: true,
      error: null,
    },
  }, options);
}

async function fallbackPreflight(options: KnowledgeMachinePreflightOptions, adapterError: string | null): Promise<KnowledgeMachinePreflightReport> {
  const machineId = options.machineId ?? hostname();
  const runner = options.runner ?? defaultPreflightRunner;
  const commands = options.commands ?? [{ command: 'bun', required: true }, { command: 'knowledge', required: true }];
  const packages = options.packages ?? [{ name: '@hasna/knowledge', command: 'knowledge', required: true }];
  const workspaces = options.workspaces ?? [];
  const checks: KnowledgeMachinePreflightCheck[] = [];
  for (const spec of commands) checks.push(...await fallbackCommandChecks(machineId, spec, runner));
  for (const spec of packages) checks.push(...await fallbackPackageChecks(machineId, spec, runner));
  for (const spec of workspaces) checks.push(...await fallbackWorkspaceChecks(machineId, spec, runner));
  if (adapterError) {
    checks.push(makePreflightCheck({
      id: 'adapter:@hasna/machines',
      kind: 'package',
      status: 'warn',
      target: '@hasna/machines',
      expected: 'optional',
      actual: adapterError,
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
    adapter: {
      package: '@hasna/machines',
      available: false,
      error: adapterError,
    },
  }, options);
}

export async function preflightKnowledgeMachine(options: KnowledgeMachinePreflightOptions = {}): Promise<KnowledgeMachinePreflightReport> {
  try {
    const loader = options.loadOpenMachines ?? loadOpenMachinesModule;
    const mod = await loader();
    if (mod?.checkMachineCompatibility) {
      const report = mod.checkMachineCompatibility({
        machineId: options.machineId,
        commands: options.commands,
        packages: options.packages,
        workspaces: options.workspaces,
        runner: options.runner,
        now: options.now,
      });
      const normalized = normalizeOpenMachinesPreflight(report, options);
      if (normalized) return normalized;
      return await fallbackPreflight(options, 'invalid_compatibility_shape');
    }
    return await fallbackPreflight(options, 'missing_checkMachineCompatibility');
  } catch (error) {
    return await fallbackPreflight(options, optionalModuleError(error));
  }
}
