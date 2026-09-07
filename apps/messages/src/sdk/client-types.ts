// The @hasna/contracts client types that @hasna/messages PUBLISHES.
//
// WHY THIS FILE EXISTS. `@hasna/contracts` is a BUILD-TIME dependency of this
// package: `bun build --target bun` inlines the resolver into every bundle, so
// `dist/*.js` imports node builtins only and a consumer installs nothing extra.
// The declarations `tsc` emits are not bundled, though — they keep every import
// the source wrote. The SDK and CLI surfaces resolve their credential and their
// authority through `@hasna/contracts/client` (hasna/apps#1720), and naming a
// contracts type in an exported signature would land in `dist/**/*.d.ts` as a
// live `@hasna/contracts` import that breaks every TS consumer, which installs
// this package's runtime dependencies and not its devDependencies (#1782).
//
// WHAT THIS IS NOT. It is NOT the vendored credential chain that #1720 removed
// — there is no tier logic, no Keychain read, no URL ladder, not one runtime
// statement here. The resolver still lives in @hasna/contracts and only there;
// this file is the SPELLING of the shapes that cross this package's published
// boundary. Every one of them is checked against the real @hasna/contracts
// declarations at compile time by the assignments at the seam in
// `sdk/resolve.ts` — a shape that drifts fails the build, it does not silently
// publish a lie.
//
// Nothing in here imports anything. That is the invariant: this module is the
// leaf of the published declaration graph.

/** An environment as the client resolver reads it. */
export type MessagesClientEnv = Record<string, string | undefined>;

/** Which tier of the credential chain supplied a key. */
export type MessagesCredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/**
 * A credential resolved from one tier of the chain.
 *
 * `apiKey` is non-enumerable and redacted by a custom-inspect hook in the
 * resolver, so spreading or serializing a resolution drops it. That is a
 * runtime property of the value, not something a type can carry.
 */
export interface MessagesResolvedCredential {
  readonly apiKey: string;
  readonly tier: MessagesCredentialTier;
  /** An env key NAME, an absolute file path, or `keychain:<service>@<account>`. Never a value. */
  readonly source: string;
  /** True for tiers an operator sets on purpose. These never fall through. */
  readonly deliberate: boolean;
  /** The disk paths consulted before this credential was chosen. */
  readonly diskCandidates: readonly string[];
  /** Human-readable advisory. Never contains key material. */
  readonly warning: string | null;
}

/**
 * A per-request credential source.
 *
 * Prefer this over a bare string for a long-lived client: `MessagesClient`
 * calls it fresh for every request, so a key rotation heals without a rebuild.
 */
export type MessagesCredentialProvider = () => MessagesResolvedCredential;

/** The captured outcome of one `security` invocation. `stdout` IS the secret. */
export interface MessagesKeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type MessagesKeychainCommandRunner = (
  argv: readonly string[],
) => MessagesKeychainCommandResult;

/** Keychain-tier controls. Every field is optional; production callers pass nothing. */
export interface MessagesKeychainTierOptions {
  /**
   * Whether the Keychain is consulted for a caller-built env object. The tier
   * is AMBIENT: by default it runs only for the live `process.env`. Injecting
   * `run` implies `true`.
   */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name (label before the first dot), used when `HASNA_STATION` is unset. */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
  run?: MessagesKeychainCommandRunner;
}

/** Tier-1 credential inputs (`--api-key` / `--profile`) plus the Keychain-tier seam. */
export interface MessagesCredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: MessagesKeychainTierOptions;
}

/** Options a messages surface hands the shared resolver. */
export interface MessagesClientResolveOptions {
  /** Tier 1: an explicit authority. Pins the client; no ambient credential is attached without `apiKey`. */
  baseUrl?: string;
  /** Tier 1: an explicit credential. Never re-resolved. */
  apiKey?: string;
  /** Tier 1 profile selection and the injectable `security` runner tests use. */
  credentials?: MessagesCredentialChainOptions;
  /** Defaults to `process.env`. */
  env?: MessagesClientEnv;
}

/** The transports a messages client surface can select. */
export type MessagesClientTransport = "http" | "local";

/** The on-box store is selected ONLY by the explicit local opt-in. */
export const MESSAGES_LOCAL_OPT_IN_ENV_KEYS = [
  "HASNA_MESSAGES_LOCAL",
  "MESSAGES_LOCAL",
] as const;

/**
 * The uniform transport report. It names SOURCES, never values: an env key
 * NAME, a Keychain item reference, an absolute file PATH, `"default"` (the
 * fleet gateway), or `"local-opt-in"`.
 */
export interface MessagesClientTransportReport {
  transport: MessagesClientTransport;
  /** What selected the transport. */
  source: string;
  /** The resolved `<origin>/v1` request root (http only); null on the on-box store. */
  baseUrl: string | null;
  /** The authority exactly as CONFIGURED (pre-`/v1`), or null when the fleet gateway default applied. */
  configuredApiBase: string | null;
  apiUrlPresent: boolean;
  /** WHERE the API URL came from: an env key NAME, a Keychain item reference, a file PATH, `"default"`, or null. */
  apiUrlSource: string | null;
  apiKeyPresent: boolean;
  /** WHERE the API key came from: an env key NAME, a Keychain item reference, an absolute file PATH, or null. Never the value. */
  apiKeySource: string | null;
  /** Which tier of the credential chain supplied the key. */
  apiKeyTier: MessagesCredentialTier | null;
  /** Advisory from the shared resolver. Never a value. */
  warning: string | null;
  /** True when the explicit local opt-in selected the on-box store. */
  localOptIn: boolean;
  /** True when `baseUrl` pinned the authority, so no ambient credential applies. */
  authorityPinned: boolean;
}