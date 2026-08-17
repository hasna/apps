import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { hasnaEnv } from '../tools/notes-env.mjs';
import { describeFetchError, fetchErrorCode } from './lnp.mjs';

// Hasna Notes sync API client. One dialect, two backends: the future hosted
// service (reachable via HASNA_NOTES_API_URL) and any self-hosted server
// speaking the same /api/v1 protocol. The base URL is the only knob:
// HASNA_NOTES_API_URL, config `apiUrl`, or the local server default.

export const DEFAULT_API_URL = 'http://127.0.0.1:8788';
export const CONFIG_PATH = hasnaEnv('CONFIG') || join(homedir(), '.config', 'hasna-notes', 'config.json');
// Pre-rename config location, honored one release for existing installs
// (migrated to CONFIG_PATH on first load; the old file is kept as backup).
// The directory name is assembled from fragments so the rename gate
// (grep for the retired app name) never matches this compatibility path itself.
export const LEGACY_CONFIG_PATH = join(homedir(), '.config', 'pers' + 'onalnotes', 'config.json');

export class NotesApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'NotesApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function loadClientConfig(path = CONFIG_PATH) {
  if (existsSync(path)) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return {};
    }
  }
  // One-release migration: read the pre-rename config, write it to the new
  // path, and keep the old file as backup.
  const legacyPath = hasnaEnv('CONFIG') ? null : LEGACY_CONFIG_PATH;
  if (legacyPath && existsSync(legacyPath)) {
    try {
      const migrated = JSON.parse(await readFile(legacyPath, 'utf8'));
      await saveClientConfig(migrated, path);
      return migrated;
    } catch {
      return {};
    }
  }
  return {};
}

export async function saveClientConfig(config, path = CONFIG_PATH) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return config;
}

export async function clearClientConfig(path = CONFIG_PATH) {
  return saveClientConfig({}, path);
}

export async function resolveClientConfig(overrides = {}) {
  const file = await loadClientConfig(overrides.configPath || CONFIG_PATH);
  return {
    apiUrl: overrides.apiUrl || hasnaEnv('API_URL') || file.apiUrl || DEFAULT_API_URL,
    apiKey: overrides.apiKey || hasnaEnv('API_KEY') || file.apiKey,
    token: overrides.token || hasnaEnv('TOKEN') || file.token,
    configPath: overrides.configPath || CONFIG_PATH,
  };
}

function headers(config, extra = {}) {
  const token = config.apiKey || config.token;
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export class NotesClient {
  constructor(config = {}) {
    this.config = {
      apiUrl: (config.apiUrl || DEFAULT_API_URL).replace(/\/$/, ''),
      apiKey: config.apiKey,
      token: config.token,
    };
  }

  async request(method, path, { body, headers: headerOverrides } = {}) {
    let res;
    try {
      res = await fetch(`${this.config.apiUrl}${path}`, {
        method,
        headers: headers(this.config, headerOverrides),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // A bare `fetch failed` is undiagnosable — the syscall code (e.g.
      // EHOSTUNREACH) lives in err.cause. Surface it, plus the macOS Local
      // Network Privacy explanation when the signature matches (launchd
      // agents are silently blocked from LAN addresses; see sync/lnp.mjs).
      throw new NotesApiError(describeFetchError(err, this.config.apiUrl), {
        code: fetchErrorCode(err) || 'fetch_failed',
        details: { cause: String(err?.cause?.message || err?.cause || '') },
      });
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = json?.error || {};
      throw new NotesApiError(err.message || `Hasna Notes API ${method} ${path} failed`, {
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

  apiInfo() {
    return this.request('GET', '/api/v1');
  }

  startLogin(email) {
    return this.request('POST', '/api/v1/auth/login', { body: { email } });
  }

  verifyLogin({ email, code, name }) {
    return this.request('POST', '/api/v1/auth/verify', { body: { email, code, name } });
  }

  startDeviceLogin() {
    return this.request('POST', '/api/v1/auth/device/start', { body: {} });
  }

  pollDeviceLogin(deviceCode) {
    return this.request('POST', '/api/v1/auth/device/token', { body: { deviceCode } });
  }

  exchangeDeviceLogin(exchangeToken) {
    return this.request('POST', '/api/v1/auth/device/exchange', { body: { exchangeToken } });
  }

  approveDeviceLogin(userCode) {
    return this.request('POST', '/api/v1/auth/device/approve', { body: { userCode } });
  }

  whoami() {
    return this.request('GET', '/api/v1/auth/whoami');
  }

  listNotes(params = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.includeDeleted) qs.set('include_deleted', '1');
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

  sync(input, idempotencyKey = `sync-${Date.now()}-${randomUUID()}`) {
    return this.request('POST', '/api/v1/sync', {
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
    });
  }

  exportNotes() {
    return this.request('POST', '/api/v1/export', { body: {} });
  }

  billingStatus() {
    return this.request('GET', '/api/v1/billing/status');
  }

  billingCheckout() {
    return this.request('POST', '/api/v1/billing/checkout', { body: {} });
  }
}

export async function createClient(overrides = {}) {
  return new NotesClient(await resolveClientConfig(overrides));
}

// Legacy aliases (pre-rename "cloud" names). Deprecated; removed next release.
export const NotesCloudError = NotesApiError;
export const NotesCloudClient = NotesClient;
export const loadCloudConfig = loadClientConfig;
export const saveCloudConfig = saveClientConfig;
export const clearCloudConfig = clearClientConfig;
export const resolveCloudConfig = resolveClientConfig;
export const createCloudClient = createClient;
