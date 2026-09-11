/**
 * `GET /v1/knowledge/manifest` — the hosted half of the knowledge manifest.
 *
 * The manifest is what the `knowledge` app consumes to index files, and until
 * now it existed only on-box: `files knowledge manifest` and the MCP
 * `export_knowledge_manifest` refused on a hosted credential. This route serves
 * the same document from the service's own Postgres.
 *
 * Two properties matter and are pinned here:
 *
 *  1. **Cursor interchange.** The envelope, the cursor encoding and every
 *     derived per-file field come from `src/lib/knowledge-manifest-shared.ts`,
 *     which both transports import — so a cursor minted here is readable on-box.
 *  2. **Refusal, not fabrication.** `include_acl_summary` and
 *     `include_evidence_assets` are answered 400. The service does not model
 *     file organization reviews, so an empty ACL summary would read as
 *     "reviewed, nothing to report" — a false green.
 */
import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { createV1Handler } from "./v1.js";
import { parseManifestCursor } from "../lib/knowledge-manifest-shared.js";
import type { KnowledgeSourceManifest, KnowledgeSourceManifestFileItem } from "../types/index.js";

const SIGNING_SECRET = "test-only-knowledge-manifest-signing-secret-32b";
const TENANT = "tenant-manifest";
const HIGH_WATERMARK = 42;

function token(kid = "kid-read", scopes: string[] = ["files:read"]): string {
  return mintApiKey({ app: "files", kid, scopes, signingSecret: SIGNING_SECRET }).token;
}

function manifestRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "f_1",
    source_id: "src_1",
    path: "docs/notes.md",
    name: "notes.md",
    size: 120,
    mime: "text/markdown",
    hash: "abc123",
    status: "active",
    indexed_at: "2026-09-11T00:00:00.000Z",
    modified_at: "2026-09-11T01:00:00.000Z",
    sync_version: 7,
    source_name: "docs",
    source_type: "s3",
    source_machine_id: "m_1",
    source_root_path: null,
    source_bucket: "files-bucket",
    source_prefix: "docs/",
    source_region: "us-east-1",
    source_enabled: 1,
    file_machine_id: "m_1",
    machine_name: "station03",
    machine_hostname: "station03.local",
    machine_platform: "darwin",
    machine_arch: "arm64",
    machine_is_current: 1,
    ...over,
  };
}

interface FakeOptions {
  rows?: Record<string, unknown>[];
  tags?: Array<{ file_id: string; name: string }>;
  versions?: Record<string, unknown>[];
}

/** Records the SQL the route emits and answers with fixtures. */
function fakeClient(options: FakeOptions = {}): { client: TypedQueryClient; sql: string[]; params: unknown[][] } {
  const rows = options.rows ?? [manifestRow()];
  const tags = options.tags ?? [{ file_id: "f_1", name: "handbook" }];
  const versions = options.versions ?? [{
    file_id: "f_1",
    id: "rev_1",
    source_ref: "open-files://file/f_1/revision/rev_1",
    s3_object_id: "s3o_1",
    content_hash_algorithm: "sha256",
    content_hash: "deadbeef",
  }];
  const sql: string[] = [];
  const params: unknown[][] = [];

  const client: TypedQueryClient = {
    async query() { return { rows: [] as never[], rowCount: 0 }; },
    async many<T>(text: string, values: unknown[] = []) {
      sql.push(text);
      params.push(values);
      if (text.includes("FROM files f")) return rows as T;
      if (text.includes("FROM file_tags ft JOIN tags t")) return tags as T;
      if (text.includes("FROM file_versions")) return versions as T;
      return [] as T;
    },
    async get<T>(text: string, values: unknown[] = []) {
      sql.push(text);
      params.push(values);
      if (text.includes("api_key_tenants")) return { tenant_id: TENANT } as T;
      if (text.includes("MAX(sync_version)")) return { max_sync_version: HIGH_WATERMARK } as T;
      return null;
    },
    async one<T>() { return {} as T; },
    async execute() {},
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
    }),
  };
}

async function get(h: ReturnType<typeof handler>["h"], query: string): Promise<Response> {
  const url = new URL(`https://files.example.test/v1/knowledge/manifest${query}`);
  const req = new Request(url, { headers: { "x-api-key": token() } });
  const res = await h.handle(req, url);
  if (!res) throw new Error("route not matched");
  return res;
}

