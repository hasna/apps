import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listAuditEvents } from "../db/index.js";
import { resetRunControlForTests } from "../agent/control.js";
import { buildServer } from "./server.js";

const ENV_KEYS = [
  "HASNA_COMPUTER_DATABASE_URL",
  "COMPUTER_DATABASE_URL",
  "HASNA_COMPUTER_STORAGE_SYNC_CONSENT",
  "COMPUTER_STORAGE_SYNC_CONSENT",
  "COMPUTER_TERMINAL_APPROVAL_TOKEN",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetRunControlForTests();
});

describe("computer MCP security regressions", () => {
  test("storage mutation tools fail closed without sync consent and write audit", async () => {
    process.env.HASNA_COMPUTER_DATABASE_URL = "postgres://remote.example/computer?sslmode=require";
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "computer-mcp-security-test", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({ name: "storage_push", arguments: {} });
      const text = (result.content as Array<{ type?: string; text?: string }>)[0]?.text ?? "";
      const parsed = JSON.parse(text) as { ok: boolean; error: string };

      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("Remote storage sync requires explicit consent");

      const [event] = listAuditEvents({
        transport: "mcp",
        capability: "computer.storage_push",
        limit: 1,
      });
      expect(event?.decision).toBe("denied");
      expect(event?.reason).toContain("Remote storage sync requires explicit consent");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("terminal app-driver commands require explicit approval and are audited", async () => {
    const marker = `mcp_terminal_${Date.now()}_${Math.random()}`;
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "computer-mcp-terminal-policy-test", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "computer_open_app",
        arguments: {
          app: "ghostty",
          run: [`echo ${marker}`],
          dir: process.cwd(),
        },
      });
      const text = (result.content as Array<{ type?: string; text?: string }>)[0]?.text ?? "";
      expect(text).toContain("requires confirmation");

      const event = listAuditEvents({ transport: "mcp", capability: "computer.terminal", limit: 20 })
        .find((candidate) => candidate.metadata?.tool === "computer_open_app" && candidate.metadata?.command_count === 1);
      expect(event).toBeDefined();
      expect(event!.decision).toBe("requires_confirmation");
      expect(JSON.stringify(event)).not.toContain(marker);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("MCP terminal approval cannot be self-attested with approved=true", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "computer-mcp-terminal-approval-test", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "computer_open_app",
        arguments: {
          app: "ghostty",
          run: ["echo should-not-run"],
          dir: process.cwd(),
          approved: true,
        },
      });
      const text = (result.content as Array<{ type?: string; text?: string }>)[0]?.text ?? "";
      expect(text).toContain("requires confirmation");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("MCP run-control mutations write audit rows", async () => {
    const sessionId = `session_${Date.now()}_${Math.random()}`;
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "computer-mcp-run-control-audit-test", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await client.callTool({ name: "computer_emergency_stop", arguments: { reason: "test stop" } });
      await client.callTool({ name: "computer_clear_emergency_stop", arguments: {} });
      await client.callTool({ name: "computer_pause_session", arguments: { id: sessionId, reason: "test pause" } });
      await client.callTool({ name: "computer_cancel_session", arguments: { id: sessionId, reason: "test cancel" } });
      await client.callTool({ name: "computer_delete_session", arguments: { id: sessionId } });

      expect(listAuditEvents({ transport: "mcp", capability: "computer.emergency_stop", limit: 5 })[0]?.decision).toBe("requested");
      expect(listAuditEvents({ transport: "mcp", capability: "computer.clear_emergency_stop", limit: 5 })[0]?.decision).toBe("cleared");
      expect(listAuditEvents({ transport: "mcp", capability: "computer.pause_session", limit: 5 })[0]).toEqual(expect.objectContaining({
        decision: "requested",
        reason: "test pause",
      }));
      expect(listAuditEvents({ transport: "mcp", capability: "computer.cancel_session", limit: 5 })[0]).toEqual(expect.objectContaining({
        decision: "requested",
        reason: "test cancel",
      }));
      expect(listAuditEvents({ transport: "mcp", capability: "computer.delete_session", limit: 5 })[0]).toEqual(expect.objectContaining({
        decision: "not_found",
      }));
    } finally {
      await client.close();
      await server.close();
    }
  });
});
