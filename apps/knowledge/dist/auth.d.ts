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
    source: 'env' | 'file' | 'none';
    api_url: string;
    auth_path: string;
    email: string | null;
    org_id: string | null;
    org_slug: string | null;
    user_id: string | null;
    api_key_present: boolean;
}
export declare const DEFAULT_KNOWLEDGE_API_URL = "https://knowledge.md";
export declare function normalizeKnowledgeApiOrigin(apiUrl: string): string;
export declare function knowledgeAuthPath(env?: Record<string, string | undefined>): string;
export declare function resolveKnowledgeApiUrl(env?: Record<string, string | undefined>): string;
export declare function getKnowledgeAuth(env?: Record<string, string | undefined>): KnowledgeAuthConfig | null;
export declare function saveKnowledgeAuth(auth: Omit<KnowledgeAuthConfig, 'created_at'> & {
    created_at?: string;
}, env?: Record<string, string | undefined>): KnowledgeAuthConfig;
export declare function clearKnowledgeAuth(env?: Record<string, string | undefined>): boolean;
export declare function getKnowledgeApiKey(env?: Record<string, string | undefined>): {
    apiKey: string | null;
    source: KnowledgeAuthStatus['source'];
};
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
