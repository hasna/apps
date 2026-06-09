import { existsSync } from "node:fs";
import { arch, hostname, platform, userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import { getLocalMachineId, listHeartbeats } from "./db.js";
import { readManifest } from "./manifests.js";
import { getManifestPath } from "./paths.js";
import type { MachineManifest, MachinePlatform } from "./types.js";

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
    route: "local" | "lan" | "tailscale" | "unknown";
    command_target: string | null;
  };
  route_hints: MachineRouteHint[];
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface MachineTopology {
  generated_at: string;
  local_machine_id: string;
  local_hostname: string;
  current_platform: MachinePlatform | string;
  manifest_path_known: boolean;
  machines: MachineTopologyEntry[];
  warnings: string[];
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
    hints.push({ kind: "ssh", target: input.manifest.sshAddress, reachable: null });
  }
  if (input.manifest?.hostname) {
    hints.push({ kind: "lan", target: input.manifest.hostname, reachable: null });
  }
  const tailscaleTarget = input.manifest?.tailscaleName ?? input.peer?.DNSName ?? input.peer?.TailscaleIPs?.[0];
  if (tailscaleTarget) {
    hints.push({ kind: "tailscale", target: tailscaleTarget.replace(/\.$/, ""), reachable: input.peer?.Online ?? null });
  }
  return hints;
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
  const selectedRoute = hints.find((hint) => hint.kind === "local")
    ?? hints.find((hint) => hint.kind === "ssh")
    ?? hints.find((hint) => hint.kind === "lan")
    ?? hints.find((hint) => hint.kind === "tailscale")
  ;
  const route = selectedRoute?.kind === "ssh" ? "lan" : selectedRoute?.kind ?? "unknown";
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
    generated_at: now.toISOString(),
    local_machine_id: localMachineId,
    local_hostname: hostname(),
    current_platform: normalizePlatform(),
    manifest_path_known: existsSync(getManifestPath()),
    machines,
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
