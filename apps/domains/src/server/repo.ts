/**
 * PG-backed repository for the domains-serve HTTP API.
 *
 * PURE REMOTE (Amendment A1): every call reads and writes the app's cloud
 * Postgres directly through the vendored storage kit's typed query client.
 * There is no cache, no local mirror, and no sync engine here — that degraded
 * client behaviour lives in the CLIENT, out of scope for the service.
 *
 * The row shapes mirror the local SQLite model in `src/db`, but the storage is
 * native Postgres: booleans are real BOOLEAN columns and the JSON columns
 * (nameservers / whois / metadata) are TEXT holding JSON strings.
 */

import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { DOMAIN_STATUSES, DOMAIN_OFFER_STATUSES } from "../db/domain-records.js";
import type {
  Domain,
  DomainStatus,
  CreateDomainInput,
  UpdateDomainInput,
  DomainStats,
  DomainOffer,
  CreateDomainOfferInput,
} from "../db/domain-records.js";
import type { DnsRecord, CreateDnsRecordInput, UpdateDnsRecordInput } from "../db/dns-records.js";
import type { Alert, CreateAlertInput } from "../db/alerts.js";
import type { DomainEmailLink, CreateDomainEmailLinkInput } from "../db/domain-records.js";
import { DOMAIN_EMAIL_TYPES } from "../db/domain-records.js";
import type { DomainOwner, CreateDomainOwnerInput, DomainOwnerSource, DomainWithOwner } from "../db/domain-owners.js";
import { DOMAIN_OWNER_SOURCES } from "../db/domain-owners.js";
import type { DomainHistory, CreateHistoryEntryInput, DomainHistoryType } from "../db/domain-history.js";
import { HISTORY_TYPES } from "../db/domain-history.js";
import type { DomainReputation, CreateReputationInput } from "../db/domain-reputation.js";

// ── row shapes as returned by Postgres ─────────────────────────────────────

