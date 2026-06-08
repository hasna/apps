import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { KnowledgeConfig } from './workspace';

export interface KnowledgeAuthConfig {
  api_key: string;
  email?: string;
  org_id?: string;
  org_slug?: string;
  user_id?: string;
  api_url?: string;
  created_at: string;
}

export interface KnowledgeAuthStatus {
  authenticated: boolean;
  source: 'env' | 'file' | 'none';
  api_url: string;
  auth_path: string;
  email: string | null;
  org_id: string | null;
  org_slug: string | null;
  user_id: string | null;
  api_key_present: boolean;
}

export const DEFAULT_KNOWLEDGE_API_URL = 'https://knowledge.hasna.xyz';

export function normalizeKnowledgeApiOrigin(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Knowledge API URL must use http or https.');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === '/api' || pathname === '/api/v1') {
    url.pathname = '/';
  } else if (pathname.endsWith('/api/v1')) {
    url.pathname = pathname.slice(0, -'/api/v1'.length) || '/';
  } else if (pathname.endsWith('/api')) {
    url.pathname = pathname.slice(0, -'/api'.length) || '/';
  }
  return url.toString().replace(/\/+$/, '');
}

export function knowledgeAuthPath(env: Record<string, string | undefined> = process.env): string {
  if (env.HASNA_KNOWLEDGE_AUTH_PATH) return env.HASNA_KNOWLEDGE_AUTH_PATH;
  const root = env.HASNA_KNOWLEDGE_AUTH_DIR ?? join(homedir(), '.hasna', 'knowledge');
  return join(root, 'auth.json');
}

export function resolveKnowledgeApiUrl(
  config?: KnowledgeConfig,
  env: Record<string, string | undefined> = process.env,
): string {
  return normalizeKnowledgeApiOrigin(env.KNOWLEDGE_API_URL ?? config?.hosted?.api_url ?? DEFAULT_KNOWLEDGE_API_URL);
}

export function getKnowledgeAuth(env: Record<string, string | undefined> = process.env): KnowledgeAuthConfig | null {
  try {
    const path = knowledgeAuthPath(env);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as KnowledgeAuthConfig;
    return typeof parsed.api_key === 'string' && parsed.api_key.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveKnowledgeAuth(
  auth: Omit<KnowledgeAuthConfig, 'created_at'> & { created_at?: string },
  env: Record<string, string | undefined> = process.env,
): KnowledgeAuthConfig {
  const path = knowledgeAuthPath(env);
  const stored: KnowledgeAuthConfig = {
    ...auth,
    api_url: auth.api_url ? normalizeKnowledgeApiOrigin(auth.api_url) : undefined,
    created_at: auth.created_at ?? new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return stored;
}

export function clearKnowledgeAuth(env: Record<string, string | undefined> = process.env): boolean {
  try {
    unlinkSync(knowledgeAuthPath(env));
    return true;
  } catch {
    return false;
  }
}

export function getKnowledgeApiKey(env: Record<string, string | undefined> = process.env): { apiKey: string | null; source: KnowledgeAuthStatus['source'] } {
  if (env.KNOWLEDGE_API_KEY) return { apiKey: env.KNOWLEDGE_API_KEY, source: 'env' };
  if (env.HASNA_KNOWLEDGE_API_KEY) return { apiKey: env.HASNA_KNOWLEDGE_API_KEY, source: 'env' };
  const auth = getKnowledgeAuth(env);
  return auth?.api_key ? { apiKey: auth.api_key, source: 'file' } : { apiKey: null, source: 'none' };
}

export function knowledgeAuthStatus(
  config?: KnowledgeConfig,
  env: Record<string, string | undefined> = process.env,
): KnowledgeAuthStatus {
  const auth = getKnowledgeAuth(env);
  const key = getKnowledgeApiKey(env);
  const apiUrl = env.KNOWLEDGE_API_URL
    ? resolveKnowledgeApiUrl(config, env)
    : auth?.api_url
      ? normalizeKnowledgeApiOrigin(auth.api_url)
      : resolveKnowledgeApiUrl(config, env);
  return {
    authenticated: Boolean(key.apiKey),
    source: key.source,
    api_url: apiUrl,
    auth_path: knowledgeAuthPath(env),
    email: key.source === 'file' ? auth?.email ?? null : null,
    org_id: key.source === 'file' ? auth?.org_id ?? null : null,
    org_slug: key.source === 'file' ? auth?.org_slug ?? null : null,
    user_id: key.source === 'file' ? auth?.user_id ?? null : null,
    api_key_present: Boolean(key.apiKey),
  };
}
