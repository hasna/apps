// Shared domain types + row mappers for the Personal Notes storage layer.
//
// Both the SQLite (`store.ts`) and PostgreSQL (`postgres-note-storage.ts`)
// backends store the SAME logical schema and reuse the helpers in this file so
// the two engines stay at row-level parity (hasna-storage-standard: "shared row
// mappers between engines"). Engine-specific differences (JSON text vs JSONB,
// INTEGER vs BOOLEAN, ISO string vs TIMESTAMPTZ) are normalized here.

import { randomUUID } from "node:crypto";

export type NoteStatus =
  | "inbox"
  | "active"
  | "reviewed"
  | "promoted"
  | "archived"
  | "trash"
  | "stale";

export type NoteTitleSource = "default" | "generated" | "manual";

export const NOTE_STATUSES: readonly NoteStatus[] = [
  "inbox",
  "active",
  "reviewed",
  "promoted",
  "archived",
  "trash",
  "stale",
];

export const DEFAULT_TENANT_ID = "local";
export const DEFAULT_CONTENT_FORMAT = "markdown";
export const DEFAULT_TRASH_RETENTION_DAYS = 30;

/**
 * A single note row. The camelCase shape is the public API of the storage
 * layer; both engines map their native rows into this exact shape.
 */
export interface NoteRecord {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  labels: string[];
  status: NoteStatus;
  folder: string;
  contentFormat: string;
  titleLocked: boolean;
  titleSource: NoteTitleSource;
  titleContentFingerprint: string;
  author: string;
  agent: string;
  createdByActorType: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt: string | null;
  trashExpiresAt: string | null;
  restoredAt: string | null;
}

export interface CreateNoteInput {
  id?: string;
  tenantId?: string;
  title?: string;
  body?: string;
  labels?: string[];
  status?: NoteStatus;
  folder?: string;
  contentFormat?: string;
  titleLocked?: boolean;
  titleSource?: NoteTitleSource;
  titleContentFingerprint?: string;
  author?: string;
  agent?: string;
  createdByActorType?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateNotePatch {
  title?: string;
  body?: string;
  labels?: string[];
  status?: NoteStatus;
  folder?: string;
  contentFormat?: string;
  titleLocked?: boolean;
  titleSource?: NoteTitleSource;
  titleContentFingerprint?: string;
  archivedAt?: string | null;
  trashedAt?: string | null;
  trashExpiresAt?: string | null;
  restoredAt?: string | null;
}

export interface ListNotesQuery {
  tenantId?: string;
  status?: NoteStatus;
  label?: string;
  folder?: string;
  query?: string;
  includeTrashed?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListNotesResult {
  notes: NoteRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface LabelRecord {
  tenantId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface SettingRecord {
  tenantId: string;
  key: string;
  value: string;
  updatedAt: string;
}

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 500;

/** Coerce any driver timestamp representation (Date | string | null) to ISO-8601. */
export function toIso(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  const asString = String(value);
  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? asString : parsed.toISOString();
}

/** Nullable timestamp variant used for archived/trashed/restored columns. */
export function toIsoOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  return toIso(value);
}

/** Parse the labels column from either a JSON string (sqlite) or a value (pg jsonb). */
export function parseLabels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v.length > 0);
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)).filter((v) => v.length > 0) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** De-duplicate labels case-insensitively while preserving first-seen order/casing. */
export function normalizeLabels(labels: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels ?? []) {
    const label = String(raw ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function coerceStatus(value: unknown): NoteStatus {
  const candidate = String(value ?? "").trim() as NoteStatus;
  return NOTE_STATUSES.includes(candidate) ? candidate : "active";
}

function coerceTitleSource(value: unknown): NoteTitleSource {
  const candidate = String(value ?? "").trim();
  if (candidate === "default" || candidate === "generated" || candidate === "manual") {
    return candidate;
  }
  return "manual";
}

/** A raw row as returned by either driver (snake_case columns). */
export type RawNoteRow = Record<string, unknown>;

/** Map a raw driver row into the canonical {@link NoteRecord}. Used by both engines. */
export function rowToNote(row: RawNoteRow): NoteRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    labels: parseLabels(row.labels),
    status: coerceStatus(row.status),
    folder: String(row.folder ?? ""),
    contentFormat: String(row.content_format ?? DEFAULT_CONTENT_FORMAT),
    titleLocked: Boolean(row.title_locked),
    titleSource: coerceTitleSource(row.title_source),
    titleContentFingerprint: String(row.title_content_fingerprint ?? ""),
    author: String(row.author ?? ""),
    agent: String(row.agent ?? ""),
    createdByActorType: String(row.created_by_actor_type ?? "human"),
    createdByName: String(row.created_by_name ?? ""),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    archivedAt: toIsoOrNull(row.archived_at),
    trashedAt: toIsoOrNull(row.trashed_at),
    trashExpiresAt: toIsoOrNull(row.trash_expires_at),
    restoredAt: toIsoOrNull(row.restored_at),
  };
}

