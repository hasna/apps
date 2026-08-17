// PersonalNotes self-hosted server — notes CRUD, sync, export.
// Implements the personalnotes/v1 dialect (§3-§7 of the sync protocol
// contract) plus the S2 superset: per-tenant monotonic `seq` cursor with
// `hasMore` (fixes gate doc GAP-4/GAP-5), list pagination (GAP-6), purge
// tombstones (GAP-1) and restore/archive audit events (GAP-2).

import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './http.mjs';
import { nextSeq, currentSeq, nowIso } from './db.mjs';

export const SYNC_MAX_ITEMS = 100;
export const SYNC_MAX_BYTES = 2 * 1024 * 1024;
// Backward-compat window applied when a client hands us a wall-clock cursor.
// PLATFORM-GAP (GAP-5, gate doc /tmp/pn-sync-protocol.md §0/§6.1): the hosted
// platform's cursor is server wall-clock `updatedAt`, which can skip rows
// committed out of timestamp order. The dialect therefore requires S2 to
// accept ISO cursors as an overlap-rewound timestamp filter before switching
// the client to the lossless seq cursor.
const ISO_CURSOR_REWIND_MS = 5000;

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function noteHash({ title, bodyMarkdown, frontmatterJson }) {
  return hash(JSON.stringify({ title: title ?? 'Untitled', bodyMarkdown: bodyMarkdown ?? '', frontmatterJson: frontmatterJson ?? {} }));
}

function cleanLabels(labels) {
  return [...new Set((labels ?? []).map((label) => String(label).trim()).filter(Boolean))].slice(0, 50);
}

