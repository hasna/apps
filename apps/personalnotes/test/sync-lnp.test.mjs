import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeInstallApiUrl,
  checkInstallApiUrl,
  classifyIp,
  describeFetchError,
  fetchErrorCode,
  isLnpBlockedIp,
  isLoopbackHost,
  lnpWarningLines,
  rewriteApiUrlHost,
  tailscaleFqdnForHost,
} from '../sync/lnp.mjs';

// macOS Local Network Privacy safety for `sync --install-service`.
//
// Real-cutover incident this guards (sanitized): the launchd daemon failed
// every sync with a bare `fetch failed` because the configured host resolved
// to a LAN (RFC1918) address in launchd context, which macOS LNP blocks for
// background agents with EHOSTUNREACH and NO permission prompt — while the
// exact same command worked over ssh. The fix was pointing apiUrl at the
// Tailscale MagicDNS FQDN (mesh traffic rides utun and is not LNP-gated).
// These tests prove the installer detects that setup and produces the same
// FQDN URL the fix used — without touching any live machine.

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binPath = join(repoRoot, 'bin', 'personalnotes.mjs');

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

/// Sanitized `tailscale status --json` shape (only the fields the parser uses).
function tailnetStatus() {
  return {
    Self: { HostName: 'studio-mac', DNSName: 'studio-mac.example.ts.net.', TailscaleIPs: ['100.64.1.1'] },
    Peer: {
      nodekey1: { HostName: 'linux-box', DNSName: 'linux-box.example.ts.net.', TailscaleIPs: ['100.64.1.2'] },
      nodekey2: { HostName: 'other-box', DNSName: 'other-box.example.ts.net.', TailscaleIPs: ['100.64.1.3'] },
    },
  };
}

// ---------------------------------------------------------------------------
// classifyIp / isLnpBlockedIp / isLoopbackHost (pure)
// ---------------------------------------------------------------------------

test('classifyIp: IPv4 ranges and boundaries', () => {
  assert.equal(classifyIp('127.0.0.1'), 'loopback');
  assert.equal(classifyIp('127.255.255.255'), 'loopback');
  assert.equal(classifyIp('10.0.0.1'), 'private');
  assert.equal(classifyIp('172.16.0.1'), 'private');
  assert.equal(classifyIp('172.31.255.255'), 'private');
  assert.equal(classifyIp('172.15.0.1'), 'public');   // just below 172.16/12
  assert.equal(classifyIp('172.32.0.1'), 'public');   // just above
  assert.equal(classifyIp('192.168.1.42'), 'private');
  assert.equal(classifyIp('192.167.1.1'), 'public');
  assert.equal(classifyIp('169.254.10.10'), 'link-local');
  // 100.64/10 (CGNAT — the mesh-VPN range): rides utun, NOT LNP-gated.
  assert.equal(classifyIp('100.64.0.1'), 'cgnat');
  assert.equal(classifyIp('100.127.255.255'), 'cgnat');
  assert.equal(classifyIp('100.63.255.255'), 'public'); // below the /10
  assert.equal(classifyIp('100.128.0.0'), 'public');    // above the /10
  assert.equal(classifyIp('8.8.8.8'), 'public');
  assert.equal(classifyIp('256.1.1.1'), 'invalid');
  assert.equal(classifyIp('not-an-ip'), 'invalid');
  assert.equal(classifyIp(''), 'invalid');
  assert.equal(classifyIp(null), 'invalid');
});

test('classifyIp: IPv6, v4-mapped, and zone indexes', () => {
  assert.equal(classifyIp('::1'), 'loopback');
  assert.equal(classifyIp('fe80::1'), 'link-local');
  assert.equal(classifyIp('fe80::1%en0'), 'link-local'); // zone index stripped
  assert.equal(classifyIp('febf::1'), 'link-local');     // top of fe80::/10
  assert.equal(classifyIp('fec0::1'), 'public');         // just past fe80::/10
  assert.equal(classifyIp('fd12:3456::1'), 'private');   // ULA fc00::/7
  assert.equal(classifyIp('fc00::1'), 'private');
  assert.equal(classifyIp('fd7a:115c:a1e0::42'), 'cgnat'); // Tailscale ULA slice
  assert.equal(classifyIp('2001:db8::1'), 'public');
  assert.equal(classifyIp('::ffff:192.168.1.42'), 'private'); // v4-mapped
  assert.equal(classifyIp('::ffff:8.8.8.8'), 'public');
});

