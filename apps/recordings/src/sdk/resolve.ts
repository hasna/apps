/**
 * Credential and authority resolution for the `@hasna/recordings/sdk` surface.
 *
 * There is exactly ONE resolver on the fleet — the client chain in
 * `@hasna/contracts/client` — and this module is the SDK's adapter onto it
 * (2026-09-04 adoption ruling, hasna/apps#1720). The SDK used to have no
 * resolution of its own: consumers were told to read
 * `process.env.HASNA_RECORDINGS_API_URL` / `HASNA_RECORDINGS_API_KEY`
 * themselves, i.e. to write a private copy of the chain in every consumer.
 * That copy is gone; this module resolves for them, fresh per call.
 *
 * The tiers are the fleet's five, resolved fresh on every call:
 *
 *   1. an explicit argument      — `options.apiKey` / `options.baseUrl`
 *   2. a deliberate env pointer  — `HASNA_RECORDINGS_API_KEY_OVERRIDE`,
 *                                  `HASNA_PROFILE`, `HASNA_RECORDINGS_API_KEY_REF`
 *   3. the macOS Keychain        — `hasna.credentials.recordings.api-key`
 *   4. disk                      — `~/.hasna/recordings/config/credentials` (0400/0600)
 *   5. `HASNA_RECORDINGS_API_KEY` — a legitimate tier, no deprecation notice
 *
 * with the authority following `HASNA_RECORDINGS_API_URL`, the Keychain
 * `api-url` item, the credentials file, and finally the fleet gateway
 * `https://api.hasna.com/recordings` (the client appends `/v1`). The unprefixed
 * `RECORDINGS_API_URL` / `RECORDINGS_API_KEY` spellings are carved OUT of the
 * resolver environment by this package's seam (src/lib/local-opt-in.ts):
 * `RECORDINGS_API_KEY` is this app's OpenAI transcription-key override, never
 * a Hasna credential.
 *
 * LOCAL MODE IS DELIBERATE, NEVER A FALLBACK FROM FAILURE. `RecordingsV1Client`
 * speaks the `/v1` plane that `recordings-serve` exposes, and the on-box
 * SQLite store is this package's first-class local dataset — so the unhosted
 * default (`http://localhost:8874`, no credential) is a real product mode
 * rather than a silent degradation. It is therefore reachable ONLY through the
 * explicit opt-in `HASNA_RECORDINGS_LOCAL=1`, and when local mode is selected
 * the SDK says so, once per process, on stderr: a client silently talking to a
 * local process while the operator believes it is on the fleet is the
 * false-green this whole ruling exists to end. EVERY other refusal — a blank
 * variable, an unreadable credential file, an authority that is set but
 * malformed — THROWS.
 */
import {
  ClientTransportConfigurationError,
  createClientTransport,
  toV1BaseUrl,
  resolveClientTransport,
  resolveCredential,
  type CredentialChainOptions,
  type ClientTransportResolution,
} from "@hasna/contracts/client";
import { RecordingsV1Client, type RecordingsV1ClientOptions } from "./v1.generated.js";
import {
  selectsRecordingsLocalStore,
  recordingsResolverInputs,
} from "../lib/local-opt-in.js";
import type { RecordsCredentialChainOptions } from "../http/client.js";

/** The unhosted `recordings-serve` a workstation runs. Never a hosted authority. */
export const RECORDINGS_LOCAL_SERVE_URL = "http://localhost:8874";

type Env = Record<string, string | undefined>;

export interface RecordingsSdkTransport {
  /** `"http"` for a resolved hosted authority, `"local-serve"` for the unhosted default. */
  mode: "http" | "local-serve";
  /**
   * Origin (plus any gateway path prefix) WITHOUT the `/v1` suffix, so a caller
   * that composes `/v1/...` gets exactly one version segment.
   */
  baseUrl: string;
  /** The credential, or null in local mode. */
  apiKey: string | null;
  /** WHERE the credential came from — an env key NAME, a Keychain reference, a path. Never a value. */
  apiKeySource: string | null;
  /** WHERE the authority came from, or `"local-serve"`. */
  apiUrlSource: string;
}

export interface ResolveRecordingsSdkTransportOptions {
  /** Tier 1: an explicit authority. Used verbatim, minus a trailing slash. */
  baseUrl?: string | undefined;
  /** Tier 1: an explicit credential. */
  apiKey?: string | undefined;
  /** Tier 1 profile selection and the injectable `security` runner tests use. */
  credentials?: RecordsCredentialChainOptions;
  /** Defaults to `process.env`. */
  env?: Env;
  /** Where the one-line local-mode notice goes. Defaults to `process.stderr`. */
  notice?: (line: string) => void;
}

