import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTENT_FORMAT_MARKDOWN, dataRoot, deleteNote, loadNotes, revFrom, saveNote } from '../tools/notes-lib.mjs';
import { createClient, PersonalNotesApiError } from './client.mjs';

// Real sync engine: maps the canonical local markdown store to /api/v1/sync
// item batches and applies pulled server rows back to disk. Design notes and
// the normative conflict policy live in docs/sync.md.
//
// Invariants:
// - The local markdown store stays canonical; sync-state.json is bookkeeping
//   only and can be deleted (worst case: a full re-push/re-pull, no data loss).
// - Every update/delete item carries `baseRevision` (server per-note monotonic
//   revision). Conflicts are resolved keep-both: the server version keeps the
//   note id, local uncommitted edits are preserved as a "(conflict copy)" note.
// - Purge (local file deleted) pushes a content-blanking upsert followed by a
//   `deleted:true` tombstone item; pulled `deletedAt` rows delete the local
//   file and record a tombstone so stale rows can never resurrect the note.
// - Each batch has a fresh idempotency key persisted (with its exact body)
//   BEFORE sending; retries and post-crash resumes reuse the same key so the
//   server replays instead of double-applying.

export const SYNC_STATE_FILE = 'sync-state.json';
export const MAX_ITEMS_PER_BATCH = 100;
export const MAX_BATCH_BYTES = 1.5 * 1024 * 1024;
// A single note that serializes past the server request cap (2 MiB on both
// backends) can never be pushed — it must be skipped-and-reported, NEVER
// parked as a pending batch (a poisoned pending resends head-of-line on every
// run and wedges the whole device — P3 adversarial finding #2). 4 KiB margin
// covers the JSON envelope ({items:[...], cursor}) around the item.
export const MAX_ITEM_BYTES = 2 * 1024 * 1024 - 4096;
export const CURSOR_OVERLAP_MS = 5000;
const MAX_PULL_ROUNDS = 50;
const MAX_PUSH_ROUNDS = 3;
const NOTE_STATUSES = ['active', 'archived', 'trash'];

export function syncStatePath(root = dataRoot()) {
  return join(root, SYNC_STATE_FILE);
}

function emptyState(apiUrl) {
  return { version: 1, apiUrl, cursor: '', notes: {}, byServerId: {}, tombstones: {}, pending: null };
}

export async function loadSyncState(root = dataRoot(), apiUrl = '') {
  let state = null;
  try {
    state = JSON.parse(await readFile(syncStatePath(root), 'utf8'));
  } catch {
    state = null;
  }
  if (!state || state.version !== 1) return emptyState(apiUrl);
  // State is per server. Switching base URLs starts fresh bookkeeping — the
  // markdown store is canonical, so this only means a full re-push/re-pull.
  if (apiUrl && state.apiUrl && state.apiUrl !== apiUrl) return emptyState(apiUrl);
  state.apiUrl = state.apiUrl || apiUrl;
  state.notes = state.notes || {};
  state.byServerId = state.byServerId || {};
  state.tombstones = state.tombstones || {};
  state.pending = state.pending || null;
  return state;
}

