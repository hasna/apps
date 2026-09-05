// Client-IP resolution for rate-limit buckets and audit keys.
//
// The fleet is reachable both directly (`https://<app>.hasna.xyz`) and through
// the api.hasna.com Cloudflare-worker gateway, which forwards
// `https://api.hasna.com/<app>/...` to the origin and sets `x-real-ip` (the
// real client, from `cf-connecting-ip`), `x-forwarded-for`, `x-forwarded-proto`
// and `x-forwarded-prefix` on the way. Between the gateway and this service
// sits the ALB, which APPENDS its socket-peer view to `x-forwarded-for`.
//
// The leftmost `x-forwarded-for` entry is therefore whatever the client itself
// sent — fully attacker-controlled. Keying a rate limiter on it means the
// attacker rotates one header value and the limiter never fires. The
// trustworthy entries are appended by the proxies the OPERATOR runs, and only
// the operator knows which addresses those are.
//
// Derivation rule (identical in every fleet app):
//   1. trust is OFF by default -> the socket peer address (`server.requestIP`),
//      which no header can forge. Local/dev behavior is unchanged.
//   2. trust is ON (operator opt-in, only when this service genuinely sits
//      behind the trusted proxies) ->
//      a. `x-real-ip` first: the gateway overwrites it with the true client IP
//         (`cf-connecting-ip`), and this header is only honored because the
//         socket peer is itself a trusted proxy. Direct clients can forge it,
//         but never through the trusted hop that overwrote it.
//      b. else the first UNTRUSTED entry of `x-forwarded-for` counted from the
//         RIGHT (skipping entries that match a trusted proxy), so traffic that
//         crossed Cloudflare egress lands on the visitor instead of on the
//         egress address.
//      c. else the socket peer address.
// Every candidate is validated as a bare IP literal; malformed or abusive
// header content can never become a bucket key and never crashes the server.
//
// Pure module (no I/O) — unit-tested.

export const TRUST_PROXY_ENV = "TODOS_TRUST_PROXY";
export const TRUSTED_PROXIES_ENV = "TODOS_TRUSTED_PROXIES";

/** Reject anything that is not a bare IP literal (optionally bracketed / ported). */
export function normalizeIpLiteral(raw: string | null | undefined): string | null {
  let value = (raw ?? "").trim();
  if (!value) return null;
  // Some proxies bracket IPv6 and/or append a source port.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1] as string;
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  value = value.trim().toLowerCase();
  if (!value || value.length > 45) return null;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) normalizes to the IPv4 form so trust
  // matching against a v4 CIDR keeps working when the platform reports the
  // socket in mapped notation.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value);
  if (mapped) value = mapped[1] as string;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (ipv4) {
    return ipv4.slice(1).every((octet) => Number(octet) <= 255 && !/^0\d/.test(octet)) ? value : null;
  }
  // Loose IPv6 shape check: hex groups, at most one "::", optional IPv4 tail.
  if (/^[0-9a-f:]+(?:\.\d{1,3}){0,3}$/.test(value) && value.includes(":") && !/:::/.test(value)) {
    return value;
  }
  return null;
}

/** Parse and validate `X-Forwarded-For` into bare IP literals, left -> right. */
export function parseForwardedFor(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((entry) => normalizeIpLiteral(entry))
    .filter((entry): entry is string => entry !== null);
}

interface Cidr {
  address: string;
  prefix: number;
  bytes: number[]; // 4 or 16 octets, network-normalized
  family: "ipv4" | "ipv6";
}

function parseCidr(entry: string): Cidr | null {
  const slash = entry.indexOf("/");
  const rawAddress = slash >= 0 ? entry.slice(0, slash) : entry;
  const rawPrefix = slash >= 0 ? entry.slice(slash + 1) : null;
  const address = normalizeIpLiteral(rawAddress);
  if (!address) return null;

  if (address.includes(":")) {
    if (rawPrefix !== null && !/^\d{1,3}$/.test(rawPrefix)) return null;
    const prefix = rawPrefix === null ? 128 : Number(rawPrefix);
    if (prefix < 0 || prefix > 128) return null;
    const bytes = expandV6(address);
    if (!bytes) return null;
    const masked = maskNetwork(bytes, prefix);
    return { address, prefix, bytes: masked, family: "ipv6" };
  }

  if (rawPrefix !== null && !/^\d{1,3}$/.test(rawPrefix)) return null;
  const prefix = rawPrefix === null ? 32 : Number(rawPrefix);
  if (prefix < 0 || prefix > 32) return null;
  const bytes = (address.split(".").map((octet) => Number(octet)) as number[]);
  const masked = maskNetwork(bytes, prefix);
  return { address, prefix, bytes: masked, family: "ipv4" };
}

