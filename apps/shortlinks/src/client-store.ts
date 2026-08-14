// Client-side store resolver for @hasna/shortlinks.
//
// This is the single seam the CLI, MCP server, and SDK consult to obtain a
// `Store`. It returns the cloud `ApiStore` when the client-flip env resolves to
// `cloud-http` (mode=self_hosted/cloud AND HASNA_SHORTLINKS_API_URL +
// HASNA_SHORTLINKS_API_KEY are set), otherwise the on-box `LocalStore`.
//
// There is NO postgres/DSN branch here: a client never reads or writes the raw
// RDS. `resolveStore` throws (via CloudShortlinksStore.fromEnv) when cloud is
// requested but misconfigured, so a client can never silently drift back to the
// wrong dataset.

import { CloudShortlinksStore } from "./cloud-store.js";
import { ShortlinksStore } from "./store.js";
import type { Env } from "@hasna/contracts/mode";
import type { ListLinksOptions, Store, TotalStats } from "./store-interface.js";
import type {
  AddDomainInput,
  Click,
  ClickInput,
  CreateLinkInput,
  Domain,
  Link,
  LinkStats,
} from "./types.js";

/** The self_hosted/cloud HTTP transport. Same client code for both tiers. */
export { CloudShortlinksStore as ApiStore } from "./cloud-store.js";
export type { Store } from "./store-interface.js";

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
  /** Explicit local SQLite path (CLI `--db`); ignored in cloud mode. */
  dbPath?: string;
  /** Transport overrides for the cloud client (test injection: fetchImpl, ...). */
  cloudOverrides?: Parameters<typeof CloudShortlinksStore.fromEnv>[1];
}

/**
 * Resolve the active {@link Store} for the current environment. Returns the
 * cloud {@link ApiStore} when the client flip is on, otherwise a
 * {@link LocalStore}. Throws when cloud was requested but is misconfigured.
 */
export function resolveStore(
  env: Env = process.env,
  options: ResolveStoreOptions = {},
): Store {
  const cloud = CloudShortlinksStore.fromEnv(env, options.cloudOverrides);
  if (cloud) return cloud;
  return new LocalStore(options.dbPath);
}

/**
 * Run `fn` with a resolved {@link Store}, always closing it afterward. The
 * canonical helper for one-shot CLI/MCP operations.
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
