// PORT-TO-API — the ACL and ratings families (client half).
//
// ACLs and ratings had no hosted route: `setAcl` and `listAcls` wrote a
// per-station SQLite table, and `rateMemory` recorded usefulness feedback into
// the same local file, so the signal never reached the shared store. Worse for
// ACLs, because authorization is the surface: `checkPermission`'s "no ACLs for
// this agent = full access" default turned a rule written on one machine into a
// grant on every OTHER machine.
//
// The server half (the routes against the real store, and ENFORCEMENT on the
// authoritative memory boundaries) is src/server/acl-enforcement.test.ts. This
// file proves the CLIENT half: the shipped db/ functions issue the hosted
// requests, the ACL decision is taken SERVER-side, and no local database is
// created.
//
// Harness: shared with port-to-api-slice-a.test.ts — a loopback capture server
// and the functions, each in its own process (the api-mode transport is a
// blocking Bun.spawnSync(curl), so an in-process server can never answer).

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

async function runScenario(scenario: string, responseMode = "valid"): Promise<string[]> {
  writeFileSync(captureFile, "");
  const home = mkdtempSync(join(tmpdir(), "mementos-port-acl-home-"));
  const env = stubApiEnv(baseUrl, { apiKey: `stub-${responseMode}` });
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

  // No local store may be created by any of these hosted calls.
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

describe("PORT-TO-API — ACL + ratings reach /v1", () => {
  test("setAcl → POST /v1/acl", async () => {
    const lines = await runScenario("acl-set");
    expect(routes(lines)).toContain("POST /v1/acl");
  });

  test("listAcls → GET /v1/acl?agent_id=", async () => {
    const lines = await runScenario("acl-list");
    expect(routes(lines)).toContain("GET /v1/acl");
  });

  test("checkPermission asks the SERVER for the decision, not a local rule list", async () => {
    const lines = await runScenario("acl-check");
    // The decision must come from the check endpoint: reading the rules and
    // re-deriving locally is what turned a partial (or empty) rule set into a
    // grant under the permissive no-rules default.
    expect(routes(lines)).toContain("GET /v1/acl/check");
  });

  test("removeAcl → DELETE /v1/acl/:id", async () => {
    const lines = await runScenario("acl-remove");
    expect(routes(lines)).toContain("DELETE /v1/acl/acl-1");
  });

  test("rateMemory → POST /v1/memories/:id/ratings", async () => {
    const lines = await runScenario("rate-memory");
    expect(routes(lines)).toContain("POST /v1/memories/mem-1/ratings");
  });

  test("listRatingsForMemory → GET /v1/memories/:id/ratings", async () => {
    const lines = await runScenario("list-ratings");
    expect(routes(lines)).toContain("GET /v1/memories/mem-1/ratings");
  });

  test("getRatingsSummary reads the hosted summary", async () => {
    const lines = await runScenario("ratings-summary");
    expect(routes(lines)).toContain("GET /v1/memories/mem-1/ratings");
  });

  test("a 2xx ratings response with no rating is REFUSED, not read as recorded", async () => {
    await runScenario("malformed-rate", "malformed-rate");
  });

  test("a 2xx delete response without deleted:true is REFUSED", async () => {
    await runScenario("malformed-acl-remove", "malformed-acl-remove");
  });
});
