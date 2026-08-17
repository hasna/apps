import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveNote } from '../tools/notes-lib.mjs';
import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  MIN_SYNC_INTERVAL_MINUTES,
  SYNC_JITTER_FRACTION,
  SyncLockedError,
  acquireLock,
  daemonLockPath,
  installService,
  jitterMs,
  readSyncStatus,
  releaseLock,
  resolveSyncInterval,
  runLockPath,
  runSyncGuarded,
  serviceDefinition,
  syncLogPath,
  syncStatusPath,
  uninstallService,
  watchSync,
  writeSyncStatus,
} from '../sync/daemon.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binPath = join(repoRoot, 'bin', 'personalnotes.mjs');

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'personalnotes-daemon-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

/// Minimal in-memory server-side stub: enough of the /api/v1/sync response
/// shape for the engine to run (the full protocol suite lives in sync.test.mjs).
function stubClient({ apiUrl = 'http://linux-box.local:8788', fail = null } = {}) {
  const calls = [];
  return {
    calls,
    config: { apiUrl, apiKey: 'pn_test_0000000000000000000000000000' },
    async sync(body, key) {
      calls.push({ body, key });
      if (fail) throw fail;
      return {
        applied: (body.items || []).map((item, i) => ({ clientId: item.clientId, id: `srv-${item.clientId}`, revision: i + 1 })),
        conflicts: [],
        changes: [],
        cursor: new Date().toISOString(),
      };
    },
  };
}

async function waitFor(predicate, { timeoutMs = 5000, stepMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, stepMs));
  }
  throw new Error('waitFor timed out');
}

// ---------------------------------------------------------------------------
// Interval + jitter
// ---------------------------------------------------------------------------

test('resolveSyncInterval: default, floor, and unit suffixes', () => {
  assert.equal(resolveSyncInterval(undefined), DEFAULT_SYNC_INTERVAL_MINUTES);
  assert.equal(resolveSyncInterval(''), DEFAULT_SYNC_INTERVAL_MINUTES);
  assert.equal(resolveSyncInterval('garbage'), DEFAULT_SYNC_INTERVAL_MINUTES);
  assert.equal(resolveSyncInterval(0), DEFAULT_SYNC_INTERVAL_MINUTES);
  assert.equal(resolveSyncInterval(-3), DEFAULT_SYNC_INTERVAL_MINUTES);
  assert.equal(resolveSyncInterval(7), 7);
  assert.equal(resolveSyncInterval('7'), 7);
  assert.equal(resolveSyncInterval('2m'), 2);
  assert.equal(resolveSyncInterval('90s'), 1.5);
  assert.equal(resolveSyncInterval('1h'), 60);
  // sane floor: sub-minute intervals clamp so a typo can't hammer the server
  assert.equal(resolveSyncInterval('10s'), MIN_SYNC_INTERVAL_MINUTES);
  assert.equal(resolveSyncInterval(0.1), MIN_SYNC_INTERVAL_MINUTES);
});

test('jitterMs: 0-10% late jitter, never early', () => {
  const base = 5 * 60_000;
  assert.equal(jitterMs(5, () => 0), base);
  assert.equal(jitterMs(5, () => 1), Math.round(base * (1 + SYNC_JITTER_FRACTION)));
  for (let i = 0; i < 20; i += 1) {
    const delay = jitterMs(5);
    assert.ok(delay >= base && delay <= base * (1 + SYNC_JITTER_FRACTION));
  }
});

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

