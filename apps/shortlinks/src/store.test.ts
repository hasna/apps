import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShortlinksStore } from "./store.js";

let tempHome = "";
let dbPath = "";

function applyDomainsProjection(
  store: ShortlinksStore,
  hostname: string,
  options: { defaultDomain?: boolean; status?: "pending" | "active" | "failed" } = {},
) {
  return store.addDomain({
    hostname,
    provider: "domains-api",
    defaultDomain: options.defaultDomain,
    metadata: {
      provisioning: {
        mode: "domains-api",
        domains_job_id: `job-${hostname}`,
        status: options.status ?? "active",
      },
    },
  });
}

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

  test("refuses custom-domain rows that are not Domains API projections", () => {
    const store = new ShortlinksStore(dbPath);
    expect(() => store.addDomain({ hostname: "bypass.example", defaultDomain: true }))
      .toThrow(/only be applied as projections/);
    store.close();
  });

  test("generates Bitly-style random slugs and prevents duplicates per domain", () => {
    const store = new ShortlinksStore(dbPath);
    applyDomainsProjection(store, "go.example.com", { defaultDomain: true });
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
    const link = store.createLink({ destinationUrl: "https://example.com/cascade", slug: "cascade" });
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

describe("default domain and adaptive public codes", () => {
  test("automatically provisions has.na when no domain is supplied", () => {
    const store = new ShortlinksStore(dbPath);
    const link = store.createLink({ destinationUrl: "https://example.com/auto" });

    expect(link.hostname).toBe("has.na");
    expect(link.short_url).toBe(`https://has.na/${link.slug}`);
    expect(link.slug).toMatch(/^[0-9a-zA-Z]{3}$/);
    expect(store.getDefaultDomain()?.hostname).toBe("has.na");
    expect(store.listDomains()).toHaveLength(1);
    store.close();
  });

  test("uses has.na instead of an unmarked custom domain, but honors an explicit default", () => {
    const store = new ShortlinksStore(dbPath);
    applyDomainsProjection(store, "go.example.com");
    const automatic = store.createLink({ destinationUrl: "https://example.com/automatic", slug: "automatic" });
    expect(automatic.hostname).toBe("has.na");

    applyDomainsProjection(store, "links.example.com", { defaultDomain: true });
    const explicit = store.createLink({ destinationUrl: "https://example.com/explicit", slug: "explicit" });
    expect(explicit.hostname).toBe("links.example.com");
    store.close();
  });

  test("grows generated codes after repeated atomic collisions", () => {
    const requestedLengths: number[] = [];
    const store = new ShortlinksStore(dbPath, process.env, {
      tokenFactory(length) {
        requestedLengths.push(length);
        return "a".repeat(length);
      },
    });
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/existing", slug: "aaa" });

    const generated = store.createLink({ destinationUrl: "https://example.com/generated" });
    expect(generated.slug).toBe("aaaa");
    expect(requestedLengths).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 4]);
    store.close();
  });

  test("keeps case-sensitive friendly aliases and opaque stable database ids", () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    const upper = store.createLink({ destinationUrl: "https://example.com/upper", slug: "Friendly-Link" });
    const lower = store.createLink({ destinationUrl: "https://example.com/lower", slug: "friendly-link" });

    expect(upper.id).toMatch(/^lnk_[0-9a-f]{24}$/);
    expect(upper.id).not.toBe(upper.slug);
    expect(lower.id).not.toBe(upper.id);
    expect(store.setLinkActive("has.na", upper.slug, false).id).toBe(upper.id);
    store.close();
  });


  test("rejects system and reserved public slugs", () => {
    const store = new ShortlinksStore(dbPath);
    for (const slug of ["a", "A", "v1", "health", "ready", "version", "healthz"]) {
      expect(() => store.createLink({ destinationUrl: "https://example.com", slug })).toThrow(/Reserved/);
    }
    store.close();
  });


  test("pending and failed domains cannot route or become implicit defaults", () => {
    const store = new ShortlinksStore(dbPath);
    applyDomainsProjection(store, "go.example.com", { status: "pending" });
    const link = store.createLink({
      domain: "go.example.com",
      destinationUrl: "https://example.com/pending",
      slug: "pending-link",
    });
    expect(store.resolve("go.example.com", link.slug)).toBeNull();

    applyDomainsProjection(store, "go.example.com", { status: "active" });
    expect(store.resolve("go.example.com", link.slug)?.id).toBe(link.id);

    store.addDomain({
      hostname: "has.na",
      defaultDomain: false,
      metadata: { provisioning: { status: "failed" } },
    });
    expect(() => store.createLink({ destinationUrl: "https://example.com/default" })).toThrow(/not active/);
    store.close();
  });

  test("does not fall back to has.na for an unknown request hostname", () => {
    const store = new ShortlinksStore(dbPath);
    store.createLink({ destinationUrl: "https://example.com", slug: "friendly" });
    expect(store.resolve("unknown.example", "friendly")).toBeNull();
    store.close();
  });
});
