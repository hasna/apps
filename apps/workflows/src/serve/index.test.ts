import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflowsService } from "../service.js";
import { createWorkflowsServer } from "./server.js";

let triggerDir: string | undefined;

const pkgDir = join(import.meta.dir, "..", "..");
const pkgVersion = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version as string;

const servers: { stop: () => void }[] = [];

function startServer(port: number) {
  const server = createWorkflowsServer(createWorkflowsService({ port, host: "127.0.0.1" }));
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

afterEach(() => {
  while (servers.length > 0) servers.pop()?.stop();
});

describe("workflows-serve (slice 1 scaffold)", () => {
  test("/health returns 200 with a health report", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const h = (await res.json()) as { ok: boolean; service: string; version: string };
    expect(h.ok).toBe(true);
    expect(h.service).toBe("workflows");
    expect(h.version).toBe(pkgVersion);
  });

  test("/ready returns 200 with the version check", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    const r = (await res.json()) as { ok: boolean; checks: Record<string, string> };
    expect(r.ok).toBe(true);
    expect(r.checks).toEqual({ version: "ok" });
  });

  test("/version returns service name and version", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/version`);
    expect(res.status).toBe(200);
    const v = (await res.json()) as { service: string; version: string };
    expect(v.service).toBe("workflows");
    expect(v.version).toBe(pkgVersion);
  });

  test("/openapi.json returns a document describing the scaffold endpoints", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/openapi.json`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toContain("3.");
    expect(Object.keys(doc.paths)).toContain("/health");
    expect(Object.keys(doc.paths)).toContain("/ready");
    expect(Object.keys(doc.paths)).toContain("/version");
  });

  test("unknown paths return 404", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  test("--version answers before binding and exits 0", async () => {
    const proc = Bun.spawn(["bun", "src/serve/index.ts", "--version"], { cwd: pkgDir, stdout: "pipe", stderr: "pipe" });
    const stdout = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toBe(pkgVersion);
  });

  test("--help answers before binding and exits 0", async () => {
    const proc = Bun.spawn(["bun", "src/serve/index.ts", "--help"], { cwd: pkgDir, stdout: "pipe", stderr: "pipe" });
    const stdout = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toContain("workflows-serve");
  });
});

describe("the authenticated /trigger", () => {
  const triggerGraph = {
    name: "trigger-demo",
    version: "1.0.0",
    nodes: [
      { id: "start", type: "start", next: "work" },
      { id: "work", type: "step", command: "printf trigger-ok", next: "done" },
      { id: "done", type: "end" },
    ],
  };

  afterEach(() => {
    if (triggerDir) {
      rmSync(triggerDir, { recursive: true, force: true });
      triggerDir = undefined;
    }
  });

  function startTriggerServer(): string {
    triggerDir = mkdtempSync(join(tmpdir(), "workflows-trigger-"));
    const server = createWorkflowsServer(
      createWorkflowsService({ port: 0, host: "127.0.0.1", apiKey: "test-key-12345", dataDir: triggerDir }),
    );
    servers.push(server);
    return `http://127.0.0.1:${server.port}`;
  }

  test("runs a graph to completion with a valid Bearer token", async () => {
    const base = startTriggerServer();
    const res = await fetch(`${base}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-12345" },
      body: JSON.stringify({ graph: triggerGraph }),
    });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { runId: string; status: string; reused: boolean };
    expect(summary.status).toBe("completed");
    expect(summary.reused).toBe(false);
    expect(summary.runId.length).toBeGreaterThan(0);
  });

  test("rejects an unauthenticated trigger with 401", async () => {
    const base = startTriggerServer();
    const res = await fetch(`${base}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph: triggerGraph }),
    });
    expect(res.status).toBe(401);
  });

  test("rejects a wrong Bearer token with 401", async () => {
    const base = startTriggerServer();
    const res = await fetch(`${base}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-key" },
      body: JSON.stringify({ graph: triggerGraph }),
    });
    expect(res.status).toBe(401);
  });

  test("refuses with 503 when no API key is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "workflows-trigger-nokey-"));
    try {
      const server = createWorkflowsServer(createWorkflowsService({ port: 0, host: "127.0.0.1", dataDir: dir }));
      servers.push(server);
      const res = await fetch(`http://127.0.0.1:${server.port}/trigger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph: triggerGraph }),
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("trigger_not_configured");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an idempotency key makes a repeated trigger reuse the same run", async () => {
    const base = startTriggerServer();
    const body = JSON.stringify({ graph: triggerGraph, idempotencyKey: "trigger-idem-1" });
    const first = await fetch(`${base}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-12345" },
      body,
    });
    const firstSummary = (await first.json()) as { runId: string; status: string; reused: boolean };
    expect(firstSummary.status).toBe("completed");
    const second = await fetch(`${base}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-12345" },
      body,
    });
    const secondSummary = (await second.json()) as { runId: string; reused: boolean };
    expect(secondSummary.runId).toBe(firstSummary.runId);
    expect(secondSummary.reused).toBe(true);
  });

  test("/openapi.json documents the authenticated trigger", async () => {
    const base = startTriggerServer();
    const res = await fetch(`${base}/openapi.json`);
    const doc = (await res.json()) as { paths: Record<string, unknown>; components: { securitySchemes: Record<string, unknown> } };
    expect(doc.paths["/trigger"]).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
  });
});
