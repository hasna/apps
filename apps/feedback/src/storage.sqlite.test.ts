import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalFeedbackStore, createFeedbackStore, describeFeedbackStoreRuntime } from "./storage.js";
import { SqliteFeedbackStore, migrateJsonlIntoSqlite, resolveFeedbackSqlitePath } from "./storage.sqlite.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-feedback-sqlite-"));
}

async function tempStore(): Promise<SqliteFeedbackStore> {
  return new SqliteFeedbackStore({ dataDir: await tempDir() });
}

describe("SqliteFeedbackStore", () => {
  test("creates, lists, reads, updates, and counts feedback", async () => {
    const store = await tempStore();
    const first = await store.createFeedback({
      appId: "app-a",
      message: "first",
      kind: "bug",
      severity: "high",
      tags: ["Bug"],
    });
    await store.createFeedback({ appId: "app-b", message: "second", kind: "idea" });

    expect(await store.getFeedback(first.id)).toMatchObject({ message: "first" });
    expect(await store.getFeedback("missing-id")).toBeNull();
    expect(await store.listFeedback({ appId: "app-a" })).toHaveLength(1);
    expect(await store.updateFeedbackStatus(first.id, "triaged")).toMatchObject({ status: "triaged" });
    expect(await store.updateFeedbackStatus("missing-id", "triaged")).toBeNull();

    const stats = await store.stats();
    expect(stats.total).toBe(2);
    expect(stats.byApp["app-a"]).toBe(1);
    expect(stats.byKind.bug).toBe(1);
    expect(stats.byStatus.triaged).toBe(1);
    expect(stats.bySeverity.high).toBe(1);
  });

  test("applies the same list semantics as the JSONL store", async () => {
    const dataDir = await tempDir();
    const sqlite = new SqliteFeedbackStore({ dataDir });
    const jsonl = new LocalFeedbackStore({ dataDir: await tempDir() });

    for (const store of [sqlite, jsonl]) {
      await store.createFeedback(
        { appId: "app-a", message: "billing export needs CSV", tags: ["reports"], context: { route: "/billing" } },
        { now: new Date("2026-01-01T00:00:00.000Z") },
      );
      await store.createFeedback(
        { appId: "app-a", message: "profile avatar upload fails", tags: ["account"] },
        { now: new Date("2026-02-01T00:00:00.000Z") },
      );
    }

    const strip = (items: { message: string }[]) => items.map((item) => item.message);
    for (const filter of [
      { since: "2026-01-15", search: "avatar" },
      { search: "/billing" },
      { tag: "reports" },
      { limit: 1 },
      {},
    ]) {
      expect(strip(await sqlite.listFeedback(filter))).toEqual(strip(await jsonl.listFeedback(filter)));
    }
  });

  test("markFeedbackShipped records the changelog ref", async () => {
    const store = await tempStore();
    const item = await store.createFeedback({ appId: "app-a", message: "ship me" });
    const shipped = await store.markFeedbackShipped(item.id, "CHANGELOG#1.2.0");
    expect(shipped).toMatchObject({ status: "shipped", changelogRef: "CHANGELOG#1.2.0" });
    expect(shipped?.shippedAt).toBeTruthy();
    expect(await store.markFeedbackShipped("missing-id", "CHANGELOG#1.2.0")).toBeNull();
  });

  test("exportJsonl produces the same wire format as the JSONL store", async () => {
    const sqlite = new SqliteFeedbackStore({ dataDir: await tempDir() });
    const jsonl = new LocalFeedbackStore({ dataDir: await tempDir() });
    const now = new Date("2026-03-01T00:00:00.000Z");
    for (const store of [sqlite, jsonl]) {
      await store.createFeedback({ appId: "app-a", message: "exported", kind: "bug", tags: ["x"] }, { now });
    }

    const normalise = (text: string) =>
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          delete parsed["id"];
          return JSON.stringify(Object.fromEntries(Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b))));
        });

    expect(normalise(await sqlite.exportJsonl())).toEqual(normalise(await jsonl.exportJsonl()));
    expect(await sqlite.exportJsonl()).toEndWith("\n");
  });

  test("exportJsonl on an empty store returns an empty string, not a bare newline", async () => {
    const store = await tempStore();
    expect(await store.exportJsonl()).toBe("");
  });
});

