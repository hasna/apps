import { execFile } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';

// macOS Local Network Privacy (LNP) safety for the sync daemon install story.
//
// The gotcha (found during the first real cutover): macOS launchd agents are
// SILENTLY blocked from RFC1918/link-local LAN addresses by Local Network
// Privacy — connect() fails with EHOSTUNREACH and no permission prompt ever
// appears for a background agent. A bare hostname that resolves to a LAN IP
// therefore breaks `sync --watch` under launchd while every manual/ssh run of
// the exact same command works, which is maximally confusing. Tailscale
// traffic rides a utun interface and is NOT LNP-gated, so a MagicDNS FQDN
// (or any non-LAN address) is the reliable fix.
//
// This module is the detection story: pure classifiers (unit-testable, no
// I/O) plus a thin impure wrapper (`checkInstallApiUrl`) that resolves DNS
// and shells out to `tailscale status --json` only when a problem is found.

// ---------------------------------------------------------------------------
// Pure: IP / host classification
// ---------------------------------------------------------------------------

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/// Classify one IP literal. Returns:
/// - 'loopback'   127/8, ::1                          (safe: not LNP-gated)
/// - 'private'    RFC1918 (10/8, 172.16/12, 192.168/16), IPv6 ULA fc00::/7
/// - 'link-local' 169.254/16, fe80::/10
/// - 'cgnat'      100.64/10 and the Tailscale IPv6 ULA slice — mesh-VPN
///                address space that rides utun, NOT LNP-gated
/// - 'public'     everything else routable
/// - 'invalid'    not an IP literal (e.g. a hostname)
export function classifyIp(ip) {
  let addr = String(ip ?? '').trim().toLowerCase().split('%')[0]; // drop zone index
  if (addr.startsWith('::ffff:') && V4_RE.test(addr.slice(7))) addr = addr.slice(7); // v4-mapped v6
  const m = V4_RE.exec(addr);
  if (m) {
    const octets = m.slice(1).map(Number);
    if (octets.some(o => o > 255)) return 'invalid';
    const [a, b] = octets;
    if (a === 127) return 'loopback';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
    return 'public';
  }
  if (addr.includes(':')) {
    if (/^0*:0*(:0*)*:0*1$/.test(addr) || addr === '::1') return 'loopback';
    if (/^fe[89ab]/.test(addr)) return 'link-local';
    if (addr.startsWith('fd7a:115c:a1e0')) return 'cgnat'; // Tailscale's ULA slice
    if (/^f[cd]/.test(addr)) return 'private'; // ULA fc00::/7
    return 'public';
  }
  return 'invalid';
}

/// True when a background launchd agent cannot reach this address on macOS
/// under Local Network Privacy. Loopback is exempt; cgnat/mesh (utun) and
/// public addresses are not LNP-gated.
export function isLnpBlockedIp(ip) {
  const kind = classifyIp(ip);
  return kind === 'private' || kind === 'link-local';
}

/// 'localhost', 127.x.y.z, ::1 — never LNP-gated, never needs DNS.
export function isLoopbackHost(host) {
  const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || classifyIp(h) === 'loopback';
}

// ---------------------------------------------------------------------------
// Pure: Tailscale MagicDNS suggestion + URL rewrite
// ---------------------------------------------------------------------------

/// Given parsed `tailscale status --json` output, find the MagicDNS FQDN for
/// `host` (matched case-insensitively against each node's HostName, DNSName
/// first label, or full DNSName). Returns the FQDN without the trailing dot,
/// or null when the host is not a node on the tailnet.
export function tailscaleFqdnForHost(status, host) {
  if (!status || typeof status !== 'object') return null;
  const want = String(host ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!want) return null;
  const nodes = [status.Self, ...Object.values(status.Peer || {})].filter(n => n && typeof n === 'object');
  for (const node of nodes) {
    const fqdn = String(node.DNSName || '').replace(/\.$/, '');
    if (!fqdn) continue;
    const candidates = [fqdn.toLowerCase(), fqdn.split('.')[0].toLowerCase(), String(node.HostName || '').toLowerCase()];
    if (candidates.includes(want)) return fqdn;
  }
  return null;
}

