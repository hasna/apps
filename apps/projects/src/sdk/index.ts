// Typed SDK for @hasna/projects — the hosted HTTP client surface.
//
// The client is GENERATED from the projects-serve OpenAPI document
// (src/sdk/client.ts, regenerate with `bun run sdk:generate`). This module
// wires it to the ONE credential/authority resolver in the fleet — the
// @hasna/contracts client seam — so the SDK, the CLI and the MCP server all
// answer "which key, from where, against which service" identically.
//
// PRECEDENCE (resolved fresh on every call, five tiers, see
// @hasna/contracts/client):
//   1. an explicit argument           — `overrides.apiKey`
//   2. a deliberate env pointer       — HASNA_PROJECTS_API_KEY_OVERRIDE,
//                                       HASNA_PROFILE, HASNA_PROJECTS_API_KEY_REF
//   3. the macOS Keychain             — hasna.credentials.projects.api-key,
//                                       account HASNA_STATION -> hostname -s -> USER
//   4. disk, read at call time        — ~/.hasna/projects/config/credentials
//                                       (0400/0600; HASNA_HOME / HASNA_CONFIG_HOME override)
//   5. HASNA_PROJECTS_API_KEY in the process env — a legitimate tier, no notice
//
// The service URL follows the same ladder (HASNA_PROJECTS_API_URL, the Keychain
// `api-url` item, the credentials file) and defaults to the fleet gateway
// `https://api.hasna.com/projects` once a credential resolves. The unprefixed
// PROJECTS_API_URL / PROJECTS_API_KEY names are still accepted by the seam as a
// documented silent alias; the canonical HASNA_PROJECTS_* names always work and
// win when both are set. No DSN is ever carried, and no key value is logged.
//
// There is no local fallback here: an SDK client with no resolvable credential
// THROWS, so a caller cannot read a local dataset while believing it is talking
// to the fleet.

export * from "./client.js";
import {
  completePointerCredential,
  resolveClientTransport,
  resolveCredential,
  type CredentialChainOptions,
  type KeychainTierOptions,
  type ResolvedCredential,
} from "@hasna/contracts/client";
import { ProjectsClient, type ProjectsClientOptions } from "./client.js";

/** The app slug the shared client seam resolves credentials and authority for. */
export const PROJECTS_APP_NAME = "projects" as const;

type ClientEnv = Record<string, string | undefined>;

/** Options accepted on top of the resolved transport. */
export interface CreateProjectsClientOptions extends Partial<ProjectsClientOptions> {
  /** Tier-1 identity selection (`--profile`), passed through to the seam. */
  profile?: string;
  /**
   * Tier-3 controls: a `security` runner for tests, or an opt-out on a CI Mac.
   * Production callers pass nothing — the tier is ambient for `process.env`
   * and off for a caller-built env.
   */
  keychain?: KeychainTierOptions;
}

/**
 * Build a ProjectsClient whose credential and base URL come from the shared
 * @hasna/contracts resolver.
 *
 * Throws when no credential resolves from any tier — the SDK never falls back
 * to an unauthenticated client or to local data.
 */
export function createProjectsClientFromEnv(
  env: ClientEnv = process.env,
  overrides: CreateProjectsClientOptions = {},
): ProjectsClient {
  const { baseUrl: baseUrlOverride, apiKey: apiKeyOverride, profile, keychain, ...rest } = overrides;
  const credentials: CredentialChainOptions = {
    ...(apiKeyOverride ? { apiKey: apiKeyOverride } : {}),
    ...(profile ? { profile } : {}),
    ...(keychain ? { keychain } : {}),
  };

  const resolution = resolveClientTransport(PROJECTS_APP_NAME, env, { credentials });
  const credential = resolveCredential(PROJECTS_APP_NAME, env, credentials);
  if (!credential) {
    // Unreachable: resolveClientTransport throws first. Kept so a future
    // resolver change cannot turn a missing credential into an anonymous client.
    throw new Error(
      "projects SDK: no API key resolved from any credential tier; refusing to build an unauthenticated client.",
    );
  }

  // The seam hands back `<origin>/v1`; the generated client already carries the
  // `/v1` prefix on its data routes and needs the origin-and-path root (the
  // `/health` and `/ready` probes live above `/v1`).
  const baseUrl = baseUrlOverride ?? resolution.baseUrl.replace(/\/v1$/, "");

  // A vault pointer carries no value at construction time — it is completed
  // through the secrets SDK on each request, exactly as the shared transport
  // does it, so a rotated vault item is picked up without a restart.
  if (credential.tier === "pointer") {
    return new ProjectsClient({
      baseUrl,
      ...rest,
      fetch: pointerFetch(credential, env, rest.fetch ?? globalThis.fetch),
    });
  }

  return new ProjectsClient({ baseUrl, apiKey: credential.apiKey, ...rest });
}

/** Complete the vault pointer per request and attach the resolved key. */
function pointerFetch(
  pointer: ResolvedCredential,
  env: ClientEnv,
  fetchImpl: typeof fetch,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const completed = await completePointerCredential(PROJECTS_APP_NAME, pointer, env);
    const headers = new Headers(init?.headers);
    headers.set("x-api-key", completed.apiKey);
    return fetchImpl(input as string, { ...init, headers });
  }) as typeof fetch;
}
