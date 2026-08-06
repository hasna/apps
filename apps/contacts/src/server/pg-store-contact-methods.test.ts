import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ContactsPgStore } from "./pg-store.js";
import { resetDatabase } from "../db/database.js";
import { createContact as localCreateContact, getContact as localGetContact, updateContact as localUpdateContact } from "../db/contacts.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";
import type { Email } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// A STATEFUL fake Postgres for contacts + emails + phones.
//
// Why stateful rather than the canned-row shim used elsewhere in this suite:
// these are ROUND-TRIP tests. A shim that returns a fixed emails array on read
// would report success even when the write never happened, which is exactly the
// defect class under test (an email-only PATCH that silently no-ops at HTTP 200).
// Only a fake whose reads are fed by its own writes can tell "stored and read
// back" from "never stored".
//
// It is a fake, not a SQL engine: it recognises the specific statements
// ContactsPgStore issues and models their state transitions. Its known limit,
// stated so nobody reads more into a green run than is there: an unrecognised
// statement returns empty rather than throwing, so if the store's SQL is
// reworded these tests fail on the assertion (the row never lands) rather than
// on the fake. They cannot catch a defect that lives in real Postgres dialect
// or constraint behaviour — only a fixture database would.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface FakePg {
  client: PoolQueryClient;
  calls: { sql: string; params: unknown[] }[];
  contacts: Row[];
  emails: Row[];
  phones: Row[];
}

function fakePostgres(): FakePg {
  const calls: { sql: string; params: unknown[] }[] = [];
  const contacts: Row[] = [];
  const emails: Row[] = [];
  const phones: Row[] = [];

  // A monotonic clock so `updated_at = NOW()` is observably different from the
  // created_at stamped a moment earlier. Real NOW() has the same property; a
  // fixed string would make the updated_at assertion untestable.
  let tick = 0;
  const nowIso = () => new Date(Date.UTC(2026, 7, 6, 0, 0, ++tick)).toISOString();

  const record = (sql: string, params: readonly unknown[] = []) => calls.push({ sql, params: [...params] });

  // `WHERE contact_id = ANY($1::text[])` — the batched child load.
  const childrenFor = (table: Row[], ids: string[]) => table.filter((r) => ids.includes(String(r["contact_id"])));

  const insertChild = (table: Row[], sql: string, params: readonly unknown[]) => {
    // INSERT INTO <t> (id, contact_id, company_id, <value col>, ...) SELECT ... WHERE NOT EXISTS (...)
    const isEmail = sql.includes("INTO emails");
    const [id, contactId, value, third, fourth] = params as [string, string, string, unknown, unknown];
    const duplicate = isEmail
      ? table.some((r) => r["contact_id"] === contactId && String(r["address"]).toLowerCase() === String(value).toLowerCase())
      : table.some((r) => r["contact_id"] === contactId && r["number"] === value);
    if (duplicate) return 0;
    table.push(
      isEmail
        ? { id, contact_id: contactId, company_id: null, address: value, type: third ?? "work", is_primary: Boolean(fourth), created_at: nowIso() }
        : { id, contact_id: contactId, company_id: null, number: value, country_code: third ?? null, type: fourth ?? "mobile", is_primary: Boolean((params as unknown[])[5]), created_at: nowIso() },
    );
    return 1;
  };

  const applyInsertContact = (params: readonly unknown[]): Row => {
    const p = params as unknown[];
    const stamp = nowIso();
    const row: Row = {
      id: p[0], first_name: p[1], last_name: p[2], display_name: p[3], nickname: p[4], avatar_url: p[5],
      notes: p[6], birthday: p[7], company_id: p[8], job_title: p[9], source: p[10], custom_fields: p[11],
      last_contacted_at: p[12], website: p[13], preferred_contact_method: p[14], status: p[15],
      follow_up_at: p[16], project_id: p[17], sensitivity: p[18], do_not_contact: p[19], priority: p[20],
      timezone: p[21], archived: false, created_at: stamp, updated_at: stamp,
    };
    contacts.push(row);
    return row;
  };

  const applyUpdateContact = (sql: string, params: readonly unknown[]): Row | null => {
    const id = String(params[0]);
    const row = contacts.find((c) => c["id"] === id);
    if (!row) return null;
    for (const [, col, idx] of sql.matchAll(/(\w+) = \$(\d+)/g)) {
      row[col!] = (params as unknown[])[Number(idx) - 1];
    }
    if (sql.includes("updated_at = NOW()")) row["updated_at"] = nowIso();
    return row;
  };

  const client = {
    async query<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("INSERT INTO emails")) return { rows: [] as T[], rowCount: insertChild(emails, sql, params ?? []) };
      if (sql.includes("INSERT INTO phones")) return { rows: [] as T[], rowCount: insertChild(phones, sql, params ?? []) };
      return { rows: [] as T[], rowCount: 0 };
    },
    async many<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("FROM emails")) return childrenFor(emails, (params?.[0] as string[]) ?? []) as T[];
      if (sql.includes("FROM phones")) return childrenFor(phones, (params?.[0] as string[]) ?? []) as T[];
      if (sql.includes("SELECT ct.contact_id, t.*")) return [] as T[];
      if (sql.includes("SELECT * FROM contacts")) return [...contacts] as T[];
      return [] as T[];
    },
    async get<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("COUNT(*)")) return { count: String(contacts.length) } as T;
      if (sql.includes("INSERT INTO contacts")) return applyInsertContact(params ?? []) as T;
      if (sql.trimStart().startsWith("UPDATE contacts")) return applyUpdateContact(sql, params ?? []) as T | null;
      if (sql.includes("FROM contacts WHERE id")) return (contacts.find((c) => c["id"] === params?.[0]) ?? null) as T | null;
      return null as T | null;
    },
    async one<T>(sql: string, params?: readonly unknown[]) { record(sql, params); return contacts[0] as T; },
    async execute(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("INSERT INTO emails")) insertChild(emails, sql, params ?? []);
      else if (sql.includes("INSERT INTO phones")) insertChild(phones, sql, params ?? []);
    },
    pool: {} as never,
    async transaction() { throw new Error("not used"); },
    async close() {},
  } as unknown as PoolQueryClient;

  return { client, calls, contacts, emails, phones };
}

