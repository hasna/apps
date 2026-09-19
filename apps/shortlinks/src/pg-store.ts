// Server-side Postgres store for @hasna/shortlinks.
//
// This module is used ONLY by the cloud server (`src/serve`, running on ECS
// Fargate). It is never imported by the client CLI/MCP/SDK, and it holds NO DSN:
// the store is always built over a `TypedQueryClient` that the serve entrypoint
// opens through the sanctioned storage kit (`createCloudPoolFromEnv`). Clients
// reach this data exclusively through the HTTP `/v1` ApiStore.

import { createHash } from "node:crypto";
import { formatShortUrl, getClickSalt, normalizeHostname } from "./config.js";
import { makeId, now } from "./database.js";
import { getMachineId } from "./machine.js";
import {
  adaptiveSlugLength,
  DEFAULT_DOMAIN_HOSTNAME,
  normalizeGeneratedSlugLength,
  normalizeSlug,
  randomToken,
  type SlugTokenFactory,
} from "./slug.js";
import type { TypedQueryClient } from "./generated/storage-kit/query.js";
import type { AddDomainInput, Click, ClickInput, CreateLinkInput, Domain, Link, LinkStats } from "./types.js";

export type PgAdapterLike = {
  get(sql: string, ...params: unknown[]): Promise<any>;
  all(sql: string, ...params: unknown[]): Promise<any[]>;
  run(sql: string, ...params: unknown[]): Promise<unknown>;
  close?: () => Promise<void>;
};

type LinkRow = Omit<Link, "active" | "metadata" | "hostname"> & {
  active: number | boolean;
  metadata: string | Record<string, unknown> | null;
  hostname: string;
};

type LegacyDomainProviderColumns = {
  cloudflare_zone_id?: string | null;
  cloudflare_account_id?: string | null;
  cloudflare_worker_name?: string | null;
};

type DomainRow = Omit<Domain, "default_domain" | "metadata"> & LegacyDomainProviderColumns & {
  default_domain: number | boolean;
  metadata: string | Record<string, unknown> | null;
};

type ClickRow = Omit<Click, "metadata"> & {
  metadata: string | Record<string, unknown> | null;
};

function parseJsonObject(value: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toPostgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIsoString(value);
}

function domainFromRow(row: DomainRow): Domain {
  const { cloudflare_zone_id: _zone, cloudflare_account_id: _account, cloudflare_worker_name: _worker, ...publicRow } = row;
  return {
    ...publicRow,
    default_domain: Boolean(row.default_domain),
    synced_at: nullableIso(row.synced_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    metadata: parseJsonObject(row.metadata),
  };
}

function linkFromRow(row: LinkRow): Link {
  return {
    ...row,
    active: Boolean(row.active),
    expires_at: nullableIso(row.expires_at),
    synced_at: nullableIso(row.synced_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    metadata: parseJsonObject(row.metadata),
    short_url: formatShortUrl(row.hostname, row.slug),
  };
}

function domainIsActive(domain: Domain): boolean {
  const provisioning = domain.metadata["provisioning"];
  if (!provisioning || typeof provisioning !== "object" || Array.isArray(provisioning)) return true;
  const status = (provisioning as Record<string, unknown>)["status"];
  return status === undefined || status === "active";
}

function assertDomainProjectionWrite(hostname: string, input: AddDomainInput): void {
  if (hostname === DEFAULT_DOMAIN_HOSTNAME) return;
  const provisioning = input.metadata?.["provisioning"];
  const record = provisioning && typeof provisioning === "object" && !Array.isArray(provisioning)
    ? provisioning as Record<string, unknown>
    : null;
  if (input.provider !== "domains-api" || record?.["mode"] !== "domains-api" || typeof record?.["domains_job_id"] !== "string") {
    throw new Error("Custom domain rows may only be applied as projections of a hosted Domains API job.");
  }
}

function validateDestinationUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid destination URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Destination URL must start with http:// or https://.");
  }
  return parsed.toString();
}