test('isLnpBlockedIp: LAN + link-local blocked; loopback, mesh, public not', () => {
  assert.equal(isLnpBlockedIp('192.168.1.42'), true);
  assert.equal(isLnpBlockedIp('10.9.8.7'), true);
  assert.equal(isLnpBlockedIp('169.254.0.5'), true);
  assert.equal(isLnpBlockedIp('fd12::1'), true);
  assert.equal(isLnpBlockedIp('127.0.0.1'), false);
  assert.equal(isLnpBlockedIp('100.64.1.2'), false);        // mesh VPN (utun)
  assert.equal(isLnpBlockedIp('fd7a:115c:a1e0::42'), false); // Tailscale IPv6
  assert.equal(isLnpBlockedIp('8.8.8.8'), false);
  assert.equal(isLnpBlockedIp('nonsense'), false);
});

test('isLoopbackHost: localhost and loopback literals', () => {
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('LOCALHOST'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('linux-box'), false);
  assert.equal(isLoopbackHost('example.com'), false);
});

// ---------------------------------------------------------------------------
// Tailscale FQDN suggestion + URL rewrite (pure)
// ---------------------------------------------------------------------------

test('tailscaleFqdnForHost: matches HostName, DNS first label, full FQDN; strips trailing dot', () => {
  const status = tailnetStatus();
  assert.equal(tailscaleFqdnForHost(status, 'linux-box'), 'linux-box.example.ts.net');
  assert.equal(tailscaleFqdnForHost(status, 'LINUX-BOX'), 'linux-box.example.ts.net');
  assert.equal(tailscaleFqdnForHost(status, 'linux-box.example.ts.net'), 'linux-box.example.ts.net');
  assert.equal(tailscaleFqdnForHost(status, 'studio-mac'), 'studio-mac.example.ts.net'); // Self matches too
  assert.equal(tailscaleFqdnForHost(status, 'unknown-host'), null);
  assert.equal(tailscaleFqdnForHost(null, 'linux-box'), null);
  assert.equal(tailscaleFqdnForHost({}, 'linux-box'), null);
  assert.equal(tailscaleFqdnForHost(status, ''), null);
});

test('rewriteApiUrlHost: preserves scheme/port/path, no trailing slash on bare origins', () => {
  assert.equal(rewriteApiUrlHost('http://linux-box:8788', 'linux-box.example.ts.net'), 'http://linux-box.example.ts.net:8788');
  assert.equal(rewriteApiUrlHost('https://linux-box', 'linux-box.example.ts.net'), 'https://linux-box.example.ts.net');
  assert.equal(rewriteApiUrlHost('http://linux-box:8788/base/', 'linux-box.example.ts.net'), 'http://linux-box.example.ts.net:8788/base/');
});

// ---------------------------------------------------------------------------
// analyzeInstallApiUrl (the pure install-time decision)
// ---------------------------------------------------------------------------

test('analyzeInstallApiUrl: non-macOS and loopback URLs are left alone', () => {
  const linux = analyzeInstallApiUrl({ apiUrl: 'http://linux-box:8788', platform: 'linux' });
  assert.equal(linux.checked, false);
  assert.equal(linux.blocked, false);
  assert.equal(linux.reason, 'not_macos');

  for (const apiUrl of ['http://localhost:8788', 'http://127.0.0.1:8788', 'http://[::1]:8788']) {
    const report = analyzeInstallApiUrl({ apiUrl, platform: 'darwin' });
    assert.equal(report.blocked, false, apiUrl);
    assert.equal(report.reason, 'loopback', apiUrl);
  }
});

test('analyzeInstallApiUrl: public and mesh (tailnet FQDN) resolutions are safe', () => {
  const publicHost = analyzeInstallApiUrl({
    apiUrl: 'https://personalnotes.ai',
    platform: 'darwin',
    addresses: [{ address: '203.0.113.10', family: 4 }],
  });
  assert.equal(publicHost.blocked, false);
  assert.equal(publicHost.reason, 'safe');

  // The URL the real cutover fix landed on: a MagicDNS FQDN resolving to the
  // mesh 100.64/10 address. The installer must accept it unchanged.
  const mesh = analyzeInstallApiUrl({
    apiUrl: 'http://linux-box.example.ts.net:8788',
    platform: 'darwin',
    addresses: [{ address: '100.64.1.2', family: 4 }, { address: 'fd7a:115c:a1e0::42', family: 6 }],
  });
  assert.equal(mesh.blocked, false);
  assert.equal(mesh.reason, 'safe');
  assert.equal(mesh.safeApiUrl, null);
});

