import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
  Asset,
  EntityRef,
  FilingDocument,
  NiceClass,
  Registration,
  Renewal,
} from "../types/index.js";

// Low-level, typed row operations. No authorization or audit here — that lives in
// the services layer. CLI/MCP/API surfaces never import this module directly.

function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}

// === entities (cached entity refs) ===

export function insertEntity(db: Database, input: { entity_id?: string; entity_slug?: string | null; name: string }): EntityRef {
  const entity_id = input.entity_id ?? randomUUID();
  db.query(
    "INSERT INTO entities (entity_id, entity_slug, name, created_at) VALUES ($id, $slug, $name, $created)",
  ).run({ $id: entity_id, $slug: input.entity_slug ?? null, $name: input.name, $created: nowIso() });
  return getEntity(db, entity_id)!;
}

export function getEntity(db: Database, entityId: string): EntityRef | null {
  return db.query<EntityRef, [string]>("SELECT * FROM entities WHERE entity_id = ?").get(entityId) ?? null;
}

export function listEntities(db: Database): EntityRef[] {
  return db.query<EntityRef, []>("SELECT * FROM entities ORDER BY created_at ASC").all();
}

// === assets ===

export function insertAsset(
  db: Database,
  input: { entity_id: string; kind: string; name: string; description?: string | null; status?: string },
): Asset {
  const id = randomUUID();
  const ts = nowIso();
  db.query(
    `INSERT INTO assets (id, entity_id, kind, name, description, status, created_at, updated_at)
     VALUES ($id, $entity, $kind, $name, $desc, $status, $ts, $ts)`,
  ).run({
    $id: id,
    $entity: input.entity_id,
    $kind: input.kind,
    $name: input.name,
    $desc: input.description ?? null,
    $status: input.status ?? "draft",
    $ts: ts,
  });
  return getAsset(db, id)!;
}

export function getAsset(db: Database, id: string): Asset | null {
  return db.query<Asset, [string]>("SELECT * FROM assets WHERE id = ?").get(id) ?? null;
}

export function listAssets(db: Database, filter: { entity_id?: string; kind?: string; status?: string } = {}): Asset[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter.entity_id) {
    clauses.push("entity_id = $entity");
    params.$entity = filter.entity_id;
  }
  if (filter.kind) {
    clauses.push("kind = $kind");
    params.$kind = filter.kind;
  }
  if (filter.status) {
    clauses.push("status = $status");
    params.$status = filter.status;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.query<Asset, typeof params>(`SELECT * FROM assets ${where} ORDER BY created_at ASC`).all(params);
}

export function updateAsset(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null; status?: string; kind?: string },
): Asset | null {
  const current = getAsset(db, id);
  if (!current) return null;
  const next = {
    name: patch.name ?? current.name,
    description: patch.description === undefined ? current.description : patch.description,
    status: patch.status ?? current.status,
    kind: patch.kind ?? current.kind,
  };
  db.query(
    "UPDATE assets SET name=$name, description=$desc, status=$status, kind=$kind, updated_at=$ts WHERE id=$id",
  ).run({ $name: next.name, $desc: next.description, $status: next.status, $kind: next.kind, $ts: nowIso(), $id: id });
  return getAsset(db, id);
}

export function deleteAsset(db: Database, id: string): boolean {
  return db.query("DELETE FROM assets WHERE id = ?").run(id).changes > 0;
}

// === registrations ===

