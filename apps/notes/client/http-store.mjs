// Hasna Notes — HTTP API store (plain HTTP client over the personalnotes/v1
// wire dialect).
//
// Every client read and write uses this authenticated HTTPS API. A client
// never opens PostgreSQL or a local SQLite/markdown store directly.
//
// SAFETY: the API key lives only inside this module's request headers; it is
// never logged, returned, or embedded in errors. An API URL without its key
// FAILS CLOSED at construction — there is no anonymous fallback and no
// default localhost server (that default was removed with the sync-era
// client).

import {
  NOTES_API_URL_ENV,
  NOTES_API_KEY_ENV,
  resolveNotesClientTransport,
} from './transport.mjs';

export class NotesHttpStoreError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'NotesHttpStoreError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function describeFetchError(err, apiUrl) {
  const cause = err?.cause?.message || err?.cause || '';
  const host = safeHost(apiUrl);
  // macOS Local Network Privacy (sync/lnp.mjs documented the signature): a
  // launchd agent silently blocked from a LAN address fails this way.
  if (/Local Network|ne\d+\.local/.test(cause)) {
    return `cannot reach the Notes API at ${host}: blocked by macOS Local Network Privacy — allow it in System Settings > Privacy & Security > Local Network`;
  }
  return `cannot reach the Notes API at ${host}: ${err?.message || 'network error'}`;
}

function safeHost(apiUrl) {
  try {
    const url = new URL(apiUrl);
    return url.host;
  } catch {
    return 'the configured API URL';
  }
}

/**
 * Create the HTTP store from the environment. Fails closed when the URL is
 * present without the key. The key is never included in the returned object.
 */
export function createNotesHttpStore(env = process.env, fetchImpl = fetch) {
  resolveNotesClientTransport(env);
  const apiUrl = env[NOTES_API_URL_ENV]?.trim();
  const apiKey = env[NOTES_API_KEY_ENV]?.trim();
  return new NotesHttpStore({ apiUrl, apiKey }, fetchImpl);
}

export class NotesHttpStore {
  constructor({ apiUrl, apiKey }, fetchImpl = fetch) {
    resolveNotesClientTransport({
      [NOTES_API_URL_ENV]: apiUrl,
      [NOTES_API_KEY_ENV]: apiKey,
    });
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.transport = 'http';
    this._fetch = fetchImpl;
  }

  async request(method, path, { body } = {}) {
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
    let res;
    try {
      res = await this._fetch(`${this.apiUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new NotesHttpStoreError(describeFetchError(err, this.apiUrl), {
        code: err?.cause?.code || 'fetch_failed',
      });
    }
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new NotesHttpStoreError(`Notes API ${method} ${path} returned invalid JSON`, {
          status: res.status,
          code: 'invalid_json',
        });
      }
    }
    if (!res.ok) {
      const err = json?.error || {};
      throw new NotesHttpStoreError(err.message || `Notes API ${method} ${path} failed`, {
        status: res.status,
        code: err.code,
        details: err.details,
      });
    }
    return json;
  }

  health() {
    return this.request('GET', '/health');
  }

  listNotes(params = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.includeDeleted) qs.set('include_deleted', '1');
    if (params.cursor) qs.set('cursor', String(params.cursor));
    const suffix = qs.size ? `?${qs}` : '';
    return this.request('GET', `/api/v1/notes${suffix}`);
  }

  getNote(id) {
    return this.request('GET', `/api/v1/notes/${encodeURIComponent(id)}`);
  }

  createNote(input) {
    return this.request('POST', '/api/v1/notes', { body: input });
  }

  updateNote(id, input) {
    return this.request('PATCH', `/api/v1/notes/${encodeURIComponent(id)}`, { body: input });
  }

  deleteNote(id) {
    return this.request('DELETE', `/api/v1/notes/${encodeURIComponent(id)}`);
  }

  exportNotes() {
    return this.request('POST', '/api/v1/export');
  }
}
