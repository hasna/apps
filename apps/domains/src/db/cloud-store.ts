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
  ListDomainsOptions,
  UpdateDomainInput,
} from "./domain-records.js";
import {
  createDomain as localCreateDomain,
  deleteDomain as localDeleteDomain,
  getDomain as localGetDomain,
  listDomains as localListDomains,
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
  const result = await client.list<Domain>(RESOURCE, { query: listQuery(options) });
  // The domains serve app returns `{ domains, count }`; fall back to the
  // generic extractor for any other envelope shape.
  const raw = result.raw as { domains?: Domain[] } | undefined;
  return raw?.domains ?? result.items;
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
