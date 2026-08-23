// Provision one machine runner principal plus its machine-kind API key.
//
// The control-plane authenticator (`open_loops_authenticate_key`) requires a
// binding to a tenant, a machine principal, an active membership with roles,
// and a `machine`-kind `api_keys` row for every runner route
// (`runners.claim`, `runs.heartbeat`, ...). Runner tokens minted by hand at
// deploy time carry `api_key` kind and are rejected with `wrong_token_kind`,
// which is exactly the failure this verb exists to make unrepeatable.
//
// The verb is IDEMPOTENT: when the runner principal already exists as an
// active machine principal and holds at least one active, unexpired,
// non-revoked, non-disabled `machine`-kind key for THIS app, the REQUESTED
// tenant, with memberships carrying every requested role and key scopes
// covering every requested scope, it returns the existing key and NEVER mints
// a second token. Any other existing key — wrong tenant, missing role, or
// missing scope — does not satisfy the no-op check: the mint path runs, the
// stray key is disabled, and a fresh key is minted for the requested binding.
// A `pg_advisory_xact_lock` keyed on the runner id serializes concurrent runs
// so two invocations cannot both pass the no-op check and mint twice.
//
// The minted token is returned to the CALLER exactly once. Delivery happens
// INSIDE the transaction through the optional `deliverToken` callback so a
// delivery failure rolls the mint back. This module never logs the token; the
// caller decides where it lands (file / stdout) and remains responsible for
// never printing it into transcripts.

import { isValidScope, mintApiKey, normalizeTenantId } from "@hasna/contracts/auth";
import type { PoolQueryClient } from "../../generated/storage-kit/query.js";
import type { TenantRole } from "../auth/route-policy.js";

export const RUNNER_KEY_APP = "loops";
export const RUNNER_KEY_TOKEN_KIND = "machine";
export const RUNNER_KEY_CREATED_BY = "provision-runner-key";

export const RUNNER_KEY_DEFAULT_ROLES = ["worker", "service"] as const satisfies readonly TenantRole[];
export const RUNNER_KEY_DEFAULT_SCOPES = ["loops:runner"] as const;
/** 365 days. */
export const RUNNER_KEY_DEFAULT_TTL_SECONDS = 31_536_000;

const VALID_ROLES: ReadonlySet<TenantRole> = new Set([
  "admin", "operator", "member", "readonly", "service", "worker",
]);

export interface ProvisionRunnerKeyOptions {
  /** Principal id — the runner's machine id (hostname). Never a `cloud-runner-*` alias. */
  runnerId: string;
  /** Tenant the runner belongs to. Validated with the contracts tenant grammar. */
  tenantId: string;
  /** Membership roles; runner routes require `worker` and/or `service`. */
  roles: readonly string[];
  /** Key scopes; runner routes require `loops:runner`. */
  scopes: readonly string[];
  /** Token lifetime in seconds (positive integer). */
  ttlSeconds: number;
  /** HMAC signing secret — the same `HASNA_LOOPS_API_SIGNING_KEY` the server verifies with. */
  signingSecret: string;
  /** Epoch-milliseconds override for deterministic issuance (tests). */
  nowMs?: number;
  /** Key-id override (tests / deterministic reissue). */
  kid?: string;
  /**
   * Called with the minted token INSIDE the transaction, after the key row is
   * inserted and before commit. A delivery failure therefore rolls the mint
   * back — a committed key whose plaintext was never delivered is
   * unrecoverable (only the hash is stored) and the idempotency check would
   * otherwise refuse a re-run forever. Never invoked on the
   * `already_provisioned` path. The caller remains responsible for never
   * printing the token into transcripts.
   */
  deliverToken?: (token: string) => void;
}

export type ProvisionRunnerKeyOutcome =
  | {
      status: "provisioned";
      runnerId: string;
      kid: string;
      expiresAt: string;
      /** The minted token — returned once, never logged by this module. */
      token: string;
    }
  | {
      status: "already_provisioned";
      runnerId: string;
      kid: string;
      expiresAt: string | null;
    };

