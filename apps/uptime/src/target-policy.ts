import net from "node:net";
import type { CreateMonitorInput, Monitor } from "./types.js";

type MonitorTarget = Pick<CreateMonitorInput | Monitor, "kind" | "url" | "host" | "port">;

const SECRET_PARAM_PATTERN = /(token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session)/i;

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
  const host = normalizeHost(hostname);
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

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isDeniedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224
  );
}

function isDeniedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) return isDeniedIpv4(mappedIpv4);
  const words = parseIpv6Words(normalized);
  return (
    normalized === "::"
    || normalized === "::1"
    || (words !== null && (words[0] & 0xffc0) === 0xfe80)
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("ff")
  );
}

function ipv4FromMappedIpv6(ip: string): string | null {
  const words = parseIpv6Words(ip);
  if (!words) return null;
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
  return [
    words[6] >> 8,
    words[6] & 0xff,
    words[7] >> 8,
    words[7] & 0xff,
  ].join(".");
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
