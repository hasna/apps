// ── The shortlinks client Store abstraction ─────────────────────────────────
//
// ONE interface, TWO transports. Every CLI command, MCP tool, and SDK caller
// that reads or writes shortlinks DATA goes through a `Store`. There are exactly
// two implementations, both async:
//
//   • LocalStore — on-box SQLite (see ./client-store.ts). Delegates to the
//     synchronous sqlite engine in ./store.js.
//   • ApiStore   — the hosted HTTP API at `<API_URL>/v1` with a bearer key
//     (see ./cloud-store.ts, exported as `ApiStore`). Delegates to the
//     published @hasna/contracts storage client.
//
// `resolveStore()` (./client-store.ts) picks the transport from the client env:
// `HASNA_SHORTLINKS_API_URL` + `HASNA_SHORTLINKS_API_KEY` select the hosted API;
// otherwise it FAILS CLOSED unless local mode was explicitly opted into
// (SHORTLINKS_LOCAL=1 or --db). Callers NEVER branch on the transport
// themselves and NEVER touch sqlite or fetch directly — that split-brain path
// is the bug this abstraction eliminates.
//
// SAFETY: the API key lives only inside the ApiStore transport; it is never
// logged, returned, or embedded in any value produced through this interface.

import type {
  AddDomainInput,
  Click,
  ClickInput,
  CreateLinkInput,
  Domain,
  Link,
  LinkStats,
} from "./types.js";

/** Plain env shape consumed by the store resolver (own-property reads only). */
export type Env = Record<string, string | undefined>;

export interface ListLinksOptions {
  domain?: string;
  activeOnly?: boolean;
  limit?: number;
}

export interface TotalStats {
  domains: number;
  links: number;
  clicks: number;
}

/**
 * The single storage surface shared by LocalStore and ApiStore. All methods are
 * async so one call site works against either transport.
 */
export interface Store {
  /** Which transport backs this store (for banners/diagnostics only). */
  readonly kind: "local" | "http";

  // ── Domains ────────────────────────────────────────────────────────────────
  addDomain(input: AddDomainInput): Promise<Domain>;
  listDomains(): Promise<Domain[]>;
  getDomain(hostnameOrId: string): Promise<Domain | null>;
  getDefaultDomain(): Promise<Domain | null>;
  /**
   * Delete a domain (by hostname or id) and, via ON DELETE CASCADE, all of its
   * links and clicks. Returns the deleted domain. Throws when not found.
   */
  deleteDomain(hostnameOrId: string): Promise<Domain>;

  // ── Links ──────────────────────────────────────────────────────────────────
  createLink(input: CreateLinkInput): Promise<Link>;
  listLinks(options?: ListLinksOptions): Promise<Link[]>;
  getLink(domainOrSlug: string, maybeSlug?: string): Promise<Link | null>;
  resolve(hostname: string, slug: string): Promise<Link | null>;
  setLinkActive(
    domainOrSlug: string,
    slugOrActive: string | boolean,
    active?: boolean,
  ): Promise<Link>;
  deleteLink(domainOrSlug: string, maybeSlug?: string): Promise<Link>;

  // ── Clicks / stats ───────────────────────────────────────────────────────────
  /**
   * Record a click. Only the on-box redirect server does this against a LocalStore;
   * the cloud API records clicks server-side, so ApiStore rejects this call.
   */
  recordClick(link: Link, input?: ClickInput): Promise<Click>;
  getStats(domainOrSlug: string, maybeSlug?: string): Promise<LinkStats>;
  totalStats(): Promise<TotalStats>;

  close(): Promise<void>;
}