function expandV6(address: string): number[] | null {
  // Expand :: and pad to 16 bytes; only used for validated literals.
  const compressed = address.split("::");
  if (compressed.length > 2) return null;
  let groups: string[] = [];
  if (compressed.length === 2) {
    const left = compressed[0] ? compressed[0]!.split(":") : [];
    const right = compressed[1] ? compressed[1]!.split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    groups = address.split(":");
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function maskNetwork(bytes: number[], prefix: number): number[] {
  const masked = bytes.slice();
  const fullBytes = Math.floor(prefix / 8);
  const remainder = prefix % 8;
  for (let i = 0; i < masked.length; i++) {
    if (i >= fullBytes) {
      if (i === fullBytes && remainder > 0) {
        masked[i] = (masked[i] as number) & (0xff << (8 - remainder) & 0xff);
      } else {
        masked[i] = 0;
      }
    }
  }
  return masked;
}

/** Parse the trusted-proxy allowlist: bare IPs and CIDR blocks (v4 + v6). */
export function parseTrustedProxies(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const trusted: string[] = [];
  for (const entry of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    const cidr = parseCidr(entry);
    if (cidr && !seen.has(entry)) {
      seen.add(entry);
      trusted.push(entry);
    }
  }
  return trusted;
}

function isMatch(candidateBytes: number[], cidr: Cidr): boolean {
  if (cidr.bytes.length !== candidateBytes.length) return false;
  const masked = maskNetwork(candidateBytes, cidr.prefix);
  for (let i = 0; i < cidr.bytes.length; i++) {
    if ((cidr.bytes[i] as number) !== (masked[i] as number)) return false;
  }
  return true;
}

/** True when `ip` is one of the trusted proxies, exactly or inside a CIDR. */
export function isTrustedAddress(
  ip: string | null | undefined,
  trusted: readonly string[],
): boolean {
  const address = normalizeIpLiteral(ip);
  if (!address) return false;
  const cidrs = trusted.map(parseCidr).filter((cidr): cidr is Cidr => cidr !== null);
  for (const cidr of cidrs) {
    if (cidr.address === address) return true;
    const bytes = cidr.family === "ipv4"
      ? address.split(".").map((octet) => Number(octet))
      : expandV6(address);
    if (bytes && isMatch(bytes, cidr)) return true;
  }
  return false;
}

export const TRUST_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/** Operator opt-in: true only when this service sits behind trusted proxies. */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUST_TRUE_VALUES.has((env[TRUST_PROXY_ENV] ?? "").trim().toLowerCase());
}

/** Trusted proxy addresses/CIDRs configured by the operator (validated). */
export function trustedProxiesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseTrustedProxies(env[TRUSTED_PROXIES_ENV]);
}

export interface RequestClientIpInput {
  headers: Headers;
  /** Socket peer address, e.g. `server.requestIP(req)?.address`. */
  socketAddress?: string | null;
  trustProxy?: boolean;
  /** Validated entries from `parseTrustedProxies`. */
  trustedProxies?: readonly string[];
}

/**
 * Resolve the address rate-limit buckets and audit rows are keyed on.
 *
 * Trust is OFF by default: forwarding headers are ignored entirely and the
 * socket peer address is used, so local/dev behavior is unchanged and a
 * spoofed `x-forwarded-for` can never mint fresh buckets.
 *
 * With trust ON the rule is: validated `x-real-ip` (the gateway overwrites it
 * with the true client IP; direct spoofing is moot because the socket peer is
 * itself a trusted proxy) -> first untrusted entry of `x-forwarded-for`
 * counted from the RIGHT (skipping trusted proxies) -> socket peer. Any entry
 * that is not a bare IP literal is dropped; a header that yields nothing falls
 * back to the socket peer, which no header can forge.
 */
export function resolveRequestClientIp(input: RequestClientIpInput): string | null {
  const socket = normalizeIpLiteral(input.socketAddress);
  if (input.trustProxy !== true) return socket;

  const trusted = input.trustedProxies ?? [];

  // a. x-real-ip — authoritative when the peer is a trusted proxy (the api
  //    gateway overwrites it with the true client from cf-connecting-ip).
  const real = normalizeIpLiteral(input.headers.get("x-real-ip"));
  if (real) return real;

  // b. First untrusted X-Forwarded-For entry from the right.
  const chain = parseForwardedFor(input.headers.get("x-forwarded-for"));
  for (let i = chain.length - 1; i >= 0; i--) {
    const hop = chain[i] as string;
    if (!isTrustedAddress(hop, trusted)) return hop;
  }
  if (chain.length > 0) return chain[0] as string;

  // c. Socket peer — no header can forge it.
  return socket;
}