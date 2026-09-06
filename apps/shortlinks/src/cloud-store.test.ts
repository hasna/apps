import { describe, expect, test } from "bun:test";
import { CloudShortlinksStore } from "./cloud-store.js";

const CLOUD_ENV = {
  HASNA_SHORTLINKS_API_URL: "https://shortlinks.hasna.xyz",
  HASNA_SHORTLINKS_API_KEY: "hasna_shortlinks_test_key",
} as const;

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: unknown;
}

function mockFetch(handler: (call: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers as HeadersInit);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const call: Call = { method, url, auth: headers.get("authorization"), body };
    calls.push(call);
    const { status = 200, json = {} } = handler(call);
    return new Response(status === 204 ? null : JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

function store(handler: (call: Call) => { status?: number; json?: unknown }) {
  const { fetchImpl, calls } = mockFetch(handler);
  const s = CloudShortlinksStore.fromEnv(CLOUD_ENV, { fetchImpl });
  if (!s) throw new Error("expected hosted-API store");
  return { s, calls };
}

describe("CloudShortlinksStore.fromEnv client selection", () => {
  test("returns null (no hosted client) when env is unset", () => {
    expect(CloudShortlinksStore.fromEnv({})).toBeNull();
  });

  test("throws (no silent local drift) when a URL is set without a credential", () => {
    // An API_URL with no resolvable credential must fail loudly, never fall
    // back silently to the local store.
    expect(() =>
      CloudShortlinksStore.fromEnv({ HASNA_SHORTLINKS_API_URL: "https://shortlinks.hasna.xyz" }),
    ).toThrow(/no API key could be resolved/);
    // A declared-but-blank variable is refused loudly too.
    expect(() =>
      CloudShortlinksStore.fromEnv({ HASNA_SHORTLINKS_API_URL: "" }),
    ).toThrow(/set but blank/);
  });

  test("a credential alone selects the hosted store at the fleet gateway (URLs never need configuring)", () => {
    // Owner directive 2026-09-04: the resolver decides, and a key from any
    // tier is enough — the authority defaults to https://api.hasna.com/<app>.
    const s = CloudShortlinksStore.fromEnv({ HASNA_SHORTLINKS_API_KEY: "hasna_shortlinks_test_key" });
    expect(s).not.toBeNull();
    expect(s!.baseUrl).toBe("https://api.hasna.com/shortlinks/v1");
    void s!.close();
  });

  test("returns a hosted-API store when fully configured", () => {
    const s = CloudShortlinksStore.fromEnv(CLOUD_ENV);
    expect(s).not.toBeNull();
    expect(s!.baseUrl).toBe("https://shortlinks.hasna.xyz/v1");
  });
});

describe("CloudShortlinksStore routes to /v1 with bearer key", () => {
  test("listLinks -> GET /v1/links with query + bearer", async () => {
    const { s, calls } = store(() => ({ json: [{ id: "lnk_1", slug: "abc" }] }));
    const links = await s.listLinks({ domain: "has.na", activeOnly: true, limit: 5 });
    expect(links).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/v1/links");
    expect(calls[0].url).toContain("domain=has.na");
    expect(calls[0].url).toContain("active=true");
    expect(calls[0].url).toContain("limit=5");
    expect(calls[0].auth).toBe("Bearer hasna_shortlinks_test_key");
  });

  test("createLink -> POST /v1/links with mapped body + idempotency", async () => {
    const { s, calls } = store((c) => ({ status: 201, json: { id: "lnk_2", slug: "x", ...(c.body as object) } }));
    await s.createLink({ destinationUrl: "https://example.com", slug: "x", title: "T" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/v1/links");
    expect(calls[0].body).toMatchObject({ url: "https://example.com", slug: "x", title: "T" });
  });

  test("getLink -> 404 resolves to null", async () => {
    const { s } = store(() => ({ status: 404, json: { error: "Link not found." } }));
    expect(await s.getLink("nope")).toBeNull();
  });

  test("deleteLink fetches the link then DELETEs it", async () => {
    const { s, calls } = store((c) => {
      if (c.method === "GET") return { json: { id: "lnk_3", slug: "del", short_url: "https://has.na/del" } };
      return { status: 200, json: { deleted: true, slug: "del" } };
    });
    const link = await s.deleteLink("del");
    expect(link.slug).toBe("del");
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
    expect(calls[1].url).toContain("/v1/links/del");
  });

  test("setLinkActive -> POST enable/disable subroute", async () => {
    const { s, calls } = store(() => ({ json: { id: "lnk_4", slug: "s", active: false } }));
    await s.setLinkActive("s", false);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/v1/links/s/disable");
  });

  test("totalStats -> GET /v1/stats", async () => {
    const { s, calls } = store(() => ({ json: { domains: 1, links: 2, clicks: 3 } }));
    expect(await s.totalStats()).toEqual({ domains: 1, links: 2, clicks: 3 });
    expect(calls[0].url).toContain("/v1/stats");
  });

  test("addDomain -> POST /v1/domains mapping default/originUrl", async () => {
    const { s, calls } = store((c) => ({ status: 201, json: { id: "dom_1", hostname: (c.body as any).hostname } }));
    await s.addDomain({ hostname: "has.na", defaultDomain: true, originUrl: "https://o" });
    expect(calls[0].body).toMatchObject({ hostname: "has.na", default: true, origin_url: "https://o" });
  });

  test("deleteDomain resolves the domain then DELETEs /v1/domains/:hostname", async () => {
    const { s, calls } = store((c) => {
      if (c.method === "GET") return { json: { items: [{ id: "dom_2", hostname: "has.na" }] } };
      return { status: 200, json: { deleted: true, hostname: "has.na" } };
    });
    const domain = await s.deleteDomain("has.na");
    expect(domain.hostname).toBe("has.na");
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
    expect(calls[1].url).toContain("/v1/domains/has.na");
  });

  test("deleteDomain surfaces a DELETE 404 instead of a false success", async () => {
    // Regression: the domain exists (GET resolves it) but the server's DELETE
    // route is missing/returns 404. This MUST throw, never resolve as deleted —
    // the generic client.delete() swallowing 404 was the false-success bug.
    const { s, calls } = store((c) => {
      if (c.method === "GET") return { json: { items: [{ id: "dom_9", hostname: "gone.na" }] } };
      return { status: 404, json: { error: "Not found" } };
    });
    // Since the domain provably exists, a DELETE 404 means the deployed server
    // lacks the route — the error must say so (actionable: redeploy), not just 404.
    await expect(s.deleteDomain("gone.na")).rejects.toThrow(/predates the domain-delete route/);
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
  });

  test("deleteLink surfaces a DELETE 404 instead of a false success", async () => {
    const { s } = store((c) => {
      if (c.method === "GET") return { json: { id: "lnk_9", slug: "gone" } };
      return { status: 404, json: { error: "Not found" } };
    });
    await expect(s.deleteLink("gone")).rejects.toThrow(/predates the link-delete route/);
  });
});
