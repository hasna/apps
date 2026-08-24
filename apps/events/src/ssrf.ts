import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Webhook-target SSRF guard for the durable delivery transport.
 *
 * The durable webhook transport must default-deny private and special-use
 * targets (IPv4/IPv6), refuse redirects that would reach a private target,
 * and prevent a DNS-rebinding window between validation and connection. The
 * connection is pinned to the validated address, and the original hostname is
 * carried in the `Host` header so TLS hostname verification keeps working.
 *
 * A narrow, admin-controlled allowlist (`allowPrivateHosts`) permits
 * intentional private ingress such as a loopback receiver on the same machine.
 */

export interface LookupAddress {
  address: string;
  family: number;
}

export type TargetLookup = (hostname: string) => Promise<LookupAddress[]>;

export interface WebhookTargetPolicy {
  /**
   * Admin-controlled allowlist of private hostnames or IP addresses that
   * intentional private webhook ingress may target (for example a loopback
   * receiver on the same machine). Exact match only, case-insensitive for
   * hostnames. Defaults to none.
   */
  allowPrivateHosts?: string[];
  /**
   * Maximum redirect hops followed. Every hop is revalidated against the same
   * policy. Defaults to 5.
   */
  maxRedirects?: number;
  /** Injectable hostname resolver, used by tests. Defaults to dns.promises.lookup. */
  lookup?: TargetLookup;
}

export const DEFAULT_MAX_REDIRECTS = 5;

export interface ResolvedWebhookTarget {
  hostname: string;
  /** Validated public addresses the connection may be pinned to. */
  addresses: string[];
}

const IPV4_PRIVATE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 — "this network" / unspecified
  [0x0a000000, 0x0affffff], // 10.0.0.0/8 — private
  [0x64400000, 0x647fffff], // 100.64.0.0/10 — CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 — loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 — link-local
  [0xac100000, 0xac1fffff], // 172.16.0.0/12 — private
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24 — IETF protocol assignments
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 — TEST-NET-1
  [0xc0586300, 0xc05863ff], // 192.88.99.0/24 — 6to4 relay anycast (deprecated)
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 — private
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 — benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 — TEST-NET-2
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 — TEST-NET-3
  [0xe0000000, 0xffffffff], // 224.0.0.0/4 (multicast) + 240.0.0.0/4 (reserved + broadcast)
];

const IPV6_SPECIAL_PREFIXES: ReadonlyArray<{ groups: readonly number[]; bits: number }> = [
  { groups: [0x0000, 0, 0, 0, 0, 0, 0, 0], bits: 128 }, // ::/128 — unspecified
  { groups: [0x0000, 0, 0, 0, 0, 0, 0, 0x0001], bits: 128 }, // ::1/128 — loopback
  { groups: [0x0000, 0, 0, 0, 0, 0xffff, 0, 0], bits: 96 }, // ::ffff:0:0/96 — IPv4-mapped
  { groups: [0x0064, 0xff9b, 0, 0, 0, 0, 0, 0], bits: 96 }, // 64:ff9b::/96 — NAT64 well-known
  { groups: [0x0100, 0, 0, 0, 0, 0, 0, 0], bits: 64 }, // 100::/64 — discard-only
  { groups: [0x2001, 0x0000, 0, 0, 0, 0, 0, 0], bits: 32 }, // 2001::/32 — Teredo
  { groups: [0x2001, 0x0002, 0, 0, 0, 0, 0, 0], bits: 48 }, // 2001:2::/48 — benchmarking
  { groups: [0x2001, 0x0010, 0, 0, 0, 0, 0, 0], bits: 28 }, // 2001:10::/28 — ORCHID
  { groups: [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], bits: 32 }, // 2001:db8::/32 — documentation
  { groups: [0x2002, 0, 0, 0, 0, 0, 0, 0], bits: 16 }, // 2002::/16 — 6to4 (embedded IPv4)
  { groups: [0x3fff, 0, 0, 0, 0, 0, 0, 0], bits: 20 }, // 3fff::/20 — documentation
  { groups: [0xfc00, 0, 0, 0, 0, 0, 0, 0], bits: 7 }, // fc00::/7 — unique local
  { groups: [0xfe80, 0, 0, 0, 0, 0, 0, 0], bits: 10 }, // fe80::/10 — link-local
  { groups: [0xfec0, 0, 0, 0, 0, 0, 0, 0], bits: 10 }, // fec0::/10 — site-local (deprecated)
  { groups: [0xff00, 0, 0, 0, 0, 0, 0, 0], bits: 8 }, // ff00::/8 — multicast
];

/**
 * True when the address is a private, loopback, link-local, multicast, or
 * otherwise special-use address that a webhook must not reach by default.
 * Unparsable or non-IP input fails closed (treated as private).
 */
