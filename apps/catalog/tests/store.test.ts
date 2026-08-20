import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "../src/contracts.js";
import { CatalogStore } from "../src/store.js";

function makeApp(appId: string, overrides: Partial<App> = {}): App {
  return {
    schema: "hasna.app.v1",
    id: `app_${appId.replaceAll("-", "_")}`,
    createdAt: "2026-07-06T08:00:00.000Z",
    appId,
    npmName: `@example/${appId.replace(/^open-/, "")}`,
    repoFolder: appId,
    githubUrl: `https://github.com/example/${appId}`,
    projectSlug: appId,
    surfaces: { bins: [] },
    lifecycle: "active",
    releaseChannel: "stable",
    tags: ["oss"],
    ...overrides,
  } as App;
}

describe("CatalogStore", () => {
  it("upserts and gets apps", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    expect(store.upsertApps([makeApp("open-alpha"), makeApp("open-beta")])).toBe(2);
    expect(store.countApps()).toBe(2);
    const app = store.getApp("open-alpha");
    expect(app?.npmName).toBe("@example/alpha");
    expect(store.getApp("missing")).toBeNull();
  });

  it("upsert replaces existing records by appId", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps([makeApp("open-alpha")]);
    store.upsertApps([makeApp("open-alpha", { summary: "Updated summary" })]);
    expect(store.countApps()).toBe(1);
    expect(store.getApp("open-alpha")?.summary).toBe("Updated summary");
  });

  it("lists with lifecycle and channel filters", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps([
      makeApp("open-alpha"),
      makeApp("open-old", { lifecycle: "deprecated" }),
      makeApp("open-beta", { releaseChannel: "beta" }),
    ]);
    expect(store.listApps().length).toBe(3);
    expect(store.listApps({ lifecycle: "deprecated" }).map((a) => a.appId)).toEqual(["open-old"]);
    expect(store.listApps({ channel: "beta" }).map((a) => a.appId)).toEqual(["open-beta"]);
    expect(store.listApps({ limit: 1 }).length).toBe(1);
  });

  it("searches across id, npm name, summary, and tags", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps([
      makeApp("open-beta", { summary: "Uptime monitoring service" }),
      makeApp("open-alpha", { tags: ["oss", "tasks"] }),
    ]);
    expect(store.searchApps("monitoring").map((a) => a.appId)).toEqual(["open-beta"]);
    expect(store.searchApps("tasks").map((a) => a.appId)).toEqual(["open-alpha"]);
    expect(store.searchApps("@example/beta").map((a) => a.appId)).toEqual(["open-beta"]);
    expect(store.searchApps("nothing-here").length).toBe(0);
  });

  it("rejects invalid documents on upsert", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    expect(() => store.upsertApps([{ ...makeApp("open-alpha"), appId: "Bad Slug" } as App])).toThrow();
    expect(store.countApps()).toBe(0);
  });

  it("imports JSONL fixtures", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    const jsonl = [makeApp("open-a"), makeApp("open-b")].map((app) => JSON.stringify(app)).join("\n");
    expect(store.importJsonl(`${jsonl}\n`)).toBe(2);
    expect(store.countApps()).toBe(2);
  });

  it("rolls back the whole batch when any document in it is invalid", () => {
    // A naive implementation writes the valid prefix and then throws, leaving a
    // partial seed. The write must be all-or-nothing: a batch with one bad doc
    // leaves the store exactly as it was.
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps([makeApp("open-existing")]);
    expect(() =>
      store.upsertApps([makeApp("open-valid"), { ...makeApp("open-bad"), appId: "Bad Slug" } as App])
    ).toThrow();
    expect(store.countApps()).toBe(1);
    expect(store.getApp("open-valid")).toBeNull();
  });

  it("clamps limit to 1..1000 and offset to >= 0", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps(["open-a", "open-b", "open-c", "open-d"].map((id) => makeApp(id)));
    // limit 0 and negative limits must not return nothing or throw — they clamp to 1.
    expect(store.listApps({ limit: 0 }).map((a) => a.appId)).toEqual(["open-a"]);
    expect(store.listApps({ limit: -5 }).map((a) => a.appId)).toEqual(["open-a"]);
    // A limit above the cap is clamped, not passed to SQLite.
    expect(store.listApps({ limit: 99999 }).length).toBe(4);
    // Negative offsets start at the beginning.
    expect(store.listApps({ offset: -3 }).length).toBe(4);
    expect(store.listApps({ limit: 2, offset: 1 }).map((a) => a.appId)).toEqual(["open-b", "open-c"]);
  });

  it("strips LIKE wildcards from search queries so they cannot broaden a match", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps([
      makeApp("open-axb", { summary: "axb" }),
      makeApp("open-a-b", { summary: "a_b" }),
    ]);
    // Without the strip, LIKE "%a_b%" would match BOTH rows — "a_b" literally
    // and "axb" via the any-single-char wildcard. The strip must make the
    // injected query match neither: the query is literal, and the underscore
    // char it wanted is gone.
    expect(store.searchApps("a_b").map((a) => a.appId)).toEqual([]);
    // Literal queries still work normally.
    expect(store.searchApps("axb").map((a) => a.appId)).toEqual(["open-axb"]);
    // "%" alone collapses to an empty needle ("%%"), which matches every row —
    // pinned so the sanitization's boundary is deliberate, not assumed.
    expect(store.searchApps("%").length).toBe(2);
  });

  it("clamps search limit to 1..500", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps(["open-1", "open-2", "open-3", "open-4", "open-5"].map((id) => makeApp(id)));
    expect(store.searchApps("open", { limit: 0 }).length).toBe(1);
    expect(store.searchApps("open", { limit: 99999 }).length).toBe(5);
  });

  it("rejects a malformed JSONL line without importing the valid prefix", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    expect(() => store.importJsonl(`${JSON.stringify(makeApp("open-a"))}\nnot-json\n`)).toThrow();
    expect(store.countApps()).toBe(0);
  });

  it("persists to a file-backed database across reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-store-"));
    try {
      const dbPath = join(dir, "catalog.db");
      const first = new CatalogStore({ dbPath });
      first.upsertApps([makeApp("open-alpha")]);
      first.close();
      const second = new CatalogStore({ dbPath });
      expect(second.countApps()).toBe(1);
      expect(second.getApp("open-alpha")?.npmName).toBe("@example/alpha");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defines same-batch duplicate-key semantics: later record wins, count is rows written", () => {
    // The write path is `INSERT ... ON CONFLICT(app_id) DO UPDATE` executed per
    // input row in one transaction, so a batch may carry two records for one
    // appId. Pin the full contract: the return value counts INPUT rows, the
    // store holds one row per key, the LAST record in the batch wins, and
    // optional fields from the earlier record do not survive into the winner.
    const store = new CatalogStore({ dbPath: ":memory:" });
    const v1 = makeApp("open-alpha", { summary: "first" });
    const v2 = makeApp("open-alpha", { tags: ["updated"] });
    expect(store.upsertApps([v1, makeApp("open-beta"), v2])).toBe(3);
    expect(store.countApps()).toBe(2);
    expect(store.listApps().map((a) => a.appId)).toEqual(["open-alpha", "open-beta"]);
    const winner = store.getApp("open-alpha");
    expect(winner?.tags).toEqual(["updated"]);
    expect(winner?.summary).toBeUndefined();
    // Replaying the identical batch changes nothing observable.
    expect(store.upsertApps([v1, makeApp("open-beta"), v2])).toBe(3);
    expect(store.countApps()).toBe(2);
    expect(store.getApp("open-alpha")?.tags).toEqual(["updated"]);
    // The same semantics hold through importJsonl with duplicate lines.
    const store2 = new CatalogStore({ dbPath: ":memory:" });
    expect(store2.importJsonl([v1, v2].map((app) => JSON.stringify(app)).join("\n"))).toBe(2);
    expect(store2.countApps()).toBe(1);
    expect(store2.getApp("open-alpha")?.tags).toEqual(["updated"]);
    // An invalid row in the same batch rolls the whole batch back.
    const store3 = new CatalogStore({ dbPath: ":memory:" });
    expect(() =>
      store3.upsertApps([v1, v2, { ...makeApp("open-bad"), appId: "Bad Slug" } as App])
    ).toThrow();
    expect(store3.countApps()).toBe(0);
  });

  it("enforces the real list cap of 1000 and search cap of 500", () => {
    // A cap test with four fixtures cannot distinguish a cap of 4, 10, 500, or
    // 1000. Fill past both caps with zero-padded ids so the boundary is exact.
    const store = new CatalogStore({ dbPath: ":memory:" });
    const ids = Array.from({ length: 1002 }, (_, i) => `open-${String(i).padStart(4, "0")}`);
    store.upsertApps(ids.map((id) => makeApp(id)));
    expect(store.countApps()).toBe(1002);
    const listed = store.listApps({ limit: 99999 });
    expect(listed.length).toBe(1000);
    expect(listed[0]?.appId).toBe("open-0000");
    expect(listed[999]?.appId).toBe("open-0999");
    // Exact-cap positive control: 1000 rows are all returned.
    expect(store.listApps({ limit: 1000 }).length).toBe(1000);
    // Search matches every row; the cap must stop at 500.
    const searched = store.searchApps("open", { limit: 99999 });
    expect(searched.length).toBe(500);
    expect(store.searchApps("open", { limit: 500 }).length).toBe(500);
  });
});