function isoOrNull(input: string | undefined): string | null {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${input}`);
  return date.toISOString();
}

function clickFromRow(row: ClickRow): Click {
  return {
    ...row,
    clicked_at: toIsoString(row.clicked_at),
    synced_at: nullableIso(row.synced_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    metadata: parseJsonObject(row.metadata),
  };
}

/**
 * Adapt a vendored storage-kit `TypedQueryClient` (which speaks `$1` positional
 * params) to the `?`-placeholder `PgAdapterLike` the store queries are written
 * against. This lets `shortlinks-serve` reuse the exact same SQL as the CLI while
 * opening its cloud pool through the sanctioned kit (`createCloudPoolFromEnv`).
 */
export function createKitPgAdapter(client: TypedQueryClient): PgAdapterLike {
  return {
    async get(sql: string, ...params: unknown[]): Promise<any> {
      return client.get(toPostgresSql(sql), params as unknown[]);
    },
    async all(sql: string, ...params: unknown[]): Promise<any[]> {
      return client.many(toPostgresSql(sql), params as unknown[]);
    },
    async run(sql: string, ...params: unknown[]): Promise<unknown> {
      return client.query(toPostgresSql(sql), params as unknown[]);
    },
  };
}

export interface PgShortlinksStoreOptions {
  /** Injectable only for deterministic collision tests; production uses cryptographic randomness. */
  tokenFactory?: SlugTokenFactory;
}

export class PgShortlinksStore {
  private readonly tokenFactory: SlugTokenFactory;

  constructor(
    private readonly pg: PgAdapterLike,
    options: PgShortlinksStoreOptions = {},
  ) {
    this.tokenFactory = options.tokenFactory ?? randomToken;
  }

  /**
   * Build a store over a vendored storage-kit query client. This is the ONLY
   * constructor: the serve entrypoint opens its pool via `createCloudPoolFromEnv`
   * (server-side) and hands the client here. There is deliberately no
   * DSN-from-env / connection-string path so this store can never be misused to
   * open the raw RDS from a client.
   */
  static fromQueryClient(
    client: TypedQueryClient,
    options: PgShortlinksStoreOptions = {},
  ): PgShortlinksStore {
    return new PgShortlinksStore(createKitPgAdapter(client), options);
  }

  async close(): Promise<void> {
    await this.pg.close?.();
  }

  async addDomain(input: AddDomainInput): Promise<Domain> {
    const hostname = normalizeHostname(input.hostname);
    assertDomainProjectionWrite(hostname, input);
    const timestamp = now();
    const machineId = getMachineId();
    const existing = await this.getDomain(hostname);
    const id = existing?.id || makeId("dom");

    if (input.defaultDomain) {
      await this.pg.run("UPDATE domains SET default_domain = 0, updated_at = ? WHERE default_domain = 1", timestamp);
    }

    await this.pg.run(`
      INSERT INTO domains (
        id, hostname, provider, default_domain, cloudflare_zone_id, cloudflare_account_id,
        cloudflare_worker_name, origin_url, notes, metadata, machine_id, synced_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(hostname) DO UPDATE SET
        provider = excluded.provider,
        default_domain = excluded.default_domain,
        cloudflare_zone_id = COALESCE(excluded.cloudflare_zone_id, domains.cloudflare_zone_id),
        cloudflare_account_id = COALESCE(excluded.cloudflare_account_id, domains.cloudflare_account_id),
        cloudflare_worker_name = COALESCE(excluded.cloudflare_worker_name, domains.cloudflare_worker_name),
        origin_url = COALESCE(excluded.origin_url, domains.origin_url),
        notes = COALESCE(excluded.notes, domains.notes),
        metadata = excluded.metadata,
        machine_id = excluded.machine_id,
        synced_at = NULL,
        updated_at = excluded.updated_at
    `,
      id,
      hostname,
      input.provider || existing?.provider || "manual",
      (input.defaultDomain ?? existing?.default_domain) ? 1 : 0,
      null,
      null,
      null,
      input.originUrl || existing?.origin_url || null,
      input.notes || existing?.notes || null,
      JSON.stringify(input.metadata || existing?.metadata || {}),
      machineId,
      existing?.created_at || timestamp,
      timestamp,
    );

    return (await this.getDomain(hostname))!;
  }

  async listDomains(): Promise<Domain[]> {
    const rows = await this.pg.all(`
      SELECT * FROM domains
      ORDER BY default_domain DESC, hostname ASC
    `) as DomainRow[];
    return rows.map(domainFromRow);
  }

  async getDomain(hostnameOrId: string): Promise<Domain | null> {
    const normalized = hostnameOrId.includes(".") || hostnameOrId.includes("://")
      ? normalizeHostname(hostnameOrId)
      : hostnameOrId;
    const row = await this.pg.get(`
      SELECT * FROM domains WHERE hostname = ? OR id = ? LIMIT 1
    `, normalized, hostnameOrId) as DomainRow | null;
    return row ? domainFromRow(row) : null;
  }

  async getDefaultDomain(): Promise<Domain | null> {
    const domains = (await this.listDomains()).filter(domainIsActive);
    return domains.find((domain) => domain.default_domain)
      ?? domains.find((domain) => domain.hostname === DEFAULT_DOMAIN_HOSTNAME)
      ?? null;
  }

  private async ensureDefaultDomain(): Promise<Domain> {
    const selected = await this.getDefaultDomain();
    if (selected) return selected;
    const existing = await this.getDomain(DEFAULT_DOMAIN_HOSTNAME);
    if (existing && !domainIsActive(existing)) {
      throw new Error("The managed has.na domain is not active yet.");
    }
    return this.addDomain({
      hostname: DEFAULT_DOMAIN_HOSTNAME,
      provider: "managed",
      defaultDomain: true,
      originUrl: `https://${DEFAULT_DOMAIN_HOSTNAME}`,
      notes: "Automatic default shortlink domain.",
    });
  }

  async deleteDomain(hostnameOrId: string): Promise<Domain> {
    const domain = await this.getDomain(hostnameOrId);
    if (!domain) throw new Error("Domain not found.");
    // links + clicks cascade via ON DELETE CASCADE.
    await this.pg.run("DELETE FROM domains WHERE id = ?", domain.id);
    return domain;
  }

  async createLink(input: CreateLinkInput): Promise<Link> {
    const domain = input.domain ? await this.getDomain(input.domain) : await this.ensureDefaultDomain();
    if (!domain) throw new Error(`Domain not found: ${input.domain}`);
    const destinationUrl = validateDestinationUrl(input.destinationUrl);
    const timestamp = now();
    const machineId = getMachineId();
    const expiresAt = isoOrNull(input.expiresAt);
    const id = makeId("lnk");
    const params = (slug: string): unknown[] => [
      id,
      domain.id,
      slug,
      destinationUrl,
      input.title || null,
      expiresAt,
      JSON.stringify(input.metadata || {}),
      machineId,
      timestamp,
      timestamp,
    ];

    if (input.slug) {
      const slug = normalizeSlug(input.slug);
      try {
        await this.pg.run(`
          INSERT INTO links (
            id, domain_id, slug, destination_url, title, active, expires_at, metadata,
            machine_id, synced_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)
        `, ...params(slug));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/unique|duplicate/i.test(message)) {
          throw new Error(`Slug already exists for ${domain.hostname}: ${slug}`);
        }
        throw error;
      }
      return (await this.getLink(domain.hostname, slug))!;
    }

    // Concurrency safety lives in this one statement: every candidate is
    // claimed by the database unique constraint, never by a check-then-insert.
    const requestedLength = normalizeGeneratedSlugLength(input.slugLength);
    for (let attempt = 0; attempt < 256; attempt += 1) {
      const slug = this.tokenFactory(adaptiveSlugLength(attempt, requestedLength));
      const inserted = await this.pg.get(`
        INSERT INTO links (
          id, domain_id, slug, destination_url, title, active, expires_at, metadata,
          machine_id, synced_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT (domain_id, slug) DO NOTHING
        RETURNING *
      `, ...params(slug));
      if (inserted) return (await this.getLink(domain.hostname, slug))!;
    }
    throw new Error("Could not allocate an unused public short code after 256 atomic attempts.");
  }

  async listLinks(options: { domain?: string; activeOnly?: boolean; limit?: number } = {}): Promise<Link[]> {
    const params: Array<string | number> = [];
    let where = "WHERE 1 = 1";
    if (options.domain) {
      where += " AND d.hostname = ?";
      params.push(normalizeHostname(options.domain));
    }
    if (options.activeOnly) where += " AND l.active = 1";
    params.push(options.limit || 100);
    const rows = await this.pg.all(`
      SELECT l.*, d.hostname
      FROM links l
      JOIN domains d ON d.id = l.domain_id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT ?
    `, ...params) as LinkRow[];
    return rows.map(linkFromRow);
  }

  async getLink(domainOrSlug: string, maybeSlug?: string): Promise<Link | null> {
    if (!maybeSlug) {
      const domain = await this.getDefaultDomain();
      return domain ? this.getLink(domain.hostname, domainOrSlug) : null;
    }
    const slug = normalizeSlug(maybeSlug);
    const params: string[] = [slug];
    const domainClause = "AND d.hostname = ?";
    params.push(normalizeHostname(domainOrSlug));
    const row = await this.pg.get(`
      SELECT l.*, d.hostname
      FROM links l
      JOIN domains d ON d.id = l.domain_id
      WHERE l.slug = ? ${domainClause}
      ORDER BY d.default_domain DESC, l.created_at ASC
      LIMIT 1
    `, ...params) as LinkRow | null;
    return row ? linkFromRow(row) : null;
  }

  async totalStats(): Promise<{ domains: number; links: number; clicks: number }> {
    const row = await this.pg.get(`
      SELECT
        (SELECT COUNT(*)::int FROM domains) AS domains,
        (SELECT COUNT(*)::int FROM links) AS links,
        (SELECT COUNT(*)::int FROM clicks) AS clicks
    `) as { domains: number; links: number; clicks: number };
    return row;
  }

  async resolve(hostname: string, slug: string): Promise<Link | null> {
    const normalizedHost = normalizeHostname(hostname);
    const normalizedSlug = normalizeSlug(slug);
    const domain = await this.getDomain(normalizedHost);
    if (!domain || !domainIsActive(domain)) return null;
    const row = await this.pg.get(`
      SELECT l.*, d.hostname
      FROM links l
      JOIN domains d ON d.id = l.domain_id
      WHERE d.hostname = ? AND l.slug = ?
      LIMIT 1
    `, normalizedHost, normalizedSlug) as LinkRow | null;
    return row ? linkFromRow(row) : null;
  }

  async setLinkActive(domainOrSlug: string, maybeSlugOrActive: string | boolean, maybeActive?: boolean): Promise<Link> {
    const active = typeof maybeSlugOrActive === "boolean" ? maybeSlugOrActive : Boolean(maybeActive);
    const link = typeof maybeSlugOrActive === "boolean"
      ? await this.getLink(domainOrSlug)
      : await this.getLink(domainOrSlug, maybeSlugOrActive);
    if (!link) throw new Error("Link not found.");
    const timestamp = now();
    await this.pg.run(`
      UPDATE links SET active = ?, updated_at = ?, synced_at = NULL WHERE id = ?
    `, active ? 1 : 0, timestamp, link.id);
    return (await this.getLink(link.hostname, link.slug))!;
  }

  async deleteLink(domainOrSlug: string, maybeSlug?: string): Promise<Link> {
    const link = maybeSlug ? await this.getLink(domainOrSlug, maybeSlug) : await this.getLink(domainOrSlug);
    if (!link) throw new Error("Link not found.");
    await this.pg.run("DELETE FROM links WHERE id = ?", link.id);
    return link;
  }

  async recordClick(link: Link, input: ClickInput = {}): Promise<Click> {
    const timestamp = now();
    const machineId = getMachineId();
    const ipHash = input.ip ? this.hashIp(input.ip) : null;
    const id = makeId("clk");
    await this.pg.run(`
      INSERT INTO clicks (
        id, link_id, domain_id, slug, clicked_at, ip_hash, user_agent, referer,
        country, city, metadata, machine_id, synced_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `,
      id,
      link.id,
      link.domain_id,
      link.slug,
      timestamp,
      ipHash,
      input.userAgent || null,
      input.referer || null,
      input.country || null,
      input.city || null,
      JSON.stringify(input.metadata || {}),
      machineId,
      timestamp,
      timestamp,
    );
    const row = await this.pg.get("SELECT * FROM clicks WHERE id = ?", id) as ClickRow;
    return clickFromRow(row);
  }

  async getStats(domainOrSlug: string, maybeSlug?: string): Promise<LinkStats> {
    const link = maybeSlug ? await this.getLink(domainOrSlug, maybeSlug) : await this.getLink(domainOrSlug);
    if (!link) throw new Error("Link not found.");
    const summary = await this.pg.get(`
      SELECT COUNT(*)::int AS clicks, MAX(clicked_at) AS last_clicked_at FROM clicks WHERE link_id = ?
    `, link.id) as { clicks: number; last_clicked_at: Date | string | null };
    const topReferrers = await this.pg.all(`
      SELECT referer, COUNT(*)::int AS clicks
      FROM clicks
      WHERE link_id = ?
      GROUP BY referer
      ORDER BY clicks DESC
      LIMIT 10
    `, link.id) as Array<{ referer: string | null; clicks: number }>;
    const topUserAgents = await this.pg.all(`
      SELECT user_agent, COUNT(*)::int AS clicks
      FROM clicks
      WHERE link_id = ?
      GROUP BY user_agent
      ORDER BY clicks DESC
      LIMIT 10
    `, link.id) as Array<{ user_agent: string | null; clicks: number }>;
    return {
      link,
      clicks: summary.clicks,
      last_clicked_at: nullableIso(summary.last_clicked_at),
      top_referrers: topReferrers,
      top_user_agents: topUserAgents,
    };
  }

  private hashIp(ip: string): string {
    return createHash("sha256").update(`${getClickSalt()}:${ip}`).digest("hex");
  }


}
