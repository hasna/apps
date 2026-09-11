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
  createNotesClientTransport,
  createNotesExplicitTransport,
  readPlainClientValue,
  resolveNotesClientCredential,
} from './transport.mjs';

export class NotesHttpStoreError extends Error {
  /** @param {string} message @param {import('../sdk/types.js').NotesErrorOptions} [options] */
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'NotesHttpStoreError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** @param {{cause?: {message?: unknown} | string, message?: unknown} | null | undefined} err @param {string} apiUrl */
function describeFetchError(err, apiUrl) {
  const cause = typeof /** @type {{message?: unknown} | undefined} */ (err?.cause)?.message === 'string' ? /** @type {{message: string}} */ (err?.cause).message
    : typeof err?.cause === 'string' ? err.cause : '';
  const host = safeHost(apiUrl);
  // macOS Local Network Privacy (sync/lnp.mjs documented the signature): a
  // launchd agent silently blocked from a LAN address fails this way.
  if (/Local Network|ne\d+\.local/.test(cause)) {
    return `cannot reach the Notes API at ${host}: blocked by macOS Local Network Privacy — allow it in System Settings > Privacy & Security > Local Network`;
  }
  return `cannot reach the Notes API at ${host}: ${typeof err?.message === 'string' ? err.message : 'network error'}`;
}

/** @param {string} apiUrl */
function safeHost(apiUrl) {
  try {
    const url = new URL(apiUrl);
    return url.host;
  } catch {
    return 'the configured API URL';
  }
}

/** @param {unknown} value @param {string} apiKey @returns {unknown} */
function redactCredential(value, apiKey) {
  if (!apiKey) return value;
  if (typeof value === 'string') return value.split(apiKey).join('[REDACTED]');
  if (!value || typeof value !== 'object') return value;
  const result = Array.isArray(value) ? [] : {};
  /** @type {{source: object, target: object}[]} */
  const pending = [{ source: value, target: result }];
  // JSON error bodies can be deeply nested; do not recurse on untrusted depth.
  while (pending.length) {
    const { source, target } = /** @type {{source: object, target: object}} */ (pending.pop());
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
/** @param {import('../sdk/types.js').NotesEnvironment} [env] @param {typeof fetch} [fetchImpl] */
export function createNotesHttpStore(env = process.env, fetchImpl = fetch) {
  assertNoClientDatabaseDsn(env);
  const bound = createNotesClientTransport(env, fetchImpl);
  // One extra chain walk at construction: this value exists only so a hostile
  // server or transport error that ECHOES credential material can be redacted
  // before it reaches a log. Requests never use it — the transport resolves
  // its own credential per request.
  const redactionKey = resolveNotesClientCredential(env);
  return new NotesHttpStore({ transport: bound.client, redactionKey }, fetchImpl);
}

export class NotesHttpStore {
  /** @type {import('@hasna/contracts/client').HasnaHttpTransport} */
  #transport;
  #redactionKey;

  /**
   * Direct config form: an explicit authority + credential pair (tier 1, a
   * pin the caller owns). An explicit baseUrl WITHOUT an apiKey throws — the
   * ambient fleet credential is never attached to an explicit authority
   * (#1794).
   */
  /** @param {import('../sdk/types.js').NotesStoreConfiguration} config @param {typeof fetch} [fetchImpl] */
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
    this.transport = /** @type {const} */ ('http');
  }

  /** The origin the store talks to (the /v1 suffix is added by the transport base). */
  get apiUrl() {
    return this.#transport.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  /** The `<origin>/v1` base the transport was built with. */
  get baseUrl() {
    return this.#transport.baseUrl;
  }

  /** @param {unknown} error @param {string} method @param {string} path @returns {NotesHttpStoreError} */
  mapTransportError(error, method, path) {
    /** @param {string} value */
    const redact = (value) => /** @type {string} */ (redactCredential(value, this.#redactionKey));
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
        const sanitized = /** @type {Record<string, unknown>} */ (redactCredential(body, this.#redactionKey));
        const envelope = /** @type {Record<string, unknown>} */ (sanitized?.error && typeof sanitized.error === 'object'
          ? sanitized.error : sanitized);
        const message = typeof envelope?.message === 'string' && envelope.message
          ? envelope.message : redact(`Notes API ${method} ${path} failed`);
        return new NotesHttpStoreError(message, {
          status,
          code: typeof envelope?.code === 'string' ? envelope.code : undefined,
          details: envelope?.details,
        });
      }
      if (typeof body === 'string') {
        // Name the status: the CLI and MCP print only this message, and a
        // deployment or gateway mismatch (an origin that does not serve /v1
        // answers 404 text/plain) must read differently from a corrupt JSON
        // body on a 200.
        return new NotesHttpStoreError(
          redact(`Notes API ${method} ${path} returned HTTP ${status} with a non-JSON body`),
          { status, code: 'invalid_json' },
        );
      }
      return new NotesHttpStoreError(redact(`Notes API ${method} ${path} failed`), { status });
    }
    const observed = /** @type {{cause?: object | string, message?: unknown} | null | undefined} */ (error);
    const cause = /** @type {{code?: unknown}} */ (typeof observed?.cause === 'object' && observed.cause ? observed.cause : {});
    const causeCode = typeof cause.code === 'string' ? cause.code : 'fetch_failed';
    return new NotesHttpStoreError(
      redact(describeFetchError(observed, this.#transport.baseUrl)),
      { code: redact(causeCode) },
    );
  }

  /** @param {string} method @param {string} path @param {import('../sdk/types.js').NotesRequestOptions} [options] @returns {Promise<unknown>} */
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

  /** @returns {Promise<import('../sdk/types.js').NotesHealth>} */
  health() {
    return /** @type {Promise<import('../sdk/types.js').NotesHealth>} */ (this.request('GET', '/health'));
  }

  /** @param {import('../sdk/types.js').NotesListOptions} [params] @returns {Promise<import('../sdk/types.js').NotesPage>} */
  listNotes(params = {}) {
    /** @type {Record<string, string>} */
    const query = {};
    if (params.limit) query.limit = String(params.limit);
    if (params.includeDeleted) query.include_deleted = '1';
    if (params.cursor) query.cursor = String(params.cursor);
    return /** @type {Promise<import('../sdk/types.js').NotesPage>} */ (this.request('GET', '/notes', { query }));
  }

  /** @param {string} id @returns {Promise<import('../sdk/types.js').Note>} */
  getNote(id) {
    return /** @type {Promise<import('../sdk/types.js').Note>} */ (this.request('GET', `/notes/${encodeURIComponent(id)}`));
  }

  /** @param {import('../sdk/types.js').NoteInput} input @returns {Promise<import('../sdk/types.js').Note>} */
  createNote(input) {
    return /** @type {Promise<import('../sdk/types.js').Note>} */ (this.request('POST', '/notes', { body: input }));
  }

  /** @param {string} id @param {import('../sdk/types.js').NoteUpdate} input @returns {Promise<import('../sdk/types.js').Note>} */
  updateNote(id, input) {
    return /** @type {Promise<import('../sdk/types.js').Note>} */ (this.request('PATCH', `/notes/${encodeURIComponent(id)}`, { body: input }));
  }

  /** @param {string} id @returns {Promise<import('../sdk/types.js').NotesDeleteResult>} */
  deleteNote(id) {
    return /** @type {Promise<import('../sdk/types.js').NotesDeleteResult>} */ (this.request('DELETE', `/notes/${encodeURIComponent(id)}`));
  }

  /** @returns {Promise<import('../sdk/types.js').NotesExport>} */
  exportNotes() {
    return /** @type {Promise<import('../sdk/types.js').NotesExport>} */ (this.request('POST', '/export'));
  }
}