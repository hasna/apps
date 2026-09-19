import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { filesAuthorityEnvKeys } from "../lib/local-opt-in.js";
import { buildServer } from "./index.js";

const PROFILE_ENV = "HASNA_FILES_MCP_PROFILE";
const CAPABILITIES = ["MUTATIONS", "DESTRUCTIVE", "IMPORTS", "SIGNED_URLS", "DOWNLOADS", "INDEXING"] as const;
const CAPABILITY_ENVS = [
  "OPEN_FILES_MCP_ALLOW_ALL",
  "OPEN_FILES_ALLOW_ALL",
  ...CAPABILITIES.flatMap((capability) => [
    `OPEN_FILES_MCP_ALLOW_${capability}`,
    `OPEN_FILES_ALLOW_${capability}`,
  ]),
] as const;
const AUTHORITY_ENVS = filesAuthorityEnvKeys();
const HOME_ENVS = ["HOME", "HASNA_HOME", "HASNA_CONFIG_HOME", "HASNA_STATION"] as const;
const savedProfile = process.env[PROFILE_ENV];
const savedCapabilities = new Map(CAPABILITY_ENVS.map((key) => [key, process.env[key]]));
const savedAuthority = new Map(AUTHORITY_ENVS.map((key) => [key, process.env[key]]));
const savedHomes = new Map(HOME_ENVS.map((key) => [key, process.env[key]]));
const savedLocal = process.env.HASNA_FILES_LOCAL;
let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-mcp-output-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
  process.env[PROFILE_ENV] = "standard";
  for (const key of CAPABILITY_ENVS) delete process.env[key];
  for (const key of AUTHORITY_ENVS) delete process.env[key];
  process.env.HOME = testDir;
  process.env.HASNA_HOME = testDir;
  process.env.HASNA_CONFIG_HOME = testDir;
  process.env.HASNA_STATION = "files-output-no-such-station";
  process.env.HASNA_FILES_LOCAL = "1";
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  if (savedProfile === undefined) delete process.env[PROFILE_ENV];
  else process.env[PROFILE_ENV] = savedProfile;
  for (const key of CAPABILITY_ENVS) {
    const value = savedCapabilities.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of AUTHORITY_ENVS) {
    const value = savedAuthority.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of HOME_ENVS) {
    const value = savedHomes.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (savedLocal === undefined) delete process.env.HASNA_FILES_LOCAL;
  else process.env.HASNA_FILES_LOCAL = savedLocal;
  rmSync(testDir, { recursive: true, force: true });
});

