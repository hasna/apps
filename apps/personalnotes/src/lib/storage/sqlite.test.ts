import { describe, expect, test } from "bun:test";
import { SqliteNoteStorage, createSqliteNoteStorage } from "./sqlite.js";
import { SqliteNoteStore } from "./store.js";
import { SQLITE_MIGRATION_LEDGER_TABLE, SQLITE_STORAGE_MIGRATIONS } from "./sqlite-schema.js";

function freshStorage(): SqliteNoteStorage {
  return createSqliteNoteStorage(":memory:");
}

describe("SqliteNoteStorage — migrations", () => {
  test("auto-migrates on open and records the ledger with correct checksums", async () => {
    const storage = freshStorage();
    try {
      const applied = await storage.listAppliedMigrations();
      expect(applied.map((m) => m.id)).toEqual(["0001_init"]);
      expect(applied[0]!.checksum).toBe(SQLITE_STORAGE_MIGRATIONS[0]!.checksum);
      // user_version tracks the number of applied migrations.
      const version = storage.store.db.query("PRAGMA user_version").get() as { user_version: number };
      expect(version.user_version).toBe(SQLITE_STORAGE_MIGRATIONS.length);
    } finally {
      await storage.close();
    }
  });

  test("migrate() is idempotent", async () => {
    const storage = freshStorage();
    try {
      const first = await storage.migrate();
      const second = await storage.migrate();
      expect(first.plan.every((p) => p.state === "already_applied")).toBe(true);
      expect(second.applied.length).toBe(SQLITE_STORAGE_MIGRATIONS.length);
    } finally {
      await storage.close();
    }
  });

  test("dry-run reports the plan without mutating the ledger", async () => {
    const store = new SqliteNoteStore(":memory:");
    try {
      const result = store.migrate({ dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.plan.length).toBe(SQLITE_STORAGE_MIGRATIONS.length);
    } finally {
      store.close();
    }
  });

  test("rejects a database written by a newer binary (user_version too high)", () => {
    const store = new SqliteNoteStore(":memory:");
    try {
      store.db.exec("PRAGMA user_version = 999");
      expect(() => store.migrate()).toThrow(/newer than this binary/);
    } finally {
      store.close();
    }
  });

  test("rejects a checksum mismatch on a previously applied migration", () => {
    const store = new SqliteNoteStore(":memory:");
    try {
      store.db
        .query(`UPDATE ${SQLITE_MIGRATION_LEDGER_TABLE} SET checksum = ? WHERE id = ?`)
        .run("sha256:tampered", "0001_init");
      expect(() => store.migrate()).toThrow(/checksum mismatch/);
    } finally {
      store.close();
    }
  });

  test("rejects an unknown applied migration", () => {
    const store = new SqliteNoteStore(":memory:");
    try {
      store.db
        .query(`INSERT INTO ${SQLITE_MIGRATION_LEDGER_TABLE} (id, checksum, applied_at) VALUES (?, ?, ?)`)
        .run("9999_future", "sha256:x", new Date().toISOString());
      expect(() => store.migrate()).toThrow(/not recognized/);
    } finally {
      store.close();
    }
  });
});

describe("SqliteNoteStorage — notes CRUD", () => {
  test("create → get round-trips all fields with defaults", async () => {
    const storage = freshStorage();
    try {
      const created = await storage.createNote({ title: "Hello", body: "world", labels: ["Work", "work", "Ideas"] });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.tenantId).toBe("local");
      expect(created.status).toBe("active");
      expect(created.contentFormat).toBe("markdown");
      // labels de-duplicated case-insensitively, first-seen casing kept.
      expect(created.labels).toEqual(["Work", "Ideas"]);

      const fetched = await storage.getNote(created.id);
      expect(fetched).toEqual(created);
    } finally {
      await storage.close();
    }
  });

  test("get is tenant-scoped", async () => {
    const storage = freshStorage();
    try {
      const a = await storage.createNote({ title: "A", tenantId: "t1" });
      expect(await storage.getNote(a.id, "t1")).toBeDefined();
      expect(await storage.getNote(a.id, "t2")).toBeUndefined();
      expect(await storage.getNote(a.id)).toBeUndefined(); // default tenant 'local'
    } finally {
      await storage.close();
    }
  });

  test("update patches only supplied fields and re-stamps updatedAt", async () => {
    const storage = freshStorage();
    try {
      const created = await storage.createNote({ title: "T", body: "B", createdAt: "2020-01-01T00:00:00.000Z" });
      const updated = await storage.updateNote(created.id, { body: "B2", status: "reviewed" });
      expect(updated?.title).toBe("T");
      expect(updated?.body).toBe("B2");
      expect(updated?.status).toBe("reviewed");
      expect(updated?.createdAt).toBe(created.createdAt);
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
      expect(await storage.updateNote("missing", { body: "x" })).toBeUndefined();
    } finally {
      await storage.close();
    }
  });

  test("delete removes the row and is tenant-scoped", async () => {
    const storage = freshStorage();
    try {
      const created = await storage.createNote({ title: "D" });
      expect(await storage.deleteNote(created.id, "other")).toBe(false);
      expect(await storage.deleteNote(created.id)).toBe(true);
      expect(await storage.getNote(created.id)).toBeUndefined();
    } finally {
      await storage.close();
    }
  });
});

