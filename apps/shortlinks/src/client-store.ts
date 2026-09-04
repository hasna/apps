// Client-side store resolver for @hasna/shortlinks.
//
// This is the single seam the CLI, MCP server, and SDK consult to obtain a
// `Store`. It returns the hosted-API `ApiStore` when the hosted shortlinks
// service is configured (HASNA_SHORTLINKS_API_URL + HASNA_SHORTLINKS_API_KEY,
// or a fleet app-config / credential the @hasna/contracts resolver accepts),
// and otherwise FAILS CLOSED: a missing backend is an error naming the
// required env, never a silent switch to the on-box SQLite store. A CLI run
// without its API env must never serve ~/.hasna/shortlinks/shortlinks.db and
// exit 0 (owner ruling 2026-09-04: no silent local fallback).
//
// The on-box SQLite `LocalStore` is reachable ONLY through an explicit opt-in:
//   • `SHORTLINKS_LOCAL=1` in the environment, or
//   • an explicit database path (`--db <path>` / `options.dbPath`).
//
// There is NO postgres/DSN branch here: a client never reads or writes the raw
// RDS. `resolveStore` throws (via CloudShortlinksStore.fromEnv) when the hosted
// client is partially configured, so a client can never silently drift back to
// the wrong dataset.

import { CloudShortlinksStore } from "./cloud-store.js";
import { ShortlinksStore } from "./store.js";
import type { Env, ListLinksOptions, Store, TotalStats } from "./store-interface.js";
import type {
  AddDomainInput,
  Click,
  ClickInput,
  CreateLinkInput,
  Domain,
  Link,
  LinkStats,
} from "./types.js";

/** The hosted-API HTTP transport. */
export { CloudShortlinksStore as ApiStore } from "./cloud-store.js";
export type { Store } from "./store-interface.js";

/**
 * Environment opt-in for the on-box SQLite store. Without the hosted-API env
 * AND without this flag (or an explicit `--db` path) the CLI fails closed
 * instead of serving local data.
 */
export const LOCAL_OPT_IN_ENV_KEY = "SHORTLINKS_LOCAL";

/** Canonical hosted-API env keys (with their legacy aliases) named in errors. */
const API_URL_ENV_KEYS = ["HASNA_SHORTLINKS_API_URL", "SHORTLINKS_API_URL"] as const;
const API_KEY_ENV_KEYS = ["HASNA_SHORTLINKS_API_KEY", "SHORTLINKS_API_KEY"] as const;

/**
 * True when the environment explicitly opts into the on-box SQLite store via
 * `SHORTLINKS_LOCAL`. Any value except an empty string / 0 / false / no / off
 * opts in. A fully configured hosted API still wins over this flag — opt-in
 * never silently shadows an explicit hosted configuration (same precedence as
 * `--db`).
 */
