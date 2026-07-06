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
import type { DnsRecord, CreateDnsRecordInput } from "../db/dns-records.js";

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
}
