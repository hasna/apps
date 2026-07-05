import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMcpHttpRequest } from "./http.js";
import { buildServer } from "./server.js";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];
    const previousWayland = process.env["WAYLAND_DISPLAY"];
    const server = buildServer({ homeDir: dir, baseUrl: "http://clip.test" });
    const client = new Client({ name: "clip-contract-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      process.env["PATH"] = "";
      delete process.env["DISPLAY"];
      delete process.env["WAYLAND_DISPLAY"];
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      for (const tool of ["clip_status", "clip_capture", "clip_share_clipboard", "clip_share_text", "clip_list", "clip_get", "clip_delete"]) {
        expect(toolNames.includes(tool)).toBe(true);
      }

      const resources = await client.listResources();
      const resourceUris = resources.resources.map((resource) => resource.uri);
      expect(resourceUris.includes("clip://status")).toBe(true);
      expect(resourceUris.includes("clip://shares")).toBe(true);

      const statusResource = await client.readResource({ uri: "clip://status" });
      const statusText = statusResource.contents[0]?.text;
      expect(JSON.parse(String(statusText)).baseUrl).toBe("http://clip.test");

      const created = await client.callTool({
        name: "clip_share_text",
        arguments: { text: "mcp contract", title: "MCP Contract" },
      });
      const createdText = (created.content as Array<{ type: string; text?: string }>)[0]?.text;
      const record = JSON.parse(createdText ?? "{}") as { slug?: string; text?: string; shareUrl?: string };
      expect(record.slug).toBeTruthy();
      expect(record.text).toBe("mcp contract");
      expect(record.shareUrl?.startsWith("http://clip.test/s/")).toBe(true);

      const listed = await client.callTool({ name: "clip_list", arguments: { limit: 5 } });
      const listedText = (listed.content as Array<{ type: string; text?: string }>)[0]?.text;
      expect(JSON.parse(listedText ?? "{}").shares).toHaveLength(1);

      const fetched = await client.callTool({ name: "clip_get", arguments: { ref: record.slug } });
      const fetchedText = (fetched.content as Array<{ type: string; text?: string }>)[0]?.text;
      expect(JSON.parse(fetchedText ?? "{}").slug).toBe(record.slug);

      const missing = await client.callTool({ name: "clip_get", arguments: { ref: "missing" } });
      const missingText = (missing.content as Array<{ type: string; text?: string }>)[0]?.text;
      expect(JSON.parse(missingText ?? "{}")).toEqual({ error: "Share not found", ref: "missing" });

      const deleted = await client.callTool({ name: "clip_delete", arguments: { ref: record.slug } });
      const deletedText = (deleted.content as Array<{ type: string; text?: string }>)[0]?.text;
      expect(JSON.parse(deletedText ?? "{}")).toEqual({ deleted: true, ref: record.slug });

      const status = await client.callTool({ name: "clip_status", arguments: {} });
      const statusToolText = (status.content as Array<{ type: string; text?: string }>)[0]?.text;
      expect(JSON.parse(statusToolText ?? "{}").storage.deleted).toBe(1);

      const sharesResource = await client.readResource({ uri: "clip://shares" });
      const sharesText = sharesResource.contents[0]?.text;
      expect(JSON.parse(String(sharesText)).cli_equivalent).toBe("clip list --json");
    } finally {
      restoreEnv("PATH", previousPath);
      restoreEnv("DISPLAY", previousDisplay);
      restoreEnv("WAYLAND_DISPLAY", previousWayland);
      await client.close().catch(() => {});
      await server.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