const PROBE_EMAIL = "probe-8f21ac@example.invalid";
const PROBE_EMAIL_UPPER = "PROBE-8F21AC@example.invalid";
const PROBE_PHONE = "+15550100001";

describe("ContactsPgStore contact methods round-trip (cloud parity)", () => {
  test("createContact stores input.emails and getContact reads them back", async () => {
    const { client } = fakePostgres();
    const store = new ContactsPgStore(client);

    const created = await store.createContact({
      first_name: "Probe",
      last_name: "Contact",
      emails: [{ address: PROBE_EMAIL, type: "work" }],
    });

    // the write landed
    expect(created.emails).toEqual([
      expect.objectContaining({ address: PROBE_EMAIL, type: "work" }),
    ]);

    // and an independent read sees it — this is the half that a write-only
    // assertion would miss
    const fetched = await store.getContact(created.id);
    expect(fetched!.emails).toEqual([
      expect.objectContaining({ address: PROBE_EMAIL }),
    ]);
  });

  test("createContact stores input.phones and getContact reads them back", async () => {
    const { client } = fakePostgres();
    const store = new ContactsPgStore(client);

    const created = await store.createContact({
      display_name: "Probe Contact",
      phones: [{ number: PROBE_PHONE, type: "mobile" }],
    });

    const fetched = await store.getContact(created.id);
    expect(fetched!.phones).toEqual([
      expect.objectContaining({ number: PROBE_PHONE }),
    ]);
  });

  test("updateContact emails_add is readable via getContact AND listContacts", async () => {
    const { client } = fakePostgres();
    const store = new ContactsPgStore(client);
    const created = await store.createContact({ display_name: "Probe Contact" });

    const updated = await store.updateContact(created.id, {
      emails_add: [{ address: PROBE_EMAIL, type: "work" }],
    });

    expect(updated!.emails).toEqual([
      expect.objectContaining({ address: PROBE_EMAIL }),
    ]);

    const fetched = await store.getContact(created.id);
    expect(fetched!.emails).toEqual([
      expect.objectContaining({ address: PROBE_EMAIL }),
    ]);

    // list is a separate code path from get and has its own readback gap
    const listed = await store.listContacts({});
    expect(listed.contacts[0]!.emails).toEqual([
      expect.objectContaining({ address: PROBE_EMAIL }),
    ]);
  });

  test("updateContact phones_add is readable via getContact", async () => {
    const { client } = fakePostgres();
    const store = new ContactsPgStore(client);
    const created = await store.createContact({ display_name: "Probe Contact" });

    await store.updateContact(created.id, { phones_add: [{ number: PROBE_PHONE, type: "mobile" }] });

    const fetched = await store.getContact(created.id);
    expect(fetched!.phones).toEqual([
      expect.objectContaining({ number: PROBE_PHONE }),
    ]);
  });

  test("updated_at MOVES on an emails_add-only update", async () => {
    const { client } = fakePostgres();
    const store = new ContactsPgStore(client);
    const created = await store.createContact({ display_name: "Probe Contact" });
    const before = created.updated_at;

    const updated = await store.updateContact(created.id, {
      emails_add: [{ address: PROBE_EMAIL }],
    });

    // The single cheapest observable proof that the silent no-op is gone: an
    // email-only PATCH previously returned the unchanged row at HTTP 200 with
    // updated_at frozen.
    expect(updated!.updated_at).not.toBe(before);
  });

  test("an update with genuinely no fields stays a no-op read and never issues an UPDATE", async () => {
    const { client, calls } = fakePostgres();
    const store = new ContactsPgStore(client);
    const created = await store.createContact({ display_name: "Probe Contact" });
    const before = created.updated_at;
    calls.length = 0;

    const updated = await store.updateContact(created.id, {});

    expect(calls.every((c) => !c.sql.trimStart().startsWith("UPDATE"))).toBe(true);
    expect(updated!.updated_at).toBe(before);
  });

  test("emails_add dedupes case-insensitively, mirroring the SQLite store", async () => {
    const { client, emails } = fakePostgres();
    const store = new ContactsPgStore(client);
    const created = await store.createContact({ display_name: "Probe Contact" });

    await store.updateContact(created.id, { emails_add: [{ address: PROBE_EMAIL }] });
    await store.updateContact(created.id, { emails_add: [{ address: PROBE_EMAIL_UPPER }] });

    expect(emails.filter((e) => e["contact_id"] === created.id)).toHaveLength(1);
  });

  test("listContacts loads children in BATCHED queries, never one per row", async () => {
    const { client, calls } = fakePostgres();
    const store = new ContactsPgStore(client);
    for (let i = 0; i < 12; i++) {
      await store.createContact({ display_name: `Probe ${i}`, emails: [{ address: `probe-${i}@example.invalid` }] });
    }
    calls.length = 0;

    const listed = await store.listContacts({ limit: 500 });
    expect(listed.contacts).toHaveLength(12);

    // An N+1 fix would issue one SELECT per contact and be a performance
    // regression shipped alongside a correctness fix.
    const emailReads = calls.filter((c) => c.sql.includes("FROM emails"));
    expect(emailReads).toHaveLength(1);
    expect(emailReads[0]!.sql).toContain("ANY(");
  });
});

