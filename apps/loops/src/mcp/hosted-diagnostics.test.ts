import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Loop, LoopRun } from "../types.js";

/**
 * The four MCP diagnostics on a hosted connection (W13 PORT-TO-API).
 *
 * `loops_doctor`, `loops_health`, `loops_health_scan` and `loops_diagnose` used
 * to refuse outright whenever the server was flipped to the hosted API
 * (`withLocalStore`), while the CLI had answered the same questions against
 * `/v1` since the hosted-diagnostics work. An agent therefore had no way to ask
 * "is the fleet healthy?" in the only configuration this fleet runs.
 *
 * These tests pin the hosted transport: each tool must read `/v1`, must name the
 * backend it read, and must never fall back to the on-box sqlite island (the
 * temp HOME is asserted free of any `*.db*` file afterwards).
 */

const PAST = "2026-01-01T00:00:00.000Z";
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function hostedLoop(overrides: Partial<Loop> & Pick<Loop, "id" | "name">): Loop {
  return {
    labels: [],
    status: "active",
    schedule: { type: "interval", everyMs: 300_000 },
    target: { type: "command", command: "true" },
    nextRunAt: "2099-01-01T00:00:00.000Z",
    catchUp: "none",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 0,
    leaseMs: 60_000,
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  } as Loop;
}

function hostedRun(loop: Loop, overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    id: `run-${loop.id}`,
    loopId: loop.id,
    loopName: loop.name,
    scheduledFor: PAST,
    attempt: 1,
    status: "succeeded",
    startedAt: PAST,
    finishedAt: PAST,
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  } as LoopRun;
}

/**
 * Hosted `/v1` stub serving only the read endpoints the diagnostics may use.
 * Anything else 404s, so a tool reaching for an endpoint the hosted contract
 * does not expose degrades visibly instead of silently.
 */
function serveHosted(loops: Loop[], runsByLoop: Record<string, LoopRun[]>) {
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      if (request.method !== "GET") {
        return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
      }
      if (url.pathname === "/v1/loops") {
        const status = url.searchParams.get("status");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "200");
        const filtered = status ? loops.filter((loop) => loop.status === status) : loops;
        return Response.json({ ok: true, loops: filtered.slice(offset, offset + limit) });
      }
      if (url.pathname.startsWith("/v1/loops/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/loops/".length));
        const found = loops.find((loop) => loop.id === id || loop.name === id);
        return found
          ? Response.json({ ok: true, loop: found })
          : Response.json({ ok: false, error: "not_found" }, { status: 404 });
      }
      if (url.pathname === "/v1/runs") {
        const loopId = url.searchParams.get("loopId") ?? "";
        const status = url.searchParams.get("status");
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const source = loopId
          ? (runsByLoop[loopId] ?? [])
          : Object.values(runsByLoop).flat();
        const filtered = status ? source.filter((run) => run.status === status) : source;
        return Response.json({ ok: true, runs: filtered.slice(0, limit) });
      }
      if (url.pathname === "/v1/status") return Response.json({ ok: true, service: "loops-api" });
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  });
  return { server, paths };
}

async function connectHostedMcp(root: string, port: number): Promise<{ client: Client; transport: StdioClientTransport }> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/mcp/index.ts", "--stdio"],
    cwd: process.cwd(),
    env: {
      ...env,
      HOME: root,
      HASNA_HOME: root,
      HASNA_CONFIG_HOME: root,
      LOOPS_DATA_DIR: join(root, "loops-data"),
      MCP_STDIO: "1",
      HASNA_LOOPS_CONNECTION: "",
      HASNA_STATION: "loops-hermetic-no-such-station",
      HASNA_LOOPS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_LOOPS_API_KEY: "test-hosted-key",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "loops-hosted-diagnostics-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, transport };
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text?: string }>;
  const entry = content[0];
  if (!entry || entry.type !== "text") throw new Error(`expected text MCP content, got ${JSON.stringify(result.content)}`);
  return JSON.parse(entry.text ?? "") as Record<string, unknown>;
}

function dbFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.includes(".db")) found.push(full);
    }
  };
  walk(dir);
  return found;
}