test('analyzeInstallApiUrl: LAN-resolving host is blocked and rewritten to the tailnet FQDN', () => {
  // Sanitized reproduction of the real incident: bare hostname → RFC1918
  // A record in daemon context. The installer must produce exactly the
  // MagicDNS URL the manual fix used.
  const report = analyzeInstallApiUrl({
    apiUrl: 'http://linux-box:8788',
    platform: 'darwin',
    addresses: [{ address: '192.168.1.42', family: 4 }],
    tailscale: tailnetStatus(),
  });
  assert.equal(report.blocked, true);
  assert.equal(report.reason, 'lan_blocked');
  assert.deepEqual(report.blockedAddresses, ['192.168.1.42']);
  assert.equal(report.safeApiUrl, 'http://linux-box.example.ts.net:8788');

  const warnings = lnpWarningLines(report).join('\n');
  assert.match(warnings, /Local Network Privacy/);
  assert.match(warnings, /EHOSTUNREACH/);
  assert.match(warnings, /linux-box\.example\.ts\.net:8788/);
});

test('analyzeInstallApiUrl: LAN host without a tailnet match warns with instructions', () => {
  const report = analyzeInstallApiUrl({
    apiUrl: 'http://door-nas:8788',
    platform: 'darwin',
    addresses: [{ address: '10.0.0.9', family: 4 }],
    tailscale: tailnetStatus(), // no node named door-nas
  });
  assert.equal(report.blocked, true);
  assert.equal(report.safeApiUrl, null);
  const warnings = lnpWarningLines(report).join('\n');
  assert.match(warnings, /tailscale status --json/);
  assert.match(warnings, /install-service/);

  // No tailscale binary at all → same instruct-only outcome.
  const noTs = analyzeInstallApiUrl({
    apiUrl: 'http://door-nas:8788',
    platform: 'darwin',
    addresses: ['10.0.0.9'], // bare-string addresses accepted too
  });
  assert.equal(noTs.blocked, true);
  assert.equal(noTs.safeApiUrl, null);
});

test('analyzeInstallApiUrl: IP-literal, mixed, unresolvable, and invalid URLs', () => {
  // A LAN IP literal needs no DNS to be flagged.
  const literal = analyzeInstallApiUrl({ apiUrl: 'http://192.168.1.42:8788', platform: 'darwin' });
  assert.equal(literal.blocked, true);
  assert.equal(literal.safeApiUrl, null); // can't map a raw IP to a tailnet name

  // ANY LAN address blocks — mixed resolution is exactly the flaky case
  // (launchd may pick the LAN record while ssh picks the mesh one).
  const mixed = analyzeInstallApiUrl({
    apiUrl: 'http://linux-box:8788',
    platform: 'darwin',
    addresses: ['192.168.1.42', '100.64.1.2'],
    tailscale: tailnetStatus(),
  });
  assert.equal(mixed.blocked, true);
  assert.equal(mixed.safeApiUrl, 'http://linux-box.example.ts.net:8788');

  const unresolvable = analyzeInstallApiUrl({ apiUrl: 'http://ghost-host:8788', platform: 'darwin', addresses: [] });
  assert.equal(unresolvable.blocked, false);
  assert.equal(unresolvable.reason, 'unresolvable');

  const invalid = analyzeInstallApiUrl({ apiUrl: 'not a url', platform: 'darwin' });
  assert.equal(invalid.checked, false);
  assert.equal(invalid.reason, 'invalid_url');

  assert.deepEqual(lnpWarningLines(unresolvable), []);
  assert.deepEqual(lnpWarningLines(null), []);
});

// ---------------------------------------------------------------------------
// checkInstallApiUrl (impure wrapper, dependencies injected)
// ---------------------------------------------------------------------------

test('checkInstallApiUrl: end-to-end LAN detection produces the tailnet FQDN URL', async () => {
  const calls = { lookup: [], tailscale: 0 };
  const report = await checkInstallApiUrl({
    apiUrl: 'http://linux-box:8788',
    platform: 'darwin',
    lookup: async (host) => { calls.lookup.push(host); return [{ address: '192.168.1.42', family: 4 }]; },
    tailscaleStatus: async () => { calls.tailscale += 1; return tailnetStatus(); },
  });
  assert.deepEqual(calls.lookup, ['linux-box']);
  assert.equal(calls.tailscale, 1);
  assert.equal(report.blocked, true);
  assert.equal(report.safeApiUrl, 'http://linux-box.example.ts.net:8788');
});

test('checkInstallApiUrl: safe URLs never shell out to tailscale; non-macOS never resolves', async () => {
  const calls = { lookup: 0, tailscale: 0 };
  const safe = await checkInstallApiUrl({
    apiUrl: 'https://personalnotes.ai',
    platform: 'darwin',
    lookup: async () => { calls.lookup += 1; return ['203.0.113.10']; },
    tailscaleStatus: async () => { calls.tailscale += 1; return tailnetStatus(); },
  });
  assert.equal(safe.blocked, false);
  assert.equal(calls.lookup, 1);
  assert.equal(calls.tailscale, 0);

  const linux = await checkInstallApiUrl({
    apiUrl: 'http://linux-box:8788',
    platform: 'linux',
    lookup: async () => { calls.lookup += 1; return []; },
  });
  assert.equal(linux.checked, false);
  assert.equal(calls.lookup, 1); // unchanged — no DNS on linux

  // Loopback and IP literals also skip DNS.
  const loop = await checkInstallApiUrl({
    apiUrl: 'http://localhost:8788',
    platform: 'darwin',
    lookup: async () => { calls.lookup += 1; return []; },
  });
  assert.equal(loop.blocked, false);
  assert.equal(calls.lookup, 1);
});

