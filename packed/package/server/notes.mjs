// Hasna Notes self-hosted server — notes CRUD, export.
// Implements the personalnotes/v1 dialect (§3-§7 of the protocol contract)
// plus the S2 superset: per-tenant monotonic `seq` cursor with `hasMore`
// (fixes gate doc GAP-4/GAP-5), list pagination (GAP-6), purge tombstones
// (GAP-1) and restore/archive audit events (GAP-2).

import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './http.mjs';
import { nextSeq, nowIso } from './sql.mjs';

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

async function logEvent(db, { tenantId, noteId = null, actor, action, metadata = {} }) {
  await db.query('INSERT INTO note_events (id, tenant_id, note_id, actor_type, actor_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(), tenantId, noteId, actor.type, actor.id, action, JSON.stringify(metadata), nowIso(),
  );
}

async function getRow(db, tenantId, id) {
  return (await db.query('SELECT * FROM notes WHERE tenant_id = ? AND id = ?').get(tenantId, id)) ?? null;
}

async function getRowByClientId(db, tenantId, clientId) {
  return (await db.query('SELECT * FROM notes WHERE tenant_id = ? AND client_id = ?').get(tenantId, clientId)) ?? null;
}

async function insertRow(db, tenantId, input, { source }) {
  const title = input.title?.trim() || 'Untitled';
  const bodyMarkdown = input.bodyMarkdown ?? '';
  const frontmatterJson = input.frontmatterJson ?? {};
  const now = nowIso();
  const id = randomUUID();
  await db.query(
    `INSERT INTO notes (id, tenant_id, client_id, slug, title, body_markdown, frontmatter_json, folder, labels,
       pinned, archived, revision, seq, content_hash, source, agent_provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, tenantId, input.clientId ?? null, input.slug ?? null, title, bodyMarkdown, JSON.stringify(frontmatterJson),
    input.folder ?? null, JSON.stringify(cleanLabels(input.labels)), input.pinned ? 1 : 0, input.archived ? 1 : 0,
    await nextSeq(db, tenantId),
    input.contentHash ?? noteHash({ title, bodyMarkdown, frontmatterJson }),
    input.source ?? source, JSON.stringify(input.agentProvenanceJson ?? {}), now, now,
  );
  return getRow(db, tenantId, id);
}

/**
 * Field-wise merge update (dialect §4): absent fields keep current values;
 * `folder` uses `=== undefined` so an explicit null clears it; revision +1;
 * seq restamped; updatedAt = now.
 */
async function updateRow(db, tenantId, current, input, { restore = false, keepContentHash = false } = {}) {
  const title = input.title?.trim() || current.title;
  const bodyMarkdown = input.bodyMarkdown ?? current.body_markdown;
  const frontmatterJson = input.frontmatterJson ?? JSON.parse(current.frontmatter_json);
  const contentHash = keepContentHash && input.contentHash !== undefined ? input.contentHash : noteHash({ title, bodyMarkdown, frontmatterJson });
  await db.query(
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
    contentHash, await nextSeq(db, tenantId), nowIso(), tenantId, current.id,
  );
  return getRow(db, tenantId, current.id);
}

async function emitTransitionEvents(db, tenantId, before, after, actor) {
  // S2 dialect superset (§7, gate doc GAP-2): the platform has no
  // restore/archive event kinds; S2 records them in its audit feed.
  if (before.deleted_at && !after.deleted_at) await logEvent(db, { tenantId, noteId: after.id, actor, action: 'note.restored' });
  if (!before.archived && after.archived) await logEvent(db, { tenantId, noteId: after.id, actor, action: 'note.archived' });
  if (before.archived && !after.archived) await logEvent(db, { tenantId, noteId: after.id, actor, action: 'note.unarchived' });
}

// --- CRUD (dialect §4) -------------------------------------------------------

export async function listNotes(db, tenantId, { limit, includeDeleted, cursor }) {
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
  const rows = await db
    .query(`SELECT * FROM notes WHERE ${conditions.join(' AND ')} ORDER BY seq DESC LIMIT ?`)
    .all(...params, limit + 1);
  const page = rows.slice(0, limit);
  return {
    data: page.map(serializeNote),
    nextCursor: rows.length > limit ? `s:${page[page.length - 1].seq}` : null,
  };
}

export async function getNote(db, tenantId, id) {
  const row = await getRow(db, tenantId, id);
  // PLATFORM-GAP (GAP-2): the dialect 404s soft-deleted notes here, which is
  // what makes REST restore impossible.
  if (!row || row.deleted_at) throw new ApiError('not_found', 'note not found', 404);
  return serializeNote(row);
}

export async function createNote(db, tenantId, input, actor) {
  const row = await insertRow(db, tenantId, { ...input, contentHash: undefined }, { source: 'hosted' });
  await logEvent(db, { tenantId, noteId: row.id, actor, action: 'note.created', metadata: { source: input.source ?? 'hosted' } });
  return serializeNote(row);
}

export async function updateNote(db, tenantId, id, input, actor) {
  const current = await getRow(db, tenantId, id);
  if (!current) throw new ApiError('not_found', 'note not found', 404);
  // Dialect §4: PATCH has no optimistic-concurrency check — last write wins
  // in server arrival order. baseRevision guards exist only on /sync items.
  //
  // REST restore (closes PLATFORM-GAP GAP-2): a PATCH to a soft-deleted note
  // clears the delete tombstone and brings the note back (the `restore` path
  // of updateRow, which `emitTransitionEvents` already logs as note.restored).
  // Cloud-only clients (the macOS app) trash and restore through this one
  // last-write-wins surface; without it, a trashed note can never come back.
  const restoring = Boolean(current.deleted_at);
  const updated = await updateRow(db, tenantId, current, input, { restore: restoring });
  await logEvent(db, { tenantId, noteId: id, actor, action: restoring ? 'note.restored' : 'note.updated' });
  await emitTransitionEvents(db, tenantId, current, updated, actor);
  return serializeNote(updated);
}

export async function deleteNote(db, tenantId, id, actor) {
  const current = await getRow(db, tenantId, id);
  if (!current) throw new ApiError('not_found', 'note not found', 404);
  // PLATFORM-GAP (GAP-1): DELETE is soft-only; a deleted row still answers
  // the list feed until the client purges via the dialect superset.
  await db.query('UPDATE notes SET deleted_at = ?, revision = revision + 1, seq = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(
    nowIso(), await nextSeq(db, tenantId), nowIso(), tenantId, id,
  );
  const row = await getRow(db, tenantId, id);
  await logEvent(db, { tenantId, noteId: id, actor, action: 'note.deleted' });
  return { deleted: true, id: row.id, revision: row.revision };
}

export async function exportNotes(db, tenantId) {
  const rows = await db.query('SELECT * FROM notes WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, seq DESC').all(tenantId);
  return { exportId: randomUUID(), notes: rows.map(serializeNote) };
}

// --- cursor paging (dialect superset) -----------------------------------------

function parseSeqCursor(cursor) {
  const m = /^s:(\d+)$/.exec(String(cursor ?? ''));
  return m ? Number(m[1]) : null;
}
