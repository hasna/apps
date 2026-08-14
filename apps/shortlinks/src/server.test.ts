import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShortlinksHandler } from "./server.js";
import { ShortlinksStore } from "./store.js";
import type { Link } from "./types.js";

let tempHome = "";
let dbPath = "";

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "shortlinks-server-"));
  dbPath = join(tempHome, "shortlinks.db");
  process.env.SHORTLINKS_HOME = tempHome;
});

afterEach(() => {
  delete process.env.SHORTLINKS_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

function createTestLink(): Link {
  return {
    id: "lnk_test",
    domain_id: "dom_test",
    hostname: "has.na",
    slug: "abc",
    destination_url: "https://example.com/landing",
    title: null,
    active: true,
    expires_at: null,
    metadata: {},
    machine_id: "machine_test",
    synced_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    short_url: "https://has.na/abc",
  };
}

describe("redirect handler", () => {
  test("logs analytics failures by default while still redirecting", async () => {
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      const link = createTestLink();
      const handler = createShortlinksHandler({
        store: {
          totalStats: () => ({ domains: 1, links: 1, clicks: 0 }),
          resolve: () => link,
          recordClick: () => {
            throw new Error("analytics unavailable");
          },
        },
      });

      const response = await handler(new Request("https://has.na/abc", {
        headers: { host: "has.na" },
      }));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://example.com/landing");
      expect(errors).toEqual([["[shortlinks] Click analytics recording failed for has.na/abc."]]);
    } finally {
      console.error = originalError;
    }
  });

  test("redirects and reports analytics failures when click recording fails", async () => {
    const link = createTestLink();
    const failures: Array<{ error: unknown; slug: string; method: string }> = [];
    const handler = createShortlinksHandler({
      store: {
        totalStats: () => ({ domains: 1, links: 1, clicks: 0 }),
        resolve: () => link,
        recordClick: () => {
          throw new Error("analytics unavailable");
        },
      },
      onRecordClickError: (error, context) => {
        failures.push({
          error,
          slug: context.link.slug,
          method: context.request.method,
        });
      },
    });

    const response = await handler(new Request("https://has.na/abc", {
      headers: { host: "has.na" },
    }));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/landing");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error).toBeInstanceOf(Error);
    expect(failures[0]?.slug).toBe("abc");
    expect(failures[0]?.method).toBe("GET");
  });

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

  test("allows head checks without recording a click", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/landing", slug: "abc" });

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/abc", {
      method: "HEAD",
      headers: { host: "has.na" },
    }));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/landing");
    expect(store.getStats("has.na", "abc").clicks).toBe(0);

    store.close();
  });

  test("rejects unsupported redirect methods without recording a click", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/landing", slug: "abc" });

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/abc", {
      method: "POST",
      headers: { host: "has.na" },
    }));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(await response.json()).toEqual({ error: "Method not allowed." });
    expect(store.getStats("has.na", "abc").clicks).toBe(0);

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
    expect(await response.json()).toEqual({ error: "Shortlink is disabled.", slug: "off", host: "has.na" });

    store.close();
  });

  test("returns not found for scanner paths with invalid slug characters", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/application.properties", { headers: { host: "has.na" } }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Shortlink not found.",
      slug: "application.properties",
      host: "has.na",
    });

    store.close();
  });
});