export function isLocalOptIn(env: Env): boolean {
  const raw = env[LOCAL_OPT_IN_ENV_KEY]?.trim().toLowerCase();
  if (!raw) return false;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/** Actionable fail-closed message: names the required env and the local opt-in. */
export function missingBackendMessage(): string {
  return (
    `No shortlinks data backend is configured; the CLI never falls back to local storage on its own. ` +
    `${API_URL_ENV_KEYS[0]} and ${API_KEY_ENV_KEYS[0]} are required to reach the hosted shortlinks API ` +
    `(aliases ${API_URL_ENV_KEYS[1]} / ${API_KEY_ENV_KEYS[1]}). To use the on-box SQLite store ` +
    `explicitly, set ${LOCAL_OPT_IN_ENV_KEY}=1 or pass --db <path>.`
  );
}

/**
 * On-box SQLite store. An async adapter over the synchronous sqlite engine
 * (`ShortlinksStore`) so it satisfies the shared async {@link Store} interface.
 */
export class LocalStore implements Store {
  readonly kind = "local" as const;
  private readonly inner: ShortlinksStore;

  constructor(dbPath?: string) {
    this.inner = new ShortlinksStore(dbPath);
  }

  async addDomain(input: AddDomainInput): Promise<Domain> {
    return this.inner.addDomain(input);
  }

  async listDomains(): Promise<Domain[]> {
    return this.inner.listDomains();
  }

  async getDomain(hostnameOrId: string): Promise<Domain | null> {
    return this.inner.getDomain(hostnameOrId);
  }

  async getDefaultDomain(): Promise<Domain | null> {
    return this.inner.getDefaultDomain();
  }

  async deleteDomain(hostnameOrId: string): Promise<Domain> {
    return this.inner.deleteDomain(hostnameOrId);
  }

  async createLink(input: CreateLinkInput): Promise<Link> {
    return this.inner.createLink(input);
  }

  async listLinks(options: ListLinksOptions = {}): Promise<Link[]> {
    return this.inner.listLinks(options);
  }

  async getLink(domainOrSlug: string, maybeSlug?: string): Promise<Link | null> {
    return this.inner.getLink(domainOrSlug, maybeSlug);
  }

  async resolve(hostname: string, slug: string): Promise<Link | null> {
    return this.inner.resolve(hostname, slug);
  }

  async setLinkActive(
    domainOrSlug: string,
    slugOrActive: string | boolean,
    active?: boolean,
  ): Promise<Link> {
    return this.inner.setLinkActive(domainOrSlug, slugOrActive, active);
  }

  async deleteLink(domainOrSlug: string, maybeSlug?: string): Promise<Link> {
    return this.inner.deleteLink(domainOrSlug, maybeSlug);
  }

  async recordClick(link: Link, input: ClickInput = {}): Promise<Click> {
    return this.inner.recordClick(link, input);
  }

  async getStats(domainOrSlug: string, maybeSlug?: string): Promise<LinkStats> {
    return this.inner.getStats(domainOrSlug, maybeSlug);
  }

  async totalStats(): Promise<TotalStats> {
    return this.inner.totalStats();
  }

  async close(): Promise<void> {
    this.inner.close();
  }
}

export interface ResolveStoreOptions {
  /** Explicit local SQLite path (CLI `--db`); also opts into the local store. Ignored when the hosted API is selected. */
  dbPath?: string;
  /** Transport overrides for the hosted-API client (test injection: fetchImpl, ...). */
  cloudOverrides?: Parameters<typeof CloudShortlinksStore.fromEnv>[1];
}

/**
 * Resolve the active {@link Store} for the current environment.
 *
 * - The hosted-API {@link ApiStore} wins when it is fully configured
 *   (HASNA_SHORTLINKS_API_URL + HASNA_SHORTLINKS_API_KEY, or a fleet
 *   app-config / credential the contracts resolver accepts); a partially
 *   configured hosted client throws.
 * - Otherwise the on-box {@link LocalStore} is used ONLY when local mode was
 *   explicitly opted into (`SHORTLINKS_LOCAL=1` or an explicit `dbPath`).
 * - Otherwise resolution FAILS CLOSED: it throws an error naming the required
 *   env instead of silently serving the local SQLite dataset.
 */
export function resolveStore(
  env: Env = process.env,
  options: ResolveStoreOptions = {},
): Store {
  const cloud = CloudShortlinksStore.fromEnv(env, options.cloudOverrides);
  if (cloud) return cloud;
  // No hosted backend resolved. Local SQLite is never the silent default: it
  // requires the documented opt-in (SHORTLINKS_LOCAL=1 or --db <path>).
  if (options.dbPath !== undefined || isLocalOptIn(env)) {
    return new LocalStore(options.dbPath);
  }
  throw new Error(missingBackendMessage());
}

/**
 * Run `fn` with a resolved {@link Store}, always closing it afterward. The
 * canonical helper for one-shot CLI/MCP operations. Fails closed (throws
 * naming the required env) when no backend is configured and local mode was
 * not explicitly opted into.
 */
export async function withStore<T>(
  fn: (store: Store) => T | Promise<T>,
  env: Env = process.env,
  options: ResolveStoreOptions = {},
): Promise<T> {
  const store = resolveStore(env, options);
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}
