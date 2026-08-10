/**
 * Domain record types and CRUD operations
 */

import { getDatabase } from "./database.js";
import type { SQLQueryBindings } from "bun:sqlite";

// --- Domain types ---

export interface Domain {
  id: string;
  name: string;
  registrar: string | null;
  status: DomainStatus;
  registered_at: string | null;
  expires_at: string | null;
  auto_renew: boolean;
  is_premium: boolean;
  premium_price: number | null;
  standard_price: number | null;
  purchase_price: number | null;
  purchase_date: string | null;
  nameservers: string[];
  whois: Record<string, unknown>;
  ssl_expires_at: string | null;
  ssl_issuer: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /**
   * When the registrar facts on this row (expiry, status, auto_renew) were last
   * confirmed against the registrar. NOT `updated_at`, which moves on any edit
   * and stays still when a sync re-confirms an unchanged value.
   */
  expiry_synced_at: string | null;
}

interface DomainRow {
  id: string;
  name: string;
  registrar: string | null;
  status: string;
  registered_at: string | null;
  expires_at: string | null;
  auto_renew: number;
  is_premium: number;
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
  expiry_synced_at: string | null;
}

export const DOMAIN_STATUSES = [
  "discovered",
  "researching",
  "offered",
  "negotiating",
  "purchased",
  "active",
  "not_available",
  "premium_only",
  "declined",
  "expired",
  "transferring",
  "redemption",
] as const;

export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const DOMAIN_OFFER_STATUSES = ["pending", "accepted", "rejected", "countered"] as const;

export type DomainOfferStatus = (typeof DOMAIN_OFFER_STATUSES)[number];

export const DOMAIN_EMAIL_TYPES = [
  "inquiry",
  "offer",
  "counter_offer",
  "confirmation",
  "renewal_notice",
  "transfer",
] as const;

export type DomainEmailType = (typeof DOMAIN_EMAIL_TYPES)[number];

export function rowToDomain(row: DomainRow): Domain {
  return {
    ...row,
    status: row.status as Domain["status"],
    auto_renew: row.auto_renew === 1,
    is_premium: row.is_premium === 1,
    nameservers: JSON.parse(row.nameservers || "[]"),
    whois: JSON.parse(row.whois || "{}"),
    metadata: JSON.parse(row.metadata || "{}"),
    // Normalised so a row written before migration 6 reads as "never synced"
    // rather than undefined; the freshness helper treats both pessimistically,
    // but a caller reading the field directly should see an explicit null.
    expiry_synced_at: row.expiry_synced_at ?? null,
  };
}

// ============================================================
// Domain CRUD
// ============================================================

export interface CreateDomainInput {
  name: string;
  registrar?: string | null;
  status?: DomainStatus;
  registered_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  is_premium?: boolean;
  premium_price?: number;
  standard_price?: number;
  purchase_price?: number;
  purchase_date?: string;
  nameservers?: string[];
  whois?: Record<string, unknown>;
  ssl_expires_at?: string;
  ssl_issuer?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  /** Set only by a path that actually read the registrar. */
  expiry_synced_at?: string | null;
}

export function createDomain(input: CreateDomainInput): Domain {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const nameservers = JSON.stringify(input.nameservers || []);
  const whois = JSON.stringify(input.whois || {});
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO domains (
      id, name, registrar, status, registered_at, expires_at, auto_renew,
      is_premium, premium_price, standard_price, purchase_price, purchase_date,
      nameservers, whois, ssl_expires_at, ssl_issuer, notes, metadata,
      expiry_synced_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.registrar || null,
    input.status || "active",
    input.registered_at || null,
    input.expires_at || null,
    input.auto_renew !== undefined ? (input.auto_renew ? 1 : 0) : 1,
    input.is_premium ? 1 : 0,
    input.premium_price ?? null,
    input.standard_price ?? null,
    input.purchase_price ?? null,
    input.purchase_date || null,
    nameservers,
    whois,
    input.ssl_expires_at || null,
    input.ssl_issuer || null,
    input.notes || null,
    metadata,
    input.expiry_synced_at ?? null
  );

  return getDomain(id)!;
}

export function getDomain(id: string): Domain | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domains WHERE id = ?").get(id) as DomainRow | null;
  return row ? rowToDomain(row) : null;
}

export function getDomainByIdentifier(identifier: string): Domain | null {
  return getDomain(identifier) ?? getDomainByName(identifier);
}

export interface ListDomainsOptions {
  search?: string;
  status?: DomainStatus;
  registrar?: string;
  is_premium?: boolean;
  limit?: number;
  offset?: number;
}

