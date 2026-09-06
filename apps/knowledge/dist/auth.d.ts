import { type CredentialTier } from '@hasna/contracts/client';
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
export type KnowledgeAuthProbeReason = 'unauthorized' | 'not_found' | 'server_error' | 'unreachable' | 'unknown';
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
     * Keychain item, `file` for `~/.hasna/knowledge/config/credentials`, `env`
     * for an environment tier, `none` when nothing resolved. `source_ref` names
     * the exact one. The legacy `auth.json` is never a source.
     */
    source: KnowledgeCredentialSourceKind;
    api_url: string;
    /** The canonical credentials file path the DISK tier reads (`auth login` writes it). */
    auth_path: string;
    /**
     * Always null at runtime: the canonical credentials file format carries no
     * email/org metadata, and the retired auth.json is never consulted.
     */
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
export declare const DEFAULT_KNOWLEDGE_API_URL: string;
/** Which KIND of source answered the credential chain. */
export type KnowledgeCredentialSourceKind = 'env' | 'keychain' | 'file' | 'none';
/** The credential the shared chain resolved, described without its value. */
export interface KnowledgeCredentialResolution {
    /** The secret, or null when nothing resolved (or when only a vault pointer is configured). */
    apiKey: string | null;
    source: KnowledgeCredentialSourceKind;
    /** An env key NAME, a Keychain item reference, or an absolute file PATH. Never a value. */
    sourceRef: string | null;
    /**
     * The shared chain's tier, or null when nothing resolved. The legacy
     * auth.json file is never consulted.
     */
    tier: CredentialTier | null;
}
export declare function normalizeKnowledgeApiOrigin(apiUrl: string): string;
export declare function knowledgeAuthPath(env?: Record<string, string | undefined>): string;
/**
 * The canonical credentials file the shared chain's DISK tier reads:
 * `~/.hasna/knowledge/config/credentials` (0400/0600; `HASNA_HOME` /
 * `HASNA_CONFIG_HOME` move the root), derived from the resolver itself so this
 * module never carries a second copy of that precedence. `knowledge auth
 * login` writes here; `auth status` reports it as `auth_path`; `auth logout`
 * removes it.
 */
export declare function knowledgeCredentialsPath(env?: Record<string, string | undefined>): string;
/**
 * The service authority, through the shared ladder: `HASNA_KNOWLEDGE_API_URL`
 * (then its unprefixed alias), the Keychain `api-url` item, the credentials
 * file, and finally the fleet gateway. Returns the normalized base — the
 * caller appends `/v1`, and {@link gatewayApiV1Root} renders the display form.
 */
export declare function resolveKnowledgeApiUrl(env?: Record<string, string | undefined>): string;
/** The authority and the SOURCE that decided it (an env key name, a Keychain item, a path, or 'default'). */
export declare function resolveKnowledgeApiAuthority(env?: Record<string, string | undefined>): {
    url: string;
    source: string;
};
/**
 * LEGACY auth.json store, kept read/write for migration and for API
 * compatibility only. `knowledge auth login` no longer writes here, and the
 * credential chain NEVER consults this file: since 0.3.2 the client resolves
 * credentials only through the shared @hasna/contracts chain plus the
 * canonical `~/.hasna/knowledge/config/credentials` file
 * ({@link knowledgeCredentialsPath}). A login written to auth.json by an older
 * release is invisible to every surface — move it to the Keychain item or the
 * credentials file.
 */
export declare function getKnowledgeAuth(env?: Record<string, string | undefined>): KnowledgeAuthConfig | null;
/**
 * LEGACY auth.json writer, kept for API compatibility; the chain never reads
 * what it writes. New logins land in the canonical credentials file
 * ({@link saveKnowledgeCredentials}).
 */
export declare function saveKnowledgeAuth(auth: Omit<KnowledgeAuthConfig, 'created_at'> & {
    created_at?: string;
}, env?: Record<string, string | undefined>): KnowledgeAuthConfig;
/**
 * LEGACY auth.json remover, kept for API compatibility. The credentials the
 * chain actually reads are removed with {@link clearKnowledgeCredentials}.
 */
export declare function clearKnowledgeAuth(env?: Record<string, string | undefined>): boolean;
/**
 * Write the client credential to the canonical credentials file
 * (`~/.hasna/knowledge/config/credentials`, 0600) — the DISK tier of the
 * shared chain. This is what `knowledge auth login` does, so a login lands on
 * a tier the resolver actually reads, and `auth whoami` right after a login
 * probes through it. The URL line is written only when one is given or
 * configured in the env; with nothing configured the fleet gateway default
 * applies at read time. Email/org metadata is not representable in the
 * canonical file format and is not persisted.
 */
export declare function saveKnowledgeCredentials(auth: Omit<KnowledgeAuthConfig, 'created_at'> & {
    created_at?: string;
}, env?: Record<string, string | undefined>): KnowledgeAuthConfig;
/** Remove the canonical credentials file. Returns false when nothing was there. */
export declare function clearKnowledgeCredentials(env?: Record<string, string | undefined>): boolean;
/**
 * The client credential, resolved through the SHARED chain in
 * `@hasna/contracts/client` — argument, deliberate env pointer, macOS
 * Keychain, `~/.hasna/knowledge/config/credentials`, then
 * `HASNA_KNOWLEDGE_API_KEY`. This package no longer carries a second copy of
 * that precedence, and the legacy `auth.json` file is NOT consulted at all:
 * a fallback read from a different file would authenticate as a principal the
 * operator did not name, the same false green the fail-closed ruling closes.
 * A deliberate tier that cannot be honoured throws instead of falling through.
 */
export declare function getKnowledgeApiKey(env?: Record<string, string | undefined>): KnowledgeCredentialResolution;
export declare function knowledgeAuthStatus(env?: Record<string, string | undefined>): KnowledgeAuthStatus;
/**
 * Decode the principal a knowledge API key claims (kid/app/agent/tid). The
 * claims are self-attested by whoever holds the token — this is identity
 * REPORTING for diagnostics, never authentication; the HMAC signature is only
 * verified by the server. Returns null for a malformed or non-hasna key value.
 * The key value itself is never returned.
 */
export declare function knowledgeApiKeyPrincipal(apiKey: string): KnowledgeAuthPrincipal | null;
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
export declare function probeKnowledgeAuth(env?: Record<string, string | undefined>): Promise<KnowledgeAuthProbe>;
