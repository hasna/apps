/**
 * MCP interface-layer parity (MON-V2-15).
 *
 * Proves the MCP server is an interface layer over the SDK MonitorService:
 * every advertised tool maps to exactly one SDK operation, and every tool
 * dispatch reaches that operation through the service — never through a
 * second inline implementation.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, getDb } from "../db/client.js";
import { MCP_TOOL_MAP, createMonitorService, type MonitorService } from "../sdk/index.js";
import { buildServer } from "./server.js";

const scratch = mkdtempSync(join(tmpdir(), "monitor-mcp-parity-"));
const DB_PATH = join(scratch, "monitor.db");

beforeAll(() => {
  process.env.MONITOR_CONFIG_DIR = scratch;
  closeDb();
  getDb(DB_PATH);
});

afterAll(() => {
  closeDb();
  delete process.env.MONITOR_CONFIG_DIR;
  rmSync(scratch, { recursive: true, force: true });
});

/** Wrap a real service so every method call is recorded before delegation. */
function spyService(): { service: MonitorService; calls: string[] } {
  const real = createMonitorService();
  const calls: string[] = [];
  const service = new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && typeof value === "function") {
        return (...args: unknown[]) => {
          calls.push(prop);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  }) as MonitorService;
  return { service, calls };
}

async function listTools(): Promise<string[]> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  const result = await client.listTools();
  await client.close();
  await server.close();
  return result.tools.map((tool) => tool.name).sort();
}

/** Minimal but valid arguments per tool, chosen to be side-effect free. */
const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  monitor_snapshot: { machine_id: "local" },
  monitor_health: { machine_id: "local" },
  monitor_mcp_health: {},
  monitor_mcp_status: {},
  monitor_mcp_restart: { name: "__parity_nonexistent__" },
  monitor_processes: { machine_id: "local", filter: "all" },
  monitor_apps: {},
  monitor_service: { action: "list" },
  monitor_exec: { target: "__parity_nonexistent__", command: "true" },
  monitor_ports: {},
  monitor_tailscale: {},
  monitor_temperature: {},
  monitor_containers: {},
  monitor_container_logs: { container: "__parity_nonexistent__" },
  monitor_kill: { force: true, pid: 2147483647 },
  monitor_machines: {},
  monitor_add_machine: { name: "parity-fixture-machine" },
  monitor_alerts: {},
  monitor_cron_jobs: { action: "list" },
  monitor_doctor: { machine_id: "local" },
  monitor_search: { query: "parity" },
  monitor_register_agent: { id: "parity-agent", name: "Parity Agent" },
  monitor_heartbeat: { id: "parity-agent" },
  monitor_set_focus: { id: "parity-agent", focus: "test" },
  monitor_list_agents: {},
  monitor_configure_integrations: { action: "get" },
  monitor_send_feedback: { source: "user", rating: 5, message: "parity test" },
};

describe("MCP interface-layer parity", () => {
  it("advertises exactly the SDK parity tool set", async () => {
    const advertised = await listTools();
    expect(advertised).toEqual(Object.keys(MCP_TOOL_MAP).sort());
  });

  // Live collection tools (snapshot, health, doctor, processes, apps) run
  // real collection on the local machine; give the full loop room.
  it(
    "routes every tool through its MonitorService method",
    async () => {
      const tools = Object.keys(TOOL_ARGS);
      expect(tools.length).toBe(Object.keys(MCP_TOOL_MAP).length);

    for (const tool of tools) {
      const { service, calls } = spyService();
      const server = buildServer({ service });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(clientTransport);

      await client.callTool({ name: tool, arguments: TOOL_ARGS[tool] });

      await client.close();
      await server.close();

      const expected = MCP_TOOL_MAP[tool as keyof typeof MCP_TOOL_MAP];
      expect(
        calls,
        `tool ${tool} did not reach MonitorService#${expected} (calls: ${calls.join(", ")})`
      ).toContain(expected);
      }
    },
    // Live collection tools (snapshot, health, doctor, processes, apps) run
    // real collection on the local machine; give the full loop room.
    180_000
  );
});
