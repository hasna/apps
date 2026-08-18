/**
 * SDK parity contract (MON-V2-15).
 *
 * The SDK exposes one MonitorService operation per MCP tool (a bijection
 * enforced below), and every CLI shared-core command maps onto the same
 * operation set. Neither the MCP nor the CLI may carry a second
 * implementation of a monitor operation: both delegate to MonitorService,
 * which delegates to the shared implementation modules.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLI_TO_METHOD,
  MCP_TOOL_MAP,
  SDK_METHODS,
  createMonitorService,
  MonitorService,
} from "./index.js";
import { MONITOR_VERSION } from "../version.js";
import { closeDb, getDb } from "../db/client.js";

describe("SDK parity surface", () => {
  it("exposes every parity method on MonitorService.prototype", () => {
    const proto = MonitorService.prototype as unknown as Record<string, unknown>;
    for (const method of SDK_METHODS) {
      expect(typeof proto[method], `missing MonitorService#${method}`).toBe("function");
    }
  });

  it("maps every MCP tool to exactly one SDK method and back (bijection)", () => {
    const tools = Object.keys(MCP_TOOL_MAP);
    const methods = Object.values(MCP_TOOL_MAP);

    expect(new Set(tools).size, "duplicate MCP tool names").toBe(tools.length);
    expect(new Set(methods).size, "two tools share one method").toBe(methods.length);
    expect(tools.length, "tool count differs from SDK method count").toBe(SDK_METHODS.length);
    expect(new Set(methods), "MCP tools do not cover the full SDK parity set").toEqual(
      new Set(SDK_METHODS)
    );
  });

  it("maps every CLI shared-core command to an existing SDK method", () => {
    const proto = MonitorService.prototype as unknown as Record<string, unknown>;
    for (const [command, method] of Object.entries(CLI_TO_METHOD)) {
      expect(
        typeof proto[method],
        `CLI '${command}' maps to missing MonitorService#${method}`
      ).toBe("function");
    }
  });

  it("keeps CLI command names unique in the mapping table", () => {
    const commands = Object.keys(CLI_TO_METHOD);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("exposes the package version through the service", () => {
    expect(createMonitorService().version()).toBe(MONITOR_VERSION);
  });

  it("exposes convenience methods beyond the parity set", () => {
    const proto = MonitorService.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.machineDelete).toBe("function");
    expect(typeof proto.version).toBe("function");
  });
});

describe("SDK behavior against a scratch database", () => {
  const scratch = mkdtempSync(join(tmpdir(), "monitor-sdk-parity-"));
  const DB_PATH = join(scratch, "monitor.db");

  beforeAll(() => {
    // Isolate config and db from the operator's real store.
    process.env.MONITOR_CONFIG_DIR = scratch;
    closeDb();
    getDb(DB_PATH);
  });

  afterAll(() => {
    closeDb();
    delete process.env.MONITOR_CONFIG_DIR;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("machineAdd then machinesList round-trips", () => {
    const svc = createMonitorService();
    const id = svc.machineAdd({ name: "Parity Fixture", type: "local" });
    expect(id).toBe("parity-fixture");
    const machines = svc.machinesList();
    expect(machines.some((m) => m.id === "parity-fixture")).toBe(true);
  });

  it("registerAgent, heartbeat, setFocus and listAgents round-trip", () => {
    const svc = createMonitorService();
    svc.registerAgent({ id: "parity-agent", name: "Parity Agent" });
    svc.agentHeartbeat("parity-agent");
    svc.agentSetFocus("parity-agent", "parity-test");
    const agents = svc.listAgents();
    const agent = agents.find((a) => a.id === "parity-agent");
    expect(agent?.name).toBe("Parity Agent");
  });

  it("cron add, list and toggle round-trip", () => {
    const svc = createMonitorService();
    const id = svc.cron("add", {
      name: "parity-job",
      schedule: "*/5 * * * *",
      command: "true",
    }) as number;
    const jobs = svc.cron("list", {}) as Array<{ id: number; name: string; enabled: number }>;
    const job = jobs.find((j) => j.id === id);
    expect(job?.name).toBe("parity-job");
    const enabled = svc.cron("toggle", { job_id: id });
    expect(enabled).toBe(0);
  });

  it("alerts returns stored rows", async () => {
    const svc = createMonitorService();
    // No machine id: pure stored-alert path, no live collection.
    const alerts = await svc.alerts(undefined, false);
    expect(Array.isArray(alerts)).toBe(true);
  });

  it("sendFeedback inserts a row", () => {
    const svc = createMonitorService();
    const id = svc.sendFeedback({ source: "user", rating: 5, message: "parity test" });
    expect(typeof id).toBe("number");
  });

  it("search finds the seeded machine by name", () => {
    const svc = createMonitorService();
    // The machines FTS index covers the name column; tokenize accordingly.
    const results = svc.search("parity", ["machines"]);
    expect(results.length).toBeGreaterThan(0);
  });

  it("integrations get returns the configured value", () => {
    const svc = createMonitorService();
    const integrations = svc.integrations("get");
    expect(integrations).toBeDefined();
  });
});
