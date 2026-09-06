// Hasna Notes — HTTP API store (plain HTTP client over the personalnotes/v1
// wire dialect, served at the /v1 authority root).
//
// Every client read and write uses this authenticated HTTPS API. A client
// never opens PostgreSQL or a local SQLite/markdown store directly.
//
// SAFETY: the API key lives only inside the @hasna/contracts transport's
// request headers; it is never logged, returned, or embedded in errors, and a
// 401/403 response body is cancelled unread by that transport. Construction
// FAILS CLOSED without a resolved credential — there is no anonymous fallback
// and no default localhost server.
//
// SAFETY (#1794): an explicit baseUrl without an explicit apiKey is a hard
// construction error; the ambient fleet credential is never attached to an
// explicit authority.
//
// SAFETY (#1788): the env object handed to the resolver is never copied, so
// the ambient Keychain/disk tiers stay on for a real process.env.
//
// Per-request freshness: the transport built by createNotesHttpStore
// re-resolves the credential through the @hasna/contracts chain on EVERY
// request and refuses to send when the authority or credential changed since
// construction (rotation heals in place; an authority change throws until the
// client is rebuilt).

import { HasnaHttpError } from '@hasna/contracts/client';
import {
  assertNoClientDatabaseDsn,
  assertNoRetiredNotesStorageSelector,
  createNotesClientTransport,
  createNotesExplicitTransport,
  readPlainClientValue,
  resolveNotesClientCredential,
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
  if (!apiKey) return value;
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
 * Create the HTTP store from an environment. Fails closed when the chain
 * resolves no credential. The key is never included in the returned object;
 * the transport re-resolves it per request.
 */
export function createNotesHttpStore(env = process.env, fetchImpl = fetch) {
  assertNoClientDatabaseDsn(env);
  assertNoRetiredNotesStorageSelector(env);
  const bound = createNotesClientTransport(env, fetchImpl);
  // One extra chain walk at construction: this value exists only so a hostile
  // server or transport error that ECHOES credential material can be redacted
  // before it reaches a log. Requests never use it — the transport resolves
  // its own credential per request.
  const redactionKey = resolveNotesClientCredential(env);
  return new NotesHttpStore({ transport: bound.client, redactionKey }, fetchImpl);
}

export class NotesHttpStore {
  #transport;
  #redactionKey;

  /**
   * Direct config form: an explicit authority + credential pair (tier 1, a
   * pin the caller owns). An explicit baseUrl WITHOUT an apiKey throws — the
   * ambient fleet credential is never attached to an explicit authority
   * (#1794).
   */
  constructor(config, fetchImpl = fetch) {
    let bound;
    if (config?.transport) {
      bound = config.transport;
      this.#redactionKey = typeof config.redactionKey === 'string' ? config.redactionKey : '';
    } else {
      bound = createNotesExplicitTransport(config, fetchImpl);
      this.#redactionKey = String(readPlainClientValue(config, 'apiKey') ?? '').trim();
    }
    this.#transport = bound;
    this.transport = 'http';
  }

  /** The origin the store talks to (the /v1 suffix is added by the transport base). */
  get apiUrl() {
    return this.#transport.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  /** The `<origin>/v1` base the transport was built with. */
  get baseUrl() {
    return this.#transport.baseUrl;
  }

  mapTransportError(error, method, path) {
    const redact = (value) => redactCredential(value, this.#redactionKey);
    if (error instanceof HasnaHttpError) {
      const { status, body } = error;
      // Authenticated redirects are terminal: the transport never follows one
      // (redirect: manual), so no credential or body can cross an authority.
      if (status >= 300 && status < 400) {
        return new NotesHttpStoreError(
          redact(`cannot reach the Notes API at ${safeHost(this.#transport.baseUrl)}: authenticated redirect ${status} is never followed`),
          { status, code: 'redirect_rejected' },
        );
      }
      // Auth failures: the transport cancelled the response body unread (the
      // one place a rejected request can reflect credential material back),
      // and its message names the credential SOURCE without any value.
      if (status === 401 || status === 403) {
        return new NotesHttpStoreError(redact(error.message), { status });
      }
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const sanitized = redact(body);
        const envelope = sanitized?.error && typeof sanitized.error === 'object'
          ? sanitized.error : sanitized;
        const message = typeof envelope?.message === 'string' && envelope.message
          ? envelope.message : redact(`Notes API ${method} ${path} failed`);
        return new NotesHttpStoreError(message, {
          status,
          code: typeof envelope?.code === 'string' ? envelope.code : undefined,
          details: envelope?.details,
        });
      }
      if (typeof body === 'string') {
        return new NotesHttpStoreError(redact(`Notes API ${method} ${path} returned invalid JSON`), {
          status,
          code: 'invalid_json',
        });
      }
      return new NotesHttpStoreError(redact(`Notes API ${method} ${path} failed`), { status });
    }
    const cause = typeof error?.cause === 'object' && error.cause ? error.cause : {};
    const causeCode = typeof cause.code === 'string' ? cause.code : 'fetch_failed';
    return new NotesHttpStoreError(
      redact(describeFetchError(error, this.#transport.baseUrl)),
      { code: redact(causeCode) },
    );
  }

  async request(method, path, { body, query } = {}) {
    let result;
    try {
      result = await this.#transport.request(method, path, body, query && Object.keys(query).length ? { query } : {});
    } catch (error) {
      throw this.mapTransportError(error, method, path);
    }
    // A 200 with an empty body resolved to null in the previous store; keep it.
    return result === undefined ? null : result;
  }

  health() {
    return this.request('GET', '/health');
  }

  listNotes(params = {}) {
    const query = {};
    if (params.limit) query.limit = String(params.limit);
    if (params.includeDeleted) query.include_deleted = '1';
    if (params.cursor) query.cursor = String(params.cursor);
    return this.request('GET', '/notes', { query });
  }

  getNote(id) {
    return this.request('GET', `/notes/${encodeURIComponent(id)}`);
  }

  createNote(input) {
    return this.request('POST', '/notes', { body: input });
  }

  updateNote(id, input) {
    return this.request('PATCH', `/notes/${encodeURIComponent(id)}`, { body: input });
  }

  deleteNote(id) {
    return this.request('DELETE', `/notes/${encodeURIComponent(id)}`);
  }

  exportNotes() {
    return this.request('POST', '/export');
  }
}