import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFeedbackHandler } from "./api.js";
import { FeedbackStoreBusyError, activeMutationChainCount } from "./storage.base.js";
import { SqliteFeedbackStore, resolveFeedbackMigrationSource } from "./storage.sqlite.js";
import type { FeedbackItem } from "./types.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-feedback-conc-"));
}

function quietStore(options: { dataDir?: string; sqlitePath?: string } = {}): SqliteFeedbackStore {
  return new SqliteFeedbackStore({ ...options, eventSink: null, taskSink: null, notify: false });
}

/**
 * Hold a write transaction on `databasePath` from a SEPARATE process.
 *
 * A second connection in THIS process cannot stand in: the point is to block
 * the database without blocking our own event loop, which is exactly what an
 * in-process holder would do.
 */
async function holdWriteLock(databasePath: string, ms: number): Promise<{ release: () => void }> {
  const script = `
    import { Database } from "bun:sqlite";
    const db = new Database(${JSON.stringify(databasePath)}, { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA busy_timeout = 100");
    db.run("BEGIN IMMEDIATE");
    db.run("INSERT INTO feedback_meta (key, value) VALUES ('lock-probe','1') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    console.log("HOLDING");
    await new Promise((r) => setTimeout(r, ${ms}));
    db.run("ROLLBACK");
  `;
  const dir = await tempDir();
  const file = join(dir, "holder.ts");
  await writeFile(file, script);
  const proc = Bun.spawn(["bun", "run", file], { stdout: "pipe" });
  await proc.stdout.getReader().read(); // block until the child says HOLDING
  return { release: () => proc.kill() };
}