describe("migrateJsonlIntoSqlite", () => {
  test("imports a non-empty pre-existing feedback.jsonl, preserving folded state", async () => {
    const dataDir = await tempDir();
    const seed = new LocalFeedbackStore({ dataDir });
    const bug = await seed.createFeedback({ appId: "app-a", message: "pre-existing bug", kind: "bug" });
    await seed.createFeedback({ appId: "app-b", message: "pre-existing idea", kind: "idea" });
    // A status change lands as a rewrite; task linkage lands as an append-only
    // patch. Both must survive the fold, or the migration silently reverts them.
    await seed.updateFeedbackStatus(bug.id, "triaged");
    const jsonlPath = join(dataDir, "feedback.jsonl");
    expect(existsSync(jsonlPath)).toBe(true);

    const store = new SqliteFeedbackStore({ dataDir });
    expect(store.migration).toMatchObject({ ran: true, migrated: 2, alreadyPresent: 0 });

    const items = await store.listFeedback({});
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.message).sort()).toEqual(["pre-existing bug", "pre-existing idea"]);
    expect(await store.getFeedback(bug.id)).toMatchObject({ status: "triaged", message: "pre-existing bug" });

    // Non-destructive: the source file is still on disk and still readable.
    expect(existsSync(jsonlPath)).toBe(true);
    expect(await new LocalFeedbackStore({ dataDir }).listFeedback({})).toHaveLength(2);
  });

  test("is a clean no-op when there is nothing to migrate", async () => {
    const dataDir = await tempDir();
    expect(existsSync(join(dataDir, "feedback.jsonl"))).toBe(false);

    const store = new SqliteFeedbackStore({ dataDir });
    expect(store.migration).toMatchObject({ ran: false, migrated: 0, reason: "no-source" });
    expect(await store.listFeedback({})).toHaveLength(0);
    expect(await store.stats()).toMatchObject({ total: 0 });
  });

  test("treats an empty feedback.jsonl as nothing to migrate", async () => {
    const dataDir = await tempDir();
    await writeFile(join(dataDir, "feedback.jsonl"), "", "utf8");
    const store = new SqliteFeedbackStore({ dataDir });
    expect(store.migration).toMatchObject({ ran: false, migrated: 0, reason: "empty-source" });
  });

  test("is idempotent — a second construction does not re-import or duplicate", async () => {
    const dataDir = await tempDir();
    const seed = new LocalFeedbackStore({ dataDir });
    await seed.createFeedback({ appId: "app-a", message: "only once" });

    const first = new SqliteFeedbackStore({ dataDir });
    expect(first.migration).toMatchObject({ ran: true, migrated: 1 });
    first.close();

    const second = new SqliteFeedbackStore({ dataDir });
    expect(second.migration).toMatchObject({ ran: false, migrated: 0, reason: "already-migrated" });
    expect(await second.listFeedback({})).toHaveLength(1);
  });

  test("re-importing over rows that already exist counts them rather than duplicating", async () => {
    const dataDir = await tempDir();
    const seed = new LocalFeedbackStore({ dataDir });
    await seed.createFeedback({ appId: "app-a", message: "already there" });

    const store = new SqliteFeedbackStore({ dataDir });
    expect(store.migration).toMatchObject({ migrated: 1, alreadyPresent: 0 });

    // Force a second pass over the same source, bypassing the marker.
    const again = migrateJsonlIntoSqlite(store, join(dataDir, "feedback.jsonl"), { force: true });
    expect(again).toMatchObject({ ran: true, migrated: 0, alreadyPresent: 1 });
    expect(await store.listFeedback({})).toHaveLength(1);
  });

  test("does not migrate when the store points somewhere other than the jsonl's directory", async () => {
    const sourceDir = await tempDir();
    const seed = new LocalFeedbackStore({ dataDir: sourceDir });
    await seed.createFeedback({ appId: "app-a", message: "elsewhere" });

    const store = new SqliteFeedbackStore({ dataDir: await tempDir() });
    expect(store.migration).toMatchObject({ ran: false, reason: "no-source" });
    expect(await store.listFeedback({})).toHaveLength(0);
  });
});

