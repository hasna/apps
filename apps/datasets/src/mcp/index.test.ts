import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATASETS_DB_PATH_ENV, DATASETS_HOME_ENV, ingestDataset } from "../storage.js";
import { buildServer } from "./index.js";

const ENV_KEYS = [
  DATASETS_HOME_ENV,
  DATASETS_DB_PATH_ENV,
  "OPEN_DATASETS_MCP_ALLOW_MUTATIONS",
  "OPEN_DATASETS_MCP_ALLOW_IMPORTS",
  "OPEN_DATASETS_MCP_ALLOW_ALL",
  "OPEN_DATASETS_MCP_ALLOW_SENSITIVE_READS",
  "OPEN_DATASETS_ALLOW_ALL",
  "OPEN_DATASETS_ALLOW_SENSITIVE_READS",
] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "datasets-mcp-"));
  process.env[DATASETS_HOME_ENV] = testDir;
  process.env[DATASETS_DB_PATH_ENV] = join(testDir, "datasets.db");
  delete process.env.OPEN_DATASETS_MCP_ALLOW_MUTATIONS;
  delete process.env.OPEN_DATASETS_MCP_ALLOW_IMPORTS;
  delete process.env.OPEN_DATASETS_MCP_ALLOW_ALL;
  delete process.env.OPEN_DATASETS_MCP_ALLOW_SENSITIVE_READS;
  delete process.env.OPEN_DATASETS_ALLOW_ALL;
  delete process.env.OPEN_DATASETS_ALLOW_SENSITIVE_READS;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("datasets MCP", () => {
  test("read tools work by default", async () => {
    ingestDataset({
      name: "Bank shortlist",
      projectId: "swiss-bank-account",
      rows: [{ bank: "Mirabaud", status: "research" }],
    });
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_preview",
        arguments: { dataset: "bank-shortlist", project: "swiss-bank-account", limit: 1 },
      });
      expect(result.isError).not.toBe(true);
      const preview = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(preview.rows[0]).toMatchObject({ bank: "[redacted]" });
    } finally {
      await close();
    }
  });

  test("schema inference refuses raw local paths by default", async () => {
    const csvPath = join(testDir!, "raw.csv");
    writeFileSync(csvPath, "name\nsecret\n");
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_schema_infer",
        arguments: { ref: csvPath },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain("Registered source or dataset not found");
    } finally {
      await close();
    }
  });

  test("mutation tools fail closed by default", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_sources_add",
        arguments: { target: "memory://blocked", name: "Blocked" },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain("requires explicit capability");
    } finally {
      await close();
    }
  });

  test("mutation tools run when explicitly enabled", async () => {
    process.env.OPEN_DATASETS_MCP_ALLOW_MUTATIONS = "1";
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_sources_add",
        arguments: { target: "memory://allowed", name: "Allowed", kind: "manual", project: "swiss-bank-account" },
      });
      expect(result.isError).not.toBe(true);
      const source = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(source).toMatchObject({ name: "Allowed", kind: "manual", projectId: "swiss-bank-account" });
    } finally {
      await close();
    }
  });

  test("sensitive reads fail closed on preview and render without the capability", async () => {
    ingestDataset({
      name: "Priv",
      projectId: "swiss-bank-account",
      classification: "private",
      rows: [{ id: "p1", tax_id: "secret" }],
    });
    const { client, close } = await connectedClient();
    try {
      const preview = await client.callTool({
        name: "datasets_preview",
        arguments: { dataset: "priv", project: "swiss-bank-account", redact: false },
      });
      expect(preview.isError).toBe(true);
      expect((preview.content as Array<{ text: string }>)[0]?.text).toContain("OPEN_DATASETS_MCP_ALLOW_SENSITIVE_READS");

      const render = await client.callTool({
        name: "datasets_render",
        arguments: { dataset: "priv", project: "swiss-bank-account", redact: false },
      });
      expect(render.isError).toBe(true);
      expect((render.content as Array<{ text: string }>)[0]?.text).toContain("OPEN_DATASETS_MCP_ALLOW_SENSITIVE_READS");
    } finally {
      await close();
    }
  });

  test("public datasets allow unredacted reads without the sensitive capability", async () => {
    ingestDataset({
      name: "Pub",
      projectId: "swiss-bank-account",
      classification: "public",
      rows: [{ id: "p2", tax_id: "visible" }],
    });
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_preview",
        arguments: { dataset: "pub", project: "swiss-bank-account", redact: false },
      });
      expect(result.isError).not.toBe(true);
      const preview = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(preview.rows[0]).toMatchObject({ id: "p2", tax_id: "visible" });
    } finally {
      await close();
    }
  });

  test("sensitive reads unlock through the capability env var", async () => {
    ingestDataset({
      name: "Priv",
      projectId: "swiss-bank-account",
      classification: "private",
      rows: [{ id: "p1", tax_id: "secret" }],
    });
    process.env.OPEN_DATASETS_MCP_ALLOW_SENSITIVE_READS = "1";
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_preview",
        arguments: { dataset: "priv", project: "swiss-bank-account", redact: false },
      });
      expect(result.isError).not.toBe(true);
      const preview = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(preview.rows[0]).toMatchObject({ id: "p1", tax_id: "secret" });
    } finally {
      await close();
    }
  });

  test("legacy allow-all env vars enable mutations and sensitive reads", async () => {
    ingestDataset({
      name: "Priv",
      projectId: "swiss-bank-account",
      classification: "private",
      rows: [{ id: "p1", tax_id: "secret" }],
    });
    process.env.OPEN_DATASETS_ALLOW_ALL = "1";
    const { client, close } = await connectedClient();
    try {
      const add = await client.callTool({
        name: "datasets_sources_add",
        arguments: { target: "memory://allowed", name: "Allowed", kind: "manual" },
      });
      expect(add.isError).not.toBe(true);

      const preview = await client.callTool({
        name: "datasets_preview",
        arguments: { dataset: "priv", project: "swiss-bank-account", redact: false },
      });
      expect(preview.isError).not.toBe(true);
      const payload = JSON.parse((preview.content as Array<{ text: string }>)[0]!.text);
      expect(payload.rows[0]).toMatchObject({ id: "p1", tax_id: "secret" });
    } finally {
      await close();
    }
  });

  test("ingest requires the imports capability in addition to mutations", async () => {
    process.env.OPEN_DATASETS_MCP_ALLOW_MUTATIONS = "1";
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_ingest",
        arguments: { source: "/tmp/nonexistent.json", name: "Blocked" },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain("imports");
    } finally {
      await close();
    }
  });

  test("returns isError for missing refs on show, render canvas, and schema infer", async () => {
    const { client, close } = await connectedClient();
    try {
      const show = await client.callTool({ name: "datasets_show", arguments: { dataset: "nope" } });
      expect(show.isError).toBe(true);
      expect((show.content as Array<{ text: string }>)[0]?.text).toContain("Dataset not found: nope");

      const canvas = await client.callTool({ name: "datasets_render_canvas", arguments: { project: "swiss-bank-account", dataset: "nope" } });
      expect(canvas.isError).toBe(true);
      expect((canvas.content as Array<{ text: string }>)[0]?.text).toContain("Dataset not found: nope");

      const infer = await client.callTool({ name: "datasets_schema_infer", arguments: { ref: "nope" } });
      expect(infer.isError).toBe(true);
      expect((infer.content as Array<{ text: string }>)[0]?.text).toContain("Registered source or dataset not found");
    } finally {
      await close();
    }
  });

  test("lists projections as an empty array for a missing dataset", async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({ name: "datasets_projections_list", arguments: { dataset: "nope" } });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(payload).toEqual([]);
    } finally {
      await close();
    }
  });

  test("exposes the full inventory of fourteen tools", async () => {
    const { client, close } = await connectedClient();
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "datasets_storage_status",
        "datasets_sources_list",
        "datasets_sources_add",
        "datasets_list",
        "datasets_show",
        "datasets_preview",
        "datasets_ingest",
        "datasets_schema_infer",
        "datasets_projections_create",
        "datasets_projections_list",
        "datasets_render",
        "datasets_render_canvas",
        "datasets_project_panel",
        "datasets_init",
      ]);
    } finally {
      await close();
    }
  });

  test("honors only the truthy capability spellings", async () => {
    const truthy = ["1", "true", "yes", "on"];
    const falsy = ["0", "false", "no", "off", "", "TRUE", "y"];
    for (const spelling of [...truthy, ...falsy]) {
      process.env.OPEN_DATASETS_MCP_ALLOW_MUTATIONS = spelling;
      const { client, close } = await connectedClient();
      try {
        const result = await client.callTool({
          name: "datasets_sources_add",
          arguments: { target: "memory://x", name: "X", kind: "manual" },
        });
        if (truthy.includes(spelling)) {
          expect(result.isError, `spelling ${spelling} should enable mutations`).not.toBe(true);
        } else {
          expect(result.isError, `spelling ${spelling} must not enable mutations`).toBe(true);
        }
      } finally {
        await close();
      }
    }
  });

  test("ingests CSV through MCP with the same quoted-cell parsing as the CLI", async () => {
    process.env.OPEN_DATASETS_MCP_ALLOW_MUTATIONS = "1";
    process.env.OPEN_DATASETS_MCP_ALLOW_IMPORTS = "1";
    const csvPath = join(testDir!, "quoted.csv");
    writeFileSync(csvPath, 'name,note\n"Bank, A","He said ""hi"""\n');
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_ingest",
        arguments: { source: csvPath, name: "Mcp Csv", classification: "public" },
      });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(payload.dataset.rowCount).toBe(1);

      const preview = await client.callTool({
        name: "datasets_preview",
        arguments: { dataset: "mcp-csv", limit: 5, redact: false },
      });
      const previewed = JSON.parse((preview.content as Array<{ text: string }>)[0]!.text);
      expect(previewed.rows).toEqual([{ name: "Bank, A", note: 'He said "hi"' }]);
    } finally {
      await close();
    }
  });

  test("ingests scalar JSON rows as empty objects through MCP", async () => {
    process.env.OPEN_DATASETS_MCP_ALLOW_MUTATIONS = "1";
    process.env.OPEN_DATASETS_MCP_ALLOW_IMPORTS = "1";
    const jsonPath = join(testDir!, "scalars.json");
    writeFileSync(jsonPath, JSON.stringify(["a", "b"]));
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_ingest",
        arguments: { source: jsonPath, name: "Scalars", classification: "public" },
      });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(payload.dataset.rowCount).toBe(2);
      expect(payload.dataset.schema).toEqual({ type: "object", properties: {}, required: [] });
    } finally {
      await close();
    }
  });

  test("ingest accepts project-style JSON records wrappers over MCP", async () => {
    process.env.OPEN_DATASETS_MCP_ALLOW_MUTATIONS = "1";
    process.env.OPEN_DATASETS_MCP_ALLOW_IMPORTS = "1";
    const jsonPath = join(testDir!, "records-wrapper.json");
    writeFileSync(jsonPath, JSON.stringify({
      schema_version: "hasna.project.dataset.v1",
      dataset: { slug: "records-wrapper" },
      records: [
        { id: "BANK-MIRABAUD", status: "candidate" },
        { id: "BANK-IBS", status: "needs-verification" },
      ],
    }));
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "datasets_ingest",
        arguments: {
          source: jsonPath,
          name: "Records Wrapper",
          project: "swiss-bank-account",
          classification: "private",
        },
      });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(payload.dataset).toMatchObject({
        slug: "records-wrapper",
        projectId: "swiss-bank-account",
        rowCount: 2,
      });
      expect(Object.keys(payload.dataset.schema.properties ?? {})).toEqual([
        "id",
        "status",
      ]);
    } finally {
      await close();
    }
  });
});

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "datasets-mcp-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
