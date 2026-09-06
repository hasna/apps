/**
 * The one seam between @hasna/instructions and the shared Hasna resolver.
 *
 * WHAT THIS REPLACED. Until hasna/apps#1720 this package owned a second
 * credential chain of its own (the env pair + the hand-rolled CloudConfigStore
 * fetch client in `src/data/config-store.ts`): `HASNA_INSTRUCTIONS_API_URL` /
 * `HASNA_INSTRUCTIONS_API_KEY` read directly, a retired-chain rejection module,
 * and no Keychain, no `~/.hasna/instructions/config/credentials` tier and no
 * default gateway authority — so on a station whose credential lives in the
 * Keychain `instructions list` failed closed with an env-only message naming
 * variables that were not the answer.
 *
 * WHAT THIS MODULE PUBLISHES. @hasna/contracts is a BUILD-TIME dependency:
 * `bun build --target bun` inlines the resolver, so the shipped bundles import
 * node builtins only. The declarations `tsc` emits are not bundled, so nothing
 * this module names in an EXPORTED type signature may import @hasna/contracts
 * (dist/**\/*.d.ts would carry the import and break every TS consumer —
 * hasna/apps#1782). The contracts VALUES are therefore imported here for this
 * package's own modules, while every TYPE that crosses the published boundary
 * is spelled in ./client-types.ts. `client-types.test.ts` asserts the two
 * spellings are the same types.
 *
 * THE FIVE TIERS the resolver applies, in order, FRESH ON EVERY CALL:
 *   1. an explicit argument            — `apiKey` / `profile` passed in code
 *   2. a deliberate env pointer        — HASNA_INSTRUCTIONS_API_KEY_OVERRIDE,
 *                                        HASNA_PROFILE, HASNA_INSTRUCTIONS_API_KEY_REF
 *   3. the macOS Keychain (darwin)     — `hasna.credentials.instructions.api-key`,
 *                                        account HASNA_STATION -> `hostname -s` -> USER
 *   4. disk                            — ~/.hasna/instructions/config/credentials
 *                                        (HASNA_HOME / HASNA_CONFIG_HOME override;
 *                                        XDG is never consulted)
 *   5. HASNA_INSTRUCTIONS_API_KEY in the env — legitimate, no deprecation notice
 *
 * The authority follows the same ladder — HASNA_INSTRUCTIONS_API_URL, the
 * Keychain `api-url` item, the credentials file — and DEFAULTS to the fleet
 * gateway `https://api.hasna.com/instructions` once a credential resolves (the
 * client appends `/v1`). Retired locations (~/.hasna/fleet-env, ~/.hasna/cloud,
 * ~/.config/hasna) are never read, and no `*_MODE` / `*_STORAGE_MODE` variable
 * selects anything: the transport is decided by URL + key alone.
 *
 * FAIL LOUD. Hosted mode with no credential exits non-zero with one clear line;
 * there is no SQLite fallback and no local-fallback event. The on-box SQLite
 * store is reachable ONLY through the deliberate unhosted opt-in
 * `HASNA_INSTRUCTIONS_LOCAL=1` (see ./local-opt-in.ts), and every local run
 * says "local" on stderr.
 */
import {
  clientTransportEnvKeys,
  resolveClientTransport,
} from "@hasna/contracts/client";
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import type {
  InstructionsClientEnv,
  InstructionsClientTransportResolution,
  InstructionsCredentialChainOptions,
  InstructionsStorageClient,
} from "./client-types.js";
import {
  INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS,
  instructionsLocalModeNotice,
  instructionsResolverInputs,
  isInstructionsLocalOptIn,
  selectsInstructionsLocalStore,
} from "./local-opt-in.js";

/** The app slug: the Keychain service, the `~/.hasna/instructions` folder, the gateway path. */
export const INSTRUCTIONS_APP = "instructions";

/** The explicit opt-in env, for messages that have to name exactly one name. */
export const INSTRUCTIONS_LOCAL_OPT_IN_ENV = INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS[0] as string;

export { INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS, instructionsLocalModeNotice, isInstructionsLocalOptIn };

/** Injectable seam controls: tier-1 credential inputs and the Keychain runner tests use. */
export interface InstructionsResolverOptions {
  credentials?: InstructionsCredentialChainOptions;
}

/**
 * Re-throw a `@hasna/contracts` resolution failure as the Instructions app's
 * own fail-closed diagnostic, preserving the resolver's message (which names
 * every tier it consulted) behind the stable `REMOTE_API_*` code callers match
 * on. Nothing here ever returns a client or a local store: every arm throws.
 */
export function rethrowInstructionsAuthorityFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const failure = (code: string, lead: string): never => {
    throw new Error(
      `${code}: ${lead} ${message} There is no local fallback: local SQLite is opt-in only ` +
        `(${INSTRUCTIONS_LOCAL_OPT_IN_ENV}=1) and is disabled by default — failing closed`,
      { cause: error },
    );
  };
  if (name === "CredentialResolutionError" || name === "CredentialFileUnsafeError") {
    return failure(
      "REMOTE_API_CREDENTIAL_INVALID",
      "The configured Instructions credential could not be used.",
    );
  }
  if (/no API key could be resolved/.test(message)) {
    if (/is not set and no API key could be resolved/.test(message)) {
      return failure(
        "REMOTE_API_CONFIG_MISSING",
        "no Instructions credential resolved from the Keychain item " +
          "hasna.credentials.instructions.api-key, ~/.hasna/instructions/config/credentials, " +
          `or ${clientTransportEnvKeys(INSTRUCTIONS_APP).apiKeyKeys[0]}.`,
      );
    }
    return failure(
      "REMOTE_API_KEY_MISSING",
      "an Instructions authority is configured but no API key resolved — looked in " +
        "hasna.credentials.instructions.api-key, ~/.hasna/instructions/config/credentials, " +
        `and ${clientTransportEnvKeys(INSTRUCTIONS_APP).apiKeyKeys[0]}.`,
    );
  }
  return failure("REMOTE_API_URL_INVALID", "the configured Instructions authority is invalid.");
}

