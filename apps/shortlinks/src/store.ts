import { createHash } from "node:crypto";
import { ShortlinksDatabase, makeId, now } from "./database.js";
import { formatShortUrl, getClickSalt, loadConfig, normalizeHostname, updateConfig } from "./config.js";
import { getMachineId } from "./machine.js";
import { DEFAULT_SLUG_LENGTH, normalizeSlug, randomToken } from "./slug.js";
import type { AddDomainInput, Click, ClickInput, CreateLinkInput, Domain, Link, LinkStats } from "./types.js";

type DomainRow = Omit<Domain, "default_domain" | "metadata"> & {
  default_domain: number;
  metadata: string;
};

type LinkRow = Omit<Link, "active" | "metadata" | "hostname"> & {
  active: number;
  metadata: string;
  hostname: string;
};

type ClickRow = Omit<Click, "metadata"> & {
  metadata: string;
};

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function domainFromRow(row: DomainRow): Domain {
  return {
    ...row,
    default_domain: Boolean(row.default_domain),
    metadata: parseJsonObject(row.metadata),
  };
}

function linkFromRow(row: LinkRow): Link {
  const config = loadConfig();
  const publicBaseUrl = config.defaultDomain === row.hostname ? config.publicBaseUrl : undefined;
  return {
    ...row,
    active: Boolean(row.active),
    metadata: parseJsonObject(row.metadata),
    short_url: formatShortUrl(row.hostname, row.slug, publicBaseUrl),
  };
}