interface DomainRowPg {
  id: string;
  name: string;
  registrar: string | null;
  status: string;
  registered_at: string | null;
  expires_at: string | null;
  auto_renew: boolean;
  is_premium: boolean;
  premium_price: number | null;
  standard_price: number | null;
  purchase_price: number | null;
  purchase_date: string | null;
  nameservers: string;
  whois: string;
  ssl_expires_at: string | null;
  ssl_issuer: string | null;
  notes: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToDomain(row: DomainRowPg): Domain {
  return {
    id: row.id,
    name: row.name,
    registrar: row.registrar,
    status: row.status as DomainStatus,
    registered_at: row.registered_at,
    expires_at: row.expires_at,
    auto_renew: Boolean(row.auto_renew),
    is_premium: Boolean(row.is_premium),
    premium_price: row.premium_price,
    standard_price: row.standard_price,
    purchase_price: row.purchase_price,
    purchase_date: row.purchase_date,
    nameservers: parseJson<string[]>(row.nameservers, []),
    whois: parseJson<Record<string, unknown>>(row.whois, {}),
    ssl_expires_at: row.ssl_expires_at,
    ssl_issuer: row.ssl_issuer,
    notes: row.notes,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface DnsRecordRowPg {
  id: string;
  domain_id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  created_at: string;
  [key: string]: unknown;
}

function rowToDnsRecord(row: DnsRecordRowPg): DnsRecord {
  return {
    id: row.id,
    domain_id: row.domain_id,
    type: row.type as DnsRecord["type"],
    name: row.name,
    value: row.value,
    ttl: row.ttl,
    priority: row.priority,
    created_at: row.created_at,
  };
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"] as const;

/** Repository bound to a typed query client (the vendored kit's cloud pool). */
export class DomainsRepo {
  constructor(private readonly db: TypedQueryClient) {}

  // ── domains ──────────────────────────────────────────────────────────────

  async createDomain(input: CreateDomainInput): Promise<Domain> {
    if (!input || typeof input.name !== "string" || input.name.trim() === "") {
      throw new HttpError(400, "domain 'name' is required");
    }
    const status = input.status ?? "active";
    if (!DOMAIN_STATUSES.includes(status)) {
      throw new HttpError(400, `invalid status '${status}'`);
    }
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    try {
      const row = await this.db.get<DomainRowPg>(
        `INSERT INTO domains (
           id, name, registrar, status, registered_at, expires_at, auto_renew,
           is_premium, premium_price, standard_price, purchase_price, purchase_date,
           nameservers, whois, ssl_expires_at, ssl_issuer, notes, metadata,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [
          id,
          input.name.trim(),
          input.registrar ?? null,
          status,
          input.registered_at ?? null,
          input.expires_at ?? null,
          input.auto_renew !== undefined ? input.auto_renew : true,
          input.is_premium ?? false,
          input.premium_price ?? null,
          input.standard_price ?? null,
          input.purchase_price ?? null,
          input.purchase_date ?? null,
          JSON.stringify(input.nameservers ?? []),
          JSON.stringify(input.whois ?? {}),
          input.ssl_expires_at ?? null,
          input.ssl_issuer ?? null,
          input.notes ?? null,
          JSON.stringify(input.metadata ?? {}),
          nowIso,
          nowIso,
        ],
      );
      return rowToDomain(row!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate key|unique constraint/i.test(msg)) {
        throw new HttpError(409, `domain '${input.name}' already exists`);
      }
      throw e;
    }
  }

  async getDomain(id: string): Promise<Domain | null> {
    const row = await this.db.get<DomainRowPg>("SELECT * FROM domains WHERE id = $1", [id]);
    return row ? rowToDomain(row) : null;
  }

  async getDomainByName(name: string): Promise<Domain | null> {
    const row = await this.db.get<DomainRowPg>("SELECT * FROM domains WHERE name = $1", [name]);
    return row ? rowToDomain(row) : null;
  }

  async listDomains(opts: {
    search?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<Domain[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.search) {
      params.push(`%${opts.search}%`);
      clauses.push(`name ILIKE $${params.length}`);
    }
    if (opts.status) {
      if (!DOMAIN_STATUSES.includes(opts.status as DomainStatus)) {
        throw new HttpError(400, `invalid status filter '${opts.status}'`);
      }
      params.push(opts.status);
      clauses.push(`status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const offset = Math.max(opts.offset ?? 0, 0);
    params.push(limit, offset);
    const rows = await this.db.many<DomainRowPg>(
      `SELECT * FROM domains ${where} ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(rowToDomain);
  }

  async updateDomain(id: string, patch: UpdateDomainInput): Promise<Domain | null> {
    const existing = await this.getDomain(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];
    const setCol = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    const p = patch as Record<string, unknown>;
    if ("name" in p) setCol("name", p["name"]);
    if ("registrar" in p) setCol("registrar", p["registrar"] ?? null);
    if ("status" in p) {
      if (!DOMAIN_STATUSES.includes(p["status"] as DomainStatus)) {
        throw new HttpError(400, `invalid status '${String(p["status"])}'`);
      }
      setCol("status", p["status"]);
    }
    if ("registered_at" in p) setCol("registered_at", p["registered_at"] ?? null);
    if ("expires_at" in p) setCol("expires_at", p["expires_at"] ?? null);
    if ("auto_renew" in p) setCol("auto_renew", Boolean(p["auto_renew"]));
    if ("is_premium" in p) setCol("is_premium", Boolean(p["is_premium"]));
    if ("premium_price" in p) setCol("premium_price", p["premium_price"] ?? null);
    if ("standard_price" in p) setCol("standard_price", p["standard_price"] ?? null);
    if ("purchase_price" in p) setCol("purchase_price", p["purchase_price"] ?? null);
    if ("purchase_date" in p) setCol("purchase_date", p["purchase_date"] ?? null);
    if ("nameservers" in p) setCol("nameservers", JSON.stringify(p["nameservers"] ?? []));
    if ("whois" in p) setCol("whois", JSON.stringify(p["whois"] ?? {}));
    if ("ssl_expires_at" in p) setCol("ssl_expires_at", p["ssl_expires_at"] ?? null);
    if ("ssl_issuer" in p) setCol("ssl_issuer", p["ssl_issuer"] ?? null);
    if ("notes" in p) setCol("notes", p["notes"] ?? null);
    if ("metadata" in p) setCol("metadata", JSON.stringify(p["metadata"] ?? {}));

    if (sets.length === 0) return existing;
    setCol("updated_at", new Date().toISOString());
    params.push(id);
    const row = await this.db.get<DomainRowPg>(
      `UPDATE domains SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return row ? rowToDomain(row) : null;
  }

  async deleteDomain(id: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM domains WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async countDomains(): Promise<number> {
    const row = await this.db.get<{ n: string }>("SELECT count(*)::text AS n FROM domains");
    return row ? parseInt(row.n, 10) : 0;
  }

  async getStats(): Promise<DomainStats> {
    const row = await this.db.get<Record<string, string>>(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE status = 'active')::text AS active,
         count(*) FILTER (WHERE status = 'expired')::text AS expired,
         count(*) FILTER (WHERE status = 'transferring')::text AS transferring,
         count(*) FILTER (WHERE status = 'redemption')::text AS redemption,
         count(*) FILTER (WHERE auto_renew = true)::text AS auto_renew_enabled,
         count(*) FILTER (
           WHERE NULLIF(expires_at, '')::timestamptz
             BETWEEN now() AND now() + interval '30 days'
         )::text AS expiring_30_days,
         count(*) FILTER (
           WHERE NULLIF(ssl_expires_at, '')::timestamptz
             BETWEEN now() AND now() + interval '30 days'
         )::text AS ssl_expiring_30_days
       FROM domains`,
    );
    const n = (k: string) => (row && row[k] ? parseInt(row[k]!, 10) : 0);
    return {
      total: n("total"),
      active: n("active"),
      expired: n("expired"),
      transferring: n("transferring"),
      redemption: n("redemption"),
      auto_renew_enabled: n("auto_renew_enabled"),
      expiring_30_days: n("expiring_30_days"),
      ssl_expiring_30_days: n("ssl_expiring_30_days"),
    };
  }

  // ── dns records ────────────────────────────────────────────────────────

  async listDnsRecords(domainId: string): Promise<DnsRecord[]> {
    const rows = await this.db.many<DnsRecordRowPg>(
      "SELECT * FROM dns_records WHERE domain_id = $1 ORDER BY type, name",
      [domainId],
    );
    return rows.map(rowToDnsRecord);
  }

  async createDnsRecord(domainId: string, input: CreateDnsRecordInput): Promise<DnsRecord> {
    if (!input || typeof input.type !== "string" || !DNS_TYPES.includes(input.type as (typeof DNS_TYPES)[number])) {
      throw new HttpError(400, `dns record 'type' must be one of ${DNS_TYPES.join(", ")}`);
    }
    if (typeof input.name !== "string" || typeof input.value !== "string") {
      throw new HttpError(400, "dns record 'name' and 'value' are required");
    }
    const domain = await this.getDomain(domainId);
    if (!domain) throw new HttpError(404, `domain '${domainId}' not found`);
    const id = crypto.randomUUID();
    const row = await this.db.get<DnsRecordRowPg>(
      `INSERT INTO dns_records (id, domain_id, type, name, value, ttl, priority, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id,
        domainId,
        input.type,
        input.name,
        input.value,
        input.ttl ?? 3600,
        input.priority ?? null,
        new Date().toISOString(),
      ],
    );
    return rowToDnsRecord(row!);
  }

  async getDnsRecord(id: string): Promise<DnsRecord | null> {
    const row = await this.db.get<DnsRecordRowPg>("SELECT * FROM dns_records WHERE id = $1", [id]);
    return row ? rowToDnsRecord(row) : null;
  }

  async deleteDnsRecord(id: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM dns_records WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  // ── domain offers ────────────────────────────────────────────────────────

  async listOffers(domainId: string): Promise<DomainOffer[]> {
    const rows = await this.db.many<Record<string, unknown>>(
      "SELECT * FROM domain_offers WHERE domain_id = $1 ORDER BY created_at DESC",
      [domainId],
    );
    return rows as unknown as DomainOffer[];
  }

  async createOffer(domainId: string, input: CreateDomainOfferInput): Promise<DomainOffer> {
    const domain = await this.getDomain(domainId);
    if (!domain) throw new HttpError(404, `domain '${domainId}' not found`);
    const status = input.status ?? "pending";
    if (!DOMAIN_OFFER_STATUSES.includes(status)) {
      throw new HttpError(400, `invalid offer status '${status}'`);
    }
    const id = crypto.randomUUID();
    const row = await this.db.get<Record<string, unknown>>(
      `INSERT INTO domain_offers (id, domain_id, our_offer, their_ask, status, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        id,
        domainId,
        input.our_offer ?? null,
        input.their_ask ?? null,
        status,
        input.notes ?? null,
        new Date().toISOString(),
      ],
    );
    return row as unknown as DomainOffer;
  }

  async getOffer(id: string): Promise<DomainOffer | null> {
    const row = await this.db.get<Record<string, unknown>>("SELECT * FROM domain_offers WHERE id = $1", [id]);
    return row ? (row as unknown as DomainOffer) : null;
  }

  // ── dns record update ──────────────────────────────────────────────────────

  async updateDnsRecord(id: string, patch: UpdateDnsRecordInput): Promise<DnsRecord | null> {
    const existing = await this.getDnsRecord(id);
    if (!existing) return null;
    const sets: string[] = [];
    const params: unknown[] = [];
    const setCol = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.type !== undefined) {
      if (!DNS_TYPES.includes(patch.type as (typeof DNS_TYPES)[number])) {
        throw new HttpError(400, `dns record 'type' must be one of ${DNS_TYPES.join(", ")}`);
      }
      setCol("type", patch.type);
    }
    if (patch.name !== undefined) setCol("name", patch.name);
    if (patch.value !== undefined) setCol("value", patch.value);
    if (patch.ttl !== undefined) setCol("ttl", patch.ttl);
    if (patch.priority !== undefined) setCol("priority", patch.priority ?? null);
    if (sets.length === 0) return existing;
    params.push(id);
    const row = await this.db.get<DnsRecordRowPg>(
      `UPDATE dns_records SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return row ? rowToDnsRecord(row) : null;
  }

  // ── email links ────────────────────────────────────────────────────────────

  async listEmailLinks(domainId: string): Promise<DomainEmailLink[]> {
    const rows = await this.db.many<Record<string, unknown>>(
      "SELECT * FROM domain_emails WHERE domain_id = $1 ORDER BY created_at ASC",
      [domainId],
    );
    return rows as unknown as DomainEmailLink[];
  }

  async getEmailLink(id: string): Promise<DomainEmailLink | null> {
    const row = await this.db.get<Record<string, unknown>>("SELECT * FROM domain_emails WHERE id = $1", [id]);
    return row ? (row as unknown as DomainEmailLink) : null;
  }

  async linkEmail(domainId: string, input: Omit<CreateDomainEmailLinkInput, "domain_id">): Promise<DomainEmailLink> {
    if (!DOMAIN_EMAIL_TYPES.includes(input.type)) {
      throw new HttpError(400, `invalid email link type '${input.type}'`);
    }
    const domain = await this.getDomain(domainId);
    if (!domain) throw new HttpError(404, `domain '${domainId}' not found`);
    const existing = await this.db.get<{ id: string; thread_id: string | null }>(
      "SELECT id, thread_id FROM domain_emails WHERE domain_id = $1 AND email_id = $2",
      [domainId, input.email_id],
    );
    if (existing) {
      const row = await this.db.get<Record<string, unknown>>(
        "UPDATE domain_emails SET thread_id = $1, type = $2 WHERE id = $3 RETURNING *",
        [input.thread_id ?? existing.thread_id ?? null, input.type, existing.id],
      );
      return row as unknown as DomainEmailLink;
    }
    const id = crypto.randomUUID();
    const row = await this.db.get<Record<string, unknown>>(
      `INSERT INTO domain_emails (id, domain_id, email_id, thread_id, type, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, domainId, input.email_id, input.thread_id ?? null, input.type, new Date().toISOString()],
    );
    return row as unknown as DomainEmailLink;
  }

  // ── alerts ─────────────────────────────────────────────────────────────────

  async listAlerts(domainId: string): Promise<Alert[]> {
    const rows = await this.db.many<Record<string, unknown>>(
      "SELECT * FROM alerts WHERE domain_id = $1 ORDER BY type, trigger_days_before",
      [domainId],
    );
    return rows as unknown as Alert[];
  }

  async getAlert(id: string): Promise<Alert | null> {
    const row = await this.db.get<Record<string, unknown>>("SELECT * FROM alerts WHERE id = $1", [id]);
    return row ? (row as unknown as Alert) : null;
  }

  async createAlert(domainId: string, input: Omit<CreateAlertInput, "domain_id">): Promise<Alert> {
    const domain = await this.getDomain(domainId);
    if (!domain) throw new HttpError(404, `domain '${domainId}' not found`);
    if (!["expiry", "ssl_expiry", "dns_change"].includes(input.type)) {
      throw new HttpError(400, `invalid alert type '${input.type}'`);
    }
    const id = crypto.randomUUID();
    const row = await this.db.get<Record<string, unknown>>(
      `INSERT INTO alerts (id, domain_id, type, trigger_days_before, created_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, domainId, input.type, input.trigger_days_before ?? null, new Date().toISOString()],
    );
    return row as unknown as Alert;
  }

  async deleteAlert(id: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM alerts WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  // ── owners ─────────────────────────────────────────────────────────────────

  private ownerRow(row: Record<string, unknown>): DomainOwner {
    return {
      id: row["id"] as string,
      domain_id: row["domain_id"] as string,
      contact_id: (row["contact_id"] as string | null) ?? null,
      owner_name: (row["owner_name"] as string | null) ?? null,
      owner_email: (row["owner_email"] as string | null) ?? null,
      owner_phone: (row["owner_phone"] as string | null) ?? null,
      owner_organization: (row["owner_organization"] as string | null) ?? null,
      source: row["source"] as DomainOwnerSource,
      verified: Boolean(row["verified"]),
      notes: (row["notes"] as string | null) ?? null,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    };
  }

  async listOwnersForDomain(domainId: string): Promise<DomainOwner[]> {
    const rows = await this.db.many<Record<string, unknown>>(
      "SELECT * FROM domain_owners WHERE domain_id = $1 ORDER BY created_at DESC",
      [domainId],
    );
    return rows.map((r) => this.ownerRow(r));
  }

  async listOwners(opts: { search?: string; source?: string; verified?: boolean }): Promise<DomainOwner[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.search) {
      params.push(`%${opts.search}%`);
      const p = `$${params.length}`;
      clauses.push(`(owner_name ILIKE ${p} OR owner_email ILIKE ${p} OR owner_organization ILIKE ${p} OR notes ILIKE ${p})`);
    }
    if (opts.source) {
      params.push(opts.source);
      clauses.push(`source = $${params.length}`);
    }
    if (opts.verified !== undefined) {
      params.push(opts.verified);
      clauses.push(`verified = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.many<Record<string, unknown>>(
      `SELECT * FROM domain_owners ${where} ORDER BY created_at DESC`,
      params,
    );
    return rows.map((r) => this.ownerRow(r));
  }

  async getOwner(id: string): Promise<DomainOwner | null> {
    const row = await this.db.get<Record<string, unknown>>("SELECT * FROM domain_owners WHERE id = $1", [id]);
    return row ? this.ownerRow(row) : null;
  }

  async createOwner(domainId: string, input: Omit<CreateDomainOwnerInput, "domain_id">): Promise<DomainOwner> {
    const domain = await this.getDomain(domainId);
    if (!domain) throw new HttpError(404, `domain '${domainId}' not found`);
    const source = input.source ?? "manual";
    if (!DOMAIN_OWNER_SOURCES.includes(source)) throw new HttpError(400, `invalid owner source '${source}'`);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const row = await this.db.get<Record<string, unknown>>(
      `INSERT INTO domain_owners (id, domain_id, contact_id, owner_name, owner_email, owner_phone, owner_organization, source, verified, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        id, domainId, input.contact_id ?? null, input.owner_name ?? null, input.owner_email ?? null,
        input.owner_phone ?? null, input.owner_organization ?? null, source, input.verified ?? false,
        input.notes ?? null, now, now,
      ],
    );
    return this.ownerRow(row!);
  }

  async updateOwner(id: string, patch: Partial<CreateDomainOwnerInput>): Promise<DomainOwner | null> {
    const existing = await this.getOwner(id);
    if (!existing) return null;
    const sets: string[] = [];
    const params: unknown[] = [];
    const setCol = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.contact_id !== undefined) setCol("contact_id", patch.contact_id ?? null);
    if (patch.owner_name !== undefined) setCol("owner_name", patch.owner_name ?? null);
    if (patch.owner_email !== undefined) setCol("owner_email", patch.owner_email ?? null);
    if (patch.owner_phone !== undefined) setCol("owner_phone", patch.owner_phone ?? null);
    if (patch.owner_organization !== undefined) setCol("owner_organization", patch.owner_organization ?? null);
    if (patch.source !== undefined) setCol("source", patch.source);
    if (patch.verified !== undefined) setCol("verified", Boolean(patch.verified));
    if (patch.notes !== undefined) setCol("notes", patch.notes ?? null);
    if (sets.length === 0) return existing;
    setCol("updated_at", new Date().toISOString());
    params.push(id);
    const row = await this.db.get<Record<string, unknown>>(
      `UPDATE domain_owners SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return row ? this.ownerRow(row) : null;
  }

  async deleteOwner(id: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM domain_owners WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async listDomainsWithOwners(): Promise<DomainWithOwner[]> {
    const rows = await this.db.many<Record<string, unknown>>(
      `SELECT d.name as domain_name, d.status as domain_status, d.is_premium, d.premium_price,
              o.owner_name, o.owner_email, o.owner_organization, o.contact_id, o.source, o.verified
         FROM domains d
         LEFT JOIN domain_owners o ON d.id = o.domain_id
        WHERE o.id IS NOT NULL OR d.is_premium = true
           OR d.status IN ('premium_only','not_available','negotiating','offered','researching')
        ORDER BY d.name`,
    );
    return rows.map((r) => ({
      domain_name: r["domain_name"] as string,
      domain_status: r["domain_status"] as string,
      is_premium: Boolean(r["is_premium"]),
      premium_price: (r["premium_price"] as number | null) ?? null,
      owner_name: (r["owner_name"] as string | null) ?? null,
      owner_email: (r["owner_email"] as string | null) ?? null,
      owner_organization: (r["owner_organization"] as string | null) ?? null,
      contact_id: (r["contact_id"] as string | null) ?? null,
      source: (r["source"] as DomainOwnerSource | null) ?? null,
      verified: Boolean(r["verified"]),
    }));
  }

  // ── history ────────────────────────────────────────────────────────────────

  private historyRow(row: Record<string, unknown>): DomainHistory {
    return {
      id: row["id"] as string,
      domain_id: row["domain_id"] as string,
      snapshot_type: row["snapshot_type"] as DomainHistoryType,
      raw_data: parseJson<Record<string, unknown>>(row["raw_data"] as string, {}),
      registrant_name: (row["registrant_name"] as string | null) ?? null,
      registrant_email: (row["registrant_email"] as string | null) ?? null,
      registrant_org: (row["registrant_org"] as string | null) ?? null,
      nameservers: parseJson<string[]>(row["nameservers"] as string, []),
      registrar: (row["registrar"] as string | null) ?? null,
      status: (row["status"] as string | null) ?? null,
      notes: (row["notes"] as string | null) ?? null,
      created_at: row["created_at"] as string,
    };
  }

  async createHistory(domainId: string, input: Omit<CreateHistoryEntryInput, "domain_id">): Promise<DomainHistory> {
    const domain = await this.getDomain(domainId);
    if (!domain) throw new HttpError(404, `domain '${domainId}' not found`);
    if (!HISTORY_TYPES.includes(input.snapshot_type)) throw new HttpError(400, `invalid snapshot_type '${input.snapshot_type}'`);
    const id = crypto.randomUUID();
    const row = await this.db.get<Record<string, unknown>>(
      `INSERT INTO domain_history (id, domain_id, snapshot_type, raw_data, registrant_name, registrant_email, registrant_org, nameservers, registrar, status, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        id, domainId, input.snapshot_type, JSON.stringify(input.raw_data ?? {}),
        input.registrant_name ?? null, input.registrant_email ?? null, input.registrant_org ?? null,
        JSON.stringify(input.nameservers ?? []), input.registrar ?? null, input.status ?? null,
        input.notes ?? null, new Date().toISOString(),
      ],
    );
    return this.historyRow(row!);
  }

  async getHistory(id: string): Promise<DomainHistory | null> {
    const row = await this.db.get<Record<string, unknown>>("SELECT * FROM domain_history WHERE id = $1", [id]);
    return row ? this.historyRow(row) : null;
  }

  async listHistory(domainId: string, opts: { type?: string; limit?: number }): Promise<DomainHistory[]> {
    const clauses = ["domain_id = $1"];
    const params: unknown[] = [domainId];
    if (opts.type) { params.push(opts.type); clauses.push(`snapshot_type = $${params.length}`); }
    let sql = `SELECT * FROM domain_history WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`;
    if (opts.limit) { params.push(Math.min(Math.max(opts.limit, 1), 1000)); sql += ` LIMIT $${params.length}`; }
    const rows = await this.db.many<Record<string, unknown>>(sql, params);
    return rows.map((r) => this.historyRow(r));
  }

  async listHistoryByDateRange(start: string, end: string, domainId?: string): Promise<DomainHistory[]> {
    const clauses = ["created_at BETWEEN $1 AND $2"];
    const params: unknown[] = [start, end];
    if (domainId) { params.push(domainId); clauses.push(`domain_id = $${params.length}`); }
    const rows = await this.db.many<Record<string, unknown>>(
      `SELECT * FROM domain_history WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return rows.map((r) => this.historyRow(r));
  }

  async deleteHistory(id: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM domain_history WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async deleteHistoryByDomain(domainId: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM domain_history WHERE domain_id = $1", [domainId]);
    return result.rowCount > 0;
  }

  async listHistoryChanges(): Promise<Array<{ domain_id: string; domain_name: string; latest_snapshot_type: string; latest_snapshot_at: string; snapshot_count: number }>> {
    const rows = await this.db.many<Record<string, unknown>>(
      `SELECT d.id as domain_id, d.name as domain_name,
              (SELECT snapshot_type FROM domain_history h2 WHERE h2.domain_id = d.id ORDER BY created_at DESC LIMIT 1) as latest_snapshot_type,
              MAX(h.created_at) as latest_snapshot_at,
              COUNT(h.id)::text as snapshot_count
         FROM domains d JOIN domain_history h ON d.id = h.domain_id
        GROUP BY d.id ORDER BY latest_snapshot_at DESC`,
    );
    return rows.map((r) => ({
      domain_id: r["domain_id"] as string,
      domain_name: r["domain_name"] as string,
      latest_snapshot_type: r["latest_snapshot_type"] as string,
      latest_snapshot_at: r["latest_snapshot_at"] as string,
      snapshot_count: parseInt((r["snapshot_count"] as string) ?? "0", 10),
    }));
  }

  // ── reputation ───────────────────────────────────────────────────────────

  private reputationRow(row: Record<string, unknown>): DomainReputation {
    return {
      id: row["id"] as string,
      domain_id: row["domain_id"] as string,
      is_blacklisted: Boolean(row["is_blacklisted"]),
      blacklist_sources: parseJson<string[]>(row["blacklist_sources"] as string, []),
      threat_score: (row["threat_score"] as number | null) ?? null,
      spam_score: (row["spam_score"] as number | null) ?? null,
      malware_detected: Boolean(row["malware_detected"]),
      phishing_detected: Boolean(row["phishing_detected"]),
      reputation_sources: parseJson<string[]>(row["reputation_sources"] as string, []),
      last_checked_at: (row["last_checked_at"] as string | null) ?? null,
      notes: (row["notes"] as string | null) ?? null,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    };
  }

  async getReputation(domainId: string): Promise<DomainReputation | null> {
    const row = await this.db.get<Record<string, unknown>>("SELECT * FROM domain_reputation WHERE domain_id = $1", [domainId]);
    return row ? this.reputationRow(row) : null;
  }

  async upsertReputation(domainId: string, input: Omit<CreateReputationInput, "domain_id">): Promise<DomainReputation> {
    const domain = await this.getDomain(domainId);
    if (!domain) throw new HttpError(404, `domain '${domainId}' not found`);
    const existing = await this.getReputation(domainId);
    const now = new Date().toISOString();
    if (existing) {
      const sets: string[] = [];
      const params: unknown[] = [];
      const setCol = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
      if (input.is_blacklisted !== undefined) setCol("is_blacklisted", Boolean(input.is_blacklisted));
      if (input.blacklist_sources !== undefined) setCol("blacklist_sources", JSON.stringify(input.blacklist_sources));
      if (input.threat_score !== undefined) setCol("threat_score", input.threat_score);
      if (input.spam_score !== undefined) setCol("spam_score", input.spam_score);
      if (input.malware_detected !== undefined) setCol("malware_detected", Boolean(input.malware_detected));
      if (input.phishing_detected !== undefined) setCol("phishing_detected", Boolean(input.phishing_detected));
      if (input.reputation_sources !== undefined) setCol("reputation_sources", JSON.stringify(input.reputation_sources));
      if (input.last_checked_at !== undefined) setCol("last_checked_at", input.last_checked_at);
      if (input.notes !== undefined) setCol("notes", input.notes);
      setCol("updated_at", now);
      params.push(existing.id);
      const row = await this.db.get<Record<string, unknown>>(
        `UPDATE domain_reputation SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return this.reputationRow(row!);
    }
    const id = crypto.randomUUID();
    const row = await this.db.get<Record<string, unknown>>(
      `INSERT INTO domain_reputation (id, domain_id, is_blacklisted, blacklist_sources, threat_score, spam_score, malware_detected, phishing_detected, reputation_sources, last_checked_at, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        id, domainId, input.is_blacklisted ?? false, JSON.stringify(input.blacklist_sources ?? []),
        input.threat_score ?? null, input.spam_score ?? null, input.malware_detected ?? false,
        input.phishing_detected ?? false, JSON.stringify(input.reputation_sources ?? []),
        input.last_checked_at ?? null, input.notes ?? null, now, now,
      ],
    );
    return this.reputationRow(row!);
  }

  async updateReputation(id: string, patch: Partial<CreateReputationInput>): Promise<DomainReputation | null> {
    const existing = await this.db.get<Record<string, unknown>>("SELECT * FROM domain_reputation WHERE id = $1", [id]);
    if (!existing) return null;
    return this.upsertReputation(existing["domain_id"] as string, patch);
  }

  async deleteReputation(id: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM domain_reputation WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async listReputation(opts: { blacklisted?: boolean; threshold?: number }): Promise<DomainReputation[]> {
    if (opts.blacklisted) {
      const rows = await this.db.many<Record<string, unknown>>(
        "SELECT * FROM domain_reputation WHERE is_blacklisted = true ORDER BY updated_at DESC",
      );
      return rows.map((r) => this.reputationRow(r));
    }
    const threshold = opts.threshold ?? 70;
    const rows = await this.db.many<Record<string, unknown>>(
      "SELECT * FROM domain_reputation WHERE threat_score >= $1 ORDER BY threat_score DESC",
      [threshold],
    );
    return rows.map((r) => this.reputationRow(r));
  }
}
