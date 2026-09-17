/**
 * `@hasna/hooks/sdk` — the hosted hooks registry client (package-surfaces
 * rule: one package, four surfaces; this is the importable one).
 *
 * SELF-CONTAINED. The built bundle (`dist/sdk/index.js`, `bun build --target
 * bun`) imports node builtins only: the `@hasna/contracts/client` credential
 * seam is inlined at build time, and nothing here reaches `bun:sqlite` or the
 * on-box store — the SDK has no local mode. `src/sdk/index.test.ts` pins both.
 *
 * FAIL CLOSED (hasna/apps#1720). `createHooksClient()` resolves the registry
 * authority and credential through the ONE @hasna/contracts chain (env pair →
 * Keychain item `hasna.credentials.hooks.api-key` → `~/.hasna/hooks/config/
 * credentials`), as a strict pair, fresh per call. With nothing resolved it
 * THROWS the `REMOTE_API_*` diagnostic naming the tiers and the opt-in; it
 * never returns a client that answers from a local file. The explicit local
 * opt-in (`HASNA_HOOKS_LOCAL=1`) is refused here by name: the SDK is a hosted
 * client and the on-box store is the CLI's, opt-in only.
 */
import {
  hooksRegistryOrigin,
  resolveHooksTransport,
  type HooksRemoteAuthority,
  type HooksTransportOptions,
} from "../lib/transport.js";
import { HOOKS_CREDENTIAL_TIERS, HOOKS_LOCAL_OPT_IN_HINT, selectsHooksLocalStore } from "../lib/local-opt-in.js";
import type { HooksCredentialOptions, HooksLocalOptInEnv } from "../lib/resolver-types.js";

export type { HooksRemoteAuthority, HooksCredentialOptions, HooksLocalOptInEnv };
export { hooksRegistryOrigin };

/** One row of `GET /api/v1/catalog` — the registry's latest version of a hook. */
export interface HooksRegistryCatalogEntry {
  name: string;
  version: string;
  sha256: string;
  events: string[];
  description: string;
  source: string;
  versions: string[];
}

/** One pin of `GET /api/v1/lock` — the exact version the registry wants clients on. */
export interface HooksRegistryLockEntry {
  version: string;
  sha256: string;
  source?: string;
  versions?: string[];
}

export interface HooksRegistryLock {
  hooks: Record<string, HooksRegistryLockEntry>;
}

/** `GET /api/v1/hooks/:name/:version` — a versioned artifact (manifest + script). */
export interface HooksRegistryArtifact {
  manifest: {
    name: string;
    version: string;
    description?: string;
    events: string[];
    script: string;
    script_kind?: "inline" | "file";
    args?: string[];
    timeout_ms?: number;
  };
  script: string;
  /** The registry's `x-hook-sha256` header for the served row, when present. */
  sha256: string | null;
}

