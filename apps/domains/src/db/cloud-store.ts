/**
 * Cloud storage resolver for @hasna/domains (Hasna Service Contract v1).
 *
 * When the client-flip contract resolves to `cloud-http` — i.e. mode is
 * cloud/self_hosted AND `HASNA_DOMAINS_API_URL` + `HASNA_DOMAINS_API_KEY` are
 * set — every routed read/write below goes to `https://domains.hasna.xyz/v1`
 * with the bearer key instead of the local SQLite store. Otherwise it falls
 * through to the local implementation in `domain-records.ts`.
 *
 * The fleet flip (`@hasna/machines`) writes only the two `HASNA_DOMAINS_API_URL`
 * + `HASNA_DOMAINS_API_KEY` vars, so — to make that activate cloud — we imply
 * `self_hosted` when both are present and no explicit mode is set. An explicit
 * `HASNA_DOMAINS_STORAGE_MODE=local` (or `_MODE`) still forces the local store,
 * and unsetting the URL/key vars reverts to local. Never a DSN on the client.
 *
 * SAFETY: this never distributes or logs the API key; the key lives only inside
 * the HTTP transport the contract kit builds.
 */

import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import type {
  CreateDomainInput,
  Domain,
  DomainStats,
  ListDomainsOptions,
  UpdateDomainInput,
} from "./domain-records.js";
import {
  countDomains as localCountDomains,
  createDomain as localCreateDomain,
  deleteDomain as localDeleteDomain,
  getByRegistrar as localGetByRegistrar,
  getDomain as localGetDomain,
  getDomainByIdentifier as localGetDomainByIdentifier,
  getDomainStats as localGetDomainStats,
  listDomains as localListDomains,
  listExpiring as localListExpiring,
  listSslExpiring as localListSslExpiring,
  searchDomains as localSearchDomains,
  updateDomain as localUpdateDomain,
} from "./domain-records.js";

const APP = "domains";
const RESOURCE = "domains";

type Env = Record<string, string | undefined>;

/**
 * Return an env in which `self_hosted` is implied when the API URL + key are
 * present but no explicit storage mode is set. Leaves an explicit mode
 * (including `local`) untouched, so the flip stays reversible.
 */
export function domainsCloudEnv(env: Env = process.env): Env {
  const url = env.HASNA_DOMAINS_API_URL ?? env.DOMAINS_API_URL;
  const key = env.HASNA_DOMAINS_API_KEY ?? env.DOMAINS_API_KEY;
  const mode = env.HASNA_DOMAINS_STORAGE_MODE ?? env.HASNA_DOMAINS_MODE;
  if (url && key && !mode) {
    return { ...env, HASNA_DOMAINS_STORAGE_MODE: "self_hosted" };
  }
  return env;
}

/** Resolve the cloud HTTP client, or `null` when the app should use local. */
export function resolveDomainsCloud(env: Env = process.env): HasnaStorageClient | null {
  const resolved = resolveStorageClient(APP, domainsCloudEnv(env));
  return resolved.transport === "cloud-http" ? resolved.client : null;
}

/** True when reads/writes are routed to the cloud API. */
export function isCloudMode(env: Env = process.env): boolean {
  return resolveDomainsCloud(env) !== null;
}

function listQuery(options: ListDomainsOptions): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (options.search) query.search = options.search;
  if (options.status) query.status = options.status;
  if (typeof options.limit === "number") query.limit = options.limit;
  if (typeof options.offset === "number") query.offset = options.offset;
  return query;
}

// ── Routed CRUD ────────────────────────────────────────────────────────────

export async function createDomain(input: CreateDomainInput, env: Env = process.env): Promise<Domain> {
  const client = resolveDomainsCloud(env);
  if (!client) return localCreateDomain(input);
  return client.create<Domain>(RESOURCE, input);
}

export async function getDomain(id: string, env: Env = process.env): Promise<Domain | null> {
  const client = resolveDomainsCloud(env);
  if (!client) return localGetDomain(id);
  return client.get<Domain>(RESOURCE, id);
}

