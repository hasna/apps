import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentTools } from "./agents";
import { openDatabase } from "../../lib/db";
import type { Database } from "../../lib/db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-agents-mcp-${process.pid}-${crypto.randomUUID()}.db`);

describe("agent MCP tools", () => {
  let client: Client;
  let database: Database;
  let agentFocus: Map<string, { project_id: string | null }>;
  let sessionAgent: string | null;
  const setSessionAgentSpy = mock((agent: string) => {
    sessionAgent = agent;
  });
  const setClaudeSessionIdSpy = mock((_sessionId: string) => {});
  const updateCachedAutoNameSpy = mock((_newName: string) => {});
  const getAgentFocus = (agentId: string) => agentFocus.get(agentId)?.project_id ?? null;

  beforeAll(async () => {
    database = openDatabase(TEST_DB);

    const server = new McpServer({ name: "test-agents-mcp", version: "0.0.1" });
    agentFocus = new Map();
    sessionAgent = null;
    registerAgentTools(server, agentFocus, getAgentFocus, {
      database,
      resolveIdentity: (explicit) => explicit?.trim() || "test-auto-agent",
      resolveClaudeSessionId: () => "test-claude-session",
      setSessionAgent: setSessionAgentSpy,
      setClaudeSessionId: setClaudeSessionIdSpy,
      updateCachedAutoName: updateCachedAutoNameSpy,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    database.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + "-wal"); } catch {}
    try { unlinkSync(TEST_DB + "-shm"); } catch {}
    await client.close();
  });

  function parseResult(result: { content: unknown[] }): unknown {
    const text = (result.content[0] as { type: string; text: string }).text;
    try { return JSON.parse(text); } catch { return text; }
  }

  describe("register_agent", () => {
    test("registers agent with name and auto-detects session_id", async () => {
      setSessionAgentSpy.mockClear();
      setClaudeSessionIdSpy.mockClear();
      const result = parseResult(await client.callTool({
        name: "register_agent",
        arguments: { name: "test-reg-agent" },
      }) as any) as any;
      expect(result.agent.agent).toBe("test-reg-agent");
      expect(result.agent.session_id).toBe("test-claude-session");
      expect(setSessionAgentSpy).toHaveBeenCalledTimes(1);
      expect(setSessionAgentSpy).toHaveBeenCalledWith("test-reg-agent");
      expect(setClaudeSessionIdSpy).toHaveBeenCalledTimes(1);
      expect(setClaudeSessionIdSpy).toHaveBeenCalledWith("test-claude-session");
    });

    test("accepts agent_name alias", async () => {
      const result = parseResult(await client.callTool({
        name: "register_agent",
        arguments: { agent_name: "test-reg-agent2" },
      }) as any) as any;
      expect(result.agent.agent).toBe("test-reg-agent2");
    });

    test("accepts agent_id alias", async () => {
      const result = parseResult(await client.callTool({
        name: "register_agent",
        arguments: { agent_id: "test-reg-agent3" },
      }) as any) as any;
      expect(result.agent.agent).toBe("test-reg-agent3");
    });

    test("returns error when name is missing", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {},
      });
      expect((result as any).isError).toBe(true);
    });

    test("includes role and project_id when provided", async () => {
      const result = parseResult(await client.callTool({
        name: "register_agent",
        arguments: { name: "test-reg-with-meta", role: "QA", project_id: "proj-1" },
      }) as any) as any;
      expect(result.agent.role).toBe("QA");
      expect(result.agent.project_id).toBe("proj-1");
    });
  });

  describe("heartbeat", () => {
    test("heartbeat with explicit from", async () => {
      const result = parseResult(await client.callTool({
        name: "heartbeat",
        arguments: { from: "heartbeat-explicit" },
      }) as any) as any;
      expect(result.agent).toBe("heartbeat-explicit");
      expect(result.heartbeat).toBe(true);
      expect(sessionAgent).toBe("heartbeat-explicit");
    });

    test("heartbeat with name alias", async () => {
      const result = parseResult(await client.callTool({
        name: "heartbeat",
        arguments: { name: "heartbeat-name" },
      }) as any) as any;
      expect(result.agent).toBe("heartbeat-name");
    });

    test("heartbeat with agent_name alias", async () => {
      const result = parseResult(await client.callTool({
        name: "heartbeat",
        arguments: { agent_name: "heartbeat-alias" },
      }) as any) as any;
      expect(result.agent).toBe("heartbeat-alias");
    });

    test("heartbeat with custom status", async () => {
      const result = parseResult(await client.callTool({
        name: "heartbeat",
        arguments: { from: "status-agent", status: "busy" },
      }) as any) as any;
      expect(result.status).toBe("busy");
    });

    test("heartbeat defaults to online status", async () => {
      const result = parseResult(await client.callTool({
        name: "heartbeat",
        arguments: { from: "status-default" },
      }) as any) as any;
      expect(result.status).toBe("online");
    });
  });

  describe("list_agents", () => {
    test("lists all agents", async () => {
      await client.callTool({ name: "heartbeat", arguments: { from: "list-agent-1" } });
      await client.callTool({ name: "heartbeat", arguments: { from: "list-agent-2" } });

      const result = parseResult(await client.callTool({
        name: "list_agents",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result.agents)).toBe(true);
      expect(result.agents.length).toBeGreaterThanOrEqual(2);
      expect(result.compact).toBe(true);
    });

    test("filters to online_only", async () => {
      const result = parseResult(await client.callTool({
        name: "list_agents",
        arguments: { online_only: true },
      }) as any) as any;
      expect(Array.isArray(result.agents)).toBe(true);
    });
  });

  describe("remove_agent", () => {
    test("removes agent by name", async () => {
      await client.callTool({ name: "heartbeat", arguments: { from: "remove-explicit" } });
      const result = parseResult(await client.callTool({
        name: "remove_agent",
        arguments: { agent: "remove-explicit" },
      }) as any) as any;
      expect(result.removed).toBe(true);
      expect(result.agent).toBe("remove-explicit");
    });

    test("removes self when no agent specified", async () => {
      await client.callTool({ name: "heartbeat", arguments: { from: "remove-self" } });
      const result = parseResult(await client.callTool({
        name: "remove_agent",
        arguments: { from: "remove-self" },
      }) as any) as any;
      expect(result.removed).toBe(true);
    });

    test("returns error for nonexistent agent", async () => {
      const result = await client.callTool({
        name: "remove_agent",
        arguments: { agent: "ghost-agent-xyz" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("rename_agent", () => {
    test("renames agent", async () => {
      await client.callTool({ name: "heartbeat", arguments: { from: "rename-old" } });
      const result = parseResult(await client.callTool({
        name: "rename_agent",
        arguments: { from: "rename-old", new_name: "rename-new" },
      }) as any) as any;
      expect(result.renamed).toBe(true);
      expect(result.old_name).toBe("rename-old");
      expect(result.new_name).toBe("rename-new");
    });

    test("returns error when agent not found", async () => {
      const result = await client.callTool({
        name: "rename_agent",
        arguments: { from: "nonexistent", new_name: "whatever" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("returns error for empty new name", async () => {
      const result = await client.callTool({
        name: "rename_agent",
        arguments: { from: "test-rename-empty", new_name: "" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("updates the injected auto-name cache for an implicit identity", async () => {
      updateCachedAutoNameSpy.mockClear();
      await client.callTool({ name: "heartbeat", arguments: {} });
      const result = parseResult(await client.callTool({
        name: "rename_agent",
        arguments: { new_name: "test-auto-agent-renamed" },
      }) as any) as any;
      expect(result.renamed).toBe(true);
      expect(result.old_name).toBe("test-auto-agent");
      expect(result.new_name).toBe("test-auto-agent-renamed");
      expect(updateCachedAutoNameSpy).toHaveBeenCalledTimes(1);
      expect(updateCachedAutoNameSpy).toHaveBeenCalledWith("test-auto-agent-renamed");
    });
  });

  describe("focus mode tools", () => {
    test("set_focus sets agent focus", async () => {
      const result = parseResult(await client.callTool({
        name: "set_focus",
        arguments: { from: "focus-agent", project_id: "proj-focus-1" },
      }) as any) as any;
      expect(result.focused).toBe(true);
      expect(result.project_id).toBe("proj-focus-1");
      expect(result.agent).toBe("focus-agent");

      // Verify focus is persisted in the map
      expect(agentFocus.get("focus-agent")?.project_id).toBe("proj-focus-1");
    });

    test("get_focus returns session focus", async () => {
      await client.callTool({
        name: "set_focus",
        arguments: { from: "focus-get", project_id: "proj-get-1" },
      });
      const result = parseResult(await client.callTool({
        name: "get_focus",
        arguments: { from: "focus-get" },
      }) as any) as any;
      expect(result.session_focus).toBe("proj-get-1");
      expect(result.effective_project_id).toBe("proj-get-1");
    });

    test("get_focus returns null when no focus set", async () => {
      const result = parseResult(await client.callTool({
        name: "get_focus",
        arguments: { from: "focus-none" },
      }) as any) as any;
      expect(result.session_focus).toBeNull();
    });

    test("unfocus clears agent focus", async () => {
      await client.callTool({
        name: "set_focus",
        arguments: { from: "focus-unfocus", project_id: "proj-unfocus" },
      });
      const result = parseResult(await client.callTool({
        name: "unfocus",
        arguments: { from: "focus-unfocus" },
      }) as any) as any;
      expect(result.focused).toBe(false);
      expect(result.project_id).toBeNull();

      // Verify focus is cleared from the map
      expect(agentFocus.has("focus-unfocus")).toBe(false);
    });
  });

  describe("get_session_activity", () => {
    test("returns error for nonexistent session", async () => {
      const result = await client.callTool({
        name: "get_session_activity",
        arguments: { session_id: "nonexistent-session" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("get_blockers", () => {
    test("returns empty blockers for agent with no blocking messages", async () => {
      const result = parseResult(await client.callTool({
        name: "get_blockers",
        arguments: { from: "blocker-agent" },
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.compact).toBe(true);
    });

    test("returns blocking messages when they exist", async () => {
      database.prepare(`
        INSERT INTO messages (uuid, session_id, from_agent, to_agent, content, priority, blocking)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID().replace(/-/g, ""),
        "blocker-sender-blocker-target",
        "blocker-sender",
        "blocker-target",
        "BLOCK: fix this now",
        "urgent",
        1,
      );

      const result = parseResult(await client.callTool({
        name: "get_blockers",
        arguments: { from: "blocker-target" },
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].preview).toContain("BLOCK");
    });
  });
});