let localNoticePrinted = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetRecordingsSdkLocalNotice(): void {
  localNoticePrinted = false;
}

function stripV1(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function announceLocal(notice: ((line: string) => void) | undefined, reason: string): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  const line =
    `recordings: LOCAL mode — ${reason}; reading and writing the local ` +
    `recordings-serve at ${RECORDINGS_LOCAL_SERVE_URL}, not the hosted fleet. Set HASNA_RECORDINGS_API_KEY, add the ` +
    `Keychain item hasna.credentials.recordings.api-key, or write ~/.hasna/recordings/config/credentials to go hosted.`;
  if (notice) notice(line);
  else if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
}

/**
 * Resolve the SDK's authority and credential. Explicit arguments win; otherwise
 * the @hasna/contracts chain decides, and only the deliberate unhosted opt-in
 * lands on the local serve. Every refusal throws — there is no fallback.
 */
export function resolveRecordingsSdkTransport(
  options: ResolveRecordingsSdkTransportOptions = {},
): RecordingsSdkTransport {
  const rawEnv: Env = options.env ?? (typeof process !== "undefined" ? (process.env as Env) : {});
  // The credential options the chain will see, assembled BEFORE the env is
  // normalised: dropping a declared-but-blank variable hands the resolver a
  // copy, and a copy is not the ambient environment its Keychain tier gates on,
  // so the gate has to travel with it (see `recordingsResolverInputs`).
  const requestedCredentials: CredentialChainOptions = {
    ...options.credentials,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  };
  const { env, credentials } = recordingsResolverInputs(rawEnv, requestedCredentials);

  // Tier 1, and the only way to reach an arbitrary authority: an explicit
  // argument is a deliberate selection, so it is never resolved around — the
  // ambient chain is NOT consulted here, so `baseUrl` without `apiKey` sends
  // no credential at all (hasna/apps#1794).
  if (options.baseUrl) {
    return {
      mode: "http",
      baseUrl: stripV1(options.baseUrl),
      apiKey: options.apiKey ?? null,
      apiKeySource: options.apiKey ? "explicit apiKey argument" : null,
      apiUrlSource: "explicit baseUrl argument",
    };
  }

  // The same preamble the CLI runs: a configured environment outranks the
  // opt-in, so this arm is reached only when nothing at all is configured.
  if (selectsRecordingsLocalStore(env)) {
    announceLocal(
      options.notice,
      "HASNA_RECORDINGS_LOCAL is set and nothing configures an authority",
    );
    return {
      mode: "local-serve",
      baseUrl: RECORDINGS_LOCAL_SERVE_URL,
      apiKey: options.apiKey ?? null,
      apiKeySource: options.apiKey ? "explicit apiKey argument" : null,
      apiUrlSource: "local-serve",
    };
  }

  // ONE pass down the chain, not two. `resolveClientTransport` resolves the
  // credential internally but deliberately returns only its SOURCE, so reading
  // the value used to mean calling `resolveCredential` again one line later —
  // and on macOS each pass spawns `/usr/bin/security`, so a surface that
  // re-resolves per request (which the ruling requires) paid two spawns per
  // request for one answer. Resolving here and handing the value down as the
  // chain's tier-1 argument makes the second pass a no-op instead: tier 1
  // returns immediately, so the transport still decides the authority exactly
  // as before while consulting the Keychain once. It also closes a real
  // TOCTOU — the key the transport validated and the key we sent were two
  // separate reads, and a rotation between them made them different keys.
  const credential = resolveCredential("recordings", env, credentials);
  const chainOptions: { credentials: CredentialChainOptions } = {
    credentials: credential ? { ...credentials, apiKey: credential.apiKey } : credentials,
  };

  let resolution: ClientTransportResolution;
  try {
    resolution = resolveClientTransport("recordings", env, chainOptions);
  } catch (error) {
    if (
      error instanceof ClientTransportConfigurationError &&
      /is not set and no API key could be resolved/.test(error.message)
    ) {
      // NOTE: this arm is deliberately unreachable for a plain environment —
      // an unconfigured environment reaches the local-serve arm above only
      // under the explicit opt-in. It is kept as a distinct refusal so the
      // error below reads correctly against every OTHER refusal.
      throw new Error(
        "RECORDINGS_CREDENTIAL_MISSING: no Hasna Recordings credential resolved and local mode is opt-in only. " +
          "Looked at HASNA_RECORDINGS_API_KEY_OVERRIDE / HASNA_PROFILE / HASNA_RECORDINGS_API_KEY_REF, the Keychain item " +
          "hasna.credentials.recordings.api-key, ~/.hasna/recordings/config/credentials, then HASNA_RECORDINGS_API_KEY.",
        { cause: error },
      );
    }
    throw error;
  }

  return {
    mode: "http",
    baseUrl: stripV1(resolution.baseUrl),
    // The chain resolved a credential (a resolution without one throws), and
    // the value is the one resolved above — the same read the transport was
    // handed, so the key we validated is the key we send.
    apiKey: credential ? credential.apiKey : null,
    // The TRUE tier, not the tier-1 spelling the transport was handed: passing
    // the value down as an argument makes the transport report "explicit apiKey
    // argument", which would erase the Keychain/disk/env origin an operator
    // needs in a diagnostic. `credential.source` is that origin, and never a
    // value.
    apiKeySource: credential ? credential.source : resolution.apiKeySource,
    apiUrlSource: resolution.apiUrlSource ?? "default",
  };
}