describe("Files MCP output efficiency", () => {
  test("standard profile omits capability-disabled mutation tools but full preserves legacy discovery", async () => {
    const standardInventory = await toolInventory("standard");
    const standard = standardInventory.names;
    expect(standard).toContain("list_files");
    expect(standard).toContain("search_files");
    expect(standard).not.toContain("add_source");
    expect(standard).not.toContain("download_file");
    expect(standardInventory.bytes).toBeLessThanOrEqual(16_384);

    process.env.OPEN_FILES_MCP_ALLOW_ALL = "1";
    const maximalStandard = await toolInventory("standard");
    expect(maximalStandard.names).toContain("download_file");
    expect(maximalStandard.bytes).toBeLessThanOrEqual(16_384);

    const hostedStandard = await toolInventory("standard", "api");
    expect(hostedStandard.names).not.toContain("build_context_pack");
    expect(hostedStandard.names).not.toContain("search_context_pack");
    expect(hostedStandard.bytes).toBeLessThanOrEqual(14_000);

    const full = await toolNames("full");
    expect(full).toContain("add_source");
    expect(full).toHaveLength(94);
  });

  test("list_files defaults to a compact page and format=legacy preserves the bare array", async () => {
    await seedFiles(21);
    const { client, close } = await connectedClient();
    try {
      const compact = await client.callTool({ name: "list_files", arguments: { limit: 20 } });
      const compactText = text(compact);
      expect(compactText).not.toContain("\n");
      expect(Buffer.byteLength(compactText)).toBeLessThan(8_000);
      const compactPage = JSON.parse(compactText) as { items: Array<Record<string, unknown>>; _meta: Record<string, unknown> };
      expect(compactPage.items).toHaveLength(20);
      expect(compactPage.items[0]).not.toHaveProperty("description");
      expect(compactPage._meta).toMatchObject({ count: 20, limit: 20, offset: 0, next_offset: 20, has_more: true, complete: false, detail: "compact", max_bytes: 32_768, byte_limited: false });
      expect(compactPage._meta.next_cursor).toEqual(expect.any(String));
      expect(compactPage._meta.byte_length).toBe(Buffer.byteLength(compactText));
      expect(compactText).toBe(JSON.stringify(compactPage));

      const legacy = await client.callTool({ name: "list_files", arguments: { format: "legacy", limit: 20 } });
      const legacyRows = JSON.parse(text(legacy)) as Array<Record<string, unknown>>;
      expect(Array.isArray(legacyRows)).toBe(true);
      expect(legacyRows).toHaveLength(20);
      expect(legacyRows[0]).toHaveProperty("hash");
      expect(text(legacy)).toContain("\n");

      const tail = await client.callTool({
        name: "list_files",
        arguments: { limit: 20, cursor: compactPage._meta.next_cursor },
      });
      expect((JSON.parse(text(tail)) as { items: Array<{ id: string }>; _meta: Record<string, unknown> })).toMatchObject({
        items: [{ id: "f_output_020" }],
        _meta: { offset: 20, cursor: compactPage._meta.next_cursor, next_cursor: null, has_more: false },
      });

      const mismatch = await client.callTool({
        name: "list_files",
        arguments: { source_id: "different", cursor: compactPage._meta.next_cursor },
      });
      expect(mismatch.isError).toBe(true);
      expect(text(mismatch)).toContain("does not match this query");

      const full = await client.callTool({ name: "list_files", arguments: { limit: 1, detail: "full" } });
      const fullPage = JSON.parse(text(full)) as { items: Array<Record<string, unknown>> };
      expect(fullPage.items[0]).toHaveProperty("hash");

      const exact = await client.callTool({ name: "get_file", arguments: { id: "f_output_000" } });
      expect(text(exact)).not.toContain("\n");
      expect(JSON.parse(text(exact))).toHaveProperty("hash");

      const incompatible = await client.callTool({
        name: "list_files",
        arguments: { limit: 1, detail: "full", max_bytes: 4096 },
      });
      expect(incompatible.isError).toBe(true);
      expect(text(incompatible)).toContain("max_bytes cannot be combined with detail=full");
    } finally {
      await close();
    }
  });

  test("search_files defaults to compact projection and keeps format=legacy compatibility", async () => {
    await seedFiles(21);
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "search_files",
        arguments: { query: "contract", limit: 20, fields: ["name", "size"] },
      });
      const body = text(result);
      expect(body).not.toContain("\n");
      const page = JSON.parse(body) as { items: Array<Record<string, unknown>>; _meta: Record<string, unknown> };
      expect(page.items).toHaveLength(20);
      expect(Object.keys(page.items[0]!)).toEqual(["id", "name", "size"]);
      expect(page._meta).toMatchObject({ count: 20, next_offset: 20, has_more: true, complete: false, fields: ["id", "name", "size"] });
      expect(page._meta.next_cursor).toEqual(expect.any(String));
      expect(body).toBe(JSON.stringify(page));

      const legacy = await client.callTool({
        name: "search_files",
        arguments: { query: "contract", format: "legacy", limit: 1 },
      });
      expect(Array.isArray(JSON.parse(text(legacy)))).toBe(true);

      const tail = await client.callTool({
        name: "search_files",
        arguments: { query: "contract", limit: 20, cursor: page._meta.next_cursor },
      });
      expect((JSON.parse(text(tail)) as { _meta: Record<string, unknown> })._meta).toMatchObject({
        count: 1,
        offset: 20,
        has_more: false,
        end_reached: true,
        complete: false,
        cursor: page._meta.next_cursor,
        next_cursor: null,
      });
    } finally {
      await close();
    }
  });

  test("hosted list refuses sync_status rather than returning the wrong population", async () => {
    const { client, close } = await connectedClient("api");
    try {
      const result = await client.callTool({
        name: "list_files",
        arguments: { sync_status: "synced" },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("refusing to ignore the filter");
    } finally {
      await close();
    }
  });

  test("hosted list/search use /v1, refresh credentials between the page and probe, and never open SQLite", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: `f_hosted_${index}`,
      source_id: "src_hosted",
      machine_id: "m_hosted",
      path: `contracts/${index}.pdf`,
      name: `${index}.pdf`,
      ext: ".pdf",
      size: index + 1,
      mime: "application/pdf",
      status: "active",
      indexed_at: "2026-09-17T00:00:00.000Z",
      created_at: "2026-09-17T00:00:00.000Z",
      tags: [],
      rank: 0.5,
      search_match_sources: ["metadata"],
    }));
    const firstKey = "fixture-files-first";
    const rotatedKey = "fixture-files-rotated";
    const hits: Array<{ path: string; limit: number; offset: number; authenticated: boolean; query: string | null }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const expectedKey = hits.length === 0 ? firstKey : rotatedKey;
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        hits.push({
          path: url.pathname,
          limit,
          offset,
          query: url.searchParams.get("q"),
          authenticated: request.headers.get("x-api-key") === expectedKey
            && request.headers.get("authorization") === `Bearer ${expectedKey}`,
        });
        if (hits.length === 1) process.env.HASNA_FILES_API_KEY = rotatedKey;
        return Response.json(rows.slice(offset, offset + limit));
      },
    });
    delete process.env.HASNA_FILES_LOCAL;
    process.env.HASNA_FILES_API_URL = `http://127.0.0.1:${server.port}`;
    process.env.HASNA_FILES_API_KEY = firstKey;
    const { client, close } = await connectedClient("api");
    try {
      const listed = await client.callTool({
        name: "list_files",
        arguments: { format: "page", limit: 500, max_bytes: 1024 * 1024 },
      });
      const listPage = JSON.parse(text(listed)) as { items: unknown[]; _meta: Record<string, unknown> };
      expect(listPage.items).toHaveLength(500);
      expect(listPage._meta).toMatchObject({ has_more: true, next_offset: 500 });
      expect(hits.slice(0, 2)).toEqual([
        { path: "/v1/files", limit: 500, offset: 0, authenticated: true, query: null },
        { path: "/v1/files", limit: 1, offset: 500, authenticated: true, query: null },
      ]);

      const searched = await client.callTool({
        name: "search_files",
        arguments: { query: "contract", format: "page", limit: 20 },
      });
      const searchPage = JSON.parse(text(searched)) as { items: unknown[]; _meta: Record<string, unknown> };
      expect(searchPage.items).toHaveLength(20);
      expect(hits.at(-1)).toMatchObject({ path: "/v1/files", limit: 21, offset: 0, authenticated: true, query: "contract" });
      expect(existsSync(join(testDir, "files.db"))).toBe(false);
    } finally {
      await close();
      server.stop(true);
    }
  });

  test("all=true exhausts safely and returns a whole-query completion receipt", async () => {
    await seedFiles(1_001);
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "list_files",
        arguments: { format: "page", all: true, max_bytes: 1024 * 1024 },
      });
      const page = JSON.parse(text(result)) as { items: unknown[]; _meta: Record<string, unknown> };
      expect(page.items).toHaveLength(1_001);
      expect(page._meta).toMatchObject({
        count: 1_001,
        limit: 5_000,
        offset: 0,
        next_offset: null,
        has_more: false,
        end_reached: true,
        complete: true,
        all: true,
      });

      const searched = await client.callTool({
        name: "search_files",
        arguments: { query: "contract", format: "page", all: true, max_bytes: 1024 * 1024 },
      });
      expect((JSON.parse(text(searched)) as { items: unknown[]; _meta: Record<string, unknown> })).toMatchObject({
        items: expect.any(Array),
        _meta: { count: 1_001, complete: true, all: true },
      });

      const legacyAll = await client.callTool({
        name: "list_files",
        arguments: { format: "legacy", all: true },
      });
      expect(legacyAll.isError).toBe(true);
      expect(text(legacyAll)).toContain("require format=page");

      const offsetAll = await client.callTool({
        name: "list_files",
        arguments: { format: "page", all: true, offset: 1 },
      });
      expect(offsetAll.isError).toBe(true);
      expect(text(offsetAll)).toContain("requires offset=0");

      const tooSmall = await client.callTool({
        name: "list_files",
        arguments: { format: "page", all: true, max_bytes: 1024 },
      });
      expect(tooSmall.isError).toBe(true);
      expect(text(tooSmall)).toContain("use paginated format=page output");
    } finally {
      await close();
    }
  });

});

