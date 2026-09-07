/**
 * Todos and Sessions integrations, resolved through the ONE shared credential
 * seam (@hasna/contracts/client) — this module contributes no tier of its own.
 *
 * Each integration resolves the sibling service's own chain fresh per call
 * (Keychain item, `~/.hasna/<service>/config/credentials`, env pair,
 * default fleet gateway), exactly as that service's own client would, and the
 * credential is pinned to the authority it resolved with: a request outside
 * the configured service URL is refused before any header is attached.
 */
import {
  resolveClientTransport,
  resolveCredential,
} from "@hasna/contracts/client";
import { stripV1, type AttachmentsCredentialChainOptions, type Env } from "./client-config";

export type IntegrationService = "TODOS" | "SESSIONS";

export interface ServiceCredentialsConfig {
  url: string;
  key: string;
}

export interface ResolveServiceConfigOptions {
  /** Tier-1 credential inputs and Keychain-tier controls, as accepted by the shared seam. */
  credentials?: AttachmentsCredentialChainOptions;
}

/**
 * Resolve one integration's authority and credential, fresh.
 *
 * Throws when the service's chain resolves an authority but no credential, or
 * when a declared pair is blank or conflicting — integrations never fall back
 * to anything else.
 */
export function serviceConfig(
  service: IntegrationService,
  env: Env = process.env,
  options: ResolveServiceConfigOptions = {},
): ServiceCredentialsConfig {
  const name = service.toLowerCase();
  const credentials = options.credentials ?? {};
  const credential = resolveCredential(name, env, credentials);
  const chainOptions = credential
    ? { credentials: { ...credentials, apiKey: credential.apiKey } }
    : { credentials };
  const resolution = resolveClientTransport(name, env, chainOptions);
  if (!credential) {
    throw new Error(`Missing ${service} API configuration: no credential resolved through the shared chain.`);
  }
  return { url: stripV1(resolution.baseUrl), key: credential.apiKey };
}

export function withServiceAuth(
  service: IntegrationService,
  requestUrl?: string | URL,
  init?: RequestInit,
): RequestInit {
  const config = serviceConfig(service);
  const url = new URL(String(requestUrl));
  const apiBoundary = url.href.indexOf("/api/");
  if (apiBoundary < 0 || url.href.slice(0, apiBoundary) !== config.url) throw new Error(`Request is outside the configured ${service} API URL.`);
  const headers = new Headers(init?.headers);
  headers.delete("authorization");
  headers.set("x-api-key", config.key);
  return { ...init, headers, redirect: "error" };
}

export function withTodosAuth(requestUrl?: string | URL, init?: RequestInit): RequestInit {
  return withServiceAuth("TODOS", requestUrl, init);
}