// ---------------------------------------------------------------------------
// Fetch-failure surfacing (engine/client error messages)
// ---------------------------------------------------------------------------

test('describeFetchError: EHOSTUNREACH to a LAN address explains LNP and the fix', () => {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error('connect EHOSTUNREACH 192.168.1.42:8788'), {
    code: 'EHOSTUNREACH',
    syscall: 'connect',
    address: '192.168.1.42',
    port: 8788,
  });
  const msg = describeFetchError(err, 'http://linux-box:8788');
  assert.match(msg, /fetch failed \(EHOSTUNREACH 192\.168\.1\.42:8788/);
  assert.match(msg, /LAN address/);
  assert.match(msg, /Local Network Privacy/);
  assert.match(msg, /Tailscale MagicDNS FQDN/);
  assert.match(msg, /\[http:\/\/linux-box:8788\]/);
  assert.equal(fetchErrorCode(err), 'EHOSTUNREACH');
});

test('describeFetchError: non-LAN codes surface without the LNP hint', () => {
  const refused = new TypeError('fetch failed');
  refused.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8788'), {
    code: 'ECONNREFUSED', address: '127.0.0.1', port: 8788,
  });
  const msg = describeFetchError(refused);
  assert.match(msg, /\(ECONNREFUSED 127\.0\.0\.1:8788\)/);
  assert.doesNotMatch(msg, /Local Network Privacy/);

  const dns = new TypeError('fetch failed');
  dns.cause = Object.assign(new Error('getaddrinfo ENOTFOUND ghost-host'), {
    code: 'ENOTFOUND', hostname: 'ghost-host',
  });
  assert.match(describeFetchError(dns), /\(ENOTFOUND ghost-host\)/);

  // Public-address EHOSTUNREACH gets the generic reachability hint only.
  const pub = new TypeError('fetch failed');
  pub.cause = Object.assign(new Error('connect EHOSTUNREACH 203.0.113.9:443'), {
    code: 'EHOSTUNREACH', address: '203.0.113.9', port: 443,
  });
  const pubMsg = describeFetchError(pub);
  assert.match(pubMsg, /unreachable from this network context/);
  assert.doesNotMatch(pubMsg, /Local Network Privacy/);
});

test('describeFetchError: AggregateError causes and causeless errors', () => {
  const multi = new TypeError('fetch failed');
  const inner = Object.assign(new Error('connect EHOSTUNREACH 192.168.1.42:8788'), {
    code: 'EHOSTUNREACH', address: '192.168.1.42', port: 8788,
  });
  multi.cause = new AggregateError([inner], 'connect failed');
  assert.match(describeFetchError(multi), /EHOSTUNREACH 192\.168\.1\.42:8788/);
  assert.equal(fetchErrorCode(multi), 'EHOSTUNREACH');

  const bare = new TypeError('fetch failed');
  assert.equal(describeFetchError(bare), 'fetch failed');
  assert.equal(describeFetchError(bare, 'http://x:1'), 'fetch failed [http://x:1]');
  assert.equal(fetchErrorCode(bare), '');
});

// ---------------------------------------------------------------------------
// CLI: --install-service --dry-run writes nothing
// ---------------------------------------------------------------------------

test('CLI: sync --install-service --dry-run previews without writing service file or config', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'personalnotes-lnp-'));
  t.after(async () => { await rm(home, { recursive: true, force: true }); });
  const configPath = join(home, 'config.json');
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PERSONALNOTES_ROOT: join(home, 'notes-root'),
    PERSONALNOTES_CONFIG: configPath,
  };
  const res = await runNode(['sync', '--install-service', '--dry-run', '--json'], env);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.ok(out.path, 'reports the service file path it would write');
  assert.equal(existsSync(out.path), false, 'dry-run must not write the service file');
  assert.equal(existsSync(configPath), false, 'dry-run must not write the client config');
  assert.ok(out.lnp, 'dry-run reports the LNP check result');
  // On macOS the URL is actually checked; elsewhere the check reports not_macos.
  if (process.platform === 'darwin') assert.equal(out.lnp.checked, true);
  else assert.equal(out.lnp.reason, 'not_macos');
});
