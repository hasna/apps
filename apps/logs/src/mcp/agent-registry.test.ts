/**
 * @hasna/logs — agent-lifecycle registry backends (hasna/apps#1720 validation).
 *
 * Registration must be free of disk side effects (the persistent file opens on
 * the FIRST tool call, never while the MCP server is built), and the hosted
 * transport's ephemeral registry never creates a file at all.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EPHEMERAL_REGISTRY_NOTICE,
  createEphemeralRegistryDb,
  registerAgentTools,
  resetDefaultStoreForTests,
  resolveRegistryDbPath,
} from "./agent-registry.ts";

type Handler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

/** A minimal McpServer double: records tool descriptions and handlers. */
function fakeServer() {
  const tools = new Map<string, { description: string; handler: Handler }>();
  return {
    tools,
    tool: (name: string, description: string, _schema: unknown, handler: Handler) => {
      tools.set(name, { description, handler });
    },
  };
}

const roots: string[] = [];
const savedPath = process.env.HASNA_AGENT_REGISTRY_DB_PATH;
afterEach(() => {
  resetDefaultStoreForTests();
  if (savedPath === undefined) delete process.env.HASNA_AGENT_REGISTRY_DB_PATH;
  else process.env.HASNA_AGENT_REGISTRY_DB_PATH = savedPath;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRegistryPath(): string {
  const root = mkdtempSync(join(tmpdir(), "logs-agent-registry-"));
  roots.push(root);
  const path = join(root, "nested", "agent-registry.db");
  process.env.HASNA_AGENT_REGISTRY_DB_PATH = path;
  return path;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("persistent registry (default)", () => {
  test("registering the tools opens nothing; the first tool call creates the file", async () => {
    const path = tempRegistryPath();
    expect(resolveRegistryDbPath()).toBe(path);
    const server = fakeServer();

    registerAgentTools(server, { service: "logs" });
    expect(server.tools.has("register_agent")).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(path, ".."))).toBe(false);

    const listed = await server.tools.get("list_agents")!.handler({});
    expect(JSON.parse(textOf(listed))).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });

  test("descriptions carry no ephemeral notice", () => {
    tempRegistryPath();
    const server = fakeServer();
    registerAgentTools(server, { service: "logs" });
    for (const { description } of server.tools.values()) {
      expect(description).not.toContain(EPHEMERAL_REGISTRY_NOTICE);
    }
  });
});

describe("ephemeral registry (hosted transport)", () => {
  test("agent tools work in memory and no registry file is ever created", async () => {
    const path = tempRegistryPath();
    const server = fakeServer();
    registerAgentTools(server, {
      service: "logs",
      db: createEphemeralRegistryDb(),
      ephemeral: true,
    });

    const registered = await server.tools.get("register_agent")!.handler({ name: "Hosted-One" });
    expect((registered as { isError?: boolean }).isError).toBeFalsy();
    expect(JSON.parse(textOf(registered)).name).toBe("hosted-one");

    const listed = await server.tools.get("list_agents")!.handler({});
    const agents = JSON.parse(textOf(listed)) as Array<{ name: string }>;
    expect(agents.map((agent) => agent.name)).toEqual(["hosted-one"]);

    expect(existsSync(path)).toBe(false);
    expect(readdirSync(roots[0]!)).toEqual([]);
  });

  test("every lifecycle tool description says the registry is in memory, per process", () => {
    tempRegistryPath();
    const server = fakeServer();
    registerAgentTools(server, { service: "logs", db: createEphemeralRegistryDb(), ephemeral: true });
    for (const name of ["register_agent", "heartbeat", "set_focus", "list_agents"]) {
      expect(server.tools.get(name)?.description ?? "").toContain(EPHEMERAL_REGISTRY_NOTICE);
    }
  });

  test("one roster per process: two ephemeral handles see the same agents", async () => {
    tempRegistryPath();
    const a = fakeServer();
    const b = fakeServer();
    registerAgentTools(a, { db: createEphemeralRegistryDb(), ephemeral: true });
    registerAgentTools(b, { db: createEphemeralRegistryDb(), ephemeral: true });

    await a.tools.get("register_agent")!.handler({ name: "shared" });
    const listed = await b.tools.get("list_agents")!.handler({});
    expect((JSON.parse(textOf(listed)) as Array<{ name: string }>).map((x) => x.name)).toEqual(["shared"]);
  });
});