export function listDomains(options: ListDomainsOptions = {}): Domain[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (options.search) {
    conditions.push("(name LIKE ? OR registrar LIKE ? OR notes LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.registrar) {
    conditions.push("registrar = ?");
    params.push(options.registrar);
  }

  if (options.is_premium !== undefined) {
    conditions.push("is_premium = ?");
    params.push(options.is_premium ? 1 : 0);
  }

  let sql = "SELECT * FROM domains";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";


  if (options.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  if (options.offset !== undefined && options.offset > 0) {
    if (options.limit === undefined) {
      // SQLite requires LIMIT when OFFSET is present.
      sql += " LIMIT -1";
    }
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as DomainRow[];
  return rows.map(rowToDomain);
}

export interface UpdateDomainInput {
  name?: string;
  registrar?: string | null;
  status?: DomainStatus;
  registered_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  is_premium?: boolean;
  premium_price?: number | null;
  standard_price?: number | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
  nameservers?: string[];
  whois?: Record<string, unknown>;
  ssl_expires_at?: string;
  ssl_issuer?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  /** Set only by a path that actually read the registrar. */
  expiry_synced_at?: string | null;
}

export function updateDomain(id: string, input: UpdateDomainInput): Domain | null {
  const db = getDatabase();
  const existing = getDomain(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.registrar !== undefined) {
    sets.push("registrar = ?");
    params.push(input.registrar);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.registered_at !== undefined) {
    sets.push("registered_at = ?");
    params.push(input.registered_at);
  }
  if (input.expires_at !== undefined) {
    sets.push("expires_at = ?");
    params.push(input.expires_at);
  }
  if (input.auto_renew !== undefined) {
    sets.push("auto_renew = ?");
    params.push(input.auto_renew ? 1 : 0);
  }
  if (input.is_premium !== undefined) {
    sets.push("is_premium = ?");
    params.push(input.is_premium ? 1 : 0);
  }
  if (input.premium_price !== undefined) {
    sets.push("premium_price = ?");
    params.push(input.premium_price);
  }
  if (input.standard_price !== undefined) {
    sets.push("standard_price = ?");
    params.push(input.standard_price);
  }
  if (input.purchase_price !== undefined) {
    sets.push("purchase_price = ?");
    params.push(input.purchase_price);
  }
  if (input.purchase_date !== undefined) {
    sets.push("purchase_date = ?");
    params.push(input.purchase_date);
  }
  if (input.nameservers !== undefined) {
    sets.push("nameservers = ?");
    params.push(JSON.stringify(input.nameservers));
  }
  if (input.whois !== undefined) {
    sets.push("whois = ?");
    params.push(JSON.stringify(input.whois));
  }
  if (input.ssl_expires_at !== undefined) {
    sets.push("ssl_expires_at = ?");
    params.push(input.ssl_expires_at);
  }
  if (input.ssl_issuer !== undefined) {
    sets.push("ssl_issuer = ?");
    params.push(input.ssl_issuer);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.expiry_synced_at !== undefined) {
    sets.push("expiry_synced_at = ?");
    params.push(input.expiry_synced_at);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE domains SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDomain(id);
}

export function deleteDomain(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM domains WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countDomains(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM domains").get() as { count: number };
  return row.count;
}

export function searchDomains(query: string): Domain[] {
  return listDomains({ search: query });
}

export function getByRegistrar(registrar: string): Domain[] {
  return listDomains({ registrar });
}

/**
 * Domains ALREADY PAST their recorded expiry while still claiming to be active.
 *
 * This is the set the forward-only window could never return: `expiring --days N`
 * floored its comparison at `now`, so a name one day over the line was invisible
 * to the exact command built to surface it. A countdown that stops at zero is not
 * an early warning.
 *
 * The status filter mirrors `listExpiringWindow` exactly, so the two halves differ
 * only in the direction of the date comparison. A row already labelled `expired`
 * is a known state, not a surprise, and is deliberately not reported here.
 */
export function listPastExpiry(): Domain[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM domains
       WHERE expires_at IS NOT NULL
         AND expires_at < datetime('now')
         AND status = 'active'
       ORDER BY expires_at`
    )
    .all() as DomainRow[];
  return rows.map(rowToDomain);
}

/**
 * Domains expiring within the next `days`, EXCLUDING those already lapsed.
 *
 * This is the original forward-only behaviour, kept under an explicit name so
 * the `expiring_30_days` statistic keeps meaning exactly what it always meant.
 * Changing that number's meaning silently would trade one wrong reading for
 * another.
 */
export function listExpiringWindow(days: number): Domain[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM domains
       WHERE expires_at IS NOT NULL
         AND expires_at <= datetime('now', '+' || ? || ' days')
         AND expires_at >= datetime('now')
         AND status = 'active'
       ORDER BY expires_at`
    )
    .all(days) as DomainRow[];
  return rows.map(rowToDomain);
}

/**
 * Two-sided expiry: everything already lapsed, plus everything due within
 * `days`. Lapsed names sort first because their dates are earliest.
 *
 * `includeLapsed: false` recovers the old forward-only set for a caller that
 * genuinely wants a forward window.
 */
export function listExpiring(days: number, options: { includeLapsed?: boolean } = {}): Domain[] {
  const includeLapsed = options.includeLapsed ?? true;
  if (!includeLapsed) return listExpiringWindow(days);
  return [...listPastExpiry(), ...listExpiringWindow(days)];
}

/** SSL certificates already past their recorded expiry. Mirror of `listPastExpiry`. */
export function listSslPastExpiry(): Domain[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM domains
       WHERE ssl_expires_at IS NOT NULL
         AND ssl_expires_at < datetime('now')
       ORDER BY ssl_expires_at`
    )
    .all() as DomainRow[];
  return rows.map(rowToDomain);
}

/** SSL certificates expiring within `days`, excluding those already lapsed. */
export function listSslExpiringWindow(days: number): Domain[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM domains
       WHERE ssl_expires_at IS NOT NULL
         AND ssl_expires_at <= datetime('now', '+' || ? || ' days')
         AND ssl_expires_at >= datetime('now')
       ORDER BY ssl_expires_at`
    )
    .all(days) as DomainRow[];
  return rows.map(rowToDomain);
}

/**
 * Two-sided SSL expiry. The same blind spot existed here and would have been
 * left behind by a fix that only touched the domain-expiry path.
 */
export function listSslExpiring(days: number, options: { includeLapsed?: boolean } = {}): Domain[] {
  const includeLapsed = options.includeLapsed ?? true;
  if (!includeLapsed) return listSslExpiringWindow(days);
  return [...listSslPastExpiry(), ...listSslExpiringWindow(days)];
}

export interface DomainStats {
  total: number;
  active: number;
  expired: number;
  transferring: number;
  redemption: number;
  auto_renew_enabled: number;
  /** Forward window only, excluding lapsed names. Meaning unchanged. */
  expiring_30_days: number;
  ssl_expiring_30_days: number;
  /** Past recorded expiry while still status=active — invisible before this fix. */
  past_expiry: number;
  /** Past recorded SSL expiry. */
  ssl_past_expiry: number;
  /** Rows whose registrar facts have never been confirmed against a registrar. */
  never_synced: number;
}

export function getDomainStats(): DomainStats {
  const db = getDatabase();

  const total = (
    db.prepare("SELECT COUNT(*) as count FROM domains").get() as { count: number }
  ).count;

  const active = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'active'").get() as { count: number }
  ).count;

  const expired = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'expired'").get() as { count: number }
  ).count;

  const transferring = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'transferring'").get() as { count: number }
  ).count;

  const redemption = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'redemption'").get() as { count: number }
  ).count;

  const auto_renew_enabled = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE auto_renew = 1").get() as { count: number }
  ).count;

  // Explicitly the forward-only window: this statistic has always meant
  // "due in the next 30 days" and keeps meaning that. The lapsed set is
  // reported separately rather than folded in, so no existing consumer's
  // number changes meaning underneath it.
  const expiring_30_days = listExpiringWindow(30).length;
  const ssl_expiring_30_days = listSslExpiringWindow(30).length;
  const past_expiry = listPastExpiry().length;
  const ssl_past_expiry = listSslPastExpiry().length;

  const never_synced = (
    db
      .prepare("SELECT COUNT(*) as count FROM domains WHERE expiry_synced_at IS NULL")
      .get() as { count: number }
  ).count;

  return {
    total,
    active,
    expired,
    transferring,
    redemption,
    auto_renew_enabled,
    expiring_30_days,
    ssl_expiring_30_days,
    past_expiry,
    ssl_past_expiry,
    never_synced,
  };
}