/**
 * Resolve the client transport (authority + credential source) through the one
 * shared resolver. Throws {@link rethrowInstructionsAuthorityFailure} on every
 * refusal; never returns a transport without a credential.
 *
 * Fresh on every call: the CLI calls it per command, the MCP server per tool
 * call, and the SDK per client construction — and the contracts transport
 * additionally re-resolves the credential on every REQUEST.
 */
export function resolveInstructionsClientTransport(
  env: InstructionsClientEnv = process.env,
  options: InstructionsResolverOptions = {},
): InstructionsClientTransportResolution {
  const inputs = instructionsResolverInputs(env, options.credentials);
  try {
    return resolveClientTransport(INSTRUCTIONS_APP, inputs.env, {
      credentials: inputs.credentials,
    });
  } catch (error) {
    rethrowInstructionsAuthorityFailure(error);
  }
}

/**
 * Resolve the authenticated `/v1` storage client through the one shared
 * resolver. Missing or invalid configuration throws; there is no local-data
 * return branch. Every request re-resolves the credential through the
 * transport's binding provider, so a rotation heals a long-lived process
 * without a rebuild.
 */
export function resolveInstructionsStorageClient(
  env: InstructionsClientEnv = process.env,
  options: InstructionsResolverOptions = {},
): { transport: "http"; client: InstructionsStorageClient } {
  const inputs = instructionsResolverInputs(env, options.credentials);
  try {
    return resolveStorageClient(INSTRUCTIONS_APP, inputs.env, {
      // Redirects are never followed: a 3xx from an arbitrary authority must
      // not receive the machine's credential (the resolver refuses to send a
      // credential written for one authority to another).
      fetchImpl: (input, init) => fetch(input, { ...init, redirect: "manual" }),
      credentials: inputs.credentials,
    });
  } catch (error) {
    rethrowInstructionsAuthorityFailure(error);
  }
}

/**
 * Machine-readable transport report, for surfaces that report refusals as data
 * (a status line, `whoami`) rather than as an exception.
 *
 * `local_fallback` is ALWAYS false: nothing in this app ever silently demotes
 * a hosted configuration to the on-box store, and no local-fallback event
 * exists.
 */
export interface InstructionsTransportStatus {
  /** True when a configured transport is in effect (every non-opt-in run). */
  selected: boolean;
  ok: boolean;
  transport: "http" | "local" | "invalid";
  api_url_configured: boolean;
  api_key_configured: boolean;
  /** WHERE the authority came from: an env key NAME, a Keychain reference, a file PATH, or "default". */
  api_url_source: string | null;
  /** WHERE the credential came from: an env key NAME, a Keychain reference, or a file PATH. Never a value. */
  api_key_source: string | null;
  /** Which tier of the @hasna/contracts chain supplied the credential. */
  api_key_tier: string | null;
  v1_base_url: string | null;
  issues: string[];
  local_fallback: false;
}

/**
 * Resolve the current transport and report it. Never throws: a refused
 * configuration is reported as `ok: false` with the failure in `issues`.
 */
export function getInstructionsTransportStatus(
  env: InstructionsClientEnv = process.env,
  options: InstructionsResolverOptions = {},
): InstructionsTransportStatus {
  if (selectsInstructionsLocalStore(env)) {
    return {
      selected: false,
      ok: true,
      transport: "local",
      api_url_configured: false,
      api_key_configured: false,
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
      v1_base_url: null,
      issues: [],
      local_fallback: false,
    };
  }
  try {
    const resolution = resolveInstructionsClientTransport(env, options);
    return {
      selected: true,
      ok: true,
      transport: "http",
      api_url_configured: resolution.apiUrlSource !== null && resolution.apiUrlSource !== "default",
      api_key_configured: resolution.apiKeyPresent,
      api_url_source: resolution.apiUrlSource,
      api_key_source: resolution.apiKeySource,
      api_key_tier: resolution.apiKeyTier,
      v1_base_url: resolution.baseUrl,
      issues: [],
      local_fallback: false,
    };
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    const keys = clientTransportEnvKeys(INSTRUCTIONS_APP);
    const declared = (names: readonly string[]) => names.some((key) => (env[key] ?? "").trim() !== "");
    return {
      selected: true,
      ok: false,
      transport: "invalid",
      api_url_configured: declared(keys.apiUrlKeys),
      api_key_configured: declared(keys.apiKeyKeys),
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
      v1_base_url: null,
      issues: [issue],
      local_fallback: false,
    };
  }
}

let localNoticePrinted = false;

/** Test seam: forget that the local-mode line was printed. */
export function __resetLocalInstructionsModeNotice(): void {
  localNoticePrinted = false;
}

/**
 * Say — once per process, on stderr — that this run is using the on-box
 * SQLite store. Local mode is legitimate (the explicit opt-in), but "no
 * credential resolved" and "deliberately offline" look identical in the output
 * otherwise, and the first one is usually a misconfiguration (owner rulings
 * 2026-09-04).
 */
export function announceLocalInstructionsMode(
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): boolean {
  if (localNoticePrinted) return false;
  localNoticePrinted = true;
  write(instructionsLocalModeNotice());
  return true;
}