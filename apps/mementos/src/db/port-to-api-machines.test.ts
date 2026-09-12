// PORT-TO-API — the machines family (client half).
//
// Machines was the one mementos domain with NO hosted route: `src/db/machines.ts`
// defaulted every parameter to `getDatabase()`, so the four machine MCP tools and
// the machine-visibility filter used by `projects` / `inject` / `context` /
// `project-panel` read and wrote a per-station SQLite table. Two machines could
// therefore never see each other, and the visibility filter silently fell back to
// "no filter" when the local read failed.
//
// The server half (the new /api/machines routes against the real store, including
// the "the caller's hostname is not the server's" refusal) is
// src/server/machines-route.test.ts. This file proves the CLIENT half: the shipped
// MCP tool callbacks issue the hosted requests and create no local database.
//
// Harness: shared with port-to-api-slice-a.test.ts — a loopback capture server and
// the tool callbacks, each in its own process (the api-mode transport is a blocking
// Bun.spawnSync(curl), so an in-process server can never answer).

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
    `mementos-port-machines-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
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
  const home = mkdtempSync(join(tmpdir(), "mementos-port-machines-home-"));
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

describe("PORT-TO-API — machine registry reaches /v1", () => {
  test("register_machine → POST /v1/machines, carrying THIS machine's hostname and platform", async () => {
    const lines = await runScenario("register_machine");
    expect(routes(lines)).toContain("POST /v1/machines");
    const post = lines.find((l) => l.startsWith("POST /v1/machines"))!;
    // The server cannot observe the caller's identity, so it has to be in the body.
    expect(post).toMatch(/"hostname":"[^"]+"/);
    expect(post).toMatch(/"platform":"[^"]+"/);
    expect(post).toContain('"name":"apple01"');
  });

  test("list_machines → GET /v1/machines (no local fallback note)", async () => {
    const lines = await runScenario("list_machines");
    expect(routes(lines)).toContain("GET /v1/machines");
  });

  test("rename_machine → GET then PATCH /v1/machines/:id", async () => {
    const lines = await runScenario("rename_machine");
    const r = routes(lines);
    expect(r).toContain("GET /v1/machines/machine-1");
    expect(r).toContain("PATCH /v1/machines/machine-1");
    const patch = lines.find((l) => l.startsWith("PATCH /v1/machines/"))!;
    expect(patch).toContain('"name":"renamed"');
  });

  test("set_primary_machine → POST /v1/machines/:id/primary", async () => {
    const lines = await runScenario("set_primary_machine");
    expect(routes(lines)).toContain("POST /v1/machines/machine-1/primary");
  });

  test("getCurrentMachineId resolves ONCE per process — no register write per read", async () => {
    const lines = await runScenario("machine-visibility-memo");
    // Three calls, one request. Without the memo this is three POSTs, i.e. a
    // write in front of every memory_save / memory_inject / projects read.
    expect(routes(lines).filter((r) => r === "POST /v1/machines")).toEqual(["POST /v1/machines"]);
  });

  test("the machine-visibility filter resolves from /v1 instead of degrading to null", async () => {
    const lines = await runScenario("machine-visibility");
    // getCurrentMachineId registers-or-returns via the idempotent hosted create.
    expect(routes(lines)).toContain("POST /v1/machines");
  });
});