export function getDomainByName(name: string): Domain | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domains WHERE name = ?").get(name) as DomainRow | null;
  return row ? rowToDomain(row) : null;
}

export interface DomainOffer {
  id: string;
  domain_id: string;
  our_offer: number | null;
  their_ask: number | null;
  status: DomainOfferStatus;
  notes: string | null;
  created_at: string;
}

interface DomainOfferRow {
  id: string;
  domain_id: string;
  our_offer: number | null;
  their_ask: number | null;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface CreateDomainOfferInput {
  domain_id: string;
  our_offer?: number;
  their_ask?: number;
  status?: DomainOfferStatus;
  notes?: string;
}

export function rowToDomainOffer(row: DomainOfferRow): DomainOffer {
  return {
    ...row,
    status: row.status as DomainOfferStatus,
  };
}

export function createDomainOffer(input: CreateDomainOfferInput): DomainOffer {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO domain_offers (id, domain_id, our_offer, their_ask, status, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.domain_id,
    input.our_offer ?? null,
    input.their_ask ?? null,
    input.status ?? "pending",
    input.notes ?? null,
  );

  return getDomainOffer(id)!;
}

export function getDomainOffer(id: string): DomainOffer | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domain_offers WHERE id = ?").get(id) as DomainOfferRow | null;
  return row ? rowToDomainOffer(row) : null;
}

