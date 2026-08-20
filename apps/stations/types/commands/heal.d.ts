export interface HealThresholds {
    /** consecutive failed checks before reconnecting Wi-Fi */
    reconnect: number;
    /** before restarting NetworkManager */
    nmRestart: number;
    /** before trying the degraded fallback SSID */
    fallback: number;
    /** before rebooting (last resort) */
    reboot: number;
}
export interface HealConfig {
    version: number;
    enabled: boolean;
    /** Wi-Fi interface (empty = auto-detect) */
    wifiInterface: string;
    /** the SSID this node must stay on */
    preferredSsid: string;
    /** one-shot degraded fallback SSID, restored to preferred after fallbackWindowSec */
    fallbackSsid: string;
    /** HTTPS URL used as the internet anchor */
    internetUrl: string;
    /** Tailscale hostnames used as peer anchors (empty = auto-discover online peers) */
    tailscaleAnchors: string[];
    /** how many of {anchors..., internet} must be reachable to count as healthy */
    quorumRequired: number;
    /** seconds between checks (daemon loop / timer) */
    intervalSec: number;
    thresholds: HealThresholds;
    /** min seconds between reboots */
    rebootMinIntervalSec: number;
    /** min seconds between NetworkManager restarts */
    nmRestartMinIntervalSec: number;
    /** min seconds between Wi-Fi reconnect attempts */
    reconnectMinIntervalSec: number;
    /** continuous healthy seconds after boot before a watchdog reboot is allowed again */
    healthyWindowSec: number;
    /** after this many reboots that never reached a healthy window, stop rebooting */
    maxFailedBootRecoveries: number;
    /** how long to suppress reboots once a reboot loop is detected */
    bootBackoffSec: number;
    /** how long to stay on the fallback SSID before restoring preferred */
    fallbackWindowSec: number;
    /** skip reboot while a GPU compute job is running (alert instead) */
    gpuJobGuard: boolean;
    /** master switch for the reboot tier */
    allowReboot: boolean;
}
export interface HealState {
    failCount: number;
    bootId: string;
    bootHealthySince: number | null;
    lastRebootAttempt: number;
    lastNmRestart: number;
    lastReconnect: number;
    lastFallback: number;
    degradedUntil: number;
    pendingRebootRecovery: boolean;
    failedBootRecoveries: number;
    rebootSuppressUntil: number;
}
export interface HealthProbe {
    associatedSsid: string | null;
    gatewayReachable: boolean;
    /** anchor hostname -> reachable via tailscale ping */
    anchorsReachable: Record<string, boolean>;
    internetReachable: boolean;
}
export interface HealthResult {
    healthy: boolean;
    remoteScore: number;
    reasons: string[];
}
export type HealAction = "none" | "reconnect_wifi" | "restart_nm" | "fallback_ssid" | "restore_preferred" | "reboot";
export type SuppressedReason = "disabled" | "gpu" | "rate" | "loop";
export interface HealDecision {
    action: HealAction;
    /** set when a reboot was wanted but withheld */
    suppressedReason?: SuppressedReason;
    state: HealState;
}
export declare const DEFAULT_THRESHOLDS: HealThresholds;
export declare const DEFAULT_HEAL_CONFIG: HealConfig;
export declare function defaultHealState(): HealState;
export declare function getHealConfigPath(): string;
export declare function getHealStatePath(): string;
export declare function readHealConfig(path?: string): HealConfig;
export declare function writeHealConfig(config: HealConfig, path?: string): void;
export declare function readHealState(path?: string): HealState;
export declare function writeHealState(state: HealState, path?: string): void;
/**
 * Pure health evaluation. Healthy requires the local invariants (associated to an
 * acceptable SSID + gateway reachable) AND a remote quorum of reachable anchors,
 * so a node that is locally fine but isolated from its peers is correctly unhealthy.
 */
export declare function evaluateHealth(probe: HealthProbe, config: HealConfig, state: HealState): HealthResult;
/**
 * Pure escalation state machine. Given the current persisted state, whether this
 * tick is healthy, the clock, GPU activity, and config, decide the single action
 * to take and return the updated state. No side effects.
 */
export declare function decideAction(input: {
    state: HealState;
    healthy: boolean;
    now: number;
    gpuBusy: boolean;
    config: HealConfig;
    currentBootId: string;
}): HealDecision;
export declare function getCurrentBootId(): string;
export declare function detectWifiInterface(): string;
export declare function detectGateway(): string;
export declare function getAssociatedSsid(): string | null;
export declare function pingHost(host: string): boolean;
export declare function internetReachable(url: string): boolean;
export declare function tailscalePing(host: string): boolean;
export declare function gpuBusy(): boolean;
/** Auto-discover online tailscale peers (excluding self) as anchors. */
export declare function discoverAnchors(): string[];
export declare function probeHealth(config: HealConfig): HealthProbe;
/** Apply the action's side effects. Returns a human-readable description. */
export declare function executeAction(action: HealAction, config: HealConfig): string;
