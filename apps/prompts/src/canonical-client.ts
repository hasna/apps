/** Authenticated HTTPS only. This module must never import a database or app-data filesystem adapter. */
export interface PromptsClientOptions {
  env?: NodeJS.ProcessEnv;
  apiUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export interface PromptInput {
  title: string;
  body: string;
  slug?: string;
  description?: string | null;
  collection?: string;
  tags?: string[];
  source?: string;
}
export type PromptRecord = PromptInput & { id: string; version: number; use_count: number };
export interface PromptPage { items: PromptRecord[]; total: number }
export interface ListOptions { collection?: string; tags?: string[]; templates?: boolean; limit?: number; offset?: number }

const retired = ['HASNA_PROMPTS_STORAGE_MODE', 'PROMPTS_STORAGE_MODE', 'HASNA_PROMPTS_MODE', 'PROMPTS_MODE',
  'HASNA_PROMPTS_BACKEND', 'PROMPTS_BACKEND', 'HASNA_PROMPTS_LOCAL', 'PROMPTS_LOCAL',
  'HASNA_PROMPTS_SELF_HOSTED', 'PROMPTS_SELF_HOSTED', 'HASNA_PROMPTS_CLOUD', 'PROMPTS_CLOUD',
  'HASNA_PROMPTS_DB_PATH', 'PROMPTS_DB_PATH', 'PROMPTS_DB_SCOPE',
  'PROMPTS_REGISTRY_POSTGRES_URL', 'PROMPTS_REGISTRY_S3_BUCKET', 'PROMPTS_REGISTRY_AWS_REGION'];

function credential(value: string | undefined): string {
  if (!value || value !== value.trim() || /[\s\x00-\x1f\x7f]/.test(value)) {
    throw new Error('prompts requires a nonblank usable HASNA_PROMPTS_API_KEY');
  }
  // Prototype-only floor: reject trivial values that cannot be real keys.
  // Production credential validation (header-safety, vault-pointer shape) lives
  // in the reviewed Contracts resolver (commits 22572ae, 7ab022d, 41fc753);
  // this prototype is explicit-only and unexported pending product direction.
  if (value.length < 8) {
    throw new Error('prompts requires a nonblank usable HASNA_PROMPTS_API_KEY');
  }
  return value;
}

function authority(value: string | undefined): string {
  const invalid = () => new Error('prompts requires an explicit HTTPS HASNA_PROMPTS_API_URL without userinfo, query, fragment or encoded path');
  if (!value || value !== value.trim()) throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash ||
    /[\\\s%]/.test(value) || value.includes('?') || value.includes('#') ||
    url.pathname.split('/').some(segment => segment === '.' || segment === '..') || /\/(?:\.|\.\.)(?:\/|$)/.test(value)) throw invalid();
  return url.href.replace(/\/$/, '').replace(/\/v1$/, '');
}

