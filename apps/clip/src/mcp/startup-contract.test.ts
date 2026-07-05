import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipStore } from "../storage.js";
import { handleMcpHttpRequest } from "./http.js";
import { buildServer } from "./server.js";

const EXPECTED_TOOLS = ["clip_status", "clip_capture", "clip_share_clipboard", "clip_share_text", "clip_list", "clip_get", "clip_delete"] as const;

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type ToolSchema = {
  type?: string;
  properties?: Record<string, { type?: string; enum?: string[]; maximum?: number; exclusiveMinimum?: number; pattern?: string }>;
  required?: string[];
  additionalProperties?: boolean;
};

async function withClient<T>(
  options: Parameters<typeof buildServer>[0],
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const server = buildServer(options);
  const client = new Client({ name: "clip-contract-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await run(client);
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

function toolText(result: ToolResult): string {
  return (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
}

function parseToolJson<T>(result: ToolResult): T {
  return JSON.parse(toolText(result)) as T;
}

function schemaFor(tools: Awaited<ReturnType<Client["listTools"]>>, name: string): ToolSchema {
  const schema = tools.tools.find((tool) => tool.name === name)?.inputSchema as ToolSchema | undefined;
  expect(schema).toBeTruthy();
  return schema!;
}

describe("MCP startup contract", () => {
  it("builds the server and exposes HTTP health", async () => {
    expect(buildServer()).toBeTruthy();
    const response = await handleMcpHttpRequest(new Request("http://127.0.0.1:8874/health"));
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("ok");
  });

  it("exposes the expected tools and resources", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-mcp-"));
    try {
      await withClient({ homeDir: dir, baseUrl: "http://clip.test" }, async (client) => {
        const tools = await client.listTools();
        const toolNames = tools.tools.map((tool) => tool.name);
        for (const tool of EXPECTED_TOOLS) expect(toolNames.includes(tool)).toBe(true);

        for (const tool of EXPECTED_TOOLS) expect(schemaFor(tools, tool).type).toBe("object");
        for (const tool of EXPECTED_TOOLS) expect(schemaFor(tools, tool).additionalProperties).toBe(false);
        expect(schemaFor(tools, "clip_capture").properties?.mode?.enum).toEqual(["full", "window", "region"]);
        expect(schemaFor(tools, "clip_share_clipboard").properties?.kind?.enum).toEqual(["auto", "text", "image", "file"]);
        expect(schemaFor(tools, "clip_share_text").required).toContain("text");
        expect(schemaFor(tools, "clip_share_text").properties?.text?.type).toBe("string");
        expect(schemaFor(tools, "clip_list").properties?.limit?.type).toBe("integer");
        expect(schemaFor(tools, "clip_list").properties?.limit?.maximum).toBe(500);
        expect(schemaFor(tools, "clip_get").required).toContain("ref");
        expect(schemaFor(tools, "clip_delete").required).toContain("ref");
        expect(schemaFor(tools, "clip_get").properties?.ref?.pattern).toBe("\\S");
        expect(schemaFor(tools, "clip_delete").properties?.ref?.pattern).toBe("\\S");

        const resources = await client.listResources();
        const resourceUris = resources.resources.map((resource) => resource.uri);
        expect(resourceUris.includes("clip://status")).toBe(true);
        expect(resourceUris.includes("clip://shares")).toBe(true);

        const statusResource = await client.readResource({ uri: "clip://status" });
        const statusText = statusResource.contents[0]?.text as string;
        expect(JSON.parse(statusText).storage.localPathsRedacted).toBe(true);
        expect(statusText).not.toContain(dir);

        const sharesResource = await client.readResource({ uri: "clip://shares" });
        expect(JSON.parse(sharesResource.contents[0]?.text as string).shares).toEqual([]);

        const created = await client.callTool({
          name: "clip_share_text",
          arguments: { text: "mcp contract", title: "MCP Contract" },
        });
        const record = parseToolJson<{ slug?: string; text?: string; shareUrl?: string; artifactPath?: string }>(created);
        expect(record.slug).toBeTruthy();
        expect(record.text).toBe("mcp contract");
        expect(record.shareUrl?.startsWith("http://clip.test/s/")).toBe(true);
        expect(record.artifactPath).toBeUndefined();
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid tool inputs with structured errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-mcp-invalid-"));
    try {
      await withClient({ homeDir: dir, baseUrl: "http://clip.test" }, async (client) => {
        const invalidCalls = [
          { name: "clip_status", arguments: { unexpected: true } },
          { name: "clip_capture", arguments: { mode: "screen" } },
          { name: "clip_share_clipboard", arguments: { kind: "html" } },
          { name: "clip_share_text", arguments: { title: "Missing text" } },
          { name: "clip_list", arguments: { limit: "25" } },
          { name: "clip_list", arguments: null },
          { name: "clip_get", arguments: { ref: "" } },
          { name: "clip_delete", arguments: { ref: "" } },
        ];

        for (const invalidCall of invalidCalls) {
          const result = await client.callTool({
            name: invalidCall.name,
            arguments: invalidCall.arguments as Record<string, unknown>,
          });
          const payload = parseToolJson<{ ok: boolean; error: { code: string; message: string } }>(result);
          expect(result.isError).toBe(true);
          expect(payload.ok).toBe(false);
          expect(payload.error.code).toBe("invalid_input");
          expect(payload.error.message.length).toBeGreaterThan(0);
          expect((result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code).toBe("invalid_input");
          expect(JSON.stringify(result)).not.toContain(dir);
        }

        const missing = await client.callTool({ name: "clip_get", arguments: { ref: "missing-share" } });
        const missingPayload = parseToolJson<{ ok: boolean; error: { code: string; message: string } }>(missing);
        expect(missing.isError).toBe(true);
        expect(missingPayload.error.code).toBe("not_found");
        expect(missingPayload.error.message).toBe("Share not found");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not leak artifact bytes or local secret paths in MCP output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-mcp-leak-"));
    const artifactBytes = "SUPER_SECRET_ARTIFACT_BYTES";
    const secretPath = join(dir, "SECRET_PATH_SENTINEL.txt");
    try {
      const store = new ClipStore({ homeDir: dir, baseUrl: "http://clip.test" });
      const record = store.createBufferClip({
        buffer: Buffer.from(artifactBytes, "utf8"),
        kind: "file",
        title: "Secret Artifact",
        mimeType: "text/plain",
        source: "test",
        metadata: {
          path: secretPath,
          nested: {
            artifactPath: join(dir, "nested-artifact.txt"),
            note: `terminal editing source:${join(dir, "nested-note.txt")}`,
            safe: "visible",
          },
          note: `terminal editing ${secretPath}`,
          args: ["--input", join(dir, "input.txt")],
        },
        baseUrl: "http://clip.test",
      });
      store.close();

      await withClient({ homeDir: dir, baseUrl: "http://clip.test" }, async (client) => {
        const outputs = [
          await client.callTool({ name: "clip_status", arguments: {} }),
          await client.callTool({ name: "clip_list", arguments: { limit: 10 } }),
          await client.callTool({ name: "clip_get", arguments: { ref: record.slug } }),
          await client.readResource({ uri: "clip://status" }),
          await client.readResource({ uri: "clip://shares" }),
        ];
        const serialized = JSON.stringify(outputs);
        const recordPayload = parseToolJson<{ artifactPath?: string; hasArtifact?: boolean; metadata?: Record<string, unknown> }>(outputs[2] as ToolResult);

        expect(recordPayload.hasArtifact).toBe(true);
        expect(recordPayload.artifactPath).toBeUndefined();
        expect(recordPayload.metadata?.nested).toEqual({ note: "[redacted]", safe: "visible" });
        expect(recordPayload.metadata?.note).toBe("[redacted]");
        expect(serialized).not.toContain(artifactBytes);
        expect(serialized).not.toContain(record.artifactPath ?? "missing-artifact-path");
        expect(serialized).not.toContain(secretPath);
        expect(serialized).not.toContain(dir);
        expect(serialized).not.toContain("artifactPath");
        expect(serialized).not.toContain("dbPath");
        expect(serialized).not.toContain("artifactDir");
        expect(serialized).not.toContain("homeDir");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
