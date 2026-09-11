// PORT-TO-API — memory ACLs and ratings (client half).
//
// Both wrote a per-station SQLite table and had no hosted route:
//   - an ACL rule set on one machine bound nothing anywhere else, and
//     `checkPermission`'s documented "no rules for this agent = full access"
//     default meant every OTHER machine silently granted access to the key the
//     operator had just restricted;
//   - `memory_rate` fed the usefulness signal every agent is told to produce
//     into a file nothing else reads, so the ratio a station reported was its
//     own keystrokes.
//
// The server half (the routes against a real store, including the deny-by-
// default and glob cases) is src/server/acl-ratings-route.test.ts.
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
    `mementos-port-acl-ratings-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
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
  const home = mkdtempSync(join(tmpdir(), "mementos-port-acl-ratings-home-"));
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

describe("PORT-TO-API — ACLs and ratings reach /v1", () => {
  test("memory_acl_set → POST /v1/acl with the rule in the body", async () => {
    const lines = await runScenario("memory_acl_set");
    expect(routes(lines)).toContain("POST /v1/acl");
    const post = lines.find((l) => l.startsWith("POST /v1/acl"))!;
    expect(post).toContain('"agent_id":"agent-1"');
    expect(post).toContain('"key_pattern":"architecture-*"');
    expect(post).toContain('"permission":"read"');
  });

  test("memory_acl_list → GET /v1/acl?agent_id=", async () => {
    const lines = await runScenario("memory_acl_list");
    expect(routes(lines)).toContain("GET /v1/acl");
    expect(lines.join("\n")).toContain("agent_id=agent-1");
  });

  test("memory_rate → POST /v1/memories/:id/ratings, then the hosted summary", async () => {
    const lines = await runScenario("memory_rate");
    const r = routes(lines);
    expect(r).toContain("POST /v1/memories/mem-1/ratings");
    // the tool reports the ratio, which must come from the server, not a local count
    expect(r).toContain("GET /v1/memories/mem-1/ratings");
    const post = lines.find((l) => l.startsWith("POST /v1/memories/mem-1/ratings"))!;
    expect(post).toContain('"useful":true');
  });

  test("the permission DECISION is taken server-side → GET /v1/acl/check", async () => {
    const lines = await runScenario("acl-check");
    expect(routes(lines)).toContain("GET /v1/acl/check");
    const line = lines.find((l) => l.startsWith("GET /v1/acl/check"))!;
    expect(line).toContain("agent_id=agent-1");
    expect(line).toContain("permission=read");
  });
});
