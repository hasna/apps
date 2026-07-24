// Live PostgreSQL runtime gate. Skipped unless PERSONALNOTES_TEST_DATABASE_URL
// points at a DISPOSABLE Postgres (never a shared/production database). This is
// the proof that "dual storage" is real and not cloud-sync-only PG
// (hasna-storage-standard: "dual is unproven without a runtime gate").
//
//   PERSONALNOTES_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres bun test
//
// The URL's database is used only as an admin connection to create/drop a
// throwaway database per run, so concurrent suites never collide.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresNoteStorage } from "./postgres-note-storage.js";
import { POSTGRES_STORAGE_MIGRATIONS } from "./postgres-schema.js";
import { SqliteNoteStorage } from "./sqlite.js";
import { SqliteNoteStore } from "./store.js";

const ADMIN_URL = process.env.PERSONALNOTES_TEST_DATABASE_URL;
const RUN_LIVE = typeof ADMIN_URL === "string" && ADMIN_URL.length > 0;
const suite = RUN_LIVE ? describe : describe.skip;

function childUrl(dbName: string): string {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function createDatabase(): Promise<string> {
  const dbName = `pn_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
  return dbName;
}

async function dropDatabase(dbName: string): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

suite("PostgresNoteStorage (live)", () => {
  let dbName: string;
  let storage: PostgresNoteStorage;

  beforeAll(async () => {
    dbName = await createDatabase();
    storage = new PostgresNoteStorage(
      PgPoolExecutor.fromConnectionString({ connectionString: childUrl(dbName) }),
    );
    await storage.migrate();
  });

  afterAll(async () => {
    await storage?.close();
    if (dbName) await dropDatabase(dbName);
  });

  test("migrations are recorded and idempotent", async () => {
    const applied = await storage.listAppliedMigrations();
    expect(applied.map((m) => m.id)).toEqual(POSTGRES_STORAGE_MIGRATIONS.map((m) => m.id));
    expect(applied[0]!.checksum).toBe(POSTGRES_STORAGE_MIGRATIONS[0]!.checksum);

    const again = await storage.migrate();
    expect(again.plan.every((p) => p.state === "already_applied")).toBe(true);

    const dry = await storage.migrate({ dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.plan.every((p) => p.state === "already_applied")).toBe(true);
  });

  test("create → get → update → delete round-trips", async () => {
    const created = await storage.createNote({
      title: "pg note",
      body: "hello",
      labels: ["Work", "work"],
      folder: "inbox",
    });
    expect(created.labels).toEqual(["Work"]);

    const fetched = await storage.getNote(created.id);
    expect(fetched).toEqual(created);

    const updated = await storage.updateNote(created.id, { status: "reviewed", body: "bye" });
    expect(updated?.status).toBe("reviewed");
    expect(updated?.body).toBe("bye");

    expect(await storage.deleteNote(created.id)).toBe(true);
    expect(await storage.getNote(created.id)).toBeUndefined();
  });

  test("list filters: status, folder, label (jsonb), free-text, trash, pagination", async () => {
    const tenantId = `t_${Math.random().toString(36).slice(2)}`;
    await storage.createNote({ tenantId, title: "alpha meeting", folder: "work", labels: ["urgent"] });
    await storage.createNote({ tenantId, title: "beta groceries", folder: "home", labels: ["shopping"], status: "reviewed" });
    await storage.createNote({ tenantId, title: "gamma old", status: "trash" });

    expect((await storage.listNotes({ tenantId })).total).toBe(2);
    expect((await storage.listNotes({ tenantId, status: "reviewed" })).notes.map((n) => n.title)).toEqual([
      "beta groceries",
    ]);
    expect((await storage.listNotes({ tenantId, folder: "work" })).notes.map((n) => n.title)).toEqual([
      "alpha meeting",
    ]);
    expect((await storage.listNotes({ tenantId, label: "shopping" })).notes.map((n) => n.title)).toEqual([
      "beta groceries",
    ]);
    expect((await storage.listNotes({ tenantId, query: "100%" })).total).toBe(0);
    expect((await storage.listNotes({ tenantId, query: "meeting" })).notes.map((n) => n.title)).toEqual([
      "alpha meeting",
    ]);
    expect((await storage.listNotes({ tenantId, includeTrashed: true })).total).toBe(3);

    const page = await storage.listNotes({ tenantId, includeTrashed: true, limit: 2, offset: 0 });
    expect(page.notes.length).toBe(2);
    expect(page.hasMore).toBe(true);
  });

  test("labels and settings upsert/list/remove", async () => {
    const tenantId = `t_${Math.random().toString(36).slice(2)}`;
    await storage.putLabel("work", "#f00", tenantId);
    expect((await storage.putLabel("work", "#0f0", tenantId)).color).toBe("#0f0");
    expect((await storage.listLabels(tenantId)).map((l) => l.name)).toEqual(["work"]);
    expect(await storage.removeLabel("work", tenantId)).toBe(true);

    await storage.setSetting("theme", "dark", tenantId);
    expect((await storage.setSetting("theme", "light", tenantId)).value).toBe("light");
    expect((await storage.getSetting("theme", tenantId))?.value).toBe("light");
  });

  test("cross-engine parity: identical input yields an identical NoteRecord on SQLite and Postgres", async () => {
    const input = {
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: `parity_${Math.random().toString(36).slice(2)}`,
      title: "parity",
      body: "same everywhere",
      labels: ["a", "b"],
      folder: "f",
      status: "promoted" as const,
      createdAt: "2020-01-02T03:04:05.000Z",
    };

    const sqlite = new SqliteNoteStorage(new SqliteNoteStore(":memory:"));
    try {
      const sqliteNote = await sqlite.createNote(input);
      const pgNote = await storage.createNote(input);
      expect(pgNote).toEqual(sqliteNote);
    } finally {
      await sqlite.close();
    }
  });

  test("advisory lock: concurrent migrators apply each migration exactly once", async () => {
    const freshDb = await createDatabase();
    const a = new PostgresNoteStorage(
      PgPoolExecutor.fromConnectionString({ connectionString: childUrl(freshDb) }),
    );
    const b = new PostgresNoteStorage(
      PgPoolExecutor.fromConnectionString({ connectionString: childUrl(freshDb) }),
    );
    try {
      await Promise.all([a.migrate(), b.migrate()]);
      const applied = await a.listAppliedMigrations();
      expect(applied.map((m) => m.id)).toEqual(POSTGRES_STORAGE_MIGRATIONS.map((m) => m.id));
    } finally {
      await a.close();
      await b.close();
      await dropDatabase(freshDb);
    }
  });
});
