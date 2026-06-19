import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces, platform as osPlatform } from "node:os";
import { readManifest } from "../manifests.js";
import type { FleetManifest, MachineManifest } from "../types.js";

export const HOSTS_BLOCK_BEGIN = "# >>> hasna machines fleet >>>";
export const HOSTS_BLOCK_END = "# <<< hasna machines fleet <<<";

/**
 * Where each fleet host entry's IP came from, in descending preference:
 *  - manifest_lan   : a `metadata.lanAddress` on the same /24 as this machine
 *  - tailscale_lan  : the peer's live direct LAN endpoint (CurAddr) on this /24
 *  - tailscale      : the peer's tailnet (100.64.0.0/10) IP — always routable
 *  - manifest_ip    : an explicit `metadata.ipAddress` override
 */
export type HostEntrySource = "manifest_lan" | "tailscale_lan" | "tailscale" | "manifest_ip";

export interface FleetHostEntry {
  id: string;
  ip: string;
  names: string[];
  source: HostEntrySource;
}

export interface RawTailscalePeer {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  CurAddr?: string;
  Online?: boolean;
}

export interface RawTailscaleStatus {
  Self?: RawTailscalePeer;
  Peer?: Record<string, RawTailscalePeer>;
}

export interface HostsCommandResult {
  stdout: string;
  exitCode: number;
}

export type HostsCommandRunner = (command: string) => HostsCommandResult;

export interface BuildFleetHostEntriesInput {
  manifest: FleetManifest;
  tailscale: RawTailscaleStatus | null;
  localSubnets: string[];
  localMachineId?: string | null;
}

export interface BuildFleetHostEntriesResult {
  entries: FleetHostEntry[];
  unresolved: string[];
  warnings: string[];
}

export interface FleetHostsPlan extends BuildFleetHostEntriesResult {
  hostsPath: string;
  block: string;
  localSubnets: string[];
}

export interface FleetHostsOptions {
  runner?: HostsCommandRunner;
  localSubnets?: string[];
  localMachineId?: string | null;
  /**
   * Establish direct Tailscale paths to online peers first so their LAN
   * endpoints (CurAddr) become visible and can be preferred over tailnet IPs.
   * Defaults to true.
   */
  warm?: boolean;
  warmTimeoutSeconds?: number;
}

export interface ApplyFleetHostsResult extends FleetHostsPlan {
  written: boolean;
  viaSudo: boolean;
}

function defaultRunner(command: string): HostsCommandResult {
  const result = spawnSync("bash", ["-c", command], { encoding: "utf8", env: process.env });
  return { stdout: result.stdout || "", exitCode: result.status ?? 1 };
}

export function getHostsPath(): string {
  const override = process.env["HASNA_MACHINES_HOSTS_PATH"];
  if (override) return override;
  if (osPlatform() === "win32") {
    return "C:\\Windows\\System32\\drivers\\etc\\hosts";
  }
  return "/etc/hosts";
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

export function isPrivateIpv4(value: string): boolean {
  if (!isIpv4(value)) return false;
  const [a, b] = value.split(".").map(Number);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isTailnetIpv4(value: string): boolean {
  if (!isIpv4(value)) return false;
  const [a, b] = value.split(".").map(Number);
  // Tailscale CGNAT range 100.64.0.0/10.
  return a === 100 && b >= 64 && b <= 127;
}

export function subnet24(value: string): string | null {
  if (!isIpv4(value)) return null;
  return value.split(".").slice(0, 3).join(".");
}

function ipFromEndpoint(endpoint?: string): string | null {
  if (!endpoint) return null;
  // CurAddr looks like "192.168.50.58:41641"; strip the port.
  const host = endpoint.replace(/:\d+$/, "").trim();
  return isIpv4(host) ? host : null;
}

export function localPrivateSubnets(): string[] {
  const subnets = new Set<string>();
  const interfaces = networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (!isPrivateIpv4(addr.address)) continue;
      const subnet = subnet24(addr.address);
      if (subnet) subnets.add(subnet);
    }
  }
  return [...subnets];
}

function shortName(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\.$/, "").trim();
  if (!trimmed) return null;
  return trimmed.split(".")[0]?.toLowerCase() || null;
}

