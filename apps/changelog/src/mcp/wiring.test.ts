import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, createChangelogMcpServer } from "./server.js";
import { VERSION } from "../version.js";
import type { ChangelogStore } from "../types.js";

/**
 * Wiring tests: prove that tools registered on the McpServer actually call the
 * injected store, by driving the server over a real (in-memory) MCP transport
 * with a Client. Direct tool-construction tests (tools.test.ts) cannot prove
 * that `createChangelogMcpServer({ store })` wires the store into the
 * registered handlers; these tests can.
 */

const TOOL_NAMES = [
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

function recordingStore(): { store: ChangelogStore; calls: string[] } {
  const calls: string[] = [];
  const store = {
    createEntry: async (input: Record<string, unknown>) => {
      calls.push("createEntry");
      return { id: "wired-id", appId: input.appId, title: input.title, version: input.version };
    },
    listEntries: async () => {
      calls.push("listEntries");
      return [];
    },
    getEntry: async () => {
      calls.push("getEntry");
      return null;
    },
    updateEntry: async () => {
      calls.push("updateEntry");
      return null;
    },
    releaseEntries: async () => {
      calls.push("releaseEntries");
      return { updated: 0 };
    },
    stats: async () => {
      calls.push("stats");
      return { total: 0 };
    },
    exportJsonl: async () => {
      calls.push("exportJsonl");
      return "";
    },
  } as unknown as ChangelogStore;
  return { store, calls };
}

async function withServerClient(
  server: ReturnType<typeof createChangelogMcpServer>,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wiring-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function textOf(result: ToolCallResult): string {
  const first = result.content[0];
  return first?.type === "text" ? (first.text ?? "") : "";
}

describe("changelog MCP server wiring", () => {
  test("default server advertises name changelog and the package VERSION over the wire", async () => {
    const server = createChangelogMcpServer();
    await withServerClient(server, async (client) => {
      expect(await client.getServerVersion()).toEqual({ name: "changelog", version: VERSION });
    });
  });

  test("custom name and version are advertised over the wire", async () => {
    const server = createChangelogMcpServer({ name: "custom-changelog", version: "9.8.7" });
    await withServerClient(server, async (client) => {
      expect(await client.getServerVersion()).toEqual({ name: "custom-changelog", version: "9.8.7" });
    });
  });

  test("all nine tools are callable through the server", async () => {
    const { store } = recordingStore();
    const server = createChangelogMcpServer({ store });
    await withServerClient(server, async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
      for (const name of TOOL_NAMES) {
        expect(listed.tools.some((tool) => tool.name === name), `missing tool ${name}`).toBe(true);
      }
    });
  });

  test("add_changelog_entry calls the injected store, not a default one", async () => {
    const { store, calls } = recordingStore();
    const server = createChangelogMcpServer({ store });
    await withServerClient(server, async (client) => {
      const result = (await client.callTool({
        name: "add_changelog_entry",
        arguments: { app_id: "wired-app", title: "Wired title", version: "0.1.0" },
      })) as ToolCallResult;
      expect(calls).toContain("createEntry");
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(textOf(result))).toMatchObject({ id: "wired-id", appId: "wired-app", title: "Wired title" });
    });
  });

  test("list_changelog_entries surfaces the injected store through the server", async () => {
    const { store, calls } = recordingStore();
    const server = createChangelogMcpServer({ store });
    await withServerClient(server, async (client) => {
      const result = await client.callTool({ name: "list_changelog_entries", arguments: { app_id: "wired-app" } });
      expect(calls).toContain("listEntries");
      expect(result.isError).toBeUndefined();
    });
  });

  test("a throwing injected store surfaces its error through the registered tool", async () => {
    const throwingStore = {
      listEntries: async () => {
        throw new Error("boom-store-failure");
      },
    } as unknown as ChangelogStore;
    const server = createChangelogMcpServer({ store: throwingStore });
    await withServerClient(server, async (client) => {
      const result = (await client.callTool({ name: "list_changelog_entries", arguments: {} })) as ToolCallResult;
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("boom-store-failure");
    });
  });

  test("buildServer is wired identically for the injected store", async () => {
    const { store, calls } = recordingStore();
    const server = buildServer({ store });
    await withServerClient(server, async (client) => {
      const result = await client.callTool({ name: "changelog_stats", arguments: {} });
      expect(calls).toContain("stats");
      expect(result.isError).toBeUndefined();
    });
  });
});
