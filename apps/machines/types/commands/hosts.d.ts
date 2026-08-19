import type { FleetManifest } from "../types.js";
export declare const HOSTS_BLOCK_BEGIN = "# >>> hasna machines fleet >>>";
export declare const HOSTS_BLOCK_END = "# <<< hasna machines fleet <<<";
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
export declare function getHostsPath(): string;
export declare function isPrivateIpv4(value: string): boolean;
export declare function subnet24(value: string): string | null;
export declare function localPrivateSubnets(): string[];
export declare function buildFleetHostEntries(input: BuildFleetHostEntriesInput): BuildFleetHostEntriesResult;
export declare function renderHostsBlock(entries: FleetHostEntry[]): string;
export declare function mergeHostsContent(existing: string, block: string): string;
/**
 * Online peers that do not yet expose a same-subnet LAN endpoint but do have a
 * tailnet IP — pinging these establishes a direct path so their LAN address
 * becomes resolvable.
 */
export declare function collectPingTargets(tailscale: RawTailscaleStatus | null, localSubnets: string[]): string[];
export declare function resolveTailscaleBinary(runner: HostsCommandRunner): string | null;
export declare function warmDirectPaths(runner: HostsCommandRunner, targets: string[], binary: string, timeoutSeconds?: number): void;
export declare function planFleetHosts(options?: FleetHostsOptions): FleetHostsPlan;
export declare function applyFleetHosts(options?: FleetHostsOptions): ApplyFleetHostsResult;
