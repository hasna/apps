// Absolute-origin resolution for fleet services.
//
// Behind the api.hasna.com gateway the origin is reached via Cloudflare egress
// and the ALB; the public URL a client used (`https://api.hasna.com/<app>/...`) is only recoverable from the forwarding
// headers: `x-forwarded-proto` (https) and `x-forwarded-host` (api.hasna.com
// for the gateway). Naively splicing raw header values into a URL is how
// CRLF/header-injection garbage becomes part of served links, so every piece
// is validated before it is used:
//
//   - protocol: `x-forwarded-proto` is honored only when it is exactly
//     `http` or `https`; anything else falls back to the caller's default.
//   - host: `x-forwarded-host` is only consulted when the caller trusts the
//     forwarding hop to have set it, and it is validated as a hostname/IP
//     (with optional port) — control characters, whitespace, path/query
//     separators, userinfo and oversized values are rejected outright and the
//     sanitized `Host` header / default host is used instead.
//
// Local/dev behavior is unchanged: with no forwarding headers the result
// falls back to the `Host` header / default host over `http`.
//
// Pure module (no I/O) — unit-tested.

const LABEL = "(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)";
const HOSTNAME_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const BRACKETED_V6_WITH_PORT_RE = /^\[([0-9A-Fa-f:]+)\](?::(\d{1,5}))?$/;
// Pure-numeric dotted strings are malformed IPv4/IPv6 candidates, not names —
// they must never slip through as hostnames.
const ALL_NUMERIC_DOTTED_RE = /^\d+(?:\.\d+)*$/;
const MAX_HOST_LENGTH = 253;
const MAX_PORT_LENGTH = 5; // 65535

/**
 * Validate a single `Host`-style value (hostname / IP with optional port).
 * Returns the cleaned value, or null when it is missing, malformed, or
 * carries characters that are never legitimate in a Host header (CR/LF,
 * whitespace, path separators, userinfo, ...).
 */
export function sanitizeHost(raw: string | null | undefined): string | null {
  let value = (raw ?? "").trim();
  if (!value || value.length === 0) return null;
  if (value.length > MAX_HOST_LENGTH + 1 + MAX_PORT_LENGTH) return null;
  // Anything outside the Host alphabet is rejected up front: control chars,
  // whitespace, `/`, `\`, `@`, `?`, `#`, quotes, commas, …
  if (/[^A-Za-z0-9.:\-[\]]/.test(value)) return null;

  let port: string | null = null;
  // bracketed IPv6 with an optional :port — never misread as host:port
  const v6WithPort = BRACKETED_V6_WITH_PORT_RE.exec(value);
  if (v6WithPort && v6WithPort[2]) {
    port = v6WithPort[2] as string;
    if (Number(port) > 65535) return null;
    value = `[${v6WithPort[1] as string}]`;
  } else {
    // Split an optional :port — only when no earlier colon exists, so bare
    // IPv6 literals are never misread as host:port.
    const withPort = /^([^:]+):(\d{1,5})$/.exec(value);
    if (withPort) {
      port = withPort[2] as string;
      value = withPort[1] as string;
      if (Number(port) > 65535) return null;
      if (!value) return null;
    }
  }

  value = value.replace(/\.$/, "").toLowerCase();
  const suffix = port === null ? "" : `:${port}`;
  if (IPV4_RE.test(value)) return `${value}${suffix}`;
  if (BRACKETED_V6_WITH_PORT_RE.test(value)) return `${value}${suffix}`;
  if (!ALL_NUMERIC_DOTTED_RE.test(value) && HOSTNAME_RE.test(value)) return `${value}${suffix}`;
  return null;
}

export interface RequestOriginInput {
  headers: { get(name: string): string | null | undefined };
  /** Fallback host when neither forwarding headers nor `Host` yield a valid value. */
  defaultHost?: string;
  /** Fallback protocol when `x-forwarded-proto` is absent or invalid. */
  defaultProtocol?: "http" | "https";
  /** Prefer the edge-only x-hasna-public-host for public-link lookup. Never use it for auth. */
  trustHasnaPublicHost?: boolean;
  /** Also consult `x-forwarded-host` (only when the forwarding hop is trusted to set it). */
  trustForwardedHost?: boolean;
}

/**
 * Resolve the absolute origin (`https://api.hasna.com`) for a request.
 *
 * For public edge requests, valid `x-hasna-public-proto` and
 * `x-hasna-public-host` win. Otherwise protocol honors `x-forwarded-proto`
 * (http/https whitelist only), and host uses trusted `x-forwarded-host`, then
 * `Host`, then the caller default. Returns null only when every host candidate
 * is missing or malformed.
 */
export function resolvePublicOrigin(input: RequestOriginInput): string | null {
  const publicProto = input.trustHasnaPublicHost === true
    ? firstHeaderValue(input.headers.get("x-hasna-public-proto"))
    : null;
  const forwardedProto = firstHeaderValue(input.headers.get("x-forwarded-proto"));
  const rawProto = publicProto === "https" || publicProto === "http"
    ? publicProto
    : forwardedProto;
  const protocol = rawProto === "https" || rawProto === "http"
    ? rawProto
    : (input.defaultProtocol ?? "http");

  // This header is an edge routing hint only. It is deliberately scoped to
  // public-link origin/hostname resolution and must never feed API auth or
  // tenant authorization decisions.
  const hasnaPublicHost = input.trustHasnaPublicHost === true
    ? sanitizeHost(firstHeaderValue(input.headers.get("x-hasna-public-host")))
    : null;
  const forwardedHost = input.trustForwardedHost === true
    ? sanitizeHost(firstHeaderValue(input.headers.get("x-forwarded-host")))
    : null;
  const host = hasnaPublicHost
    ?? forwardedHost
    ?? sanitizeHost(firstHeaderValue(input.headers.get("host")))
    ?? sanitizeHost(input.defaultHost);
  if (!host) return null;
  return `${protocol}://${host}`;
}

/** First comma-separated segment, trimmed — proxies may append their own steps. */
function firstHeaderValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.split(",")[0]?.trim();
  return value ? value : null;
}