function validateOptions(options: ProvisionRunnerKeyOptions): {
  runnerId: string;
  tenantId: string;
  roles: TenantRole[];
  scopes: string[];
  ttlSeconds: number;
  signingSecret: string;
} {
  const runnerId = options.runnerId?.trim() ?? "";
  if (!runnerId) throw new Error("provision-runner-key requires a runner id");
  if (runnerId.length > 128) throw new Error("provision-runner-key runner id is too long (max 128 characters)");
  if (/\s/.test(runnerId)) throw new Error("provision-runner-key runner id must not contain whitespace");

  const tenantId = normalizeTenantId(options.tenantId);
  if (!tenantId) throw new Error("provision-runner-key requires a tenant id");

  if (!Array.isArray(options.roles) || options.roles.length === 0) {
    throw new Error("provision-runner-key requires at least one role");
  }
  const roles: TenantRole[] = [...new Set(options.roles.map((role) => role?.trim() ?? ""))];
  for (const role of roles) {
    if (!VALID_ROLES.has(role as TenantRole)) {
      throw new Error(`invalid role '${role}'; expected one of ${[...VALID_ROLES].sort().join(", ")}`);
    }
  }

  if (!Array.isArray(options.scopes) || options.scopes.length === 0) {
    throw new Error("provision-runner-key requires at least one scope");
  }
  const scopes: string[] = [...new Set(options.scopes.map((scope) => scope?.trim() ?? ""))];
  for (const scope of scopes) {
    if (!isValidScope(scope)) {
      throw new Error(`invalid scope '${scope}'; expected '*' or '<app>:<action>'`);
    }
  }

  const ttlSeconds = options.ttlSeconds;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("provision-runner-key ttlSeconds must be a positive number");
  }

  if (typeof options.signingSecret !== "string" || options.signingSecret.length === 0) {
    throw new Error("provision-runner-key requires a signing secret");
  }

  return { runnerId, tenantId, roles, scopes, ttlSeconds, signingSecret: options.signingSecret };
}

/**
 * Provision (or confirm) the runner's machine principal and machine-kind API
 * key. Idempotent: with an active machine principal and an active unexpired
 * machine-kind key present, returns `already_provisioned` without minting.
 */
