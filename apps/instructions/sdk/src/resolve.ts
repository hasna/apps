/**
 * Credential and authority resolution for the `@hasna/instructions-sdk` `/v1`
 * surface.
 *
 * There is exactly ONE resolver on the fleet — the client chain in
 * `@hasna/contracts/client` — and this module is the SDK's adapter onto it
 * (2026-09-04 adoption ruling, hasna/apps#1720). The tiers are the fleet's
 * five, resolved fresh on every call:
 *
 *   1. an explicit argument      — `options.apiKey` / `options.baseUrl`
 *   2. a deliberate env pointer  — `HASNA_INSTRUCTIONS_API_KEY_OVERRIDE`,
 *                                  `HASNA_PROFILE`, `HASNA_INSTRUCTIONS_API_KEY_REF`
 *   3. the macOS Keychain        — `hasna.credentials.instructions.api-key`
 *   4. disk                      — `~/.hasna/instructions/config/credentials` (0400/0600)
 *   5. `HASNA_INSTRUCTIONS_API_KEY` — a legitimate tier, no deprecation notice
 *
 * with the authority following `HASNA_INSTRUCTIONS_API_URL`, the Keychain
 * `api-url` item, the credentials file, and finally the fleet gateway
 * `https://api.hasna.com/instructions`. The legacy unprefixed
 * `INSTRUCTIONS_API_URL` / `INSTRUCTIONS_API_KEY` spellings remain only as the
 * resolver's silent alias fallback for one release. Retired locations
 * (`~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`,
 * `$XDG_CONFIG_HOME`) are inputs nowhere, and no `*_MODE` / `*_STORAGE_MODE`
 * variable selects anything.
 *
 * THE EXPLICIT-URL RULE (hasna/apps#1794). An explicit `baseUrl` is a
 * deliberate selection of a specific authority, and the machine's fleet
 * credential is pinned to the authority it resolved with — so the SDK NEVER
 * attaches the ambient Keychain/disk/env key to an explicit `baseUrl` that was
 * passed without an `apiKey`. That call THROWS instead; the caller must pass
 * its own `apiKey` for the authority it chose.
 *
 * FAIL CLOSED. A resolver refusal (no credential anywhere, an unusable
 * credential file, a URL without a key) throws with the resolver's own
 * message; there is no local mode and no unauthenticated client.
 */
import {
  clientTransportEnvKeys,
  resolveClientTransport,
  resolveCredential,
  type CredentialChainOptions,
  type KeychainTierOptions,
} from "@hasna/contracts/client";
import { InstructionsV1Client, type InstructionsV1ClientOptions } from "./v1.generated.js";

/** The app slug the shared resolver resolves credentials and authority for. */
export const INSTRUCTIONS_SDK_APP = "instructions";

// ── Local spellings of the crossing types ─────────────────────────────────────
// `@hasna/contracts` is a BUILD-TIME dependency of this package (the `./resolve`
// entry inlines it with `--target bun`), so the emitted `resolve.d.ts` must not
// import it — every type below is spelled locally and checked against the real
// shapes by the assignments at the seam in this module (hasna/apps#1782).
// `client-types.test.ts` in the main package asserts the same spellings against
// the @hasna/contracts typings.

/** The Keychain-tier controls the SDK forwards to the resolver. */
export interface InstructionsSdkKeychainOptions {
  enabled?: boolean;
  platform?: string;
  hostname?: () => string;
  run?: (argv: readonly string[]) => { status: number | null; stdout: string; stderr: string };
}

/** An environment as the resolver reads it. */
export type InstructionsSdkEnv = Record<string, string | undefined>;

