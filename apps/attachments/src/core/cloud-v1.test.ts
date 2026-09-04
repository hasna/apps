import { describe, expect, test } from "bun:test";
import { describeApiFailure, resolveAttachmentsV1 } from "./cloud-v1";

const BASE = "https://attachments.hasna.xyz";
const KEY = "hasna_attachments_testkey_0000";

type Call = { method: string; url: string; headers: Record<string, string>; body: string | null };

function mockFetch(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
    const call: Call = { method: init?.method ?? "GET", url, headers, body: (init?.body as string) ?? null };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const cloudEnv = { HASNA_ATTACHMENTS_API_URL: BASE, HASNA_ATTACHMENTS_API_KEY: KEY } as NodeJS.ProcessEnv;

describe("resolveAttachmentsV1", () => {
  test("rejects absent configuration", () => { expect(() => resolveAttachmentsV1({})).toThrow(); });

  test("rejects partial configuration", () => { expect(() => resolveAttachmentsV1({ HASNA_ATTACHMENTS_API_URL: BASE })).toThrow(); });

  test("returns cloud-http when URL+KEY set (mode implied self_hosted)", () => {
    const r = resolveAttachmentsV1(cloudEnv);
    expect(r.transport).toBe("cloud-http");
    if (r.transport === "cloud-http") expect(r.store.baseUrl).toBe(`${BASE}/v1`);
  });

  test("rejects a surviving local selector", () => { expect(() => resolveAttachmentsV1({ ...cloudEnv, HASNA_ATTACHMENTS_STORAGE_MODE: "local" })).toThrow(); });

  test("list routes GET /v1/attachments with bearer key and maps the envelope", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: 200,
      body: [{ id: "att_1", filename: "a.txt", size: 3, content_type: "text/plain", link: "https://x/a", tag: "t", expires_at: 111, created_at: 222 }],
    }));
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    expect(r.transport).toBe("cloud-http");
    if (r.transport !== "cloud-http") return;
    const rows = await r.store.list({ limit: 5, includeExpired: true, tag: "t" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("att_1");
    expect(rows[0]!.bucket).toBe("cloud");
    const call = calls[0]!;
    expect(call.method).toBe("GET");
    expect(call.url).toContain(`${BASE}/v1/attachments`);
    expect(call.url).toContain("limit=5");
    expect(call.url).toContain("expired=true");
    expect(call.url).toContain("tag=t");
    expect(call.headers["authorization"]).toBe(`Bearer ${KEY}`);
  });

  test("get returns null on 404", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 404, body: { error: "Not found" } }));
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    expect(await r.store.get("missing")).toBeNull();
  });

  test("uploadBuffer POSTs base64 JSON to /v1/attachments and maps result", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      expect(c.method).toBe("POST");
      const body = JSON.parse(c.body!);
      expect(body.filename).toBe("hello.txt");
      expect(Buffer.from(body.content_base64, "base64").toString()).toBe("hello");
      expect(body.tag).toBe("demo");
      return { status: 201, body: { id: "att_new", filename: "hello.txt", size: 5, link: null } };
    });
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    const att = await r.store.uploadBuffer("hello.txt", new TextEncoder().encode("hello"), { tag: "demo" });
    expect(att.id).toBe("att_new");
    expect(calls[0]!.headers["idempotency-key"]).toBeDefined();
  });

  test("uploadBuffer carries encrypt + password to /v1 (was local-only)", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      expect(c.method).toBe("POST");
      const body = JSON.parse(c.body!);
      expect(body.encrypt).toBe(true);
      expect(body.password).toBe("Parola-Test-1");
      return { status: 201, body: { id: "att_enc", filename: "secret.txt", size: 5, link: null } };
    });
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    const att = await r.store.uploadBuffer("secret.txt", new TextEncoder().encode("hello"), {
      encrypt: true,
      password: "Parola-Test-1",
      linkType: "server",
    });
    expect(att.id).toBe("att_enc");
    expect(calls[0]!.headers["idempotency-key"]).toBeDefined();
  });

  test("uploadBuffer carries require_email + allowed_emails to /v1 (was local-only)", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      expect(c.method).toBe("POST");
      const body = JSON.parse(c.body!);
      expect(body.require_email).toBe(true);
      expect(body.allowed_emails).toEqual(["dan@bcr.ro", "maria@bcr.ro"]);
      return { status: 201, body: { id: "att_gated", filename: "gated.txt", size: 5, link: null } };
    });
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    const att = await r.store.uploadBuffer("gated.txt", new TextEncoder().encode("hi!"), {
      requireEmail: true,
      allowedEmails: ["dan@bcr.ro", "maria@bcr.ro"],
      linkType: "server",
    });
    expect(att.id).toBe("att_gated");
  });

  test("delete DELETEs /v1/attachments/:id and tolerates 404", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ status: 404, body: { error: "Not found" } }));
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    await r.store.delete("att_x");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(`${BASE}/v1/attachments/att_x`);
  });

  test("checks friendly slug availability through the read-only slug route", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: 200,
      body: { slug: "company-closing-packet", available: true },
    }));
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    expect(await r.store.isSlugAvailable("company-closing-packet")).toBe(true);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${BASE}/v1/slugs/company-closing-packet`);
  });

  test("passes a friendly slug when regenerating a password-protected link", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: 200,
      body: {
        link: "https://has.na/a/company-closing-packet",
        expires_at: null,
        slug: "company-closing-packet",
      },
    }));
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    const result = await r.store.regenerateLink("att_1", {
      slug: "company-closing-packet",
      password: "passphrase",
      linkType: "server",
    });
    expect(result.slug).toBe("company-closing-packet");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${BASE}/v1/attachments/att_1/link`);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({
      slug: "company-closing-packet",
      password: "passphrase",
      link_type: "server",
    });
  });
});

