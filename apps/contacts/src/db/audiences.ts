/**
 * Audiences, per-channel consent, and suppression storage (distribution plan).
 *
 * Audience segment definitions follow hasna.audience.v1: predicates over
 * contact tags, contact attributes (columns + custom fields), and group
 * membership, combined with match=all|any. Resolution honors per-channel
 * consent, the audience consent policy, suppression entries, do_not_contact,
 * and archived status.
 */
import type { ContactsDatabase } from "./database.js";
import { getDatabase, now, uuid } from "./database.js";
import type {
  Audience,
  AudienceChannel,
  AudienceExclusion,
  AudiencePredicate,
  AudiencePredicateValue,
  AudienceRecipient,
  AudienceResolution,
  AudienceRow,
  ConsentPolicy,
  ConsentStatus,
  ContactConsent,
  ContactSuppression,
  CreateAudienceInput,
  UpdateAudienceInput,
} from "../types/index.js";
import {
  AUDIENCE_CHANNELS,
  AudienceNotFoundError,
  ContactNotFoundError,
  DuplicateAudienceIdError,
  InvalidAudienceDefinitionError,
} from "../types/index.js";

const AUDIENCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToAudience(row: AudienceRow): Audience {
  return {
    ...row,
    predicates: JSON.parse(row.predicates || "[]") as AudiencePredicate[],
    suppression_synced_at: row.suppression_synced_at ?? null,
  };
}

function validatePredicates(predicates: AudiencePredicate[]): void {
  if (!Array.isArray(predicates) || predicates.length === 0) {
    throw new InvalidAudienceDefinitionError("at least one predicate is required");
  }
  for (const p of predicates) {
    if (!["tag", "attribute", "group"].includes(p.kind)) {
      throw new InvalidAudienceDefinitionError(`unknown predicate kind: ${String(p.kind)}`);
    }
    const op = p.op ?? "eq";
    if (!["eq", "neq", "in", "not_in", "exists", "not_exists"].includes(op)) {
      throw new InvalidAudienceDefinitionError(`unknown predicate op: ${String(op)}`);
    }
    if (p.kind === "attribute" && !p.key) {
      throw new InvalidAudienceDefinitionError("attribute predicates require key");
    }
    if ((op === "eq" || op === "neq") && p.value === undefined) {
      throw new InvalidAudienceDefinitionError(`${op} predicates require value`);
    }
    if ((op === "in" || op === "not_in") && !(p.values && p.values.length > 0)) {
      throw new InvalidAudienceDefinitionError(`${op} predicates require non-empty values`);
    }
  }
}

function assertChannel(channel: string): asserts channel is AudienceChannel {
  if (!(AUDIENCE_CHANNELS as readonly string[]).includes(channel)) {
    throw new InvalidAudienceDefinitionError(`unknown channel: ${channel} (expected ${AUDIENCE_CHANNELS.join("|")})`);
  }
}

// ─── Audience CRUD ────────────────────────────────────────────────────────────

