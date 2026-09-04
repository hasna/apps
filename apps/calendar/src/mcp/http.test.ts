import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installDomainFixture } from "../test/domain-fixture.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCalendar } from "../db/calendars.js";
import { createEvent } from "../db/events.js";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createOrg } from "../db/orgs.js";
import { registerAgent } from "../db/agents.js";
import { createMembership } from "../db/memberships.js";
import { buildServer } from "./index.js";
import { healthPayload, startMcpHttpServer } from "./http.js";

describe("calendar MCP HTTP transport", () => {
  let restore: () => void;
  beforeEach(() => { restore = installDomainFixture(); });
  afterEach(() => {
    restore();
    resetDatabase(":memory:");
    closeDatabase();
  });

  test("GET /health returns 200", async () => {
    const { port, close } = await startMcpHttpServer({ port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(healthPayload("calendar"));
    } finally {
      await close();
    }
  });

  test("streamable HTTP initialize + list_orgs round-trip", async () => {
    const { port, close } = await startMcpHttpServer({ port: 0 });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(transport);
      const result = await client.callTool({ name: "list_orgs", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content?.[0]?.type).toBe("text");
      const payload = JSON.parse((result.content?.[0] as { type: "text"; text: string }).text);
      expect(payload).toMatchObject({ items: [], total: 0, cursor: 0, next_cursor: null });
      await client.close();
    } finally {
      await close();
    }
  });

  test("list_events uses compact paged output unless verbose is requested", async () => {
    resetDatabase(":memory:");
    const org = createOrg({ name: "MCP Output Org", slug: "mcp-output" });
    const calendar = createCalendar({ name: "MCP Output Calendar", org_id: org.id });
    const longDescription = "Long MCP details ".repeat(40);
    for (let i = 0; i < 22; i += 1) {
      const day = String(i + 1).padStart(2, "0");
      createEvent({
        title: `MCP Event ${day}`,
        calendar_id: calendar.id,
        org_id: org.id,
        start_at: `2026-05-${day}T09:00:00Z`,
        end_at: `2026-05-${day}T10:00:00Z`,
        description: longDescription,
      });
    }

    const { port, close } = await startMcpHttpServer({ port: 0 });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(transport);

      const compact = await client.callTool({ name: "list_events", arguments: { calendar_id: calendar.id } });
      const compactPayload = JSON.parse((compact.content?.[0] as { type: "text"; text: string }).text);
      expect(compactPayload.total).toBe(22);
      expect(compactPayload.items).toHaveLength(20);
      expect(compactPayload.next_cursor).toBe(20);
      expect(compactPayload.items[0].description).toBeUndefined();
      expect(compactPayload.hint).toContain("verbose=true");

      const verbose = await client.callTool({ name: "list_events", arguments: { calendar_id: calendar.id, limit: 1, verbose: true } });
      const verbosePayload = JSON.parse((verbose.content?.[0] as { type: "text"; text: string }).text);
      expect(verbosePayload.items).toHaveLength(1);
      expect(verbosePayload.items[0].description).toBe(longDescription);

      await client.close();
    } finally {
      await close();
    }
  });

  test("bootstrap returns paged compact sections by default", async () => {
    resetDatabase(":memory:");
    const org = createOrg({ name: "Bootstrap Org", slug: "bootstrap" });
    const agent = registerAgent({ name: "bootstrap-agent" });
    createMembership({ org_id: org.id, agent_id: agent.id, role: "admin" });
    for (let i = 0; i < 3; i += 1) {
      const calendar = createCalendar({ name: `Bootstrap Calendar ${i + 1}`, org_id: org.id });
      const startAt = new Date(Date.now() + (i + 1) * 86400000);
      const endAt = new Date(startAt.getTime() + 3600000);
      createEvent({
        title: `Bootstrap Event ${i + 1}`,
        calendar_id: calendar.id,
        org_id: org.id,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        description: "Long bootstrap details ".repeat(20),
      });
    }

    const { port, close } = await startMcpHttpServer({ port: 0 });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(transport);

      const result = await client.callTool({ name: "bootstrap", arguments: { agent_id: agent.name, limit: 1 } });
      const payload = JSON.parse((result.content?.[0] as { type: "text"; text: string }).text);
      expect(payload.agent.name).toBe("bootstrap-agent");
      expect(payload.calendars).toMatchObject({ total: 3, limit: 1, cursor: 0, next_cursor: 1 });
      expect(payload.calendars.items).toHaveLength(1);
      expect(payload.upcoming).toMatchObject({ total: 3, limit: 1, cursor: 0, next_cursor: 1 });
      expect(payload.upcoming.items[0].description).toBeUndefined();
      expect(payload.hint).toContain("limit/cursor");

      await client.close();
    } finally {
      await close();
    }
  }, 10000);

  test("stdio buildServer registers tools unchanged", () => {
    const server = buildServer();
    expect(server).toBeTruthy();
    expect(server.server).toBeTruthy();
  });
});
