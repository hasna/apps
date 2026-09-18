// Client-IP resolution for the per-IP login limits (issue #1784).
//
// Bun's `server.requestIP()` is the socket peer. Behind the fleet's ALB that is
// the load balancer's own address, so every user of a task shares ONE bucket:
// five logins an hour for all of them together, and twenty-one wrong verifies
// from one machine lock every user of the task out of login (#1784).
//
// The client's address travels in `x-forwarded-for` — but each proxy APPENDS
// to that header, so its LEFTMOST entry is whatever the client itself sent,
// fully attacker-controlled: keying a limiter on it hands out a fresh bucket
// per request and the limit never fires. The trustworthy entry is counted
// from the RIGHT, and only the operator knows how many appending proxies sit
// in front of the service. Same rule as apps/emails (auth/client-ip.ts) and
// apps/attachments (core/password-throttle.ts):
//
//   HASNA_NOTES_SERVER_TRUSTED_PROXY_HOPS
//     0 (default): forwarding headers are ignored; the socket peer is the key.
//     1: one appending proxy (the ALB) — the LAST x-forwarded-for entry.
//     n: n chained proxies — the nth entry from the right. A header with
//        fewer entries than that did not traverse the chain we were told
//        about, so it is discarded and the socket peer is used: a client can
//        neither pick its own key nor strip the header to escape the limit.
//
//   HASNA_NOTES_SERVER_TRUSTED_GATEWAY_PEERS
//     Comma-separated IPs / CIDRs. When the address the trusted hops resolve
//     to is one of these — the api.hasna.com gateway's egress, which the ALB
//     appends — `x-real-ip` is the client: that gateway sets it
//     unconditionally from cf-connecting-ip. It is NEVER honoured from any
//     other peer; a client can send x-real-ip as freely as x-forwarded-for,
//     and unlike x-forwarded-for there is no position in it a proxy owns.
//     Unset (default): x-real-ip is ignored and gateway traffic keys on the
//     gateway's egress address.
//
// Misconfiguration must never widen trust: anything unparseable is 0 / empty.
// Pure module (no I/O) — unit-tested in client-ip.test.mjs.

const MAX_HOPS = 16;

/** The hop count from the env value (a string) — 0 unless a small non-negative integer. */
export function resolveTrustedProxyHops(raw) {
  const value = String(raw ?? '').trim();
  if (!/^\d{1,2}$/.test(value)) return 0;
  const hops = Number(value);
  return hops >= 0 && hops <= MAX_HOPS ? hops : 0;
}

/**
 * A bare IP literal, or null. Proxies append bare addresses; anything else
 * did not come from the chain we were told about and must not become a key.
 * Strips brackets and a trailing port, and folds an IPv4-mapped IPv6 address
 * (`::ffff:a.b.c.d`, how a dual-stack socket reports IPv4 peers) to IPv4.
 */
export function normalizeIp(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'));
  value = value.trim().toLowerCase();
  if (!value || value.length > 45) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) value = mapped[1];
  if (isIpv4(value)) return value;
  if (parseIpv6(value) !== null) return value;
  return null;
}

function isIpv4(value) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  return !!m && m.slice(1).every((octet) => Number(octet) <= 255 && !/^0\d/.test(octet));
}

function ipv4ToInt(value) {
  return value.split('.').reduce((acc, octet) => acc * 256n + BigInt(octet), 0n);
}

/** The 128-bit value of an IPv6 literal (with `::` and an IPv4 tail), or null. */
function parseIpv6(value) {
  if (!/^[0-9a-f:.]+$/.test(value) || !value.includes(':') || value.includes(':::')) return null;
  let text = value;
  const tail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    if (!isIpv4(tail[1])) return null;
    const n = ipv4ToInt(tail[1]);
    text = `${text.slice(0, text.length - tail[1].length)}${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (part) => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + rest.length > 7) return null;
  const all = [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest];
  let out = 0n;
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out = (out << 16n) + BigInt(parseInt(g, 16));
  }
  return out;
}

function ipValue(ip) {
  if (isIpv4(ip)) return { bits: 32, value: ipv4ToInt(ip) };
  const v6 = parseIpv6(ip);
  return v6 === null ? null : { bits: 128, value: v6 };
}

/** Parse "ip, cidr, ..." into matchers; entries that do not parse are dropped. */
export function parsePeerList(raw) {
  const out = [];
  for (const entry of String(raw ?? '').split(',')) {
    const text = entry.trim();
    if (!text) continue;
    const [ipPart, prefixPart, ...extra] = text.split('/');
    if (extra.length) continue;
    const ip = normalizeIp(ipPart);
    if (!ip) continue;
    const parsed = ipValue(ip);
    if (!parsed) continue;
    const prefix = prefixPart === undefined ? parsed.bits : (/^\d{1,3}$/.test(prefixPart) ? Number(prefixPart) : -1);
    if (prefix < 0 || prefix > parsed.bits) continue;
    const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(parsed.bits - prefix);
    out.push({ bits: parsed.bits, network: parsed.value & mask, mask });
  }
  return out;
}

export function peerMatches(ip, peers) {
  const normalized = normalizeIp(ip);
  if (!normalized || !peers?.length) return false;
  const parsed = ipValue(normalized);
  if (!parsed) return false;
  return peers.some((peer) => peer.bits === parsed.bits && (parsed.value & peer.mask) === peer.network);
}

export function parseForwardedFor(header) {
  if (!header) return [];
  return String(header).split(',').map((entry) => normalizeIp(entry)).filter((entry) => entry !== null);
}

/**
 * The address the per-IP limits key on, or null when nothing usable exists.
 *
 * @param {{ headers: { get(name: string): string | null | undefined }, socketAddress?: string | null, hops?: number, gatewayPeers?: ReturnType<typeof parsePeerList> }} input
 */
export function resolveClientIp({ headers, socketAddress, hops = 0, gatewayPeers = [] }) {
  const socket = normalizeIp(socketAddress);
  if (!(hops > 0)) return socket;
  const chain = parseForwardedFor(headers?.get?.('x-forwarded-for'));
  if (chain.length < hops) return socket;
  const client = chain[chain.length - hops];
  if (peerMatches(client, gatewayPeers)) {
    const real = normalizeIp(headers.get('x-real-ip'));
    if (real) return real;
  }
  return client;
}
