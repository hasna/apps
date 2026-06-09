import { existsSync } from "node:fs";
import { arch, hostname, platform, userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import { getLocalMachineId, listHeartbeats } from "./db.js";
import { readManifest } from "./manifests.js";
import { getManifestPath } from "./paths.js";
import type { MachineManifest, MachinePlatform } from "./types.js";
import { getPackageVersion } from "./version.js";

export const MACHINES_CONSUMER_CONTRACT_VERSION = 1;
export const MACHINES_PACKAGE_NAME = "@hasna/machines";

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
}

export interface MachineRouteHint {
  kind: "local" | "lan" | "tailscale" | "ssh";
  target: string;
  reachable: boolean | null;
}

export interface MachineTopologyEntry {
  machine_id: string;
  hostname: string | null;
  platform: MachinePlatform | string | null;
  os: string | null;
  user: string | null;
  workspace_path: string | null;
  manifest_declared: boolean;
  heartbeat_status: "online" | "offline" | "unknown";
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
}

export interface MachineTopology {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: MachinesConsumerCapabilities;
  generated_at: string;
  local_machine_id: string;
  local_hostname: string;
  current_platform: MachinePlatform | string;
  manifest_path_known: boolean;
  machines: MachineTopologyEntry[];
  warnings: string[];
}

export type MachineRouteKind = "local" | "lan" | "tailscale" | "ssh" | "unknown";
export type MachineRouteConfidence = "exact" | "high" | "medium" | "low" | "none";

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
    matched_by: "machine_id" | "hostname" | "tailscale" | "route_target" | "local_alias" | "fallback" | null;
    manifest_declared: boolean | null;
    heartbeat_status: MachineTopologyEntry["heartbeat_status"] | null;
    tailscale_online: boolean | null;
    selected_hint: MachineRouteHint | null;
  };
  warnings: string[];
}