/** DB row (snake_case) → wire Note (camelCase, dialect §3 + seq/purgedAt superset). */
export function serializeNote(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientId: row.client_id,
    slug: row.slug,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    frontmatterJson: JSON.parse(row.frontmatter_json),
    folder: row.folder,
    labels: JSON.parse(row.labels),
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    revision: row.revision,
    seq: row.seq,
    contentHash: row.content_hash,
    source: row.source,
    agentProvenanceJson: JSON.parse(row.agent_provenance_json),
    deletedAt: row.deleted_at,
    purgedAt: row.purged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function logEvent(db, { tenantId, noteId = null, actor, action, metadata = {} }) {
  db.query('INSERT INTO note_events (id, tenant_id, note_id, actor_type, actor_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(), tenantId, noteId, actor.type, actor.id, action, JSON.stringify(metadata), nowIso(),
  );
}

function getRow(db, tenantId, id) {
  return db.query('SELECT * FROM notes WHERE tenant_id = ? AND id = ?').get(tenantId, id) ?? null;
}

function getRowByClientId(db, tenantId, clientId) {
  return db.query('SELECT * FROM notes WHERE tenant_id = ? AND client_id = ?').get(tenantId, clientId) ?? null;
}

function insertRow(db, tenantId, input, { source }) {
  const title = input.title?.trim() || 'Untitled';
  const bodyMarkdown = input.bodyMarkdown ?? '';
  const frontmatterJson = input.frontmatterJson ?? {};
  const now = nowIso();
  const id = randomUUID();
  db.query(
    `INSERT INTO notes (id, tenant_id, client_id, slug, title, body_markdown, frontmatter_json, folder, labels,
       pinned, archived, revision, seq, content_hash, source, agent_provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, tenantId, input.clientId ?? null, input.slug ?? null, title, bodyMarkdown, JSON.stringify(frontmatterJson),
    input.folder ?? null, JSON.stringify(cleanLabels(input.labels)), input.pinned ? 1 : 0, input.archived ? 1 : 0,
    nextSeq(db, tenantId),
    input.contentHash ?? noteHash({ title, bodyMarkdown, frontmatterJson }),
    input.source ?? source, JSON.stringify(input.agentProvenanceJson ?? {}), now, now,
  );
  return getRow(db, tenantId, id);
}

/**
 * Field-wise merge update shared by PATCH and sync upsert (dialect §4/§5.2
 * step 3): absent fields keep current values; `folder` uses `=== undefined`
 * so an explicit null clears it; revision +1; seq restamped; updatedAt = now.
 */
function updateRow(db, tenantId, current, input, { restore = false, keepContentHash = false } = {}) {
  const title = input.title?.trim() || current.title;
  const bodyMarkdown = input.bodyMarkdown ?? current.body_markdown;
  const frontmatterJson = input.frontmatterJson ?? JSON.parse(current.frontmatter_json);
  const contentHash = keepContentHash && input.contentHash !== undefined ? input.contentHash : noteHash({ title, bodyMarkdown, frontmatterJson });
  db.query(
    `UPDATE notes SET slug = ?, title = ?, body_markdown = ?, frontmatter_json = ?, folder = ?, labels = ?,
       pinned = ?, archived = ?, source = ?, agent_provenance_json = ?, content_hash = ?,
       revision = revision + 1, seq = ?, updated_at = ?${restore ? ', deleted_at = NULL, purged_at = NULL' : ''}
     WHERE tenant_id = ? AND id = ?`,
  ).run(
    input.slug ?? current.slug, title, bodyMarkdown, JSON.stringify(frontmatterJson),
    input.folder === undefined ? current.folder : input.folder,
    input.labels ? JSON.stringify(cleanLabels(input.labels)) : current.labels,
    (input.pinned ?? Boolean(current.pinned)) ? 1 : 0,
    (input.archived ?? Boolean(current.archived)) ? 1 : 0,
    input.source ?? current.source,
    JSON.stringify(input.agentProvenanceJson ?? JSON.parse(current.agent_provenance_json)),
    contentHash, nextSeq(db, tenantId), nowIso(), tenantId, current.id,
  );
  return getRow(db, tenantId, current.id);
}

function emitTransitionEvents(db, tenantId, before, after, actor) {
  // S2 dialect superset (§7, gate doc GAP-2): the platform has no
  // restore/archive event kinds; S2 records them in its audit feed.
  if (before.deleted_at && !after.deleted_at) logEvent(db, { tenantId, noteId: after.id, actor, action: 'note.restored' });
  if (!before.archived && after.archived) logEvent(db, { tenantId, noteId: after.id, actor, action: 'note.archived' });
  if (before.archived && !after.archived) logEvent(db, { tenantId, noteId: after.id, actor, action: 'note.unarchived' });
}

// --- CRUD (dialect §4) -------------------------------------------------------

export function listNotes(db, tenantId, { limit, includeDeleted, cursor }) {
  // Base dialect orders by updatedAt DESC with no pagination.
  // PLATFORM-GAP (GAP-6): a tenant with >200 notes cannot be enumerated on
  // the hosted platform. S2 superset: opaque `cursor` pages by seq DESC
  // (identical ordering — seq and updatedAt advance together server-side)
  // and returns nextCursor.
  const cursorSeq = parseSeqCursor(cursor);
  const conditions = ['tenant_id = ?'];
  const params = [tenantId];
  if (!includeDeleted) conditions.push('deleted_at IS NULL');
  if (cursorSeq !== null) {
    conditions.push('seq < ?');
    params.push(cursorSeq);
  }
  const rows = db
    .query(`SELECT * FROM notes WHERE ${conditions.join(' AND ')} ORDER BY seq DESC LIMIT ?`)
    .all(...params, limit + 1);
  const page = rows.slice(0, limit);
  return {
    data: page.map(serializeNote),
    nextCursor: rows.length > limit ? `s:${page[page.length - 1].seq}` : null,
  };
}

export function getNote(db, tenantId, id) {
  const row = getRow(db, tenantId, id);
  // PLATFORM-GAP (GAP-2): the dialect 404s soft-deleted notes here, which is
  // what makes REST restore impossible — restore only exists as a sync upsert.
  if (!row || row.deleted_at) throw new ApiError('not_found', 'note not found', 404);
  return serializeNote(row);
}

export function createNote(db, tenantId, input, actor) {
  const row = insertRow(db, tenantId, { ...input, contentHash: undefined }, { source: 'hosted' });
  logEvent(db, { tenantId, noteId: row.id, actor, action: 'note.created', metadata: { source: input.source ?? 'hosted' } });
  return serializeNote(row);
}

export function updateNote(db, tenantId, id, input, actor) {
  const current = getRow(db, tenantId, id);
  if (!current || current.deleted_at) throw new ApiError('not_found', 'note not found', 404);
  // Dialect §4: PATCH has no optimistic-concurrency check — last write wins
  // in server arrival order. baseRevision guards exist only on /sync items.
  const updated = updateRow(db, tenantId, current, input);
  logEvent(db, { tenantId, noteId: id, actor, action: 'note.updated' });
  emitTransitionEvents(db, tenantId, current, updated, actor);
  return serializeNote(updated);
}

export function deleteNote(db, tenantId, id, actor) {
  const current = getRow(db, tenantId, id);
  if (!current) throw new ApiError('not_found', 'note not found', 404);
  // PLATFORM-GAP (GAP-1): DELETE is soft-only; the full content keeps being
  // served in sync `changes` until the client purges via the sync superset.
  db.query('UPDATE notes SET deleted_at = ?, revision = revision + 1, seq = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(
    nowIso(), nextSeq(db, tenantId), nowIso(), tenantId, id,
  );
  const row = getRow(db, tenantId, id);
  logEvent(db, { tenantId, noteId: id, actor, action: 'note.deleted' });
  return { deleted: true, id: row.id, revision: row.revision };
}

export function exportNotes(db, tenantId) {
  const rows = db.query('SELECT * FROM notes WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, seq DESC').all(tenantId);
  return { exportId: randomUUID(), notes: rows.map(serializeNote) };
}

// --- sync (dialect §5 + §6.2 superset) ----------------------------------------

function parseSeqCursor(cursor) {
  const m = /^s:(\d+)$/.exec(String(cursor ?? ''));
  return m ? Number(m[1]) : null;
}

function pullChanges(db, tenantId, cursor) {
  const seqCursor = parseSeqCursor(cursor);
  let rows;
  if (seqCursor !== null) {
    rows = db
      .query('SELECT * FROM notes WHERE tenant_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(tenantId, seqCursor, SYNC_MAX_ITEMS + 1);
  } else {
    // ISO-timestamp cursor (hosted-platform shape) or empty/invalid cursor.
    // PLATFORM-GAP (GAP-4/GAP-5): the hosted feed is `updatedAt > cursor`
    // capped at 100 DESC with cursor = now(), which silently loses rows.
    // Backward-compat here: rewind the timestamp by 5s, filter on
    // updatedAt/deletedAt, but order by seq ASC and hand back a seq cursor so
    // the client is upgraded to lossless paging after one round-trip.
    const parsed = cursor ? Date.parse(cursor) : 0;
    const since = Number.isNaN(parsed) ? new Date(0).toISOString() : new Date(Math.max(0, parsed - ISO_CURSOR_REWIND_MS)).toISOString();
    rows = db
      .query('SELECT * FROM notes WHERE tenant_id = ? AND (updated_at > ? OR (deleted_at IS NOT NULL AND deleted_at > ?)) ORDER BY seq ASC LIMIT ?')
      .all(tenantId, since, since, SYNC_MAX_ITEMS + 1);
  }
  const hasMore = rows.length > SYNC_MAX_ITEMS;
  const page = rows.slice(0, SYNC_MAX_ITEMS);
  const lastSeq = page.length ? page[page.length - 1].seq : (seqCursor ?? currentSeq(db, tenantId));
  return { changes: page.map(serializeNote), cursor: `s:${lastSeq}`, hasMore };
}

export function syncNotes(db, tenantId, input, idempotencyKey, actor) {
  if (!idempotencyKey) throw new ApiError('bad_request', 'Idempotency-Key header is required', 400);
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > SYNC_MAX_BYTES) {
    throw new ApiError('payload_too_large', 'sync body exceeds configured size limit', 413);
  }
  if (!Array.isArray(input.items) || input.items.length > SYNC_MAX_ITEMS) {
    throw new ApiError('bad_request', `sync supports at most ${SYNC_MAX_ITEMS} items`, 400);
  }
  const requestHash = hash(JSON.stringify(input));

  // Idempotency (§5.4): same key + same body → verbatim replay of the stored
  // response (including the ORIGINAL cursor/changes snapshot — dialect-
  // mandated); same key + different body → 409 idempotency_conflict;
  // concurrent duplicates → unique-index race → generic 409 conflict
  // (mapped in http.mjs). Keys are per tenant and never expire.
  const existing = db.query('SELECT * FROM sync_batches WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1').get(tenantId, idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ApiError('idempotency_conflict', 'Idempotency-Key was already used for a different sync request', 409);
    }
    return JSON.parse(existing.response_json);
  }

  const apply = db.transaction(() => {
    const applied = [];
    const conflicts = [];
    for (const item of input.items) {
      if (!item.clientId) throw new ApiError('bad_request', 'sync item clientId is required', 400);
      const current = getRowByClientId(db, tenantId, item.clientId);
      // §5.2 step 1: optimistic-concurrency guard.
      if (current && item.baseRevision !== undefined && current.revision !== item.baseRevision) {
        conflicts.push({ clientId: item.clientId, id: current.id, current: serializeNote(current) });
        continue;
      }
      if (item.purged) {
        // S2 dialect superset (§7). PLATFORM-GAP (GAP-1): the hosted platform
        // has no purge — deleted content keeps flowing in `changes` forever.
        // Here: scrub content, keep only a tombstone that still propagates.
        if (current) {
          const now = nowIso();
          db.query(
            `UPDATE notes SET title = '', body_markdown = '', frontmatter_json = '{}', labels = '[]',
               content_hash = ?, deleted_at = COALESCE(deleted_at, ?), purged_at = ?,
               revision = revision + 1, seq = ?, updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
          ).run(noteHash({ title: '', bodyMarkdown: '', frontmatterJson: {} }), now, now, nextSeq(db, tenantId), now, tenantId, current.id);
          const purged = getRow(db, tenantId, current.id);
          logEvent(db, { tenantId, noteId: current.id, actor, action: 'note.purged' });
          applied.push({ clientId: item.clientId, id: purged.id, revision: purged.revision, deleted: true, purged: true });
        }
        // PLATFORM-GAP (GAP-1, same as delete below): purging a never-seen
        // clientId is silently ignored — the dialect creates no tombstone
        // for notes the server never had.
        continue;
      }
      if (item.deleted) {
        // §5.2 step 2: tombstone push. A delete for a clientId the server has
        // never seen is silently ignored (dialect-mandated; no tombstone row
        // is fabricated).
        if (current) {
          const now = nowIso();
          db.query('UPDATE notes SET deleted_at = ?, revision = revision + 1, seq = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(
            now, nextSeq(db, tenantId), now, tenantId, current.id,
          );
          const deleted = getRow(db, tenantId, current.id);
          applied.push({ clientId: item.clientId, id: deleted.id, revision: deleted.revision, deleted: true });
        }
        continue;
      }
      if (current) {
        // §5.2 step 3: upsert merge. PLATFORM-GAP (GAP-2): clearing deletedAt
        // here is the ONLY restore path in the dialect (no REST restore);
        // S2 additionally emits note.restored.
        const updated = updateRow(db, tenantId, current, item, { restore: true, keepContentHash: true });
        emitTransitionEvents(db, tenantId, current, updated, actor);
        applied.push({ clientId: item.clientId, id: updated.id, revision: updated.revision });
      } else {
        const created = insertRow(db, tenantId, item, { source: 'local' });
        applied.push({ clientId: item.clientId, id: created.id, revision: created.revision });
      }
    }

    const pull = pullChanges(db, tenantId, input.cursor);
    const response = { applied, conflicts, cursor: pull.cursor, changes: pull.changes, hasMore: pull.hasMore };
    db.query('INSERT INTO sync_batches (id, tenant_id, idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(), tenantId, idempotencyKey, requestHash, JSON.stringify(response), nowIso(),
    );
    logEvent(db, { tenantId, actor, action: 'notes.synced', metadata: { applied: applied.length, conflicts: conflicts.length } });
    return response;
  });
  return apply();
}
