// PORT-TO-API — the audit log (client half).
//
// `memory_audit_trail` and `memory_audit_export` read `memory_audit_log` out of
// the on-box SQLite file. On a hosted install that file holds none of the
// history, so a compliance surface answered "No audit entries for memory X" for
// a memory with a full trail in the cloud store — worse than an error.
//
// The server half (the new /api/audit family driven through the real router
// against a real store, including that it does not shadow the low-trust
// `GET /api/memories/audit` list) is src/server/audit-route.test.ts.
//
// Harness shared with port-to-api-slice-a.test.ts.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stubApiEnv } from "../test-support/store-isolation.js";

let stubProc: ReturnType<typeof Bun.spawn> | undefined;
let captureFile = "";
let baseUrl = "";

async function spawnCaptureStub(): Promise<string> {
  captureFile = join(
    tmpdir(),
    `mementos-port-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  );
  writeFileSync(captureFile, "");
  const proc = Bun.spawn(
    ["bun", "run", `${import.meta.dir}/__fixtures__/port-slice-a-capture-server.ts`],
    { env: { ...(process.env as Record<string, string>), CAPTURE_FILE: captureFile }, stdout: "pipe", stderr: "pipe" },
  );
  const reader = proc.stdout?.getReader();
  const chunk = await reader?.read();
  const text = new TextDecoder().decode(chunk?.value ?? new Uint8Array());
  const m = /READY (\d+)/.exec(text);
  if (!m) {
    proc.kill();
    throw new Error(`capture stub did not start: ${text}`);
  }
  stubProc = proc;
  return `http://127.0.0.1:${m[1]}`;
}

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

async function runScenario(scenario: string): Promise<string[]> {
  writeFileSync(captureFile, "");
  const home = mkdtempSync(join(tmpdir(), "mementos-port-audit-home-"));
  const env = stubApiEnv(baseUrl);
  env["HOME"] = home;
  env["CAPTURE_FILE"] = captureFile;
  env["SCENARIO"] = scenario;

  const runner = Bun.spawn(
    ["bun", "run", `${import.meta.dir}/__fixtures__/port-slice-a-client-runner.ts`],
    { env, stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await runner.exited;
  if (exitCode !== 0) {
    const err = new TextDecoder().decode(await new Response(runner.stderr).arrayBuffer());
    throw new Error(`scenario ${scenario} failed (exit ${exitCode}):\n${err}`);
  }

  const strays = walk(home).filter((f) => /\.db($|-wal$|-shm$|\.)/.test(f));
  expect(strays).toEqual([]);
  rmSync(home, { recursive: true, force: true });

  return readFileSync(captureFile, "utf8").split("\n").filter((l) => l.trim().length > 0);
}

function routes(lines: string[]): string[] {
  return lines.map((l) => l.split(" ").slice(0, 2).join(" ").split("?")[0]!);
}

beforeAll(async () => {
  baseUrl = await spawnCaptureStub();
});

afterAll(() => {
  stubProc?.kill();
  stubProc = undefined;
  for (const suffix of ["", ".done"]) {
    const f = captureFile + suffix;
    if (f && existsSync(f)) rmSync(f);
  }
});

describe("PORT-TO-API — the audit log reaches /v1", () => {
  test("memory_audit_trail → GET /v1/memories/:id/audit-trail", async () => {
    const lines = await runScenario("memory_audit_trail");
    expect(routes(lines)).toContain("GET /v1/memories/mem-1/audit-trail");
    expect(lines.join("\n")).toContain("limit=50");
  });

  test("memory_audit_export → GET /v1/audit/export with the filters serialized", async () => {
    const lines = await runScenario("memory_audit_export");
    expect(routes(lines)).toContain("GET /v1/audit/export");
    const line = lines.find((l) => l.startsWith("GET /v1/audit/export"))!;
    expect(line).toContain("operation=update");
    expect(line).toMatch(/limit=\d+/);
  });

  test("the audit stats read → GET /v1/audit/stats", async () => {
    const lines = await runScenario("audit-stats");
    expect(routes(lines)).toContain("GET /v1/audit/stats");
  });
});