describe("cloud/local parity for contact methods", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "contacts-parity-"));
    process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
    resetDatabase();
  });

  afterEach(() => {
    resetDatabase();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  // The local half of each assertion passes today. That is what makes this test
  // discriminate rather than agree with whatever it is pointed at: it fails only
  // on the cloud side, and it would also catch a future local regression.
  test("create-with-email returns the same email shape from both stores", async () => {
    const local = localCreateContact({ display_name: "Probe Contact", emails: [{ address: PROBE_EMAIL, type: "work" }] });

    const { client } = fakePostgres();
    const cloud = await new ContactsPgStore(client).createContact({
      display_name: "Probe Contact",
      emails: [{ address: PROBE_EMAIL, type: "work" }],
    });

    const shape = (c: { emails: Email[] }) => c.emails.map((e) => ({
      address: e.address, type: e.type, is_primary: e.is_primary,
    }));

    expect(shape(local)).toEqual([
      { address: PROBE_EMAIL, type: "work", is_primary: false },
    ]);
    expect(shape(cloud)).toEqual(shape(local));
  });

  test("emails_add then read returns the same email shape from both stores", async () => {
    const localBase = localCreateContact({ display_name: "Probe Contact" });
    localUpdateContact(localBase.id, { emails_add: [{ address: PROBE_EMAIL, type: "work" }] });
    const localRead = localGetContact(localBase.id);

    const { client } = fakePostgres();
    const store = new ContactsPgStore(client);
    const cloudBase = await store.createContact({ display_name: "Probe Contact" });
    await store.updateContact(cloudBase.id, { emails_add: [{ address: PROBE_EMAIL, type: "work" }] });
    const cloudRead = await store.getContact(cloudBase.id);

    const shape = (c: { emails: Email[] }) => c.emails.map((e) => ({
      address: e.address, type: e.type, is_primary: e.is_primary,
    }));

    expect(shape(localRead)).toEqual([
      { address: PROBE_EMAIL, type: "work", is_primary: false },
    ]);
    expect(shape(cloudRead!)).toEqual(shape(localRead));
  });
});