export async function listDomains(
  options: ListDomainsOptions = {},
  env: Env = process.env,
): Promise<Domain[]> {
  const client = resolveDomainsCloud(env);
  if (!client) return localListDomains(options);
  // The cloud `/v1/domains` endpoint filters on search/status/limit/offset only.
  // `registrar` and `is_premium` are not server-side, so when they are requested
  // we fetch the unpaginated match set and apply those filters + pagination
  // client-side — otherwise the server's limit/offset would truncate before the
  // filter runs and silently drop matches.
  const needsClientFilter = options.registrar !== undefined || options.is_premium !== undefined;
  const serverOptions: ListDomainsOptions = needsClientFilter
    ? { search: options.search, status: options.status }
    : options;
  const result = await client.list<Domain>(RESOURCE, { query: listQuery(serverOptions) });
  // The domains serve app returns `{ domains, count }`; fall back to the
  // generic extractor for any other envelope shape.
  const raw = result.raw as { domains?: Domain[] } | undefined;
  let items = raw?.domains ?? result.items;
  if (needsClientFilter) {
    if (options.registrar !== undefined) {
      items = items.filter((d) => d.registrar === options.registrar);
    }
    if (options.is_premium !== undefined) {
      items = items.filter((d) => d.is_premium === options.is_premium);
    }
    const offset = options.offset ?? 0;
    if (offset > 0) items = items.slice(offset);
    if (typeof options.limit === "number") items = items.slice(0, options.limit);
  }
  return items;
}

export async function updateDomain(
  id: string,
  input: UpdateDomainInput,
  env: Env = process.env,
): Promise<Domain | null> {
  const client = resolveDomainsCloud(env);
  if (!client) return localUpdateDomain(id, input);
  return client.get<Domain>(RESOURCE, id).then(async (existing) => {
    if (!existing) return null;
    return client.update<Domain>(RESOURCE, id, input);
  });
}

export async function deleteDomain(id: string, env: Env = process.env): Promise<boolean> {
  const client = resolveDomainsCloud(env);
  if (!client) return localDeleteDomain(id);
  const existing = await client.get<Domain>(RESOURCE, id);
  if (!existing) return false;
  await client.delete(RESOURCE, id);
  return true;
}

// ── Routed read views ────────────────────────────────────────────────────────
// In cloud mode these must never fall back to the local store, or a flipped
// client would silently show stale local rows next to cloud writes.

/**
 * Resolve a domain by ID or exact name. The cloud API only looks up domains by
 * ID, so when the ID lookup misses we search by name and match exactly — giving
 * the CLI the same `get <id|name>` behaviour it has locally.
 */
export async function getDomainByIdentifier(
  identifier: string,
  env: Env = process.env,
): Promise<Domain | null> {
  const client = resolveDomainsCloud(env);
  if (!client) return localGetDomainByIdentifier(identifier);
  const byId = await client.get<Domain>(RESOURCE, identifier);
  if (byId) return byId;
  const matches = await listDomains({ search: identifier }, env);
  return matches.find((d) => d.name === identifier) ?? null;
}

export async function searchDomains(query: string, env: Env = process.env): Promise<Domain[]> {
  const client = resolveDomainsCloud(env);
  if (!client) return localSearchDomains(query);
  return listDomains({ search: query }, env);
}

export async function getDomainStats(env: Env = process.env): Promise<DomainStats> {
  const client = resolveDomainsCloud(env);
  if (!client) return localGetDomainStats();
  // GET /v1/stats returns the DomainStats object directly (no items envelope).
  const result = await client.list<never>("stats");
  return result.raw as DomainStats;
}

export async function listExpiring(days: number, env: Env = process.env): Promise<Domain[]> {
  const client = resolveDomainsCloud(env);
  if (!client) return localListExpiring(days);
  // No dedicated cloud endpoint: pull the active portfolio and filter by the
  // same window the local query uses (active + expiring within N days).
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  const domains = await listDomains({ status: "active" }, env);
  return domains
    .filter((d) => {
      if (!d.expires_at) return false;
      const exp = Date.parse(d.expires_at);
      return Number.isFinite(exp) && exp >= now && exp <= horizon;
    })
    .sort((a, b) => Date.parse(a.expires_at ?? "") - Date.parse(b.expires_at ?? ""));
}

export async function listSslExpiring(days: number, env: Env = process.env): Promise<Domain[]> {
  const client = resolveDomainsCloud(env);
  if (!client) return localListSslExpiring(days);
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  const domains = await listDomains({}, env);
  return domains
    .filter((d) => {
      if (!d.ssl_expires_at) return false;
      const exp = Date.parse(d.ssl_expires_at);
      return Number.isFinite(exp) && exp >= now && exp <= horizon;
    })
    .sort((a, b) => Date.parse(a.ssl_expires_at ?? "") - Date.parse(b.ssl_expires_at ?? ""));
}

export async function getByRegistrar(registrar: string, env: Env = process.env): Promise<Domain[]> {
  const client = resolveDomainsCloud(env);
  if (!client) return localGetByRegistrar(registrar);
  return listDomains({ registrar }, env);
}

export async function countDomains(env: Env = process.env): Promise<number> {
  const client = resolveDomainsCloud(env);
  if (!client) return localCountDomains();
  const stats = await getDomainStats(env);
  return stats.total;
}