export async function saveSyncState(state, root = dataRoot()) {
  const path = syncStatePath(root);
  const tmp = join(root, `.${SYNC_STATE_FILE}.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
  return state;
}

export function contentHashOf(note) {
  const canonical = JSON.stringify({
    title: note.title || '',
    body: note.body || '',
    labels: note.labels || [],
    folder: note.folder || '',
    status: note.status || 'active',
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// Local note -> sync upsert item. All schema-v2 metadata (status, machine
// attribution, actor provenance, local rev) rides in frontmatterJson so every
// machine can still see which note belongs to which machine after a pull.
export function noteToSyncItem(note, baseRevision) {
  return {
    clientId: note.id,
    ...(baseRevision ? { baseRevision } : {}),
    title: note.title,
    bodyMarkdown: note.body,
    folder: note.folder || null,
    labels: note.labels || [],
    archived: note.status === 'archived',
    source: 'local',
    frontmatterJson: {
      schema: 2,
      status: note.status,
      contentFormat: note.contentFormat || CONTENT_FORMAT_MARKDOWN,
      rev: note.rev,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      machine: note.machine,
      machineFriendlyName: note.machineFriendlyName || '',
      author: note.author || '',
      agent: note.agent || '',
      createdByActorType: note.createdByActorType || '',
      createdByName: note.createdByName || '',
      titleLocked: !!note.titleLocked,
      titleSource: note.titleSource || '',
      titleContentFingerprint: note.titleContentFingerprint || '',
      archivedAt: note.archivedAt || '',
      trashedAt: note.trashedAt || '',
      trashExpiresAt: note.trashExpiresAt || '',
      restoredAt: note.restoredAt || '',
    },
  };
}

// Purge is two-phase, each phase guarded by an acked baseRevision (a single
// batch cannot chain dependent revisions safely): first blank the content (the
// hosted platform never scrubs on delete), then — next push round — the
// soft-delete tombstone. `purged:true` is the OSS-dialect marker; hosted
// ignores it. If either phase conflicts, the purge is dropped and the newer
// server version comes back (data safety beats delete intent).
function purgeBlankItem(clientId, baseRevision, purgedAt) {
  return {
    clientId,
    ...(baseRevision ? { baseRevision } : {}),
    // The dialect's upsert merge treats an empty title as absent
    // (`input.title?.trim() || current.title`), so scrubbing with '' would
    // leave the old — possibly sensitive — title in place on the hosted
    // platform forever. Blank to the platform's default title instead; the
    // self-hosted phase-2 purge scrubs it to '' anyway.
    title: 'Untitled',
    bodyMarkdown: '',
    labels: [],
    folder: null,
    frontmatterJson: { schema: 2, status: 'purged', purgedAt },
  };
}

function purgeDeleteItem(clientId, baseRevision) {
  return {
    clientId,
    ...(baseRevision ? { baseRevision } : {}),
    deleted: true,
    purged: true,
  };
}

// Server row -> local note fields. frontmatterJson carries the originating
// device's schema-v2 metadata; rows born outside this client (hosted web UI)
// fall back to the row's own fields.
export function rowToNote(row, localId) {
  const fm = (row.frontmatterJson && typeof row.frontmatterJson === 'object') ? row.frontmatterJson : {};
  const status = NOTE_STATUSES.includes(fm.status) ? fm.status : (row.archived ? 'archived' : 'active');
  return {
    id: localId,
    title: row.title || 'Untitled Note',
    body: row.bodyMarkdown || '',
    labels: Array.isArray(row.labels) ? row.labels : [],
    folder: row.folder || '',
    status,
    contentFormat: fm.contentFormat || CONTENT_FORMAT_MARKDOWN,
    rev: revFrom(fm.rev),
    createdAt: fm.createdAt || row.createdAt || new Date().toISOString(),
    updatedAt: fm.updatedAt || row.updatedAt || new Date().toISOString(),
    machine: fm.machine || row.source || 'unknown',
    machineFriendlyName: fm.machineFriendlyName || '',
    author: fm.author || 'unknown',
    agent: fm.agent || 'personalnotes-sync',
    createdByActorType: fm.createdByActorType || '',
    createdByName: fm.createdByName || '',
    titleLocked: !!fm.titleLocked,
    titleSource: fm.titleSource || '',
    titleContentFingerprint: fm.titleContentFingerprint || '',
    archivedAt: fm.archivedAt || '',
    trashedAt: fm.trashedAt || '',
    trashExpiresAt: fm.trashExpiresAt || '',
    restoredAt: fm.restoredAt || '',
  };
}

// UUID-SHAPED, not strict RFC-4122 — kept in lockstep with notes-lib.isUUID so a
// non-v4 (but UUID-shaped) local note id maps back to the same local file on pull.
function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function localIdForRow(state, row) {
  const mapped = state.byServerId[row.id];
  if (mapped) return mapped;
  if (isUUID(row.clientId)) return String(row.clientId).toLowerCase();
  return String(row.id).toLowerCase();
}

// The hosted cursor is a server wall-clock timestamp; rewind it ≥5s per
// request so in-flight commits are never skipped (dedupe absorbs the overlap).
// Opaque (self-hosted seq) cursors pass through untouched.
//
// "Timestamp-shaped" MUST be decided by an ISO-8601 pattern match, never by
// Date.parse NaN-ness: V8's lenient Date.parse() accepts the self-hosted
// opaque cursor `s:100` as a year-0099 date, and rewinding that mangles the
// cursor so the server re-feeds from epoch and the client can never advance
// past the first page (P3 adversarial finding #1 — permanent >100-note stall).
const ISO_CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function seqCursorValue(cursor) {
  const m = /^s:(\d+)$/.exec(String(cursor ?? ''));
  return m ? Number(m[1]) : null;
}

function isoCursorTime(cursor) {
  if (!ISO_CURSOR_RE.test(String(cursor ?? ''))) return null;
  const t = Date.parse(cursor);
  return Number.isNaN(t) ? null : t;
}

export function overlapRewindCursor(cursor) {
  if (!cursor) return '';
  const t = isoCursorTime(cursor);
  if (t === null) return cursor; // opaque (e.g. `s:<seq>`) — pass through untouched
  return new Date(t - CURSOR_OVERLAP_MS).toISOString();
}

function advanceCursor(state, next) {
  if (!next) return;
  // Idempotent replays hand back the ORIGINAL response snapshot, whose cursor
  // may be older than what we already hold — never move backwards. Compare
  // seq cursors numerically and ISO cursors by time; a shape change (server
  // upgrading the client from ISO to seq paging) always advances.
  const prevSeq = seqCursorValue(state.cursor);
  const nextSeq = seqCursorValue(next);
  if (prevSeq !== null && nextSeq !== null) {
    if (nextSeq < prevSeq) return; // replay snapshot — keep newer
    state.cursor = next;
    return;
  }
  const prev = isoCursorTime(state.cursor);
  const nextT = isoCursorTime(next);
  if (prev !== null && nextT !== null && nextT < prev) return; // replay snapshot — keep newer
  state.cursor = next;
}

function conflictCopyOf(note, now) {
  return {
    ...note,
    id: randomUUID(),
    title: `${note.title} (conflict copy)`,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    restoredAt: '',
  };
}

function classifyRow(row, state, localNotes) {
  const localId = localIdForRow(state, row);
  const entry = state.notes[localId];
  const tombstone = state.tombstones[localId];
  const local = localNotes.get(localId);
  const revision = Number(row.revision) || 0;
  if (tombstone && revision <= Number(tombstone.serverRevision || 0)) return { localId, action: 'stale' };
  if (entry && revision <= Number(entry.serverRevision || 0)) return { localId, action: 'stale' };
  if (row.deletedAt) {
    if (!local) return { localId, action: tombstone ? 'stale-tombstone' : 'tombstone' };
    const dirty = !entry || local.rev !== entry.syncedRev;
    return { localId, action: dirty ? 'purge-conflict' : 'purge' };
  }
  const mapped = rowToNote(row, localId);
  if (!local) return { localId, action: 'create', mapped };
  const dirty = !entry || local.rev !== entry.syncedRev;
  if (dirty && contentHashOf(local) !== contentHashOf(mapped)) return { localId, action: 'conflict', mapped };
  return { localId, action: 'update', mapped };
}

async function applyServerRow(row, ctx) {
  const { state, root, localNotes, summary, now } = ctx;
  const verdict = classifyRow(row, state, localNotes);
  const { localId, action, mapped } = verdict;
  const revision = Number(row.revision) || 0;
  state.byServerId[row.id] = localId;

  if (action === 'stale') {
    summary.skippedStale += 1;
    return verdict;
  }
  if (action === 'stale-tombstone' || action === 'tombstone') {
    // Already gone locally (or never seen): record/advance the tombstone so
    // this deletion can never be undone by an older row.
    state.tombstones[localId] = { serverId: row.id, serverRevision: revision, recordedAt: now() };
    delete state.notes[localId];
    if (action === 'tombstone') summary.pulled.purged += 1;
    return verdict;
  }
  if (action === 'purge' || action === 'purge-conflict') {
    if (action === 'purge-conflict') {
      // Local uncommitted edits survive the remote purge as a conflict copy.
      const copy = conflictCopyOf(localNotes.get(localId), now());
      const savedCopy = await saveNote(copy, root);
      localNotes.set(savedCopy.id, savedCopy);
      summary.conflicts.push({ noteId: localId, copyId: savedCopy.id, resolution: 'kept-both' });
    }
    await deleteNote(localId, root);
    localNotes.delete(localId);
    state.tombstones[localId] = { serverId: row.id, serverRevision: revision, recordedAt: now() };
    delete state.notes[localId];
    summary.pulled.purged += 1;
    return verdict;
  }
  if (action === 'conflict') {
    const copy = conflictCopyOf(localNotes.get(localId), now());
    const savedCopy = await saveNote(copy, root);
    localNotes.set(savedCopy.id, savedCopy);
    summary.conflicts.push({ noteId: localId, copyId: savedCopy.id, resolution: 'kept-both' });
  }
  // Server version wins the note id (create / update / conflict). Sync-applied
  // writes preserve the originating machine's rev (schema-v2 contract in
  // tools/notes-lib.mjs saveNote / MarkdownStore.swift): only genuine local
  // mutations bump rev, so replicas stay rev-identical to the origin.
  const saved = await saveNote(mapped, root, { preserveRev: true });
  localNotes.set(localId, saved);
  delete state.tombstones[localId]; // newer non-deleted row = restore
  state.notes[localId] = {
    serverId: row.id,
    serverRevision: revision,
    syncedRev: saved.rev,
    syncedHash: contentHashOf(saved),
  };
  summary.pulled[action === 'create' ? 'created' : 'updated'] += 1;
  return verdict;
}

function buildPushOps(state, localNotes, now) {
  const ops = [];
  for (const note of localNotes.values()) {
    const entry = state.notes[note.id];
    if (entry && note.rev === entry.syncedRev) continue;
    const tombstone = state.tombstones[note.id];
    // A local file over a tombstone is a deliberate restore: push it with the
    // tombstone's baseRevision so the server upsert clears deletedAt.
    const baseRevision = entry?.serverRevision ?? tombstone?.serverRevision;
    ops.push({
      clientId: note.id,
      kind: entry ? 'update' : 'create',
      rev: note.rev,
      hash: contentHashOf(note),
      items: [noteToSyncItem(note, baseRevision)],
    });
  }
  for (const [id, entry] of Object.entries(state.notes)) {
    if (localNotes.has(id) || state.tombstones[id]) continue;
    // Synced note whose file is gone = local purge (CLI purge / retention).
    ops.push(entry.purgePending
      ? { clientId: id, kind: 'purge-delete', items: [purgeDeleteItem(id, entry.serverRevision)] }
      : { clientId: id, kind: 'purge-blank', items: [purgeBlankItem(id, entry.serverRevision, now())] });
  }
  return ops;
}

function chunkOps(ops) {
  const batches = [];
  const oversized = [];
  let items = [];
  let meta = { revs: {}, hashes: {}, kinds: {} };
  let bytes = 2;
  const flush = () => {
    if (!items.length) return;
    batches.push({ items, meta });
    items = [];
    meta = { revs: {}, hashes: {}, kinds: {} };
    bytes = 2;
  };
  for (const op of ops) {
    const opBytes = Buffer.byteLength(JSON.stringify(op.items));
    // An un-splittable over-cap op (one giant note) would 413 forever; report
    // it instead of batching it so it can never block the other notes.
    if (opBytes > MAX_ITEM_BYTES) {
      oversized.push({ clientId: op.clientId, kind: op.kind, bytes: opBytes });
      continue;
    }
    if (items.length && (items.length + op.items.length > MAX_ITEMS_PER_BATCH || bytes + opBytes > MAX_BATCH_BYTES)) flush();
    items.push(...op.items);
    bytes += opBytes;
    meta.kinds[op.clientId] = op.kind;
    if (op.kind === 'create' || op.kind === 'update') {
      meta.revs[op.clientId] = op.rev;
      meta.hashes[op.clientId] = op.hash;
    }
  }
  flush();
  return { batches, oversized };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send one batch. 409 (idempotency race) and 429 (rate limit) retry the SAME
// key + byte-identical body so the server's replay path answers.
async function sendWithRetry(client, body, key, { retryDelayMs, attempts = 4 }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await client.sync(body, key);
    } catch (err) {
      const retryable = err instanceof PersonalNotesApiError && (err.status === 409 || err.status === 429);
      if (!retryable || attempt >= attempts) throw err;
      await sleep(retryDelayMs * attempt);
    }
  }
}

// 413 is deterministic: the server rejected this exact body BEFORE applying
// anything and will reject a byte-identical resend forever — the one error a
// pending batch must never be resumed through.
function isPayloadTooLarge(err) {
  return err instanceof PersonalNotesApiError && err.status === 413;
}

async function processBatchResponse(res, meta, ctx) {
  const { state, summary } = ctx;
  for (const applied of res.applied || []) {
    const localId = applied.clientId;
    const kind = meta.kinds[localId];
    state.byServerId[applied.id] = localId;
    if (kind === 'purge-blank') {
      // Phase 1 acked: remember the blanked revision so phase 2 (the delete)
      // is guarded against edits that land in between.
      state.notes[localId] = { ...(state.notes[localId] || {}), serverId: applied.id, serverRevision: applied.revision, purgePending: true };
      continue;
    }
    if (kind === 'purge-delete') {
      if (applied.deleted) {
        state.tombstones[localId] = { serverId: applied.id, serverRevision: applied.revision, recordedAt: ctx.now() };
        delete state.notes[localId];
        summary.pushed.purged += 1;
      }
      continue;
    }
    delete state.tombstones[localId]; // acked upsert over a tombstone = restore
    state.notes[localId] = {
      serverId: applied.id,
      serverRevision: applied.revision,
      syncedRev: meta.revs[localId],
      syncedHash: meta.hashes[localId],
    };
    summary.pushed[kind === 'create' ? 'created' : 'updated'] += 1;
  }
  const conflictHandled = new Set();
  for (const conflict of res.conflicts || []) {
    // Keep-both via the standard pull path: the server's current row wins the
    // note id; dirty local content becomes a conflict copy that the next push
    // round sends as a first-create. A conflicted purge is dropped (the note
    // comes back from the server — data safety beats delete intent).
    if (conflictHandled.has(conflict.clientId)) continue;
    conflictHandled.add(conflict.clientId);
    const verdict = await applyServerRow(conflict.current, ctx);
    if (String(meta.kinds[conflict.clientId] || '').startsWith('purge')) {
      summary.conflicts.push({ noteId: verdict.localId, resolution: 'purge-dropped' });
    } else if (verdict.action === 'update' || verdict.action === 'stale') {
      summary.conflicts.push({ noteId: verdict.localId, resolution: 'converged' });
    }
  }
  for (const row of res.changes || []) {
    const dedupeKey = `${row.id}:${row.revision}`;
    if (ctx.seen.has(dedupeKey)) continue;
    ctx.seen.add(dedupeKey);
    await applyServerRow(row, ctx);
  }
  advanceCursor(state, res.cursor);
}

function emptySummary(apiUrl, dryRun) {
  return {
    ok: true,
    dryRun,
    apiUrl,
    pushed: { created: 0, updated: 0, purged: 0 },
    pulled: { created: 0, updated: 0, purged: 0 },
    conflicts: [],
    errors: [],
    skippedStale: 0,
    batches: 0,
    pullRounds: 0,
    resumed: false,
    cursor: '',
  };
}

export function summaryLine(summary) {
  const pushed = summary.pushed;
  const pulled = summary.pulled;
  const keptBoth = summary.conflicts.filter(c => c.resolution === 'kept-both').length;
  const parts = [
    `Pushed ${pushed.created + pushed.updated + pushed.purged} (${pushed.created} new, ${pushed.updated} updated, ${pushed.purged} purged)`,
    `Pulled ${pulled.created + pulled.updated + pulled.purged} (${pulled.created} new, ${pulled.updated} updated, ${pulled.purged} purged)`,
    `Conflicts ${summary.conflicts.length}${keptBoth ? ` (${keptBoth} kept both)` : ''}`,
  ];
  if (summary.errors?.length) parts.push(`Skipped ${summary.errors.length} too large`);
  if (summary.resumed) parts.push('resumed 1 pending batch');
  return (summary.dryRun ? '[dry-run] ' : '') + parts.join(' · ');
}

export async function runSync(options = {}) {
  const root = options.root || dataRoot();
  const client = options.client || await createClient(options.overrides || {});
  const retryDelayMs = options.retryDelayMs ?? 1500;
  const pageSize = options.pageSize ?? 100;
  const dryRun = !!options.dryRun;
  const now = options.now || (() => new Date().toISOString());

  if (!client.config.apiKey && !client.config.token) {
    throw new PersonalNotesApiError('Not signed in. Run: personalnotes auth device', { status: 401, code: 'unauthorized' });
  }

  const state = await loadSyncState(root, client.config.apiUrl);
  const summary = emptySummary(client.config.apiUrl, dryRun);
  const localNotes = new Map((await loadNotes(root)).map(note => [note.id, note]));

  if (dryRun) {
    // Preview only: one pull probe (no writes, no state change) + push plan.
    const res = await client.sync({ items: [], cursor: overlapRewindCursor(state.cursor) });
    for (const row of res.changes || []) {
      const { action } = classifyRow(row, state, localNotes);
      if (action === 'stale' || action === 'stale-tombstone') summary.skippedStale += 1;
      else if (action === 'create') summary.pulled.created += 1;
      else if (action === 'update') summary.pulled.updated += 1;
      else if (action === 'purge' || action === 'tombstone') summary.pulled.purged += 1;
      else summary.conflicts.push({ noteId: localIdForRow(state, row), resolution: 'kept-both' });
    }
    for (const op of buildPushOps(state, localNotes, now)) {
      summary.pushed[op.kind === 'create' ? 'created' : op.kind.startsWith('purge') ? 'purged' : 'updated'] += 1;
    }
    summary.resumed = !!state.pending;
    summary.cursor = state.cursor;
    return summary;
  }

  const ctx = { state, root, localNotes, summary, now, seen: new Set() };

  // 0. Resume: a pending batch means we crashed after persisting the key but
  // possibly after the server applied it. Resend the exact body with the same
  // key — the server either applies it now or replays the stored response.
  // Exception: a 413 means the server never applied it and never will; drop
  // the poisoned batch (the notes are still in the canonical store and get
  // re-planned by the push rounds below) instead of resending it head-of-line
  // on every run, which would wedge the device permanently.
  if (state.pending) {
    const { idempotencyKey, body, meta } = state.pending;
    try {
      const res = await sendWithRetry(client, body, idempotencyKey, { retryDelayMs });
      await processBatchResponse(res, meta, ctx);
      summary.batches += 1;
    } catch (err) {
      if (!isPayloadTooLarge(err)) throw err;
      summary.errors.push({ code: 'payload_too_large', message: 'dropped a pending batch the server rejected as too large (413)' });
    }
    state.pending = null;
    summary.resumed = true;
    await saveSyncState(state, root);
  }

  // 1. Pull-drain first: fresh server revisions minimize push conflicts.
  for (let round = 0; round < MAX_PULL_ROUNDS; round += 1) {
    const res = await sendWithRetry(client, { items: [], cursor: overlapRewindCursor(state.cursor) }, randomUUID(), { retryDelayMs });
    await processBatchResponse(res, { revs: {}, hashes: {}, kinds: {} }, ctx);
    summary.pullRounds += 1;
    await saveSyncState(state, root);
    const more = res.hasMore === true || (res.changes || []).length >= pageSize;
    if (!more) break;
  }

  // 2. Push rounds: dirty notes + local purges; conflict copies created while
  // processing responses become first-creates in the next round.
  const reportedOversized = new Set();
  for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
    const ops = buildPushOps(state, localNotes, now);
    const { batches, oversized } = chunkOps(ops);
    for (const op of oversized) {
      if (reportedOversized.has(op.clientId)) continue;
      reportedOversized.add(op.clientId);
      summary.errors.push({
        noteId: op.clientId,
        code: 'oversized_note',
        bytes: op.bytes,
        message: `note ${op.clientId} serializes to ${op.bytes} bytes — over the server sync cap; not pushed`,
      });
    }
    if (!batches.length) break;
    for (const batch of batches) {
      const body = { items: batch.items, cursor: overlapRewindCursor(state.cursor) };
      const idempotencyKey = randomUUID();
      state.pending = { idempotencyKey, body, meta: batch.meta };
      await saveSyncState(state, root);
      try {
        const res = await sendWithRetry(client, body, idempotencyKey, { retryDelayMs });
        await processBatchResponse(res, batch.meta, ctx);
        summary.batches += 1;
      } catch (err) {
        // Same 413 rule as the resume path: never leave (or re-send) a batch
        // the server can only ever reject — that would poison every later run.
        if (!isPayloadTooLarge(err)) throw err;
        summary.errors.push({ code: 'payload_too_large', message: 'server rejected a sync batch as too large (413); batch dropped' });
      }
      state.pending = null;
      await saveSyncState(state, root);
    }
  }

  summary.cursor = state.cursor;
  return summary;
}
