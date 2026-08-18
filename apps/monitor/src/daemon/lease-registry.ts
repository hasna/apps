/**
 * lease-registry.ts — MON-V2-03.
 *
 * Lease lifecycle and the fencing primitive for the monitor v2 daemon.
 *
 * A lease binds one attempt to one worker with a generation and a fencing
 * token. Only a digest of the token is stored in durable rows. Every worker
 * write is conditional on the lease being present, unrevoked, unexpired, of
 * the current generation, and carrying the matching token — after expiry or
 * replacement the database rejects stale writes with a typed `stale_fence`
 * result. Renewal keeps the same generation; generation history is never
 * erased (`UNIQUE(run_id, generation)` backs it).
 */

import { createHash } from "node:crypto";
import type { DbAdapter } from "../db/adapter.js";

/** Hex digest of the raw fencing token — the only form stored durably. */
export function fencingDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface LeaseRow {
  id: string;
  attempt_id: string;
  run_id: string;
  worker_id: string;
  generation: number;
  fencing_token_digest: string;
  heartbeat_at: number;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
}

export type FenceCheck =
  | { ok: true }
  | {
      ok: false;
      code: "stale_fence";
      reason:
        | "no_lease"
        | "revoked"
        | "expired"
        | "generation_mismatch"
        | "token_mismatch"
        | "run_mismatch"
        | "attempt_mismatch"
        | "missing_lease_binding";
    };

export interface FenceInput {
  runId: string;
  attemptId: string;
  leaseId: string;
  generation: number;
  fencingToken: string;
  now: number;
}

/**
 * Runs `fn` inside a `BEGIN IMMEDIATE` transaction — the serialization point
 * for admissions and claims (design §5: "Admissions and claims use BEGIN
 * IMMEDIATE transactions"). Commits on success, rolls back on throw.
 */
export function withImmediateTransaction<T>(db: DbAdapter, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The connection may already have rolled back; nothing further to do.
    }
    throw err;
  }
}

/**
 * The fencing check every worker write must pass. Checks, in order: lease
 * exists; not revoked; not expired; generation matches the durable row;
 * fencing token matches the durable digest; run and attempt match. The
 * worker identity is enforced by possession of the raw token — the digest is
 * never compared to a worker claim.
 */
export function checkLeaseFence(db: DbAdapter, input: FenceInput): FenceCheck {
  const lease = db.get<LeaseRow>("SELECT * FROM leases WHERE id = ?", [input.leaseId]);
  if (!lease) return { ok: false, code: "stale_fence", reason: "no_lease" };
  if (lease.revoked_at !== null) return { ok: false, code: "stale_fence", reason: "revoked" };
  if (lease.expires_at <= input.now) return { ok: false, code: "stale_fence", reason: "expired" };
  if (lease.generation !== input.generation) {
    return { ok: false, code: "stale_fence", reason: "generation_mismatch" };
  }
  if (lease.fencing_token_digest !== fencingDigest(input.fencingToken)) {
    return { ok: false, code: "stale_fence", reason: "token_mismatch" };
  }
  if (lease.run_id !== input.runId) return { ok: false, code: "stale_fence", reason: "run_mismatch" };
  if (lease.attempt_id !== input.attemptId) {
    return { ok: false, code: "stale_fence", reason: "attempt_mismatch" };
  }
  return { ok: true };
}

export interface RenewLeaseInput {
  leaseId: string;
  fencingToken: string;
  now: number;
  ttlSeconds: number;
}

export type RenewLeaseResult =
  | { ok: true; heartbeatAt: number; expiresAt: number }
  | { ok: false; code: "stale_fence"; reason: "no_lease" | "revoked" | "expired" | "token_mismatch" };

/**
 * Renews the same lease generation. Refused with `stale_fence` for a missing,
 * revoked, expired, or token-mismatched lease — a stale worker cannot extend
 * a lease it no longer holds.
 */
export function renewLease(db: DbAdapter, input: RenewLeaseInput): RenewLeaseResult {
  const lease = db.get<LeaseRow>("SELECT * FROM leases WHERE id = ?", [input.leaseId]);
  if (!lease) return { ok: false, code: "stale_fence", reason: "no_lease" };
  if (lease.revoked_at !== null) return { ok: false, code: "stale_fence", reason: "revoked" };
  if (lease.expires_at <= input.now) return { ok: false, code: "stale_fence", reason: "expired" };
  if (lease.fencing_token_digest !== fencingDigest(input.fencingToken)) {
    return { ok: false, code: "stale_fence", reason: "token_mismatch" };
  }
  const expiresAt = input.now + input.ttlSeconds;
  db.run(
    "UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE id = ?",
    [input.now, expiresAt, input.leaseId],
  );
  return { ok: true, heartbeatAt: input.now, expiresAt };
}

export interface RevokeLeaseInput {
  leaseId: string;
  now: number;
}

/** Revokes a lease (fencing): the worker holding it can no longer write. */
export function revokeLease(db: DbAdapter, input: RevokeLeaseInput): void {
  db.run("UPDATE leases SET revoked_at = ? WHERE id = ?", [input.now, input.leaseId]);
}
