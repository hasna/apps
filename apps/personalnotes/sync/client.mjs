import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { describeFetchError, fetchErrorCode } from './lnp.mjs';

// PersonalNotes sync API client. One dialect, two backends: the hosted service
// (https://personalnotes.ai) and any self-hosted server speaking the same
// /api/v1 protocol. The base URL is the only knob: PERSONALNOTES_API_URL,
// config `apiUrl`, or the hosted default.

export const DEFAULT_API_URL = 'https://personalnotes.ai';
export const CONFIG_PATH = process.env.PERSONALNOTES_CONFIG || join(homedir(), '.config', 'personalnotes', 'config.json');

export class PersonalNotesApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'PersonalNotesApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function loadClientConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
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
    apiUrl: overrides.apiUrl || process.env.PERSONALNOTES_API_URL || file.apiUrl || DEFAULT_API_URL,
    apiKey: overrides.apiKey || process.env.PERSONALNOTES_API_KEY || file.apiKey,
    token: overrides.token || process.env.PERSONALNOTES_TOKEN || file.token,
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

export class PersonalNotesClient {
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
      throw new PersonalNotesApiError(describeFetchError(err, this.config.apiUrl), {
        code: fetchErrorCode(err) || 'fetch_failed',
        details: { cause: String(err?.cause?.message || err?.cause || '') },
      });
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = json?.error || {};
      throw new PersonalNotesApiError(err.message || `PersonalNotes API ${method} ${path} failed`, {
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
  return new PersonalNotesClient(await resolveClientConfig(overrides));
}

// Legacy aliases (pre-rename "cloud" names). Deprecated; removed next release.
export const PersonalNotesCloudError = PersonalNotesApiError;
export const PersonalNotesCloudClient = PersonalNotesClient;
export const loadCloudConfig = loadClientConfig;
export const saveCloudConfig = saveClientConfig;
export const clearCloudConfig = clearClientConfig;
export const resolveCloudConfig = resolveClientConfig;
export const createCloudClient = createClient;