/** Options for resolving the SDK transport and building the `/v1` client. */
export interface InstructionsSdkResolveOptions {
  /** Tier 1: an explicit authority (origin, with or without a trailing `/v1`). */
  baseUrl?: string;
  /** Tier 1: an explicit credential. Required when `baseUrl` is explicit. */
  apiKey?: string;
  /** Tier 1 profile selection; also used by tests to inject a fake `security` runner. */
  credentials?: { apiKey?: string; profile?: string; keychain?: InstructionsSdkKeychainOptions };
  /** Defaults to `process.env`. */
  env?: InstructionsSdkEnv;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

/**
 * Where the SDK's credential and authority came from — never a resolver-tier
 * key VALUE. The value itself is only ever produced by
 * {@link createInstructionsV1ClientFromEnv}, which hands it straight to the
 * transport; a report or diagnostic can never leak it.
 */
export interface InstructionsSdkTransportReport {
  /** `"explicit"` for a caller-selected authority+key pair, `"http"` for a resolver-decided hosted run. */
  mode: "explicit" | "http";
  /** Origin (and any gateway path prefix) WITHOUT the `/v1` suffix. */
  baseUrl: string;
  /** The caller's own key in `"explicit"` mode; null when the chain decided (the value is not reported). */
  apiKey: string | null;
  /** WHERE the key came from: an env key NAME, a Keychain reference, a path, or `"explicit apiKey argument"`. */
  apiKeySource: string | null;
  /** WHERE the authority came from, or `"default"` for the fleet gateway. */
  apiUrlSource: string;
}

function stripV1(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Assemble the chain options the resolver will see. */
function chainOptions(options: InstructionsSdkResolveOptions): CredentialChainOptions {
  const credentials: CredentialChainOptions = { ...options.credentials };
  if (options.apiKey !== undefined) credentials.apiKey = options.apiKey;
  if (!credentials.keychain && options.credentials?.keychain) {
    credentials.keychain = options.credentials.keychain as KeychainTierOptions;
  }
  return credentials;
}

/**
 * Resolve the SDK's authority and credential SOURCE.
 *
 * An explicit `baseUrl` + `apiKey` pair is a pin the caller owns and is used
 * verbatim (never resolved around). An explicit `baseUrl` WITHOUT an `apiKey`
 * throws — the SDK must not attach the machine's fleet key to an arbitrary
 * authority (#1794). Otherwise the @hasna/contracts chain decides, and every
 * refusal throws; there is no local mode on this surface.
 */
export function resolveInstructionsSdkTransport(
  options: InstructionsSdkResolveOptions = {},
): InstructionsSdkTransportReport {
  const env: InstructionsSdkEnv = options.env ?? (typeof process !== "undefined" ? (process.env as InstructionsSdkEnv) : {});
  const credentials = chainOptions(options);

  if (options.baseUrl) {
    if (!options.apiKey) {
      throw new Error(
        "INSTRUCTIONS_SDK_CREDENTIAL_MISSING: an explicit baseUrl was provided without an apiKey. " +
          "The SDK never attaches the machine's fleet credential (Keychain, ~/.hasna/instructions/config/credentials, " +
          "or HASNA_INSTRUCTIONS_API_KEY) to an explicit authority — pass apiKey explicitly for the authority you chose.",
      );
    }
    return {
      mode: "explicit",
      baseUrl: stripV1(options.baseUrl),
      apiKey: options.apiKey,
      apiKeySource: "explicit apiKey argument",
      apiUrlSource: "explicit baseUrl argument",
    };
  }

  const resolution = resolveClientTransport(INSTRUCTIONS_SDK_APP, env, { credentials });
  return {
    mode: "http",
    baseUrl: stripV1(resolution.baseUrl),
    apiKey: null,
    apiKeySource: resolution.apiKeySource,
    apiUrlSource: resolution.apiUrlSource ?? "default",
  };
}

/** The credential VALUE for the chain-decided path, resolved fresh. */
function resolveChainCredential(options: InstructionsSdkResolveOptions): string {
  const env: InstructionsSdkEnv = options.env ?? (typeof process !== "undefined" ? (process.env as InstructionsSdkEnv) : {});
  const credential = resolveCredential(INSTRUCTIONS_SDK_APP, env, chainOptions(options));
  if (!credential) {
    // The transport resolution above already threw for the empty case; kept as
    // a refusal so a future resolver change cannot turn a missing key into an
    // anonymous client.
    const keys = clientTransportEnvKeys(INSTRUCTIONS_SDK_APP);
    throw new Error(
      `INSTRUCTIONS_SDK_CREDENTIAL_MISSING: no ${keys.apiKeyKeys[0]} resolved from any credential tier; ` +
        "refusing to build an unauthenticated client. Looked in the Keychain item " +
        "hasna.credentials.instructions.api-key, ~/.hasna/instructions/config/credentials, then " +
        `${keys.apiKeyKeys[0]}.`,
    );
  }
  return credential.apiKey;
}

/**
 * Build the hosted `/v1` client with the fleet resolver behind it, fresh on
 * every request.
 *
 * The generated client stores whatever key it is handed, so a client built
 * once and held for hours would keep sending the key that resolved at
 * construction — the staleness the fresh-per-call chain exists to remove.
 * Rather than forking the generated file, the credential is re-resolved in a
 * `fetch` wrapper: the generated request has already set `x-api-key` from its
 * stored value by the time we see it, and we overwrite that header with the
 * key the chain resolves NOW. A re-resolution that throws or comes back empty
 * leaves the generated header in place, so a transient unreadable Keychain
 * cannot turn a working client into a failing one mid-flight.
 *
 * In `"explicit"` mode (caller-supplied baseUrl + apiKey) the key is a pin the
 * caller owns and is sent verbatim on every request.
 */
export function createInstructionsV1ClientFromEnv(
  options: InstructionsSdkResolveOptions = {},
): InstructionsV1Client {
  const resolved = resolveInstructionsSdkTransport(options);

  const baseFetch: typeof fetch =
    options.fetch ?? (((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch);
  let clientKey: string | undefined;
  let fetchImpl: typeof fetch = baseFetch;

  if (resolved.mode === "http") {
    clientKey = resolveChainCredential(options);
    const refreshOptions: InstructionsSdkResolveOptions = { ...options };
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers ?? {}).forEach((value, key) => {
        headers[key] = value;
      });
      try {
        headers["x-api-key"] = resolveChainCredential(refreshOptions);
      } catch {
        // keep the credential the client was constructed with
      }
      return baseFetch(input, { ...init, headers });
    }) as typeof fetch;
    fetchImpl = wrapped;
  } else {
    clientKey = resolved.apiKey ?? undefined;
  }

  const clientOptions: InstructionsV1ClientOptions = {
    baseUrl: resolved.baseUrl,
    ...(clientKey ? { apiKey: clientKey } : {}),
    fetch: fetchImpl,
    ...(options.headers ? { headers: options.headers } : {}),
  };
  return new InstructionsV1Client(clientOptions);
}