test('locks: single holder, stale reclaim, owner-only release', async (t) => {
  const root = await tempRoot(t);
  const path = runLockPath(root);

  const first = await acquireLock(path);
  assert.equal(first.acquired, true);
  // A live owner is respected — even a second acquire from this same process.
  const second = await acquireLock(path);
  assert.equal(second.acquired, false);
  assert.equal(Number(second.owner.pid), process.pid);

  assert.equal(await releaseLock(path), true);
  assert.equal(existsSync(path), false);

  // Dead-pid lock (crashed daemon) is reclaimed.
  await writeFile(path, JSON.stringify({ pid: 0x7fffffff, host: 'studio-mac', startedAt: '2026-07-01T00:00:00.000Z' }));
  const reclaimed = await acquireLock(path);
  assert.equal(reclaimed.acquired, true);
  await releaseLock(path);

  // Malformed lock (partial write from a crash) is reclaimed too.
  await writeFile(path, '{not json');
  const overMalformed = await acquireLock(path);
  assert.equal(overMalformed.acquired, true);

  // A foreign lock is never released by someone who doesn't own it.
  await rm(path, { force: true });
  await writeFile(path, JSON.stringify({ pid: 0x7fffffff }));
  assert.equal(await releaseLock(path), false);
  assert.equal(existsSync(path), true);

  // Two contenders racing the SAME stale lock: the rename-claim makes the
  // reclaim atomic, so at most one wins. (The old read→rm→create sequence
  // raced: the slower contender's rm could delete the faster one's freshly
  // written lock and both ended up holding it.)
  await rm(path, { force: true });
  await writeFile(path, JSON.stringify({ pid: 0x7fffffff, host: 'studio-mac', startedAt: '2026-07-01T00:00:00.000Z' }));
  const contenders = await Promise.all([acquireLock(path), acquireLock(path)]);
  assert.equal(contenders.filter(r => r.acquired).length, 1, 'exactly one contender reclaims a stale lock');
  assert.equal(Number(JSON.parse(await readFile(path, 'utf8')).pid), process.pid);
  await releaseLock(path);
  // The reclaim leaves no claim-file residue behind.
  assert.deepEqual((await readdir(root)).filter(f => f.includes('.stale.')), []);
});

// ---------------------------------------------------------------------------
// Status file
// ---------------------------------------------------------------------------

test('sync status: merge keeps lastSuccessAt across failures; missing file reads null', async (t) => {
  const root = await tempRoot(t);
  assert.equal(await readSyncStatus(root), null);

  await writeSyncStatus({ status: 'ok', lastSyncAt: 't1', lastSuccessAt: 't1', error: '', cursor: 'c1' }, root);
  await writeSyncStatus({ status: 'error', lastSyncAt: 't2', error: 'unauthorized' }, root);

  const status = await readSyncStatus(root);
  assert.equal(status.status, 'error'); // failure is NEVER masked as ok
  assert.equal(status.error, 'unauthorized');
  assert.equal(status.lastSyncAt, 't2');
  assert.equal(status.lastSuccessAt, 't1'); // previous success preserved for display
  assert.equal(status.cursor, 'c1');
  assert.ok(existsSync(syncStatusPath(root)));
});

// ---------------------------------------------------------------------------
// Guarded run
// ---------------------------------------------------------------------------

test('runSyncGuarded: records ok status, releases the run lock', async (t) => {
  const root = await tempRoot(t);
  await saveNote({ title: 'From the studio', body: 'hello', machine: 'studio-mac' }, root);

  const client = stubClient();
  const summary = await runSyncGuarded({ root, client, runner: 'daemon' });
  assert.equal(summary.pushed.created, 1);

  const status = await readSyncStatus(root);
  assert.equal(status.status, 'ok');
  assert.equal(status.error, '');
  assert.equal(status.runner, 'daemon');
  assert.equal(status.apiUrl, 'http://linux-box.local:8788');
  assert.equal(status.pushed.created, 1);
  assert.ok(status.lastSyncAt && status.lastSuccessAt);
  assert.equal(existsSync(runLockPath(root)), false); // lock released
});

test('runSyncGuarded: a failure records an error status (auth failure is never green)', async (t) => {
  const root = await tempRoot(t);
  await writeSyncStatus({ status: 'ok', lastSyncAt: 't0', lastSuccessAt: 't0' }, root);

  const failure = Object.assign(new Error('unauthorized: bad key'), { status: 401 });
  await assert.rejects(
    () => runSyncGuarded({ root, client: stubClient({ fail: failure }) }),
    /unauthorized/,
  );

  const status = await readSyncStatus(root);
  assert.equal(status.status, 'error');
  assert.match(status.error, /unauthorized/);
  assert.equal(status.lastSuccessAt, 't0');
  assert.equal(existsSync(runLockPath(root)), false); // released even on failure
});

test('runSyncGuarded: a held run lock skips with SyncLockedError (GUI/daemon coordination)', async (t) => {
  const root = await tempRoot(t);
  await mkdir(root, { recursive: true });
  const lock = await acquireLock(runLockPath(root));
  assert.equal(lock.acquired, true);
  t.after(() => releaseLock(runLockPath(root)));

  await assert.rejects(
    () => runSyncGuarded({ root, client: stubClient() }),
    (err) => err instanceof SyncLockedError && err.code === 'sync_already_running',
  );
});

// ---------------------------------------------------------------------------
// Service files (install story)
// ---------------------------------------------------------------------------

