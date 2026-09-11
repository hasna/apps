/**
 * The per-entry metadata document — `<info>/<id>.json` (§4).
 *
 * Per-entry JSON, not a database and not JSONL. The reasons are stated plainly
 * because a reviewer is entitled to ask, and because "never SQLite" is NOT a
 * doctrine claim (the doctrine forbids the local tier only in api mode on
 * stations, and explicitly permits documented local-only packages —
 * `docs/fleet-local-storage.md:43-55`; §15 correction 6). The reasons that
 * actually decide it:
 *
 *  1. one capture format in both modes — a mode-conditional index is two
 *     stores to keep in step;
 *  2. the guard is on the hot path of every Bash call, and per-entry JSON needs
 *     no engine initialisation, so `bun:sqlite` never enters the hook bundle;
 *  3. a spool of unique, immutable ids is not a query workload — no join, no
 *     aggregation, no index to maintain.
 *
 * What the choice costs is real (§14.7: bounded enumeration, atomic metadata
 * replacement, revision checks) and this module carries the parts of that cost
 * it can: `revision` exists so an update can detect a lost race, and metadata
 * replacement goes through `writeFileAtomic`.
 */

import { randomUUID } from "node:crypto";
import type { RefusalRecord } from "./refusals.js";

export const ENTRY_SCHEMA = "hasna.trash.entry.v1";

export type TrashEntryKind = "file" | "dir" | "symlink";

/**
 * `staged`    — captured, payload present.
 * `restoring` — a restore is in flight; the sweeper must not touch it
 *               (§12: "protect entries under restore until the restore is durable").
 * `restored`  — the payload was returned to its origin; metadata is kept until
 *               the restore is durable, then removed by `purge`.
 */
export type TrashEntryStatus = "staged" | "restoring" | "restored";

export interface RemoteConfirmation {
  /** Remote object key (`trash/<machine>/<yyyy-MM-dd>/<id>/<sha256>`). */
  key: string;
  /** Object version id when the bucket is versioned — the identity, not the key. */
  versionId: string | null;
  /** The digest the remote object was confirmed to carry. */
  sha256: string;
  sizeBytes: number;
  /** When the remote copy was last CONFIRMED — a historical fact, re-verified before eviction. */
  confirmedAt: string;
}

export interface TrashEntry {
  schema: typeof ENTRY_SCHEMA;
  /** UUIDv4 — an identity, never reused. */
  id: string;
  /** Bumped on every metadata update; an update that loses the race is retried or refused. */
  revision: number;
  /** The absolute path the entry came from, resolved LEXICALLY. Never canonicalized. */
  originalPath: string;
  /** Exactly what the caller typed (may be relative) — the audit trail needs it. */
  givenPath: string;
  /**
   * Immutable capture timestamp. The reaper keys retention off THIS, never off
   * the metadata file's mtime (§12: an mtime-keyed reaper silently extends
   * retention whenever anything touches the file).
   */
  capturedAt: string;
  kind: TrashEntryKind;
  /** Payload bytes: file size, tree total, or symlink target length. */
  sizeBytes: number;
  /** Digest computed at capture; a later mismatch is a divergence to report. */
  sha256: string;
  /** Inode identity at capture (`st_dev`/`st_ino`) — used by crash recovery, never to unlink blindly. */
  device: number;
  inode: number;
  /** Link count at capture. >1 means the payload is NOT an immutable snapshot. */
  nlink: number;
  mode: number;
  pinned: boolean;
  status: TrashEntryStatus;
  /** The LOCAL clock, days. `null` = never expire locally. */
  retentionDays: number | null;
  /** Precomputed absolute expiry; `null` = never. */
  expiresAt: string | null;
  /** The last remote confirmation, or `null` when nothing was uploaded. */
  remote: RemoteConfirmation | null;
  /** The refusal that accompanied a forced capture, when one was forced through. */
  refusal: RefusalRecord | null;
  agent: string | null;
  updatedAt: string;
  restoredAt: string | null;
  restoredTo: string | null;
}

const ENTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newEntryId(): string {
  return randomUUID();
}

/**
 * An entry id is used to build `<info>/<id>.json` and `<files>/<id>` — it must
 * never be able to leave those directories.
 */
export function assertSafeEntryId(id: string): string {
  if (typeof id !== "string" || !ENTRY_ID_RE.test(id)) {
    throw new Error(`invalid entry id "${id}" — expected a lowercase UUID`);
  }
  return id;
}

export function isSafeEntryId(id: string): boolean {
  return typeof id === "string" && ENTRY_ID_RE.test(id);
}

export interface CreateEntryInput {
  id?: string;
  originalPath: string;
  givenPath: string;
  capturedAt: string;
  kind: TrashEntryKind;
  sizeBytes: number;
  sha256: string;
  device: number;
  inode: number;
  nlink: number;
  mode: number;
  retentionDays: number | null;
  expiresAt: string | null;
  agent?: string | null;
  pinned?: boolean;
  refusal?: RefusalRecord | null;
}

export function createEntry(input: CreateEntryInput): TrashEntry {
  const id = input.id ?? newEntryId();
  assertSafeEntryId(id);
  return {
    schema: ENTRY_SCHEMA,
    id,
    revision: 1,
    originalPath: input.originalPath,
    givenPath: input.givenPath,
    capturedAt: input.capturedAt,
    kind: input.kind,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    device: input.device,
    inode: input.inode,
    nlink: input.nlink,
    mode: input.mode,
    pinned: input.pinned ?? false,
    status: "staged",
    retentionDays: input.retentionDays,
    expiresAt: input.expiresAt,
    remote: null,
    refusal: input.refusal ?? null,
    agent: input.agent ?? null,
    updatedAt: input.capturedAt,
    restoredAt: null,
    restoredTo: null,
  };
}

/** Parse and validate an entry document. Throws on anything malformed. */
export function parseEntry(raw: string, source = "<entry>"): TrashEntry {
  let value: TrashEntry;
  try {
    value = JSON.parse(raw) as TrashEntry;
  } catch (error) {
    throw new Error(`${source}: not valid JSON (${(error as Error).message})`);
  }
  if (!value || typeof value !== "object") throw new Error(`${source}: not an object`);
  if (value.schema !== ENTRY_SCHEMA) throw new Error(`${source}: unsupported schema ${String(value.schema)}`);
  assertSafeEntryId(value.id);
  for (const field of ["originalPath", "givenPath", "capturedAt", "kind", "sha256", "updatedAt"] as const) {
    if (typeof value[field] !== "string" || (value[field] as string).length === 0) {
      throw new Error(`${source}: missing ${field}`);
    }
  }
  if (!Number.isFinite(value.sizeBytes) || value.sizeBytes < 0) throw new Error(`${source}: bad sizeBytes`);
  if (!Number.isFinite(value.revision) || value.revision < 1) throw new Error(`${source}: bad revision`);
  if (value.kind !== "file" && value.kind !== "dir" && value.kind !== "symlink") {
    throw new Error(`${source}: bad kind ${String(value.kind)}`);
  }
  if (value.status !== "staged" && value.status !== "restoring" && value.status !== "restored") {
    throw new Error(`${source}: bad status ${String(value.status)}`);
  }
  if (typeof value.pinned !== "boolean") throw new Error(`${source}: pinned must be a boolean`);
  if (value.expiresAt !== null && typeof value.expiresAt !== "string") {
    throw new Error(`${source}: expiresAt must be a string or null`);
  }
  if (value.retentionDays !== null && (typeof value.retentionDays !== "number" || !Number.isFinite(value.retentionDays))) {
    throw new Error(`${source}: retentionDays must be a number or null`);
  }
  return value;
}

export function entryFileName(id: string): string {
  return `${assertSafeEntryId(id)}.json`;
}