function resolve(options: PromptsClientOptions): { baseUrl: string; apiKey: string } {
  const env = options.env ?? process.env;
  // Own-data snapshot: never invoke getters on the env object. An
  // accessor-backed key throws instead of being read, per Contracts 41fc753.
  const own = (key: string): string | undefined => {
    const descriptor = Object.getOwnPropertyDescriptor(env, key);
    if (!descriptor) return undefined;
    if (!('value' in descriptor)) throw new Error(`prompts: ${key} is accessor-backed; client configuration requires own data properties`);
    if (descriptor.value !== undefined && typeof descriptor.value !== 'string') {
      throw new Error(`prompts: ${key} must be a string data property`);
    }
    return descriptor.value as string | undefined;
  };
  for (const key of retired) if (own(key) !== undefined) throw new Error(`prompts: unset retired ${key}; configure authenticated HTTPS instead`);
  // Read each mutable source exactly once, then validate and retain that same pair.
  const rawUrl = own('HASNA_PROMPTS_API_URL');
  // hasna-credential-seam-waiver (requires independent review before any
  // migration use): explicit-only constructor snapshots URL and key together as
  // one immutable pair; no fallback, no retry, no per-request re-read. A
  // long-lived process picks up rotation ONLY by constructing a new client.
  // This differs deliberately from the Contracts per-request provider chain
  // (22572ae/7ab022d); it is a prototype boundary, not a rotation story.
  // Prototype-only: no disk/vault tiers, no deprecation tiers. The reviewed
  // Contracts HTTPS resolver is not yet published, so this file must not be
  // treated as the migration target without product/API approval.
  const rawKey = own('HASNA_PROMPTS_API_KEY');
  // hasna-credential-seam-waiver (requires independent review before any
  // migration use): legacy aliases are rejected on PRESENCE — the descriptor
  // below retains the legacy value transiently in a function-scoped local
  // until the throw, then discards it; it is never copied into the closure or
  // frozen client surface. Canonical HASNA_PROMPTS_* keys are the sole
  // supported source; rejection is the whole handling. Prototype-only.
  const legacyKeyDescriptor = Object.getOwnPropertyDescriptor(env, 'PROMPTS_API_KEY');
  if (legacyKeyDescriptor && !('value' in legacyKeyDescriptor)) throw new Error('prompts: PROMPTS_API_KEY is accessor-backed; client configuration requires own data properties');
  if (own('PROMPTS_API_URL') !== undefined || (legacyKeyDescriptor !== undefined && (legacyKeyDescriptor as PropertyDescriptor).value !== undefined)) throw new Error('prompts: legacy API aliases are unsupported; use HASNA_PROMPTS_API_URL and HASNA_PROMPTS_API_KEY');
  const explicitUrl = options.apiUrl;
  const explicitKey = options.apiKey;
  if ((explicitUrl !== undefined) !== (explicitKey !== undefined)) throw new Error('prompts: explicit apiUrl and apiKey must be provided together');
  if (explicitUrl !== undefined && ((rawUrl !== undefined && rawUrl !== explicitUrl) || (rawKey !== undefined && rawKey !== explicitKey))) {
    throw new Error('prompts: explicit and environment authentication configuration conflict');
  }
  return { baseUrl: authority(explicitUrl ?? rawUrl), apiKey: credential(explicitKey ?? rawKey) };
}

function pagination(options: ListOptions): URLSearchParams {
  const limit = options.limit ?? 20, offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw new Error('prompts: limit must be 1..200 and offset 0..10000');
  }
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (options.collection !== undefined) params.set('collection', options.collection);
  if (options.tags !== undefined) params.set('tags', options.tags.join(','));
  if (options.templates !== undefined) params.set('templates', String(options.templates));
  return params;
}

export class PromptsRequestError extends Error {
  constructor(readonly status: number) { super(`prompts service request failed (HTTP ${status})`); }
}

export function createPromptsClient(options: PromptsClientOptions = {}) {
  const { baseUrl, apiKey } = resolve(options);
  const fetcher = options.fetch ?? globalThis.fetch;
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}/v1${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('prompts HTTPS request failed; no local fallback'); }
    if (!response.ok || response.redirected) throw new PromptsRequestError(response.status);
    try { return await response.json() as T; }
    catch { throw new Error('prompts service returned invalid JSON'); }
  }
  const path = (id: string) => {
    if (!id || id === '.' || id === '..') throw new Error('prompts: a nonempty prompt identifier is required');
    return `/prompts/${encodeURIComponent(id)}`;
  };
  return Object.freeze({
    baseUrl,
    list: (options: ListOptions = {}) => request<PromptPage>('GET', `/prompts?${pagination(options)}`),
    get: (id: string) => request<PromptRecord>('GET', path(id)),
    create: (input: PromptInput) => request<PromptRecord>('POST', '/prompts', input),
    update: (id: string, input: Partial<PromptInput>) => request<PromptRecord>('PUT', path(id), input),
    delete: (id: string) => request<{ deleted: boolean }>('DELETE', path(id)),
    use: (id: string) => request<{ body: string; prompt: PromptRecord }>('POST', `${path(id)}/use`),
    render: (id: string, vars: Record<string, string> = {}) => request<{ id: string; body: string; missing_vars: string[]; used_defaults: string[] }>('POST', `${path(id)}/render`, { vars }),
    search: (q: string, options: ListOptions = {}) => request<{ items: Array<{ item: PromptRecord; rank: number }>; total: number }>('GET', `/search?${pagination(options)}&q=${encodeURIComponent(q)}`),
    collections: () => request<{ collections: string[] }>('GET', '/collections'),
    storageStatus: () => request<{ backend: 'postgresql'; prompts_total: number; versions_total: number }>('GET', '/storage/status'),
  });
}
export type PromptsClient = ReturnType<typeof createPromptsClient>;