export async function provisionRunnerKey(
  client: PoolQueryClient,
  options: ProvisionRunnerKeyOptions,
): Promise<ProvisionRunnerKeyOutcome> {
  const validated = validateOptions(options);
  const { runnerId, tenantId, roles, scopes, ttlSeconds, signingSecret } = validated;

  return client.transaction(async (tx) => {
    // Serialize concurrent runs for the same runner: the no-op check and the
    // mint must be atomic as a pair, or two invocations can both observe "no
    // key" and each mint a second token.
    await tx.execute(
      "SELECT pg_advisory_xact_lock(hashtext('open_loops_provision_runner_key:' || $1))",
      [runnerId],
    );

    const existing = await tx.get<{ kid: string; expires_at: string | Date | null }>(
      `SELECT key.kid, key.expires_at
         FROM api_keys key
         JOIN principals principal ON principal.id = key.principal_id
        WHERE key.principal_id = $1
          AND key.tenant_id = $2
          AND key.token_kind = 'machine'
          AND key.app = 'loops'
          AND key.revoked_at IS NULL
          AND key.disabled_at IS NULL
          AND (key.expires_at IS NULL OR key.expires_at > now())
          AND key.scopes @> $3::jsonb
          AND principal.kind = 'machine'
          AND principal.status = 'active'
          AND NOT EXISTS (
            -- EVERY requested role must be present on the active membership:
            -- a membership carrying only one of several requested roles must
            -- not satisfy the no-op check (the ANY form would match that
            -- single role and wrongly confirm a role-starved key).
            SELECT 1 FROM unnest($4::text[]) AS requested(role)
             WHERE NOT EXISTS (
               SELECT 1
                 FROM tenant_memberships ms
                 JOIN tenant_membership_roles mr
                   ON mr.tenant_id = ms.tenant_id AND mr.principal_id = ms.principal_id
                WHERE ms.tenant_id = $2
                  AND ms.principal_id = $1
                  AND ms.status = 'active'
                  AND mr.role = requested.role
             )
          )
        ORDER BY key.issued_at DESC
        LIMIT 1`,
      [runnerId, tenantId, JSON.stringify(scopes), roles],
    );
    if (existing) {
      return {
        status: "already_provisioned",
        runnerId,
        kid: existing.kid,
        expiresAt: existing.expires_at ? new Date(existing.expires_at).toISOString() : null,
      } satisfies ProvisionRunnerKeyOutcome;
    }

    // Mint BEFORE writing rows: the DB timestamps must equal the token claims
    // at second granularity — the authenticator rejects a key whose
    // `issued_at`/`expires_at` differ from `iat`/`exp` (`key_record_mismatch`).
    const minted = mintApiKey({
      app: RUNNER_KEY_APP,
      scopes: [...scopes],
      tid: tenantId,
      signingSecret,
      ttlSeconds,
      agent: runnerId,
      ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
      ...(options.kid !== undefined ? { kid: options.kid } : {}),
    });
    const issuedAt = new Date(minted.claims.iat * 1000);
    // ttlSeconds is validated positive, so `exp` is never null here.
    const expiresAt = new Date(minted.claims.exp! * 1000);

    await tx.execute(
      `INSERT INTO principals(id, kind, display_name, status) VALUES ($1, 'machine', $1, 'active')
       ON CONFLICT (id) DO UPDATE SET kind='machine', display_name=EXCLUDED.display_name, status='active', updated_at=now()`,
      [runnerId],
    );
    await tx.execute(
      `INSERT INTO tenant_memberships(tenant_id, principal_id, status) VALUES ($1, $2, 'active')
       ON CONFLICT (tenant_id, principal_id) DO UPDATE SET status='active', updated_at=now()`,
      [tenantId, runnerId],
    );
    // Never leave two active machine keys for one runner: the no-op check
    // above only matched an ACTIVE principal, so arriving here with an active
    // (unexpired, non-revoked, non-disabled) machine-kind key means the
    // principal was suspended, re-tenanting, or the key is a stray. Disable
    // any such key before reactivating the principal so exactly one active
    // key exists afterward.
    await tx.execute(
      `UPDATE api_keys
          SET disabled_at = now()
        WHERE principal_id = $1
          AND token_kind = 'machine'
          AND app = 'loops'
          AND revoked_at IS NULL
          AND disabled_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())`,
      [runnerId],
    );
    // Delete-then-insert roles, mirroring the tenant-backfill loader, so the
    // stored role set is exactly the requested set.
    await tx.execute(
      "DELETE FROM tenant_membership_roles WHERE tenant_id=$1 AND principal_id=$2",
      [tenantId, runnerId],
    );
    for (const role of roles) {
      await tx.execute(
        "INSERT INTO tenant_membership_roles(tenant_id, principal_id, role) VALUES ($1,$2,$3)",
        [tenantId, runnerId, role],
      );
    }
    await tx.execute(
      `INSERT INTO api_keys(kid, app, agent, scopes, token_hash, issued_at, expires_at,
                            created_by, tenant_id, principal_id, token_kind)
       VALUES ($1, 'loops', $2, $3::jsonb, $4, $5, $6, 'provision-runner-key', $7, $8, 'machine')`,
      [minted.kid, runnerId, JSON.stringify(scopes), minted.tokenHash, issuedAt, expiresAt, tenantId, runnerId],
    );

    // Deliver INSIDE the transaction: a delivery failure (e.g. the --token-out
    // file cannot be written) rolls the mint back, so no active key is ever
    // left behind whose plaintext was lost — the command can simply be
    // re-run. Delivery after commit would strand an unrecoverable active key
    // (only the hash is stored) behind an idempotency check that then refuses
    // every re-run.
    options.deliverToken?.(minted.token);

    return {
      status: "provisioned",
      runnerId,
      kid: minted.kid,
      expiresAt: expiresAt.toISOString(),
      token: minted.token,
    } satisfies ProvisionRunnerKeyOutcome;
  });
}