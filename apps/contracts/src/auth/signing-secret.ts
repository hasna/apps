// Reading an API-key signing secret out of the environment, with the
// whitespace trimmed off — in ONE place, for the issuer and the verifier alike.
//
// THE MEASURED DEFECT (hasna/apps#1543). `hasna/oss/projects/api-key-signing-secret`
// is 65 bytes: 64 hex characters and a trailing newline, written that way by the
// provisioning tooling. The projects server trimmed the value before verifying,
// so keys signed with the TRIMMED secret authenticate — but `contracts issue-key`
// read the same variable raw and signed with the 65-byte value, so every key it
// minted out of band was rejected `unknown_key`, and each attempt left an orphan
// row in `api_keys` (kid `63e405446d110e7f` is one). Two readers of one secret
// disagreed about one byte, and the disagreement was invisible: both values look
// identical in every log and dashboard.
//
// THE RULE. An HMAC key is the exact bytes it is given, so "trim on read" only
// works if EVERY reader trims. This module is that reader, `toBuffer` in
// ./keys.ts applies the same normalization to a string secret however it
// arrives, and `resolveDatabaseUrl` in ../server-backend.ts already trims the
// database URL for the same reason. A secret whose surrounding whitespace is
// meaningful key material does not exist in this system; a secret that picked up
// a newline from `aws secretsmanager get-secret-value` does, constantly.
//
// SAFETY. Nothing here logs, returns, or embeds the value in an error: failures
// name the ENV KEY only. `signingSecretHasSurroundingWhitespace` exists so the
// deploy/provision lane can REJECT a secret that carries the whitespace instead
// of silently depending on every reader trimming it.

import type { Env } from "../env-token.js";
import { envToken } from "../env-token.js";
import type { SigningSecret } from "./keys.js";

/**
 * The env keys an app's signing secret is read from, in precedence order.
 *
 * The shared `HASNA_API_SIGNING_KEY` is the fallback a single-app deployment
 * uses; the per-app key wins so one process can serve two apps.
 */
export function signingSecretEnvKeys(app: string): string[] {
  return [`HASNA_${envToken(app)}_API_SIGNING_KEY`, "HASNA_API_SIGNING_KEY"];
}

/** A signing secret could not be resolved. Names the env keys, never a value. */
export class SigningSecretError extends Error {
  readonly attempted: readonly string[];

  constructor(message: string, attempted: readonly string[]) {
    super(message);
    this.name = "SigningSecretError";
    this.attempted = Object.freeze([...attempted]);
  }
}

/**
 * Normalize a signing secret for keying.
 *
 * A string is trimmed; binary shapes are returned untouched, because a caller
 * that handed over bytes chose those exact bytes and there is no "whitespace" to
 * strip from a `Uint8Array` without guessing at an encoding.
 */
export function normalizeSigningSecret(secret: SigningSecret): SigningSecret {
  return typeof secret === "string" ? secret.trim() : secret;
}

/**
 * True when a stored secret carries leading or trailing whitespace.
 *
 * For provisioning checks: a value that needs trimming is one every reader must
 * remember to trim, and the fleet has already proved that some do not.
 */
export function signingSecretHasSurroundingWhitespace(value: string): boolean {
  return value !== value.trim();
}

/** A resolved signing secret plus the env key that supplied it. */
export interface ResolvedSigningSecret {
  /** The trimmed secret. Never logged by this module. */
  value: string;
  /** The env key NAME it came from. */
  source: string;
  /** True when the stored value carried surrounding whitespace that was trimmed. */
  trimmed: boolean;
}

export interface ResolveSigningSecretOptions {
  /**
   * Read this env key instead of the derived pair. An explicit selection is
   * terminal: it never falls back to `HASNA_API_SIGNING_KEY`, because signing
   * with a different secret than the operator named produces keys the server
   * rejects — the exact failure this module exists to end.
   */
  envName?: string;
}

/**
 * Resolve an app's signing secret from the environment, trimmed.
 *
 * Throws {@link SigningSecretError} when no key holds a usable value: a missing
 * signing secret cannot be worked around, and continuing would mint keys under
 * an empty HMAC key.
 */
export function resolveSigningSecret(
  app: string,
  env: Env,
  options: ResolveSigningSecretOptions = {},
): ResolvedSigningSecret {
  const keys = options.envName ? [options.envName] : signingSecretEnvKeys(app);
  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (!value) continue;
    return { value, source: key, trimmed: signingSecretHasSurroundingWhitespace(raw) };
  }
  throw new SigningSecretError(
    `No signing secret found. Set ${keys.join(" or ")} (openssl rand -hex 32).`,
    keys,
  );
}