function clickFromRow(row: ClickRow): Click {
  return {
    ...row,
    metadata: parseJsonObject(row.metadata),
  };
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

export class ShortlinksStore {
  readonly database: ShortlinksDatabase;

  constructor(dbPath?: string) {
    this.database = new ShortlinksDatabase(dbPath);
  }

  close(): void {
    this.database.close();
  }

  addDomain(input: AddDomainInput): Domain {
    const hostname = normalizeHostname(input.hostname);
    const timestamp = now();
    const machineId = getMachineId();
    const existing = this.getDomain(hostname);
    const id = existing?.id || makeId("dom");

    if (input.defaultDomain) {
      this.database.db.query("UPDATE domains SET default_domain = 0, updated_at = ?, synced_at = NULL").run(timestamp);
      updateConfig({ defaultDomain: hostname, publicBaseUrl: `https://${hostname}` });
    }

    this.database.db.query(`
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
    `).run(
      id,
      hostname,
      input.provider || existing?.provider || "manual",
      input.defaultDomain ?? existing?.default_domain ? 1 : 0,
      input.cloudflareZoneId || existing?.cloudflare_zone_id || null,
      input.cloudflareAccountId || existing?.cloudflare_account_id || null,
      input.cloudflareWorkerName || existing?.cloudflare_worker_name || null,
      input.originUrl || existing?.origin_url || null,
      input.notes || existing?.notes || null,
      JSON.stringify(input.metadata || existing?.metadata || {}),
      machineId,
      existing?.created_at || timestamp,
      timestamp,
    );

    return this.getDomain(hostname)!;
  }

  listDomains(): Domain[] {
    const rows = this.database.db.query(`
      SELECT * FROM domains
      ORDER BY default_domain DESC, hostname ASC
    `).all() as DomainRow[];
    return rows.map(domainFromRow);
  }

  getDomain(hostnameOrId: string): Domain | null {
    const normalized = hostnameOrId.includes(".") || hostnameOrId.includes("://")
      ? normalizeHostname(hostnameOrId)
      : hostnameOrId;
    const row = this.database.db.query(`
      SELECT * FROM domains WHERE hostname = ? OR id = ? LIMIT 1
    `).get(normalized, hostnameOrId) as DomainRow | null;
    return row ? domainFromRow(row) : null;
  }

  deleteDomain(hostnameOrId: string): Domain {
    const domain = this.getDomain(hostnameOrId);
    if (!domain) throw new Error("Domain not found.");
    // links + clicks cascade via ON DELETE CASCADE (foreign_keys pragma is ON).
    this.database.db.query("DELETE FROM domains WHERE id = ?").run(domain.id);
    const config = loadConfig();
    if (config.defaultDomain && normalizeHostname(config.defaultDomain) === domain.hostname) {
      updateConfig({ defaultDomain: undefined, publicBaseUrl: undefined });
    }
    return domain;
  }

  getDefaultDomain(): Domain | null {
    const config = loadConfig();
    if (config.defaultDomain) {
      const configured = this.getDomain(config.defaultDomain);
      if (configured) return configured;
    }
    const row = this.database.db.query(`
      SELECT * FROM domains ORDER BY default_domain DESC, created_at ASC LIMIT 1
    `).get() as DomainRow | null;
    return row ? domainFromRow(row) : null;
  }

  createLink(input: CreateLinkInput): Link {
    const domain = input.domain ? this.getDomain(input.domain) : this.getDefaultDomain();
    if (!domain) {
      throw new Error("No domain configured. Run `shortlinks domain add <domain> --default` first.");
    }
    const destinationUrl = validateDestinationUrl(input.destinationUrl);
    const timestamp = now();
    const machineId = getMachineId();
    const expiresAt = isoOrNull(input.expiresAt);
    const slug = input.slug
      ? normalizeSlug(input.slug)
      : this.generateAvailableSlug(domain.id, input.slugLength || DEFAULT_SLUG_LENGTH);

    try {
      this.database.db.query(`
        INSERT INTO links (
          id, domain_id, slug, destination_url, title, active, expires_at, metadata,
          machine_id, synced_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)
      `).run(
        makeId("lnk"),
        domain.id,
        slug,
        destinationUrl,
        input.title || null,
        expiresAt,
        JSON.stringify(input.metadata || {}),
        machineId,
        timestamp,
        timestamp,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE")) {
        throw new Error(`Slug already exists for ${domain.hostname}: ${slug}`);
      }
      throw error;
    }

    return this.getLink(domain.hostname, slug)!;
  }

  listLinks(options: { domain?: string; activeOnly?: boolean; limit?: number } = {}): Link[] {
    const params: Array<string | number> = [];
    let where = "WHERE 1 = 1";
    if (options.domain) {
      where += " AND d.hostname = ?";
      params.push(normalizeHostname(options.domain));
    }
    if (options.activeOnly) {
      where += " AND l.active = 1";
    }
    params.push(options.limit || 100);
    const rows = this.database.db.query(`
      SELECT l.*, d.hostname
      FROM links l
      JOIN domains d ON d.id = l.domain_id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT ?
    `).all(...params) as LinkRow[];
    return rows.map(linkFromRow);
  }

  getLink(domainOrSlug: string, maybeSlug?: string): Link | null {
    const slug = normalizeSlug(maybeSlug || domainOrSlug);
    const params: string[] = [slug];
    let domainClause = "";
    if (maybeSlug) {
      domainClause = "AND d.hostname = ?";
      params.push(normalizeHostname(domainOrSlug));
    }
    const row = this.database.db.query(`
      SELECT l.*, d.hostname
      FROM links l
      JOIN domains d ON d.id = l.domain_id
      WHERE l.slug = ? ${domainClause}
      ORDER BY d.default_domain DESC, l.created_at ASC
      LIMIT 1
    `).get(...params) as LinkRow | null;
    return row ? linkFromRow(row) : null;
  }

  resolve(hostname: string, slug: string): Link | null {
    const normalizedSlug = normalizeSlug(slug);
    const normalizedHost = normalizeHostname(hostname);
    const row = this.database.db.query(`
      SELECT l.*, d.hostname
      FROM links l
      JOIN domains d ON d.id = l.domain_id
      WHERE d.hostname = ? AND l.slug = ?
      LIMIT 1
    `).get(normalizedHost, normalizedSlug) as LinkRow | null;
    if (row) return linkFromRow(row);

    const fallback = this.getDefaultDomain();
    if (!fallback || fallback.hostname === normalizedHost) return null;
    return this.getLink(fallback.hostname, normalizedSlug);
  }

  setLinkActive(domainOrSlug: string, maybeSlugOrActive: string | boolean, maybeActive?: boolean): Link {
    const active = typeof maybeSlugOrActive === "boolean" ? maybeSlugOrActive : Boolean(maybeActive);
    const link = typeof maybeSlugOrActive === "boolean"
      ? this.getLink(domainOrSlug)
      : this.getLink(domainOrSlug, maybeSlugOrActive);
    if (!link) throw new Error("Link not found.");
    const timestamp = now();
    this.database.db.query(`
      UPDATE links SET active = ?, updated_at = ?, synced_at = NULL WHERE id = ?
    `).run(active ? 1 : 0, timestamp, link.id);
    return this.getLink(link.hostname, link.slug)!;
  }

  deleteLink(domainOrSlug: string, maybeSlug?: string): Link {
    const link = maybeSlug ? this.getLink(domainOrSlug, maybeSlug) : this.getLink(domainOrSlug);
    if (!link) throw new Error("Link not found.");
    this.database.db.query("DELETE FROM links WHERE id = ?").run(link.id);
    return link;
  }

  recordClick(link: Link, input: ClickInput = {}): Click {
    const timestamp = now();
    const machineId = getMachineId();
    const ipHash = input.ip ? this.hashIp(input.ip) : null;
    const id = makeId("clk");
    this.database.db.query(`
      INSERT INTO clicks (
        id, link_id, domain_id, slug, clicked_at, ip_hash, user_agent, referer,
        country, city, metadata, machine_id, synced_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
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
    const row = this.database.db.query("SELECT * FROM clicks WHERE id = ?").get(id) as ClickRow;
    return clickFromRow(row);
  }

  getStats(domainOrSlug: string, maybeSlug?: string): LinkStats {
    const link = maybeSlug ? this.getLink(domainOrSlug, maybeSlug) : this.getLink(domainOrSlug);
    if (!link) throw new Error("Link not found.");
    const summary = this.database.db.query(`
      SELECT COUNT(*) AS clicks, MAX(clicked_at) AS last_clicked_at FROM clicks WHERE link_id = ?
    `).get(link.id) as { clicks: number; last_clicked_at: string | null };
    const topReferrers = this.database.db.query(`
      SELECT referer, COUNT(*) AS clicks
      FROM clicks
      WHERE link_id = ?
      GROUP BY referer
      ORDER BY clicks DESC
      LIMIT 10
    `).all(link.id) as Array<{ referer: string | null; clicks: number }>;
    const topUserAgents = this.database.db.query(`
      SELECT user_agent, COUNT(*) AS clicks
      FROM clicks
      WHERE link_id = ?
      GROUP BY user_agent
      ORDER BY clicks DESC
      LIMIT 10
    `).all(link.id) as Array<{ user_agent: string | null; clicks: number }>;
    return {
      link,
      clicks: summary.clicks,
      last_clicked_at: summary.last_clicked_at,
      top_referrers: topReferrers,
      top_user_agents: topUserAgents,
    };
  }

  totalStats(): { domains: number; links: number; clicks: number } {
    const row = this.database.db.query(`
      SELECT
        (SELECT COUNT(*) FROM domains) AS domains,
        (SELECT COUNT(*) FROM links) AS links,
        (SELECT COUNT(*) FROM clicks) AS clicks
    `).get() as { domains: number; links: number; clicks: number };
    return row;
  }

  private generateAvailableSlug(domainId: string, length: number): string {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const slug = randomToken(length);
      const exists = this.database.db.query(`
        SELECT 1 FROM links WHERE domain_id = ? AND slug = ? LIMIT 1
      `).get(domainId, slug);
      if (!exists) return slug;
    }
    throw new Error("Could not generate an unused slug after 32 attempts.");
  }

  private hashIp(ip: string): string {
    return createHash("sha256").update(`${getClickSalt()}:${ip}`).digest("hex");
  }
}