test('serviceDefinition: launchd plist points at the CLI daemon', () => {
  const def = serviceDefinition({
    platform: 'darwin',
    nodePath: '/usr/local/bin/node',
    scriptPath: '/opt/personalnotes/bin/personalnotes.mjs',
    home: '/Users/casey',
    env: { PERSONALNOTES_API_URL: 'http://linux-box.local:8788' },
  });
  assert.equal(def.path, '/Users/casey/Library/LaunchAgents/com.personalnotes.sync.plist');
  assert.match(def.content, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(def.content, /<string>\/opt\/personalnotes\/bin\/personalnotes\.mjs<\/string>/);
  assert.match(def.content, /<string>sync<\/string>\s*<string>--watch<\/string>/);
  assert.match(def.content, /<key>KeepAlive<\/key><true\/>/);
  assert.match(def.content, /PERSONALNOTES_API_URL/);
  assert.match(def.content, /Library\/Logs\/PersonalNotes\/sync-launchd\.log/);
  assert.ok(def.instructions.some(step => step.includes('launchctl load')));
});

test('serviceDefinition: systemd user unit points at the CLI daemon (Linux parity)', () => {
  const def = serviceDefinition({
    platform: 'linux',
    nodePath: '/usr/bin/node',
    scriptPath: '/opt/personalnotes/bin/personalnotes.mjs',
    home: '/home/casey',
    env: { PERSONALNOTES_ROOT: '/home/casey/.hasna/apps/notes' },
  });
  assert.equal(def.path, '/home/casey/.config/systemd/user/personalnotes-sync.service');
  assert.match(def.content, /ExecStart=\/usr\/bin\/node \/opt\/personalnotes\/bin\/personalnotes\.mjs sync --watch/);
  assert.match(def.content, /Restart=on-failure/);
  assert.match(def.content, /Environment=PERSONALNOTES_ROOT=\/home\/casey\/\.hasna\/apps\/notes/);
  // After=network-online.target is a documented no-op without the matching Wants=.
  assert.match(def.content, /Wants=network-online\.target/);
  assert.match(def.content, /After=network-online\.target/);
  assert.match(def.content, /WantedBy=default\.target/);
  assert.ok(def.instructions.some(step => step.includes('systemctl --user enable --now personalnotes-sync')));

  // XDG_CONFIG_HOME is honored.
  const xdg = serviceDefinition({
    platform: 'linux',
    scriptPath: '/x/bin/personalnotes.mjs',
    home: '/home/casey',
    env: { XDG_CONFIG_HOME: '/home/casey/cfg' },
  });
  assert.equal(xdg.path, '/home/casey/cfg/systemd/user/personalnotes-sync.service');

  // Paths/env values with spaces are quoted for systemd (the launchd branch
  // already XML-escapes; the unit-file parser needs "..." with \\ and \"
  // escaping or it splits the value at whitespace).
  const spaced = serviceDefinition({
    platform: 'linux',
    nodePath: '/opt/tools with space/node',
    scriptPath: '/opt/personalnotes/bin/personalnotes.mjs',
    home: '/home/casey',
    env: { PERSONALNOTES_ROOT: '/home/casey/My Notes' },
  });
  assert.match(spaced.content, /ExecStart="\/opt\/tools with space\/node" \/opt\/personalnotes\/bin\/personalnotes\.mjs sync --watch/);
  assert.match(spaced.content, /Environment="PERSONALNOTES_ROOT=\/home\/casey\/My Notes"/);
});

test('installService/uninstallService: write and remove the unit file', async (t) => {
  const home = await tempRoot(t);
  const options = { platform: 'linux', scriptPath: binPath, home, env: {} };
  const installed = await installService(options);
  assert.ok(existsSync(installed.path));
  assert.match(await readFile(installed.path, 'utf8'), /personalnotes\.mjs sync --watch/);
  const removed = await uninstallService(options);
  assert.equal(removed.removed, true);
  assert.equal(existsSync(installed.path), false);
});

test('syncLogPath: macOS Library/Logs vs Linux XDG state home', () => {
  assert.equal(
    syncLogPath({ platform: 'darwin', home: '/Users/casey', env: {} }),
    '/Users/casey/Library/Logs/PersonalNotes/sync.log',
  );
  assert.equal(
    syncLogPath({ platform: 'linux', home: '/home/casey', env: {} }),
    '/home/casey/.local/state/personalnotes/sync.log',
  );
  assert.equal(
    syncLogPath({ platform: 'linux', home: '/home/casey', env: { XDG_STATE_HOME: '/var/state' } }),
    '/var/state/personalnotes/sync.log',
  );
});

// ---------------------------------------------------------------------------
// Daemon loop
// ---------------------------------------------------------------------------

test('watchSync: startup sync, fs-triggered sync, single instance, clean stop', async (t) => {
  const root = await tempRoot(t);
  const logPath = join(root, 'logs', 'sync.log');
  const client = stubClient();

  const daemon = await watchSync({
    root,
    client,
    logPath,
    handleSignals: false,
    interval: 60,      // keep the interval tick out of this test
    debounceMs: 60,
    configPath: join(root, 'no-config.json'),
  });
  t.after(() => daemon.stop('test-cleanup'));

  // Startup run fires immediately and records status.
  await waitFor(() => readSyncStatus(root));
  assert.ok(existsSync(daemonLockPath(root)));
  const callsAfterStartup = client.calls.length;
  assert.ok(callsAfterStartup >= 1);

  // Second daemon on the same root refuses to start.
  await assert.rejects(
    () => watchSync({ root, client, logPath, handleSignals: false }),
    (err) => err instanceof SyncLockedError,
  );

  // A local edit triggers a debounced sync without waiting for the interval.
  await saveNote({ title: 'Edited on this box', body: 'fs trigger', machine: 'linux-box' }, root);
  await waitFor(() => client.calls.length > callsAfterStartup, { timeoutMs: 10_000 });

  // Clean stop: lock released, log tells the story.
  await daemon.stop('SIGTERM');
  assert.equal(existsSync(daemonLockPath(root)), false);
  const log = await readFile(logPath, 'utf8');
  assert.match(log, /daemon started pid=\d+/);
  assert.match(log, /sync ok \(startup\)/);
  assert.match(log, /daemon stopped \(SIGTERM\)/);
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

test('CLI: personalnotes sync status reports never/ok/error honestly', async (t) => {
  const root = await tempRoot(t);
  const env = { PERSONALNOTES_ROOT: root, PERSONALNOTES_CONFIG: join(root, 'config.json') };

  const never = await runNode(['sync', 'status', '--json'], env);
  assert.equal(never.code, 0);
  assert.equal(JSON.parse(never.stdout).status, 'never');

  await writeSyncStatus({ status: 'error', lastSyncAt: 't1', error: 'unauthorized: key revoked' }, root);
  const failing = await runNode(['sync', 'status', '--json'], env);
  assert.equal(failing.code, 0);
  const parsed = JSON.parse(failing.stdout);
  assert.equal(parsed.status, 'error');
  assert.match(parsed.error, /unauthorized/);

  const human = await runNode(['sync', 'status'], env);
  assert.match(human.stdout, /status: error/);
  assert.match(human.stdout, /error: unauthorized/);
});

test('CLI: sync --install-service writes the platform service file', async (t) => {
  const home = await tempRoot(t);
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PERSONALNOTES_ROOT: join(home, 'notes-root'),
  };
  const res = await runNode(['sync', '--install-service', '--json'], env);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.ok(existsSync(out.path));
  const body = await readFile(out.path, 'utf8');
  assert.match(body, /sync/);
  assert.match(body, /--watch/);
  if (out.platform === 'linux') {
    assert.ok(out.path.endsWith('personalnotes-sync.service'));
    assert.match(body, /Environment=PERSONALNOTES_ROOT=/);
  } else {
    assert.ok(out.path.endsWith('com.personalnotes.sync.plist'));
  }

  const un = await runNode(['sync', '--uninstall-service', '--json'], env);
  assert.equal(un.code, 0, un.stderr);
  assert.equal(JSON.parse(un.stdout).removed, true);
  assert.equal(existsSync(out.path), false);
});

test('CLI: one-shot sync skips (exit 0) when another run holds the lock', async (t) => {
  const root = await tempRoot(t);
  await mkdir(root, { recursive: true });
  const lock = await acquireLock(runLockPath(root));
  assert.equal(lock.acquired, true);
  t.after(() => releaseLock(runLockPath(root)));

  const res = await runNode(['sync', '--json'], {
    PERSONALNOTES_ROOT: root,
    PERSONALNOTES_CONFIG: join(root, 'config.json'),
    PERSONALNOTES_API_KEY: 'pn_test_0000000000000000000000000000',
  });
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'already_running');
});