export function insertRegistration(
  db: Database,
  input: {
    asset_id: string;
    jurisdiction: string;
    office?: string | null;
    kind?: string;
    app_number?: string | null;
    reg_number?: string | null;
    filing_date?: string | null;
    registration_date?: string | null;
    status?: string;
  },
): Registration {
  const id = randomUUID();
  db.query(
    `INSERT INTO registrations (id, asset_id, jurisdiction, office, kind, app_number, reg_number, filing_date, registration_date, status, created_at)
     VALUES ($id,$asset,$jur,$office,$kind,$app,$reg,$filing,$regdate,$status,$ts)`,
  ).run({
    $id: id,
    $asset: input.asset_id,
    $jur: input.jurisdiction,
    $office: input.office ?? null,
    $kind: input.kind ?? "application",
    $app: input.app_number ?? null,
    $reg: input.reg_number ?? null,
    $filing: input.filing_date ?? null,
    $regdate: input.registration_date ?? null,
    $status: input.status ?? "filed",
    $ts: nowIso(),
  });
  return getRegistration(db, id)!;
}

export function getRegistration(db: Database, id: string): Registration | null {
  return db.query<Registration, [string]>("SELECT * FROM registrations WHERE id = ?").get(id) ?? null;
}

export function listRegistrations(db: Database, filter: { asset_id?: string; status?: string } = {}): Registration[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter.asset_id) {
    clauses.push("asset_id = $asset");
    params.$asset = filter.asset_id;
  }
  if (filter.status) {
    clauses.push("status = $status");
    params.$status = filter.status;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.query<Registration, typeof params>(`SELECT * FROM registrations ${where} ORDER BY created_at ASC`).all(params);
}

export function updateRegistration(
  db: Database,
  id: string,
  patch: Partial<Pick<Registration, "office" | "kind" | "app_number" | "reg_number" | "filing_date" | "registration_date" | "status">>,
): Registration | null {
  const current = getRegistration(db, id);
  if (!current) return null;
  db.query(
    `UPDATE registrations SET office=$office, kind=$kind, app_number=$app, reg_number=$reg,
       filing_date=$filing, registration_date=$regdate, status=$status WHERE id=$id`,
  ).run({
    $office: patch.office === undefined ? current.office : patch.office,
    $kind: patch.kind ?? current.kind,
    $app: patch.app_number === undefined ? current.app_number : patch.app_number,
    $reg: patch.reg_number === undefined ? current.reg_number : patch.reg_number,
    $filing: patch.filing_date === undefined ? current.filing_date : patch.filing_date,
    $regdate: patch.registration_date === undefined ? current.registration_date : patch.registration_date,
    $status: patch.status ?? current.status,
    $id: id,
  });
  return getRegistration(db, id);
}

export function deleteRegistration(db: Database, id: string): boolean {
  return db.query("DELETE FROM registrations WHERE id = ?").run(id).changes > 0;
}

// === renewals ===

export function insertRenewal(
  db: Database,
  input: {
    asset_id: string;
    registration_id?: string | null;
    due_date: string;
    fee_amount?: number | null;
    fee_currency?: string | null;
    status?: string;
    reminder_days?: number;
  },
): Renewal {
  const id = randomUUID();
  db.query(
    `INSERT INTO renewals (id, asset_id, registration_id, due_date, fee_amount, fee_currency, status, reminder_days, last_reminded_at, created_at)
     VALUES ($id,$asset,$reg,$due,$fee,$cur,$status,$rem,NULL,$ts)`,
  ).run({
    $id: id,
    $asset: input.asset_id,
    $reg: input.registration_id ?? null,
    $due: input.due_date,
    $fee: input.fee_amount ?? null,
    $cur: input.fee_currency ?? null,
    $status: input.status ?? "upcoming",
    $rem: input.reminder_days ?? 30,
    $ts: nowIso(),
  });
  return getRenewal(db, id)!;
}

export function getRenewal(db: Database, id: string): Renewal | null {
  return db.query<Renewal, [string]>("SELECT * FROM renewals WHERE id = ?").get(id) ?? null;
}

export function listRenewals(db: Database, filter: { asset_id?: string; status?: string } = {}): Renewal[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter.asset_id) {
    clauses.push("asset_id = $asset");
    params.$asset = filter.asset_id;
  }
  if (filter.status) {
    clauses.push("status = $status");
    params.$status = filter.status;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.query<Renewal, typeof params>(`SELECT * FROM renewals ${where} ORDER BY due_date ASC`).all(params);
}

