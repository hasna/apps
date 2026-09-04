import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HasnaHttpError } from '@hasna/contracts/client';
import { ownAgentClaim, ownTenantId, parseApiKey } from '@hasna/contracts/auth';
import {
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  resolveKnowledgeClientTransport,
} from './client-transport';
import { resolveKnowledgeHttpStore } from './http-store';
import { getDataHome } from './paths';
import { gatewayApiV1Root } from './api-display-url';

export interface KnowledgeAuthConfig {
  api_key: string;
  email?: string;
  org_id?: string;
  org_slug?: string;
  user_id?: string;
  api_url?: string;
  created_at: string;
}

/**
 * The identity a knowledge API key claims, decoded from the key's own signed
 * body. kid is the PUBLIC identifier servers and revocation lists key on —
 * never the key value, which is excluded here by design.
 */
export interface KnowledgeAuthPrincipal {
  kid: string;
  app: string | null;
  agent: string | null;
  tid: string | null;
}

/**
 * Why a live probe did not verify the credential. `unauthorized` covers every
 * server rejection the transport can see (401/403): the key may be revoked,
 * expired, unknown, or mis-signed — the server's deny body is deliberately
 * never read by the transport, so the client cannot tell those apart. The
 * surfaced kid lets an operator match the failure against the revocation list.
 */
export type KnowledgeAuthProbeReason =
  | 'unauthorized'
  | 'not_found'
  | 'server_error'
  | 'unreachable'
  | 'unknown';

/** Result of the live authentication probe used by `auth whoami`/`auth status`. */
export interface KnowledgeAuthProbe {
  /** Whether a live request was actually sent to the server. */
  probed: boolean;
  /** The server accepted the credential (HTTP 2xx). */
  verified: boolean;
  /** HTTP status the server answered with; null when no request was sent or no response arrived. */
  status: number | null;
  /** Why authentication failed; null when verified or not probed. */
  reason: KnowledgeAuthProbeReason | null;
  /** The claimed principal — the key that passed or failed. Never the key value. */
  principal: KnowledgeAuthPrincipal | null;
}

export interface KnowledgeAuthStatus {
  /**
   * Credential-configuration snapshot: a key is present somewhere the client
   * would use (env or auth file). This is NOT a live claim — a revoked key
   * still counts as "configured". The CLI's whoami/status overlays the live
   * probe result on top of this; library callers that need the live answer
   * must await {@link probeKnowledgeAuth}.
   */
  authenticated: boolean;
  /** Alias of `authenticated`: a key is present (kept for callers that read `configured`). */
  configured: boolean;
  source: 'env' | 'file' | 'none';
  api_url: string;
  auth_path: string;
  email: string | null;
  org_id: string | null;
  org_slug: string | null;
  user_id: string | null;
  api_key_present: boolean;
}

export const DEFAULT_KNOWLEDGE_API_URL = 'https://knowledge.md';

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
  const root = env.HASNA_KNOWLEDGE_AUTH_DIR ?? getDataHome(env);
  return join(root, 'auth.json');
}

export function resolveKnowledgeApiUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const envApiUrl = KNOWLEDGE_API_URL_ENV_KEYS
    .map((key) => env[key]?.trim())
    .find((value): value is string => Boolean(value));
  return normalizeKnowledgeApiOrigin(envApiUrl ?? DEFAULT_KNOWLEDGE_API_URL);
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
  const envApiKey = KNOWLEDGE_API_KEY_ENV_KEYS
    .map((key) => env[key])
    .find((value): value is string => Boolean(value));
  if (envApiKey) return { apiKey: envApiKey, source: 'env' };
  const auth = getKnowledgeAuth(env);
  return auth?.api_key ? { apiKey: auth.api_key, source: 'file' } : { apiKey: null, source: 'none' };
}

