/**
 * Structural spellings of the @hasna/contracts types that cross this package's
 * published boundary (client credential seams, the serve API-key surface, and
 * the project panel contract).
 *
 * WHY THIS FILE EXISTS. `@hasna/contracts` is a runtime dependency here, but
 * its DISTRIBUTION is not strict-consumer-safe: its `.d.ts` files use
 * extensionless relative imports, so any consumer that type-checks with
 * `moduleResolution: nodenext` + `skipLibCheck: false` fails with TS2835 as
 * soon as a `@hasna/knowledge` declaration imports a contracts type. The
 * published `.d.ts` therefore spells every crossing type structurally, HERE,
 * and the sibling `contracts-types.test.ts` asserts each spelling is
 * mutually assignable with the real contracts declaration — so a drifted
 * shape fails `tsc` in the same build step that emits the declarations.
 *
 * This file is NOT the vendored resolver: no imports, no runtime statement,
 * only the shapes, copied from the @hasna/contracts@1.0.2 declarations.
 * Source files keep importing the resolver and its VALUES from contracts at
 * runtime; only the types they name in public signatures come from here.
 *
 * Do not add an import. Do not add a value. This file must stay a leaf.
 */
/** Which link of the credential chain supplied the key. */
export type CredentialTier = "argument" | "override" | "pointer" | "profile" | "keychain" | "disk" | "env";
/** The captured outcome of one `security` invocation. `stdout` IS the secret. */
export interface KeychainCommandResult {
    status: number | null;
    stdout: string;
    stderr: string;
}
/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type KeychainCommandRunner = (argv: readonly string[]) => KeychainCommandResult;
/** Tier 3 controls. Every field is optional; production callers pass nothing. */
export interface KeychainTierOptions {
    enabled?: boolean;
    platform?: string;
    hostname?: () => string;
    run?: KeychainCommandRunner;
}
/** The shared client transport. */
export interface HasnaHttpTransport {
    readonly baseUrl: string;
    request<T = unknown>(method: string, path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
    get<T = unknown>(path: string, opts?: HasnaRequestOptions): Promise<T>;
    post<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
    put<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
    patch<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
    del<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
}
export type QueryParams = URLSearchParams | Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>>;
export interface HasnaRetryOptions {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    retryStatuses?: number[];
}
/** Per-call request options: query, idempotency, timeout, retry, extra headers. */
export interface HasnaRequestOptions {
    query?: QueryParams;
    idempotencyKey?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
    retry?: HasnaRetryOptions | false;
    signal?: AbortSignal;
}
/** The app storage client surface returned by the authenticated service API. */
export interface HasnaStorageClient {
    readonly name: string;
    readonly baseUrl: string;
    readonly transport: HasnaHttpTransport;
    list<T = unknown>(resource: string, options?: StorageListOptions): Promise<StorageListResult<T>>;
    get<T = unknown>(resource: string, id: string, options?: StorageGetOptions): Promise<T | null>;
    create<T = unknown>(resource: string, body: unknown, options?: StorageCreateOptions): Promise<T>;
    update<T = unknown>(resource: string, id: string, patch: unknown, options?: StorageUpdateOptions): Promise<T>;
    delete(resource: string, id: string, options?: StorageDeleteOptions): Promise<void>;
}
export type StorageListOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal"> & {
    query?: QueryParams;
};
export type StorageGetOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query">;
export type StorageCreateOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query"> & {
    idempotencyKey?: string;
};
export type StorageUpdateOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query"> & {
    method?: "PATCH" | "PUT";
    idempotencyKey?: string;
};
export type StorageDeleteOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query">;
export interface StorageListResult<T> {
    items: T[];
    total: number | null;
    cursor: string | null;
    raw: unknown;
}
export type ApiKeyStatus = "active" | "revoked" | "expired" | "unknown";
/** Token claims the verifier signs and the principal carries. */
export interface ApiKeyClaims {
    v: number;
    kid: string;
    app: string;
    tid?: string;
    scopes: string[];
    iat: number;
    exp: number | null;
    agent?: string;
}
export type ApiKeyVerifyFailureReason = "malformed" | "unsupported_version" | "app_mismatch" | "bad_signature" | "not_yet_valid" | "expired" | "revoked" | "insufficient_scope" | "tenant_required" | "tenant_mismatch";
/** Every reason a request can be refused, plus the two the verifier reports itself. */
export type AuthDenyReason = ApiKeyVerifyFailureReason | "missing_token" | "unknown_key" | "status_unavailable";
/** Header sources the middleware can read tokens from. */
export type HeaderSource = Headers | Record<string, string | string[] | undefined> | ((name: string) => string | null | undefined);
/** Authenticated principal attached to a request on success. */
export interface ApiKeyPrincipal {
    kid: string;
    app: string;
    scopes: string[];
    agent: string | null;
    tid: string | null;
    claims: ApiKeyClaims;
}
export type AuthDecision = {
    ok: true;
    status: 200;
    principal: ApiKeyPrincipal;
} | {
    ok: false;
    status: 401 | 403 | 503;
    reason: AuthDenyReason;
    message: string;
};
export interface ApiKeyAuthContext {
    method?: string | null;
    path?: string | null;
    requiredScopes?: readonly string[];
    expectedTid?: string;
}
/** The framework-agnostic verifier surface `verifyApiKey()` produces. */
export interface ApiKeyVerifier {
    authenticate(headers: HeaderSource, context?: ApiKeyAuthContext): Promise<AuthDecision>;
    readonly app: string;
}
/**
 * The DB-backed API-key store surface the serve depends on — the subset of
 * `@hasna/contracts/auth`'s `ApiKeyStore` this package names in `ServeDeps`.
 * `contracts-types.test.ts` proves a real `ApiKeyStore` satisfies it.
 */
