// Personal Notes HTTP API router — the PRIMARY communication surface.
//
// Hand-rolled fetch router (the Hasna house pattern; no framework). `createRouter`
// returns an async `(Request) => Response` handler that both `Bun.serve` (src/server/
// index.mjs) and the tests drive directly. Every /v1 operation delegates to the SAME
// domain layer (tools/notes-lib.mjs) the CLI and MCP surfaces use — no copy-paste
// handlers.

import {
  archiveNote,
  assignLabel,
  deleteLabelEverywhere,
  deleteNote,
  getNote,
  listNotes,
  loadLabelList,
  loadNotes,
  loadSettings,
  purgeExpiredTrash,
  renameLabel,
  restoreNote,
  saveLabelList,
  saveNote,
  saveSettings,
  trashNote,
  unassignLabel,
} from '../../tools/notes-lib.mjs';
import { buildOpenApiDocument } from './openapi.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function errorResponse(error, status, message) {
  return json({ error, ...(message ? { message } : {}) }, status);
}

class HttpError extends Error {
  constructor(status, error, message) {
    super(message || error);
    this.status = status;
    this.error = error;
  }
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

function boolParam(value) {
  if (value == null) return undefined;
  return /^(1|true|yes)$/i.test(value);
}

function numParam(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function requireNote(id) {
  const note = await getNote(id);
  if (!note) throw new HttpError(404, 'note_not_found', `No note with id ${id}.`);
  return note;
}

/**
 * Create the API request handler.
 * @param {{apiKey?:string, version?:string, requireAuth?:boolean}} [options]
 */
export function createRouter(options = {}) {
  const apiKey = options.apiKey ?? process.env.HASNA_NOTES_API_KEY ?? '';
  const version = options.version ?? process.env.HASNA_NOTES_VERSION ?? '0.0.0';
  // Fail-closed: when a key is configured, every /v1 call must present it.
  const requireAuth = options.requireAuth ?? !!apiKey;

  const openapiDoc = buildOpenApiDocument({ version });

  function checkAuth(request) {
    if (!requireAuth) return;
    const provided = request.headers.get('x-api-key') || '';
    if (!apiKey || provided !== apiKey) {
      throw new HttpError(401, 'unauthorized', 'A valid x-api-key header is required.');
    }
  }

  async function handleV1(request, url, method) {
    checkAuth(request);
    const segments = url.pathname.split('/').filter(Boolean); // e.g. ['v1','notes','id']
    const [, resource, a, b, c] = segments;

    // /v1/notes ...
    if (resource === 'notes') {
      // /v1/notes/all
      if (a === 'all' && b === undefined && method === 'GET') {
        return json(await loadNotes());
      }
      // /v1/notes (collection)
      if (a === undefined) {
        if (method === 'GET') {
          const q = url.searchParams;
          const page = await listNotes({
            limit: numParam(q.get('limit')),
            offset: numParam(q.get('offset')),
            label: q.get('label') ?? undefined,
            machine: q.get('machine') ?? undefined,
            status: q.get('status') ?? undefined,
            includeTrash: boolParam(q.get('includeTrash')),
            includeArchived: boolParam(q.get('includeArchived')),
            query: q.get('query') ?? undefined,
          });
          return json(page);
        }
        if (method === 'POST') {
          const body = await readJson(request);
          if (!body || typeof body !== 'object') {
            throw new HttpError(400, 'invalid_note', 'A note object is required.');
          }
          return json(await saveNote(body));
        }
        throw new HttpError(405, 'method_not_allowed');
      }

      // /v1/notes/{id}
      const id = decodeURIComponent(a);
      if (b === undefined) {
        if (method === 'GET') return json(await requireNote(id));
        if (method === 'DELETE') {
          await requireNote(id);
          await deleteNote(id);
          return json({ ok: true, id });
        }
        throw new HttpError(405, 'method_not_allowed');
      }

      // /v1/notes/{id}/labels ...
      if (b === 'labels') {
        if (c === undefined && method === 'POST') {
          const { label } = await readJson(request);
          if (!label) throw new HttpError(400, 'label_required');
          return json(await assignLabel(id, label));
        }
        if (c !== undefined && method === 'DELETE') {
          return json(await unassignLabel(id, decodeURIComponent(c)));
        }
        throw new HttpError(405, 'method_not_allowed');
      }

      // /v1/notes/{id}/{action}
      if (method === 'POST') {
        if (b === 'archive') return json(await archiveNote(id));
        if (b === 'restore') return json(await restoreNote(id));
        if (b === 'trash') {
          const { retentionDays } = await readJson(request);
          return json(await trashNote(id, retentionDays != null ? { retentionDays } : {}));
        }
      }
      throw new HttpError(404, 'not_found');
    }

    // /v1/trash/purge
    if (resource === 'trash' && a === 'purge' && method === 'POST') {
      return json(await purgeExpiredTrash());
    }

    // /v1/labels ...
    if (resource === 'labels') {
      if (a === undefined) {
        if (method === 'GET') return json(await loadLabelList());
        if (method === 'PUT') {
          const { labels } = await readJson(request);
          if (!Array.isArray(labels)) throw new HttpError(400, 'labels_required');
          return json(await saveLabelList(labels));
        }
        throw new HttpError(405, 'method_not_allowed');
      }
      if (a === 'rename' && method === 'POST') {
        const { from, to } = await readJson(request);
        if (!from || !to) throw new HttpError(400, 'from_and_to_required');
        await renameLabel(from, to);
        return json({ ok: true });
      }
      if (a !== undefined && method === 'DELETE') {
        await deleteLabelEverywhere(decodeURIComponent(a));
        return json({ ok: true });
      }
      throw new HttpError(405, 'method_not_allowed');
    }

    // /v1/settings
    if (resource === 'settings' && a === undefined) {
      if (method === 'GET') return json(await loadSettings());
      if (method === 'PUT') return json(await saveSettings(await readJson(request)));
      throw new HttpError(405, 'method_not_allowed');
    }

    throw new HttpError(404, 'not_found');
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    try {
      // Public, unauthenticated probes.
      if (url.pathname === '/health') return json({ status: 'ok' });
      if (url.pathname === '/version') return json({ name: 'personalnotes', version });
      if (url.pathname === '/openapi.json') return json(openapiDoc);
      if (url.pathname === '/ready') {
        // Readiness gate: exercise the storage/domain layer end-to-end.
        try {
          await listNotes({ limit: 1 });
          return json({ status: 'ready' });
        } catch (err) {
          return json({ status: 'not_ready', reason: String(err?.message || err) }, 503);
        }
      }

      if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
        return await handleV1(request, url, method);
      }

      return errorResponse('not_found', 404);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.error, err.status, err.message);
      return errorResponse('internal_error', 500, String(err?.message || err));
    }
  };
}

export default createRouter;
