import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer, createChangelogMcpServer } from "./server.js";
import { LocalChangelogStore } from "../storage.js";
import { VERSION } from "../version.js";

const EXPECTED_TOOLS = [
  "add_changelog_entry",
  "list_changelog_entries",
  "get_changelog_entry",
  "update_changelog_entry",
  "release_changelog",
  "generate_changelog",
  "publish_changelog",
  "changelog_stats",
  "export_changelog_jsonl",
];

const clients: Client[] = [];

async function connectedClient(options: Parameters<typeof createChangelogMcpServer>[0] = {}): Promise<Client> {
  const server = createChangelogMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  clients.push(client);
  await client.connect(clientTransport);
  return client;
}

afterEach(async () => {
  while (clients.length > 0) {
    const client = clients.pop()!;
    await client.close().catch(() => undefined);
  }
});

describe("createChangelogMcpServer over the MCP protocol", () => {
  test("reports default name and version through the wire protocol", async () => {
    const client = await connectedClient();
    expect(client.getServerVersion()).toEqual({ name: "changelog", version: VERSION });
  });

  test("honors explicit name and version options through the wire protocol", async () => {
    const client = await connectedClient({ name: "custom-changelog", version: "9.9.9" });
    expect(client.getServerVersion()).toEqual({ name: "custom-changelog", version: "9.9.9" });
  });

  test("advertises exactly the nine expected tools in order", async () => {
    const client = await connectedClient();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  });

  test("routes tool calls to the injected store", async () => {
    const store = new LocalChangelogStore({ dataDir: await mkdtemp(join(tmpdir(), "changelog-mcp-server-")) });
    const client = await connectedClient({ store });
    const result = await client.callTool({
      name: "add_changelog_entry",
      arguments: { app_id: "mcp-app", version: "0.1.0", title: "Protocol entry", kind: "added" },
    });
    const content = result.content[0];
    expect(content).toBeDefined();
    expect(content!.type).toBe("text");
    const created = JSON.parse(content!.text) as { id: string; appId: string; source: string };
    expect(created).toMatchObject({ appId: "mcp-app", source: "mcp" });
    expect(await store.getEntry(created.id)).toMatchObject({ title: "Protocol entry" });
    expect(await store.listEntries({ appId: "mcp-app" })).toHaveLength(1);
  });

  test("buildServer is an alias producing the same wire contract", async () => {
    const server = buildServer({ name: "alias", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    clients.push(client);
    await client.connect(clientTransport);
    expect(client.getServerVersion()).toEqual({ name: "alias", version: "1.0.0" });
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  });
});
