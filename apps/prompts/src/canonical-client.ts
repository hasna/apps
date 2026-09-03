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
  for (const key of retired) if (env[key] !== undefined) throw new Error(`prompts: unset retired ${key}; configure authenticated HTTPS instead`);
  // Read each mutable source exactly once, then validate and retain that same pair.
  const rawUrl = env.HASNA_PROMPTS_API_URL;
  // hasna-credential-seam-waiver: Explicit-only constructor snapshots URL and key together; no credential fallback or retry. Reconstruct the client to rotate this pair. Reviewed Contracts HTTPS resolver is not yet published.
  const rawKey = env.HASNA_PROMPTS_API_KEY;
  const aliasUrl = env.PROMPTS_API_URL;
  // hasna-credential-seam-waiver: Presence is rejected, never resolved as a credential; canonical explicit-only API keys are the sole supported source.
  const aliasKey = env.PROMPTS_API_KEY;
  if (aliasUrl !== undefined || aliasKey !== undefined) throw new Error('prompts: legacy API aliases are unsupported; use HASNA_PROMPTS_API_URL and HASNA_PROMPTS_API_KEY');
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
