import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import type { KnowledgeSourceManifest, KnowledgeSourceManifestFileItem } from "../types/index.js";
import { validateHostedKnowledgeManifest } from "../lib/knowledge-manifest-shared.js";
import { createV1Handler } from "./v1.js";

const SIGNING_SECRET = "test-only-knowledge-manifest-signing-secret-32b";
const TENANT = "11111111-1111-4111-8111-111111111111";
const HIGH_WATERMARK = "42";

function token(kid = "kid-read", scopes: string[] = ["files:read"]): string {
  return mintApiKey({ app: "files", kid, scopes, signingSecret: SIGNING_SECRET }).token;
}

function snapshot(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    file_id: "f_1",
    source_id: "src_1",
    source_type: "s3",
    source_enabled: true,
    name: "notes.md",
    mime: "text/markdown",
    size: 120,
    hash: "abc123",
    status: "active",
    indexed_at: "2026-09-11T00:00:00.000Z",
    modified_at: "2026-09-11T01:00:00.000Z",
    tags: ["handbook"],
    project_ids: ["prj_1"],
    collection_ids: ["col_1"],
    revision: {
      id: "rev_1",
      source_ref: "open-files://file/f_1/revision/rev_1",
      content_hash_algorithm: "sha256",
      content_hash: "deadbeef",
    },
    extraction: { status: "unavailable" },
    ...over,
  };
}

function change(cursor: number | string, fileId: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { cursor: String(cursor), file_id: fileId, snapshot: snapshot({ file_id: fileId, ...over }) };
}

interface FakeOptions {
  rows?: Record<string, unknown>[];
  tenant?: string | null;
  highWatermark?: number | string;
}

function fakeClient(options: FakeOptions = {}): {
  client: TypedQueryClient;
  sql: string[];
  params: unknown[][];
} {
  const rows = options.rows ?? [change(7, "f_1")];
  const sql: string[] = [];
  const params: unknown[][] = [];
  const client: TypedQueryClient = {
    async query(text, values = []) {
      sql.push(text); params.push([...values]);
      return { rows: [] as never[], rowCount: 0 };
    },
    async many<T>(text: string, values: readonly unknown[] = []) {
      sql.push(text); params.push([...values]);
      return (text.includes("knowledge_source_outbox_events") ? rows : []) as T[];
    },
    async get<T>(text: string, values: readonly unknown[] = []) {
      sql.push(text); params.push([...values]);
      if (text.includes("api_key_tenants")) {
        return (options.tenant === null ? null : { tenant_id: options.tenant ?? TENANT }) as T;
      }
      if (text.includes("MAX(cursor)")) return { high_watermark: String(options.highWatermark ?? HIGH_WATERMARK) } as T;
      return null;
    },
    async one<T>() { return {} as T; },
    async execute(text, values = []) { sql.push(text); params.push([...values]); },
  };
  return { client, sql, params };
}

function handler(options: FakeOptions = {}) {
  const fake = fakeClient(options);
  return {
    ...fake,
    h: createV1Handler({
      getClient: () => fake.client,
      verifier: verifyApiKey({
        app: "files",
        signingSecret: SIGNING_SECRET,
        keyStatus: async () => "active",
      }),
      manifestCursorSecret: SIGNING_SECRET,
    }),
  };
}

async function get(h: ReturnType<typeof handler>["h"], query = "", authenticated = true): Promise<Response> {
  const url = new URL(`https://files.example.test/v1/knowledge/manifest${query}`);
  const req = new Request(url, authenticated ? { headers: { "x-api-key": token() } } : undefined);
  const response = await h.handle(req, url);
  if (!response) throw new Error("route not matched");
  return response;
}

function manifestQueryIndex(sql: string[]): number {
  return sql.findIndex((text) => text.includes("WITH latest AS"));
}

