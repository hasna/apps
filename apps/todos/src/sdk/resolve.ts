/**
 * Credential and authority resolution for the `@hasna/todos/sdk` surface.
 *
 * There is exactly ONE resolver on the fleet — the client chain in
 * `@hasna/contracts/client` — and this module is the SDK's adapter onto it
 * (2026-09-04 adoption ruling, hasna/apps#1720). The SDK used to carry its own
 * chain: `TODOS_URL` for the authority and an unprefixed key name (or an `apiKey` field
 * inside `~/.todos/config.json`) for the credential. Both are gone. A credential
 * in `config.json` was a world-readable secret in a file the CLI also rewrites
 * for unrelated settings, and the unprefixed names shadowed the canonical
 * `HASNA_TODOS_API_URL` / `HASNA_TODOS_API_KEY` pair — an operator who exported
 * the canonical pair got the localhost default anyway.
 *
 * The tiers are the fleet's five, resolved fresh on every call:
 *
 *   1. an explicit argument      — `options.apiKey` / `options.baseUrl`
 *   2. a deliberate env pointer  — `HASNA_TODOS_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
 *                                  `HASNA_TODOS_API_KEY_REF`
 *   3. the macOS Keychain        — `hasna.credentials.todos.api-key`
 *   4. disk                      — `~/.hasna/todos/config/credentials` (0400/0600)
 *   5. `HASNA_TODOS_API_KEY`     — a legitimate tier, no deprecation notice
 *
 * with the authority following `HASNA_TODOS_API_URL`, the Keychain `api-url`
 * item, the credentials file, and finally the fleet gateway
 * `https://api.hasna.com/todos`. The legacy unprefixed `TODOS_*` spellings
 * remain only as the resolver's silent alias fallback for one release.
 *
 * LOCAL MODE IS DELIBERATE, NEVER A FALLBACK FROM FAILURE. `TodosClient` speaks
 * the `/api/*` plane that `todos-serve` exposes on a workstation, so the
 * unhosted default — `http://localhost:19427`, no credential — is a real
 * product mode rather than a silent degradation. It is therefore reachable in
 * exactly two ways: the deliberate opt-in `HASNA_TODOS_LOCAL=1`, or an
 * environment where NOTHING resolves at all. A credential that resolves but
 * cannot be used, an unreadable credential file, an authority that is set but
 * malformed — every one of those THROWS. And when local mode is selected the
 * SDK says so, once per process, on stderr: a client silently talking to an
 * empty local store while the operator believes it is on the fleet is the
 * false-green this whole ruling exists to end.
 */
import {
  ClientTransportConfigurationError,
  resolveClientTransport,
  resolveCredential,
  type ClientTransportResolution,
  type CredentialChainOptions,
  type ResolveClientTransportOptions,
} from "@hasna/contracts/client";
import { TodosV1Client, type TodosV1ClientOptions } from "./v1.generated.js";
import { selectsTodosLocalStore, todosResolverInputs } from "../lib/local-opt-in.js";

/** The unhosted `todos-serve` a workstation runs. Never a hosted authority. */
export const TODOS_LOCAL_SERVE_URL = "http://localhost:19427";

type Env = Record<string, string | undefined>;

export interface TodosSdkTransport {
  /** `"http"` for a resolved hosted authority, `"local-serve"` for the unhosted default. */
  mode: "http" | "local-serve";
  /**
   * Origin (plus any gateway path prefix) WITHOUT the `/v1` suffix, so a caller
   * that composes `/api/...` or `/v1/...` gets exactly one version segment.
   */
  baseUrl: string;
  /** The credential, or null in local mode. */
  apiKey: string | null;
  /** WHERE the credential came from — an env key NAME, a Keychain reference, a path. Never a value. */
  apiKeySource: string | null;
  /** WHERE the authority came from, or `"local-serve"`. */
  apiUrlSource: string;
}

export interface ResolveTodosSdkTransportOptions {
  /** Tier 1: an explicit authority. Used verbatim, minus a trailing slash. */
  baseUrl?: string | undefined;
  /** Tier 1: an explicit credential. */
  apiKey?: string | undefined;
  /** Tier 1 profile selection and the injectable `security` runner tests use. */
  credentials?: CredentialChainOptions;
  /** Defaults to `process.env`. */
  env?: Env;
  /** Where the one-line local-mode notice goes. Defaults to `process.stderr`. */
  notice?: (line: string) => void;
}

let localNoticePrinted = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetTodosSdkLocalNotice(): void {
  localNoticePrinted = false;
}

function stripV1(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function announceLocal(notice: ((line: string) => void) | undefined, reason: string): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  const line =
    `todos: LOCAL mode — no Hasna credential resolved (${reason}); reading and writing the local ` +
    `todos-serve at ${TODOS_LOCAL_SERVE_URL}, not the hosted fleet. Set HASNA_TODOS_API_KEY, add the ` +
    `Keychain item hasna.credentials.todos.api-key, or write ~/.hasna/todos/config/credentials to go hosted.`;
  if (notice) notice(line);
  else if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
}

/**
 * Resolve the SDK's authority and credential. Explicit arguments win; otherwise
 * the @hasna/contracts chain decides, and only a fully unconfigured environment
 * (or the deliberate opt-in) lands on the local serve.
 */