/**
 * Build the hosted `/v1` client with the fleet resolver behind it — the
 * generated {@link RecordingsV1Client} takes an explicit `baseUrl` and has no
 * environment surface of its own, which left every caller writing a private
 * copy of the chain.
 *
 * Throws when no credential resolves and takes the unhosted opt-in: this client
 * speaks only to the hosted authority, so there is no local mode to degrade
 * to.
 */
export function createRecordingsV1Client(
  options: ResolveRecordingsSdkTransportOptions & Pick<RecordingsV1ClientOptions, "fetch" | "headers"> = {},
): RecordingsV1Client {
  // Validate deliberate input before placing it into resolver environment
  // fields: blank/invalid authority must never become a gateway default.
  const explicitUrl = options.baseUrl === undefined ? undefined : stripV1(toV1BaseUrl(options.baseUrl));
  const explicitKey = options.apiKey;
  const requestedCredentials: CredentialChainOptions = {
    ...options.credentials,
    ...(explicitKey !== undefined ? { apiKey: explicitKey } : {}),
  };
  const missing = () => new Error(
    "RECORDINGS_CREDENTIAL_MISSING: the /v1 client is hosted-only. Supply apiKey with an explicit baseUrl, " +
      "or configure Hasna Recordings credentials through the shared account chain.",
  );
  if (explicitUrl !== undefined && !explicitKey) throw missing();

  const connect = () => {
    // Explicit authority never attracts a disk, Keychain or environment key.
    // Omitting HOME and disabling Keychain makes the shared chain hermetic.
    if (explicitUrl !== undefined) {
      return createClientTransport("recordings", { HASNA_RECORDINGS_API_URL: explicitUrl }, {
        credentials: { apiKey: explicitKey, keychain: { enabled: false } },
        ...(options.fetch ? { fetchImpl: options.fetch } : {}),
      });
    }
    // Normalize NOW, not when the factory was constructed: this seam may copy
    // env while removing the unrelated OpenAI key. A retained copy would hide
    // subsequent credential removal/rotation and changes of authority.
    const rawEnv: Env = options.env ?? (typeof process !== "undefined" ? process.env : {});
    const { env, credentials } = recordingsResolverInputs(rawEnv, requestedCredentials);
    if (selectsRecordingsLocalStore(env)) throw missing();
    try {
      return createClientTransport("recordings", env, {
        credentials,
        ...(options.fetch ? { fetchImpl: options.fetch } : {}),
      });
    } catch (error) {
      if (error instanceof ClientTransportConfigurationError && /no API key could be resolved/.test(error.message)) {
        throw missing();
      }
      throw error;
    }
  };
  const initial = connect();
  const baseUrl = initial.resolution.baseUrl;
  const boundFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const current = connect();
    if (current.resolution.baseUrl !== baseUrl) {
      throw new ClientTransportConfigurationError(
        "recordings", "The configured service authority changed; rebuild the client before sending credentials.",
      );
    }
    // The shared transport owns the stable authority/key pair, auth headers,
    // path boundary and manual redirects. Resolver errors are never rescued
    // with the startup key. Raw responses preserve the generated API contract.
    return current.client.fetch(input, init);
  }) as typeof fetch;
  return new RecordingsV1Client({
    baseUrl: stripV1(baseUrl),
    fetch: boundFetch,
    ...(options.headers ? { headers: options.headers } : {}),
  });
}