export interface MachineRouteOptions extends MachineTopologyOptions {
  topology?: MachineTopology;
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

function normalizePlatform(value: string = platform()): MachinePlatform | string {
  const normalized = value.toLowerCase();
  if (normalized === "darwin" || normalized === "macos") return "macos";
  if (normalized === "win32" || normalized === "windows") return "windows";
  if (normalized === "linux") return "linux";
  return value;
}

function defaultRunner(command: string): TopologyCommandResult {
  const result = spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    env: process.env,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

function hasCommand(command: string, runner: TopologyCommandRunner): boolean {
  return runner(`command -v ${command} >/dev/null 2>&1`).exitCode === 0;
}

function parseTailscaleStatus(raw: string): TailscaleStatus | null {
  try {
    const parsed = JSON.parse(raw) as TailscaleStatus;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadTailscalePeers(runner: TopologyCommandRunner, warnings: string[]): Map<string, TailscalePeer> {
  const peers = new Map<string, TailscalePeer>();
  if (!hasCommand("tailscale", runner)) {
    warnings.push("tailscale_not_available");
    return peers;
  }
  const result = runner("tailscale status --json");
  if (result.exitCode !== 0) {
    warnings.push(`tailscale_status_failed:${result.stderr.trim() || result.exitCode}`);
    return peers;
  }
  const status = parseTailscaleStatus(result.stdout);
  if (!status) {
    warnings.push("tailscale_status_invalid_json");
    return peers;
  }
  const addPeer = (peer?: TailscalePeer) => {
    if (!peer) return;
    const id = peer.HostName || peer.DNSName?.split(".")[0];
    if (id) peers.set(id, peer);
  };
  addPeer(status.Self);
  for (const peer of Object.values(status.Peer ?? {})) addPeer(peer);
  return peers;
}

function machineKeys(machine: MachineManifest): string[] {
  return [
    machine.id,
    machine.hostname,
    machine.tailscaleName?.split(".")[0],
    machine.tailscaleName,
    machine.sshAddress?.split("@").pop(),
  ].filter((value): value is string => Boolean(value));
}

function findTailscalePeer(machine: MachineManifest | null, machineId: string, peers: Map<string, TailscalePeer>): TailscalePeer | null {
  if (machine) {
    for (const key of machineKeys(machine)) {
      const peer = peers.get(key) ?? peers.get(key.replace(/\.$/, ""));
      if (peer) return peer;
    }
  }
  return peers.get(machineId) ?? null;
}

function envReachableHosts(): Set<string> {
  const raw = process.env["HASNA_MACHINES_REACHABLE_HOSTS"];
  return new Set((raw || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function manifestHostReachable(target: string): boolean | null {
  const overrides = envReachableHosts();
  if (overrides.size === 0) return null;
  return overrides.has(target);
}

function routeHints(input: {
  machineId: string;
  localMachineId: string;
  manifest?: MachineManifest;
  peer?: TailscalePeer | null;
}): MachineRouteHint[] {
  const hints: MachineRouteHint[] = [];
  if (input.machineId === input.localMachineId) {
    hints.push({ kind: "local", target: "localhost", reachable: true });
  }
  if (input.manifest?.sshAddress) {
    hints.push({ kind: "ssh", target: input.manifest.sshAddress, reachable: manifestHostReachable(input.manifest.sshAddress) });
  }
  if (input.manifest?.hostname) {
    hints.push({ kind: "lan", target: input.manifest.hostname, reachable: manifestHostReachable(input.manifest.hostname) });
  }
  const tailscaleTarget = input.manifest?.tailscaleName ?? input.peer?.DNSName ?? input.peer?.TailscaleIPs?.[0];
  if (tailscaleTarget) {
    hints.push({ kind: "tailscale", target: tailscaleTarget.replace(/\.$/, ""), reachable: input.peer?.Online ?? null });
  }
  return hints;
}

function routeRank(hint: MachineRouteHint): number {
  if (hint.kind === "local") return 0;
  if (hint.reachable === true && hint.kind === "ssh") return 1;
  if (hint.reachable === true && hint.kind === "lan") return 2;
  if (hint.reachable === true && hint.kind === "tailscale") return 3;
  if (hint.reachable === false) return 8;
  if (hint.kind === "ssh") return 4;
  if (hint.kind === "lan") return 5;
  if (hint.kind === "tailscale") return 6;
  return 9;
}

function selectRouteHint(hints: MachineRouteHint[]): MachineRouteHint | null {
  return [...hints].sort((left, right) => routeRank(left) - routeRank(right))[0] ?? null;
}

function buildEntry(input: {
  machineId: string;
  localMachineId: string;
  manifest?: MachineManifest;
  peer?: TailscalePeer | null;
  heartbeat?: ReturnType<typeof listHeartbeats>[number];
}): MachineTopologyEntry {
  const manifest = input.manifest;
  const peer = input.peer;
  const hints = routeHints({
    machineId: input.machineId,
    localMachineId: input.localMachineId,
    manifest,
    peer,
  });
  const selectedRoute = selectRouteHint(hints);
  const route = selectedRoute?.kind === "ssh" ? "ssh" : selectedRoute?.kind ?? "unknown";
  return {
    machine_id: input.machineId,
    hostname: manifest?.hostname ?? peer?.HostName ?? null,
    platform: manifest?.platform ?? (peer?.OS ? normalizePlatform(peer.OS) : null),
    os: peer?.OS ?? null,
    user: typeof manifest?.metadata?.user === "string" ? manifest.metadata.user : null,
    workspace_path: manifest?.workspacePath ?? null,
    manifest_declared: Boolean(manifest),
    heartbeat_status: (input.heartbeat?.status as "online" | "offline" | undefined) ?? "unknown",
    last_heartbeat_at: input.heartbeat?.updated_at ?? null,
    tailscale: {
      dns_name: manifest?.tailscaleName ?? peer?.DNSName?.replace(/\.$/, "") ?? null,
      ips: peer?.TailscaleIPs ?? [],
      online: peer?.Online ?? null,
      active: peer?.Active ?? null,
      last_seen: peer?.LastSeen ?? null,
    },
    ssh: {
      address: manifest?.sshAddress ?? null,
      route,
      command_target: selectedRoute?.target ?? null,
    },
    route_hints: hints,
    tags: manifest?.tags ?? [],
    metadata: manifest?.metadata ?? {},
  };
}

export function discoverMachineTopology(options: MachineTopologyOptions = {}): MachineTopology {
  const now = options.now ?? new Date();
  const runner = options.runner ?? defaultRunner;
  const warnings: string[] = [];
  const manifest = readManifest();
  const heartbeats = listHeartbeats();
  const heartbeatByMachine = new Map(heartbeats.map((heartbeat) => [heartbeat.machine_id, heartbeat]));
  const localMachineId = getLocalMachineId();
  const peers = options.includeTailscale === false ? new Map<string, TailscalePeer>() : loadTailscalePeers(runner, warnings);
  const machineIds = new Set<string>([
    localMachineId,
    ...manifest.machines.map((machine) => machine.id),
    ...heartbeats.map((heartbeat) => heartbeat.machine_id),
    ...peers.keys(),
  ]);
  const manifestById = new Map(manifest.machines.map((machine) => [machine.id, machine]));
  const machines = [...machineIds].sort().map((machineId) => {
    const manifestMachine = manifestById.get(machineId);
    return buildEntry({
      machineId,
      localMachineId,
      manifest: manifestMachine,
      peer: findTailscalePeer(manifestMachine ?? null, machineId, peers),
      heartbeat: heartbeatByMachine.get(machineId),
    });
  });
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: {
      name: MACHINES_PACKAGE_NAME,
      version: getPackageVersion(),
    },
    capabilities: {
      topology: true,
      compatibility: true,
      route_resolution: true,
      cli_json_fallback: true,
    },
    generated_at: now.toISOString(),
    local_machine_id: localMachineId,
    local_hostname: hostname(),
    current_platform: normalizePlatform(),
    manifest_path_known: existsSync(getManifestPath()),
    machines,
    warnings,
  };
}

function normalizeMachineAlias(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}

function routeTargetMatches(machine: MachineTopologyEntry, requested: string): boolean {
  const normalized = normalizeMachineAlias(requested);
  const values = [
    machine.ssh.address,
    machine.ssh.command_target,
    machine.tailscale.dns_name,
    machine.tailscale.dns_name?.split(".")[0],
    ...machine.tailscale.ips,
    ...machine.route_hints.map((hint) => hint.target),
    ...machine.route_hints.map((hint) => hint.target.split("@").pop() ?? hint.target),
  ].filter((value): value is string => Boolean(value));
  return values.some((value) => normalizeMachineAlias(value) === normalized);
}

function findRouteMachine(topology: MachineTopology, requestedMachineId: string): {
  machine: MachineTopologyEntry | null;
  matchedBy: MachineRouteResolution["evidence"]["matched_by"];
} {
  const requested = normalizeMachineAlias(requestedMachineId);
  if (requested === "local" || requested === "localhost" || requested === normalizeMachineAlias(hostname()) || requested === normalizeMachineAlias(topology.local_machine_id)) {
    return {
      machine: topology.machines.find((machine) => machine.machine_id === topology.local_machine_id) ?? null,
      matchedBy: "local_alias",
    };
  }

  const machineIdMatch = topology.machines.find((machine) => normalizeMachineAlias(machine.machine_id) === requested);
  if (machineIdMatch) return { machine: machineIdMatch, matchedBy: "machine_id" };

  const hostnameMatch = topology.machines.find((machine) => machine.hostname && normalizeMachineAlias(machine.hostname) === requested);
  if (hostnameMatch) return { machine: hostnameMatch, matchedBy: "hostname" };

  const tailscaleMatch = topology.machines.find((machine) => {
    if (!machine.tailscale.dns_name) return false;
    const dns = normalizeMachineAlias(machine.tailscale.dns_name);
    return dns === requested || dns.split(".")[0] === requested;
  });
  if (tailscaleMatch) return { machine: tailscaleMatch, matchedBy: "tailscale" };

  const routeMatch = topology.machines.find((machine) => routeTargetMatches(machine, requestedMachineId));
  if (routeMatch) return { machine: routeMatch, matchedBy: "route_target" };

  return { machine: null, matchedBy: null };
}

function routeConfidence(input: {
  machine: MachineTopologyEntry;
  hint: MachineRouteHint | null;
  matchedBy: MachineRouteResolution["evidence"]["matched_by"];
}): MachineRouteConfidence {
  if (input.matchedBy === "local_alias") return "exact";
  if (input.hint?.kind === "local") return "exact";
  if (input.hint?.reachable === true) return "high";
  if (input.machine.manifest_declared && (input.hint?.kind === "ssh" || input.hint?.kind === "lan")) return "medium";
  if (input.hint) return "low";
  return "none";
}

export function resolveMachineRoute(machineId: string, options: MachineRouteOptions = {}): MachineRouteResolution {
  const topology = options.topology ?? discoverMachineTopology(options);
  const warnings = [...topology.warnings];
  const { machine, matchedBy } = findRouteMachine(topology, machineId);
  const generatedAt = (options.now ?? new Date()).toISOString();

  if (!machine) {
    warnings.push(`machine_not_found:${machineId}`);
    return {
      schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
      package: { name: MACHINES_PACKAGE_NAME, version: getPackageVersion() },
      ok: false,
      machine_id: null,
      requested_machine_id: machineId,
      generated_at: generatedAt,
      route: "unknown",
      source: "unknown",
      target: null,
      command_target: null,
      confidence: "none",
      local: false,
      evidence: {
        topology: true,
        matched_by: null,
        manifest_declared: null,
        heartbeat_status: null,
        tailscale_online: null,
        selected_hint: null,
      },
      warnings,
    };
  }

  const selectedHint = selectRouteHint(machine.route_hints);
  const route = selectedHint?.kind ?? machine.ssh.route ?? "unknown";
  const local = route === "local" || machine.machine_id === topology.local_machine_id;
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: topology.package,
    ok: Boolean(selectedHint?.target),
    machine_id: machine.machine_id,
    requested_machine_id: machineId,
    generated_at: generatedAt,
    route,
    source: route,
    target: selectedHint?.target ?? null,
    command_target: selectedHint?.target ?? null,
    confidence: routeConfidence({ machine, hint: selectedHint, matchedBy }),
    local,
    evidence: {
      topology: true,
      matched_by: matchedBy,
      manifest_declared: machine.manifest_declared,
      heartbeat_status: machine.heartbeat_status,
      tailscale_online: machine.tailscale.online,
      selected_hint: selectedHint,
    },
    warnings,
  };
}

export function getLocalMachineTopology(options: MachineTopologyOptions = {}): MachineTopologyEntry {
  const topology = discoverMachineTopology(options);
  return topology.machines.find((machine) => machine.machine_id === topology.local_machine_id) ?? {
    machine_id: topology.local_machine_id,
    hostname: hostname(),
    platform: normalizePlatform(),
    os: platform(),
    user: userInfo().username,
    workspace_path: null,
    manifest_declared: false,
    heartbeat_status: "unknown",
    last_heartbeat_at: null,
    tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
    ssh: { address: null, route: "local", command_target: "localhost" },
    route_hints: [{ kind: "local", target: "localhost", reachable: true }],
    tags: [`arch:${arch()}`],
    metadata: {},
  };
}
