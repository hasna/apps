import { afterEach, describe, it, expect } from "bun:test";
import {
  getDnsRecords,
  listDomains,
  _setFetch,
  type BrandsightDnsRecord,
} from "./brandsight.js";

const CFG = { apiKey: "key", apiSecret: "secret", customerId: "customer" } as const;

afterEach(() => {
  _setFetch(null);
});

// ------------------------------------------------------------------
// Faithful fakes.
//
// These implement the CONTRACT the upstream API documents, not the
// contract the client happens to assume. GoDaddy documents the records
// `offset` parameter as "Number of results to skip for pagination" -- a
// ROW offset, not a page index. A fake that matched the client's
// assumption instead would pass against a broken client, which is the
// exact failure these tests exist to catch.
// ------------------------------------------------------------------

function serveRecordsByRowOffset(corpus: BrandsightDnsRecord[], urls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    // Parsed, never substring-matched: "offset=1000" contains "offset=1".
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "0");
    return new Response(JSON.stringify(corpus.slice(offset, offset + limit)), { status: 200 });
  }) as unknown as typeof fetch;
}

function serveDomainsByMarker(
  corpus: string[],
  urls: string[],
  mode: "inclusive" | "exclusive",
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    const marker = url.searchParams.get("marker");
    const limit = Number(url.searchParams.get("limit") ?? "500");
    let start = 0;
    if (marker) {
      const idx = corpus.indexOf(marker);
      start = idx < 0 ? 0 : mode === "inclusive" ? idx : idx + 1;
    }
    const page = corpus.slice(start, start + limit).map((domain) => ({
      domain,
      status: "ACTIVE",
      expiresAt: "2027-01-01T00:00:00Z",
      renewAuto: true,
      nameServers: [],
    }));
    return new Response(JSON.stringify(page), { status: 200 });
  }) as unknown as typeof fetch;
}

function duplicatesOf(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

describe("getDnsRecords pagination", () => {
  // limit is 1000 in the client, so 1001 records is the smallest corpus that
  // forces a second page. Correct: 2 requests, 1001 rows.
  const corpus: BrandsightDnsRecord[] = Array.from({ length: 1001 }, (_, i) => ({
    type: "TXT",
    name: `rec-${String(i).padStart(4, "0")}`,
    data: "value",
    ttl: 600,
  }));

  it("returns every record exactly once across a page boundary", async () => {
    const urls: string[] = [];
    _setFetch(serveRecordsByRowOffset(corpus, urls));

    const records = await getDnsRecords("example.com", CFG);
    const names = records.map((r) => r.name);

    // Assert the SET, not the count: a paginator can hit a count while
    // returning the wrong rows.
    expect(duplicatesOf(names)).toEqual([]);
    expect(new Set(names)).toEqual(new Set(corpus.map((r) => r.name)));
    expect(records).toHaveLength(corpus.length);
  });

  it("advances offset by the page size, not by one row", async () => {
    const urls: string[] = [];
    _setFetch(serveRecordsByRowOffset(corpus, urls));

    await getDnsRecords("example.com", CFG);

    const offsets = urls.map((u) => Number(new URL(u).searchParams.get("offset")));
    expect(offsets).toEqual([0, 1000]);
  });

  it("stops after ceil(total/limit) requests", async () => {
    const urls: string[] = [];
    _setFetch(serveRecordsByRowOffset(corpus, urls));

    await getDnsRecords("example.com", CFG);

    expect(urls).toHaveLength(2);
  });

  it("still reads a single short page in one request", async () => {
    const urls: string[] = [];
    const small = corpus.slice(0, 3);
    _setFetch(serveRecordsByRowOffset(small, urls));

    const records = await getDnsRecords("example.com", CFG);

    expect(records.map((r) => r.name)).toEqual(small.map((r) => r.name));
    expect(urls).toHaveLength(1);
  });
});

describe("listDomains marker pagination", () => {
  // 501 domains: one more than the 500 page size, so exactly one boundary.
  const corpus = Array.from({ length: 501 }, (_, i) => `pgn-${String(i).padStart(4, "0")}.example`);

  it("returns each domain exactly once when the marker is INCLUSIVE", async () => {
    const urls: string[] = [];
    _setFetch(serveDomainsByMarker(corpus, urls, "inclusive"));

    const domains = await listDomains(CFG);
    const names = domains.map((d) => d.domain);

    expect(duplicatesOf(names)).toEqual([]);
    expect(new Set(names)).toEqual(new Set(corpus));
    expect(domains).toHaveLength(corpus.length);
  });

  // The mirror case. The marker's inclusivity is NOT documented upstream, so
  // the fix must be correct under both readings: it must remove the boundary
  // duplicate when the marker is inclusive, and must discard nothing when it
  // is exclusive.
  it("returns each domain exactly once when the marker is EXCLUSIVE", async () => {
    const urls: string[] = [];
    _setFetch(serveDomainsByMarker(corpus, urls, "exclusive"));

    const domains = await listDomains(CFG);
    const names = domains.map((d) => d.domain);

    expect(duplicatesOf(names)).toEqual([]);
    expect(new Set(names)).toEqual(new Set(corpus));
    expect(domains).toHaveLength(corpus.length);
  });
});