export interface ServeApiKeyStore {
    readonly table: string;
    /** Bound lifecycle resolver for `verifyApiKey({ keyStatus })`. */
    keyStatus: (kid: string) => Promise<ApiKeyStatus>;
    /** Revocation check: return true to DENY. */
    isRevoked: (kid: string) => Promise<boolean>;
    /** Record last-used for a kid (best-effort telemetry). */
    touchLastUsed(kid: string, atMs?: number): Promise<void>;
}
export interface ProjectPanelProvider {
    id: string;
    kind: "custom" | "knowledge" | "actions" | "files" | "mailery" | "conversations" | "mementos" | "reports" | "render" | "todos" | "contracts";
    name?: string | undefined;
    externalId?: string | undefined;
    sourcePackage?: string | undefined;
}
export type ProjectPanelResourceKind = "knowledge" | "render" | "app" | "email" | "feedback" | "report" | "run" | "unknown" | "file" | "url" | "model" | "workflow" | "budget" | "task" | "project" | "repo" | "loop" | "action" | "event" | "integration" | "session" | "machine" | "tool" | "document" | "artifact" | "conversation" | "dashboard" | "panel" | "commit" | "branch" | "pull_request" | "issue" | "comment" | "verification" | "finding" | "context_pack" | "proof_bundle" | "memento" | "eval" | "cost" | "alert" | "incident" | "release" | "rollout" | "announcement" | "audience";
export interface ProjectPanelResourceRef {
    id: string;
    kind: ProjectPanelResourceKind;
    tags: string[];
    name?: string | undefined;
    uri?: string | undefined;
    externalId?: string | undefined;
    sourcePackage?: string | undefined;
}
export type ProjectPanelEvidenceKind = "report" | "file" | "url" | "artifact" | "video" | "other" | "command_output" | "screenshot" | "log" | "diff" | "har" | "test_result" | "metric" | "trace";
export interface ProjectPanelEvidenceRef {
    id: string;
    kind?: ProjectPanelEvidenceKind | undefined;
    sha256?: string | undefined;
    uri?: string | undefined;
    summary?: string | undefined;
}
export interface ProjectPanelItem {
    id: string;
    resourceRefs: ProjectPanelResourceRef[];
    evidenceRefs: ProjectPanelEvidenceRef[];
    priority: "unknown" | "low" | "medium" | "high" | "critical";
    title: string;
    status?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    summary?: string | undefined;
    timestamp?: string | undefined;
}
export interface ProjectPanelMetric {
    id: string;
    value: string | number | false | true;
    status: "unknown" | "critical" | "good" | "warning";
    resourceRefs: ProjectPanelResourceRef[];
    label: string;
    unit?: string | undefined;
}
export interface ProjectPanelRenderImport {
    id: string;
    optional: boolean;
    kind: "url" | "local" | "provider" | "package";
    specifier: string;
    path?: string | undefined;
    provider?: ProjectPanelProvider["kind"] | undefined;
    uri?: string | undefined;
    packageName?: string | undefined;
    resourceRef?: ProjectPanelResourceRef | undefined;
    schemaId?: string | undefined;
    integrity?: string | undefined;
}
export interface ProjectPanelRenderFragment {
    imports: ProjectPanelRenderImport[];
    renderer: "custom" | "json_render" | "react_flow" | "markdown" | "html";
    spec: Record<string, unknown>;
    title?: string | undefined;
    entry?: string | undefined;
}
/** `hasna.project_panel.v1` — the panel document projects hand to renderers. */
export interface ProjectPanel {
    id: string;
    kind: "custom" | "knowledge" | "actions" | "files" | "mailery" | "conversations" | "mementos" | "reports" | "documents" | "overview" | "tasks" | "timeline" | "risks";
    provider: ProjectPanelProvider;
    schema: "hasna.project_panel.v1";
    createdAt: string;
    resourceRefs: ProjectPanelResourceRef[];
    evidenceRefs: ProjectPanelEvidenceRef[];
    projectId: string;
    actions: ProjectPanelResourceRef[];
    state: "error" | "ready" | "unavailable" | "stale" | "empty" | "loading" | "auth_required";
    title: string;
    items: ProjectPanelItem[];
    freshness: "unknown" | "stale" | "fresh";
    generatedAt: string;
    metrics: ProjectPanelMetric[];
    warnings: string[];
    updatedAt?: string | null | undefined;
    metadata?: Record<string, unknown> | undefined;
    summary?: string | undefined;
    stateReason?: string | undefined;
    renderFragment?: ProjectPanelRenderFragment | undefined;
}
