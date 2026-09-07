import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";

/**
 * Behavior lock for the per-tool transport triage of the 26 `requireLocalTransport`
 * gates (local-only-capability-removal workflow, task c4459d0c, 2026-08-18):
 *
 * Read-side tools are ported to the hosted /v1 path: `download_file`,
 * `get_file_content`, `extract_file_text`, `extract_file_snapshot`,
 * `describe_file`, and `get_file_url` must route through the ApiStore's hosted
 * routes in api mode instead of refusing. Write/ingest/mechanism-local tools
 * keep the local-transport guard, and the api-mode refusal must fire with the
 * documented reason — never silently reading or writing the local SQLite island
 * (the split-brain this guard exists to close). These tests make both halves
 * checkable as behavior, not prose.
 */

const ENV_KEYS = [
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
  "HASNA_FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "OPEN_FILES_MCP_ALLOW_DOWNLOADS",
  "OPEN_FILES_MCP_ALLOW_SIGNED_URLS",
  "OPEN_FILES_MCP_ALLOW_ALL",
] as const;

const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

function setLocalMode() {
  testDir = mkdtempSync(join(tmpdir(), "files-mcp-transport-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
  delete process.env.HASNA_FILES_API_URL;
  delete process.env.HASNA_FILES_API_KEY;
  process.env.OPEN_FILES_MCP_ALLOW_DOWNLOADS = "1";
  process.env.OPEN_FILES_MCP_ALLOW_SIGNED_URLS = "1";
  process.env.OPEN_FILES_MCP_ALLOW_ALL = "1";
}

beforeEach(() => {
  setLocalMode();
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "mcp-transport-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const HOSTED_FILE = {
  id: "f_hosted1",
  source_id: "src_1",
  machine_id: "m_1",
  path: "notes.md",
  name: "notes.md",
  ext: ".md",
  size: 34,
  mime: "text/markdown",
  status: "active",
  indexed_at: "2026-08-18T00:00:00.000Z",
  created_at: "2026-08-18T00:00:00.000Z",
  modified_at: "2026-08-18T00:00:00.000Z",
  tags: [],
};

const HOSTED_CONTENT = "hello hosted files\nline two\nline three\n";

const HOSTED_EXTRACT = {
  source_ref: "open-files://file/f_hosted1",
  file_id: "f_hosted1",
  status: "ready",
  mime: "text/markdown",
  bytes_read: 34,
  truncated: false,
  redacted: false,
  segments: [
    {
      index: 0,
      text: "hello hosted files",
      byte_start: 0,
      byte_end: 18,
      char_start: 0,
      char_end: 18,
      line_start: 1,
      line_end: 1,
    },
    {
      index: 1,
      text: "line two",
      byte_start: 19,
      byte_end: 27,
      char_start: 19,
      char_end: 27,
      line_start: 2,
      line_end: 2,
    },
  ],
  metadata: {
    extractor: "hosted-extractor",
    max_bytes: 262144,
    max_segment_chars: 4000,
    supported_mime: true,
  },
};

interface FakeServer {
  baseUrl: string;
  hits: Array<{ method: string; path: string; search?: URLSearchParams; body?: unknown }>;
  close: () => Promise<void>;
}

async function startFakeServer(): Promise<FakeServer> {
  const hits: Array<{ method: string; path: string; search?: URLSearchParams; body?: unknown }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/v1/, "") || "/";
      const method = req.method;
      hits.push({ method, path, search: url.searchParams, body: method === "POST" ? await req.json().catch(() => undefined) : undefined });
      const m = path.match(/^\/files\/([^/]+)\/content$/);
      if (method === "GET" && m) {
        return new Response(HOSTED_CONTENT, { headers: { "Content-Type": "text/markdown" } });
      }
      const ex = path.match(/^\/files\/([^/]+)\/extract-text$/);
      if (method === "POST" && ex) {
        return Response.json(HOSTED_EXTRACT);
      }
      const sd = path.match(/^\/files\/([^/]+)\/sign-download$/);
      if (method === "POST" && sd) {
        return Response.json({ url: "https://s3.example.test/presigned-f_hosted1" });
      }
      const f = path.match(/^\/files\/([^/]+)$/);
      if (method === "GET" && f) {
        return Response.json(HOSTED_FILE);
      }
      // Cloud ingestion (bug de9aeeed): fake hosted /v1 accepts upload intents,
      // the byte PUT, and completion.
      if (method === "POST" && path === "/files") {
        return Response.json(
          { file_id: "f_hosted_upload", upload_url: `${url.origin}/uploads/f_hosted_upload`, method: "PUT", required_headers: { "content-type": "application/octet-stream" } },
          { status: 201 },
        );
      }
      const up = path.match(/^\/uploads\/([^/]+)$/);
      if (method === "PUT" && up) {
        return new Response("ok", { status: 200 });
      }
      const comp = path.match(/^\/files\/([^/]+)\/complete$/);
      if (method === "POST" && comp) {
        return Response.json({ file: { ...HOSTED_FILE, id: comp[1]!, tags: ["partner-deal"] } });
      }
      return new Response(JSON.stringify({ error: `fake server: no route ${method} ${path}` }), { status: 404 });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    hits,
    close: () => server.stop(true),
  };
}

function callText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("");
}

