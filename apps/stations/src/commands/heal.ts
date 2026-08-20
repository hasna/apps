// Self-healing network watchdog for fleet stations.
//
// Background: a headless Wi-Fi node can silently roam onto an isolated band/SSID
// where it has internet but is unreachable by peers. A hardware watchdog never
// fires (no freeze) and a naive "tailscaled up + internet reachable" check passes
// locally, so neither catches it. The fix is a *peer-reachability* oracle plus
// SSID determinism, with carefully gated escalation up to a reboot.
//
// This module keeps the escalation decision logic PURE (evaluateHealth +
// decideAction) so it is fully unit-testable; all system interaction lives in the
// thin executor/probe wrappers and the daemon loop.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureParentDir, getDataDir } from "../paths.js";

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

export type HealAction =
  | "none"
  | "reconnect_wifi"
  | "restart_nm"
  | "fallback_ssid"
  | "restore_preferred"
  | "reboot";

export type SuppressedReason = "disabled" | "gpu" | "rate" | "loop";

export interface HealDecision {
  action: HealAction;
  /** set when a reboot was wanted but withheld */
  suppressedReason?: SuppressedReason;
  state: HealState;
}

export const DEFAULT_THRESHOLDS: HealThresholds = {
  reconnect: 3,
  nmRestart: 7,
  fallback: 12,
  reboot: 15,
};

export const DEFAULT_HEAL_CONFIG: HealConfig = {
  version: 1,
  enabled: true,
  wifiInterface: "",
  preferredSsid: "",
  fallbackSsid: "",
  internetUrl: "https://1.1.1.1",
  tailscaleAnchors: [],
  quorumRequired: 2,
  intervalSec: 60,
  thresholds: { ...DEFAULT_THRESHOLDS },
  rebootMinIntervalSec: 1800,
  nmRestartMinIntervalSec: 1800,
  reconnectMinIntervalSec: 120,
  healthyWindowSec: 300,
  maxFailedBootRecoveries: 2,
  bootBackoffSec: 21600,
  fallbackWindowSec: 600,
  gpuJobGuard: true,
  allowReboot: true,
};

export function defaultHealState(): HealState {
  return {
    failCount: 0,
    bootId: "",
    bootHealthySince: null,
    lastRebootAttempt: 0,
    lastNmRestart: 0,
    lastReconnect: 0,
    lastFallback: 0,
    degradedUntil: 0,
    pendingRebootRecovery: false,
    failedBootRecoveries: 0,
    rebootSuppressUntil: 0,
  };
}

export function getHealConfigPath(): string {
  return process.env["HASNA_STATIONS_HEAL_CONFIG_PATH"] || join(getDataDir(), "heal-config.json");
}

export function getHealStatePath(): string {
  return process.env["HASNA_STATIONS_HEAL_STATE_PATH"] || join(getDataDir(), "heal-state.json");
}

export function readHealConfig(path?: string): HealConfig {
  const p = path || getHealConfigPath();
  if (!existsSync(p)) return { ...DEFAULT_HEAL_CONFIG, thresholds: { ...DEFAULT_THRESHOLDS } };
  const parsed = JSON.parse(readFileSync(p, "utf8")) as Partial<HealConfig>;
  return {
    ...DEFAULT_HEAL_CONFIG,
    ...parsed,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(parsed.thresholds || {}) },
    tailscaleAnchors: parsed.tailscaleAnchors ?? [],
  };
}