describe("hosted MCP diagnostics (W13 PORT-TO-API)", () => {
  test("loops_health, loops_health_scan, loops_doctor and loops_diagnose all answer from /v1", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-hosted-diag-"));
    roots.push(root);
    const healthy = hostedLoop({ id: "loop-ok", name: "loop-ok" });
    const failing = hostedLoop({ id: "loop-bad", name: "loop-bad" });
    const { server, paths } = serveHosted([healthy, failing], {
      [healthy.id]: [hostedRun(healthy)],
      [failing.id]: [hostedRun(failing, { id: "run-bad", status: "failed", exitCode: 1, stderr: "boom" } as Partial<LoopRun>)],
    });
    const { client, transport } = await connectHostedMcp(root, server.port as number);
    try {
      // 1. loops_health
      const health = payload(await client.callTool({ name: "loops_health", arguments: {} })) as {
        summary: { loops: number; unhealthy: number };
        backend: { transport: string; apiUrl: string };
        unchecked: Array<{ id: string }>;
        executionTruth: Array<{ loopId: string }>;
      };
      expect(health.backend.transport).toBe("api");
      expect(health.backend.apiUrl).toContain(`127.0.0.1:${server.port}`);
      expect(health.summary.loops).toBe(2);
      expect(health.summary.unhealthy).toBeGreaterThanOrEqual(1);
      expect(health.unchecked.length).toBeGreaterThan(0);
      expect(health.executionTruth.map((entry) => entry.loopId).sort()).toEqual(["loop-bad", "loop-ok"]);

      // 2. loops_health_scan
      const scan = payload(await client.callTool({ name: "loops_health_scan", arguments: {} })) as {
        counts: { loops: number };
        backend: { transport: string };
        findings: Array<{ kind: string }>;
      };
      expect(scan.backend.transport).toBe("api");
      expect(scan.counts.loops).toBeGreaterThan(0);
      expect(scan.findings.some((finding) => finding.kind.length > 0)).toBe(true);

      // 2b. the machine-local parts of the scan are refused, not faked
      const scanLocalOnly = await client.callTool({ name: "loops_health_scan", arguments: { daemon: true } });
      expect(scanLocalOnly.isError).toBe(true);
      expect(JSON.stringify(scanLocalOnly.content)).toContain("machine-local");

      // 3. loops_doctor
      const doctor = payload(await client.callTool({ name: "loops_doctor", arguments: {} })) as {
        checks: Array<{ id: string; scope?: string }>;
        backend: { transport: string };
        unchecked: Array<{ id: string }>;
      };
      expect(doctor.backend.transport).toBe("api");
      expect(doctor.checks.some((check) => check.id === "control-plane")).toBe(true);
      // Machine-scoped and control-plane-scoped checks stay labelled.
      expect(doctor.checks.some((check) => check.scope === "machine")).toBe(true);
      expect(doctor.checks.some((check) => check.scope === "control-plane")).toBe(true);

      // 4. loops_diagnose
      const diagnose = payload(await client.callTool({ name: "loops_diagnose", arguments: { idOrName: "loop-bad" } })) as {
        loop: { id: string };
        expectation: { ok: boolean };
        recentRuns: Array<{ run: { id: string }; failure?: { classification: string } }>;
        backend: { transport: string };
      };
      expect(diagnose.backend.transport).toBe("api");
      expect(diagnose.loop.id).toBe("loop-bad");
      expect(diagnose.expectation.ok).toBe(false);
      expect(diagnose.recentRuns.map((entry) => entry.run.id)).toEqual(["run-bad"]);

      // Every answer came off the hosted control plane...
      expect(paths).toContain("GET /v1/loops");
      expect(paths).toContain("GET /v1/runs");
      expect(paths.some((path) => path.startsWith("GET /v1/loops/loop-bad"))).toBe(true);
      // ...and nothing opened a local database.
      expect(dbFilesUnder(root)).toEqual([]);
    } finally {
      await client.close();
      await transport.close();
      server.stop(true);
    }
  }, 30_000);

  test("an unreachable control plane fails the diagnostics loudly instead of reading the local island", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-hosted-diag-down-"));
    roots.push(root);
    // Port 1 refuses connections: the hosted read must fail, and the tool must
    // NOT quietly answer from an on-box store.
    const { client, transport } = await connectHostedMcp(root, 1);
    try {
      for (const name of ["loops_health", "loops_health_scan", "loops_diagnose"] as const) {
        const args = name === "loops_diagnose" ? { idOrName: "whatever" } : {};
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
      }
      expect(dbFilesUnder(root)).toEqual([]);
    } finally {
      await client.close();
      await transport.close();
    }
  }, 30_000);
});
