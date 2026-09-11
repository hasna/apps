// The on-box SQLite client store, kept in its own module so `bun:sqlite` is
// reachable from the CLI/MCP/SDK graphs through exactly ONE gated dynamic
// import (`./client-store.ts` → `await import("./local-store.js")`, behind the
// HASNA_SHORTLINKS_LOCAL opt-in).
//
// Why the separate file: with a static import the sqlite engine is bundled
// INTO `dist/cli/index.js` and `dist/mcp/index.js`, so a hosted-only client
// ships (and can load) the local database engine it must never open. The build
// runs with `--splitting`, so this module and `./store.js` / `./database.js`
// are emitted as `dist/chunks/*.js` — outside `dist/cli` and `dist/mcp` — and
// are only fetched at runtime when the local opt-in selected them.
//
// Nothing here decides ANYTHING about which backend is used: the gate lives in
// `resolveStore()` (./client-store.ts). Importing this module is already the
// decision.

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

/**
 * On-box SQLite store. An async adapter over the synchronous sqlite engine
 * (`ShortlinksStore`) so it satisfies the shared async {@link Store} interface.
 */
export class LocalStore implements Store {
  readonly kind = "local" as const;
  private readonly inner: ShortlinksStore;

  /**
   * `env` is the environment the store was resolved from: the database path
   * and every app-home read follow IT, never a silent `process.env` read on a
   * caller-built env (hasna/apps#1720 validation).
   */
  constructor(dbPath?: string, env: Env = process.env) {
    this.inner = new ShortlinksStore(dbPath, env);
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