describe("GET /v1/knowledge/manifest", () => {
  test("serves a typed, tenant-bound global-change manifest", async () => {
    const { h, sql, params } = handler();
    const response = await get(h);
    expect(response.status).toBe(200);
    const manifest = await response.json() as KnowledgeSourceManifest;
    expect(manifest).toMatchObject({
      filter_contract: "files.knowledge.manifest.v1",
      cursor_contract: "files.knowledge.manifest.change.v1",
      high_watermark: HIGH_WATERMARK,
      item_count: 1,
      has_more: false,
      complete: true,
      delta: false,
    });
    expect(typeof manifest.delta_cursor).toBe("string");
    expect(sql.some((text) => text.includes("MAX(sync_version)"))).toBe(false);
    const index = manifestQueryIndex(sql);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(sql[index]).toContain("tenant_id = $1");
    expect(params[index]?.[0]).toBe(TENANT);
  });

  test("emits no machine, local-path, or object-store coordinates", async () => {
    const manifest = await (await get(handler().h)).json() as KnowledgeSourceManifest;
    const item = manifest.items[0] as KnowledgeSourceManifestFileItem;
    expect(item).toMatchObject({
      file_id: "f_1",
      source_id: "src_1",
      change_cursor: "7",
      name: "notes.md",
      storage: { provider: "s3", source_id: "src_1" },
      extraction: { text_available: false, status: "unavailable" },
    });
    expect(item.sync_version).toBeUndefined();
    expect(item.path).toBeUndefined();
    expect(item.source_name).toBeUndefined();
    expect(item.s3_object_id).toBeUndefined();
    const body = JSON.stringify(item);
    for (const forbidden of ["hostname", "machine_id", "local_path", "bucket", "prefix", "region", "station03", "/Users/", "/home/"]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test("marks extraction available only for a current-revision materialized record", async () => {
    const available = handler({ rows: [change(8, "f_1", { extraction: { status: "ready", revision_id: "rev_1" } })] });
    const item = (await (await get(available.h)).json() as KnowledgeSourceManifest).items[0] as KnowledgeSourceManifestFileItem;
    expect(item.extraction).toEqual({
      text_available: true,
      status: "available",
      extracted_text_ref: "open-files://file/f_1/text",
      status_reason: undefined,
    });

    const currentPartial = handler({ rows: [change(9, "f_1", { extraction: { status: "partial", revision_id: "rev_1" } })] });
    const partialItem = (await (await get(currentPartial.h)).json() as KnowledgeSourceManifest).items[0] as KnowledgeSourceManifestFileItem;
    expect(partialItem.extraction).toEqual({
      text_available: true,
      status: "partial",
      extracted_text_ref: "open-files://file/f_1/text",
      status_reason: undefined,
    });

    for (const status of ["ready", "partial"] as const) {
      const staleRevision = handler({ rows: [change(10, "f_1", { extraction: { status, revision_id: "rev_old" } })] });
      const staleItem = (await (await get(staleRevision.h)).json() as KnowledgeSourceManifest).items[0] as KnowledgeSourceManifestFileItem;
      expect(staleItem.extraction).toMatchObject({ text_available: false, status: "unavailable" });
      expect(staleItem.extraction.extracted_text_ref).toBeUndefined();
    }
  });

  test("client validation requires the exact readable partial contract and rejects extra response fields", async () => {
    const currentPartial = handler({ rows: [change(9, "f_1", { extraction: { status: "partial", revision_id: "rev_1" } })] });
    const manifest = await (await get(currentPartial.h)).json() as KnowledgeSourceManifest;
    expect(validateHostedKnowledgeManifest(manifest).items[0]!.extraction.status).toBe("partial");

    const invalid: KnowledgeSourceManifest[] = [];
    const missingRef = structuredClone(manifest);
    delete missingRef.items[0]!.extraction.extracted_text_ref;
    invalid.push(missingRef);
    const emptyRef = structuredClone(manifest);
    emptyRef.items[0]!.extraction.extracted_text_ref = "";
    invalid.push(emptyRef);
    const wrongRef = structuredClone(manifest);
    wrongRef.items[0]!.extraction.extracted_text_ref = "open-files://file/f_other/text";
    invalid.push(wrongRef);
    const itemExtra = structuredClone(manifest) as KnowledgeSourceManifest & { items: Array<Record<string, unknown>> };
    itemExtra.items[0]!.private_path = "/private/path";
    invalid.push(itemExtra as KnowledgeSourceManifest);
    const extractionExtra = structuredClone(manifest) as KnowledgeSourceManifest & { items: Array<{ extraction: Record<string, unknown> }> };
    extractionExtra.items[0]!.extraction.bucket = "private-bucket";
    invalid.push(extractionExtra as KnowledgeSourceManifest);

    for (const candidate of invalid) {
      expect(() => validateHostedKnowledgeManifest(candidate)).toThrow("Hosted knowledge manifest response is incompatible");
    }
  });

  test("returns deleted snapshots as tombstones", async () => {
    const h = handler({ rows: [change(10, "f_1", { status: "deleted" })] }).h;
    const manifest = await (await get(h, "?status=deleted")).json() as KnowledgeSourceManifest;
    expect(manifest.tombstone_count).toBe(1);
    expect(manifest.items[0]).toMatchObject({ deleted: true, tombstone: true });
  });

  test("mints signed continuations pinned to the original high watermark", async () => {
    const fixture = handler({ rows: [change(7, "f_1"), change(9, "f_2")] });
    const first = await (await get(fixture.h, "?limit=1&tag=handbook")).json() as KnowledgeSourceManifest;
    expect(first.next_cursor).toBeDefined();
    expect(first.has_more).toBe(true);
    expect(first.complete).toBe(false);

    const second = await (await get(fixture.h, `?limit=1&tag=handbook&cursor=${encodeURIComponent(first.next_cursor!)}`)).json() as KnowledgeSourceManifest;
    expect(second.high_watermark).toBe(HIGH_WATERMARK);
    expect(fixture.sql.filter((text) => text.includes("MAX(cursor)"))).toHaveLength(1);
  });

  test("rejects tampered, cross-filter, and cross-tenant cursors", async () => {
    const source = handler({ rows: [change(7, "f_1"), change(9, "f_2")] });
    const first = await (await get(source.h, "?limit=1&tag=handbook")).json() as KnowledgeSourceManifest;
    const chars = first.next_cursor!.split("");
    const middle = Math.floor(chars.length / 2);
    chars[middle] = chars[middle] === "a" ? "b" : "a";
    expect((await get(source.h, `?limit=1&tag=handbook&cursor=${encodeURIComponent(chars.join(""))}`)).status).toBe(400);
    expect((await get(source.h, `?limit=1&tag=other&cursor=${encodeURIComponent(first.next_cursor!)}`)).status).toBe(400);

    const otherTenant = handler({ tenant: "22222222-2222-4222-8222-222222222222" });
    expect((await get(otherTenant.h, `?limit=1&tag=handbook&cursor=${encodeURIComponent(first.next_cursor!)}`)).status).toBe(400);
  });

  test("pushes source, tag, project, collection, time, and status filters into immutable full snapshots", async () => {
    const fixture = handler();
    await get(fixture.h, "?source_id=src_1&tag=Handbook&collection_id=col_1&project_id=prj_1&status=all&after=2026-01-01&before=2026-12-31");
    const index = fixture.sql.findIndex((text) => text.includes("WITH latest AS"));
    expect(index).toBeGreaterThanOrEqual(0);
    const text = fixture.sql[index]!;
    const bound = fixture.params[index]!;
    expect(text).toContain("snapshot->'collection_ids'");
    expect(text).toContain("snapshot->'project_ids'");
    expect(text).toContain("snapshot->'tags'");
    for (const value of [TENANT, "src_1", "handbook", "col_1", "prj_1", "2026-01-01", "2026-12-31"]) expect(bound).toContain(value);
  });

  test("uses signed checkpoints for unfiltered deltas and refuses filtered deltas", async () => {
    const fixture = handler();
    const checkpoint = (await (await get(fixture.h)).json() as KnowledgeSourceManifest).delta_cursor;
    const deltaResponse = await get(fixture.h, `?delta=true&since_cursor=${encodeURIComponent(checkpoint)}&status=all`);
    expect(deltaResponse.status).toBe(200);
    expect((await deltaResponse.json() as KnowledgeSourceManifest).delta).toBe(true);
    const latestQuery = fixture.sql.map((text, i) => [text, i] as const).reverse().find(([text]) => text.includes("WITH latest AS"));
    expect(latestQuery?.[0]).toContain("cursor >");

    const filtered = handler();
    const response = await get(filtered.h, `?delta=true&since_cursor=${encodeURIComponent(checkpoint)}&tag=handbook`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "filtered_delta_unavailable" });
    expect(filtered.sql.some((text) => text.includes("WITH latest AS"))).toBe(false);
  });

  test("refuses legacy sync cursors, unknown query fields, and malformed values before manifest reads", async () => {
    for (const query of [
      "?since_sync_version=5",
      "?surprise=1",
      "?limit=1.5",
      "?delta=maybe",
      "?status=unknown",
      "?format=yaml",
      "?after=2026-02-30",
      "?tag=one&tag=two",
      "?cursor=one&since_cursor=two",
    ]) {
      const fixture = handler();
      const response = await get(fixture.h, query);
      expect(response.status).toBe(400);
      expect(fixture.sql.some((text) => text.includes("WITH latest AS"))).toBe(false);
    }
  });

  test("refuses ACL and evidence expansion before manifest reads", async () => {
    for (const [query, reason] of [
      ["?include_acl_summary=true", "acl_summary_unavailable"],
      ["?include_evidence_assets=1", "evidence_assets_unavailable"],
    ] as const) {
      const fixture = handler();
      const response = await get(fixture.h, query);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason });
      expect(fixture.sql.some((text) => text.includes("WITH latest AS"))).toBe(false);
    }
  });

  test("refuses a missing tenant binding before manifest reads", async () => {
    const fixture = handler({ tenant: null });
    const response = await get(fixture.h);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "tenant_binding_missing" });
    expect(fixture.sql.some((text) => text.includes("WITH latest AS"))).toBe(false);
  });

  test("rejects malformed or mismatched stored snapshots", async () => {
    for (const row of [
      { cursor: 1, file_id: "f_1", snapshot: {} },
      { cursor: 1, file_id: "f_1", snapshot: snapshot({ file_id: "f_other" }) },
    ]) {
      const response = await get(handler({ rows: [row] }).h);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Hosted knowledge manifest unavailable", reason: "manifest_store_incompatible" });
    }
  });

  test("a read token is sufficient and unauthenticated requests are refused", async () => {
    expect((await get(handler().h)).status).toBe(200);
    expect((await get(handler().h, "", false)).status).toBeGreaterThanOrEqual(400);
  });
});
