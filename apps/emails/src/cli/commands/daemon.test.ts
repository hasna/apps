import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDaemonCommands } from "./daemon.remote.js";
let server: ReturnType<typeof Bun.serve>, home: string, prior: Record<string, string | undefined>, mode = "complete";
const worker = { id: "00000000-0000-4000-8000-000000000038", component: "scheduler", generation: 1, state: "running", desired: "running", lease_until: "2026-09-07T00:01:00.000Z", heartbeat_at: "2026-09-07T00:00:00.000Z", lease_fresh: true, restart_id: null, interval_ms: 1000 };
const managed = (key: string) => key === "HOME" || key.startsWith("EMAILS_") || key.startsWith("HASNA_EMAILS_");
beforeAll(() => { server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => { const url = new URL(request.url); if (mode === "legacy") return Response.json({ error: "not found" }, { status: 404 }); if (url.pathname === "/v1/workers") return Response.json({ items: mode === "empty" ? [] : [worker], complete: true }); const body = await request.json() as { action: string; request_id: string }; return Response.json({ restart: { id: body.request_id, worker_id: worker.id, status: mode === "pending" ? "draining" : "complete", old_generation: 1, new_generation: mode === "pending" ? null : 2 } }, { status: mode === "pending" ? 202 : 200 }); } }); });
afterAll(() => server.stop(true));
beforeEach(() => { prior = Object.fromEntries(Object.entries(process.env).filter(([key]) => managed(key))); for (const key of Object.keys(process.env)) if (managed(key)) delete process.env[key]; home = mkdtempSync(join(tmpdir(), "emails-daemon-unit-")); Object.assign(process.env, { HOME: home, EMAILS_HOME: home, HASNA_EMAILS_HOME: home, EMAILS_SELF_HOSTED_URL: server.url.origin, EMAILS_SELF_HOSTED_API_KEY: crypto.randomUUID(), EMAILS_CLIENT_ENV_LOADED: "1" }); mode = "complete"; });
afterEach(() => {
  // Restore each inherited value; remove only keys absent before this test.
  for (const key of new Set([...Object.keys(process.env).filter(managed), ...Object.keys(prior)])) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
  rmSync(home, { recursive: true, force: true });
  process.exitCode = 0;
});
async function runDaemon(args: string[]) { const program = new Command(); program.exitOverride(); let data: unknown; const out: string[] = []; registerDaemonCommands(program, (payload, formatted) => { data = payload; out.push(formatted); }); await program.parseAsync(["node", "emails", ...args]); return { data, output: out.join("\n") }; }
describe("daemon status and restart use actual worker evidence", () => {
  it("reports registered generation and lease facts", async () => { const result = await runDaemon(["daemon", "status"]); expect(result.data).toMatchObject({ items: [{ generation: 1, lease_fresh: true }] }); expect(result.output).toContain("generation 1"); });
  it("an empty registry directs explicit foreground startup without fabricated liveness", async () => { mode = "empty"; const result = await runDaemon(["daemon", "status"]); expect(result.output).toContain("No registered workers"); expect(result.output).not.toContain("restarted"); });
  it("only a completed new-generation receipt reports restart success", async () => { const result = await runDaemon(["daemon", "restart", "--worker", worker.id, "--idempotency-key", crypto.randomUUID()]); expect(result.data).toMatchObject({ restarted: true, restart: { old_generation: 1, new_generation: 2 } }); expect(result.output).toContain("generation 1 -> 2"); });
  it("pending restart has a failing exit and retained request identity", async () => { mode = "pending"; const key = crypto.randomUUID(), result = await runDaemon(["daemon", "restart", "--worker", worker.id, "--idempotency-key", key, "--timeout", "1"]); expect(result.data).toMatchObject({ restarted: false, request_id: key }); expect(process.exitCode).toBe(1); });
});
describe("logs tail reads tenant API lifecycle events", () => {
  async function api(items: unknown[], run: () => Promise<void>) {
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0, fetch: request => {
        expect(request.headers.get("authorization")).toMatch(/^Bearer /);
        const url = new URL(request.url); expect(url.pathname).toBe("/v1/runtime/logs");
        return Response.json({ scope: "tenant_api_operations", component: url.searchParams.get("component"), items, container_stdout: false, worker_liveness: "not_measured" });
      }
    });
    const previous = process.env.EMAILS_SELF_HOSTED_URL; process.env.EMAILS_SELF_HOSTED_URL = `http://127.0.0.1:${server.port}`;
    try { await run(); } finally { server.stop(true); if (previous === undefined) delete process.env.EMAILS_SELF_HOSTED_URL; else process.env.EMAILS_SELF_HOSTED_URL = previous; }
  }
  it("renders API events with original component and line options", async () => {
    await api([{ id: crypto.randomUUID(), request_id: crypto.randomUUID(), component: "scheduler", operation: "scheduled_run", event: "returned", http_status: 200, created_at: "2026-09-07T00:00:00.000Z" }], async () => {
      const { data, output } = await runDaemon(["logs", "tail", "--component", "scheduler", "--lines", "2"]);
      expect(data).toMatchObject({ scope: "tenant_api_operations", container_stdout: false }); expect(output).toContain("scheduled_run  returned HTTP 200"); expect(output).not.toContain("stopped");
    });
  });
  it("empty components do not claim a stopped worker", async () => {
    await api([], async () => { const { data, output } = await runDaemon(["logs", "tail", "--component", "nightly"]); expect(data).toMatchObject({ items: [], worker_liveness: "not_measured" }); expect(output).toContain("not evidence that a worker is stopped"); });
  });
  it("rejects invalid component and line inputs before transport", async () => {
    const originalExit = process.exit, originalError = console.error; console.error = () => { }; process.exit = ((code?: number) => { throw Error(`process.exit:${code}`); }) as typeof process.exit;
    try { for (const args of [["--component", "constructor"], ["--component", "__proto__"], ["--lines", "2x"], ["--lines", "501"]]) await expect(runDaemon(["logs", "tail", ...args])).rejects.toThrow("process.exit:1"); }
    finally { process.exit = originalExit; console.error = originalError; }
  });
});
