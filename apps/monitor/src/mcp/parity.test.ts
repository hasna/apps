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

/**
 * A service that never runs a real operation: every method returns a
 * distinctive canary marker. A tool handler that produced its response from
 * the service's return value must embed the marker in its output; a handler
 * that "calls the method for the record" and then runs its own direct
 * implementation produces output with no marker and fails the assertion.
 */
function canaryService(tool: string): MonitorService {
  const marker = `canary-${tool}`;
  const target = {} as MonitorService;
  const proxy = new Proxy(target, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      // Methods whose results are embedded by their handlers as a scalar id.
      if (prop === "machineAdd" || prop === "cron" || prop === "sendFeedback") {
        return () => marker;
      }
      return () => ({ "__parity_canary": marker });
    },
  });
  return proxy as unknown as MonitorService;
}

/**
 * Tools whose handlers embed the service result in the response verbatim
 * (pass-through or direct field), so the canary must survive into the output.
 */
const CANARY_TOOL_ARGS: Record<string, Record<string, unknown>> = {
  monitor_mcp_restart: { name: "__parity_nonexistent__" },
  monitor_mcp_status: { all: false, verbose: true },
  monitor_exec: { target: "__parity_nonexistent__", command: "true" },
  monitor_kill: { force: true, pid: 2147483647 },
  monitor_add_machine: { name: "canary-fixture-machine" },
  monitor_cron_jobs: { action: "add", name: "canary-job", schedule: "*/5 * * * *", command: "true" },
  monitor_configure_integrations: { action: "get" },
  monitor_send_feedback: { source: "user", rating: 5, message: "parity canary" },
};

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
      // Exactly one service call per dispatch, and it must be the mapped
      // operation: a handler that calls an extra method (or a different one)
      // for its real work fails here even though the expected method was
      // invoked for the record.
      expect(
        calls,
        `tool ${tool} did not dispatch exactly to MonitorService#${expected} (calls: ${calls.join(", ")})`
      ).toEqual([expected]);
      }
    },
    // Live collection tools (snapshot, health, doctor, processes, apps) run
    // real collection on the local machine; give the full loop room.
    180_000
  );

  it(
    "returns responses produced from the service result (canary delegation)",
    async () => {
      for (const [tool, args] of Object.entries(CANARY_TOOL_ARGS)) {
        const server = buildServer({ service: canaryService(tool) });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: "test", version: "0.0.0" });
        await client.connect(clientTransport);

        const response = await client.callTool({ name: tool, arguments: args });

        await client.close();
        await server.close();

        expect((response.isError ?? false)).toBe(false);
        const content = (response.content ?? []) as Array<{ type?: string; text?: string }>;
        const text = content
          .map((part) => (part.type === "text" ? part.text ?? "" : ""))
          .join("\n");
        expect(
          text,
          `tool ${tool} response does not embed the service canary — the handler's output is not derived from MonitorService`
        ).toContain(`canary-${tool}`);
      }
    },
    120_000
  );
});
