import { validateEncryptionReceipt } from "../encryption-maintenance.js";
// Typed client for the secrets serve API (@hasna/secrets/sdk).
//
// The method surface mirrors the serve OpenAPI document (src/server/openapi.ts).
// It does NOT open its own HTTP transport: every authenticated request routes
// through the ONE shared Hasna transport (createHasnaHttpTransport) that the
// ApiStore uses, so there is a single auth/retry/timeout implementation — no
// second parallel transport. Auth is sent as BOTH `Authorization: Bearer` and
// `x-api-key` (the serve accepts either), matching the Store transport exactly.
//
// URL SHAPE (hasna/apps#1720 validation). The shared transport canonicalises
// WHATEVER base it is given to `<origin-and-path>/v1` and joins request paths
// onto that, so the data routes below are spelled RELATIVE TO `/v1` (`/secrets`,
// `/items`, `/users`, `/audit`) — exactly as the ApiStore spells them. A base of
// `https://api.hasna.com/secrets` and one of `https://api.hasna.com/secrets/v1`
// therefore address the same API. The three PUBLIC probes (`/health`, `/ready`,
// `/version`) live ABOVE `/v1` on the serve and on the gateway, and the contract
// marks them `security: []`: they are fetched at `<origin-and-path>/health` etc.
// WITHOUT a credential, because the authenticated transport cannot address a
// path outside its base and must not attach the key to a public endpoint.
//
// This is a client-only surface: it always talks to a remote `<baseUrl>` and can
// never touch local data, so it cannot split-brain.

import { createHasnaHttpTransport, HasnaHttpError } from "../store/client.js";
// TYPES come from the published spelling. `CredentialProvider` in particular is
// part of `SecretsClientOptions`, which IS the `.`/`./sdk` type entry: naming
// @hasna/contracts here would put a build-time-only import into dist/sdk.d.ts
// and break every TS consumer (see ../store/client-types.ts).
import type {
  CredentialProvider,
  HasnaHttpTransport,
  HasnaRequestOptions,
  QueryParams,
} from "../store/client-types.js";

export interface Status { "status": string; "version": string; "mode": string }

export type ReadyStatus = Status & { "pendingMigrations"?: Array<string> };

export interface SecretMetadata { "key": string; "type": "api_key" | "password" | "token" | "credential" | "other"; "label"?: string | null; "expires_at"?: string | null; "created_at": string; "updated_at": string }

export interface Secret { "key": string; "value": string; "type": string; "label"?: string | null; "expires_at"?: string | null; "created_at"?: string; "updated_at"?: string }

export interface SecretInput { "key": string; "value": string; "type"?: "api_key" | "password" | "token" | "credential" | "other"; "label"?: string; "ttl"?: string; "reason"?: string; "change_kind"?: string; "batch_id"?: string }

export type VersionChangeKind = "initial" | "set" | "rotation" | "import" | "restore" | "migration";

export interface SecretVersionMeta {
  "version": number;
  "change_kind": VersionChangeKind;
  "reason"?: string | null;
  "label"?: string | null;
  "created_at": string;
  "created_by": string;
  "source_version"?: number | null;
  "batch_id"?: string | null;
  "provider_expires_at"?: string | null;
  "value_length": number;
  "fingerprint": string;
  "current": boolean;
}

export type SecretVersionCheck = SecretVersionMeta & { "hash": string };

export interface RestoreInput {
  "key": string;
  "version": number;
  "reason": string;
  "expected_current_version": number;
}

export interface VaultItemMetadata { "id": string; "kind": string; "title": string; "subtitle"?: string | null; "domains": Array<string>; "tags": Array<string>; "favorite": boolean; "created_at": string; "updated_at": string }

export type VaultItem = VaultItemMetadata & { "data": Record<string, unknown> };

export interface VaultItemInput { "id"?: string; "kind": string; "title": string; "subtitle"?: string; "domains"?: Array<string>; "tags"?: Array<string>; "favorite"?: boolean; "data": Record<string, unknown> }

export interface UserInput { "id": string; "name": string; "type"?: "human" | "agent" }