async function toolInventory(profile: string, transport: "api" | "local" = "local"): Promise<{ names: string[]; bytes: number }> {
  process.env[PROFILE_ENV] = profile;
  const { client, close } = await connectedClient(transport);
  try {
    const inventory = await client.listTools();
    return {
      names: inventory.tools.map((tool) => tool.name),
      bytes: Buffer.byteLength(JSON.stringify(inventory)),
    };
  } finally {
    await close();
  }
}

async function toolNames(profile: string): Promise<string[]> {
  return (await toolInventory(profile)).names;
}

async function seedFiles(count: number): Promise<void> {
  const { getCurrentMachine } = await import("../db/machines.js");
  const { createSource } = await import("../db/sources.js");
  const { upsertFile } = await import("../db/files.js");
  const machine = getCurrentMachine();
  const source = createSource({ name: "Output fixture", type: "local", path: testDir, machine_id: machine.id });
  for (let i = 0; i < count; i++) {
    upsertFile({
      id: `f_output_${String(i).padStart(3, "0")}`,
      source_id: source.id,
      machine_id: machine.id,
      path: `folder/${i}/contract.pdf`,
      name: `contract-${i}.pdf`,
      ext: ".pdf",
      size: 1_000 + i,
      mime: "application/pdf",
      hash: String(i).padStart(64, "0"),
      status: "active",
      description: "x".repeat(1_000),
    });
  }
}

async function connectedClient(transport: "api" | "local" = "local"): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer({ transport });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "files-output-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function text(result: { content?: unknown }): string {
  return (result.content as Array<{ text: string }>)[0]!.text;
}
