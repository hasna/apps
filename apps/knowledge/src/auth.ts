import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  appConfigDiskValue,
  CredentialResolutionError,
  HasnaHttpError,
  keychainConfigValue,
  resolveCredential,
  type CredentialTier,
} from '@hasna/contracts/client';
import { ownAgentClaim, ownTenantId, parseApiKey } from '@hasna/contracts/auth';
import {
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  KNOWLEDGE_APP_SLUG,
  KNOWLEDGE_DEFAULT_API_URL,
  knowledgeKeychainTierOptions,
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
  /**
   * WHICH KIND of source supplied the credential — `keychain` for the macOS
   * Keychain item, `file` for `~/.hasna/knowledge/config/credentials` (or the
   * legacy `auth.json`), `env` for an environment tier, `none` when nothing
   * resolved. `source_ref` names the exact one.
   */
  source: KnowledgeCredentialSourceKind;
  api_url: string;
  auth_path: string;
  email: string | null;
  org_id: string | null;
  org_slug: string | null;
  user_id: string | null;
  api_key_present: boolean;
  /** The exact source: an env key NAME, a Keychain item reference, or a file PATH. Never a value. */
  source_ref: string | null;
  /** Which tier of the shared @hasna/contracts chain answered, when one did. */
  tier: CredentialTier | null;
}

/**
 * The default authority: the fleet gateway `https://api.hasna.com/knowledge`
 * (the client appends `/v1`). It replaced the per-app `https://knowledge.md`
 * origin with the 2026-09-04 URL ruling — a URL never needs configuring, and a
 * key from any tier is enough to reach the fleet.
 */
export const DEFAULT_KNOWLEDGE_API_URL = KNOWLEDGE_DEFAULT_API_URL;

/** Which KIND of source answered the credential chain. */
export type KnowledgeCredentialSourceKind = 'env' | 'keychain' | 'file' | 'none';

/** The credential the shared chain resolved, described without its value. */
export interface KnowledgeCredentialResolution {
  /** The secret, or null when nothing resolved (or when only a vault pointer is configured). */
  apiKey: string | null;
  source: KnowledgeCredentialSourceKind;
  /** An env key NAME, a Keychain item reference, or an absolute file PATH. Never a value. */
  sourceRef: string | null;
  /** The shared chain's tier, or null for the legacy auth.json fallback and for nothing. */
  tier: CredentialTier | null;
}

/** Map a shared-chain tier onto the kind of place it read from. */
function credentialSourceKind(tier: CredentialTier): KnowledgeCredentialSourceKind {
  if (tier === 'keychain') return 'keychain';
  if (tier === 'disk' || tier === 'profile') return 'file';
  return 'env';
}

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

/**
 * The service authority, through the shared ladder: `HASNA_KNOWLEDGE_API_URL`
 * (then its unprefixed alias), the Keychain `api-url` item, the credentials
 * file, and finally the fleet gateway. Returns the normalized base — the
 * caller appends `/v1`, and {@link gatewayApiV1Root} renders the display form.
 */
export function resolveKnowledgeApiUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return normalizeKnowledgeApiOrigin(resolveKnowledgeApiAuthority(env).url);
}

