import net from "node:net";
import type { CreateMonitorInput, Monitor } from "./types.js";

type MonitorTarget = Pick<CreateMonitorInput | Monitor, "kind" | "url" | "host" | "port">;

const SECRET_PARAM_PATTERN = /(token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session)/i;
const DENIED_IPV4_CIDRS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const DENIED_IPV6_CIDRS = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2620:4f:8000::", 48],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const;

export interface HostedResolvedAddress {
  address: string;
  family?: 4 | 6 | number;
}

export function assertHostedTargetAllowed(target: MonitorTarget): void {
  if (target.kind === "http" || target.kind === "browser_page") {
    if (!target.url) throw new Error("HTTP monitors require url");
    assertHostedHttpUrlAllowed(target.url);
    return;
  }
  if (target.kind === "tcp") {
    if (!target.host) throw new Error("TCP monitors require host");
    assertHostedHostAllowed(target.host, "TCP host");
    if (!Number.isInteger(target.port) || target.port! <= 0 || target.port! > 65535) {
      throw new Error("TCP monitors require a port from 1 to 65535");
    }
    return;
  }
  throw new Error("Monitor kind must be http, tcp, or browser_page");
}

export function assertHostedHttpUrlAllowed(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("HTTP monitor url must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("hosted target URLs must not contain userinfo");
  }
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_PARAM_PATTERN.test(key)) {
      throw new Error(`hosted target URL query parameter is not allowed: ${key}`);
    }
  }
  if (parsed.hash && SECRET_PARAM_PATTERN.test(parsed.hash)) {
    throw new Error("hosted target URL fragment contains secret-like data");
  }
  assertHostedHostAllowed(parsed.hostname, "HTTP host");
}

export function assertHostedHostAllowed(hostname: string, label = "host"): void {
  const host = normalizeHostedHost(hostname);
  if (!host) throw new Error(`${label} is required`);
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error(`${label} is not allowed in hosted mode: localhost`);
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`${label} is not allowed in hosted mode: private DNS name`);
  }
  const ipVersion = net.isIP(host);
  if (ipVersion === 4 && isDeniedIpv4(host)) {
    throw new Error(`${label} is not allowed in hosted mode: private or reserved IPv4`);
  }
  if (ipVersion === 6 && isDeniedIpv6(host)) {
    throw new Error(`${label} is not allowed in hosted mode: private or reserved IPv6`);
  }
}

export function assertHostedResolvedAddressesAllowed(hostname: string, addresses: HostedResolvedAddress[], label = "resolved address"): void {
  if (addresses.length === 0) {
    throw new Error(`${label} is not allowed in hosted mode: DNS returned no addresses for ${normalizeHostedHost(hostname) || "host"}`);
  }
  for (const entry of addresses) {
    assertHostedAddressAllowed(entry.address, label);
  }
}

export function assertHostedAddressAllowed(address: string, label = "resolved address"): void {
  const host = normalizeHostedHost(address);
  const ipVersion = net.isIP(host);
  if (ipVersion === 4 && isDeniedIpv4(host)) {
    throw new Error(`${label} is not allowed in hosted mode: private or reserved IPv4`);
  }
  if (ipVersion === 6 && isDeniedIpv6(host)) {
    throw new Error(`${label} is not allowed in hosted mode: private or reserved IPv6`);
  }
  if (ipVersion === 0) {
    throw new Error(`${label} is not allowed in hosted mode: DNS returned a non-IP address`);
  }
}

export function normalizeHostedHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isDeniedIpv4(ip: string): boolean {
  const parts = parseIpv4Words(ip);
  if (!parts) return true;
  return DENIED_IPV4_CIDRS.some(([base, prefix]) => ipv4MatchesCidr(parts, parseIpv4Words(base)!, prefix));
}

function isDeniedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  const words = parseIpv6Words(normalized);
  if (!words) return true;
  const mappedIpv4 = ipv4FromMappedIpv6Words(words);
  if (mappedIpv4) return isDeniedIpv4(mappedIpv4);
  return isIpv4CompatibleIpv6(words)
    || DENIED_IPV6_CIDRS.some(([base, prefix]) => ipv6MatchesCidr(words, parseIpv6Words(base)!, prefix));
}

function isIpv4CompatibleIpv6(words: number[] | null): boolean {
  if (!words) return false;
  if (!words.slice(0, 6).every((word) => word === 0)) return false;
  if (words[6] === 0 && (words[7] === 0 || words[7] === 1)) return false;
  return true;
}

function ipv4FromMappedIpv6Words(words: number[]): string | null {
  if (
    words[0] !== 0
    || words[1] !== 0
    || words[2] !== 0
    || words[3] !== 0
    || words[4] !== 0
    || words[5] !== 0xffff
  ) {
    return null;
  }
  return ipv4FromWords(words[6], words[7]);
}

function ipv4FromWords(high: number, low: number): string {
  return [
    high >> 8,
    high & 0xff,
    low >> 8,
    low & 0xff,
  ].join(".");
}

function ipv4MatchesCidr(parts: [number, number, number, number], base: [number, number, number, number], prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((ipv4ToNumber(parts) & mask) >>> 0) === ((ipv4ToNumber(base) & mask) >>> 0);
}

function ipv4ToNumber(parts: [number, number, number, number]): number {
  return (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv6MatchesCidr(words: number[], base: number[], prefix: number): boolean {
  const fullWords = Math.floor(prefix / 16);
  for (let index = 0; index < fullWords; index += 1) {
    if (words[index] !== base[index]) return false;
  }
  const remainingBits = prefix % 16;
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (words[fullWords] & mask) === (base[fullWords] & mask);
}

function parseIpv6Words(value: string): number[] | null {
  let ip = value.toLowerCase();
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  if (ip.includes(".")) {
    const lastColon = ip.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = parseIpv4Words(ip.slice(lastColon + 1));
    if (!ipv4) return null;
    ip = `${ip.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const compressed = ip.split("::");
  if (compressed.length > 2) return null;
  const left = parseIpv6Side(compressed[0]);
  const right = compressed.length === 2 ? parseIpv6Side(compressed[1]) : [];
  if (!left || !right) return null;

  if (compressed.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function parseIpv6Side(value: string): number[] | null {
  if (!value) return [];
  const words = value.split(":");
  if (words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map((word) => Number.parseInt(word, 16));
}

function parseIpv4Words(value: string): [number, number, number, number] | null {
  const words = value.split(".").map((part) => Number(part));
  if (words.length !== 4 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 255)) {
    return null;
  }
  return words as [number, number, number, number];
}