export interface SecretsClientOptions {
  /**
   * The service authority: an origin (`https://secrets.your-deployment.example`)
   * or a gateway prefix (`https://api.hasna.com/secrets`). A trailing `/v1` is
   * accepted and means the same thing — the data routes are sent under
   * `<baseUrl>/v1/...` either way, and the public probes under `<baseUrl>/`.
   */
  baseUrl: string;
  /**
   * API key, sent as Bearer + x-api-key.
   *
   * Prefer a {@link CredentialProvider} — the shared transport calls it fresh
   * for every request, so a long-lived client picks up a key rotation (and the
   * `HASNA_SECRETS_API_KEY_REF` pointer tier) without being rebuilt. A plain
   * string is still accepted and is treated as a deliberate, explicit
   * credential. `createSecretsClientFromEnv` passes a provider.
   */
  apiKey?: string | CredentialProvider;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class SecretsClient {
  private readonly transport: HasnaHttpTransport;
  /** `<origin-and-path>` root above `/v1`, where the public probes live. */
  private readonly probeRoot: string;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: SecretsClientOptions) {
    if (!options.baseUrl) throw new Error("SecretsClient requires a baseUrl.");
    // Loud refusal, never an unauthenticated transport (adversarial
    // credential-seam audit, hasna/apps#1720): `apiKey` is the ONLY
    // credential a direct client can carry, and a baseUrl with no key (or a
    // blank one) would silently build a transport that sends NO auth header —
    // an unauthenticated client that looks like a vault client. Callers who
    // mean to use the ambient credential chain (Keychain
    // hasna.credentials.secrets.api-key, ~/.hasna/secrets/config/credentials,
    // HASNA_SECRETS_API_KEY) must go through {@link createSecretsClientFromEnv};
    // a direct client names its own key (or a per-request CredentialProvider).
    if (options.apiKey === undefined || options.apiKey === "") {
      throw new Error(
        "SECRETS_CLIENT_PIN_REQUIRED: a SecretsClient with an explicit baseUrl requires an explicit apiKey " +
          "(or a CredentialProvider). The ambient fleet credential (Keychain hasna.credentials.secrets.api-key, " +
          "~/.hasna/secrets/config/credentials, HASNA_SECRETS_API_KEY) is never sent to a caller-supplied " +
          "authority: pass `apiKey` explicitly, or build the client with createSecretsClientFromEnv() and let " +
          "HASNA_SECRETS_API_URL / the @hasna/contracts chain resolve the authority and the credential together.",
      );
    }
    // The transport validates the authority and canonicalises it to
    // `<origin-and-path>/v1`; every data route below is relative to that.
    this.transport = createHasnaHttpTransport({
      name: "secrets",
      baseUrl: options.baseUrl.replace(/\/+$/, ""),
      apiKey: options.apiKey,
      ...(options.fetch ? { fetchImpl: (input, init) => options.fetch!(input, init) } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    this.probeRoot = this.transport.baseUrl.replace(/\/v1$/, "");
    this.fetchImpl = options.fetch
      ? (input, init) => options.fetch!(input, init)
      : (input, init) => fetch(input, init);
    this.baseHeaders = options.headers ?? {};
  }

  /**
   * The canonical `<origin-and-path>/v1` root every data route is joined onto.
   * Names an authority only — never a credential.
   */
  get baseUrl(): string {
    return this.transport.baseUrl;
  }

  /**
   * A PUBLIC probe (`/health`, `/ready`, `/version`): fetched at the root above
   * `/v1`, with no credential attached and no redirect followed. The contract
   * declares these `security: []`, and the serve and the gateway answer them
   * only there (`/v1/health` is a 404 on both).
   */
  private async probe<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders };
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    const response = await this.fetchImpl(`${this.probeRoot}${path}`, {
      ...init,
      method: "GET",
      headers,
      redirect: "manual",
    });
    const text = await response.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      throw new ApiError(response.status, `GET ${path} failed: ${response.status}`, body);
    }
    return body as T;
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const requestOpts: HasnaRequestOptions = {};
    if (opts.query) requestOpts.query = opts.query as QueryParams;
    const initHeaders = opts.init?.headers as Record<string, string> | undefined;
    if (initHeaders) requestOpts.headers = initHeaders;
    if (opts.init?.signal) requestOpts.signal = opts.init.signal;
    try {
      return await this.transport.request<T>(method, path, opts.body, requestOpts);
    } catch (error) {
      if (error instanceof HasnaHttpError) {
        throw new ApiError(error.status, `${method} ${path} failed: ${error.status}`, error.body);
      }
      throw error;
    }
  }

