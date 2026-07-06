import { describe, expect, it } from "bun:test";
import type { App } from "../src/contracts.js";
import { CatalogStore } from "../src/store.js";

function makeApp(appId: string, overrides: Partial<App> = {}): App {
  return {
    schema: "hasna.app.v1",
    id: `app_${appId.replaceAll("-", "_")}`,
    createdAt: "2026-07-06T08:00:00.000Z",
    appId,
    npmName: `@hasna/${appId.replace(/^open-/, "")}`,
    repoFolder: appId,
    githubUrl: `https://github.com/hasna/${appId}`,
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
    expect(store.upsertApps([makeApp("open-todos"), makeApp("open-uptime")])).toBe(2);
    expect(store.countApps()).toBe(2);
    const app = store.getApp("open-todos");
    expect(app?.npmName).toBe("@hasna/todos");
    expect(store.getApp("missing")).toBeNull();
  });

  it("upsert replaces existing records by appId", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps([makeApp("open-todos")]);
    store.upsertApps([makeApp("open-todos", { summary: "Updated summary" })]);
    expect(store.countApps()).toBe(1);
    expect(store.getApp("open-todos")?.summary).toBe("Updated summary");
  });

  it("lists with lifecycle and channel filters", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    store.upsertApps([
      makeApp("open-todos"),
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
      makeApp("open-uptime", { summary: "Uptime monitoring service" }),
      makeApp("open-todos", { tags: ["oss", "tasks"] }),
    ]);
    expect(store.searchApps("monitoring").map((a) => a.appId)).toEqual(["open-uptime"]);
    expect(store.searchApps("tasks").map((a) => a.appId)).toEqual(["open-todos"]);
    expect(store.searchApps("@hasna/uptime").map((a) => a.appId)).toEqual(["open-uptime"]);
    expect(store.searchApps("nothing-here").length).toBe(0);
  });

  it("rejects invalid documents on upsert", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    expect(() => store.upsertApps([{ ...makeApp("open-todos"), appId: "Bad Slug" } as App])).toThrow();
    expect(store.countApps()).toBe(0);
  });

  it("imports JSONL fixtures", () => {
    const store = new CatalogStore({ dbPath: ":memory:" });
    const jsonl = [makeApp("open-a"), makeApp("open-b")].map((app) => JSON.stringify(app)).join("\n");
    expect(store.importJsonl(`${jsonl}\n`)).toBe(2);
    expect(store.countApps()).toBe(2);
  });
});
