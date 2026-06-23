import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShortlinksHandler } from "./server.js";
import { ShortlinksStore } from "./store.js";

let tempHome = "";
let dbPath = "";

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "shortlinks-server-"));
  dbPath = join(tempHome, "shortlinks.db");
  process.env.SHORTLINKS_HOME = tempHome;
  delete process.env.SHORTLINKS_API_TOKEN;
  delete process.env.HASNA_SHORTLINKS_API_TOKEN;
  delete process.env.SHORTLINKS_API_PATH_PREFIX;
});

afterEach(() => {
  delete process.env.SHORTLINKS_HOME;
  delete process.env.SHORTLINKS_API_TOKEN;
  delete process.env.HASNA_SHORTLINKS_API_TOKEN;
  delete process.env.SHORTLINKS_API_PATH_PREFIX;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("redirect handler", () => {
  test("redirects and tracks a click for the request host", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/landing", slug: "abc" });

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/abc?utm=test", {
      headers: {
        host: "has.na",
        referer: "https://source.example",
        "user-agent": "bun-test",
        "x-forwarded-for": "203.0.113.55",
      },
    }));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/landing");
    expect(store.getStats("has.na", "abc").clicks).toBe(1);

    store.close();
  });

  test("returns gone for disabled links", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com", slug: "off" });
    store.setLinkActive("has.na", "off", false);

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/off", { headers: { host: "has.na" } }));

    expect(response.status).toBe(410);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("This shortlink is disabled");

    store.close();
  });

  test("returns not found for scanner paths with invalid slug characters", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/application.properties", { headers: { host: "has.na" } }));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("Shortlink not found");
    expect(body).toContain("has.na/application.properties");

    store.close();
  });

  test("does not resolve reserved /a paths as shortlinks", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/attachment-collision", slug: "a" });

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/a/att_123", { headers: { host: "has.na" } }));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("This path is reserved");
    expect(store.getStats("has.na", "a").clicks).toBe(0);

    store.close();
  });

  test("can opt out of reserved prefixes for private deployments", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/a", slug: "a" });

    const handler = createShortlinksHandler({ store, reservedPathPrefixes: [] });
    const response = await handler(new Request("https://has.na/a/anything", { headers: { host: "has.na" } }));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/a");

    store.close();
  });

  test("enforces max-use limits before redirecting", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/once", slug: "once", maxUses: 1 });

    const handler = createShortlinksHandler({ store });
    const first = await handler(new Request("https://has.na/once", { headers: { host: "has.na" } }));
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("https://example.com/once");

    const second = await handler(new Request("https://has.na/once", { headers: { host: "has.na" } }));
    expect(second.status).toBe(410);
    expect(second.headers.get("content-type")).toContain("text/html");
    expect(await second.text()).toContain("This shortlink has already been used");

    const link = store.getLink("has.na", "once")!;
    expect(link.max_uses).toBe(1);
    expect(link.used_count).toBe(1);
    expect(store.getStats("has.na", "once").clicks).toBe(1);

    store.close();
  });

  test("does not consume max-use limits for HEAD redirect probes", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/once", slug: "once", maxUses: 1 });

    const handler = createShortlinksHandler({ store });
    const head = await handler(new Request("https://has.na/once", {
      method: "HEAD",
      headers: { host: "has.na" },
    }));
    expect(head.status).toBe(302);
    expect(head.headers.get("location")).toBe("https://example.com/once");

    const linkAfterHead = store.getLink("has.na", "once")!;
    expect(linkAfterHead.used_count).toBe(0);
    expect(store.getStats("has.na", "once").clicks).toBe(0);

    const get = await handler(new Request("https://has.na/once", { headers: { host: "has.na" } }));
    expect(get.status).toBe(302);

    const linkAfterGet = store.getLink("has.na", "once")!;
    expect(linkAfterGet.used_count).toBe(1);
    expect(store.getStats("has.na", "once").clicks).toBe(1);

    store.close();
  });

  test("serves token-protected admin API under configured prefix", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });

    const handler = createShortlinksHandler({
      store,
      apiPathPrefix: "/_shortlinks/api",
      apiToken: "secret",
    });

    const rejected = await handler(new Request("https://has.na/_shortlinks/api/links", {
      headers: { host: "has.na" },
    }));
    expect(rejected.status).toBe(401);

    const created = await handler(new Request("https://has.na/_shortlinks/api/links", {
      method: "POST",
      headers: {
        host: "has.na",
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        destination_url: "https://example.com/cloud",
        slug: "cloud",
        max_uses: 2,
      }),
    }));
    expect(created.status).toBe(201);
    const createdJson = await created.json();
    expect(createdJson.short_url).toBe("https://has.na/cloud");
    expect(createdJson.max_uses).toBe(2);

    const fetched = await handler(new Request("https://has.na/_shortlinks/api/links/cloud?domain=has.na", {
      headers: {
        host: "has.na",
        authorization: "Bearer secret",
      },
    }));
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).destination_url).toBe("https://example.com/cloud");

    store.close();
  });

  test("rejects mutating admin API routes when no token is configured", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });

    const handler = createShortlinksHandler({ store, apiToken: null });

    const health = await handler(new Request("https://has.na/api/health", {
      headers: { host: "has.na" },
    }));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      api_auth_required: false,
      api_mutation_auth_required: true,
    });

    const rejected = await handler(new Request("https://has.na/api/links", {
      method: "POST",
      headers: {
        host: "has.na",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        destination_url: "https://example.com/unsafe",
        slug: "unsafe",
      }),
    }));

    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({
      error: "Admin API token is required for write routes. Set SHORTLINKS_API_TOKEN or HASNA_SHORTLINKS_API_TOKEN.",
    });
    expect(store.getLink("has.na", "unsafe")).toBeNull();

    store.close();
  });

  test("ignores blank primary API token env before falling back to HASNA token", async () => {
    process.env.SHORTLINKS_API_TOKEN = "   ";
    process.env.HASNA_SHORTLINKS_API_TOKEN = "fallback-secret";

    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });

    const handler = createShortlinksHandler({ store });

    const rejected = await handler(new Request("https://has.na/api/links", {
      headers: { host: "has.na" },
    }));
    expect(rejected.status).toBe(401);

    const created = await handler(new Request("https://has.na/api/links", {
      method: "POST",
      headers: {
        host: "has.na",
        authorization: "Bearer fallback-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        destination_url: "https://example.com/fallback",
        slug: "fallback",
      }),
    }));
    expect(created.status).toBe(201);
    expect(store.getLink("has.na", "fallback")?.destination_url).toBe("https://example.com/fallback");

    store.close();
  });
});
