/**
 * Value-safe secret copy — the migration primitive behind `secrets copy <old> <new>`.
 *
 * Why this exists (Fable ruling, 2026-08-20): the taxonomy migration moves ~1,100
 * vault values to new paths, and there was no value-safe way to do it. `get --show`
 * refuses plaintext on a captured (non-TTY) stream since the 0.2.9 hardening, and
 * `get --show | set -` would render the value into a transcript. This primitive
 * reads the source value IN-PROCESS through the Store and writes the destination
 * key in the same call; the value never touches stdout, stderr, a transcript, a
 * log, an environment variable, or a child process. It composes the existing
 * `getSecret`/`setSecret` on BOTH transports (local SQLite vault and cloud API),
 * so no new server endpoint is required.
 *
 * Safety invariants (all asserted by tests/cli-copy.test.ts / tests/copy.test.ts):
 *   • the value renders on no output surface, in any form;
 *   • no environment-variable interpolation of the value;
 *   • the source key is left intact (copy semantics — deletion is a separate
 *     explicit operation);
 *   • `--verify` is internal check-equality (length + sha256), exit 0 on match,
 *     non-zero with a redacted message on mismatch.
 *
 * The provenance `reason` auto-carries the source path (`migrated from <old>`)
 * unless the caller supplies one, so the destination record is always
 * back-referenced to its source. The write carries change kind `migration`
 * where the store records change kinds against an existing version history;
 * a brand-new destination records the store's own `initial` kind with the
 * provenance reason attached (store contract, local store).
 */

import { createHash } from "node:crypto";
import type { Store } from "./store/types.js";
import type { SecretEntry, SecretType } from "./types.js";

/** Options for a single copy write. All are metadata overrides; defaults come from the source entry. */
export interface CopyWriteOptions {
  type?: SecretType;
  label?: string;
  expiresAt?: string;
  reason?: string;
}

export interface CopySecretResult {
  oldKey: string;
  newKey: string;
  /** The provenance reason written with the destination key. */
  reason: string;
  type: SecretType;
  label?: string;
  expiresAt?: string;
  /** True when the destination value was byte-identical to an existing one (no new version). */
  unchanged: boolean;
  version: number | undefined;
}

/** The result of an internal check-equality comparison. Never carries a value or a hash. */
export interface CopyVerifyResult {
  match: boolean;
  /** The matching value length (both sides equal) when match; null otherwise. */
  length: number | null;
}

/** Source and destination are the same key. */
export class CopySourceEqualsDestinationError extends Error {
  constructor(oldKey: string) {
    super(`Source and destination must differ — both are "${oldKey}".`);
    this.name = "CopySourceEqualsDestinationError";
  }
}

/** The source key does not exist. */
export class CopySourceNotFoundError extends Error {
  constructor(oldKey: string) {
    super(`Not found: ${oldKey}`);
    this.name = "CopySourceNotFoundError";
  }
}

/** Provenance reason: the destination record always names its source key. */
export function copyReason(oldKey: string, explicitReason?: string): string {
  return explicitReason ?? `migrated from ${oldKey}`;
}

/** `get --check` class: length + sha256 of a value, never the value itself. */
export function valueCheck(entry: Pick<SecretEntry, "value">): { length: number; hash: string } {
  const hash = createHash("sha256").update(entry.value).digest("hex");
  return { length: entry.value.length, hash };
}

/**
 * Copy a secret's value from `oldKey` to `newKey`, entirely in-process through
 * the Store. Metadata (type/label/expiry) defaults to the source entry's and is
 * overridable per call. The provenance reason auto-carries the source path.
 * The source key is left intact.
 */
export async function copySecret(
  store: Store,
  oldKey: string,
  newKey: string,
  opts: CopyWriteOptions = {},
): Promise<CopySecretResult> {
  if (oldKey === newKey) {
    throw new CopySourceEqualsDestinationError(oldKey);
  }
  const oldEntry = await store.getSecret(oldKey);
  if (!oldEntry) throw new CopySourceNotFoundError(oldKey);

  // Normalise nulls: local getSecret returns SQLite NULLs as `null`, while the
  // Store's setSecret metadata path asserts on `string | undefined`. Defaults
  // cloned from the source must become `undefined`, never `null`.
  const type = opts.type ?? oldEntry.type;
  const label = opts.label !== undefined ? opts.label : (oldEntry.label ?? undefined);
  const expiresAt = opts.expiresAt !== undefined ? opts.expiresAt : (oldEntry.expires_at ?? undefined);
  const reason = copyReason(oldKey, opts.reason);

  const written = await store.setSecret(newKey, oldEntry.value, type, label, expiresAt, {
    reason,
    changeKind: "migration",
  });

  return {
    oldKey,
    newKey,
    reason,
    type,
    label,
    expiresAt,
    unchanged: written.unchanged === true,
    version: written.version,
  };
}

/**
 * Internal check-equality between the source and destination values: length +
 * sha256. The value and the hashes never leave this function — on match only the
 * length is surfaced; on mismatch nothing but `match: false` is returned, so the
 * CLI can render a redacted message (a hash of a low-entropy value is a crack
 * target if it is ever persisted to a transcript).
 */
export async function verifyCopy(
  store: Store,
  oldKey: string,
  newKey: string,
): Promise<CopyVerifyResult> {
  const [oldEntry, newEntry] = await Promise.all([store.getSecret(oldKey), store.getSecret(newKey)]);
  if (!oldEntry || !newEntry) return { match: false, length: null };
  const a = valueCheck(oldEntry);
  const b = valueCheck(newEntry);
  if (a.length === b.length && a.hash === b.hash) {
    return { match: true, length: a.length };
  }
  return { match: false, length: null };
}