describe("storage runtime selection", () => {
  test("sqlite is the default engine when nothing is configured", async () => {
    const dataDir = await tempDir();
    const diagnostics = describeFeedbackStoreRuntime({ env: { FEEDBACK_DATA_DIR: dataDir } });
    expect(diagnostics).toMatchObject({
      mode: "local",
      engine: "sqlite",
      activeStore: "local-sqlite",
      ok: true,
    });
    expect(diagnostics.local?.dataFile).toBe(join(dataDir, "feedback.db"));
    expect(createFeedbackStore({ env: { FEEDBACK_DATA_DIR: dataDir } })).toBeInstanceOf(SqliteFeedbackStore);
  });

  test("an explicit legacy jsonl selection still resolves to the JSONL store", async () => {
    const dataDir = await tempDir();
    for (const value of ["jsonl", "file", "local"]) {
      const env = { FEEDBACK_DATA_DIR: dataDir, FEEDBACK_STORE: value };
      expect(describeFeedbackStoreRuntime({ env })).toMatchObject({
        mode: "local",
        engine: "jsonl",
        activeStore: "local-jsonl",
        ok: true,
      });
      expect(createFeedbackStore({ env })).toBeInstanceOf(LocalFeedbackStore);
    }
  });

  test("an explicit sqlite selection resolves to the SQLite store", async () => {
    const dataDir = await tempDir();
    const env = { FEEDBACK_DATA_DIR: dataDir, FEEDBACK_STORE: "sqlite" };
    expect(describeFeedbackStoreRuntime({ env })).toMatchObject({ engine: "sqlite", activeStore: "local-sqlite" });
    expect(createFeedbackStore({ env })).toBeInstanceOf(SqliteFeedbackStore);
  });

  test("HASNA_FEEDBACK_ env vars take precedence over the legacy FEEDBACK_ ones", async () => {
    const legacyDir = await tempDir();
    const prefixedDir = await tempDir();
    const diagnostics = describeFeedbackStoreRuntime({
      env: {
        FEEDBACK_DATA_DIR: legacyDir,
        HASNA_FEEDBACK_DATA_DIR: prefixedDir,
        FEEDBACK_STORE: "jsonl",
        HASNA_FEEDBACK_STORE: "sqlite",
      },
    });
    expect(diagnostics).toMatchObject({ engine: "sqlite" });
    expect(diagnostics.local?.dataFile).toBe(join(prefixedDir, "feedback.db"));
  });

  test("an explicit sqlite path overrides the derived one", async () => {
    const dataDir = await tempDir();
    const custom = join(dataDir, "nested", "custom.db");
    expect(resolveFeedbackSqlitePath({ sqlitePath: custom })).toBe(custom);
    // `dataDir` is pinned to this test's temp directory, not left to default.
    // The automatic import reads the DATA DIR's `feedback.jsonl`, so a store
    // built with only `sqlitePath` inherits the real `~/.hasna/feedback` log —
    // which is correct behaviour (someone relocating just the database still
    // wants their existing feedback) and makes this assertion depend on the
    // machine it runs on.
    const store = new SqliteFeedbackStore({ dataDir, sqlitePath: custom });
    await store.createFeedback({ appId: "app-a", message: "custom path" });
    expect(existsSync(custom)).toBe(true);
    expect(await store.listFeedback({})).toHaveLength(1);
  });

  test("an unsupported engine value is reported rather than silently defaulted", async () => {
    const diagnostics = describeFeedbackStoreRuntime({
      env: { FEEDBACK_STORE: "postgres://user:secret-value@example.test/feedback" },
    });
    expect(diagnostics).toMatchObject({ mode: "invalid", activeStore: "unavailable", ok: false });
    expect(diagnostics.blockers.join(" ")).toContain("Unsupported FEEDBACK_STORE");
    expect(JSON.stringify(diagnostics)).not.toContain("secret-value");
  });
});