export function createAudience(input: CreateAudienceInput, db?: ContactsDatabase): Audience {
  const d = db || getDatabase();
  if (!AUDIENCE_ID_PATTERN.test(input.audience_id)) {
    throw new InvalidAudienceDefinitionError(`audience_id must be a lowercase dashed slug: ${input.audience_id}`);
  }
  validatePredicates(input.predicates);
  const existing = d.query(`SELECT id FROM audiences WHERE audience_id = ?`).get(input.audience_id);
  if (existing) throw new DuplicateAudienceIdError(input.audience_id);

  const id = uuid();
  d.run(
    `INSERT INTO audiences (id, audience_id, name, match, predicates, consent_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.audience_id, input.name, input.match ?? "all", JSON.stringify(input.predicates), input.consent_policy ?? "opt_in", now(), now()],
  );
  return getAudience(id, d);
}

/** Look up by internal id or by audience_id slug. */
export function getAudience(idOrSlug: string, db?: ContactsDatabase): Audience {
  const d = db || getDatabase();
  const row = d
    .query(`SELECT * FROM audiences WHERE id = ? OR audience_id = ?`)
    .get(idOrSlug, idOrSlug) as AudienceRow | null;
  if (!row) throw new AudienceNotFoundError(idOrSlug);
  return rowToAudience(row);
}

export function listAudiences(db?: ContactsDatabase): Audience[] {
  const d = db || getDatabase();
  return (d.query(`SELECT * FROM audiences ORDER BY audience_id ASC`).all() as AudienceRow[]).map(rowToAudience);
}

export function updateAudience(idOrSlug: string, input: UpdateAudienceInput, db?: ContactsDatabase): Audience {
  const d = db || getDatabase();
  const audience = getAudience(idOrSlug, d);
  if (input.predicates !== undefined) validatePredicates(input.predicates);

  const setClauses: string[] = [];
  const params: (string | null)[] = [];
  if (input.name !== undefined) { setClauses.push("name = ?"); params.push(input.name); }
  if (input.match !== undefined) { setClauses.push("match = ?"); params.push(input.match); }
  if (input.predicates !== undefined) { setClauses.push("predicates = ?"); params.push(JSON.stringify(input.predicates)); }
  if (input.consent_policy !== undefined) { setClauses.push("consent_policy = ?"); params.push(input.consent_policy); }
  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    params.push(now(), audience.id);
    d.run(`UPDATE audiences SET ${setClauses.join(", ")} WHERE id = ?`, params);
  }
  return getAudience(audience.id, d);
}

export function deleteAudience(idOrSlug: string, db?: ContactsDatabase): void {
  const d = db || getDatabase();
  const audience = getAudience(idOrSlug, d);
  d.run(`DELETE FROM audiences WHERE id = ?`, [audience.id]);
}

export function markAudienceSuppressionSynced(idOrSlug: string, at: string, db?: ContactsDatabase): Audience {
  const d = db || getDatabase();
  const audience = getAudience(idOrSlug, d);
  d.run(`UPDATE audiences SET suppression_synced_at = ?, updated_at = ? WHERE id = ?`, [at, now(), audience.id]);
  return getAudience(audience.id, d);
}

// ─── Consent ──────────────────────────────────────────────────────────────────

export function setContactConsent(
  contactId: string,
  channel: AudienceChannel,
  status: ConsentStatus,
  source?: string,
  db?: ContactsDatabase,
): ContactConsent {
  const d = db || getDatabase();
  assertChannel(channel);
  const contact = d.query(`SELECT id FROM contacts WHERE id = ?`).get(contactId);
  if (!contact) throw new ContactNotFoundError(contactId);
  d.run(
    `INSERT INTO contact_consent (contact_id, channel, status, source, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(contact_id, channel) DO UPDATE SET status = excluded.status, source = excluded.source, updated_at = excluded.updated_at`,
    [contactId, channel, status, source ?? null, now()],
  );
  return d.query(`SELECT * FROM contact_consent WHERE contact_id = ? AND channel = ?`).get(contactId, channel) as ContactConsent;
}

export function getContactConsent(contactId: string, channel: AudienceChannel, db?: ContactsDatabase): ContactConsent | null {
  const d = db || getDatabase();
  return d.query(`SELECT * FROM contact_consent WHERE contact_id = ? AND channel = ?`).get(contactId, channel) as ContactConsent | null;
}

export function listContactConsent(contactId: string, db?: ContactsDatabase): ContactConsent[] {
  const d = db || getDatabase();
  return d.query(`SELECT * FROM contact_consent WHERE contact_id = ? ORDER BY channel ASC`).all(contactId) as ContactConsent[];
}

// ─── Suppression ──────────────────────────────────────────────────────────────

export interface SuppressInput {
  channel: AudienceChannel;
  address: string;
  contact_id?: string;
  reason?: string;
}

export function suppressAddress(input: SuppressInput, db?: ContactsDatabase): ContactSuppression {
  const d = db || getDatabase();
  assertChannel(input.channel);
  const id = uuid();
  d.run(
    `INSERT INTO contact_suppressions (id, contact_id, channel, address, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel, address) DO UPDATE SET
       reason = excluded.reason,
       contact_id = COALESCE(excluded.contact_id, contact_suppressions.contact_id),
       synced_at = NULL`,
    [id, input.contact_id ?? null, input.channel, input.address, input.reason ?? null, now()],
  );
  // If suppressing a contact's email, mirror an opt-out so future consent checks agree.
  if (input.contact_id) {
    const contact = d.query(`SELECT id FROM contacts WHERE id = ?`).get(input.contact_id);
    if (contact) setContactConsent(input.contact_id, input.channel, "opt_out", input.reason ?? "suppressed", d);
  }
  return d.query(`SELECT * FROM contact_suppressions WHERE channel = ? AND address = ?`).get(input.channel, input.address) as ContactSuppression;
}

export function unsuppressAddress(channel: AudienceChannel, address: string, db?: ContactsDatabase): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM contact_suppressions WHERE channel = ? AND address = ?`, [channel, address]);
}

export function listSuppressions(
  options: { channel?: AudienceChannel; unsyncedOnly?: boolean } = {},
  db?: ContactsDatabase,
): ContactSuppression[] {
  const d = db || getDatabase();
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.channel) { clauses.push("channel = ?"); params.push(options.channel); }
  if (options.unsyncedOnly) clauses.push("synced_at IS NULL");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return d.query(`SELECT * FROM contact_suppressions ${where} ORDER BY created_at ASC`).all(...params) as ContactSuppression[];
}