describe("SqliteNoteStorage — list filters", () => {
  test("filters by status, folder, label, free-text; excludes trash by default; paginates", async () => {
    const storage = freshStorage();
    try {
      await storage.createNote({ title: "alpha meeting", folder: "work", labels: ["urgent"], status: "active" });
      await storage.createNote({ title: "beta groceries", folder: "home", labels: ["shopping"], status: "reviewed" });
      await storage.createNote({ title: "gamma old", status: "trash" });

      const all = await storage.listNotes();
      expect(all.total).toBe(2); // trash excluded
      expect(all.notes.every((n) => n.status !== "trash")).toBe(true);

      const byStatus = await storage.listNotes({ status: "reviewed" });
      expect(byStatus.notes.map((n) => n.title)).toEqual(["beta groceries"]);

      const byFolder = await storage.listNotes({ folder: "work" });
      expect(byFolder.notes.map((n) => n.title)).toEqual(["alpha meeting"]);

      const byLabel = await storage.listNotes({ label: "shopping" });
      expect(byLabel.notes.map((n) => n.title)).toEqual(["beta groceries"]);

      const byQuery = await storage.listNotes({ query: "meeting" });
      expect(byQuery.notes.map((n) => n.title)).toEqual(["alpha meeting"]);

      const trash = await storage.listNotes({ status: "trash" });
      expect(trash.total).toBe(1);

      const includeTrash = await storage.listNotes({ includeTrashed: true });
      expect(includeTrash.total).toBe(3);

      const page = await storage.listNotes({ includeTrashed: true, limit: 2, offset: 0 });
      expect(page.notes.length).toBe(2);
      expect(page.hasMore).toBe(true);
      expect(await storage.countNotes({ includeTrashed: true })).toBe(3);
    } finally {
      await storage.close();
    }
  });

  test("free-text search treats LIKE wildcards literally", async () => {
    const storage = freshStorage();
    try {
      await storage.createNote({ title: "100% done" });
      await storage.createNote({ title: "nothing here" });
      const hits = await storage.listNotes({ query: "100%" });
      expect(hits.notes.map((n) => n.title)).toEqual(["100% done"]);
    } finally {
      await storage.close();
    }
  });
});

describe("SqliteNoteStorage — labels & settings", () => {
  test("labels upsert / list / remove", async () => {
    const storage = freshStorage();
    try {
      await storage.putLabel("work", "#f00");
      const updated = await storage.putLabel("work", "#0f0");
      expect(updated.color).toBe("#0f0");
      expect((await storage.listLabels()).map((l) => l.name)).toEqual(["work"]);
      expect(await storage.removeLabel("work")).toBe(true);
      expect(await storage.removeLabel("work")).toBe(false);
      expect(await storage.listLabels()).toEqual([]);
    } finally {
      await storage.close();
    }
  });

  test("settings upsert / get / list", async () => {
    const storage = freshStorage();
    try {
      await storage.setSetting("theme", "dark");
      const got = await storage.getSetting("theme");
      expect(got?.value).toBe("dark");
      await storage.setSetting("theme", "light");
      expect((await storage.getSetting("theme"))?.value).toBe("light");
      expect((await storage.listSettings()).length).toBe(1);
      expect(await storage.getSetting("missing")).toBeUndefined();
    } finally {
      await storage.close();
    }
  });
});
