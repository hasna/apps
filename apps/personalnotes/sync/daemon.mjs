import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { dataRoot, notesDir } from '../tools/notes-lib.mjs';
import { CONFIG_PATH, loadClientConfig, resolveClientConfig } from './client.mjs';
import { runSync, summaryLine } from './engine.mjs';

// Sync scheduling: `personalnotes sync --watch` daemon mode plus the pieces the
// GUI shell and the install story share. Design notes live in docs/sync.md.
//
// Invariants:
// - ONE sync at a time per data root: every non-dry run (CLI one-shot, daemon
//   tick, GUI timer) takes `sync.lock` first. Locks are pid-based and
//   stale-safe: a lock whose owner pid is dead is reclaimed, a live owner is
//   always respected.
// - ONE daemon per data root (`sync-daemon.lock`), same stale rules.
// - Every attempt — success OR failure — records `sync-status.json`, so status
//   surfaces (Settings row, `personalnotes sync status`) can never render an
//   auth failure as a green checkmark. The file is display bookkeeping only;
//   deleting it loses nothing but the status line.
// - The markdown store stays canonical; the daemon only calls the same
//   `runSync` engine the CLI uses.

export const SYNC_STATUS_FILE = 'sync-status.json';
export const RUN_LOCK_FILE = 'sync.lock';
export const DAEMON_LOCK_FILE = 'sync-daemon.lock';
export const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
export const MIN_SYNC_INTERVAL_MINUTES = 1; // sane floor: never hammer a server
export const SYNC_JITTER_FRACTION = 0.1;    // 0..10% late jitter per tick
export const DEFAULT_FS_DEBOUNCE_MS = 3000;
export const LOG_MAX_BYTES = 512 * 1024;

export class SyncLockedError extends Error {
  constructor(owner, message = 'sync already running') {
    const pid = owner?.pid ? ` (pid ${owner.pid})` : '';
    super(`${message}${pid}`);
    this.name = 'SyncLockedError';
    this.code = 'sync_already_running';
    this.owner = owner || null;
  }
}

// ---------------------------------------------------------------------------
// Interval / jitter
// ---------------------------------------------------------------------------

/// Parse a sync interval into MINUTES. Accepts a number (minutes) or a string
/// with an optional s/m/h suffix ("90s", "5m", "1h"). Anything unparsable or
/// non-positive falls back to the default; the floor keeps a typo like `0`
/// from turning the daemon into a busy-loop against the server rate limits.
export function resolveSyncInterval(value, fallback = DEFAULT_SYNC_INTERVAL_MINUTES) {
  let minutes = NaN;
  if (typeof value === 'number') {
    minutes = value;
  } else if (typeof value === 'string' && value.trim()) {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h)?$/i);
    if (match) {
      const n = Number(match[1]);
      const unit = (match[2] || 'm').toLowerCase();
      minutes = unit === 's' ? n / 60 : unit === 'h' ? n * 60 : n;
    }
  }
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = fallback;
  return Math.max(MIN_SYNC_INTERVAL_MINUTES, minutes);
}

/// Interval → delay in ms with 0–10% LATE jitter (never early, so the floor
/// stays honest) to de-synchronize a fleet of machines syncing to one server.
export function jitterMs(intervalMinutes, random = Math.random) {
  const base = intervalMinutes * 60_000;
  return Math.round(base + random() * SYNC_JITTER_FRACTION * base);
}

// ---------------------------------------------------------------------------
// Locks (pid-based, stale-safe)
// ---------------------------------------------------------------------------

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM'; // exists, owned by someone else
  }
}

export function runLockPath(root = dataRoot()) {
  return join(root, RUN_LOCK_FILE);
}

export function daemonLockPath(root = dataRoot()) {
  return join(root, DAEMON_LOCK_FILE);
}