export interface HooksClientOptions {
  /** Injectable environment (tests). Defaults to `process.env`. */
  env?: HooksLocalOptInEnv;
  /** Tier-1 credential inputs and the injectable `security` runner. */
  credentials?: HooksCredentialOptions;
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * Resolve the hosted authority the SDK will talk to. Throws — never returns a
 * local fallback — when nothing resolves, and refuses the local opt-in by
 * name: there is no SDK surface for the on-box store.
 */
export function resolveHooksSdkAuthority(
  env: HooksLocalOptInEnv = process.env,
  options: Omit<HooksTransportOptions, "notice"> = {},
): HooksRemoteAuthority {
  if (selectsHooksLocalStore(env)) {
    throw new Error(
      "REMOTE_COMMAND_UNSUPPORTED: @hasna/hooks/sdk is a hosted registry client and has no local mode; " +
        `${HOOKS_LOCAL_OPT_IN_HINT} selects the on-box SQLite store, which only the \`hooks\` CLI serves. ` +
        `Unset it and configure a registry credential (${HOOKS_CREDENTIAL_TIERS}).`,
    );
  }
  // The seam throws REMOTE_API_* (tiers + opt-in named) when nothing resolves;
  // the notice sink is silenced because the local arm is unreachable here.
  const transport = resolveHooksTransport(env, { ...options, notice: () => {} });
  if (transport.mode !== "remote" || !transport.authority) {
    throw new Error(
      `REMOTE_API_CONFIG_MISSING: hooks: no registry credential resolved from ${HOOKS_CREDENTIAL_TIERS}; ` +
        "the SDK never falls back to a local store.",
    );
  }
  return transport.authority;
}

/**
 * Hosted registry client. Holds the resolved credential privately and sends
 * it only to the authority it was resolved together with (strict pair).
 */
export class HooksClient {
  /** Registry origin WITHOUT `/v1` — the registry routes hang off `<origin>/api/v1`. */
  readonly origin: string;
  /** The resolver's `<origin>/v1` authority, for diagnostics. */
  readonly v1BaseUrl: string;
  /** WHERE the credential came from (env NAME, Keychain reference, file PATH). Never a value. */
  readonly apiKeySource: string | null;
  /** WHERE the authority came from. Never a value. */
  readonly apiUrlSource: string | null;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(authority: HooksRemoteAuthority, options: { fetch?: typeof fetch } = {}) {
    this.origin = authority.origin;
    this.v1BaseUrl = authority.v1BaseUrl;
    this.apiKeySource = authority.apiKeySource;
    this.apiUrlSource = authority.apiUrlSource;
    this.#apiKey = authority.apiKey;
    this.#fetch = options.fetch ?? fetch;
  }

  /** Build the request URL for a registry route (exposed so callers can log WHERE without a key). */
  urlFor(path: string): string {
    return `${this.origin}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async health(): Promise<{ status: string; name: string }> {
    return (await this.getJson("/health")) as { status: string; name: string };
  }

  async catalog(): Promise<HooksRegistryCatalogEntry[]> {
    const body = (await this.getJson("/api/v1/catalog")) as { hooks?: unknown };
    if (!body || !Array.isArray(body.hooks)) {
      throw new Error(`hooks registry catalog at ${this.origin} is malformed: missing hooks array`);
    }
    return body.hooks as HooksRegistryCatalogEntry[];
  }

  async lock(): Promise<HooksRegistryLock> {
    const body = (await this.getJson("/api/v1/lock")) as { hooks?: unknown };
    if (!body || typeof body.hooks !== "object" || body.hooks === null || Array.isArray(body.hooks)) {
      throw new Error(`hooks registry lock at ${this.origin} is malformed: missing hooks map`);
    }
    return body as HooksRegistryLock;
  }

  async artifact(name: string, version: string): Promise<HooksRegistryArtifact> {
    const res = await this.request(`/api/v1/hooks/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
    const body = (await res.json()) as { manifest?: unknown; script?: unknown };
    if (!body || typeof body !== "object" || !body.manifest || typeof body.script !== "string") {
      throw new Error(`artifact for '${name}@${version}' from ${this.origin} is malformed`);
    }
    return { ...(body as Omit<HooksRegistryArtifact, "sha256">), sha256: res.headers.get("x-hook-sha256") };
  }

  private async request(path: string): Promise<Response> {
    const res = await this.#fetch(this.urlFor(path), {
      headers: { accept: "application/json", "x-api-key": this.#apiKey },
      // Never follow a redirect: fetch would carry the x-api-key header to
      // another origin (same rule as src/lib/sync.ts).
      redirect: "manual",
    });
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? "REMOTE_API_CREDENTIAL_INVALID" : "REMOTE_API_HTTP_ERROR";
      throw new Error(`${code}: hooks registry ${this.urlFor(path)} responded ${res.status}`);
    }
    return res;
  }

  private async getJson(path: string): Promise<unknown> {
    const res = await this.request(path);
    return res.json();
  }
}

/** Resolve the hosted authority (fail closed) and return a client bound to it. */
export function createHooksClient(options: HooksClientOptions = {}): HooksClient {
  const authority = resolveHooksSdkAuthority(options.env ?? process.env, { credentials: options.credentials });
  return new HooksClient(authority, { fetch: options.fetch });
}