/** The authority and the SOURCE that decided it (an env key name, a Keychain item, a path, or 'default'). */
export function resolveKnowledgeApiAuthority(
  env: Record<string, string | undefined> = process.env,
): { url: string; source: string } {
  const envKey = KNOWLEDGE_API_URL_ENV_KEYS.find((key) => Boolean(env[key]?.trim()));
  if (envKey) return { url: env[envKey]!.trim(), source: envKey };
  const keychain = keychainConfigValue(KNOWLEDGE_APP_SLUG, env, knowledgeKeychainTierOptions(env));
  if (keychain) return { url: keychain.value, source: keychain.source };
  const disk = appConfigDiskValue(KNOWLEDGE_APP_SLUG, env, KNOWLEDGE_API_URL_ENV_KEYS);
  if (disk && !disk.unusable && disk.value.trim()) return { url: disk.value.trim(), source: disk.path };
  return { url: DEFAULT_KNOWLEDGE_API_URL, source: 'default' };
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

/**
 * The client credential, resolved through the SHARED chain in
 * `@hasna/contracts/client` — argument, deliberate env pointer, macOS
 * Keychain, `~/.hasna/knowledge/config/credentials`, then
 * `HASNA_KNOWLEDGE_API_KEY`. This package no longer carries a second copy of
 * that precedence.
 *
 * `auth.json` — what `knowledge auth login` writes — is consulted only when
 * the shared chain answers with nothing. It is a documented LEGACY fallback
 * kept for one release so an existing login keeps working; move the key to the
 * Keychain item or the credentials file. A deliberate tier that cannot be
 * honoured throws instead of falling through to it: `auth login` is not an
 * identity the operator asked for when they named another one.
 */
export function getKnowledgeApiKey(
  env: Record<string, string | undefined> = process.env,
): KnowledgeCredentialResolution {
  const resolved = resolveCredential(KNOWLEDGE_APP_SLUG, env, {
    keychain: knowledgeKeychainTierOptions(env),
  });
  if (resolved) {
    return {
      apiKey: resolved.tier === 'pointer' ? null : resolved.apiKey,
      source: credentialSourceKind(resolved.tier),
      sourceRef: resolved.source,
      tier: resolved.tier,
    };
  }
  const auth = getKnowledgeAuth(env);
  return auth?.api_key
    ? { apiKey: auth.api_key, source: 'file', sourceRef: knowledgeAuthPath(env), tier: null }
    : { apiKey: null, source: 'none', sourceRef: null, tier: null };
}

export function knowledgeAuthStatus(
  env: Record<string, string | undefined> = process.env,
): KnowledgeAuthStatus {
  const auth = getKnowledgeAuth(env);
  const key = getKnowledgeApiKey(env);
  const authority = resolveKnowledgeApiAuthority(env);
  // The legacy auth.json `api_url` decides only when nothing in the shared
  // ladder does — an env var, the Keychain item and the credentials file all
  // outrank it, exactly as they do for the key.
  const apiUrl = authority.source === 'default' && auth?.api_url
    ? normalizeKnowledgeApiOrigin(auth.api_url)
    : normalizeKnowledgeApiOrigin(authority.url);
  // A vault pointer carries no value until request time, yet a credential IS
  // configured; reporting it as unauthenticated would be a false negative.
  const configured = Boolean(key.apiKey) || key.tier === 'pointer';
  return {
    authenticated: configured,
    configured,
    source: key.source,
    // The auth-status `api_url` is a DISPLAY value: it reports the resolved
    // `/v1` root for the api.hasna.com gateway form, never the bare base or
    // origin alone (issue #1588). Legacy/self-hosted origins keep their
    // existing normalized base.
    api_url: gatewayApiV1Root(apiUrl) ?? apiUrl,
    auth_path: knowledgeAuthPath(env),
    email: key.tier === null && key.source === 'file' ? auth?.email ?? null : null,
    org_id: key.tier === null && key.source === 'file' ? auth?.org_id ?? null : null,
    org_slug: key.tier === null && key.source === 'file' ? auth?.org_slug ?? null : null,
    user_id: key.tier === null && key.source === 'file' ? auth?.user_id ?? null : null,
    api_key_present: configured,
    source_ref: key.sourceRef,
    tier: key.tier,
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
  // A vault pointer has no value here but does authenticate at request time.
  if (!key.apiKey && key.tier !== 'pointer') return notProbed;
  // Authenticate only against the transport reads actually use. With nothing
  // configured anywhere the client reads the on-box store, so whoami must not
  // suddenly send a key anywhere. A configured authority whose credential does
  // not resolve makes the shared resolver throw, and that rejection propagates
  // — a key with nowhere authorized to go is exactly the state whoami must
  // surface as an error.
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
