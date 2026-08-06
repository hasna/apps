import { randomUUID } from 'node:crypto';
import { open, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DurableEventSpool } from '@hasna/events/durable-spool';

export const NOTES_EVENT_SOURCE = 'notes';
export const NOTE_CREATED_EVENT_TYPE = 'note.created';
export const NOTES_EVENT_SCHEMA_VERSION = 'notes.v1';

const NOTES_EVENTS_STATE_VERSION = 1;
const EVENTS_DIR = 'events';
const NOTES_STATE_DIR = 'notes-note-created';
const INTENTS_DIR = 'intents';
const SEEN_DIR = 'seen';
const BASELINE_FILE = 'baseline-v1.json';
const STATUS_FILE = 'status.json';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalNoteId(value) {
  const noteId = String(value || '').toLowerCase();
  if (!UUID_RE.test(noteId)) throw new Error('invalid_note_id');
  return noteId;
}

export function notesEventsDataDir(root) {
  return join(root, EVENTS_DIR);
}

export function notesCreatedStateDir(root) {
  return join(notesEventsDataDir(root), NOTES_STATE_DIR);
}

export function noteCreatedEventId(noteId) {
  return `notes:note:${canonicalNoteId(noteId)}:created`;
}

export function noteCreatedEvent(note) {
  const noteId = canonicalNoteId(note?.id);
  const createdAt = String(note?.createdAt || '');
  const originMachine = String(note?.machine || 'unknown');
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) throw new Error('note_created_at_required');
  const identity = noteCreatedEventId(noteId);
  return {
    id: identity,
    source: NOTES_EVENT_SOURCE,
    type: NOTE_CREATED_EVENT_TYPE,
    time: createdAt,
    subject: `note:${noteId}`,
    severity: 'info',
    data: { noteId, createdAt, originMachine },
    dedupeKey: identity,
    schemaVersion: NOTES_EVENT_SCHEMA_VERSION,
    metadata: {},
  };
}

function intentDir(root) {
  return join(notesCreatedStateDir(root), INTENTS_DIR);
}

function seenDir(root) {
  return join(notesCreatedStateDir(root), SEEN_DIR);
}

function intentPath(root, noteId) {
  return join(intentDir(root), `${canonicalNoteId(noteId)}.json`);
}

function seenPath(root, noteId) {
  return join(seenDir(root), canonicalNoteId(noteId));
}

function baselinePath(root) {
  return join(notesCreatedStateDir(root), BASELINE_FILE);
}

function statusPath(root) {
  return join(notesCreatedStateDir(root), STATUS_FILE);
}

