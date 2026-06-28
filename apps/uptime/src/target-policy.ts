import net from "node:net";
import type { CreateMonitorInput, Monitor } from "./types.js";

type MonitorTarget = Pick<CreateMonitorInput | Monitor, "kind" | "url" | "host" | "port">;

const SECRET_PARAM_PATTERN = /(^|[_-])(token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session)([_-]|$)/i;

export function assertHostedTargetAllowed(target: MonitorTarget): void {
  if (target.kind === "http") {
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
  throw new Error("Monitor kind must be http or tcp");
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
  return (
    normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fe80:")
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("ff")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:169.254.")
    || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    || normalized.startsWith("::ffff:192.168.")
  );
}
