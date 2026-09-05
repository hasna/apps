// `contracts issue-key` implementation.
//
// Mints a Hasna API key and persists ONLY the hashed record to the app's
// Postgres. The legacy path prints the plaintext secret exactly once. The
// credential-safe `--secrets-ref` path instead delivers it directly through
// the typed @hasna/secrets SDK and emits metadata only; the two paths stay
// separate because their failure contracts are deliberately opposite.
//
// PERSISTENCE IS POSTGRES-ONLY, DELIBERATELY. Writing the hashed record through an
// app's cloud `/v1` API would need an `api-keys` operation that is declared in the
// operation manifest, published in the served OpenAPI document, and implemented by
// the app. None of that exists yet, so this command ships no client for it: an
// HTTP writer aimed at an undeclared route cannot report honestly whether the
// record was stored. For the same reason the client-transport env
// (`HASNA_<APP>_API_URL`, `HASNA_<APP>_API_KEY`) is not
// consulted here — it selects the transport for app data, not for this record, and
// must never block or divert the database write.

import { mintApiKey, type MintedApiKey } from "../auth/keys";
import { normalizeTenantId } from "../auth/tenant";
import {
  API_KEY_ISSUANCE_PENDING_REASON,
  ApiKeyStore,
  type ApiKeyRecord,
  type AuthQueryClient,
} from "../auth/store";
import {
  createSecretsBridgeClient,
  type SecretsBridgeClient,
  type SecretsBridgeClientOptions,
} from "./secrets-bridge";

type IssueKeyStore = Pick<ApiKeyStore, "ensureSchema" | "insertMinted"> &
  Partial<Pick<ApiKeyStore, "revoke" | "insertMintedPending" | "activatePending" | "findByKid">>;
type IssueKeyStoreHandle = { store: IssueKeyStore; close: () => Promise<void> };
type IssueKeyConnectStore = (connectionString: string, table: string) => Promise<IssueKeyStoreHandle>;
type IssueKeySecretsClient = Pick<SecretsBridgeClient, "putSecret" | "deleteSecret"> &
  Partial<Pick<SecretsBridgeClient, "listSecrets">>;
type SecretsServiceConfig = Required<Pick<SecretsBridgeClientOptions, "baseUrl" | "apiKey">>;
type IssueKeyConnectSecrets = (config: SecretsServiceConfig) => Promise<IssueKeySecretsClient>;

export interface IssueKeyDeps {
  report: (options: { json?: boolean }, error: string, details?: Record<string, unknown>) => void;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  connectStore?: IssueKeyConnectStore;
  connectSecrets?: IssueKeyConnectSecrets;
}

const SAFE_REFERENCE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const AGENT_REFERENCE_SEGMENT = "{agent}";
const KID_REFERENCE_SEGMENT = "{kid}";
const CANONICAL_SECRETS_URL_ENV = "HASNA_SECRETS_API_URL";
const CANONICAL_SECRETS_KEY_ENV = "HASNA_SECRETS_API_KEY";
const LEGACY_SECRETS_URL_ENV = "SECRETS_API_URL";
const LEGACY_SECRETS_KEY_ENV = "SECRETS_API_KEY";

type SecretsConfigurationErrorCode =
  | "missing_secrets_config"
  | "invalid_secrets_config"
  | "conflicting_secrets_config";

class SecretsConfigurationError extends Error {
  constructor(readonly code: SecretsConfigurationErrorCode) {
    super(code);
    this.name = "SecretsConfigurationError";
  }
}

interface SecretsReferenceTemplate {
  resolve(kid: string): string;
}

/**
 * Validate a collision-resistant Secrets reference before any credential is
 * minted. Both placeholders are complete path segments on purpose:
 *
 * - `{agent}` makes the signed subject and storage namespace visibly agree;
 * - `{kid}` makes every successful issuance create a distinct vault row, so a
 *   retry cannot silently overwrite the only copy of another credential.
 *
 * This path is deliberately non-idempotent. A failed invocation compensates
 * and a retry mints a fresh kid/reference pair. One invocation never retries a
 * POST internally, and concurrent invocations cannot target the same resolved
 * reference unless the cryptographic kid generator collides (the DB unique key
 * refuses that before the vault write).
 */
