/**
 * @hasna/logs — resolver-backed factory for the generated `/v1` LogsClient.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * The generated {@link LogsClient} takes an explicit `baseUrl`/`apiKey` and
 * has no environment surface of its own; this module is the ONE adapter onto
 * the shared @hasna/contracts client chain (owner ruling 2026-09-04,
 * hasna/apps#1720) so callers never write a private copy of the chain.
 *
 * FRESH PER REQUEST: the chain resolves a key rotation on every request, so a
 * client held for hours picks up a new Keychain/disk/env credential without
 * being rebuilt. The generated client stores its `apiKey` at construction, so
 * the refresh rides in a `fetch` wrapper that overwrites `x-api-key` with the
 * key the chain resolves NOW; a re-resolution that throws or comes back empty
 * leaves the constructed key in place, so a transient unreadable Keychain
 * cannot turn a working client into a failing one mid-flight.
 *
 * THE AUTHORITY PIN (#1794): an explicit `baseUrl` is tier 1 — the caller
 * names the authority, and the ambient fleet chain (Keychain,
 * `~/.hasna/logs/config/credentials`, `HASNA_LOGS_API_KEY`) is NEVER
 * consulted, so the station's hosted credential cannot ride to a
 * caller-supplied URL. A client with an explicit `baseUrl` sends exactly what
 * it was constructed with: `apiKey`, or nothing. Rotation-freshness applies
 * only to a client whose HOSTED authority the chain resolved itself.
 */
import {
  resolveClientTransport,
  resolveCredential,
  type CredentialChainOptions,
} from "@hasna/contracts/client";
import { LogsClient, type LogsClientOptions } from "./client.ts";

type Env = Record<string, string | undefined>;

/** The transport's fetch shape (Bun's global fetch carries extra static props). */
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * The @hasna/contracts credential-chain options, spelled LOCALLY.
 *
 * This type crosses the published `@hasna/logs/api` boundary, and the
 * declarations `tsc` emits are not bundled — an exported signature that
 * imported it from `@hasna/contracts` would land in `dist/api.d.ts` as a live
 * import of a build-time devDependency and break every TS consumer
 * (hasna/apps#1782). The spelling is structurally identical to
 * `CredentialChainOptions`; `from-env.test.ts` asserts the two are assignable
 * in both directions.
 */
export interface LogsCredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. */
  profile?: string;
  /** Tier 3: macOS Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: {
    /** Whether the Keychain is consulted for a caller-built env object. */
    enabled?: boolean;
    /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
    platform?: string;
    /** The machine's host name, used as the account when HASNA_STATION is unset. */
    hostname?: () => string;
    /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
    run?: (argv: readonly string[]) => {
      status: number | null;
      stdout: string;
      stderr: string;
    };
  };
}

/** Options for {@link createLogsApiClientFromEnv}. */
export interface CreateLogsApiClientFromEnvOptions extends Partial<LogsClientOptions> {
  /** Tier-1 credential inputs and Tier-3 Keychain controls, for the shared resolver. */
  credentials?: LogsCredentialChainOptions;
}

/** Origin (minus a trailing `/v1`) the generated client composes `/v1/...` onto. */
function originOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function chainOptions(credentials?: LogsCredentialChainOptions): CredentialChainOptions | undefined {
  return credentials as CredentialChainOptions | undefined;
}

/**
 * Build the hosted `/v1` LogsClient through the @hasna/contracts resolver.
 *
 * Throws when no credential resolves — the generated client speaks only to a
 * hosted authority and an unauthenticated client is never built. An explicit
 * `baseUrl` pins the authority and the credential to the constructor arguments
 * (#1794); otherwise the chain resolves on every request.
 */
export function createLogsApiClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateLogsApiClientFromEnvOptions = {},
): LogsClient {
  const { credentials, ...clientOptions } = options;
  const chain = chainOptions(credentials);

  // Tier 1, and the only way to reach an arbitrary authority: the caller named
  // it, so the ambient chain is never consulted and no fleet credential can
  // travel to it. The generated client attaches `apiKey` or nothing.
  if (clientOptions.baseUrl) {
    return new LogsClient({
      baseUrl: clientOptions.baseUrl,
      apiKey: clientOptions.apiKey,
      ...(clientOptions.fetch ? { fetch: clientOptions.fetch } : {}),
      ...(clientOptions.headers ? { headers: clientOptions.headers } : {}),
    });
  }

  const clientEnv = env as Env;

  // ONE pass down the chain for the authority AND the constructed credential:
  // `resolveClientTransport` validates both and throws when the configuration
  // is incomplete or conflicting.
  const resolution = resolveClientTransport("logs", clientEnv, chain ? { credentials: chain } : {});
  const baseUrl = originOf(resolution.baseUrl);

  const constructed = resolveCredential("logs", clientEnv, chain)?.apiKey ?? null;

  const baseFetch: FetchLike =
    clientOptions.fetch ?? ((input, init) => fetch(input, init));

  // PER-REQUEST REFRESH with the authority pin: the chain re-resolves the
  // credential on every request and overwrites the generated `x-api-key`
  // header; a failed re-resolution keeps the constructed key.
  const fetchWithFreshCredential = (async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    try {
      const fresh = resolveCredential("logs", clientEnv, chain)?.apiKey;
      if (fresh) headers["x-api-key"] = fresh;
    } catch {
      // keep the credential the client was constructed with
    }
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;

  return new LogsClient({
    baseUrl,
    apiKey: constructed ?? undefined,
    fetch: fetchWithFreshCredential,
    ...(clientOptions.headers ? { headers: clientOptions.headers } : {}),
  });
}