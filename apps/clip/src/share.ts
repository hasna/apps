import { DEFAULT_PORT } from "./paths.js";
import type { ClipClientOptions, ClipRecord } from "./types.js";

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

export function withShareUrl(record: ClipRecord, options: ClipClientOptions = {}): ClipRecord {
  return { ...record, shareUrl: buildShareUrl(record, options) };
}
