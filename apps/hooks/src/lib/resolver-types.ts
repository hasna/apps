/**
 * The @hasna/contracts client types that @hasna/hooks PUBLISHES or hands back
 * across its public seam, spelled locally.
 *
 * WHY THIS FILE EXISTS. `@hasna/contracts` is a BUILD-TIME dependency of this
 * package (pinned 1.0.2, inlined by `bun build --target bun`), so the emitted
 * `dist/**&#47;*.d.ts` must never `import ... from "@hasna/contracts/client"` —
 * a published declaration that references a package consumers do not have is
 * a broken install (hasna/apps#1782). Every public signature therefore uses
 * these local spellings, which are structurally identical to the resolver's
 * own types (`CredentialChainOptions` / `KeychainCommandResult`). The
 * `credential chain shape` test in `transport.test.ts` pins the local
 * spellings against the real @hasna/contracts types so they cannot drift.
 */

export type HooksLocalOptInEnv = Record<string, string | undefined>;

/** What an injected `security` runner returns: an exit status plus output. */
export interface HooksKeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Tier 3 (Keychain) controls — structurally `KeychainTierOptions`. */
export interface HooksKeychainTierOptions {
  /** Whether the Keychain is consulted for a caller-built env object. */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name when `HASNA_STATION` is unset. */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security`. */
  run?: (argv: readonly string[]) => HooksKeychainCommandResult;
}

/**
 * Tier-1 credential inputs and Keychain-tier controls — structurally
 * `CredentialChainOptions` from @hasna/contracts/client, spelled locally.
 */
export interface HooksCredentialOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: HooksKeychainTierOptions;
}
