import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { KnowledgeSourceManifestOptions } from "../types/index.js";

const MAX_CURSOR_BYTES = 2048;
const DECIMAL_CURSOR = /^(0|[1-9][0-9]*)$/;

export class KnowledgeManifestCursorError extends Error {
  readonly code = "invalid_manifest_cursor";
  constructor(message = "manifest cursor is invalid or does not match this tenant and query") {
    super(message);
    this.name = "KnowledgeManifestCursorError";
  }
}

interface PagePayload {
  v: 1;
  t: "page";
  after: string;
  high: string;
  since: string;
  query: string;
}

interface CheckpointPayload {
  v: 1;
  t: "checkpoint";
  high: string;
}

type CursorPayload = PagePayload | CheckpointPayload;

export interface ManifestPageCursor {
  after: string;
  high: string;
  since: string;
  query: string;
}

export function isManifestCursorValue(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_CURSOR.test(value);
}

function compareCursor(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalFilters(opts: KnowledgeSourceManifestOptions, since: string): Record<string, unknown> {
  return {
    source_id: opts.source_id ?? null,
    collection_id: opts.collection_id ?? null,
    project_id: opts.project_id ?? null,
    tag: opts.tag?.trim().toLowerCase() || null,
    status: opts.status ?? (opts.include_deleted ? "all" : "active"),
    delta: Boolean(opts.delta || opts.since_cursor),
    since,
    after: opts.after ?? null,
    before: opts.before ?? null,
    purpose: opts.purpose ?? "knowledge_index",
  };
}

export function manifestQueryFingerprint(opts: KnowledgeSourceManifestOptions, since: string): string {
  return createHash("sha256").update(JSON.stringify(canonicalFilters(opts, since))).digest("hex");
}

function signingInput(encoded: string, tenantId: string): string {
  return `files.knowledge.manifest.cursor.v1\n${tenantId}\n${encoded}`;
}

function sign(encoded: string, tenantId: string, secret: string): string {
  if (!secret) throw new KnowledgeManifestCursorError("manifest cursor signing is unavailable");
  return createHmac("sha256", secret).update(signingInput(encoded, tenantId)).digest("base64url");
}

function encode(payload: CursorPayload, tenantId: string, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, tenantId, secret)}`;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function decode(token: string, tenantId: string, secret: string): CursorPayload {
  if (!token || Buffer.byteLength(token, "utf8") > MAX_CURSOR_BYTES) throw new KnowledgeManifestCursorError();
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new KnowledgeManifestCursorError();
  const expected = Buffer.from(sign(parts[0], tenantId, secret), "base64url");
  const actual = Buffer.from(parts[1], "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new KnowledgeManifestCursorError();

  let parsed: unknown;
  try {
    const decoded = Buffer.from(parts[0], "base64url");
    if (decoded.length > 1024) throw new KnowledgeManifestCursorError();
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch (error) {
    if (error instanceof KnowledgeManifestCursorError) throw error;
    throw new KnowledgeManifestCursorError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new KnowledgeManifestCursorError();
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1 || (value.t !== "page" && value.t !== "checkpoint")) throw new KnowledgeManifestCursorError();
  if (value.t === "checkpoint") {
    if (!exactKeys(value, ["high", "t", "v"]) || !isManifestCursorValue(value.high)) throw new KnowledgeManifestCursorError();
    return { v: 1, t: "checkpoint", high: value.high };
  }
  if (
    !exactKeys(value, ["after", "high", "query", "since", "t", "v"])
    || !isManifestCursorValue(value.after)
    || !isManifestCursorValue(value.high)
    || !isManifestCursorValue(value.since)
    || compareCursor(value.since, value.high) > 0
    || compareCursor(value.after, value.high) > 0
    || typeof value.query !== "string"
    || !/^[a-f0-9]{64}$/.test(value.query)
  ) throw new KnowledgeManifestCursorError();
  return { v: 1, t: "page", after: value.after, high: value.high, since: value.since, query: value.query };
}

export function encodeManifestPageCursor(
  cursor: ManifestPageCursor,
  tenantId: string,
  secret: string,
): string {
  if (
    !isManifestCursorValue(cursor.after)
    || !isManifestCursorValue(cursor.high)
    || !isManifestCursorValue(cursor.since)
    || compareCursor(cursor.since, cursor.high) > 0
    || compareCursor(cursor.after, cursor.high) > 0
    || !/^[a-f0-9]{64}$/.test(cursor.query)
  ) throw new KnowledgeManifestCursorError();
  return encode({ v: 1, t: "page", ...cursor }, tenantId, secret);
}

export function decodeManifestPageCursor(
  token: string,
  tenantId: string,
  secret: string,
  expectedQuery?: string,
): ManifestPageCursor {
  const payload = decode(token, tenantId, secret);
  if (payload.t !== "page" || (expectedQuery !== undefined && payload.query !== expectedQuery)) throw new KnowledgeManifestCursorError();
  return { after: payload.after, high: payload.high, since: payload.since, query: payload.query };
}

export function encodeManifestCheckpoint(high: string, tenantId: string, secret: string): string {
  if (!isManifestCursorValue(high)) throw new KnowledgeManifestCursorError();
  return encode({ v: 1, t: "checkpoint", high }, tenantId, secret);
}

export function decodeManifestCheckpoint(token: string, tenantId: string, secret: string): string {
  const payload = decode(token, tenantId, secret);
  if (payload.t !== "checkpoint") throw new KnowledgeManifestCursorError();
  return payload.high;
}

export function manifestCursorGreaterThan(left: string, right: string): boolean {
  if (!isManifestCursorValue(left) || !isManifestCursorValue(right)) throw new KnowledgeManifestCursorError();
  return compareCursor(left, right) > 0;
}
