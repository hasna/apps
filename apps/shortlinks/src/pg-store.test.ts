import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgShortlinksStore, type PgAdapterLike } from "./pg-store.js";

class MemoryPgAdapter implements PgAdapterLike {
  domains = new Map<string, any>();
  links = new Map<string, any>();
  sql: string[] = [];

  async get(sql: string, ...params: unknown[]): Promise<any> {
    this.sql.push(sql);
    if (/SELECT \* FROM domains\s+WHERE default_domain/.test(sql)) {
      return [...this.domains.values()].find((d) => d.default_domain) ?? this.domains.get("has.na") ?? null;
    }
    if (/SELECT \* FROM domains WHERE hostname/.test(sql)) {
      const [hostname, id] = params;
      return this.domains.get(String(hostname)) ?? [...this.domains.values()].find((d) => d.id === id) ?? null;
    }
    if (/INSERT INTO links/.test(sql) && /ON CONFLICT \(domain_id, slug\) DO NOTHING/.test(sql)) {
      const row = this.linkRow(params);
      const key = `${row.domain_id}:${row.slug}`;
      if (this.links.has(key)) return null;
      this.links.set(key, row);
      return row;
    }
    if (/SELECT l\.\*, d\.hostname/.test(sql)) {
      const slug = String(params[0]);
      const hostname = params[1] === undefined ? undefined : String(params[1]);
      return [...this.links.values()].find((row) => row.slug === slug && (!hostname || row.hostname === hostname)) ?? null;
    }
    return null;
  }

  async all(): Promise<any[]> {
    return [];
  }

  async run(sql: string, ...params: unknown[]): Promise<unknown> {
    this.sql.push(sql);
    if (/UPDATE domains SET default_domain = 0/.test(sql)) {
      for (const domain of this.domains.values()) domain.default_domain = 0;
      return {};
    }
    if (/INSERT INTO domains/.test(sql)) {
      const [id, hostname, provider, defaultDomain, zone, account, worker, origin, notes, metadata, machine, created, updated] = params;
      const existing = this.domains.get(String(hostname));
      this.domains.set(String(hostname), {
        id: existing?.id ?? id,
        hostname,
        provider,
        default_domain: defaultDomain,
        cloudflare_zone_id: zone,
        cloudflare_account_id: account,
        cloudflare_worker_name: worker,
        origin_url: origin,
        notes,
        metadata,
        machine_id: machine,
        synced_at: null,
        created_at: existing?.created_at ?? created,
        updated_at: updated,
      });
      return {};
    }
    if (/INSERT INTO links/.test(sql)) {
      const row = this.linkRow(params);
      const key = `${row.domain_id}:${row.slug}`;
      if (this.links.has(key)) throw new Error("duplicate key value violates unique constraint");
      this.links.set(key, row);
      return {};
    }
    return {};
  }

  private linkRow(params: unknown[]) {
    const [id, domainId, slug, destination, title, expires, metadata, machine, created, updated] = params;
    const domain = [...this.domains.values()].find((d) => d.id === domainId);
    return {
      id,
      domain_id: domainId,
      hostname: domain?.hostname,
      slug,
      destination_url: destination,
      title,
      active: 1,
      expires_at: expires,
      metadata,
      machine_id: machine,
      synced_at: null,
      created_at: created,
      updated_at: updated,
    };
  }
}

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "shortlinks-pg-"));
  process.env.SHORTLINKS_HOME = home;
});
afterEach(() => {
  delete process.env.SHORTLINKS_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("PgShortlinksStore allocation", () => {
  test("provisions has.na automatically and keeps the internal id separate", async () => {
    const pg = new MemoryPgAdapter();
    const store = new PgShortlinksStore(pg, { tokenFactory: () => "aZ3" });
    const link = await store.createLink({ destinationUrl: "https://example.com" });
    expect(link.hostname).toBe("has.na");
    expect(link.slug).toBe("aZ3");
    expect(link.id).toMatch(/^lnk_[0-9a-f]{24}$/);
    expect(link.id).not.toBe(link.slug);
  });

  test("uses atomic ON CONFLICT allocation and grows after collision pressure", async () => {
    const pg = new MemoryPgAdapter();
    const lengths: number[] = [];
    const store = new PgShortlinksStore(pg, {
      tokenFactory(length) {
        lengths.push(length);
        return "a".repeat(length);
      },
    });
    await store.createLink({ destinationUrl: "https://example.com/existing", slug: "aaa" });
    const generated = await store.createLink({ destinationUrl: "https://example.com/generated" });
    expect(generated.slug).toBe("aaaa");
    expect(lengths).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 4]);
    expect(pg.sql.some((sql) => /ON CONFLICT \(domain_id, slug\) DO NOTHING\s+RETURNING \*/.test(sql))).toBe(true);
    expect(pg.sql.some((sql) => /SELECT 1 FROM links/.test(sql))).toBe(false);
  });

  test("concurrent creators cannot claim the same public code", async () => {
    const pg = new MemoryPgAdapter();
    const tokens = ["abc", "abc", "def"];
    const store = new PgShortlinksStore(pg, { tokenFactory: () => tokens.shift() ?? "ghi" });
    const [first, second] = await Promise.all([
      store.createLink({ destinationUrl: "https://example.com/one" }),
      store.createLink({ destinationUrl: "https://example.com/two" }),
    ]);
    expect(new Set([first.slug, second.slug]).size).toBe(2);
    expect(pg.links.size).toBe(2);
  });
});
