import { createHash, randomBytes } from "node:crypto";
import { extname } from "node:path";
import type { JsonObject } from "./types.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/json": ".json",
  "application/pdf": ".pdf",
  "image/apng": ".apng",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/markdown": ".md",
  "text/plain": ".txt",
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function generateSlug(): string {
  return randomBytes(9).toString("base64url");
}

export function normalizeLimit(limit: number | undefined, fallback = 25, max = 500): number {
  if (!Number.isFinite(limit ?? NaN)) return fallback;
  return Math.max(1, Math.min(Math.trunc(limit!), max));
}

export function parseJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

export function stringifyJsonObject(value: JsonObject | undefined): string {
  return JSON.stringify(value ?? {});
}

export function inferMimeType(path: string, fallback = "application/octet-stream"): string {
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? fallback;
}

export function extensionForMime(mimeType: string): string {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSION_BY_MIME[normalized] ?? "";
}

export function textMimeType(): string {
  return "text/plain; charset=utf-8";
}

export function isTextMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("text/") || mimeType.toLowerCase().includes("json");
}

export function compactRecord(value: { id: string; slug: string; kind: string; title: string | null; shareUrl?: string; createdAt: string }): string {
  const title = value.title ? ` ${value.title}` : "";
  const url = value.shareUrl ? ` ${value.shareUrl}` : "";
  return `${value.id} ${value.slug} ${value.kind}${title}${url} ${value.createdAt}`;
}

export function htmlEscape(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