describe("SqliteFeedbackStore durability", () => {
  test("data written by one instance is visible to the next", async () => {
    const dataDir = await tempDir();
    const first = new SqliteFeedbackStore({ dataDir });
    const item = await first.createFeedback({ appId: "app-a", message: "persisted" });
    await first.updateFeedbackStatus(item.id, "triaged");
    first.close();

    const second = new SqliteFeedbackStore({ dataDir });
    expect(await second.getFeedback(item.id)).toMatchObject({ status: "triaged", message: "persisted" });
  });

  test("the database file is created under the resolved data dir", async () => {
    const dataDir = await tempDir();
    const store = new SqliteFeedbackStore({ dataDir });
    await store.createFeedback({ appId: "app-a", message: "on disk" });
    expect(existsSync(join(dataDir, "feedback.db"))).toBe(true);
    // The JSONL file is not created as a side effect of using SQLite.
    expect(existsSync(join(dataDir, "feedback.jsonl"))).toBe(false);
  });

  test("serializes concurrent status updates", async () => {
    // Regression guard. A cross-process guard (BEGIN IMMEDIATE, a lock file)
    // does not order two awaits issued from this same process, so a
    // read-modify-write can interleave and silently drop one update.
    const store = await tempStore();
    const first = await store.createFeedback({ appId: "app-a", message: "first" });
    const second = await store.createFeedback({ appId: "app-a", message: "second" });

    await Promise.all([
      store.updateFeedbackStatus(first.id, "triaged"),
      store.updateFeedbackStatus(second.id, "closed"),
    ]);

    expect(await store.getFeedback(first.id)).toMatchObject({ status: "triaged" });
    expect(await store.getFeedback(second.id)).toMatchObject({ status: "closed" });
  });

  test("concurrent creates are all durably recorded", async () => {
    const store = await tempStore();
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        store.createFeedback({ appId: "app-a", message: `concurrent ${index}` }),
      ),
    );
    expect(await store.listFeedback({ limit: 500 })).toHaveLength(25);
  });

  test("stored rows round-trip through the shared stored-item validator", async () => {
    const dataDir = await tempDir();
    const store = new SqliteFeedbackStore({ dataDir });
    await store.createFeedback({
      appId: "app-a",
      message: "rich item",
      kind: "bug",
      severity: "critical",
      rating: 5,
      tags: ["a", "b"],
      metadata: { plan: "pro" },
      context: { route: "/x", sessionId: "s-1", commit: "abc123" },
    });
    store.close();

    const reopened = new SqliteFeedbackStore({ dataDir });
    const [item] = await reopened.listFeedback({});
    expect(item).toMatchObject({
      severity: "critical",
      rating: 5,
      tags: ["a", "b"],
      metadata: { plan: "pro" },
      context: { route: "/x", sessionId: "s-1", commit: "abc123" },
    });
  });
});

describe("task linkage on the SQLite store", () => {
  test("records a task ref and reports it through syncTasks", async () => {
    const store = new SqliteFeedbackStore({
      dataDir: await tempDir(),
      taskSink: {
        provider: "stub",
        createTask: async () => ({ provider: "stub", taskId: "T-1", createdAt: new Date().toISOString() }),
      },
    });
    const item = await store.createFeedback({ appId: "app-a", message: "needs a task" });
    expect(item.taskRef).toMatchObject({ provider: "stub", taskId: "T-1" });
    expect(await store.getFeedback(item.id)).toMatchObject({ taskRef: { taskId: "T-1" } });

    const result = await store.syncTasks();
    expect(result).toMatchObject({ sinkConfigured: true, created: 0, skipped: 1 });
  });

  test("a failing task sink is recorded, not swallowed, and the feedback survives", async () => {
    const store = new SqliteFeedbackStore({
      dataDir: await tempDir(),
      taskSink: {
        provider: "stub",
        createTask: async () => {
          throw new Error("sink is down");
        },
      },
    });
    const item = await store.createFeedback({ appId: "app-a", message: "sink down" });
    expect(item.taskError).toContain("sink is down");
    expect(await store.getFeedback(item.id)).toMatchObject({ message: "sink down" });

    const result = await store.syncTasks();
    expect(result).toMatchObject({ sinkConfigured: true, failed: 1 });
  });

  test("syncTasks reports no sink configured rather than pretending there was nothing to do", async () => {
    const store = new SqliteFeedbackStore({ dataDir: await tempDir(), taskSink: null });
    await store.createFeedback({ appId: "app-a", message: "no sink" });
    expect(await store.syncTasks()).toMatchObject({ sinkConfigured: false, created: 0 });
  });
});

describe("migration source reading", () => {
  test("a malformed line in the source file fails loudly rather than dropping records", async () => {
    const dataDir = await tempDir();
    await writeFile(join(dataDir, "feedback.jsonl"), "{not json}\n", "utf8");
    expect(() => new SqliteFeedbackStore({ dataDir })).toThrow();
  });

  test("the migrated payload is byte-identical to what the JSONL store would export", async () => {
    const dataDir = await tempDir();
    const seed = new LocalFeedbackStore({ dataDir });
    await seed.createFeedback({ appId: "app-a", message: "one", kind: "bug" });
    await seed.createFeedback({ appId: "app-b", message: "two", kind: "idea" });
    const before = await seed.exportJsonl();

    const store = new SqliteFeedbackStore({ dataDir });
    expect(await store.exportJsonl()).toBe(before);
    // And the untouched source still holds the original bytes.
    expect(await readFile(join(dataDir, "feedback.jsonl"), "utf8")).toContain("one");
  });
});