function validateSecretsReferenceTemplate(value: unknown, agent: string): SecretsReferenceTemplate {
  if (typeof value !== "string") {
    throw new Error("--secrets-ref must be a string reference template.");
  }
  const template = value.trim();
  if (template.length === 0 || template.length > 256) {
    throw new Error("--secrets-ref must be 1-256 characters.");
  }
  if (!SAFE_REFERENCE_SEGMENT.test(agent)) {
    throw new Error("--agent must be a safe non-empty Secrets path segment (letters, digits, '.', '_' or '-').");
  }
  const segments = template.split("/");
  if (segments.length > 16 || segments.some((segment) => segment.length === 0)) {
    throw new Error("--secrets-ref must contain 1-16 non-empty path segments.");
  }
  const agentSegments = segments.filter((segment) => segment === AGENT_REFERENCE_SEGMENT).length;
  const kidSegments = segments.filter((segment) => segment === KID_REFERENCE_SEGMENT).length;
  if (agentSegments !== 1 || kidSegments !== 1) {
    throw new Error("--secrets-ref must contain exactly one '{agent}' segment and one '{kid}' segment.");
  }
  for (const segment of segments) {
    if (segment === AGENT_REFERENCE_SEGMENT || segment === KID_REFERENCE_SEGMENT) continue;
    if (!SAFE_REFERENCE_SEGMENT.test(segment)) {
      throw new Error("--secrets-ref contains an unsafe path segment.");
    }
  }
  return {
    resolve: (kid) =>
      segments
        .map((segment) => (segment === AGENT_REFERENCE_SEGMENT ? agent : segment === KID_REFERENCE_SEGMENT ? kid : segment))
        .join("/"),
  };
}

function ownEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = Object.hasOwn(env, key) ? env[key] : undefined;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeSecretsBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SecretsConfigurationError("invalid_secrets_config");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new SecretsConfigurationError("invalid_secrets_config");
  }
  return url.origin;
}

function resolveSecretsAlias(
  env: NodeJS.ProcessEnv,
  urlEnv: string,
  keyEnv: string,
): SecretsServiceConfig | undefined {
  const rawUrl = ownEnv(env, urlEnv);
  const rawApiKey = ownEnv(env, keyEnv);
  if (!rawUrl && !rawApiKey) return undefined;
  if (!rawUrl || !rawApiKey || rawApiKey !== rawApiKey.trim()) {
    throw new SecretsConfigurationError("invalid_secrets_config");
  }
  return { baseUrl: normalizeSecretsBaseUrl(rawUrl), apiKey: rawApiKey };
}

/**
 * Collapse the two package-supported env aliases into one explicit authority.
 * The SDK historically resolves URL and key independently with legacy-first
 * precedence, so an overlapping environment can otherwise pair credentials
 * with a different service. Equivalent complete aliases are one authority;
 * partial or conflicting aliases fail before a credential is minted.
 */
function resolveSecretsServiceConfig(env: NodeJS.ProcessEnv): SecretsServiceConfig {
  const canonical = resolveSecretsAlias(env, CANONICAL_SECRETS_URL_ENV, CANONICAL_SECRETS_KEY_ENV);
  const legacy = resolveSecretsAlias(env, LEGACY_SECRETS_URL_ENV, LEGACY_SECRETS_KEY_ENV);
  if (!canonical && !legacy) throw new SecretsConfigurationError("missing_secrets_config");
  if (canonical && legacy && (canonical.baseUrl !== legacy.baseUrl || canonical.apiKey !== legacy.apiKey)) {
    throw new SecretsConfigurationError("conflicting_secrets_config");
  }
  return canonical ?? legacy!;
}

async function connectSecrets(config: SecretsServiceConfig): Promise<IssueKeySecretsClient> {
  // Empty env plus explicit overrides prevents the SDK's legacy-first ambient
  // resolver from selecting a different URL/key pair after validation.
  return createSecretsBridgeClient(config);
}

async function closeQuietly(handle: IssueKeyStoreHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // A pool-close error cannot change the already committed issuance result.
  }
}