function machineNames(machine: MachineManifest): string[] {
  const names: string[] = [];
  for (const candidate of [machine.id, machine.hostname, shortName(machine.tailscaleName)]) {
    const name = shortName(candidate);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function peerKeysForMachine(machine: MachineManifest): string[] {
  return [
    machine.id,
    machine.hostname,
    shortName(machine.tailscaleName),
    machine.tailscaleName,
    machine.sshAddress?.split("@").pop(),
  ].filter((value): value is string => Boolean(value));
}

function indexPeers(tailscale: RawTailscaleStatus | null): Map<string, RawTailscalePeer> {
  const peers = new Map<string, RawTailscalePeer>();
  if (!tailscale) return peers;
  const add = (peer?: RawTailscalePeer) => {
    if (!peer) return;
    const id = shortName(peer.HostName) || shortName(peer.DNSName);
    if (id) peers.set(id, peer);
  };
  add(tailscale.Self);
  for (const peer of Object.values(tailscale.Peer ?? {})) add(peer);
  return peers;
}

function findPeer(machine: MachineManifest, peers: Map<string, RawTailscalePeer>): RawTailscalePeer | null {
  for (const key of peerKeysForMachine(machine)) {
    const peer = peers.get(shortName(key) || key);
    if (peer) return peer;
  }
  return null;
}

function tailnetIp(peer: RawTailscalePeer | null): string | null {
  if (!peer) return null;
  for (const ip of peer.TailscaleIPs ?? []) {
    if (isTailnetIpv4(ip)) return ip;
  }
  return null;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  if (!metadata) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildFleetHostEntries(input: BuildFleetHostEntriesInput): BuildFleetHostEntriesResult {
  const { manifest, tailscale, localSubnets, localMachineId } = input;
  const peers = indexPeers(tailscale);
  const subnetSet = new Set(localSubnets);
  const entries: FleetHostEntry[] = [];
  const unresolved: string[] = [];
  const warnings: string[] = [];

  for (const machine of manifest.machines) {
    if (localMachineId && machine.id === localMachineId) continue;

    const names = machineNames(machine);
    if (names.length === 0) continue;

    const peer = findPeer(machine, peers);
    const lanAddress = metadataString(machine.metadata, "lanAddress");
    const explicitIp = metadataString(machine.metadata, "ipAddress");
    const curLanIp = ipFromEndpoint(peer?.CurAddr);
    const tnet = tailnetIp(peer);

    let ip: string | null = null;
    let source: HostEntrySource | null = null;

    if (lanAddress && isPrivateIpv4(lanAddress) && subnetSet.has(subnet24(lanAddress) ?? "")) {
      ip = lanAddress;
      source = "manifest_lan";
    } else if (curLanIp && isPrivateIpv4(curLanIp) && subnetSet.has(subnet24(curLanIp) ?? "")) {
      ip = curLanIp;
      source = "tailscale_lan";
    } else if (tnet) {
      ip = tnet;
      source = "tailscale";
    } else if (explicitIp && isIpv4(explicitIp)) {
      ip = explicitIp;
      source = "manifest_ip";
    }

    if (!ip || !source) {
      unresolved.push(machine.id);
      continue;
    }

    entries.push({ id: machine.id, ip, names, source });
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  return { entries, unresolved, warnings };
}

export function renderHostsBlock(entries: FleetHostEntry[]): string {
  const lines = [
    HOSTS_BLOCK_BEGIN,
    "# Managed by `machines hosts apply`. Do not edit between these markers.",
    ...entries.map((entry) => `${entry.ip}\t${entry.names.join(" ")}`),
    HOSTS_BLOCK_END,
  ];
  return lines.join("\n");
}

export function mergeHostsContent(existing: string, block: string): string {
  const beginIndex = existing.indexOf(HOSTS_BLOCK_BEGIN);
  const endIndex = existing.indexOf(HOSTS_BLOCK_END);

  if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
    const before = existing.slice(0, beginIndex).replace(/\n+$/, "");
    const after = existing.slice(endIndex + HOSTS_BLOCK_END.length).replace(/^\n+/, "");
    const head = before ? `${before}\n` : "";
    const tail = after ? `\n${after}` : "\n";
    return `${head}${block}${tail}`;
  }

  const base = existing.replace(/\n+$/, "");
  const prefix = base ? `${base}\n\n` : "";
  return `${prefix}${block}\n`;
}

function loadTailscaleStatus(runner: HostsCommandRunner, binary: string | null, warnings: string[]): RawTailscaleStatus | null {
  if (!binary) {
    if (!warnings.includes("tailscale_not_available")) warnings.push("tailscale_not_available");
    return null;
  }
  const result = runner(`"${binary}" status --json`);
  if (result.exitCode !== 0) {
    warnings.push("tailscale_status_failed");
    return null;
  }
  try {
    return JSON.parse(result.stdout) as RawTailscaleStatus;
  } catch {
    warnings.push("tailscale_status_invalid_json");
    return null;
  }
}

/**
 * Online peers that do not yet expose a same-subnet LAN endpoint but do have a
 * tailnet IP — pinging these establishes a direct path so their LAN address
 * becomes resolvable.
 */
export function collectPingTargets(tailscale: RawTailscaleStatus | null, localSubnets: string[]): string[] {
  if (!tailscale) return [];
  const subnetSet = new Set(localSubnets);
  const targets: string[] = [];
  for (const peer of Object.values(tailscale.Peer ?? {})) {
    if (!peer.Online) continue;
    const cur = ipFromEndpoint(peer.CurAddr);
    if (cur && isPrivateIpv4(cur) && subnetSet.has(subnet24(cur) ?? "")) continue;
    const tnet = tailnetIp(peer);
    if (tnet && !targets.includes(tnet)) targets.push(tnet);
  }
  return targets;
}

/**
 * Tailscale binary locations. On macOS the CLI ships inside the app bundle and
 * is frequently absent from a non-interactive shell's PATH, so probe the known
 * install paths in addition to PATH.
 */
const TAILSCALE_CANDIDATES = [
  "tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

export function resolveTailscaleBinary(runner: HostsCommandRunner): string | null {
  for (const candidate of TAILSCALE_CANDIDATES) {
    const check = candidate.includes("/") ? `test -x "${candidate}"` : `command -v ${candidate} >/dev/null 2>&1`;
    if (runner(check).exitCode === 0) return candidate;
  }
  return null;
}

export function warmDirectPaths(runner: HostsCommandRunner, targets: string[], binary: string, timeoutSeconds = 2): void {
  for (const target of targets) {
    runner(`"${binary}" ping --c 1 --timeout ${timeoutSeconds}s ${target} >/dev/null 2>&1 || true`);
  }
}

function resolveLocalMachineId(tailscale: RawTailscaleStatus | null, explicit?: string | null): string | null {
  if (explicit) return explicit;
  return shortName(tailscale?.Self?.HostName) || shortName(process.env["HOSTNAME"]) || null;
}

export function planFleetHosts(options: FleetHostsOptions = {}): FleetHostsPlan {
  const runner = options.runner ?? defaultRunner;
  const warnings: string[] = [];
  const binary = resolveTailscaleBinary(runner);
  let tailscale = loadTailscaleStatus(runner, binary, warnings);
  const manifest = readManifest();
  const localSubnets = options.localSubnets ?? localPrivateSubnets();

  if (options.warm !== false && tailscale && binary && localSubnets.length > 0) {
    const targets = collectPingTargets(tailscale, localSubnets);
    if (targets.length > 0) {
      warmDirectPaths(runner, targets, binary, options.warmTimeoutSeconds);
      tailscale = loadTailscaleStatus(runner, binary, warnings) ?? tailscale;
    }
  }

  const localMachineId = resolveLocalMachineId(tailscale, options.localMachineId);

  const built = buildFleetHostEntries({ manifest, tailscale, localSubnets, localMachineId });
  const block = renderHostsBlock(built.entries);

  return {
    hostsPath: getHostsPath(),
    entries: built.entries,
    unresolved: built.unresolved,
    warnings: [...warnings, ...built.warnings],
    block,
    localSubnets,
  };
}

export function applyFleetHosts(options: FleetHostsOptions = {}): ApplyFleetHostsResult {
  const plan = planFleetHosts(options);
  const hostsPath = plan.hostsPath;
  const existing = existsSync(hostsPath) ? readFileSync(hostsPath, "utf8") : "";
  const merged = mergeHostsContent(existing, plan.block);

  let viaSudo = false;
  try {
    writeFileSync(hostsPath, merged, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "EACCES" && code !== "EPERM") throw error;
    // Fall back to sudo for the privileged /etc/hosts write.
    const runner = options.runner ?? defaultRunner;
    const encoded = Buffer.from(merged, "utf8").toString("base64");
    const result = runner(`printf %s '${encoded}' | base64 -d | sudo tee ${hostsPath} >/dev/null`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to write ${hostsPath} (need sudo). Re-run with elevated privileges.`);
    }
    viaSudo = true;
  }

  return { ...plan, written: true, viaSudo };
}