export function markSuppressionsSynced(ids: string[], at: string, db?: ContactsDatabase): number {
  const d = db || getDatabase();
  let updated = 0;
  for (const id of ids) {
    d.run(`UPDATE contact_suppressions SET synced_at = ? WHERE id = ?`, [at, id]);
    updated++;
  }
  return updated;
}

// ─── Predicate evaluation ─────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  display_name: string;
  archived: number;
  do_not_contact: number;
  custom_fields: string;
  [key: string]: unknown;
}

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function compare(actual: unknown, predicate: AudiencePredicate): boolean {
  const op = predicate.op ?? "eq";
  const actualNorm = normalize(actual);
  switch (op) {
    case "exists": return actualNorm !== null && actualNorm !== "";
    case "not_exists": return actualNorm === null || actualNorm === "";
    case "eq": return actualNorm !== null && actualNorm === normalize(predicate.value);
    case "neq": return actualNorm === null || actualNorm !== normalize(predicate.value);
    case "in": return actualNorm !== null && (predicate.values ?? []).some((v: AudiencePredicateValue) => normalize(v) === actualNorm);
    case "not_in": return actualNorm === null || !(predicate.values ?? []).some((v: AudiencePredicateValue) => normalize(v) === actualNorm);
    default: return false;
  }
}

function membershipMatch(names: string[], predicate: AudiencePredicate): boolean {
  const op = predicate.op ?? "eq";
  const set = new Set(names.map((n) => n.toLowerCase()));
  const has = (v: unknown) => {
    const n = normalize(v);
    return n !== null && set.has(n.toLowerCase());
  };
  switch (op) {
    case "exists": return set.size > 0;
    case "not_exists": return set.size === 0;
    case "eq": return has(predicate.value);
    case "neq": return !has(predicate.value);
    case "in": return (predicate.values ?? []).some(has);
    case "not_in": return !(predicate.values ?? []).some(has);
    default: return false;
  }
}

function contactTagNames(d: ContactsDatabase, contactId: string): string[] {
  const rows = d.query(
    `SELECT t.name FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = ?`,
  ).all(contactId) as { name: string }[];
  return rows.map((r) => r.name);
}

function contactGroupNames(d: ContactsDatabase, contactId: string): string[] {
  const rows = d.query(
    `SELECT g.name, g.id FROM groups g JOIN contact_groups cg ON cg.group_id = g.id WHERE cg.contact_id = ?`,
  ).all(contactId) as { name: string; id: string }[];
  return rows.flatMap((r) => [r.name, r.id]);
}