/// Try to take a lock file. Returns `{acquired, owner}`. A live owner pid is
/// ALWAYS respected; a dead owner (crashed process) or an unreadable lock is
/// reclaimed. The pid check assumes the data root is a local filesystem (the
/// store is `~/.hasna/apps/notes`), which is the supported layout.
export async function acquireLock(path) {
  const payload = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, JSON.stringify(payload) + '\n', { flag: 'wx' });
      return { acquired: true, owner: payload };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      let owner = null;
      try {
        owner = JSON.parse(await readFile(path, 'utf8'));
      } catch {
        owner = null; // unreadable/partial lock = crashed writer, reclaim
      }
      const ownerPid = Number(owner?.pid);
      // A live owner is respected — including THIS process (a second in-process
      // acquire must fail, not steal). Pid reuse after reboot is the accepted
      // residual risk of pid locks.
      if (pidAlive(ownerPid)) {
        return { acquired: false, owner };
      }
      // Stale — claim the right to reclaim ATOMICALLY by renaming the dead
      // lock aside first. A bare rm() here would race a second contender:
      // both read the stale lock, the faster one rm+recreates, the slower
      // one's rm() deletes the fresh lock and both end up holding it. rename()
      // succeeds for exactly one contender (the loser gets ENOENT and simply
      // retries the exclusive create), and only ever moves the inode we read.
      const claim = `${path}.stale.${process.pid}.${randomUUID()}`;
      try {
        await rename(path, claim);
        await rm(claim, { force: true });
      } catch { /* another contender claimed it first — retry the create */ }
    }
  }
  return { acquired: false, owner: null };
}

