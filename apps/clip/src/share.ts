import { DEFAULT_PORT } from "./paths.js";
import type { ClipClientOptions, ClipRecord, ShareExpiryOptions } from "./types.js";

const TTL_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

export type ShareAccessCredential =
  | { accessToken: string }
  | { password: string };

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function resolveBaseUrl(options: ClipClientOptions = {}): string {
  const configured = options.baseUrl ?? process.env["CLIP_BASE_URL"];
  if (configured) return normalizeBaseUrl(configured);
  const host = options.host ?? process.env["HOST"] ?? "127.0.0.1";
  const port = options.port ?? (process.env["PORT"] ? Number.parseInt(process.env["PORT"], 10) : DEFAULT_PORT);
  return `http://${host}:${Number.isFinite(port) ? port : DEFAULT_PORT}`;
}

export function buildShareUrl(record: Pick<ClipRecord, "slug">, options: ClipClientOptions = {}): string {
  return `${resolveBaseUrl(options)}/s/${encodeURIComponent(record.slug)}`;
}

export function buildShareAccessUrl(
  record: Pick<ClipRecord, "slug">,
  credential: ShareAccessCredential,
  options: ClipClientOptions = {},
): string {
  const url = new URL(buildShareUrl(record, options));
  if ("accessToken" in credential) {
    url.searchParams.set("token", credential.accessToken);
  } else {
    url.searchParams.set("password", credential.password);
  }
  return url.toString();
}

export function withShareUrl(record: ClipRecord, options: ClipClientOptions = {}): ClipRecord {
  return { ...record, shareUrl: buildShareUrl(record, options) };
}

export function parseShareTtlSeconds(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)([smhdw]?)$/i.exec(trimmed);
  if (!match) throw new Error("TTL must be a positive duration such as 30s, 10m, 2h, 7d, or 1w.");

  const amount = Number.parseInt(match[1]!, 10);
  const unit = (match[2] || "s").toLowerCase();
  const multiplier = TTL_UNITS[unit];
  const seconds = amount * multiplier;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error("TTL must be a positive duration.");
  }
  return seconds;
}

function normalizeExpiresAt(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("expiresAt must be a valid date or ISO timestamp.");
  }
  return date.toISOString();
}

export function resolveShareExpiresAt(options: ShareExpiryOptions = {}): string | null {
  const hasExpiresAt = options.expiresAt !== undefined && options.expiresAt !== null && options.expiresAt !== "";
  const hasTtlString = options.ttl !== undefined && options.ttl !== null && options.ttl !== "";
  const hasTtlSeconds = options.ttlSeconds !== undefined && options.ttlSeconds !== null;
  const hasTtl = hasTtlString || hasTtlSeconds;
  if (hasExpiresAt && hasTtl) throw new Error("Use either expiresAt or TTL, not both.");
  if (hasTtlString && hasTtlSeconds) throw new Error("Use either ttl or ttlSeconds, not both.");
  if (hasExpiresAt) return normalizeExpiresAt(options.expiresAt as string | Date);

  let seconds: number | null = null;
  if (hasTtlString) seconds = parseShareTtlSeconds(options.ttl!);
  if (hasTtlSeconds) {
    const ttlSeconds = options.ttlSeconds!;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error("ttlSeconds must be a positive integer.");
    seconds = Math.trunc(ttlSeconds);
  }
  if (seconds === null) return null;
  const now = options.now ?? new Date();
  return new Date(now.getTime() + seconds * 1000).toISOString();
}