async function compensateRecord(store: IssueKeyStore, kid: string): Promise<boolean> {
  if (!store.revoke) return false;
  try {
    // A successful call is fail-closed whether it changed one row (revoked) or
    // zero rows (the preceding insert never committed).
    await store.revoke(kid, "credential_delivery_failed");
    return true;
  } catch {
    return false;
  }
}

async function compensateSecret(client: IssueKeySecretsClient, key: string): Promise<boolean> {
  try {
    // Delete is idempotent. A successful call means the exact ref is absent,
    // whether the preceding PUT committed before its response was lost or not.
    await client.deleteSecret({ key });
    return true;
  } catch {
    return false;
  }
}

function envToken(app: string): string {
  return app.toUpperCase().replace(/-/g, "_");
}

/** Resolve the signing-secret env var name (never the value) for messages. */
export function signingSecretEnvName(app: string, override?: string): string {
  return override ?? `HASNA_${envToken(app)}_API_SIGNING_KEY`;
}

/** Resolve the database-url env var name for the record store. */
export function databaseUrlEnvName(app: string, override?: string): string {
  return override ?? `HASNA_${envToken(app)}_DATABASE_URL`;
}

/**
 * Read one option as an OWN property — the sibling of `ownAgentClaim` and
 * `ownTenantId` in `src/auth/keys.ts`, moved to the WRITE path.
 *
 * Commander omits a flag the operator did not type rather than defining it as
 * `undefined`, so the parsed options object genuinely lacks those keys while
 * still having `Object.prototype` in its chain. A bare `options.<flag>` read is
 * therefore a real prototype lookup, and a `__proto__`/`constructor.prototype`
 * write primitive anywhere else in the process decides what it returns.
 *
 * That matters more here than on the verify path. Values read in `runIssueKey`
 * are handed to `mintApiKey` and land INSIDE the HMAC-signed body, so the key
 * that comes out is cryptographically authentic and no verify-time guard can —
 * or should — reject it. `ownAgentClaim`/`ownTenantId`/`ownScopesClaim` all sit
 * downstream of the signature and cannot help. This is the only place the value
 * can be stopped.
 */
function ownOption(options: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(options, name) ? options[name] : undefined;
}

function parseScopesCsv(csv: unknown): string[] {
  if (typeof csv !== "string") return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function validateIssuanceId(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error("--issuance-id must be a safe 1-64 character key id (letters, digits, '_' or '-').");
  }
  return value;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function existingIssuanceMatches(
  record: ApiKeyRecord,
  request: {
    app: string;
    agent: string;
    tid: string | undefined;
    scopes: string[];
    ttlSeconds: number | null;
  },
): boolean {
  const issuedAtMs = Date.parse(record.issuedAt);
  const expiresAtMs = record.expiresAt === null ? null : Date.parse(record.expiresAt);
  if (!Number.isFinite(issuedAtMs) || (expiresAtMs !== null && !Number.isFinite(expiresAtMs))) return false;
  const storedTtlSeconds = expiresAtMs === null ? null : Math.floor((expiresAtMs - issuedAtMs) / 1000);
  return (
    record.app === request.app &&
    record.agent === request.agent &&
    record.tid === (request.tid ?? null) &&
    record.createdBy === request.agent &&
    storedTtlSeconds === request.ttlSeconds &&
    sameStrings(record.scopes, request.scopes)
  );
}

async function hasExactSecretMetadata(client: IssueKeySecretsClient, key: string): Promise<boolean> {
  if (!client.listSecrets) return false;
  const result = await client.listSecrets({ namespace: key });
  return result.secrets?.some((metadata) => metadata.key === key && metadata.type === "api_key") === true;
}

async function activateIdempotently(
  store: IssueKeyStore,
  issuance: Pick<MintedApiKey, "kid" | "tokenHash">,
): Promise<boolean> {
  if (!store.activatePending) return false;
  try {
    return await store.activatePending(issuance.kid, issuance.tokenHash);
  } catch {
    // The UPDATE may have committed before its response was lost. The method
    // is keyed by kid + token hash and accepts the already-active exact row, so
    // repeating it reconciles that outcome instead of creating another key.
    return store.activatePending(issuance.kid, issuance.tokenHash);
  }
}

function emitSilentReceipt(
  json: boolean,
  receipt: {
    app: string;
    kid: string;
    agent: string;
    tid: string | null;
    scopes: string[];
    issuedAt: string;
    expiresAt: string | null;
    secretsRef: string;
  },
): void {
  const output = {
    ok: true,
    ...receipt,
    issuanceId: receipt.kid,
    stored: true,
    vaultStored: true,
  };
  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`Issued API key metadata for app '${receipt.app}' (kid ${receipt.kid})`);
  console.log(`  agent:      ${receipt.agent}`);
  console.log(`  tenant:     ${receipt.tid ?? "- (untenanted)"}`);
  console.log(`  scopes:     ${receipt.scopes.join(", ")}`);
  console.log(`  issued:     ${receipt.issuedAt}`);
  console.log(`  expires:    ${receipt.expiresAt ?? "never"}`);
  console.log(`  secretsRef: ${receipt.secretsRef}`);
}