export function listDomainOffers(domainId: string): DomainOffer[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM domain_offers WHERE domain_id = ? ORDER BY created_at ASC")
    .all(domainId) as DomainOfferRow[];
  return rows.map(rowToDomainOffer);
}

export interface DomainEmailLink {
  id: string;
  domain_id: string;
  email_id: string;
  thread_id: string | null;
  type: DomainEmailType;
  created_at: string;
}

interface DomainEmailLinkRow {
  id: string;
  domain_id: string;
  email_id: string;
  thread_id: string | null;
  type: string;
  created_at: string;
}

export interface CreateDomainEmailLinkInput {
  domain_id: string;
  email_id: string;
  thread_id?: string;
  type: DomainEmailType;
}

export function rowToDomainEmailLink(row: DomainEmailLinkRow): DomainEmailLink {
  return {
    ...row,
    type: row.type as DomainEmailType,
  };
}

export function linkDomainEmail(input: CreateDomainEmailLinkInput): DomainEmailLink {
  const db = getDatabase();
  const existing = db
    .prepare("SELECT * FROM domain_emails WHERE domain_id = ? AND email_id = ?")
    .get(input.domain_id, input.email_id) as DomainEmailLinkRow | null;

  if (existing) {
    db.prepare(
      `UPDATE domain_emails
       SET thread_id = ?, type = ?
       WHERE id = ?`
    ).run(input.thread_id ?? existing.thread_id, input.type, existing.id);

    return getDomainEmailLink(existing.id)!;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO domain_emails (id, domain_id, email_id, thread_id, type)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.domain_id, input.email_id, input.thread_id ?? null, input.type);

  return getDomainEmailLink(id)!;
}

export function getDomainEmailLink(id: string): DomainEmailLink | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domain_emails WHERE id = ?").get(id) as DomainEmailLinkRow | null;
  return row ? rowToDomainEmailLink(row) : null;
}

export function listDomainEmailLinks(domainId: string): DomainEmailLink[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM domain_emails WHERE domain_id = ? ORDER BY created_at ASC")
    .all(domainId) as DomainEmailLinkRow[];
  return rows.map(rowToDomainEmailLink);
}

export interface DomainDetails {
  domain: Domain;
  offers: DomainOffer[];
  emails: DomainEmailLink[];
}

export function getDomainDetails(identifier: string): DomainDetails | null {
  const domain = getDomainByIdentifier(identifier);
  if (!domain) return null;

  return {
    domain,
    offers: listDomainOffers(domain.id),
    emails: listDomainEmailLinks(domain.id),
  };
}

export function markDomainPremium(
  identifier: string,
  premiumPrice: number,
  standardPrice?: number,
): Domain | null {
  const domain = getDomainByIdentifier(identifier);
  if (!domain) return null;

  return updateDomain(domain.id, {
    is_premium: true,
    premium_price: premiumPrice,
    standard_price: standardPrice ?? domain.standard_price,
    status: domain.status === "discovered" ? "premium_only" : domain.status,
  });
}

export function updateDomainLifecycleStatus(
  identifier: string,
  status: DomainStatus,
  notes?: string,
): Domain | null {
  const domain = getDomainByIdentifier(identifier);
  if (!domain) return null;

  return updateDomain(domain.id, {
    status,
    notes: notes ?? domain.notes ?? undefined,
  });
}

export interface RecordDomainPurchaseInput {
  price: number;
  registrar: string;
  purchase_date?: string;
  expires_at?: string;
  auto_renew?: boolean;
  notes?: string;
  standard_price?: number;
}

export function recordDomainPurchase(
  identifier: string,
  input: RecordDomainPurchaseInput,
): Domain | null {
  const domain = getDomainByIdentifier(identifier);
  if (!domain) return null;

  return updateDomain(domain.id, {
    registrar: input.registrar,
    status: "purchased",
    purchase_price: input.price,
    purchase_date: input.purchase_date ?? new Date().toISOString(),
    expires_at: input.expires_at ?? domain.expires_at ?? undefined,
    auto_renew: input.auto_renew ?? domain.auto_renew,
    standard_price: input.standard_price ?? domain.standard_price,
    notes: input.notes ?? domain.notes ?? undefined,
  });
}