describe("GET /v1/knowledge/manifest", () => {
  test("serves a manifest envelope built from the service's own store", async () => {
    const { h } = handler();

    const res = await get(h, "");
    expect(res.status).toBe(200);
    const manifest = await res.json() as KnowledgeSourceManifest;

    expect(manifest.manifest_id).toMatch(/^manifest_[0-9a-f]{24}$/);
    expect(manifest.item_count).toBe(1);
    expect(manifest.high_watermark).toBe(HIGH_WATERMARK);
    expect(manifest.delta).toBe(false);
    expect(manifest.next_cursor).toBeUndefined();
    expect(manifest.tombstone_count).toBe(0);

    // The delta cursor is readable by the shared parser the on-box exporter uses.
    const delta = parseManifestCursor(manifest.delta_cursor);
    expect(delta).toEqual({ sync_version: HIGH_WATERMARK, file_id: "", high_watermark: HIGH_WATERMARK });
  });

  test("each file item carries the full on-box shape, from real row data", async () => {
    const { h } = handler();

    const manifest = await (await get(h, "")).json() as KnowledgeSourceManifest;
    const item = manifest.items[0] as KnowledgeSourceManifestFileItem;

    expect(item.kind).toBe("file");
    expect(item.source_ref).toBe("open-files://file/f_1");
    expect(item.file_id).toBe("f_1");
    expect(item.sync_version).toBe(7);
    expect(item.revision_id).toBe("rev_1");
    expect(item.revision_ref).toBe("open-files://file/f_1/revision/rev_1");
    expect(item.s3_object_id).toBe("s3o_1");
    // hash prefers the revision's algorithm-qualified content hash
    expect(item.hash).toBe("sha256:deadbeef");
    expect(item.source_revision_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(item.tags).toEqual(["handbook"]);
    expect(item.deleted).toBe(false);
    expect(item.tombstone).toBeUndefined();

    // text availability is the pure mime/filename decision, not a byte read
    expect(item.extraction.text_available).toBe(true);
    expect(item.extraction.status).toBe("available");
    expect(item.extraction.extracted_text_ref).toBe("open-files://file/f_1/text");

    // the service owns the object store and does not disclose bucket/key
    expect(item.storage).toEqual({ provider: "s3", source_id: "src_1" });
    expect(JSON.stringify(item.storage)).not.toContain("files-bucket");

    expect(item.open_files_root.open_files_root).toBe("open-files://source/src_1");
    expect(item.open_files_root.machine.hostname).toBe("station03.local");
    expect(item.open_files_root.evidence_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(item.permissions).toEqual({ mode: "read_only", allowed_purposes: ["knowledge_index", "knowledge_answer", "agent_context"] });
    expect(item.permission_labels).toContain("read_only");
    expect(item.permission_labels).toContain("source_enabled");
    expect(item.permission_labels).toContain("storage:s3");
  });

  test("a deleted row becomes a tombstone", async () => {
    const { h } = handler({ rows: [manifestRow({ status: "deleted" })] });

    const manifest = await (await get(h, "?status=deleted")).json() as KnowledgeSourceManifest;
    const item = manifest.items[0] as KnowledgeSourceManifestFileItem;
    expect(item.deleted).toBe(true);
    expect(item.tombstone).toBe(true);
    expect(manifest.tombstone_count).toBe(1);
  });

  test("a full page mints a next_cursor on the (sync_version, id) keyset", async () => {
    const rows = [manifestRow({ id: "f_1", sync_version: 7 }), manifestRow({ id: "f_2", sync_version: 9 })];
    const { h } = handler({ rows });

    const manifest = await (await get(h, "?limit=1")).json() as KnowledgeSourceManifest;
    expect(manifest.item_count).toBe(1);
    expect(manifest.next_cursor).toBeDefined();
    expect(parseManifestCursor(manifest.next_cursor)).toEqual({
      sync_version: 7,
      file_id: "f_1",
      high_watermark: HIGH_WATERMARK,
    });
  });

  test("a supplied cursor pins the page keyset and the original high watermark", async () => {
    const { h, params, sql } = handler();
    const cursor = Buffer.from(JSON.stringify({ sync_version: 7, file_id: "f_1", high_watermark: 40 }), "utf8").toString("base64url");

    const manifest = await (await get(h, `?cursor=${cursor}`)).json() as KnowledgeSourceManifest;
    // The watermark travels in the cursor, so a page is never widened mid-walk
    // by writes that landed after the first page.
    expect(manifest.high_watermark).toBe(40);
    expect(sql.some((s) => s.includes("MAX(sync_version)"))).toBe(false);

    const rowsCall = sql.findIndex((s) => s.includes("FROM files f"));
    const bound = params[rowsCall]!;
    expect(bound).toContain(40);
    expect(bound).toContain(7);
    expect(bound).toContain("f_1");
  });

  test("an unreadable cursor is rejected rather than silently restarting the walk", async () => {
    const { h } = handler();
    const res = await get(h, "?cursor=not-a-cursor");
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("cursor");
  });

  test("filters reach SQL instead of being dropped", async () => {
    const { h, sql, params } = handler();
    await get(h, "?source_id=src_1&tag=Handbook&collection_id=col_1&project_id=prj_1&after=2026-01-01&before=2026-12-31");

    const rowsIndex = sql.findIndex((s) => s.includes("FROM files f"));
    const text = sql[rowsIndex]!;
    const bound = params[rowsIndex]!;
    expect(text).toContain("collection_files cf_filter");
    expect(text).toContain("project_files pf_filter");
    expect(text).toContain("file_tags ft_filter");
    expect(text).toContain("ORDER BY f.sync_version ASC, f.id ASC");
    expect(bound).toContain("src_1");
    expect(bound).toContain("col_1");
    expect(bound).toContain("prj_1");
    // tags are stored lowercase, as in listFiles
    expect(bound).toContain("handbook");
    expect(bound).toContain("2026-01-01");
    expect(bound).toContain("2026-12-31");
  });

  test("delta mode is reported and the since_sync_version floor reaches SQL", async () => {
    const { h, sql, params } = handler();
    const manifest = await (await get(h, "?delta=true&since_sync_version=5")).json() as KnowledgeSourceManifest;
    expect(manifest.delta).toBe(true);

    const rowsIndex = sql.findIndex((s) => s.includes("FROM files f"));
    expect(params[rowsIndex]).toContain(5);
    // delta must not silently exclude tombstones
    expect(sql[rowsIndex]).not.toContain("f.status = 'active'");
  });

  test("include_acl_summary is REFUSED, never answered with an empty summary", async () => {
    const { h, sql } = handler();
    const res = await get(h, "?include_acl_summary=true");

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; reason: string };
    expect(body.reason).toBe("acl_summary_unavailable");
    expect(body.error).toContain("does not model file organization reviews");
    // refused before any manifest query runs
    expect(sql.some((s) => s.includes("FROM files f"))).toBe(false);
  });

  test("include_evidence_assets is REFUSED and points at the evidence route", async () => {
    const { h } = handler();
    const res = await get(h, "?include_evidence_assets=1");

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; reason: string };
    expect(body.reason).toBe("evidence_assets_unavailable");
    expect(body.error).toContain("/v1/evidence/assets");
  });

  test("tags and revisions are batched, never one query per row", async () => {
    const rows = [manifestRow({ id: "f_1" }), manifestRow({ id: "f_2" }), manifestRow({ id: "f_3" })];
    const { h, sql, params } = handler({ rows });
    await get(h, "");

    expect(sql.filter((s) => s.includes("FROM file_tags ft JOIN tags t"))).toHaveLength(1);
    expect(sql.filter((s) => s.includes("FROM file_versions"))).toHaveLength(1);
    const tagCall = sql.findIndex((s) => s.includes("FROM file_tags ft JOIN tags t"));
    expect(params[tagCall]![0]).toEqual(["f_1", "f_2", "f_3"]);
  });

  test("a read token is sufficient — the manifest is a read", async () => {
    const { h } = handler();
    const url = new URL("https://files.example.test/v1/knowledge/manifest");
    const res = await h.handle(new Request(url, { headers: { "x-api-key": token("kid-read", ["files:read"]) } }), url);
    expect(res?.status).toBe(200);
  });

  test("an unauthenticated request is refused", async () => {
    const { h } = handler();
    const url = new URL("https://files.example.test/v1/knowledge/manifest");
    const res = await h.handle(new Request(url), url);
    expect(res?.status).toBeGreaterThanOrEqual(400);
  });
});
