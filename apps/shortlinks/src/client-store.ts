// Client-side store resolver for @hasna/shortlinks.
//
// This is the single seam the CLI, MCP server, and SDK consult to obtain a
// `Store`. It returns the hosted-API `ApiStore` when the @hasna/contracts
// client resolver finds a shortlinks credential — the Keychain item
// `hasna.credentials.shortlinks.api-key`, the disk credential file
// `~/.hasna/shortlinks/config/credentials` (0400/0600), or
// `HASNA_SHORTLINKS_API_KEY` (alias `SHORTLINKS_API_KEY`) — and otherwise
// FAILS CLOSED: a missing backend is an error naming the credential chain,
// never a silent switch to the on-box SQLite store. A CLI run without a
// resolvable credential must never serve ~/.hasna/shortlinks/shortlinks.db and
// exit 0 (owner ruling 2026-09-04: no silent local fallback).
//
// The on-box SQLite `LocalStore` is reachable ONLY through an explicit opt-in:
//   • `HASNA_SHORTLINKS_LOCAL=1` in the environment (alias `SHORTLINKS_LOCAL`), or
//   • an explicit database path (`--db <path>` / `options.dbPath`).
// A hosted configuration always wins over the opt-in, and selecting local mode
// ANNOUNCES it on stderr (once per process) — local is never silent.
//
// There is NO postgres/DSN branch here: a client never reads or writes the raw
// RDS. Partial hosted configuration (a URL without a credential, a
// declared-but-blank variable, disagreeing authorities, an unreadable
// credential file) THROWS via CloudShortlinksStore.fromEnv — a client can
// never silently drift back to the wrong dataset.

import { CloudShortlinksStore } from "./cloud-store.js";
import { ShortlinksStore } from "./store.js";
import { shortlinksResolverInputs } from "./client-resolver-inputs.js";
import type { Env, ListLinksOptions, Store, TotalStats } from "./store-interface.js";
import type { ShortlinksTransportOverrides } from "./client-types.js";
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
 * Environment opt-in for the on-box SQLite store, canonical name first. The
 * legacy `SHORTLINKS_LOCAL` spelling stays accepted (it is documented and in
 * the wild). Without a hosted credential AND without this flag (or an explicit
 * `--db` path) the CLI fails closed instead of serving local data.
 */
export const LOCAL_OPT_IN_ENV_KEYS = ["HASNA_SHORTLINKS_LOCAL", "SHORTLINKS_LOCAL"] as const;

/** The canonical local opt-in env key, named in errors and notices. */
export const LOCAL_OPT_IN_ENV_KEY = LOCAL_OPT_IN_ENV_KEYS[0];

/**
 * True when the environment explicitly opts into the on-box SQLite store via
 * `HASNA_SHORTLINKS_LOCAL` / `SHORTLINKS_LOCAL`. Any value except an empty
 * string / 0 / false / no / off opts in. A fully configured hosted API still
 * wins over this flag — opt-in never silently shadows an explicit hosted
 * configuration (same precedence as `--db`).
 */
export function isLocalOptIn(env: Env): boolean {
  for (const key of LOCAL_OPT_IN_ENV_KEYS) {
    const raw = env[key]?.trim().toLowerCase();
    if (!raw) continue;
    if (raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off") return true;
  }
  return false;
}

/** Actionable fail-closed message: names the credential chain and the local opt-in. */
export function missingBackendMessage(): string {
  return (
    `No shortlinks data backend is configured; the CLI never falls back to local storage on its own. ` +
    `The @hasna/contracts client resolver found no shortlinks credential: look in the Keychain item ` +
    `hasna.credentials.shortlinks.api-key (macOS), write ~/.hasna/shortlinks/config/credentials ` +
    `(0400/0600, HASNA_SHORTLINKS_API_KEY=...), or set HASNA_SHORTLINKS_API_KEY ` +
    `(alias SHORTLINKS_API_KEY; the authority defaults to https://api.hasna.com/shortlinks and can be ` +
    `overridden with HASNA_SHORTLINKS_API_URL). To use the on-box SQLite store explicitly, set ` +
    `${LOCAL_OPT_IN_ENV_KEY}=1 (alias SHORTLINKS_LOCAL) or pass --db <path>.`
  );
}

let localNoticePrinted = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetShortlinksLocalNotice(): void {
  localNoticePrinted = false;
}

/**
 * The one-line stderr announcement local mode makes (once per process): an
 * operator running the on-box store while believing they are on the fleet is
 * the false-green this ruling exists to end, so local mode is never silent.
 */
function announceLocalMode(reason: string, notice?: (line: string) => void): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  const line =
    `shortlinks: local mode — on-box SQLite store in use (${reason}); reading and writing ` +
    `~/.hasna/shortlinks/shortlinks.db, not the hosted fleet. To go hosted, set ` +
    `HASNA_SHORTLINKS_API_KEY, add the Keychain item hasna.credentials.shortlinks.api-key, or write ` +
    `~/.hasna/shortlinks/config/credentials.`;
  if (notice) notice(line);
  else if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
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
  cloudOverrides?: ShortlinksTransportOverrides;
  /** Where the one-line local-mode notice goes. Defaults to `process.stderr`. */
  notice?: (line: string) => void;
}

/**
 * Resolve the active {@link Store} for the current environment.
 *
 * - The hosted-API {@link ApiStore} wins when the @hasna/contracts client
 *   resolver finds a shortlinks credential (Keychain, disk credential file, or
 *   `HASNA_SHORTLINKS_API_KEY`); a partially configured hosted client throws.
 * - Otherwise the on-box {@link LocalStore} is used ONLY when local mode was
 *   explicitly opted into (`HASNA_SHORTLINKS_LOCAL=1`, alias `SHORTLINKS_LOCAL`,
 *   or an explicit `dbPath`).
 * - Otherwise resolution FAILS CLOSED: it throws an error naming the credential
 *   chain instead of silently serving the local SQLite dataset.
 */
export function resolveStore(
  env: Env = process.env,
  options: ResolveStoreOptions = {},
): Store {
  // Normalise declared-but-blank authority variables WITHOUT handing the
  // resolver a silent copy: the Keychain tier's ambient gate travels with the
  // copy when one is forced (hasna/apps#1788). See ./client-resolver-inputs.ts.
  const { env: resolverEnv, credentials } = shortlinksResolverInputs(env, options.cloudOverrides?.credentials);
  const cloud = CloudShortlinksStore.fromEnv(resolverEnv, {
    ...options.cloudOverrides,
    credentials,
  });
  if (cloud) return cloud;
  // No hosted backend resolved. Local SQLite is never the silent default: it
  // requires the documented opt-in (HASNA_SHORTLINKS_LOCAL=1 / SHORTLINKS_LOCAL=1
  // or --db <path>), and selecting it is announced on stderr (once per process).
  if (options.dbPath !== undefined || isLocalOptIn(env)) {
    const reason = options.dbPath !== undefined
      ? `--db ${options.dbPath}`
      : `${LOCAL_OPT_IN_ENV_KEY}=1`;
    announceLocalMode(reason, options.notice);
    return new LocalStore(options.dbPath);
  }
  throw new Error(missingBackendMessage());
}

/**
 * Run `fn` with a resolved {@link Store}, always closing it afterward. The
 * canonical helper for one-shot CLI/MCP operations. Fails closed (throws
 * naming the credential chain) when no backend is configured and local mode was
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