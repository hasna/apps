import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShortlinksStore } from "./store.js";

let tempHome = "";
let dbPath = "";

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "shortlinks-store-"));
  dbPath = join(tempHome, "shortlinks.db");
  process.env.SHORTLINKS_HOME = tempHome;
});

afterEach(() => {
  delete process.env.SHORTLINKS_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("ShortlinksStore", () => {
  test("adds domains and creates deterministic custom shortlinks", () => {
    const store = new ShortlinksStore(dbPath);
    const domain = store.addDomain({ hostname: "https://HAS.NA/path", defaultDomain: true });
    const link = store.createLink({
      destinationUrl: "https://example.com/docs?x=1",
      slug: "docs",
      title: "Docs",
    });

    expect(domain.hostname).toBe("has.na");
    expect(domain.default_domain).toBe(true);
    expect(link.slug).toBe("docs");
    expect(link.short_url).toBe("https://has.na/docs");
    expect(link.destination_url).toBe("https://example.com/docs?x=1");

    store.close();
  });

  test("generates Bitly-style random slugs and prevents duplicates per domain", () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "go.example.com", defaultDomain: true });
    const first = store.createLink({ destinationUrl: "https://example.com/a", slugLength: 8 });

    expect(first.slug).toMatch(/^[0-9a-zA-Z]{8}$/);
    expect(() => store.createLink({ destinationUrl: "https://example.com/b", slug: first.slug }))
      .toThrow("Slug already exists");

    store.close();
  });

  test("records clicks and returns aggregate stats", () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    const link = store.createLink({ destinationUrl: "https://example.com", slug: "x" });

    store.recordClick(link, {
      ip: "203.0.113.10",
      referer: "https://ref.example",
      userAgent: "test-agent",
    });
    store.recordClick(link, {
      ip: "203.0.113.11",
      referer: "https://ref.example",
      userAgent: "test-agent",
    });

    const stats = store.getStats("has.na", "x");
    expect(stats.clicks).toBe(2);
    expect(stats.top_referrers[0]).toEqual({ referer: "https://ref.example", clicks: 2 });
    expect(stats.top_user_agents[0]).toEqual({ user_agent: "test-agent", clicks: 2 });

    store.close();
  });

  test("uses a per-installation click salt when SHORTLINKS_CLICK_SALT is not set", () => {
    const previousSalt = process.env.SHORTLINKS_CLICK_SALT;
    delete process.env.SHORTLINKS_CLICK_SALT;
    const secondHome = mkdtempSync(join(tmpdir(), "shortlinks-store-salt-"));

    function recordIpHash(home: string): string {
      process.env.SHORTLINKS_HOME = home;
      const store = new ShortlinksStore(join(home, "shortlinks.db"));
      store.addDomain({ hostname: "has.na", defaultDomain: true });
      const link = store.createLink({ destinationUrl: "https://example.com", slug: "x" });
      const click = store.recordClick(link, { ip: "203.0.113.10" });
      store.close();
      return click.ip_hash!;
    }

    try {
      const firstHash = recordIpHash(tempHome);
      const secondHash = recordIpHash(secondHome);

      expect(firstHash).toHaveLength(64);
      expect(secondHash).toHaveLength(64);
      expect(firstHash).not.toBe(secondHash);
    } finally {
      if (previousSalt === undefined) delete process.env.SHORTLINKS_CLICK_SALT;
      else process.env.SHORTLINKS_CLICK_SALT = previousSalt;
      process.env.SHORTLINKS_HOME = tempHome;
      rmSync(secondHome, { recursive: true, force: true });
    }
  });

  test("keeps SHORTLINKS_CLICK_SALT as an explicit stable override", () => {
    const previousSalt = process.env.SHORTLINKS_CLICK_SALT;
    const secondHome = mkdtempSync(join(tmpdir(), "shortlinks-store-salt-"));

    function recordIpHash(home: string): string {
      process.env.SHORTLINKS_HOME = home;
      const store = new ShortlinksStore(join(home, "shortlinks.db"));
      store.addDomain({ hostname: "has.na", defaultDomain: true });
      const link = store.createLink({ destinationUrl: "https://example.com", slug: "x" });
      const click = store.recordClick(link, { ip: "203.0.113.10" });
      store.close();
      return click.ip_hash!;
    }

    try {
      process.env.SHORTLINKS_CLICK_SALT = "explicit-test-salt";

      expect(recordIpHash(tempHome)).toBe(recordIpHash(secondHome));
    } finally {
      if (previousSalt === undefined) delete process.env.SHORTLINKS_CLICK_SALT;
      else process.env.SHORTLINKS_CLICK_SALT = previousSalt;
      process.env.SHORTLINKS_HOME = tempHome;
      rmSync(secondHome, { recursive: true, force: true });
    }
  });

  test("deleteDomain removes the domain and cascades its links and clicks", () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    const link = store.createLink({ destinationUrl: "https://example.com/a", slug: "a" });
    store.recordClick(link, { ip: "203.0.113.10" });

    expect(store.totalStats()).toEqual({ domains: 1, links: 1, clicks: 1 });

    const deleted = store.deleteDomain("has.na");
    expect(deleted.hostname).toBe("has.na");

    // Domain, its links, and clicks are all gone (ON DELETE CASCADE).
    expect(store.getDomain("has.na")).toBeNull();
    expect(store.totalStats()).toEqual({ domains: 0, links: 0, clicks: 0 });

    // Deleting a missing domain throws.
    expect(() => store.deleteDomain("nope.example")).toThrow("Domain not found.");

    store.close();
  });
});
