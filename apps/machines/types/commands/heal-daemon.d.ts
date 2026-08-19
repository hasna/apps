import { type HealConfig } from "./heal.js";
export interface HealTickResult {
    healthy: boolean;
    action: string;
    suppressedReason?: string;
    reasons: string[];
    remoteScore: number;
    failCount: number;
    executed: string;
}
/** Run a single health/decision tick. With dryRun=true, never executes side effects. */
export declare function runHealOnce(config: HealConfig, opts?: {
    dryRun?: boolean;
}): HealTickResult;
export declare function stopHealDaemon(): {
    stopped: boolean;
    pid: number | null;
};
export declare function startHealDaemon(): void;
/**
 * SSID determinism: pin the preferred profile (autoconnect + high priority, power
 * save off) and disable autoconnect on every other Wi-Fi profile so the node
 * cannot silently roam onto an isolated network.
 */
export declare function applyDeterminism(config: HealConfig): string[];
/** Enable the systemd hardware watchdog for true freezes (idempotent). */
export declare function enableHardwareWatchdog(): string[];
/** Install + enable the systemd service that runs the daemon as root. */
export declare function installHealService(): string[];
export declare function uninstallHealService(): string[];
export declare function healServiceStatus(): {
    installed: boolean;
    active: boolean;
    enabled: boolean;
};
