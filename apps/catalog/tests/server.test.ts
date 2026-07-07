import { describe, expect, it } from "bun:test";
import type { App } from "../src/contracts.js";
import { createCatalogHandler } from "../src/server/index.js";
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

function makeHandler() {
  const store = new CatalogStore({ dbPath: ":memory:" });
  store.upsertApps([
    makeApp("open-todos", { summary: "Task tracking" }),
    makeApp("open-uptime", { summary: "Uptime monitoring", lifecycle: "stub" }),
  ]);
  return createCatalogHandler({ store });
}

describe("catalog HTTP handler", () => {
  const handler = makeHandler();

  it("GET /health reports ok with the app count", async () => {
    const response = handler(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; apps: number };
    expect(body.status).toBe("ok");
    expect(body.apps).toBe(2);
  });

  it("GET /v1/apps lists apps and honors filters", async () => {
    const all = (await handler(new Request("http://localhost/v1/apps")).json()) as { count: number };
    expect(all.count).toBe(2);
    const stubs = (await handler(new Request("http://localhost/v1/apps?lifecycle=stub")).json()) as {
      apps: Array<{ appId: string }>;
    };
    expect(stubs.apps.map((app) => app.appId)).toEqual(["open-uptime"]);
  });

  it("GET /v1/apps/:appId returns one app or 404", async () => {
    const found = handler(new Request("http://localhost/v1/apps/open-todos"));
    expect(found.status).toBe(200);
    const body = (await found.json()) as { app: { npmName: string } };
    expect(body.app.npmName).toBe("@hasna/todos");
    expect(handler(new Request("http://localhost/v1/apps/missing-app")).status).toBe(404);
  });

  it("GET /v1/search requires q and searches", async () => {
    expect(handler(new Request("http://localhost/v1/search")).status).toBe(400);
    const result = (await handler(new Request("http://localhost/v1/search?q=monitoring")).json()) as {
      apps: Array<{ appId: string }>;
    };
    expect(result.apps.map((app) => app.appId)).toEqual(["open-uptime"]);
  });

  it("rejects non-GET methods (read model)", () => {
    const response = handler(new Request("http://localhost/v1/apps", { method: "POST" }));
    expect(response.status).toBe(405);
  });
});
