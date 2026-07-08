// Cloud (self_hosted) shortlinks store.
//
// Implements the same store surface as `ShortlinksStore` / `PgShortlinksStore`,
// but routes every read and write to the app's cloud `/v1` HTTP API
// (https://shortlinks.hasna.xyz/v1) using the @hasna/contracts HTTP storage
// client with a bearer API key. This is the client-side "self_hosted" path:
//
//   flip resolves to cloud-http  ⇔  HASNA_SHORTLINKS_MODE=self_hosted (or cloud)
//                                    AND HASNA_SHORTLINKS_API_URL is set
//                                    AND HASNA_SHORTLINKS_API_KEY is set
//
// There is NO DSN / Postgres / local SQLite here — the raw RDS is never touched
// from a client. If the flip does not resolve to cloud-http, `fromEnv` returns
// null and the caller uses its local store instead (unset env => local).
//
// SAFETY: the API key lives only inside the transport; it is never logged.

import {
  resolveStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts/client/storage";
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

const APP = "shortlinks";

function enc(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Cloud-backed shortlinks store. All methods hit `/v1` over HTTPS with the
 * bearer key. Mirrors the async `PgShortlinksStore` method signatures so it is a
 * drop-in `RuntimeStore` for the CLI.
 */
export class CloudShortlinksStore implements Store {
  readonly kind = "cloud-http" as const;
  readonly transport: HasnaStorageClient["transport"];

  private constructor(private readonly client: HasnaStorageClient) {
    this.transport = client.transport;
  }

  /** Base `<origin>/v1` URL this store targets (for status/diagnostics). */
  get baseUrl(): string {
    return this.client.baseUrl;
  }

  /**
   * Resolve a cloud store from the environment. Returns the store when the
   * client-flip resolves to `cloud-http` (self_hosted + API_URL + API_KEY), else
   * null so the caller falls back to the local store. Throws only when cloud was
   * explicitly requested but is misconfigured (never silent local drift).
   */
  static fromEnv(
    env: Env = process.env,
    overrides?: Parameters<typeof resolveStorageClient>[2],
  ): CloudShortlinksStore | null {
    const resolved = resolveStorageClient(APP, env, overrides);
    if (resolved.transport !== "cloud-http") return null;
    return new CloudShortlinksStore(resolved.client);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async close(): Promise<void> {}

  // ── Domains ────────────────────────────────────────────────────────────────
  async addDomain(input: AddDomainInput): Promise<Domain> {
    return this.client.create<Domain>("domains", {
      hostname: input.hostname,
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.defaultDomain !== undefined ? { default: input.defaultDomain } : {}),
      ...(input.originUrl !== undefined ? { origin_url: input.originUrl } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    });
  }

  async listDomains(): Promise<Domain[]> {
    return (await this.client.list<Domain>("domains")).items;
  }

  async getDomain(hostnameOrId: string): Promise<Domain | null> {
    const domains = await this.listDomains();
    const needle = hostnameOrId.toLowerCase();
    return (
      domains.find(
        (d) => d.hostname.toLowerCase() === needle || d.id === hostnameOrId,
      ) ?? null
    );
  }

  async getDefaultDomain(): Promise<Domain | null> {
    const domains = await this.listDomains();
    return domains.find((d) => d.default_domain) ?? domains[0] ?? null;
  }

  // ── Links ──────────────────────────────────────────────────────────────────
  async createLink(input: CreateLinkInput): Promise<Link> {
    return this.client.create<Link>("links", {
      url: input.destinationUrl,
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.expiresAt !== undefined ? { expires_at: input.expiresAt } : {}),
      ...(input.slugLength !== undefined ? { length: input.slugLength } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    });
  }

  async listLinks(
    options: { domain?: string; activeOnly?: boolean; limit?: number } = {},
  ): Promise<Link[]> {
    const query: Record<string, string | number | boolean> = {};
    if (options.domain) query.domain = options.domain;
    if (options.activeOnly) query.active = true;
    if (options.limit !== undefined) query.limit = options.limit;
    return (await this.client.list<Link>("links", { query })).items;
  }

  async getLink(domainOrSlug: string, maybeSlug?: string): Promise<Link | null> {
    const slug = maybeSlug ?? domainOrSlug;
    const options = maybeSlug ? { query: { domain: domainOrSlug } } : {};
    return this.client.get<Link>("links", slug, options);
  }

  async resolve(hostname: string, slug: string): Promise<Link | null> {
    try {
      return await this.transport.get<Link>(`/resolve/${enc(slug)}`, {
        query: { domain: hostname },
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async setLinkActive(
    domainOrSlug: string,
    maybeSlugOrActive: string | boolean,
    maybeActive?: boolean,
  ): Promise<Link> {
    const active =
      typeof maybeSlugOrActive === "boolean" ? maybeSlugOrActive : Boolean(maybeActive);
    const slug = typeof maybeSlugOrActive === "boolean" ? domainOrSlug : maybeSlugOrActive;
    const domain = typeof maybeSlugOrActive === "boolean" ? undefined : domainOrSlug;
    const action = active ? "enable" : "disable";
    return this.transport.post<Link>(`/links/${enc(slug)}/${action}`, undefined, {
      ...(domain ? { query: { domain } } : {}),
      idempotencyKey: `${action}:${domain ?? ""}:${slug}`,
    });
  }

  async deleteLink(domainOrSlug: string, maybeSlug?: string): Promise<Link> {
    // The API's DELETE returns { deleted, slug }; the CLI needs the full link
    // (for short_url), so fetch it first, then delete.
    const link = maybeSlug
      ? await this.getLink(domainOrSlug, maybeSlug)
      : await this.getLink(domainOrSlug);
    if (!link) throw new Error("Link not found.");
    await this.client.delete(
      "links",
      link.slug,
      maybeSlug ? { query: { domain: domainOrSlug } } : {},
    );
    return link;
  }

  async recordClick(_link: Link, _input: ClickInput = {}): Promise<Click> {
    throw new Error(
      "recordClick is not supported over the cloud API; clicks are recorded by the redirect server.",
    );
  }

  async getStats(domainOrSlug: string, maybeSlug?: string): Promise<LinkStats> {
    const slug = maybeSlug ?? domainOrSlug;
    const domain = maybeSlug ? domainOrSlug : undefined;
    return this.transport.get<LinkStats>(`/links/${enc(slug)}/stats`, {
      ...(domain ? { query: { domain } } : {}),
    });
  }

  async totalStats(): Promise<{ domains: number; links: number; clicks: number }> {
    return this.transport.get<{ domains: number; links: number; clicks: number }>("/stats");
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === 404
  );
}