// ─── Ported read-side tools: hosted (api) transport ──────────────────────────

describe("ported read-side MCP tools on the hosted (api) transport", () => {
  let fake: FakeServer;
  let envRestore: (() => void) | null = null;

  beforeEach(async () => {
    fake = await startFakeServer();
    const old = new Map<string, string | undefined>();
    for (const key of ENV_KEYS) old.set(key, process.env[key]);
    process.env.HASNA_FILES_API_URL = fake.baseUrl;
    process.env.HASNA_FILES_API_KEY = "k_test";
    process.env.OPEN_FILES_MCP_ALLOW_DOWNLOADS = "1";
    process.env.OPEN_FILES_MCP_ALLOW_SIGNED_URLS = "1";
    process.env.OPEN_FILES_MCP_ALLOW_ALL = "1";
    envRestore = () => {
      for (const [key, value] of old) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    };
  });

  afterEach(async () => {
    await fake.close();
    envRestore?.();
  });

  test("download_file streams the hosted content route to the destination path", async () => {
    const { client, close } = await connectedClient();
    try {
      const dest = join(testDir!, "downloaded.md");
      const result = await client.callTool({
        name: "download_file",
        arguments: { id: "f_hosted1", dest },
      });
      expect(result.isError).not.toBe(true);
      expect(callText(result)).toContain(`Downloaded to: ${dest}`);
      expect(readFileSync(dest, "utf8")).toBe(HOSTED_CONTENT);
      expect(fake.hits.some((h) => h.method === "GET" && h.path === "/files/f_hosted1/content")).toBe(true);
    } finally {
      await close();
    }
  });

  test("get_file_content returns hosted text with a truncation suffix when capped", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "get_file_content",
        arguments: { id: "f_hosted1", max_bytes: 8 },
      });
      expect(result.isError).not.toBe(true);
      const text = callText(result);
      expect(text.startsWith("hello ho")).toBe(true);
      expect(text).toContain("[truncated");
      expect(fake.hits.some((h) => h.method === "GET" && h.path === "/files/f_hosted1/content")).toBe(true);
    } finally {
      await close();
    }
  });

  test("get_file_content asks the hosted server for only the bounded bytes", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "get_file_content",
        arguments: { id: "f_hosted1", max_bytes: 8 },
      });
      expect(result.isError).not.toBe(true);
      const hit = fake.hits.find((h) => h.method === "GET" && h.path === "/files/f_hosted1/content");
      expect(hit).toBeDefined();
      expect(hit!.search?.get("max_bytes")).toBe("8");
    } finally {
      await close();
    }
  });

  test("get_file_content keeps the truncation marker when the server honors max_bytes", async () => {
    // A server that honors max_bytes returns exactly `bound` bytes with a
    // truncation header — the chunk loop cannot detect the oversized object
    // on its own, so the marker must come from the server signal.
    const hits: Array<{ method: string; path: string; search?: URLSearchParams }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        hits.push({ method: req.method, path: url.pathname.replace(/^\/v1/, ""), search: url.searchParams });
        const m = url.pathname.replace(/^\/v1/, "").match(/^\/files\/([^/]+)\/content$/);
        if (req.method === "GET" && m) {
          const maxBytes = Number(url.searchParams.get("max_bytes"));
          const bytes = HOSTED_CONTENT.slice(0, maxBytes);
          return new Response(bytes, {
            headers: {
              "Content-Type": "text/markdown",
              ...(maxBytes < HOSTED_CONTENT.length ? { "x-files-truncated": "1", "x-files-size": String(HOSTED_CONTENT.length) } : {}),
            },
          });
        }
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      },
    });
    const old = new Map<string, string | undefined>();
    for (const key of ENV_KEYS) old.set(key, process.env[key]);
    process.env.HASNA_FILES_API_URL = `http://127.0.0.1:${server.port}/v1`;
    process.env.HASNA_FILES_API_KEY = "k_test";
    try {
      const { client, close } = await connectedClient();
      try {
        const result = await client.callTool({
          name: "get_file_content",
          arguments: { id: "f_hosted1", max_bytes: 8 },
        });
        expect(result.isError).not.toBe(true);
        const text = callText(result);
        expect(text.startsWith("hello ho")).toBe(true);
        expect(text).toContain("[truncated");
      } finally {
        await close();
      }
    } finally {
      server.stop(true);
      for (const [key, value] of old) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      }
  });

  test("extract_file_text posts to the hosted extract-text route and returns the result", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "extract_file_text",
        arguments: { id: "f_hosted1", max_bytes: 262144 },
      });
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(callText(result)) as { segments: Array<{ text: string }> };
      expect(parsed.segments[0]?.text).toBe("hello hosted files");
      const hit = fake.hits.find((h) => h.method === "POST" && h.path === "/files/f_hosted1/extract-text");
      expect(hit).toBeDefined();
      expect((hit!.body as Record<string, unknown>).max_bytes).toBe(262144);
    } finally {
      await close();
    }
  });

  test("extract_file_snapshot derives a deterministic snapshot from the hosted extract-text result", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "extract_file_snapshot",
        arguments: { id: "f_hosted1" },
      });
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(callText(result)) as { snapshot_id: string; pages: Array<unknown>; metadata: { source_segments: number } };
      expect(parsed.snapshot_id.startsWith("snap_")).toBe(true);
      expect(parsed.metadata.source_segments).toBe(2);
      expect(fake.hits.some((h) => h.method === "POST" && h.path === "/files/f_hosted1/extract-text")).toBe(true);
    } finally {
      await close();
    }
  });

  test("describe_file merges hosted metadata with a content preview", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "describe_file",
        arguments: { id: "f_hosted1", lines: 2 },
      });
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(callText(result)) as {
        id: string;
        source_name: string;
        storage: { kind: string };
        preview: string;
      };
      expect(parsed.id).toBe("f_hosted1");
      expect(parsed.preview).toContain("hello hosted files");
      expect(parsed.preview.split("\n").length).toBeLessThanOrEqual(2);
      expect(fake.hits.some((h) => h.method === "GET" && h.path === "/files/f_hosted1")).toBe(true);
      expect(fake.hits.some((h) => h.method === "GET" && h.path === "/files/f_hosted1/content")).toBe(true);
    } finally {
      await close();
    }
  });

  test("describe_file bounds its preview read on the hosted server", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "describe_file",
        arguments: { id: "f_hosted1", lines: 2 },
      });
      expect(result.isError).not.toBe(true);
      const hit = fake.hits.find((h) => h.method === "GET" && h.path === "/files/f_hosted1/content");
      expect(hit).toBeDefined();
      expect(hit!.search?.get("max_bytes")).toBe("262144");
    } finally {
      await close();
    }
  });

  test("get_file_url signs the hosted route and returns the URL", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "get_file_url",
        arguments: { id: "f_hosted1", expires_in: 600 },
      });
      expect(result.isError).not.toBe(true);
      expect(callText(result)).toBe("https://s3.example.test/presigned-f_hosted1");
      const hit = fake.hits.find((h) => h.method === "POST" && h.path === "/files/f_hosted1/sign-download");
      expect(hit).toBeDefined();
      expect((hit!.body as Record<string, unknown>).expires_in).toBe(600);
    } finally {
      await close();
    }
  });

  test("upload_file ingests a local document through the hosted transport as a tagged project resource", async () => {
    const fixture = join(testDir!, "partner-contract.pdf");
    writeFileSync(fixture, "contract bytes");
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "upload_file",
        arguments: { local_path: fixture, project_id: "prj_deal1", tags: ["partner-deal"] },
      });
      expect(result.isError).not.toBe(true);
      const text = callText(result);
      expect(text).toContain("f_hosted_upload");
      expect(text).toContain("prj_deal1");
      expect(text).toContain("partner-deal");
      // Cloud ingestion happens through the hosted routes, not an on-box refusal.
      expect(fake.hits.some((h) => h.method === "POST" && h.path === "/files")).toBe(true);
      expect(fake.hits.some((h) => h.method === "POST" && h.path === "/files/f_hosted_upload/complete")).toBe(true);
    } finally {
      await close();
    }
  });
});

