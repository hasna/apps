// Daemon + privileged install for the self-healing watchdog (see heal.ts).
//
// The daemon runs a fixed-interval loop: probe -> evaluateHealth -> decideAction
// -> executeAction -> persist state, logging each tick to stdout (journald under
// systemd). Install wires a systemd service, enables the hardware watchdog, and
// applies SSID determinism so the node cannot silently roam off its network.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../paths.js";
import {
  decideAction,
  detectWifiInterface,
  evaluateHealth,
  executeAction,
  getCurrentBootId,
  gpuBusy,
  probeHealth,
  readHealConfig,
  readHealState,
  writeHealState,
  type HealConfig,
} from "./heal.js";

const DAEMON_PID_PATH = join(getDataDir(), "heal-daemon.pid");
const SERVICE_PATH = "/etc/systemd/system/machines-heal.service";
const SYSTEM_CONF = "/etc/systemd/system.conf";

export interface HealTickResult {
  healthy: boolean;
  action: string;
  suppressedReason?: string;
  reasons: string[];
  remoteScore: number;
  failCount: number;
  executed: string;
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} [machines-heal] ${msg}`);
}

/** Run a single health/decision tick. With dryRun=true, never executes side effects. */
export function runHealOnce(config: HealConfig, opts: { dryRun?: boolean } = {}): HealTickResult {
  const state = readHealState();
  const probe = probeHealth(config);
  const health = evaluateHealth(probe, config, state);
  const busy = config.gpuJobGuard ? gpuBusy() : false;
  const decision = decideAction({
    state,
    healthy: health.healthy,
    now: Math.floor(Date.now() / 1000),
    gpuBusy: busy,
    config,
    currentBootId: getCurrentBootId(),
  });

  let executed = "skipped (dry-run)";
  if (!opts.dryRun) {
    writeHealState(decision.state);
    if (decision.action !== "none") executed = executeAction(decision.action, config);
    else executed = "no action";
  }

  const result: HealTickResult = {
    healthy: health.healthy,
    action: decision.action,
    suppressedReason: decision.suppressedReason,
    reasons: health.reasons,
    remoteScore: health.remoteScore,
    failCount: decision.state.failCount,
    executed,
  };

  const sup = decision.suppressedReason ? ` suppressed=${decision.suppressedReason}` : "";
  log(
    health.healthy
      ? `healthy (quorum ${health.remoteScore}) action=${decision.action} ${executed}`
      : `UNHEALTHY [${health.reasons.join(",")}] fails=${decision.state.failCount} action=${decision.action}${sup} -> ${executed}`,
  );
  return result;
}

function writePid(pid: number): void {
  writeFileSync(DAEMON_PID_PATH, `${pid}\n`);
}

function readPid(): number | null {
  try {
    const pid = Number.parseInt(readFileSync(DAEMON_PID_PATH, "utf8").trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopHealDaemon(): { stopped: boolean; pid: number | null } {
  const pid = readPid();
  if (pid && isProcessRunning(pid)) {
    process.kill(pid, "SIGTERM");
    return { stopped: true, pid };
  }
  return { stopped: false, pid };
}

export function startHealDaemon(): void {
  const config = readHealConfig();
  if (!config.preferredSsid) {
    log("refusing to start: preferredSsid is not configured (run `machines heal config --set ...`)");
    process.exit(1);
  }
  writePid(process.pid);
  log(`daemon started (pid ${process.pid}) interval=${config.intervalSec}s preferred=${config.preferredSsid}`);
  const tick = () => {
    try {
      runHealOnce(config);
    } catch (err) {
      log(`tick error: ${(err as Error).message}`);
    }
  };
  tick();
  setInterval(tick, Math.max(10, config.intervalSec) * 1000);
}

function sh(cmd: string, timeoutMs = 15000): { ok: boolean; out: string } {
  const r = Bun.spawnSync(["bash", "-lc", cmd], { stdout: "pipe", stderr: "pipe", env: process.env, timeout: timeoutMs });
  return { ok: r.exitCode === 0, out: `${r.stdout.toString("utf8")}${r.stderr.toString("utf8")}`.trim() };
}

/**
 * SSID determinism: pin the preferred profile (autoconnect + high priority, power
 * save off) and disable autoconnect on every other Wi-Fi profile so the node
 * cannot silently roam onto an isolated network.
 */
export function applyDeterminism(config: HealConfig): string[] {
  const iface = config.wifiInterface || detectWifiInterface();
  const log: string[] = [];
  if (!config.preferredSsid) return ["no preferredSsid configured; skipping determinism"];

  sh(`nmcli connection modify "${config.preferredSsid}" connection.autoconnect yes connection.autoconnect-priority 10 802-11-wireless.powersave 2`);
  log.push(`pinned ${config.preferredSsid} (autoconnect, priority 10, powersave off)`);

  const profiles = sh(`nmcli -t -f NAME,TYPE connection show 2>/dev/null | awk -F: '$2 ~ /wireless/{print $1}'`).out.split("\n").filter(Boolean);
  for (const p of profiles) {
    if (p === config.preferredSsid) continue;
    if (p === config.fallbackSsid) {
      // fallback stays known but must not auto-connect on its own
      sh(`nmcli connection modify "${p}" connection.autoconnect no`);
      log.push(`disabled autoconnect on fallback ${p}`);
      continue;
    }
    sh(`nmcli connection modify "${p}" connection.autoconnect no`);
    log.push(`disabled autoconnect on ${p}`);
  }
  if (iface) {
    sh(`iw dev ${iface} set power_save off 2>/dev/null || true`);
    log.push(`power_save off on ${iface}`);
  }
  return log;
}

/** Enable the systemd hardware watchdog for true freezes (idempotent). */
export function enableHardwareWatchdog(): string[] {
  const log: string[] = [];
  if (!existsSync(SYSTEM_CONF)) return ["/etc/systemd/system.conf not found; skipping hardware watchdog"];
  let conf = readFileSync(SYSTEM_CONF, "utf8");
  const set = (key: string, value: string) => {
    const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
    if (re.test(conf)) conf = conf.replace(re, `${key}=${value}`);
    else conf += `\n${key}=${value}\n`;
  };
  set("RuntimeWatchdogSec", "20s");
  set("RebootWatchdogSec", "2min");
  writeFileSync(SYSTEM_CONF, conf);
  sh("systemctl daemon-reexec");
  log.push("hardware watchdog: RuntimeWatchdogSec=20s RebootWatchdogSec=2min");
  return log;
}

function binPath(): string {
  // Resolve the installed `machines` binary for the systemd ExecStart.
  const r = sh("command -v machines");
  return r.ok && r.out ? r.out.split("\n")[0]!.trim() : "machines";
}

/** Install + enable the systemd service that runs the daemon as root. */
export function installHealService(): string[] {
  const log: string[] = [];
  const exec = binPath();
  const unit = `[Unit]