async function fsyncDirectory(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(path, value) {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.tmp-${process.pid}-${randomUUID()}`);
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
    await fsyncDirectory(dir);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function markSeen(root, noteId) {
  const dir = seenDir(root);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = seenPath(root, noteId);
  const handle = await open(path, 'wx', 0o600).catch((error) => {
    if (error?.code === 'EEXIST') return null;
    throw error;
  });
  if (!handle) return false;
  try {
    await handle.writeFile('');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsyncDirectory(dir);
  return true;
}

async function hasSeen(root, noteId) {
  try {
    const handle = await open(seenPath(root, noteId), 'r');
    await handle.close();
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasBaseline(root) {
  let raw;
  try {
    raw = await readFile(baselinePath(root), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('invalid_note_events_baseline');
  }
  if (value?.version !== NOTES_EVENTS_STATE_VERSION) throw new Error('invalid_note_events_baseline');
  return true;
}

async function writeBaseline(root) {
  await atomicWrite(baselinePath(root), JSON.stringify({
    version: NOTES_EVENTS_STATE_VERSION,
    establishedAt: new Date().toISOString(),
  }) + '\n');
}

export async function beginNoteCreatedIntent(note, root) {
  const event = noteCreatedEvent(note);
  await atomicWrite(intentPath(root, event.data.noteId), JSON.stringify(event) + '\n');
  return event;
}

export async function cancelNoteCreatedIntent(noteId, root) {
  const path = intentPath(root, noteId);
  await rm(path, { force: true });
  await fsyncDirectory(dirname(path)).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

async function publishEvent(event, root, spool = new DurableEventSpool({ dataDir: notesEventsDataDir(root) })) {
  const result = await spool.enqueue(event);
  await markSeen(root, event.data.noteId);
  await cancelNoteCreatedIntent(event.data.noteId, root);
  return result;
}

export async function commitNoteCreatedIntent(note, root, options = {}) {
  const event = noteCreatedEvent(note);
  try {
    const result = await publishEvent(event, root, options.spool);
    return { ok: true, pending: false, ...result };
  } catch (error) {
    // The note is already durably saved. Keep the pre-save intent so startup or
    // post-sync reconciliation can enqueue the same stable identity later.
    return { ok: false, pending: true, error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadIntents(root) {
  const dir = intentDir(root);
  const names = await readdir(dir).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const events = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const event = JSON.parse(await readFile(join(dir, name), 'utf8'));
      if (event?.source === NOTES_EVENT_SOURCE && event?.type === NOTE_CREATED_EVENT_TYPE) events.push(event);
    } catch {
      // Leave malformed intent files for explicit operator inspection. They
      // must never make reconciliation spin or expose their contents in logs.
    }
  }
  return events;
}

async function reconcile(notes, root, options = {}) {
  const spool = options.spool ?? new DurableEventSpool({ dataDir: notesEventsDataDir(root) });
  const recovery = await spool.recover();
  const byId = new Map((notes || []).map((note) => [String(note.id).toLowerCase(), note]));
  const intents = await loadIntents(root);
  let enqueued = 0;
  let deduped = 0;
  let baseline = false;

  // Intents are written and fsynced before a create save. If the note exists,
  // the save committed and must be enqueued even during first-run baselining.
  for (const intent of intents) {
    const note = byId.get(String(intent?.data?.noteId || '').toLowerCase());
    if (!note) continue;
    const result = await publishEvent(noteCreatedEvent(note), root, spool);
    if (result.deduped) deduped += 1;
    else enqueued += 1;
  }

  if (!(await hasBaseline(root))) {
    // A clean first run records historical notes without emitting them. Any
    // crash-surviving create intent was handled above and remains an event.
    for (const note of byId.values()) await markSeen(root, note.id);
    await writeBaseline(root);
    baseline = true;
  } else {
    for (const note of byId.values()) {
      if (await hasSeen(root, note.id)) continue;
      const result = await publishEvent(noteCreatedEvent(note), root, spool);
      if (result.deduped) deduped += 1;
      else enqueued += 1;
    }
  }

  return { baseline, enqueued, deduped, recovery };
}

function errorCode(error) {
  const raw = String(error?.code || error?.message || error?.name || 'reconciliation_failed');
  return /^[a-z0-9_.-]{1,80}$/i.test(raw) ? raw : 'reconciliation_failed';
}

async function writeStatus(root, value) {
  await atomicWrite(statusPath(root), JSON.stringify({ version: 1, ...value }) + '\n');
}

export async function reconcileNoteCreatedEvents(notes, root, options = {}) {
  try {
    const result = await reconcile(notes, root, options);
    await writeStatus(root, {
      status: 'ok',
      checkedAt: new Date().toISOString(),
      baseline: result.baseline,
      enqueued: result.enqueued,
      deduped: result.deduped,
      errorCode: '',
    });
    return result;
  } catch (error) {
    await writeStatus(root, {
      status: 'error',
      checkedAt: new Date().toISOString(),
      errorCode: errorCode(error),
    }).catch(() => {});
    throw error;
  }
}

async function countFiles(path, accept = () => true) {
  const names = await readdir(path).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  return names.filter(accept).length;
}

export async function notesEventsStatus(root) {
  let status = { version: 1, status: 'never', checkedAt: '', errorCode: '' };
  try {
    const stored = JSON.parse(await readFile(statusPath(root), 'utf8'));
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const checkedAt = typeof stored.checkedAt === 'string'
        && stored.checkedAt.length <= 40
        && !Number.isNaN(Date.parse(stored.checkedAt))
        ? stored.checkedAt
        : '';
      status = {
        version: 1,
        status: ['ok', 'error'].includes(stored.status) ? stored.status : 'error',
        checkedAt,
        errorCode: typeof stored.errorCode === 'string' && /^[a-z0-9_.-]{0,80}$/i.test(stored.errorCode)
          ? stored.errorCode
          : 'invalid_status',
        ...(typeof stored.baseline === 'boolean' ? { baselineRun: stored.baseline } : {}),
        ...(Number.isSafeInteger(stored.enqueued) && stored.enqueued >= 0 ? { lastEnqueued: stored.enqueued } : {}),
        ...(Number.isSafeInteger(stored.deduped) && stored.deduped >= 0 ? { lastDeduped: stored.deduped } : {}),
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') status = { ...status, status: 'error', errorCode: 'invalid_status' };
  }
  let baseline = false;
  let baselineState = 'absent';
  try {
    baseline = await hasBaseline(root);
    baselineState = baseline ? 'ready' : 'absent';
  } catch {
    baselineState = 'invalid';
  }
  return {
    ...status,
    baseline,
    baselineState,
    pendingIntents: await countFiles(intentDir(root), (name) => name.endsWith('.json')),
    seenNotes: await countFiles(seenDir(root), (name) => UUID_RE.test(name)),
    spooledEvents: await countFiles(join(notesEventsDataDir(root), 'spool', 'inbox'), (name) => /^[a-f0-9]{64}\.json$/.test(name)),
  };
}

export function notesCreatedWebhookChannel({
  id = 'notes-note-created-webhook',
  url,
  secretRef,
  enabled = false,
  timeoutMs = 15_000,
} = {}) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { throw new Error('invalid_webhook_url'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_webhook_url');
  if (parsed.username || parsed.password) throw new Error('invalid_webhook_url');
  for (const name of parsed.searchParams.keys()) {
    if (/authorization|cookie|api[-_]?key|token|secret|credential|signature/i.test(name)) {
      throw new Error('invalid_webhook_url');
    }
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol !== 'https:' && !loopback) throw new Error('insecure_webhook_url');
  if (!/^env:[A-Z_][A-Z0-9_]*$/.test(String(secretRef || ''))) throw new Error('invalid_webhook_secret_ref');
  return {
    id,
    name: 'Notes note.created webhook',
    enabled: enabled === true,
    transport: 'webhook',
    filters: [{ source: NOTES_EVENT_SOURCE, type: NOTE_CREATED_EVENT_TYPE }],
    webhook: { url: parsed.toString(), secretRef, timeoutMs },
    retry: { maxAttempts: 8, backoffMs: 1_000, multiplier: 2 },
    redact: { paths: [] },
    metadata: { owner: 'notes', schemaVersion: NOTES_EVENT_SCHEMA_VERSION },
  };
}