// ─── Kept local-only tools: api-mode refusal with the recorded reason ─────────

describe("write/ingest MCP tools keep the local-transport guard in api mode", () => {
  const LOCAL_ONLY_TOOLS: Array<{ tool: string; args: Record<string, unknown> }> = [
    { tool: "add_google_drive_source", args: { profile: "test-profile" } },
    { tool: "list_google_drive_items", args: { source_id: "src_1" } },
    { tool: "preflight_google_drive_sync", args: { source_id: "src_1" } },
    { tool: "sync_google_drive", args: {} },
    { tool: "index_source", args: {} },
    { tool: "build_context_pack", args: {} },
    { tool: "search_context_pack", args: { query: "anything" } },
    { tool: "export_knowledge_manifest", args: {} },
    { tool: "resolve_knowledge_source", args: { source_ref: "open-files://file/f_hosted1" } },
    { tool: "doctor_knowledge_sources", args: {} },
    { tool: "resolve_extracted_text", args: { source_ref: "open-files://file/f_hosted1" } },
    { tool: "poll_knowledge_outbox", args: {} },
    { tool: "ack_knowledge_outbox", args: { consumer_id: "consumer-1", cursor: 1 } },
    { tool: "copy_file", args: { file_id: "f_hosted1", dest_source_id: "src_2" } },
    { tool: "import_from_url", args: { url: "https://example.test/a.txt", dest_source_id: "src_1" } },
    { tool: "import_from_local", args: { path: "/tmp/nope.txt", dest_source_id: "src_1" } },
    { tool: "bulk_import", args: { items: [{ url_or_path: "https://example.test/a.txt" }], dest_source_id: "src_1" } },
    { tool: "watch_source", args: { source_id: "src_1" } },
    { tool: "resolve_file_storage", args: { id: "f_hosted1" } },
  ];

  beforeEach(async () => {
    process.env.HASNA_FILES_API_URL = "https://files.example.test/v1";
    process.env.HASNA_FILES_API_KEY = "k_test";
    process.env.OPEN_FILES_MCP_ALLOW_ALL = "1";
  });

  for (const { tool, args } of LOCAL_ONLY_TOOLS) {
    test(`${tool} refuses in api mode with the recorded reason, never touching the local island`, async () => {
      const { client, close } = await connectedClient();
      try {
        const result = await client.callTool({ name: tool, arguments: args });
        expect(result.isError).toBe(true);
        const text = callText(result);
        expect(text).toContain("runs on-box only");
        expect(text).toContain("hosted transport");
      } finally {
        await close();
      }
    });
  }
});