    /** Liveness probe */
    async health(init?: RequestInit): Promise<Status> {
      return this.probe(`/health`, init);
    }

    /** Readiness probe */
    async ready(init?: RequestInit): Promise<ReadyStatus> {
      return this.probe(`/ready`, init);
    }

    /** List audit log entries */
    async listAudit(query?: { "key"?: string; "limit"?: number }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/audit`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List vault item metadata */
    async listItems(query?: { "kind"?: string }, init?: RequestInit): Promise<{ "items"?: Array<VaultItemMetadata> }> {
      return this.request("GET", `/items`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create or update a vault item */
    async putItem(body: VaultItemInput, init?: RequestInit): Promise<VaultItem> {
      return this.request("POST", `/items`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Search vault item metadata */
    async searchItems(query?: { "q": string }, init?: RequestInit): Promise<{ "results"?: Array<VaultItemMetadata> }> {
      return this.request("GET", `/items/search`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Get a vault item with decrypted payload */
    async getItem(id: string, init?: RequestInit): Promise<VaultItem> {
      return this.request("GET", `/items/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a vault item */
    async deleteItem(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("DELETE", `/items/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List secret metadata */
    async listSecrets(query?: { "namespace"?: string }, init?: RequestInit): Promise<{ "secrets"?: Array<SecretMetadata> }> {
      return this.request("GET", `/secrets`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create or update a secret */
    async putSecret(body: SecretInput, init?: RequestInit): Promise<SecretMetadata> {
      return this.request("POST", `/secrets`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Delete a secret by key */
    async deleteSecret(query?: { "key": string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("DELETE", `/secrets`, {
        body: undefined,
        query,
        init,
      });
    }

    async encryptionStatus(init?: RequestInit): Promise<import("../encryption-maintenance.js").EncryptionReceipt> {
      return validateEncryptionReceipt(await this.request("GET", "/encryption/status", { init }));
    }

    async repairEncryption(init?: RequestInit): Promise<import("../encryption-maintenance.js").EncryptionReceipt> {
      return validateEncryptionReceipt(await this.request("POST", "/encryption/repair", { body: {}, init }));
    }

    /** Atomically prune expired secrets in the authenticated tenant. */
    async pruneExpiredSecrets(init?: RequestInit): Promise<{ pruned: number }> {
      return this.request("POST", "/secrets/prune-expired", { body: {}, init });
    }

    /** Get a secret value by key */
    async getSecret(query?: { "key": string }, init?: RequestInit): Promise<Secret> {
      return this.request("GET", `/secrets/get`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Search secret metadata */
    async searchSecrets(query?: { "q": string }, init?: RequestInit): Promise<{ "results"?: Array<SecretMetadata> }> {
      return this.request("GET", `/secrets/search`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List secret version metadata (never value material) */
    async listSecretVersions(query?: { "key": string; "limit"?: number }, init?: RequestInit): Promise<{ "versions"?: Array<SecretVersionMeta> }> {
      return this.request("GET", `/secrets/versions`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Version evidence in the get --check class: length + sha256, never the value */
    async checkSecretVersion(query?: { "key": string; "version": number }, init?: RequestInit): Promise<{ "check"?: SecretVersionCheck }> {
      return this.request("GET", `/secrets/versions/check`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Append-only restore: server-side copy of a historical value into a new current version */
    async restoreSecretVersion(body: RestoreInput, init?: RequestInit): Promise<{ "restored"?: SecretVersionMeta }> {
      return this.request("POST", `/secrets/restore`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List registered users */
    async listUsers(query?: { "type"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/users`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Register a user or agent */
    async registerUser(body: UserInput, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/users`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Version info */
    async version(init?: RequestInit): Promise<Status> {
      return this.probe(`/version`, init);
    }
}