/// Release a lock, but only if THIS process owns it (never clobber a lock a
/// concurrent process legitimately reclaimed after our crash-window).
export async function releaseLock(path) {
  try {
    const owner = JSON.parse(await readFile(path, 'utf8'));
    if (Number(owner?.pid) !== process.pid) return false;
  } catch {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

// ---------------------------------------------------------------------------
// Status file (last sync outcome; read by CLI status + the app Settings row)
// ---------------------------------------------------------------------------

export function syncStatusPath(root = dataRoot()) {
  return join(root, SYNC_STATUS_FILE);
}

export async function readSyncStatus(root = dataRoot()) {
  try {
    const parsed = JSON.parse(await readFile(syncStatusPath(root), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/// Shallow-merge `patch` over the stored status (atomic tmp+rename write), so
/// an error attempt keeps the previous `lastSuccessAt`/`cursor` for display.
export async function writeSyncStatus(patch, root = dataRoot()) {
  const previous = (await readSyncStatus(root)) || {};
  const next = { version: 1, ...previous, ...patch };
  await mkdir(root, { recursive: true });
  const tmp = join(root, `.${SYNC_STATUS_FILE}.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  await rename(tmp, syncStatusPath(root));
  return next;
}

// ---------------------------------------------------------------------------
// Guarded one-shot run: lock + runSync + status record
// ---------------------------------------------------------------------------

/// The entry every scheduled or manual sync goes through (except --dry-run,
/// which neither locks nor records — it changes nothing). Throws
/// SyncLockedError when another sync holds the run lock.
export async function runSyncGuarded(options = {}) {
  if (options.dryRun) return runSync(options);
  const root = options.root || dataRoot();
  await mkdir(root, { recursive: true });
  const lockPath = runLockPath(root);
  const lock = await acquireLock(lockPath);
  if (!lock.acquired) throw new SyncLockedError(lock.owner);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runner = options.runner || 'cli';
  try {
    const summary = await runSync(options);
    await writeSyncStatus({
      status: 'ok',
      lastSyncAt: startedAt,
      lastSuccessAt: startedAt,
      error: '',
      apiUrl: summary.apiUrl,
      cursor: summary.cursor,
      pushed: summary.pushed,
      pulled: summary.pulled,
      conflicts: summary.conflicts.length,
      runner,
      durationMs: Date.now() - t0,
    }, root);
    return summary;
  } catch (err) {
    let apiUrl = options.client?.config?.apiUrl || '';
    if (!apiUrl) {
      try { apiUrl = (await resolveClientConfig(options.overrides || {})).apiUrl; } catch { /* status only */ }
    }
    await writeSyncStatus({
      status: 'error',
      lastSyncAt: startedAt,
      error: String(err?.message || err),
      ...(apiUrl ? { apiUrl } : {}),
      runner,
      durationMs: Date.now() - t0,
    }, root);
    throw err;
  } finally {
    await releaseLock(lockPath);
  }
}

// ---------------------------------------------------------------------------
// Daemon log
// ---------------------------------------------------------------------------

/// Platform log home: `~/Library/Logs/PersonalNotes/sync.log` on macOS,
/// `$XDG_STATE_HOME/personalnotes/sync.log` (default `~/.local/state/...`)
/// on Linux and everything else.
export function syncLogPath({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Logs', 'PersonalNotes', 'sync.log');
  const stateHome = env.XDG_STATE_HOME || join(home, '.local', 'state');
  return join(stateHome, 'personalnotes', 'sync.log');
}

/// Append-only logger with a one-slot size rotation (`sync.log` → `sync.log.1`
/// at 512 KiB) so an always-on daemon can never fill a disk. Also mirrors to
/// stdout, which launchd/systemd capture into their own streams.
export function createSyncLogger(path, { maxBytes = LOG_MAX_BYTES, echo = true } = {}) {
  return async function log(line) {
    const stamped = `${new Date().toISOString()} ${line}`;
    if (echo) process.stdout.write(stamped + '\n');
    try {
      await mkdir(dirname(path), { recursive: true });
      const size = await stat(path).then(s => s.size).catch(() => 0);
      if (size > maxBytes) await rename(path, `${path}.1`).catch(() => {});
      await appendFile(path, stamped + '\n', 'utf8');
    } catch {
      // Logging must never take the daemon down.
    }
  };
}

// ---------------------------------------------------------------------------
// Install story: launchd plist (macOS) / systemd user unit (Linux)
// ---------------------------------------------------------------------------

export const SERVICE_LABEL = 'com.personalnotes.sync';
export const SYSTEMD_UNIT_NAME = 'personalnotes-sync.service';

function plistEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/// systemd unit-file quoting (ExecStart arguments, Environment= assignments):
/// values with whitespace/quotes/backslashes must be wrapped in double quotes
/// with `\` and `"` escaped; plain values pass through untouched.
function systemdQuote(value) {
  const v = String(value);
  if (!/[\s"'\\]/.test(v)) return v;
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/// Pure description of the user-level service for a platform: target `path`,
/// file `content`, and the shell `instructions` to enable it. Both services
/// run the CLI daemon (`sync --watch`), which owns interval, locks, and logs —
/// so KeepAlive/Restart only have to keep one process alive.
export function serviceDefinition({
  platform = process.platform,
  nodePath = process.execPath,
  scriptPath,
  env = process.env,
  home = homedir(),
} = {}) {
  if (!scriptPath) throw new Error('scriptPath_required');
  const passthrough = {};
  for (const key of ['PERSONALNOTES_ROOT', 'PERSONALNOTES_CONFIG', 'PERSONALNOTES_API_URL']) {
    if (env[key]) passthrough[key] = env[key];
  }
  if (platform === 'darwin') {
    const path = join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
    const launchdLog = join(home, 'Library', 'Logs', 'PersonalNotes', 'sync-launchd.log');
    const envBlock = Object.keys(passthrough).length
      ? `    <key>EnvironmentVariables</key>\n    <dict>\n${Object.entries(passthrough)
        .map(([k, v]) => `        <key>${plistEscape(k)}</key><string>${plistEscape(v)}</string>`)
        .join('\n')}\n    </dict>\n`
      : '';
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${plistEscape(nodePath)}</string>
        <string>${plistEscape(scriptPath)}</string>
        <string>sync</string>
        <string>--watch</string>
    </array>
${envBlock}    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>${plistEscape(launchdLog)}</string>
    <key>StandardErrorPath</key><string>${plistEscape(launchdLog)}</string>
</dict>
</plist>
`;
    return {
      platform: 'darwin',
      path,
      content,
      instructions: [
        `launchctl unload ${path} 2>/dev/null || true`,
        `launchctl load ${path}`,
      ],
    };
  }
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  const path = join(configHome, 'systemd', 'user', SYSTEMD_UNIT_NAME);
  // Quoting parity with the plist XML-escaping above: a path or env value
  // containing whitespace (or quotes/backslashes) must be double-quoted with
  // \\ and \" escaped, or systemd mis-parses/rejects the unit.
  const envLines = Object.entries(passthrough)
    .map(([k, v]) => `Environment=${systemdQuote(`${k}=${v}`)}`)
    .join('\n');
  const content = `[Unit]
Description=PersonalNotes sync daemon (personalnotes sync --watch)
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=${systemdQuote(nodePath)} ${systemdQuote(scriptPath)} sync --watch
Restart=on-failure
RestartSec=10
${envLines ? envLines + '\n' : ''}
[Install]
WantedBy=default.target
`;
  return {
    platform: 'linux',
    path,
    content,
    instructions: [
      'systemctl --user daemon-reload',
      `systemctl --user enable --now ${SYSTEMD_UNIT_NAME.replace(/\.service$/, '')}`,
    ],
  };
}

export async function installService(options = {}) {
  const def = serviceDefinition(options);
  await mkdir(dirname(def.path), { recursive: true });
  await writeFile(def.path, def.content, 'utf8');
  return def;
}

export async function uninstallService(options = {}) {
  const def = serviceDefinition(options);
  let removed = false;
  try {
    await rm(def.path);
    removed = true;
  } catch { /* already absent */ }
  const instructions = def.platform === 'darwin'
    ? [`launchctl unload ${def.path} 2>/dev/null || true`]
    : [`systemctl --user disable --now ${SYSTEMD_UNIT_NAME.replace(/\.service$/, '')} 2>/dev/null || true`,
       'systemctl --user daemon-reload'];
  return { ...def, removed, instructions };
}

// ---------------------------------------------------------------------------
// Daemon loop: interval poll + debounced FS watch, single instance, clean stop
// ---------------------------------------------------------------------------

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/// `personalnotes sync --watch`. Returns a controller `{ stop }`; the pending
/// timer/watcher keep the process alive until `stop()` (or SIGTERM/SIGINT,
/// which call it). The interval is re-read from the client config every cycle,
/// so `syncIntervalMinutes` edits and a fresh `auth device` login apply
/// without a restart.
export async function watchSync(options = {}) {
  const root = options.root || dataRoot();
  await mkdir(notesDir(root), { recursive: true });
  const lockPath = daemonLockPath(root);
  const lock = await acquireLock(lockPath);
  if (!lock.acquired) throw new SyncLockedError(lock.owner, 'sync daemon already running');

  const log = options.log || createSyncLogger(options.logPath || syncLogPath());
  const random = options.random || Math.random;
  const debounceMs = options.debounceMs ?? DEFAULT_FS_DEBOUNCE_MS;
  const configPath = options.configPath || CONFIG_PATH;

  let stopped = false;
  let running = false;
  let queued = false;
  let timer = null;
  let debounceTimer = null;
  let watcher = null;

  async function intervalMinutes() {
    const file = await loadClientConfig(configPath);
    return resolveSyncInterval(
      options.interval
      ?? process.env.PERSONALNOTES_SYNC_INTERVAL_MINUTES
      ?? file.syncIntervalMinutes,
    );
  }

  function scheduleNext(minutes) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void cycle('interval'); }, jitterMs(minutes, random));
  }

  async function runOnce(trigger) {
    if (stopped || running) {
      if (running) queued = true;
      return;
    }
    running = true;
    try {
      const summary = await runSyncGuarded({
        root,
        client: options.client,
        overrides: options.overrides,
        runner: 'daemon',
      });
      await log(`sync ok (${trigger}): ${summaryLine(summary)}`);
    } catch (err) {
      if (err?.code === 'sync_already_running') {
        await log(`sync skipped (${trigger}): ${err.message}`);
      } else {
        await log(`sync error (${trigger}): ${err?.message || err}`);
      }
    } finally {
      running = false;
    }
    if (queued && !stopped) {
      // Edits landed mid-run (or a run was requested while busy): one follow-up
      // pass converges; a no-op pass writes nothing under notes/, so this
      // cannot self-oscillate off the FS watcher.
      queued = false;
      await runOnce(`${trigger}+queued`);
    }
  }

  async function cycle(trigger) {
    await runOnce(trigger);
    scheduleNext(await intervalMinutes());
  }

  async function stop(reason = 'stop') {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    clearTimeout(debounceTimer);
    timer = null;
    debounceTimer = null;
    try { watcher?.close(); } catch { /* already closed */ }
    // Let an in-flight run finish (bounded) so its state/status writes land;
    // a hard kill is still safe (pending-batch resume), just noisier.
    for (let waited = 0; running && waited < 15_000; waited += 100) await sleep(100);
    await log(`daemon stopped (${reason}) pid=${process.pid}`);
    await releaseLock(lockPath);
  }

  if (options.handleSignals !== false) {
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, () => {
        void stop(signal).then(() => process.exit(0));
      });
    }
  }

  // Debounced FS watch: a local edit syncs within seconds; the interval poll
  // remains the safety net for remote changes and missed events. The notes dir
  // is flat, so a non-recursive watch sees every note file. Lock/state/status
  // files live in the root (NOT under notes/), so the daemon's own bookkeeping
  // never re-triggers the watcher.
  try {
    watcher = watch(notesDir(root), () => {
      if (stopped) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void cycle('fs-change'); }, debounceMs);
    });
  } catch (err) {
    await log(`fs watch unavailable (${err?.message || err}) — interval polling only`);
  }

  const minutes = await intervalMinutes();
  await log(`daemon started pid=${process.pid} root=${root} interval=${minutes}m log=${options.logPath || syncLogPath()}`);
  void cycle('startup');

  return { stop, root, lockPath };
}