/// Swap the hostname of an API URL, preserving scheme/port/path. The store
/// convention is no trailing slash on a bare origin, so one added by URL
/// serialization is stripped.
export function rewriteApiUrlHost(apiUrl, newHost) {
  const url = new URL(apiUrl);
  url.hostname = newHost;
  let out = url.toString();
  if (url.pathname === '/' && !String(apiUrl).endsWith('/') && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

// ---------------------------------------------------------------------------
// Pure: the install-time decision
// ---------------------------------------------------------------------------

/// Decide whether an API URL is safe for a macOS launchd agent, given the
/// already-resolved inputs (addresses from DNS, parsed tailscale status).
/// Pure so the whole decision — including "would have produced the FQDN the
/// live config uses" — is unit-testable without touching a live machine.
///
/// Report: { checked, apiUrl, host, addresses, blockedAddresses, blocked,
///           safeApiUrl, reason }
/// - reason: 'not_macos' | 'invalid_url' | 'loopback' | 'unresolvable'
///           | 'safe' | 'lan_blocked'
/// - safeApiUrl: the Tailscale MagicDNS rewrite when one is detectable.
export function analyzeInstallApiUrl({ apiUrl, platform = 'darwin', addresses = [], tailscale = null } = {}) {
  const report = {
    checked: false,
    apiUrl: String(apiUrl ?? ''),
    host: '',
    addresses: [],
    blockedAddresses: [],
    blocked: false,
    safeApiUrl: null,
    reason: '',
  };
  if (platform !== 'darwin') {
    report.reason = 'not_macos';
    return report;
  }
  let host = '';
  try {
    host = new URL(report.apiUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    report.reason = 'invalid_url';
    return report;
  }
  report.checked = true;
  report.host = host;
  if (isLoopbackHost(host)) {
    report.reason = 'loopback';
    return report;
  }
  // An IP-literal host classifies directly; a name uses its resolved addresses.
  const resolved = classifyIp(host) !== 'invalid'
    ? [host]
    : addresses.map(a => (typeof a === 'string' ? a : a?.address)).filter(Boolean);
  report.addresses = resolved;
  if (!resolved.length) {
    report.reason = 'unresolvable'; // can't prove safety; installer warns but proceeds
    return report;
  }
  // ANY LAN address is a problem: launchd's resolver context may pick exactly
  // that one (the real incident: a bare hostname resolved to the LAN IP under
  // launchd and to the tailnet IP over ssh).
  report.blockedAddresses = resolved.filter(isLnpBlockedIp);
  report.blocked = report.blockedAddresses.length > 0;
  if (!report.blocked) {
    report.reason = 'safe';
    return report;
  }
  report.reason = 'lan_blocked';
  const fqdn = tailscaleFqdnForHost(tailscale, host);
  if (fqdn && fqdn.toLowerCase() !== host.toLowerCase()) {
    report.safeApiUrl = rewriteApiUrlHost(report.apiUrl, fqdn);
  }
  return report;
}

/// Human warning lines for a blocked report (shared by CLI text output and
/// tests). Empty array when there is nothing to warn about.
export function lnpWarningLines(report) {
  if (!report?.blocked) return [];
  const lines = [
    `WARNING: ${report.apiUrl} resolves to a LAN address (${report.blockedAddresses.join(', ')}).`,
    'macOS Local Network Privacy silently blocks background launchd agents from',
    'LAN (RFC1918/link-local) addresses — EHOSTUNREACH with no permission prompt.',
    'Manual runs work; the installed daemon will not.',
  ];
  if (report.safeApiUrl) {
    lines.push(`Using the Tailscale MagicDNS FQDN instead: ${report.safeApiUrl}`);
    lines.push('(Sync bookkeeping restarts against the new URL on the next run; the');
    lines.push('markdown store is canonical, so notes simply re-converge.)');
  } else {
    lines.push('No Tailscale MagicDNS name was found for this host. Point apiUrl at a');
    lines.push('non-LAN address the daemon can reach — a Tailscale MagicDNS FQDN');
    lines.push('(`tailscale status --json` → DNSName) or a public hostname — then');
    lines.push('re-run `personalnotes sync --install-service`.');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Pure: fetch-failure explanation (engine/client error surfacing)
// ---------------------------------------------------------------------------

/// Undici buries the actionable part of a network failure in `err.cause`
/// (sometimes an AggregateError). Surface it.
function primaryCause(err) {
  const cause = err?.cause;
  if (!cause) return null;
  if (Array.isArray(cause.errors) && cause.errors.length) {
    return cause.errors.find(e => e?.code) || cause.errors[0];
  }
  return cause;
}

/// The syscall/DNS code behind a failed fetch ('EHOSTUNREACH', 'ENOTFOUND',
/// ...), or '' when there is none to surface.
export function fetchErrorCode(err) {
  return primaryCause(err)?.code || err?.code || '';
}

/// Turn an opaque `fetch failed` into a diagnosis: append the syscall code,
/// the address it hit, and — for the LNP signature (EHOSTUNREACH against a
/// LAN address) — the actual explanation and fix.
export function describeFetchError(err, apiUrl = '') {
  const base = String(err?.message || err || 'fetch failed');
  const cause = primaryCause(err);
  const code = cause?.code || err?.code || '';
  if (!code) return apiUrl ? `${base} [${apiUrl}]` : base;
  const address = cause?.address || cause?.hostname || '';
  const where = address ? `${address}${cause?.port ? `:${cause.port}` : ''}` : '';
  let hint = '';
  if (code === 'EHOSTUNREACH' && isLnpBlockedIp(address)) {
    hint = ' — host resolves to a LAN address; macOS Local Network Privacy blocks'
      + ' background agents (launchd) from LAN connects with no prompt; point apiUrl'
      + ' at a Tailscale MagicDNS FQDN or another non-LAN address';
  } else if (code === 'EHOSTUNREACH') {
    hint = ' — host unreachable from this network context';
  }
  const suffix = apiUrl ? ` [${apiUrl}]` : '';
  return `${base} (${code}${where ? ` ${where}` : ''}${hint})${suffix}`;
}

// ---------------------------------------------------------------------------
// Impure wrapper: DNS + tailscale, both injectable
// ---------------------------------------------------------------------------

async function defaultLookup(host) {
  try {
    return await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    return [];
  }
}

/// `tailscale status --json`, parsed — or null when the binary is missing,
/// errors, or emits garbage. On macOS the CLI may only exist inside the app
/// bundle, so that path is probed too.
async function defaultTailscaleStatus() {
  const bins = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  for (const bin of bins) {
    const stdout = await new Promise(resolve => {
      execFile(bin, ['status', '--json'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (execErr, out) => {
        resolve(execErr ? null : out);
      });
    });
    if (!stdout) continue;
    try {
      return JSON.parse(stdout);
    } catch { /* fall through to the next candidate */ }
  }
  return null;
}

/// The installer entry point: resolve the URL's host, and only when a LAN
/// address is found, ask Tailscale for a MagicDNS FQDN. Never throws; on
/// non-macOS it reports `checked: false` and does nothing.
export async function checkInstallApiUrl({
  apiUrl,
  platform = process.platform,
  lookup = defaultLookup,
  tailscaleStatus = defaultTailscaleStatus,
} = {}) {
  if (platform !== 'darwin') return analyzeInstallApiUrl({ apiUrl, platform });
  let host = '';
  try {
    host = new URL(String(apiUrl ?? '')).hostname.replace(/^\[|\]$/g, '');
  } catch { /* analyze reports invalid_url */ }
  const needsDns = host && !isLoopbackHost(host) && classifyIp(host) === 'invalid';
  const addresses = needsDns ? await lookup(host) : [];
  const preliminary = analyzeInstallApiUrl({ apiUrl, platform, addresses });
  if (!preliminary.blocked) return preliminary;
  const tailscale = await tailscaleStatus();
  return analyzeInstallApiUrl({ apiUrl, platform, addresses, tailscale });
}