function attributeValue(row: CandidateRow, key: string): unknown {
  if (key in row && key !== "custom_fields") return row[key];
  const custom = JSON.parse(row.custom_fields || "{}") as Record<string, unknown>;
  return custom[key];
}

export function evaluateAudiencePredicate(
  d: ContactsDatabase,
  row: CandidateRow,
  predicate: AudiencePredicate,
): boolean {
  switch (predicate.kind) {
    case "tag": return membershipMatch(contactTagNames(d, row.id), predicate);
    case "group": return membershipMatch(contactGroupNames(d, row.id), predicate);
    case "attribute": return compare(attributeValue(row, predicate.key ?? ""), predicate);
    default: return false;
  }
}

export function matchAudienceContacts(audience: Audience, db?: ContactsDatabase): CandidateRow[] {
  const d = db || getDatabase();
  const candidates = d.query(`SELECT * FROM contacts WHERE archived = 0`).all() as CandidateRow[];
  return candidates.filter((row) => {
    const results = audience.predicates.map((p) => evaluateAudiencePredicate(d, row, p));
    return audience.match === "any" ? results.some(Boolean) : results.every(Boolean);
  });
}

// ─── Resolution ───────────────────────────────────────────────────────────────

function channelAddress(d: ContactsDatabase, contactId: string, channel: AudienceChannel): string | null {
  if (channel === "email") {
    const row = d.query(
      `SELECT address FROM emails WHERE contact_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
    ).get(contactId) as { address: string } | null;
    return row?.address ?? null;
  }
  if (channel === "sms") {
    const row = d.query(
      `SELECT number FROM phones WHERE contact_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
    ).get(contactId) as { number: string } | null;
    return row?.number ?? null;
  }
  const row = d.query(
    `SELECT handle, url FROM social_profiles WHERE contact_id = ? AND platform = 'telegram' ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
  ).get(contactId) as { handle: string | null; url: string | null } | null;
  return row?.handle ?? row?.url ?? null;
}

function consentAllows(policy: ConsentPolicy, status: ConsentStatus): boolean {
  switch (policy) {
    case "opt_in": return status === "opt_in";
    case "opt_out": return status !== "opt_out";
    case "transactional": return status !== "opt_out";
    case "none": return true;
    default: return false;
  }
}

/**
 * Resolve an audience to per-channel recipients, honoring consent policy,
 * per-channel consent status, suppressions, and do_not_contact.
 */
export function resolveAudience(
  idOrSlug: string,
  channel: AudienceChannel,
  db?: ContactsDatabase,
): AudienceResolution {
  const d = db || getDatabase();
  assertChannel(channel);
  const audience = getAudience(idOrSlug, d);
  const matched = matchAudienceContacts(audience, d);

  const suppressed = new Set(
    (d.query(`SELECT address FROM contact_suppressions WHERE channel = ?`).all(channel) as { address: string }[])
      .map((r) => r.address.toLowerCase()),
  );

  const recipients: AudienceRecipient[] = [];
  const excluded: AudienceExclusion[] = [];

  for (const row of matched) {
    if (row.do_not_contact) {
      excluded.push({ contact_id: row.id, reason: "do_not_contact" });
      continue;
    }
    const address = channelAddress(d, row.id, channel);
    if (!address) {
      excluded.push({ contact_id: row.id, reason: "no_address" });
      continue;
    }
    if (suppressed.has(address.toLowerCase())) {
      excluded.push({ contact_id: row.id, reason: "suppressed" });
      continue;
    }
    const consent = getContactConsent(row.id, channel, d);
    const status: ConsentStatus = consent?.status ?? "unknown";
    if (!consentAllows(audience.consent_policy, status)) {
      excluded.push({ contact_id: row.id, reason: "consent" });
      continue;
    }
    recipients.push({ contact_id: row.id, display_name: row.display_name, address, consent_status: status });
  }

  return {
    audience_id: audience.audience_id,
    channel,
    consent_policy: audience.consent_policy,
    matched: matched.length,
    recipients,
    excluded,
  };
}