Description=Hasna machines self-healing network watchdog
After=network.target NetworkManager.service tailscaled.service
Wants=network.target

[Service]
Type=simple
ExecStart=${exec} heal daemon
Restart=always
RestartSec=10
# Persisted state/config live in root's data dir.
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
`;
  writeFileSync(SERVICE_PATH, unit);
  sh("systemctl daemon-reload");
  sh("systemctl enable --now machines-heal.service");
  log.push(`installed + enabled ${SERVICE_PATH} (ExecStart=${exec} heal daemon)`);
  return log;
}

export function uninstallHealService(): string[] {
  const log: string[] = [];
  sh("systemctl disable --now machines-heal.service 2>/dev/null || true");
  if (existsSync(SERVICE_PATH)) {
    sh(`rm -f ${SERVICE_PATH}`);
    sh("systemctl daemon-reload");
    log.push(`removed ${SERVICE_PATH}`);
  } else {
    log.push("service not installed");
  }
  return log;
}

export function healServiceStatus(): { installed: boolean; active: boolean; enabled: boolean } {
  return {
    installed: existsSync(SERVICE_PATH),
    active: sh("systemctl is-active machines-heal.service").out === "active",
    enabled: sh("systemctl is-enabled machines-heal.service 2>/dev/null").out === "enabled",
  };
}