// ---------------------------------------------------------------------------
// D1(a) — CLI errors must be diagnosable without reading CloudWatch
// ---------------------------------------------------------------------------

describe("describeApiFailure", () => {
  test("names the route and the HTTP status", () => {
    expect(describeApiFailure("post", "/attachments", 500, "")).toBe(
      "POST /v1/attachments failed: HTTP 500",
    );
  });

  test("surfaces the server's JSON error instead of an opaque body", () => {
    const message = describeApiFailure(
      "POST",
      "/attachments",
      400,
      JSON.stringify({ error: "Invalid expiry format: 604800s" }),
    );
    expect(message).toContain("POST /v1/attachments");
    expect(message).toContain("HTTP 400");
    expect(message).toContain("Invalid expiry format: 604800s");
  });

  test("keeps the server detail alongside a generic error label", () => {
    const message = describeApiFailure(
      "POST",
      "/attachments",
      500,
      JSON.stringify({ error: "Internal Server Error", detail: "presign failed" }),
    );
    expect(message).toContain("Internal Server Error");
    expect(message).toContain("presign failed");
    // The old behaviour was exactly this string and nothing else.
    expect(message).not.toBe("Internal Server Error");
  });

  test("falls back to the raw body for non-JSON responses", () => {
    expect(describeApiFailure("GET", "/attachments", 502, "Bad Gateway")).toContain("Bad Gateway");
  });

  test("truncates a very long body", () => {
    const message = describeApiFailure("GET", "/attachments", 500, "x".repeat(5000));
    expect(message.length).toBeLessThan(600);
  });
});

describe("cloud upload failures reach the caller with context", () => {
  test("a 500 from the upload route is reported with route and status", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 500, body: { error: "Internal Server Error" } }));
    const resolved = resolveAttachmentsV1(
      { HASNA_ATTACHMENTS_API_URL: BASE, HASNA_ATTACHMENTS_API_KEY: KEY },
      { fetchImpl },
    );
    if (resolved.transport !== "cloud-http") throw new Error("expected cloud transport");
    const error = await resolved.store
      .uploadBuffer("x.txt", new Uint8Array([1, 2, 3]), { expiry: "30d" })
      .then(() => null)
      .catch((err: Error) => err);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Attachments API request failed");
    expect(error!.message).toContain("HTTP 500");
    expect(error!.message).not.toBe("Internal Server Error");
    expect(error!.message).not.toContain(KEY);
  });
});
describe("presigned direct upload on the hosted backend (ported from local-only)", () => {
  test("presignUpload POSTs to /v1/attachments/presign-upload and maps the PUT URL", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      if (c.url.endsWith("/v1/attachments/presign-upload")) {
        return {
          status: 201,
          body: {
            id: "att_p1",
            upload_url: "https://bucket.example.com/put?X-Amz-Signature=abc",
            content_type: "application/pdf",
            filename: "report.pdf",
            expires_at: 123456,
            finalize_url: "/v1/attachments/att_p1/presign-upload/complete",
          },
        };
      }
      return { status: 404, body: { error: "nope" } };
    });
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    const result = await r.store.presignUpload("report.pdf", "application/pdf", 7200000);
    expect(result.id).toBe("att_p1");
    expect(result.uploadUrl).toBe("https://bucket.example.com/put?X-Amz-Signature=abc");
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/v1/attachments/presign-upload`);
    const sent = JSON.parse(call.body!) as Record<string, unknown>;
    expect(sent.filename).toBe("report.pdf");
    expect(sent.content_type).toBe("application/pdf");
    expect(sent.expiry).toBe("2h");
    expect(call.headers["authorization"]).toBe(`Bearer ${KEY}`);
  });

  test("presignComplete POSTs to the complete route with link options", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      if (c.url.endsWith("/att_p1/presign-upload/complete")) {
        return {
          status: 200,
          body: {
            attachment: {
              id: "att_p1",
              filename: "report.pdf",
              size: 4096,
              content_type: "application/pdf",
              link: "https://has.na/a/abc",
              tag: null,
              expires_at: 999,
            },
            link: "https://has.na/a/abc",
            size: 4096,
          },
        };
      }
      return { status: 404, body: { error: "nope" } };
    });
    const r = resolveAttachmentsV1(cloudEnv, { fetchImpl });
    if (r.transport !== "cloud-http") throw new Error("expected cloud");
    const result = await r.store.presignComplete("att_p1", {
      expiryMs: null,
      password: "pw",
      maxDownloads: 1,
      linkType: "server",
    });
    expect(result.link).toBe("https://has.na/a/abc");
    expect(result.size).toBe(4096);
    expect(result.attachment.id).toBe("att_p1");
    expect(result.attachment.status).toBe("ready");
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/v1/attachments/att_p1/presign-upload/complete`);
    const sent = JSON.parse(call.body!) as Record<string, unknown>;
    expect(sent.expiry).toBe("never");
    expect(sent.password).toBe("pw");
    expect(sent.max_downloads).toBe(1);
    expect(sent.link_type).toBe("server");
  });
});