export function knowledgeAuthStatus(
  env: Record<string, string | undefined> = process.env,
): KnowledgeAuthStatus {
  const auth = getKnowledgeAuth(env);
  const key = getKnowledgeApiKey(env);
  const hasEnvApiUrl = KNOWLEDGE_API_URL_ENV_KEYS.some((name) => Boolean(env[name]?.trim()));
  const apiUrl = hasEnvApiUrl
    ? resolveKnowledgeApiUrl(env)
    : auth?.api_url
      ? normalizeKnowledgeApiOrigin(auth.api_url)
      : resolveKnowledgeApiUrl(env);
  return {
    authenticated: Boolean(key.apiKey),
    configured: Boolean(key.apiKey),
    source: key.source,
    // The auth-status `api_url` is a DISPLAY value: it reports the resolved
    // `/v1` root for the api.hasna.com gateway form, never the bare base or
    // origin alone (issue #1588). Legacy/self-hosted origins keep their
    // existing normalized base.
    api_url: gatewayApiV1Root(apiUrl) ?? apiUrl,
    auth_path: knowledgeAuthPath(env),
    email: key.source === 'file' ? auth?.email ?? null : null,
    org_id: key.source === 'file' ? auth?.org_id ?? null : null,
    org_slug: key.source === 'file' ? auth?.org_slug ?? null : null,
    user_id: key.source === 'file' ? auth?.user_id ?? null : null,
    api_key_present: Boolean(key.apiKey),
  };
}

/**
 * Decode the principal a knowledge API key claims (kid/app/agent/tid). The
 * claims are self-attested by whoever holds the token — this is identity
 * REPORTING for diagnostics, never authentication; the HMAC signature is only
 * verified by the server. Returns null for a malformed or non-hasna key value.
 * The key value itself is never returned.
 */
export function knowledgeApiKeyPrincipal(apiKey: string): KnowledgeAuthPrincipal | null {
  const parsed = parseApiKey(apiKey);
  if (!parsed) return null;
  return {
    kid: parsed.claims.kid,
    app: parsed.claims.app,
    agent: ownAgentClaim(parsed.claims),
    tid: ownTenantId(parsed.claims) ?? null,
  };
}

/**
 * LIVE authentication probe: one authenticated request through the exact HTTP
 * transport the read path uses (`GET /v1/notes?limit=1`), so the answer is the
 * same answer reads get — a revoked or invalid key that fails every read now
 * fails whoami the same way.
 *
 * Never probed (reason/status null): no key configured, or no hosted API
 * selected — in both cases there is nothing to authenticate against and no
 * live claim is made. 401/403 is reported as `unauthorized` with the rejected
 * key's kid surfaced, so an operator can match it against the revocation list.
 * The endpoint and 5xx/network failures are reported distinctly so a revoked
 * key is never confused with a down server.
 *
 * The probe is safe under the test network guard: it uses the same
 * `guardedFetch` the read path uses, so it is refused (not sent) for
 * non-loopback targets while NODE_ENV=test.
 */
export async function probeKnowledgeAuth(
  env: Record<string, string | undefined> = process.env,
): Promise<KnowledgeAuthProbe> {
  const key = getKnowledgeApiKey(env);
  const principal = key.apiKey ? knowledgeApiKeyPrincipal(key.apiKey) : null;
  const notProbed: KnowledgeAuthProbe = {
    probed: false,
    verified: false,
    status: null,
    reason: null,
    principal,
  };
  if (!key.apiKey) return notProbed;
  // Authenticate only against the transport reads actually use. Under the
  // explicit HASNA_KNOWLEDGE_LOCAL opt-in the client reads the on-box store,
  // so whoami must not suddenly send a key anywhere. Without hosted config AND
  // without the opt-in the transport resolver fails closed (client-transport
  // resolution throws); that rejection propagates — a key with nowhere
  // authorized to go is exactly the state whoami must surface as an error.
  if (resolveKnowledgeClientTransport(env).transport !== 'http') return notProbed;
  const store = resolveKnowledgeHttpStore(env);
  if (!store) return { ...notProbed, probed: true, reason: 'unreachable' };
  try {
    await store.list({ limit: 1 });
    return { probed: true, verified: true, status: 200, reason: null, principal };
  } catch (error) {
    if (error instanceof HasnaHttpError) {
      const { status } = error;
      const reason: KnowledgeAuthProbeReason =
        status === 401 || status === 403
          ? 'unauthorized'
          : status === 404
            ? 'not_found'
            : status >= 500
              ? 'server_error'
              : 'unknown';
      return { probed: true, verified: false, status, reason, principal };
    }
    return { probed: true, verified: false, status: null, reason: 'unreachable', principal };
  }
}