export function writeHealConfig(config: HealConfig, path?: string): void {
  const p = path || getHealConfigPath();
  ensureParentDir(p);
  writeFileSync(p, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function readHealState(path?: string): HealState {
  const p = path || getHealStatePath();
  if (!existsSync(p)) return defaultHealState();
  try {
    return { ...defaultHealState(), ...(JSON.parse(readFileSync(p, "utf8")) as Partial<HealState>) };
  } catch {
    return defaultHealState();
  }
}

export function writeHealState(state: HealState, path?: string): void {
  const p = path || getHealStatePath();
  ensureParentDir(p);
  writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * Pure health evaluation. Healthy requires the local invariants (associated to an
 * acceptable SSID + gateway reachable) AND a remote quorum of reachable anchors,
 * so a node that is locally fine but isolated from its peers is correctly unhealthy.
 */
export function evaluateHealth(probe: HealthProbe, config: HealConfig, state: HealState): HealthResult {
  const reasons: string[] = [];
  const inDegraded = state.degradedUntil > 0;
  const acceptableSsid =
    probe.associatedSsid === config.preferredSsid ||
    (config.fallbackSsid !== "" && inDegraded && probe.associatedSsid === config.fallbackSsid);

  if (!acceptableSsid) reasons.push(`wrong-ssid:${probe.associatedSsid ?? "none"}`);
  if (!probe.gatewayReachable) reasons.push("gateway-unreachable");

  let remoteScore = 0;
  for (const [anchor, ok] of Object.entries(probe.anchorsReachable)) {
    if (ok) remoteScore += 1;
    else reasons.push(`anchor-down:${anchor}`);
  }
  if (probe.internetReachable) remoteScore += 1;
  else reasons.push("internet-down");

  const localOk = acceptableSsid && probe.gatewayReachable;
  const quorumOk = remoteScore >= config.quorumRequired;
  if (!quorumOk) reasons.push(`quorum:${remoteScore}/${config.quorumRequired}`);

  return { healthy: localOk && quorumOk, remoteScore, reasons };
}

/**
 * Pure escalation state machine. Given the current persisted state, whether this
 * tick is healthy, the clock, GPU activity, and config, decide the single action
 * to take and return the updated state. No side effects.
 */
export function decideAction(input: {
  state: HealState;
  healthy: boolean;
  now: number;
  gpuBusy: boolean;
  config: HealConfig;
  currentBootId: string;
}): HealDecision {
  const { healthy, now, gpuBusy, config, currentBootId } = input;
  const s: HealState = { ...input.state };
  const t = config.thresholds;

  // Boot transition: a fresh boot resets per-boot counters but preserves the
  // loop-prevention bookkeeping so a reboot that didn't fix things can be caught.
  if (s.bootId !== currentBootId) {
    s.bootId = currentBootId;
    s.bootHealthySince = null;
    s.failCount = 0;
  }

  if (healthy) {
    s.failCount = 0;
    if (s.bootHealthySince === null) s.bootHealthySince = now;
    if (now - s.bootHealthySince >= config.healthyWindowSec) {
      // Sustained health: clear loop-prevention bookkeeping.
      s.failedBootRecoveries = 0;
      s.rebootSuppressUntil = 0;
      s.pendingRebootRecovery = false;
    }
    if (s.degradedUntil > 0 && now >= s.degradedUntil) {
      s.degradedUntil = 0;
      return { action: "restore_preferred", state: s };
    }
    return { action: "none", state: s };
  }

  // Unhealthy.
  s.failCount += 1;
  s.bootHealthySince = null;

  // Highest applicable tier by consecutive failure count.
  let tier: "none" | "reconnect" | "nmRestart" | "fallback" | "reboot" = "none";
  if (s.failCount >= t.reboot) tier = "reboot";
  else if (s.failCount >= t.fallback && config.fallbackSsid !== "") tier = "fallback";
  else if (s.failCount >= t.nmRestart) tier = "nmRestart";
  else if (s.failCount >= t.reconnect) tier = "reconnect";

  const tryReconnect = (reason?: SuppressedReason): HealDecision => {
    if (now - s.lastReconnect >= config.reconnectMinIntervalSec) {
      s.lastReconnect = now;
      return { action: "reconnect_wifi", suppressedReason: reason, state: s };
    }
    return { action: "none", suppressedReason: reason, state: s };
  };

  switch (tier) {
    case "reconnect":
      return tryReconnect();
    case "nmRestart":
      if (now - s.lastNmRestart >= config.nmRestartMinIntervalSec) {
        s.lastNmRestart = now;
        return { action: "restart_nm", state: s };
      }
      return tryReconnect();
    case "fallback":
      if (now - s.lastFallback >= config.fallbackWindowSec) {
        s.lastFallback = now;
        s.degradedUntil = now + config.fallbackWindowSec;
        return { action: "fallback_ssid", state: s };
      }
      return tryReconnect();
    case "reboot": {
      let reason: SuppressedReason | null = null;
      if (!config.allowReboot) reason = "disabled";
      else if (now < s.rebootSuppressUntil) reason = "loop";
      else if (config.gpuJobGuard && gpuBusy) reason = "gpu";
      else if (now - s.lastRebootAttempt < config.rebootMinIntervalSec) reason = "rate";

      if (reason) return tryReconnect(reason);

      // Loop guard: a prior reboot that never reached a healthy window.
      if (s.pendingRebootRecovery) {
        s.failedBootRecoveries += 1;
        if (s.failedBootRecoveries >= config.maxFailedBootRecoveries) {
          s.rebootSuppressUntil = now + config.bootBackoffSec;
          return tryReconnect("loop");
        }
      }
      s.lastRebootAttempt = now;
      s.pendingRebootRecovery = true;
      return { action: "reboot", state: s };
    }
    default:
      return { action: "none", state: s };
  }
}

// ---------------------------------------------------------------------------
// System interaction (impure thin wrappers). Kept out of the pure logic above.
// ---------------------------------------------------------------------------

function sh(cmd: string, timeoutMs = 8000): { ok: boolean; out: string } {
  // Non-login shell: a login shell (`-l`) sources profile scripts that can emit
  // MOTD/banner output to stdout and reset PATH, which corrupts parsed results.
  const r = Bun.spawnSync(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe", env: process.env, timeout: timeoutMs });
  return { ok: r.exitCode === 0, out: r.stdout.toString("utf8").trim() };
}

export function getCurrentBootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "";
  }
}

export function detectWifiInterface(): string {
  const r = sh(`nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: '$2=="wifi"{print $1; exit}'`);
  return r.ok ? r.out : "";
}

export function detectGateway(): string {
  const r = sh(`ip route 2>/dev/null | awk '/^default/{print $3; exit}'`);
  return r.ok ? r.out : "";
}

export function getAssociatedSsid(): string | null {
  const r = sh(`iwgetid -r 2>/dev/null || nmcli -t -f active,ssid dev wifi 2>/dev/null | awk -F: '/^yes/{print $2; exit}'`);
  return r.ok && r.out ? r.out : null;
}

export function pingHost(host: string): boolean {
  if (!host) return false;
  return sh(`ping -c1 -W2 ${host} >/dev/null 2>&1`, 5000).ok;
}

export function internetReachable(url: string): boolean {
  return sh(`curl -sf -m5 -o /dev/null ${url}`, 8000).ok;
}

export function tailscalePing(host: string): boolean {
  return sh(`timeout 8 tailscale ping --until-direct=false ${host} 2>/dev/null | grep -q pong`, 10000).ok;
}

export function gpuBusy(): boolean {
  return sh(`command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null | grep -q .`, 6000).ok;
}

/** Auto-discover online tailscale peers (excluding self) as anchors. */
export function discoverAnchors(): string[] {
  const r = sh(`tailscale status --json 2>/dev/null`);
  if (!r.ok) return [];
  try {
    const status = JSON.parse(r.out) as { Peer?: Record<string, { HostName?: string; DNSName?: string; Online?: boolean }> };
    const anchors: string[] = [];
    for (const peer of Object.values(status.Peer || {})) {
      const name = peer.HostName || (peer.DNSName || "").split(".")[0];
      if (name) anchors.push(name);
    }
    return anchors;
  } catch {
    return [];
  }
}

export function probeHealth(config: HealConfig): HealthProbe {
  const gw = config.wifiInterface ? detectGateway() : detectGateway();
  const anchors = config.tailscaleAnchors.length > 0 ? config.tailscaleAnchors : discoverAnchors().slice(0, 3);
  const anchorsReachable: Record<string, boolean> = {};
  for (const a of anchors) anchorsReachable[a] = tailscalePing(a);
  return {
    associatedSsid: getAssociatedSsid(),
    gatewayReachable: pingHost(gw),
    anchorsReachable,
    internetReachable: internetReachable(config.internetUrl),
  };
}

/** Apply the action's side effects. Returns a human-readable description. */
export function executeAction(action: HealAction, config: HealConfig): string {
  const iface = config.wifiInterface || detectWifiInterface();
  switch (action) {
    case "reconnect_wifi":
      sh(`nmcli connection up "${config.preferredSsid}" 2>&1; tailscale up 2>&1 || true`, 30000);
      return `reconnected wifi to ${config.preferredSsid}`;
    case "restart_nm":
      sh(`systemctl restart NetworkManager 2>&1; sleep 5; nmcli connection up "${config.preferredSsid}" 2>&1; tailscale up 2>&1 || true`, 40000);
      return "restarted NetworkManager";
    case "fallback_ssid":
      sh(`nmcli connection modify "${config.fallbackSsid}" connection.autoconnect yes 2>&1; nmcli connection up "${config.fallbackSsid}" 2>&1; tailscale up 2>&1 || true`, 30000);
      return `switched to degraded fallback ${config.fallbackSsid}`;
    case "restore_preferred":
      sh(`nmcli connection modify "${config.fallbackSsid}" connection.autoconnect no 2>&1; nmcli connection up "${config.preferredSsid}" 2>&1; tailscale up 2>&1 || true`, 30000);
      return `restored preferred ${config.preferredSsid}`;
    case "reboot":
      sh(`systemctl reboot 2>&1 || reboot 2>&1`, 10000);
      return "reboot issued";
    default:
      return "no action";
  }
  void iface;
}