/**
 * Normalize a {@link CreateNoteInput} into a complete note, applying defaults,
 * generating an id, and stamping timestamps. Shared by both engines so a note
 * created via SQLite is byte-identical (modulo storage) to one created via PG.
 */
export function normalizeCreateInput(input: CreateNoteInput, now: Date = new Date()): NoteRecord {
  const nowIso = now.toISOString();
  const createdAt = input.createdAt ? toIso(input.createdAt) : nowIso;
  const updatedAt = input.updatedAt ? toIso(input.updatedAt) : createdAt;
  return {
    id: input.id?.trim() || randomUUID(),
    tenantId: input.tenantId?.trim() || DEFAULT_TENANT_ID,
    title: input.title ?? "",
    body: input.body ?? "",
    labels: normalizeLabels(input.labels),
    status: input.status && NOTE_STATUSES.includes(input.status) ? input.status : "active",
    folder: input.folder ?? "",
    contentFormat: input.contentFormat ?? DEFAULT_CONTENT_FORMAT,
    titleLocked: input.titleLocked ?? false,
    titleSource: input.titleSource ?? "manual",
    titleContentFingerprint: input.titleContentFingerprint ?? "",
    author: input.author ?? "",
    agent: input.agent ?? "",
    createdByActorType: input.createdByActorType ?? "human",
    createdByName: input.createdByName ?? "",
    createdAt,
    updatedAt,
    archivedAt: null,
    trashedAt: null,
    trashExpiresAt: null,
    restoredAt: null,
  };
}

/**
 * Apply an {@link UpdateNotePatch} to an existing note, returning a NEW record
 * with `updatedAt` re-stamped. Undefined patch fields are left untouched.
 */
export function applyNotePatch(
  existing: NoteRecord,
  patch: UpdateNotePatch,
  now: Date = new Date(),
): NoteRecord {
  const next: NoteRecord = { ...existing };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.body !== undefined) next.body = patch.body;
  if (patch.labels !== undefined) next.labels = normalizeLabels(patch.labels);
  if (patch.status !== undefined && NOTE_STATUSES.includes(patch.status)) next.status = patch.status;
  if (patch.folder !== undefined) next.folder = patch.folder;
  if (patch.contentFormat !== undefined) next.contentFormat = patch.contentFormat;
  if (patch.titleLocked !== undefined) next.titleLocked = patch.titleLocked;
  if (patch.titleSource !== undefined) next.titleSource = patch.titleSource;
  if (patch.titleContentFingerprint !== undefined) {
    next.titleContentFingerprint = patch.titleContentFingerprint;
  }
  if (patch.archivedAt !== undefined) next.archivedAt = toIsoOrNull(patch.archivedAt);
  if (patch.trashedAt !== undefined) next.trashedAt = toIsoOrNull(patch.trashedAt);
  if (patch.trashExpiresAt !== undefined) next.trashExpiresAt = toIsoOrNull(patch.trashExpiresAt);
  if (patch.restoredAt !== undefined) next.restoredAt = toIsoOrNull(patch.restoredAt);
  next.updatedAt = now.toISOString();
  return next;
}

/** Clamp a caller-supplied page size into the allowed range. */
export function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) return LIST_DEFAULT_LIMIT;
  const floored = Math.floor(limit);
  if (floored <= 0) return LIST_DEFAULT_LIMIT;
  return Math.min(floored, LIST_MAX_LIMIT);
}

/** Clamp a caller-supplied offset to a non-negative integer. */
export function clampOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset) || offset === undefined) return 0;
  return Math.max(0, Math.floor(offset));
}