export function isPrivateAddress(address: string): boolean {
  const normalized = stripZoneId(address);
  const version = isIP(normalized);
  if (version === 4) {
    const integer = ipv4ToInt(normalized);
    if (integer === undefined) return true;
    return IPV4_PRIVATE_RANGES.some(([low, high]) => integer >= low && integer <= high);
  }
  if (version === 6) {
    const groups = ipv6Groups(normalized);
    if (!groups) return true;
    for (const prefix of IPV6_SPECIAL_PREFIXES) {
      if (!ipv6MatchesPrefix(groups, prefix.groups, prefix.bits)) continue;
      // Embedded-IPv4 prefixes: the mapped/6to4 address must be checked against
      // the IPv4 private ranges too, so ::ffff:127.0.0.1 and 2002:7f00:1:: are
      // loopback and must be refused.
      if (prefix.bits === 96 && groups[5] === 0xffff) {
        return isPrivateAddress(ipv4IntToString((groups[6] << 16) | groups[7]));
      }
      if (prefix.bits === 16 && groups[0] === 0x2002) {
        return isPrivateAddress(ipv4IntToString((groups[1] << 16) | groups[2]));
      }
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Resolves and validates a webhook target. Returns the validated public
 * addresses (which the caller pins the connection to), or throws with a
 * bounded reason when the target is private, unresolvable, empty, or mixed
 * with a private answer. The narrow admin allowlist admits exact private
 * hostnames and addresses.
 */
export async function resolveWebhookTarget(
  url: URL,
  policy: WebhookTargetPolicy = {},
): Promise<ResolvedWebhookTarget> {
  const hostname = normalizeHostname(url.hostname);
  const allowlist = (policy.allowPrivateHosts ?? []).map((entry) => normalizeHostname(entry.toLowerCase()));

  if (allowlist.includes(hostname)) {
    return { hostname, addresses: [] };
  }

  const version = isIP(hostname);
  if (version === 4 || version === 6) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Webhook target ${hostname} is a private or special-use address`);
    }
    return { hostname, addresses: [hostname] };
  }

  const lookup = policy.lookup ?? defaultTargetLookup;
  let resolved: LookupAddress[];
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new Error(`Webhook target ${hostname} could not be resolved`);
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`Webhook target ${hostname} resolved to no addresses`);
  }

  const allowed: string[] = [];
  for (const entry of resolved) {
    const address = normalizeHostname(entry.address);
    if (isPrivateAddress(address)) {
      if (allowlist.includes(address)) {
        allowed.push(address);
        continue;
      }
      throw new Error(`Webhook target ${hostname} resolves to private or special-use address ${address}`);
    }
    allowed.push(address);
  }
  if (allowed.length === 0) {
    throw new Error(`Webhook target ${hostname} resolved to no public addresses`);
  }
  return { hostname, addresses: allowed };
}

/** Validates a webhook target URL against the SSRF policy, throwing on rejection. */
export async function assertWebhookTargetAllowed(url: URL, policy: WebhookTargetPolicy = {}): Promise<void> {
  await resolveWebhookTarget(url, policy);
}

export function normalizeMaxRedirects(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_REDIRECTS;
  if (!Number.isInteger(value) || value < 0) throw new Error("webhookTargetPolicy.maxRedirects must be a non-negative integer");
  return value;
}

const defaultTargetLookup: TargetLookup = async (hostname) => {
  return dnsLookup(hostname, { all: true, verbatim: false });
};

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) return lower.slice(1, -1);
  return lower;
}

function stripZoneId(address: string): string {
  const percent = address.indexOf("%");
  return percent === -1 ? address : address.slice(0, percent);
}

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function ipv4IntToString(integer: number): string {
  return [
    (integer >>> 24) & 0xff,
    (integer >>> 16) & 0xff,
    (integer >>> 8) & 0xff,
    integer & 0xff,
  ].join(".");
}

function ipv6Groups(address: string): number[] | undefined {
  const raw = stripZoneId(address);
  const doubleColon = raw.indexOf("::");
  const headText = doubleColon === -1 ? raw : raw.slice(0, doubleColon);
  const tailText = doubleColon === -1 ? "" : raw.slice(doubleColon + 2);

  const parseGroups = (text: string): number[] | undefined => {
    if (text === "") return [];
    const out: number[] = [];
    for (const part of text.split(":")) {
      if (part.includes(".")) {
        const v4 = ipv4ToInt(part);
        if (v4 === undefined) return undefined;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return undefined;
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };

  const head = parseGroups(headText);
  if (!head) return undefined;
  const tail = parseGroups(tailText);
  if (!tail) return undefined;
  const total = head.length + tail.length;
  if (doubleColon === -1) {
    return total === 8 ? head : undefined;
  }
  if (total >= 8) return undefined;
  return [...head, ...new Array<number>(8 - total).fill(0), ...tail];
}

function ipv6MatchesPrefix(groups: number[], prefixGroups: readonly number[], prefixBits: number): boolean {
  let remaining = prefixBits;
  for (let index = 0; index < prefixGroups.length && remaining > 0; index += 1) {
    const take = Math.min(16, remaining);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((groups[index] & mask) !== (prefixGroups[index] & mask)) return false;
    remaining -= take;
  }
  return true;
}
