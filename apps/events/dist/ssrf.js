// @bun
// src/ssrf.ts
import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
var DEFAULT_MAX_REDIRECTS = 5;
var IPV4_PRIVATE_RANGES = [
  [0, 16777215],
  [167772160, 184549375],
  [1681915904, 1686110207],
  [2130706432, 2147483647],
  [2851995648, 2852061183],
  [2886729728, 2887778303],
  [3221225472, 3221225727],
  [3221225984, 3221226239],
  [3227017984, 3227018239],
  [3232235520, 3232301055],
  [3323068416, 3323199487],
  [3325256704, 3325256959],
  [3405803776, 3405804031],
  [3758096384, 4294967295]
];
var IPV6_SPECIAL_PREFIXES = [
  { groups: [0, 0, 0, 0, 0, 0, 0, 0], bits: 128 },
  { groups: [0, 0, 0, 0, 0, 0, 0, 1], bits: 128 },
  { groups: [0, 0, 0, 0, 0, 65535, 0, 0], bits: 96 },
  { groups: [100, 65435, 0, 0, 0, 0, 0, 0], bits: 96 },
  { groups: [256, 0, 0, 0, 0, 0, 0, 0], bits: 64 },
  { groups: [8193, 0, 0, 0, 0, 0, 0, 0], bits: 32 },
  { groups: [8193, 2, 0, 0, 0, 0, 0, 0], bits: 48 },
  { groups: [8193, 16, 0, 0, 0, 0, 0, 0], bits: 28 },
  { groups: [8193, 3512, 0, 0, 0, 0, 0, 0], bits: 32 },
  { groups: [8194, 0, 0, 0, 0, 0, 0, 0], bits: 16 },
  { groups: [16383, 0, 0, 0, 0, 0, 0, 0], bits: 20 },
  { groups: [64512, 0, 0, 0, 0, 0, 0, 0], bits: 7 },
  { groups: [65152, 0, 0, 0, 0, 0, 0, 0], bits: 10 },
  { groups: [65216, 0, 0, 0, 0, 0, 0, 0], bits: 10 },
  { groups: [65280, 0, 0, 0, 0, 0, 0, 0], bits: 8 }
];
function isPrivateAddress(address) {
  const normalized = stripZoneId(address);
  const version = isIP(normalized);
  if (version === 4) {
    const integer = ipv4ToInt(normalized);
    if (integer === undefined)
      return true;
    return IPV4_PRIVATE_RANGES.some(([low, high]) => integer >= low && integer <= high);
  }
  if (version === 6) {
    const groups = ipv6Groups(normalized);
    if (!groups)
      return true;
    for (const prefix of IPV6_SPECIAL_PREFIXES) {
      if (!ipv6MatchesPrefix(groups, prefix.groups, prefix.bits))
        continue;
      if (prefix.bits === 96 && groups[5] === 65535) {
        return isPrivateAddress(ipv4IntToString(groups[6] << 16 | groups[7]));
      }
      if (prefix.bits === 16 && groups[0] === 8194) {
        return isPrivateAddress(ipv4IntToString(groups[1] << 16 | groups[2]));
      }
      return true;
    }
    return false;
  }
  return true;
}
async function resolveWebhookTarget(url, policy = {}) {
  const hostname = normalizeHostname(url.hostname);
  const allowlist = (policy.allowPrivateHosts ?? []).map((entry) => normalizeHostname(entry.toLowerCase()));
  if (allowlist.includes(hostname)) {
    const version2 = isIP(hostname);
    if (version2 === 4 || version2 === 6) {
      return { hostname, addresses: [hostname] };
    }
    const lookup2 = policy.lookup ?? defaultTargetLookup;
    let resolved2;
    try {
      resolved2 = await lookup2(hostname);
    } catch {
      throw new Error(`Webhook target ${hostname} could not be resolved`);
    }
    if (!Array.isArray(resolved2) || resolved2.length === 0) {
      throw new Error(`Webhook target ${hostname} resolved to no addresses`);
    }
    const addresses = resolved2.map((entry) => normalizeHostname(entry.address));
    return { hostname, addresses };
  }
  const version = isIP(hostname);
  if (version === 4 || version === 6) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Webhook target ${hostname} is a private or special-use address`);
    }
    return { hostname, addresses: [hostname] };
  }
  const lookup = policy.lookup ?? defaultTargetLookup;
  let resolved;
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new Error(`Webhook target ${hostname} could not be resolved`);
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`Webhook target ${hostname} resolved to no addresses`);
  }
  const allowed = [];
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
async function assertWebhookTargetAllowed(url, policy = {}) {
  await resolveWebhookTarget(url, policy);
}
function normalizeMaxRedirects(value) {
  if (value === undefined)
    return DEFAULT_MAX_REDIRECTS;
  if (!Number.isInteger(value) || value < 0)
    throw new Error("webhookTargetPolicy.maxRedirects must be a non-negative integer");
  return value;
}
var defaultTargetLookup = async (hostname) => {
  return dnsLookup(hostname, { all: true, verbatim: false });
};
function normalizeHostname(hostname) {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]"))
    return lower.slice(1, -1);
  return lower;
}
function stripZoneId(address) {
  const percent = address.indexOf("%");
  return percent === -1 ? address : address.slice(0, percent);
}
function ipv4ToInt(address) {
  const parts = address.split(".");
  if (parts.length !== 4)
    return;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part))
      return;
    const octet = Number(part);
    if (octet > 255)
      return;
    value = value << 8 | octet;
  }
  return value >>> 0;
}
function ipv4IntToString(integer) {
  return [
    integer >>> 24 & 255,
    integer >>> 16 & 255,
    integer >>> 8 & 255,
    integer & 255
  ].join(".");
}
function ipv6Groups(address) {
  const raw = stripZoneId(address);
  const doubleColon = raw.indexOf("::");
  const headText = doubleColon === -1 ? raw : raw.slice(0, doubleColon);
  const tailText = doubleColon === -1 ? "" : raw.slice(doubleColon + 2);
  const parseGroups = (text) => {
    if (text === "")
      return [];
    const out = [];
    for (const part of text.split(":")) {
      if (part.includes(".")) {
        const v4 = ipv4ToInt(part);
        if (v4 === undefined)
          return;
        out.push(v4 >>> 16 & 65535, v4 & 65535);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part))
          return;
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };
  const head = parseGroups(headText);
  if (!head)
    return;
  const tail = parseGroups(tailText);
  if (!tail)
    return;
  const total = head.length + tail.length;
  if (doubleColon === -1) {
    return total === 8 ? head : undefined;
  }
  if (total >= 8)
    return;
  return [...head, ...new Array(8 - total).fill(0), ...tail];
}
function ipv6MatchesPrefix(groups, prefixGroups, prefixBits) {
  let remaining = prefixBits;
  for (let index = 0;index < prefixGroups.length && remaining > 0; index += 1) {
    const take = Math.min(16, remaining);
    const mask = 65535 << 16 - take & 65535;
    if ((groups[index] & mask) !== (prefixGroups[index] & mask))
      return false;
    remaining -= take;
  }
  return true;
}
export {
  resolveWebhookTarget,
  normalizeMaxRedirects,
  isPrivateAddress,
  assertWebhookTargetAllowed,
  DEFAULT_MAX_REDIRECTS
};