describe("SqliteFeedbackStore concurrency", () => {
  // P1-1. Before the path-keyed mutation chain, this measured
  // `fulfilled=2 rejected=2` in ~10s: `mutate` holds BEGIN IMMEDIATE across an
  // await, bun:sqlite is synchronous, so a second CONNECTION's BEGIN froze the
  // one event loop the first connection's COMMIT needed.
  test("two stores on one database do not deadlock each other", async () => {
    const dataDir = await tempDir();
    const a = quietStore({ dataDir });
    const b = quietStore({ dataDir });
    try {
      const ia = await a.createFeedback({ appId: "app", message: "a" });
      const ib = await b.createFeedback({ appId: "app", message: "b" });

      const started = Date.now();
      const settled = await Promise.allSettled([
        a.updateFeedbackStatus(ia.id, "triaged"),
        b.updateFeedbackStatus(ib.id, "triaged"),
        a.updateFeedbackStatus(ia.id, "closed"),
        b.updateFeedbackStatus(ib.id, "closed"),
      ]);

      expect(settled.filter((r) => r.status === "rejected")).toHaveLength(0);
      // The failure took a full busy_timeout per blocked write. Anything near
      // that is the deadlock returning, so assert well under one timeout.
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(await a.getFeedback(ia.id)).toMatchObject({ status: "closed" });
      expect(await b.getFeedback(ib.id)).toMatchObject({ status: "closed" });
    } finally {
      a.close();
      b.close();
    }
  });

  test("a create on one store cannot stall a mutate on another", async () => {
    const dataDir = await tempDir();
    const a = quietStore({ dataDir });
    const b = quietStore({ dataDir });
    try {
      const seeded = await a.createFeedback({ appId: "app", message: "seed" });
      const started = Date.now();
      const settled = await Promise.allSettled([
        a.updateFeedbackStatus(seeded.id, "triaged"),
        b.createFeedback({ appId: "app", message: "concurrent create" }),
      ]);
      expect(settled.filter((r) => r.status === "rejected")).toHaveLength(0);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(await b.readAll()).toHaveLength(2);
    } finally {
      a.close();
      b.close();
    }
  });

  // The guarantee the per-instance chain already provided, restated so the
  // cross-instance rework cannot quietly drop it.
  test("concurrent read-modify-writes on one store lose no updates", async () => {
    const store = quietStore({ dataDir: await tempDir() });
    try {
      const ids: string[] = [];
      for (let index = 0; index < 15; index += 1) {
        ids.push((await store.createFeedback({ appId: "app", message: `m${index}` })).id);
      }
      await Promise.all(ids.map((id) => store.updateFeedbackStatus(id, "triaged")));
      const all = await store.readAll();
      expect(all.filter((item: FeedbackItem) => item.status === "triaged")).toHaveLength(15);
    } finally {
      store.close();
    }
  });

  test("two stores on DIFFERENT databases still run independently", async () => {
    const a = quietStore({ dataDir: await tempDir() });
    const b = quietStore({ dataDir: await tempDir() });
    try {
      const [ia, ib] = await Promise.all([
        a.createFeedback({ appId: "app", message: "a" }),
        b.createFeedback({ appId: "app", message: "b" }),
      ]);
      await Promise.all([a.updateFeedbackStatus(ia.id, "triaged"), b.updateFeedbackStatus(ib.id, "triaged")]);
      expect(await a.readAll()).toHaveLength(1);
      expect(await b.readAll()).toHaveLength(1);
    } finally {
      a.close();
      b.close();
    }
  });

  test("mutation chains are released once idle", async () => {
    const store = quietStore({ dataDir: await tempDir() });
    try {
      const item = await store.createFeedback({ appId: "app", message: "x" });
      await store.updateFeedbackStatus(item.id, "triaged");
      // Let the settle callback that clears the entry run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(activeMutationChainCount()).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe("SqliteFeedbackStore contention reporting", () => {
  // P1-2. `grep -c FeedbackStoreBusyError` was 0 in storage.sqlite.ts and 3 in
  // storage.ts, so the SQLite store reported contention as an untyped throw and
  // api.ts fell through to a 400 — telling the client not to retry a condition
  // whose only correct response is to retry.
  test("a locked database raises the typed, retryable busy error", async () => {
    const store = quietStore({ dataDir: await tempDir() });
    const seeded = await store.createFeedback({ appId: "app", message: "hello" });

    // Positive control: unlocked, this exact call succeeds. Without it a
    // failure below could mean the request was simply wrong.
    expect(await store.updateFeedbackStatus(seeded.id, "triaged")).toMatchObject({ status: "triaged" });

    const lock = await holdWriteLock(store.databasePath, 20_000);
    try {
      await expect(store.updateFeedbackStatus(seeded.id, "closed")).rejects.toBeInstanceOf(
        FeedbackStoreBusyError,
      );
    } finally {
      lock.release();
      store.close();
    }
  }, 30_000);

  test("the API reports contention as 503, and a bad request still as 400", async () => {
    const store = quietStore({ dataDir: await tempDir() });
    const handler = createFeedbackHandler({ store });
    const seeded = await store.createFeedback({ appId: "app", message: "hello" });

    const patch = (status: string) =>
      handler(
        new Request(`http://localhost/v1/feedback/${seeded.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      );

    // Positive control on the probe: the same request succeeds when free.
    expect((await patch("triaged")).status).toBe(200);

    const lock = await holdWriteLock(store.databasePath, 20_000);
    try {
      const busy = await patch("closed");
      expect(busy.status).toBe(503);
      expect(busy.headers.get("retry-after")).toBe("1");

      // Negative control: contention must not swallow real client errors.
      expect((await patch("not-a-status")).status).toBe(400);
    } finally {
      lock.release();
      store.close();
    }
  }, 30_000);
});

describe("SqliteFeedbackStore migration source", () => {
  // P1-3. The source was resolved beside the DATABASE, so a custom
  // HASNA_FEEDBACK_SQLITE_PATH reported `no-source` — indistinguishable from a
  // user who never had any feedback.
  const legacy = [
    { id: "l1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", appId: "app", message: "one", status: "new", source: "server", kind: "other", tags: [] },
    { id: "l2", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", appId: "app", message: "two", status: "new", source: "server", kind: "other", tags: [] },
    { id: "l3", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", appId: "app", message: "three", status: "new", source: "server", kind: "other", tags: [] },
  ];

  async function seedLegacy(dataDir: string): Promise<void> {
    await writeFile(join(dataDir, "feedback.jsonl"), legacy.map((item) => JSON.stringify(item)).join("\n") + "\n");
  }

  test("imports the data dir's log even when the database lives elsewhere", async () => {
    const dataDir = await tempDir();
    const databaseDir = await tempDir();
    await seedLegacy(dataDir);

    const store = quietStore({ dataDir, sqlitePath: join(databaseDir, "custom.db") });
    try {
      expect(store.migration).toMatchObject({ ran: true, migrated: 3 });
      expect(await store.readAll()).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  test("still imports a log sitting beside the database", async () => {
    const dataDir = await tempDir();
    const databaseDir = await tempDir();
    await seedLegacy(databaseDir); // only beside the db, not in the data dir

    const store = quietStore({ dataDir, sqlitePath: join(databaseDir, "custom.db") });
    try {
      expect(store.migration).toMatchObject({ ran: true, migrated: 3 });
    } finally {
      store.close();
    }
  });

  test("reports no-source only when there genuinely is none", async () => {
    const store = quietStore({ dataDir: await tempDir(), sqlitePath: join(await tempDir(), "custom.db") });
    try {
      expect(store.migration).toMatchObject({ ran: false, migrated: 0, reason: "no-source" });
    } finally {
      store.close();
    }
  });

  test("prefers the data dir when both locations hold a log", async () => {
    const dataDir = await tempDir();
    const databaseDir = await tempDir();
    await seedLegacy(dataDir);
    await writeFile(join(databaseDir, "feedback.jsonl"), "");
    expect(resolveFeedbackMigrationSource({ dataDir, databasePath: join(databaseDir, "custom.db") })).toBe(
      join(dataDir, "feedback.jsonl"),
    );
  });

  test("announces a migration once, on the open that performed it", async () => {
    const dataDir = await tempDir();
    await seedLegacy(dataDir);
    const notices: string[] = [];

    const first = new SqliteFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: null,
      notify: (message) => notices.push(message),
    });
    first.close();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Imported 3 item(s)");

    // A reopen has nothing to import, so it must stay quiet.
    const second = new SqliteFeedbackStore({
      dataDir,
      eventSink: null,
      taskSink: null,
      notify: (message) => notices.push(message),
    });
    second.close();
    expect(notices).toHaveLength(1);
  });
});
