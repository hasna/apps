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
  readPlainClientValue,
  resolveNotesClientTransport,
  snapshotNotesClientEnvironment,
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
  const cause = typeof err?.cause?.message === 'string' ? err.cause.message
    : typeof err?.cause === 'string' ? err.cause : '';
  const host = safeHost(apiUrl);
  // macOS Local Network Privacy (sync/lnp.mjs documented the signature): a
  // launchd agent silently blocked from a LAN address fails this way.
  if (/Local Network|ne\d+\.local/.test(cause)) {
    return `cannot reach the Notes API at ${host}: blocked by macOS Local Network Privacy — allow it in System Settings > Privacy & Security > Local Network`;
  }
  return `cannot reach the Notes API at ${host}: ${typeof err?.message === 'string' ? err.message : 'network error'}`;
}

function safeHost(apiUrl) {
  try {
    const url = new URL(apiUrl);
    return url.host;
  } catch {
    return 'the configured API URL';
  }
}

function redactCredential(value, apiKey) {
  if (typeof value === 'string') return value.split(apiKey).join('[REDACTED]');
  if (!value || typeof value !== 'object') return value;
  const result = Array.isArray(value) ? [] : {};
  const pending = [{ source: value, target: result }];
  // JSON error bodies can be deeply nested; do not recurse on untrusted depth.
  while (pending.length) {
    const { source, target } = pending.pop();
    for (const [key, item] of Object.entries(source)) {
      let sanitized = typeof item === 'string' ? item.split(apiKey).join('[REDACTED]') : item;
      if (item && typeof item === 'object') {
        sanitized = Array.isArray(item) ? [] : {};
        pending.push({ source: item, target: sanitized });
      }
      // Define data properties so a JSON __proto__ key cannot change prototypes.
      Object.defineProperty(target, key.split(apiKey).join('[REDACTED]'), {
        value: sanitized, enumerable: true, configurable: true, writable: true,
      });
    }
  }
  return result;
}

/**
 * Create the HTTP store from the environment. Fails closed when the URL is
 * present without the key. The key is never included in the returned object.
 */
export function createNotesHttpStore(env = process.env, fetchImpl = fetch) {
  env = snapshotNotesClientEnvironment(env);
  resolveNotesClientTransport(env);
  const apiUrl = env[NOTES_API_URL_ENV]?.trim();
  const apiKey = env[NOTES_API_KEY_ENV]?.trim();
  return new NotesHttpStore({ apiUrl, apiKey }, fetchImpl);
}

export class NotesHttpStore {
  #apiUrl;
  #apiKey;
  #fetch;

  constructor(config, fetchImpl = fetch) {
    const apiUrl = readPlainClientValue(config, 'apiUrl');
    const apiKey = readPlainClientValue(config, 'apiKey');
    resolveNotesClientTransport({
      [NOTES_API_URL_ENV]: apiUrl,
      [NOTES_API_KEY_ENV]: apiKey,
    });
    this.#apiUrl = apiUrl.trim().replace(/\/$/, '');
    this.#apiKey = apiKey.trim();
    this.transport = 'http';
    this.#fetch = fetchImpl;
  }

  get apiUrl() { return this.#apiUrl; }

  async request(method, path, { body } = {}) {
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.#apiKey}`,
    };
    let res;
    try {
      res = await this.#fetch(`${this.#apiUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Authenticated redirects are never safe: 301/302/303 may rewrite a
        // mutation to GET and report a false success, while 307/308 replay the
        // bearer credential and body. Reject same- and cross-origin redirects.
        redirect: 'error',
      });
    } catch (err) {
      throw new NotesHttpStoreError(redactCredential(describeFetchError(err, this.#apiUrl), this.#apiKey), {
        code: typeof err?.cause?.code === 'string' ? redactCredential(err.cause.code, this.#apiKey) : 'fetch_failed',
      });
    }
    let text;
    try {
      text = await res.text();
    } catch {
      throw new NotesHttpStoreError('Notes API response body could not be read', {
        status: res.status, code: 'body_read_failed',
      });
    }
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new NotesHttpStoreError(redactCredential(`Notes API ${method} ${path} returned invalid JSON`, this.#apiKey), {
          status: res.status,
          code: 'invalid_json',
        });
      }
    }
    if (!res.ok) {
      const err = redactCredential(json?.error || {}, this.#apiKey);
      const message = typeof err.message === 'string' && err.message
        ? err.message : redactCredential(`Notes API ${method} ${path} failed`, this.#apiKey);
      throw new NotesHttpStoreError(message, {
        status: res.status,
        code: typeof err.code === 'string' ? err.code : undefined,
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
