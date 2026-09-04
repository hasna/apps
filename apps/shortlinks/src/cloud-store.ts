// Hosted-API shortlinks store.
//
// Implements the same store surface as `ShortlinksStore` / `PgShortlinksStore`,
// but routes every read and write to the hosted `/v1` HTTP API
// (https://shortlinks.hasna.xyz/v1) using the @hasna/contracts HTTP storage
// client with a bearer API key. This is the client-side hosted-API path:
//
//   hosted client selected  ⇔  HASNA_SHORTLINKS_API_URL is set
//                              AND HASNA_SHORTLINKS_API_KEY is set
//
// There is NO DSN / Postgres / local SQLite here — the raw RDS is never touched
// from a client. If the flip does not resolve, `fromEnv` returns null and the
// caller (resolveStore in ./client-store.ts) FAILS CLOSED unless local mode was
// explicitly opted into — unset env is never an implicit local store.
//
// SAFETY: the API key lives only inside the transport; it is never logged.

import {
  resolveStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts/client/storage";
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

const APP = "shortlinks";

/** Read the first set env value as an OWN property (guards prototype pollution). */
function ownEnv(env: Env, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (!Object.hasOwn(env, key)) continue;
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Cloud-backed shortlinks store. All methods hit `/v1` over HTTPS with the
 * bearer key. Mirrors the async `PgShortlinksStore` method signatures so it is a
 * drop-in `RuntimeStore` for the CLI.
 */
export class CloudShortlinksStore implements Store {
  readonly kind = "http" as const;
  readonly transport: HasnaStorageClient["transport"];

  private constructor(private readonly client: HasnaStorageClient) {
    this.transport = client.transport;
  }

  /** Base `<origin>/v1` URL this store targets (for status/diagnostics). */
  get baseUrl(): string {
    return this.client.baseUrl;
  }

  /**
   * Resolve a hosted-API store from the environment. The contracts client
   * seam (`resolveStorageClient`) decides: an explicit API URL + API key in
   * the environment selects the hosted client, and the fleet app-config /
   * credential on disk is the accepted tier. `null` means NO hosted client
   * resolved — the caller must then fail closed unless local mode was
   * explicitly opted into (never a silent switch to the on-box store).
   * Throws when only one of URL/key is set in the environment tier — a
   * partially configured hosted client must fail loudly, never silently
   * drift to the local dataset.
   */
  static fromEnv(
    env: Env = process.env,
    overrides?: Parameters<typeof resolveStorageClient>[2],
  ): CloudShortlinksStore | null {
    const apiUrl = ownEnv(env, ["HASNA_SHORTLINKS_API_URL", "SHORTLINKS_API_URL"]);
    const apiKey = ownEnv(env, ["HASNA_SHORTLINKS_API_KEY", "SHORTLINKS_API_KEY"]);
    if (Boolean(apiUrl) !== Boolean(apiKey)) {
      throw new Error(
        "Hosted API client is partially configured: set both HASNA_SHORTLINKS_API_URL " +
          "and HASNA_SHORTLINKS_API_KEY (or neither).",
      );
    }
    const resolved = resolveStorageClient(APP, env, overrides);
    if (!resolved.client) return null;
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

  async deleteDomain(hostnameOrId: string): Promise<Domain> {
    // The API's DELETE returns { deleted, hostname }; the CLI needs the full
    // domain record, so resolve it first, then delete by hostname.
    const domain = await this.getDomain(hostnameOrId);
    if (!domain) throw new Error("Domain not found.");
    // Use the transport DELETE directly rather than the generic storage-client
    // delete(), which swallows a 404 and would report a false success when the
    // server lacks the route (or the row is already gone). We already proved the
    // domain exists above, so any non-2xx here — including 404 — is a real
    // failure that MUST surface, never a silent "deleted: true".
    try {
      await this.transport.del(`/domains/${enc(domain.hostname)}`);
    } catch (error) {
      throw missingRouteError(error, "domain", `DELETE /domains/${domain.hostname}`);
    }
    return domain;
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
    // Transport DELETE directly (not the generic delete(), which swallows 404)
    // so a missing route or already-gone row surfaces as an error instead of a
    // false success — same defect class as deleteDomain.
    try {
      await this.transport.del(
        `/links/${enc(link.slug)}`,
        undefined,
        maybeSlug ? { query: { domain: domainOrSlug } } : {},
      );
    } catch (error) {
      throw missingRouteError(error, "link", `DELETE /links/${link.slug}`);
    }
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

/**
 * Turn a DELETE failure into an actionable error. The caller has already
 * resolved the resource (proving it exists in the cloud store), so a 404 here
 * cannot mean "not found" — it means the deployed server does not expose the
 * delete route yet (its image predates it) and needs an ECS redeploy. Surface
 * that explicitly instead of the cryptic raw "…-> 404", and re-throw any other
 * transport error untouched.
 */
function missingRouteError(error: unknown, resource: string, request: string): Error {
  if (isNotFound(error)) {
    return new Error(
      `Cloud server rejected ${request} with 404 even though the ${resource} exists. ` +
        `The deployed shortlinks server predates the ${resource}-delete route — redeploy the ` +
        `cloud service (ECS) to a version that exposes it, then retry.`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