async function connectStore(connectionString: string, table: string): Promise<IssueKeyStoreHandle> {
  let pgModule: any;
  try {
    pgModule = await import("pg");
  } catch {
    throw new Error("Persisting the key record requires the 'pg' package. Install it, or pass --no-store.");
  }
  const Pool = pgModule.default?.Pool ?? pgModule.Pool;
  const pool = new Pool({ connectionString });
  const client: AuthQueryClient = {
    many: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
    get: async (sql, params) => (await pool.query(sql, params as unknown[])).rows[0] ?? null,
    execute: async (sql, params) => {
      await pool.query(sql, params as unknown[]);
    },
  };
  const store = new ApiKeyStore(client, { table });
  return { store, close: () => pool.end() };
}

export async function runIssueKey(options: Record<string, unknown>, deps: IssueKeyDeps): Promise<void> {
  const env = deps.env ?? process.env;

  // EVERY option is read exactly once, here, as an own property. Reading them
  // in one place is the point: a single bare `options.x` left anywhere below
  // reopens the hole for that flag alone, and a bare read is invisible at a
  // glance because it looks identical to a correct one. Past this block the
  // function sees locals, never `options`.
  const optJson = ownOption(options, "json");
  const optApp = ownOption(options, "app");
  const optBootstrap = ownOption(options, "bootstrap");
  const optScopes = ownOption(options, "scopes");
  const optAgent = ownOption(options, "agent");
  const optTid = ownOption(options, "tid");
  const optExpiry = ownOption(options, "expiry");
  const optTtlDays = ownOption(options, "ttlDays");
  const optSigningSecretEnv = ownOption(options, "signingSecretEnv") as string | undefined;
  const optDatabaseUrlEnv = ownOption(options, "databaseUrlEnv") as string | undefined;
  const optTable = ownOption(options, "table") as string | undefined;
  const optStore = ownOption(options, "store");
  const optSecretsRef = ownOption(options, "secretsRef");
  const optIssuanceId = ownOption(options, "issuanceId");

  const json = optJson === true;
  const app = String(optApp ?? "").trim();
  if (!app) {
    deps.report({ json }, "Missing required option --app.", { code: "missing_app" });
    return;
  }

  const bootstrap = optBootstrap === true;
  let scopes = parseScopesCsv(optScopes);
  if (scopes.length === 0) {
    if (bootstrap) {
      scopes = [`${app}:*`];
    } else {
      deps.report({ json }, "Missing --scopes. Provide e.g. --scopes 'todos:read,todos:write' or use --bootstrap.", {
        code: "missing_scopes",
      });
      return;
    }
  }

  // `optAgent` is the own-property read #80 introduced here, now taken at the
  // top of the function with every other option. Its reasoning is unchanged and
  // is recorded on `ownOption` above: downstream `ownAgentClaim` reads this back
  // as an OWN, string-valued claim and reports it as authentic, because once it
  // has been signed it genuinely is — a read-side guard cannot undo a poisoned
  // signature. `String()` coercion and the `bootstrap` fallback are preserved
  // exactly; only the prototype walk is gone.
  const agent = optAgent !== undefined ? String(optAgent) : bootstrap ? "bootstrap" : undefined;

  // `--secrets-ref` selects the credential-silent path. It is intentionally a
  // separate branch rather than a formatting flag on the existing command:
  // the legacy path promises to disclose the token, including on failures,
  // while this path promises that the token can reach only the typed Secrets
  // consumer. Mixing those contracts behind `--json` or a redaction toggle
  // makes one future error path enough to put the token back on stdout.
  let secretsReference: SecretsReferenceTemplate | undefined;
  let secretsConfig: SecretsServiceConfig | undefined;
  let issuanceId: string | undefined;
  if (optIssuanceId !== undefined && optSecretsRef === undefined) {
    deps.report({ json }, "--issuance-id is supported only with credential-safe --secrets-ref issuance.", {
      code: "bad_issuance_id",
    });
    return;
  }
  if (optSecretsRef !== undefined) {
    if (bootstrap || typeof optAgent !== "string" || optAgent.trim().length === 0) {
      deps.report({ json }, "Credential-safe Secrets issuance requires an explicit --agent.", {
        code: "missing_agent",
      });
      return;
    }
    if (optStore === false) {
      deps.report({ json }, "--secrets-ref cannot be combined with --no-store.", {
        code: "bad_secrets_store_mode",
      });
      return;
    }
    if (optIssuanceId !== undefined) {
      try {
        issuanceId = validateIssuanceId(optIssuanceId);
      } catch (error) {
        deps.report({ json }, error instanceof Error ? error.message : "Invalid --issuance-id.", {
          code: "bad_issuance_id",
        });
        return;
      }
    }
    try {
      secretsReference = validateSecretsReferenceTemplate(optSecretsRef, agent as string);
      secretsConfig = resolveSecretsServiceConfig(env);
    } catch (error) {
      if (error instanceof SecretsConfigurationError) {
        deps.report({ json }, "Could not resolve one unambiguous Hasna Secrets service configuration.", {
          code: error.code,
        });
        return;
      }
      const message = error instanceof Error ? error.message : "Invalid --secrets-ref.";
      deps.report({ json }, message, { code: "bad_secrets_ref" });
      return;
    }
  }

  let tid: string | undefined;
  if (optTid !== undefined) {
    try {
      tid = normalizeTenantId(String(optTid));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.report({ json }, message, { code: "bad_tid" });
      return;
    }
  }

  // TTL: --no-expiry => null; else --ttl-days (default 90).
  let ttlSeconds: number | null;
  if (optExpiry === false) {
    ttlSeconds = null;
  } else {
    const days = optTtlDays !== undefined ? Number(optTtlDays) : 90;
    if (!Number.isFinite(days) || days <= 0) {
      deps.report({ json }, "--ttl-days must be a positive number.", { code: "bad_ttl" });
      return;
    }
    ttlSeconds = Math.floor(days * 24 * 60 * 60);
  }

  const secretEnvName = signingSecretEnvName(app, optSigningSecretEnv);
  const fallbackName = optSigningSecretEnv ? undefined : "HASNA_API_SIGNING_KEY";
  // The signing secret is NORMALIZED here, at the env boundary, before it ever
  // reaches the crypto layer. The fleet provisioning pipeline stores
  // `api-key-signing-secret` values that carry a trailing newline (64 hex
  // characters plus '\n'), and every fleet server trims at its env read;
  // `issue-key` must key the HMAC with the same bytes the servers verify with,
  // so the raw value is trimmed here too. The crypto layer additionally
  // normalizes string secrets (see `toBuffer` in src/auth/keys.ts), so raw and
  // trimmed values agree even if one layer is bypassed — defense in depth.
  const signingSecret = (env[secretEnvName] ?? (fallbackName ? env[fallbackName] : undefined))?.trim();
  if (!signingSecret) {
    const tried = fallbackName ? `${secretEnvName} (or ${fallbackName})` : secretEnvName;
    deps.report({ json }, `No signing secret found. Set the ${tried} env var (openssl rand -hex 32).`, {
      code: "missing_signing_secret",
      signingSecretEnv: secretEnvName,
    });
    return;
  }

  let minted: MintedApiKey;
  let issuanceNowMs: number | undefined;
  try {
    issuanceNowMs = deps.now ? deps.now() : undefined;
    minted = mintApiKey({
      app,
      scopes,
      signingSecret,
      ttlSeconds,
      ...(agent !== undefined ? { agent } : {}),
      ...(tid !== undefined ? { tid } : {}),
      ...(issuanceId !== undefined ? { kid: issuanceId } : {}),
      ...(issuanceNowMs !== undefined ? { nowMs: issuanceNowMs } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.report({ json }, `Could not mint key: ${message}`, { code: "mint_failed" });
    return;
  }

  const table = optTable ?? "api_keys";
  const dbEnvName = databaseUrlEnvName(app, optDatabaseUrlEnv);
  // The database URL is TRIMMED here, at the env boundary, before it ever
  // reaches the pg driver, for the same reason the signing secret is: fleet
  // provisioning stores both values with a trailing newline, and the server
  // side trims at its env read (`resolveDatabaseUrl` in server-backend.ts), so
  // `issue-key` must hand the driver the same bytes the server connects with.
  const databaseUrl = env[dbEnvName]?.trim();
  const expiresAt = minted.claims.exp === null ? null : new Date(minted.claims.exp * 1000).toISOString();
  const issuedAt = new Date(minted.claims.iat * 1000).toISOString();

  if (secretsReference) {
    const secretsRef = secretsReference.resolve(minted.kid);
    const createdBy = agent as string;
    const connectionString = databaseUrl;
    if (!connectionString) {
      deps.report({ json }, `No database URL found. Set ${dbEnvName}.`, {
        code: "missing_database_url",
        databaseUrlEnv: dbEnvName,
      });
      return;
    }

    let handle: IssueKeyStoreHandle | undefined;
    let secretsClient: IssueKeySecretsClient | undefined;
    let storageReady = false;
    try {
      const connect = deps.connectStore ?? connectStore;
      handle = await connect(connectionString, table);
      await handle.store.ensureSchema();
      if (!handle.store.revoke || !handle.store.insertMintedPending || !handle.store.activatePending) {
        deps.report({ json }, "The selected key store does not support fail-closed compensation.", {
          code: "bad_secrets_store_contract",
        });
        return;
      }
      if (issuanceId && !handle.store.findByKid) {
        deps.report({ json }, "The selected key store does not support idempotent issuance reconciliation.", {
          code: "bad_secrets_store_contract",
        });
        return;
      }
      const connectVault = deps.connectSecrets ?? connectSecrets;
      secretsClient = await connectVault(secretsConfig!);
      if (issuanceId && !secretsClient.listSecrets) {
        deps.report({ json }, "The selected Secrets client does not support metadata-only issuance reconciliation.", {
          code: "bad_secrets_store_contract",
        });
        return;
      }
      storageReady = true;
    } catch {
      deps.report({ json }, "Could not prepare credential-safe key storage.", {
        code: "storage_prepare_failed",
      });
      return;
    } finally {
      if (!storageReady) await closeQuietly(handle);
    }

    // An explicit issuance id makes a command retry address the same kid and
    // vault reference. Bind it to the stored request metadata and reconcile
    // without reading the token from Secrets or placing it on an output surface.
    if (issuanceId) {
      let existing: ApiKeyRecord | null;
      try {
        existing = await handle.store.findByKid!(minted.kid);
      } catch {
        deps.report({ json }, "Could not inspect the existing credential issuance.", {
          code: "issuance_reconciliation_failed",
          app,
          kid: minted.kid,
          issuanceId: minted.kid,
          agent: createdBy,
          secretsRef,
        });
        await closeQuietly(handle);
        return;
      }
      if (existing) {
        const matches = existingIssuanceMatches(existing, {
          app,
          agent: createdBy,
          tid,
          scopes: minted.claims.scopes,
          ttlSeconds,
        });
        if (!matches) {
          deps.report({ json }, "The issuance id is already bound to a different credential request.", {
            code: "issuance_conflict",
            app,
            kid: minted.kid,
            issuanceId: minted.kid,
            agent: createdBy,
            secretsRef,
          });
          await closeQuietly(handle);
          return;
        }

        let vaultPresent = false;
        try {
          vaultPresent = await hasExactSecretMetadata(secretsClient, secretsRef);
        } catch {
          // A metadata-read failure cannot justify either minting a replacement
          // or claiming the previous delivery exists.
        }
        const pending =
          existing.revokedAt !== null && existing.revokedReason === API_KEY_ISSUANCE_PENDING_REASON;
        let active = existing.revokedAt === null && existing.revokedReason === null;
        if (pending && vaultPresent) {
          try {
            active = await activateIdempotently(handle.store, existing);
          } catch {
            active = false;
          }
        }
        const expired =
          existing.expiresAt !== null && Date.parse(existing.expiresAt) <= (issuanceNowMs ?? Date.now());
        if (!active || !vaultPresent || expired) {
          deps.report({ json }, "Could not reconcile the existing credential issuance to one usable record and vault row.", {
            code: "issuance_reconciliation_failed",
            app,
            kid: existing.kid,
            issuanceId: existing.kid,
            agent: createdBy,
            secretsRef,
          });
          await closeQuietly(handle);
          return;
        }

        await closeQuietly(handle);
        emitSilentReceipt(json, {
          app,
          kid: existing.kid,
          agent: createdBy,
          tid: existing.tid,
          scopes: existing.scopes,
          issuedAt: existing.issuedAt,
          expiresAt: existing.expiresAt,
          secretsRef,
        });
        return;
      }
    }

    // At this point both consumers are ready. The DB write comes first in an
    // issuance-pending (therefore revoked) state. Every released verifier
    // already refuses that state, so an ambiguous vault response remains safe
    // even if both best-effort cleanup operations are unavailable.
    try {
      await handle.store.insertMintedPending(minted, createdBy);
    } catch {
      if (issuanceId) {
        // Another invocation may have won the same stable issuance id between
        // our pre-read and INSERT. Never compensate a row this invocation did
        // not create; the next ordinary retry will reconcile its exact state.
        let concurrent: ApiKeyRecord | null = null;
        try {
          concurrent = await handle.store.findByKid!(minted.kid);
        } catch {
          // Preserve the fail-closed result below without exposing DB details.
        }
        if (concurrent) {
          deps.report({ json }, "The credential issuance is already in progress; retry the same issuance id.", {
            code: "issuance_in_progress",
            app,
            kid: minted.kid,
            issuanceId: minted.kid,
            agent: createdBy,
            secretsRef,
          });
          await closeQuietly(handle);
          return;
        }
      }
      const compensated = await compensateRecord(handle.store, minted.kid);
      deps.report({ json }, "Could not persist the credential record.", {
        code: "store_failed",
        app,
        kid: minted.kid,
        issuanceId: minted.kid,
        agent: createdBy,
        secretsRef,
        compensated,
      });
      await closeQuietly(handle);
      return;
    }

    try {
      const metadata = await secretsClient.putSecret({
        key: secretsRef,
        value: minted.token,
        type: "api_key",
        label: `${app} API key for ${createdBy}`,
      });
      if (metadata.key !== secretsRef || metadata.type !== "api_key") {
        throw new Error("Secrets metadata did not match the requested reference.");
      }
      const activated = await activateIdempotently(handle.store, minted);
      if (!activated) throw new Error("The pending credential record could not be activated.");
    } catch {
      // A failed vault response is ambiguous: the write may have landed. A
      // final activation failure is handled by the same fail-closed path. The
      // record was inserted pending, so it remains unusable even when both
      // best-effort cleanups fail. Neither cleanup forwards the underlying
      // error because a producer may include token-bearing request data in it.
      const recordCompensated = await compensateRecord(handle.store, minted.kid);
      const vaultCompensated = await compensateSecret(secretsClient, secretsRef);
      const compensated = recordCompensated && vaultCompensated;
      deps.report({ json }, "Could not store the credential in Hasna Secrets.", {
        code: "secrets_store_failed",
        app,
        kid: minted.kid,
        issuanceId: minted.kid,
        agent: createdBy,
        secretsRef,
        compensated,
        recordCompensated,
        vaultCompensated,
      });
      await closeQuietly(handle);
      return;
    }

    await closeQuietly(handle);
    emitSilentReceipt(json, {
      app,
      kid: minted.kid,
      agent: createdBy,
      tid: tid ?? null,
      scopes: minted.claims.scopes,
      issuedAt,
      expiresAt,
      secretsRef,
    });
    return;
  }

  // The plaintext token is derived at mint time and never persisted anywhere.
  // EVERY exit path after minting must hand it to the operator: a persistence
  // failure that swallows it destroys an unrecoverable credential.
  const keyMaterial = {
    app,
    kid: minted.kid,
    agent: agent ?? null,
    tid: tid ?? null,
    scopes,
    issuedAt,
    expiresAt,
    tokenHash: minted.tokenHash,
    bootstrap,
    // The secret token, shown ONCE. Store it now; it cannot be recovered.
    token: minted.token,
  };

  const printKeyBlock = (record: string, storeError: string | null): void => {
    console.log(`Issued API key for app '${app}' (kid ${minted.kid})${bootstrap ? " [bootstrap]" : ""}`);
    console.log(`  scopes:    ${scopes.join(", ")}`);
    console.log(`  agent:     ${agent ?? "-"}`);
    console.log(`  tenant:    ${tid ?? "- (untenanted)"}`);
    console.log(`  issued:    ${issuedAt}`);
    console.log(`  expires:   ${expiresAt ?? "never"}`);
    console.log(`  record:    ${record}`);
    if (storeError) console.log(`  storeError: ${storeError}`);
    console.log(`  tokenHash: ${minted.tokenHash}`);
    if (!stored) {
      console.log("");
      console.log("  WARNING: no api_keys record was stored for this key. Services that verify");
      console.log("  key status (the default: keyStatus/statusChecker) will REFUSE it with");
      console.log("  reason 'unknown_key', and it CANNOT BE REVOKED — revocation works by");
      console.log(`  writing revoked_at on the '${table}' row, and there is no row. Register it`);
      console.log("  with ApiKeyStore.insertMinted, or re-issue with the database URL set.");
    }
    if (expiresAt === null) {
      console.log("");
      console.log("  WARNING: this key NEVER EXPIRES. Fleet TTL policy is expiring keys");
      console.log("  (default 90 days); a leaked forever-key stays valid until someone");
      console.log("  notices. Prefer --ttl-days and rotate on schedule.");
    }
    console.log("");
    console.log("  API key (shown once — copy it now, it cannot be recovered):");
    console.log(`  ${minted.token}`);
  };

  /** Surface a persistence failure WITHOUT losing the already-minted secret. */
  const reportStoreFailure = (message: string, code: string, details: Record<string, unknown> = {}): void => {
    deps.report({ json }, message, { code, ...details, stored: false, ...keyMaterial });
    if (!json) printKeyBlock("NOT STORED", message);
  };

  let stored = false;
  if (optStore !== false) {
    const createdBy = agent ?? "issue-key";
    const connectionString = databaseUrl;
    if (!connectionString) {
      reportStoreFailure(
        `No database URL found. Set ${dbEnvName}, or pass --no-store to skip persistence.`,
        "missing_database_url",
        { databaseUrlEnv: dbEnvName },
      );
      return;
    }
    let handle: IssueKeyStoreHandle | undefined;
    try {
      const connect = deps.connectStore ?? connectStore;
      handle = await connect(connectionString, table);
      await handle.store.ensureSchema();
      await handle.store.insertMinted(minted, createdBy);
      stored = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportStoreFailure(`Could not persist key record: ${message}`, "store_failed");
      return;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // ignore pool close failure
        }
      }
    }
  }

  if (json) {
    const warnings: string[] = [];
    if (!stored) {
      warnings.push(
        "unregistered: no api_keys record stored — strict services (keyStatus/statusChecker) will refuse this key with reason 'unknown_key', and it cannot be revoked until a record exists",
      );
    }
    if (expiresAt === null) {
      warnings.push("no_expiry: this key never expires; fleet TTL policy is expiring keys (default 90 days)");
    }
    console.log(JSON.stringify({ ok: true, ...keyMaterial, stored, revocable: stored, warnings }, null, 2));
    return;
  }

  printKeyBlock(stored ? `stored (${table})` : "not stored (--no-store)", null);
}
