import type { KnowledgeConfig } from './workspace';
import { KnowledgeContainmentError } from './runtime-role';

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

function containedAuth(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    'hosted-client',
    'public-api',
    'authentication storage is unavailable during Stage A',
  );
}

export function normalizeKnowledgeApiOrigin(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Knowledge API URL must use http or https.');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === '/api' || pathname === '/api/v1') url.pathname = '/';
  else if (pathname.endsWith('/api/v1')) url.pathname = pathname.slice(0, -'/api/v1'.length) || '/';
  else if (pathname.endsWith('/api')) url.pathname = pathname.slice(0, -'/api'.length) || '/';
  return url.toString().replace(/\/+$/, '');
}

export function knowledgeAuthPath(env?: Record<string, string | undefined>): string;
export function knowledgeAuthPath(): string {
  return containedAuth();
}

export function resolveKnowledgeApiUrl(
  config?: KnowledgeConfig,
  env?: Record<string, string | undefined>,
): string;
export function resolveKnowledgeApiUrl(config?: KnowledgeConfig): string {
  return containedAuth();
}

export function getKnowledgeAuth(env?: Record<string, string | undefined>): KnowledgeAuthConfig | null;
export function getKnowledgeAuth(): KnowledgeAuthConfig | null {
  return containedAuth();
}

export function saveKnowledgeAuth(
  auth: Omit<KnowledgeAuthConfig, 'created_at'> & { created_at?: string },
  env?: Record<string, string | undefined>,
): KnowledgeAuthConfig;
export function saveKnowledgeAuth(
  auth: Omit<KnowledgeAuthConfig, 'created_at'> & { created_at?: string },
): KnowledgeAuthConfig {
  return containedAuth();
}

export function clearKnowledgeAuth(env?: Record<string, string | undefined>): boolean;
export function clearKnowledgeAuth(): boolean {
  return containedAuth();
}

export function getKnowledgeApiKey(env?: Record<string, string | undefined>): {
  apiKey: string | null;
  source: KnowledgeAuthStatus['source'];
};
export function getKnowledgeApiKey(): { apiKey: string | null; source: KnowledgeAuthStatus['source'] } {
  return containedAuth();
}

export function knowledgeAuthStatus(
  config?: KnowledgeConfig,
  env?: Record<string, string | undefined>,
): KnowledgeAuthStatus;
export function knowledgeAuthStatus(config?: KnowledgeConfig): KnowledgeAuthStatus {
  return containedAuth();
}