export function resolveTodosSdkTransport(
  options: ResolveTodosSdkTransportOptions = {},
): TodosSdkTransport {
  const rawEnv: Env = options.env ?? (typeof process !== "undefined" ? (process.env as Env) : {});
  // The credential options the chain will see, assembled BEFORE the env is
  // normalised: dropping a declared-but-blank variable hands the resolver a
  // copy, and a copy is not the ambient environment its Keychain tier gates on,
  // so the gate has to travel with it (see `todosResolverInputs`).
  const requestedCredentials: CredentialChainOptions = {
    ...options.credentials,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  };
  const { env, credentials } = todosResolverInputs(rawEnv, requestedCredentials);

  // Tier 1, and the only way to reach an arbitrary authority: an explicit
  // argument is a deliberate selection, so it is never resolved around.
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
  if (selectsTodosLocalStore(env)) {
    announceLocal(options.notice, "HASNA_TODOS_LOCAL is set and nothing configures an authority");
    return {
      mode: "local-serve",
      baseUrl: TODOS_LOCAL_SERVE_URL,
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
  const credential = resolveCredential("todos", env, credentials);
  const chainOptions: ResolveClientTransportOptions = {
    credentials: credential ? { ...credentials, apiKey: credential.apiKey } : credentials,
  };

  let resolution: ClientTransportResolution;
  try {
    resolution = resolveClientTransport("todos", env, chainOptions);
  } catch (error) {
    // ONLY "nothing is configured at all" degrades to the local serve. Every
    // other refusal — a blank variable, a disagreeing pair, an unreadable
    // credential file, a URL without a key — is a misconfiguration the operator
    // has to see, and silently serving an empty local store instead is the
    // false green this fails loudly to avoid.
    if (
      error instanceof ClientTransportConfigurationError &&
      /is not set and no API key could be resolved/.test(error.message)
    ) {
      announceLocal(options.notice, "nothing configured a Hasna Todos credential");
      return {
        mode: "local-serve",
        baseUrl: TODOS_LOCAL_SERVE_URL,
        apiKey: null,
        apiKeySource: null,
        apiUrlSource: "local-serve",
      };
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
 * generated {@link TodosV1Client} takes an explicit `baseUrl` and has no
 * environment surface of its own, which left every caller writing a private
 * copy of the chain.
 *
 * Throws when no credential resolves: this client speaks only to the hosted
 * authority, so there is no local mode to degrade to.
 */
export function createTodosV1Client(
  options: ResolveTodosSdkTransportOptions & Pick<TodosV1ClientOptions, "fetch" | "headers"> = {},
): TodosV1Client {
  const resolved = resolveTodosSdkTransport(options);
  if (resolved.mode !== "http" || !resolved.apiKey) {
    throw new Error(
      "TODOS_CREDENTIAL_MISSING: the /v1 client is hosted-only and no Hasna Todos credential resolved. " +
        "Looked at HASNA_TODOS_API_KEY_OVERRIDE / HASNA_PROFILE / HASNA_TODOS_API_KEY_REF, the Keychain item " +
        "hasna.credentials.todos.api-key, ~/.hasna/todos/config/credentials, then HASNA_TODOS_API_KEY.",
    );
  }
  // PER-CALL, NOT PER-CLIENT. `TodosV1Client` is generated from the OpenAPI
  // document and stores whatever `apiKey` it is handed, so a client built once
  // and held for hours would keep sending the key that happened to resolve at
  // startup — the staleness the fresh-per-call chain exists to remove. Rather
  // than fork the generated file, the credential is refreshed in a `fetch`
  // wrapper: the generated request has already set `x-api-key` from its stored
  // value by the time we see it, and we overwrite that header with the key the
  // chain resolves NOW. A re-resolution that throws or comes back empty leaves
  // the generated header in place, so a transient unreadable Keychain cannot
  // turn a working client into a failing one mid-flight.
  const baseFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // The per-request re-resolution must not TALK. It re-runs the same resolution
  // that already succeeded above against the same environment, so any notice it
  // produces is about a state this client is not in: a mid-flight degradation
  // prints the "LOCAL mode — ... not the hosted fleet" line while the client is
  // still addressing its original hosted authority with its constructed key.
  // The refreshed credential is used; the commentary is dropped.
  const refreshOptions: ResolveTodosSdkTransportOptions = { ...options, notice: () => {} };
  const fetchWithFreshCredential = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Normalise whatever shape the init carries. The generated client hands us
    // a plain record today, but that was asserted only in a comment: an object
    // spread over a `Headers` instance or a tuple array yields `{}` and would
    // silently drop EVERY header, Content-Type included, the moment the client
    // is regenerated. `Headers` normalises all three shapes for us.
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    try {
      const fresh = resolveTodosSdkTransport(refreshOptions).apiKey;
      if (fresh) headers["x-api-key"] = fresh;
    } catch {
      // keep the credential the client was constructed with
    }
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
  return new TodosV1Client({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    fetch: fetchWithFreshCredential,
    ...(options.headers ? { headers: options.headers } : {}),
  });
}