export function updateRenewal(
  db: Database,
  id: string,
  patch: Partial<Pick<Renewal, "due_date" | "fee_amount" | "fee_currency" | "status" | "reminder_days" | "last_reminded_at">>,
): Renewal | null {
  const current = getRenewal(db, id);
  if (!current) return null;
  db.query(
    `UPDATE renewals SET due_date=$due, fee_amount=$fee, fee_currency=$cur, status=$status,
       reminder_days=$rem, last_reminded_at=$last WHERE id=$id`,
  ).run({
    $due: patch.due_date ?? current.due_date,
    $fee: patch.fee_amount === undefined ? current.fee_amount : patch.fee_amount,
    $cur: patch.fee_currency === undefined ? current.fee_currency : patch.fee_currency,
    $status: patch.status ?? current.status,
    $rem: patch.reminder_days ?? current.reminder_days,
    $last: patch.last_reminded_at === undefined ? current.last_reminded_at : patch.last_reminded_at,
    $id: id,
  });
  return getRenewal(db, id);
}

export function deleteRenewal(db: Database, id: string): boolean {
  return db.query("DELETE FROM renewals WHERE id = ?").run(id).changes > 0;
}

// === classes (Nice classification) ===

export function insertClass(db: Database, input: { asset_id: string; nice_class: number; description?: string | null }): NiceClass {
  const id = randomUUID();
  db.query(
    "INSERT INTO classes (id, asset_id, nice_class, description, created_at) VALUES ($id,$asset,$nice,$desc,$ts)",
  ).run({ $id: id, $asset: input.asset_id, $nice: input.nice_class, $desc: input.description ?? null, $ts: nowIso() });
  return getClass(db, id)!;
}

export function getClass(db: Database, id: string): NiceClass | null {
  return db.query<NiceClass, [string]>("SELECT * FROM classes WHERE id = ?").get(id) ?? null;
}

export function listClasses(db: Database, filter: { asset_id?: string } = {}): NiceClass[] {
  if (filter.asset_id) {
    return db.query<NiceClass, [string]>("SELECT * FROM classes WHERE asset_id = ? ORDER BY nice_class ASC").all(filter.asset_id);
  }
  return db.query<NiceClass, []>("SELECT * FROM classes ORDER BY nice_class ASC").all();
}

export function deleteClass(db: Database, id: string): boolean {
  return db.query("DELETE FROM classes WHERE id = ?").run(id).changes > 0;
}

// === documents ===

export function insertDocument(
  db: Database,
  input: { asset_id: string; title: string; doc_type?: string; doc_ref?: string | null },
): FilingDocument {
  const id = randomUUID();
  db.query(
    "INSERT INTO documents (id, asset_id, title, doc_type, doc_ref, created_at) VALUES ($id,$asset,$title,$type,$ref,$ts)",
  ).run({
    $id: id,
    $asset: input.asset_id,
    $title: input.title,
    $type: input.doc_type ?? "filing",
    $ref: input.doc_ref ?? null,
    $ts: nowIso(),
  });
  return getDocument(db, id)!;
}

export function getDocument(db: Database, id: string): FilingDocument | null {
  return db.query<FilingDocument, [string]>("SELECT * FROM documents WHERE id = ?").get(id) ?? null;
}

export function listDocuments(db: Database, filter: { asset_id?: string } = {}): FilingDocument[] {
  if (filter.asset_id) {
    return db.query<FilingDocument, [string]>("SELECT * FROM documents WHERE asset_id = ? ORDER BY created_at ASC").all(filter.asset_id);
  }
  return db.query<FilingDocument, []>("SELECT * FROM documents ORDER BY created_at ASC").all();
}

export function deleteDocument(db: Database, id: string): boolean {
  return db.query("DELETE FROM documents WHERE id = ?").run(id).changes > 0;
}
