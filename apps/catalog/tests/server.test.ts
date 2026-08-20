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

function makeHandler() {
  const store = new CatalogStore({ dbPath: ":memory:" });
  store.upsertApps([
    makeApp("open-alpha", { summary: "Task tracking" }),
    makeApp("open-beta", { summary: "Uptime monitoring", lifecycle: "stub" }),
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
    expect(stubs.apps.map((app) => app.appId)).toEqual(["open-beta"]);
  });

  it("GET /v1/apps/:appId returns one app or 404", async () => {
    const found = handler(new Request("http://localhost/v1/apps/open-alpha"));
    expect(found.status).toBe(200);
    const body = (await found.json()) as { app: { npmName: string } };
    expect(body.app.npmName).toBe("@example/alpha");
    expect(handler(new Request("http://localhost/v1/apps/missing-app")).status).toBe(404);
  });

  it("GET /v1/search requires q and searches", async () => {
    expect(handler(new Request("http://localhost/v1/search")).status).toBe(400);
    const result = (await handler(new Request("http://localhost/v1/search?q=monitoring")).json()) as {
      apps: Array<{ appId: string }>;
    };
    expect(result.apps.map((app) => app.appId)).toEqual(["open-beta"]);
  });

  it("rejects non-GET methods (read model)", () => {
    const response = handler(new Request("http://localhost/v1/apps", { method: "POST" }));
    expect(response.status).toBe(405);
  });

  it("fails OPEN on an invalid lifecycle filter instead of erroring", async () => {
    // safeParse failure silently drops the filter, returning the full list.
    // A client typo therefore reads as "no filter" rather than as an error —
    // pinned so a change to 400 is a deliberate contract change.
    const response = handler(new Request("http://localhost/v1/apps?lifecycle=nope"));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { count: number }).count).toBe(2);
  });

  it("clamps limit and offset query parameters", async () => {
    const zero = (await handler(new Request("http://localhost/v1/apps?limit=0")).json()) as { count: number };
    expect(zero.count).toBe(1);
    const garbage = (await handler(new Request("http://localhost/v1/apps?limit=abc")).json()) as { count: number };
    expect(garbage.count).toBe(2);
    const combined = (await handler(new Request("http://localhost/v1/apps?lifecycle=stub&channel=beta")).json()) as {
      count: number;
    };
    expect(combined.count).toBe(0);
  });

  it("only matches lowercase dashed app ids in the route", () => {
    // The route regex is /^\/v1\/apps\/([a-z0-9-]+)$/ — anything outside it
    // is a 404, including uppercase ids and nested paths.
    expect(handler(new Request("http://localhost/v1/apps/OPEN-ALPHA")).status).toBe(404);
    expect(handler(new Request("http://localhost/v1/apps/open-alpha/extra")).status).toBe(404);
  });

  it("returns 404 for unknown paths", () => {
    expect(handler(new Request("http://localhost/v1/unknown")).status).toBe(404);
    expect(handler(new Request("http://localhost/")).status).toBe(404);
  });

  it("rejects whitespace-only search queries", () => {
    const response = handler(new Request("http://localhost/v1/search?q=%20%20"));
    expect(response.status).toBe(400);
  });

  it("parses integer prefixes of limit and offset (parseInt semantics)", async () => {
    // Number.parseInt("3items") is 3: the documented permissive parsing takes
    // the leading integer and ignores the rest. Pin that so a switch to strict
    // integers is a deliberate change.
    const three = (await handler(new Request("http://localhost/v1/apps?limit=3items")).json()) as { count: number };
    expect(three.count).toBe(2);
    const negative = (await handler(new Request("http://localhost/v1/apps?offset=-2")).json()) as { count: number };
    expect(negative.count).toBe(2);
  });

  it("contains store failures as JSON 500s without leaking internals", async () => {
    const boom = (): never => {
      throw new Error("secret internal detail");
    };
    const throwingStore = {
      upsertApps: boom,
      getApp: boom,
      listApps: boom,
      searchApps: boom,
      countApps: boom,
    };
    const failing = createCatalogHandler({ store: throwingStore });
    for (const path of ["/health", "/v1/apps", "/v1/apps/open-alpha", "/v1/search?q=x"]) {
      const response = failing(new Request(`http://localhost${path}`));
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("internal error");
      expect(JSON.stringify(body)).not.toContain("secret internal detail");
    }
  });
});