// ─── Ported tools still work on the local transport (positive control) ───────

describe("ported read-side MCP tools on the local transport (positive control)", () => {
  let sourceRoot: string;

  beforeEach(() => {
    sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "notes.md"), "hello local files\nline two\nline three\n");
  });

  test("download_file, get_file_content, describe_file, extract_file_text, extract_file_snapshot and get_file_url answer against the on-box store", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "MCP transport source",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    upsertFile({
      id: "f_local1",
      source_id: source.id,
      machine_id: machine.id,
      path: "notes.md",
      name: "notes.md",
      ext: ".md",
      size: Buffer.byteLength("hello local files\nline two\nline three\n"),
      mime: "text/markdown",
      hash: "b".repeat(64),
      status: "active",
      modified_at: "2026-08-18T00:00:00.000Z",
    });

    const { client, close } = await connectedClient();
    try {
      const download = await client.callTool({ name: "download_file", arguments: { id: "f_local1" } });
      expect(download.isError).not.toBe(true);
      expect(callText(download)).toContain("Local file:");

      const content = await client.callTool({ name: "get_file_content", arguments: { id: "f_local1" } });
      expect(content.isError).not.toBe(true);
      expect(callText(content)).toContain("hello local files");

      const describe = await client.callTool({ name: "describe_file", arguments: { id: "f_local1" } });
      expect(describe.isError).not.toBe(true);
      const described = JSON.parse(callText(describe)) as { id: string; preview: string };
      expect(described.id).toBe("f_local1");
      expect(described.preview).toContain("hello local files");

      const extract = await client.callTool({ name: "extract_file_text", arguments: { id: "f_local1" } });
      expect(extract.isError).not.toBe(true);
      const extracted = JSON.parse(callText(extract)) as { segments: Array<{ text: string }> };
      expect(extracted.segments.some((s) => s.text.includes("hello local files"))).toBe(true);

      const snapshot = await client.callTool({ name: "extract_file_snapshot", arguments: { id: "f_local1" } });
      expect(snapshot.isError).not.toBe(true);
      expect(JSON.parse(callText(snapshot))).toMatchObject({ status: "ready" });

      // A local-source file has no S3 backing: get_file_url must refuse for the
      // S3-only contract (same behavior as before the port).
      const url = await client.callTool({ name: "get_file_url", arguments: { id: "f_local1" } });
      expect(url.isError).toBe(true);
      expect(callText(url)).toContain("only works with S3-backed files");
    } finally {
      await close();
    }
  });
});
