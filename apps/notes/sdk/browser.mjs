// Explicit, browser-safe Notes client. No process environment, filesystem,
// Keychain, shell, database or ambient fleet credentials are read here.
export class NotesApiError extends Error {
  constructor(code, message, { status = 0, details } = {}) {
    super(message);
    this.name = 'NotesApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeNotesApiBase(value, { allowHttpLoopback = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new NotesApiError('invalid_authority', 'A complete Notes API base URL is required.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowHttpLoopback && url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash) {
    throw new NotesApiError('invalid_authority', 'The Notes API base must use HTTPS without credentials, query or fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.href;
}

function segment(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..') {
    throw new NotesApiError('invalid_argument', 'A nonempty resource identifier is required.');
  }
  return encodeURIComponent(value);
}

async function boundedJson(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new NotesApiError('response_too_large', 'Notes API response exceeds the client limit.', { status: response.status });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new NotesApiError('invalid_json', 'Notes API returned an invalid JSON response.', { status: response.status }); }
}

function redact(value, credential) {
  // Serialization is bounded by boundedJson. Replace before parsing, including
  // JSON-escaped credentials, without assigning attacker-controlled object keys.
  if (value === undefined) return undefined;
  const escaped = JSON.stringify(credential).slice(1, -1);
  return JSON.parse(JSON.stringify(value).split(escaped).join('[REDACTED]'));
}

async function readCredential(provider, signal) {
  let onAbort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => { signal.throwIfAborted(); return provider(); }),
      new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally { signal.removeEventListener('abort', onAbort); }
}

export class NotesClient {
  #credential;
  #fetch;
  #base;
  #timeout;
  #maxBytes;

  constructor({ apiBase, credential, fetchImpl = globalThis.fetch, allowHttpLoopback = false, timeoutMs = 30000, maxResponseBytes = 8 * 1024 * 1024 } = {}) {
    this.#base = normalizeNotesApiBase(apiBase, { allowHttpLoopback });
    if (typeof credential !== 'function') throw new NotesApiError('missing_credential', 'An explicit credential provider is required.');
    if (typeof fetchImpl !== 'function') throw new NotesApiError('invalid_argument', 'A fetch implementation is required.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new NotesApiError('invalid_argument', 'Client limits must be positive safe integers.');
    }
    this.#credential = credential;
    this.#fetch = fetchImpl;
    this.#timeout = timeoutMs;
    this.#maxBytes = maxResponseBytes;
  }

  get apiBase() { return this.#base; }

  async #request(method, path, { body, query, signal, idempotencyKey } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Notes request timed out', 'TimeoutError')), this.#timeout);
    let credential;
    try {
      controller.signal.throwIfAborted();
      credential = await readCredential(this.#credential, controller.signal);
      controller.signal.throwIfAborted();
      if (typeof credential !== 'string' || !credential.trim() || /[\r\n]/.test(credential)) {
        throw new NotesApiError('missing_credential', 'Sign in to access Notes.');
      }
      const url = new URL(path, this.#base);
      if (url.origin !== new URL(this.#base).origin || !url.href.startsWith(this.#base)) {
        throw new NotesApiError('invalid_authority', 'Notes request escaped its configured API base.');
      }
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
      const headers = { authorization: `Bearer ${credential}`, accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (idempotencyKey !== undefined) {
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) throw new NotesApiError('invalid_argument', 'Invalid idempotency key.');
        headers['idempotency-key'] = idempotencyKey;
      }
      const response = await this.#fetch(url.href, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, redirect: 'manual', credentials: 'omit', cache: 'no-store',
      });
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw new NotesApiError('redirect_rejected', 'An authenticated Notes redirect was refused.', { status: response.status });
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new NotesApiError(response.status === 401 ? 'unauthorized' : 'forbidden', response.status === 401 ? 'Sign in again to access Notes.' : 'This account cannot perform that action.', { status: response.status });
      }
      const data = await boundedJson(response, response.ok ? this.#maxBytes : Math.min(this.#maxBytes, 128 * 1024));
      if (!response.ok) {
        const error = redact(data?.error, credential);
        throw new NotesApiError(typeof error?.code === 'string' ? error.code : 'request_failed',
          typeof error?.message === 'string' ? error.message : 'Notes request failed.',
          { status: response.status, details: error?.details });
      }
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof NotesApiError) throw error;
      // Fetch/provider errors can echo credentials or request URLs. Keep diagnostics bounded.
      throw new NotesApiError('network_error', 'Cannot reach Notes. Your changes have not been confirmed.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  list({ limit, cursor, includeDeleted, label, search, ...options } = {}) {
    return this.#request('GET', 'notes', { ...options, query: { limit, cursor, include_deleted: includeDeleted ? '1' : undefined, label, search } });
  }
  get(id, options) { return this.#request('GET', `notes/${segment(id)}`, options); }
  create(input, options) { return this.#request('POST', 'notes', { ...options, body: input }); }
  update(id, input, options) { return this.#request('PATCH', `notes/${segment(id)}`, { ...options, body: input }); }
  delete(id, { baseRevision, ...options } = {}) { return this.#request('DELETE', `notes/${segment(id)}`, { ...options, body: baseRevision === undefined ? undefined : { baseRevision } }); }
  restore(id, { baseRevision, ...options } = {}) { return this.#request('POST', `notes/${segment(id)}/restore`, { ...options, body: baseRevision === undefined ? undefined : { baseRevision } }); }
  changes({ cursor, limit, ...options } = {}) { return this.#request('GET', 'changes', { ...options, query: { cursor, limit } }); }
  labels(options) { return this.#request('GET', 'labels', options); }
  renameLabel(label, name, options) { return this.#request('PATCH', `labels/${segment(label)}`, { ...options, body: { name } }); }
  deleteLabel(label, options) { return this.#request('DELETE', `labels/${segment(label)}`, options); }
  export(options) { return this.#request('POST', 'export', options); }
}
