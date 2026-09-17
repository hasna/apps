// PORT-TO-API slice A — hosted-path proof for the surfaces this slice moved
// off local SQLite (fleet alignment, 2026-09-11).
//
// What each test proves, for ONE named CLI command or MCP tool:
//   1. under a hosted credential the shipped handler issues the expected
//      `/v1` request (method + path + body), against a real loopback server —
//      not a mocked module, not a fetch spy;
//   2. the handler consumes the hosted answer (the assertions on printed
//      output / returned objects live in the runner scenarios);
//   3. the run creates NO `*.db*` file anywhere under a scratch HOME.
//
// Surfaces covered here (T1 §4 "PORT-TO-API" rows):
//   memory_synthesize, memory_synthesis_status, memory_synthesis_history,
//   memory_synthesis_rollback, `synthesis run|status|rollback`,
//   `synthesized-profile` + memory_profile, memory_lock, memory_unlock,
//   memory_check_lock, agentHoldsLock, memory_ingest_session,
//   memory_session_status, memory_session_list, `session ingest|status|list`,
//   the session queue stats read, plus regression cover for memory_stale and
//   the tool-events read (T1 called those local; main already hosts them and
//   this slice must not regress them).
//
// Architecture note (same as memories-list-api-filter.test.ts): the api-mode
// transport is a blocking Bun.spawnSync(curl), so the stub server and the
// client BOTH have to be separate processes — an in-process Bun.serve can
// never answer while spawnSync holds the loop.

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
    `mementos-port-slice-a-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  );
  writeFileSync(captureFile, "");
  const proc = Bun.spawn(
    ["bun", "run", `${import.meta.dir}/__fixtures__/port-slice-a-capture-server.ts`],
    {
      env: {
        ...(process.env as Record<string, string>),
        CAPTURE_FILE: captureFile,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
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

/** Every file under a directory tree, relative to it. */
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

/**
 * Run one scenario in a child process pinned to the stub, with HOME pointing
 * at an empty scratch dir. Returns the captured request lines.
 */
async function runScenario(scenario: string, responseMode = "valid"): Promise<string[]> {
  writeFileSync(captureFile, "");
  const home = mkdtempSync(join(tmpdir(), "mementos-port-slice-a-home-"));
  const env = stubApiEnv(baseUrl, { apiKey: `stub-${responseMode}` });
  env["HOME"] = home;
  env["HASNA_MEMENTOS_HOME"] = join(home, "mementos-data");
  env["MEMENTOS_HOME"] = join(home, "mementos-data");
  env["HASNA_DATA_HOME"] = join(home, "hasna-data");
  env["HASNA_CONFIG_HOME"] = join(home, "hasna-config");
  env["HASNA_STATION"] = "mementos-port-slice-a-no-such-station";
  // Never let a scenario make a billed LLM call.
  env["ANTHROPIC_API_KEY"] = "";
  env["OPENAI_API_KEY"] = "";
  env["CEREBRAS_API_KEY"] = "";
  env["XAI_API_KEY"] = "";
  env["CAPTURE_FILE"] = captureFile;
  env["SCENARIO"] = scenario;

  try {
    const runner = Bun.spawn(
      ["bun", "run", `${import.meta.dir}/__fixtures__/port-slice-a-client-runner.ts`],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await runner.exited;
    if (exitCode !== 0) {
      const err = new TextDecoder().decode(await new Response(runner.stderr).arrayBuffer());
      const out = new TextDecoder().decode(await new Response(runner.stdout).arrayBuffer());
      throw new Error(`scenario ${scenario} failed (exit ${exitCode}):\n${err}\n${out}`);
    }

    // Every configurable Mementos/data/config root is under this HOME, so a
    // local store cannot escape the proof through an inherited path override.
    const strays = walk(home).filter((f) => /\.db($|-wal$|-shm$|\.)/.test(f));
    expect(strays).toEqual([]);
    return readFileSync(captureFile, "utf8").split("\n").filter((l) => l.trim().length > 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** The "METHOD /path" prefix of every captured request. */
function routes(lines: string[]): string[] {
  return lines.map((l) => l.split(" ").slice(0, 2).join(" ").split("?")[0]!);
}

beforeAll(async () => {
  baseUrl = await spawnCaptureStub();
});

afterAll(() => {
  stubProc?.kill();
  stubProc = undefined;
  for (const suffix of [""]) {
    const f = captureFile + suffix;
    if (f && existsSync(f)) rmSync(f);
  }
});

describe("PORT-TO-API slice A — synthesis family reaches /v1", () => {
  test("memory_synthesize → POST /v1/synthesis/run (server runs the pipeline)", async () => {
    const lines = await runScenario("memory_synthesize");
    expect(routes(lines)).toContain("POST /v1/synthesis/run");
    const run = lines.find((l) => l.startsWith("POST /v1/synthesis/run"))!;
    expect(run).toContain('"dry_run":false');
  });

  test("memory_synthesis_status → GET /v1/synthesis/status", async () => {
    const lines = await runScenario("memory_synthesis_status");
    expect(routes(lines)).toContain("GET /v1/synthesis/status");
  });

  test("memory_synthesis_history → GET /v1/synthesis/runs", async () => {
    const lines = await runScenario("memory_synthesis_history");
    expect(routes(lines)).toContain("GET /v1/synthesis/runs");
  });

  test("memory_synthesis_rollback → POST /v1/synthesis/rollback/:run_id", async () => {
    const lines = await runScenario("memory_synthesis_rollback");
    expect(routes(lines)).toContain("POST /v1/synthesis/rollback/run-1");
  });

  test("CLI `synthesis run` → POST /v1/synthesis/run", async () => {
    const lines = await runScenario("cli-synthesis-run");
    expect(routes(lines)).toContain("POST /v1/synthesis/run");
  });

  test("CLI `synthesis status` → GET /v1/synthesis/runs", async () => {
    const lines = await runScenario("cli-synthesis-status");
    expect(routes(lines)).toContain("GET /v1/synthesis/runs");
  });

  test("CLI `synthesis rollback` → POST /v1/synthesis/rollback/:run_id", async () => {
    const lines = await runScenario("cli-synthesis-rollback");
    expect(routes(lines)).toContain("POST /v1/synthesis/rollback/run-1");
  });

  test("CLI `synthesized-profile` → POST /v1/profile/synthesize (server owns the LLM spend)", async () => {
    const lines = await runScenario("cli-synthesized-profile");
    expect(routes(lines)).toContain("POST /v1/profile/synthesize");
    // The local arm would have called api.anthropic.com from the station; the
    // hosted arm must not even look for a provider key.
    expect(routes(lines).filter((r) => r.startsWith("POST /v1/memories"))).toEqual([]);
  });

  test("memory_profile → POST /v1/profile/synthesize and preserves explicit scope", async () => {
    const lines = await runScenario("memory_profile");
    expect(routes(lines)).toContain("POST /v1/profile/synthesize");
    const post = lines.find((line) => line.startsWith("POST /v1/profile/synthesize"))!;
    expect(post).toContain('"scope":"global"');
    expect(post).toContain('"agent_id":"agent-1"');
  });
});

describe("PORT-TO-API slice A — memory locks reach /v1", () => {
  test("memory_lock → POST /v1/locks", async () => {
    const lines = await runScenario("memory_lock");
    expect(routes(lines)).toContain("POST /v1/locks");
    const post = lines.find((l) => l.startsWith("POST /v1/locks"))!;
    expect(post).toContain('"resource_type":"memory"');
    expect(post).toContain('"resource_id":"shared:deploy-key:"');
  });

  test("memory_unlock → DELETE /v1/locks/:id", async () => {
    const lines = await runScenario("memory_unlock");
    expect(routes(lines)).toContain("DELETE /v1/locks/lock-1");
  });

  test("memory_check_lock → GET /v1/locks", async () => {
    const lines = await runScenario("memory_check_lock");
    expect(routes(lines)).toContain("GET /v1/locks");
    expect(lines.join("\n")).toContain("resource_type=memory");
  });

  test("agentHoldsLock → GET /v1/locks (filtered client-side, no new route)", async () => {
    const lines = await runScenario("agentHoldsLock");
    expect(routes(lines)).toContain("GET /v1/locks");
  });

  test("clean_expired_locks → POST /v1/locks/clean without localhost notification fallback", async () => {
    const lines = await runScenario("clean_expired_locks");
    expect(routes(lines)).toEqual(["POST /v1/locks/clean"]);
  });
});

describe("PORT-TO-API slice A — session jobs reach /v1", () => {
  test("memory_ingest_session → POST /v1/sessions/ingest (server enqueues)", async () => {
    const lines = await runScenario("memory_ingest_session");
    const r = routes(lines);
    expect(r).toContain("POST /v1/sessions/ingest");
    // The accepted response carries the created job receipt; no ambiguous
    // follow-up read is required after the server has already enqueued it.
    expect(r.filter((route) => route === "POST /v1/sessions/ingest")).toHaveLength(1);
    expect(r.some((route) => route.startsWith("GET /v1/sessions/jobs"))).toBe(false);
    const post = lines.find((l) => l.startsWith("POST /v1/sessions/ingest"))!;
    expect(post).toContain('"session_id":"session-1"');
    expect(post).toContain('"transcript":"hello"');
  });

  test("memory_session_status → GET /v1/sessions/jobs/:id", async () => {
    const lines = await runScenario("memory_session_status");
    expect(routes(lines)).toContain("GET /v1/sessions/jobs/job-1");
  });

  test("memory_session_list → GET /v1/sessions/jobs and preserves offset/limit", async () => {
    const lines = await runScenario("memory_session_list");
    expect(routes(lines)).toContain("GET /v1/sessions/jobs");
    const request = lines.find((line) => line.startsWith("GET /v1/sessions/jobs?"))!;
    expect(request).toContain("session_id=session-1");
    expect(request).toContain("limit=6");
    expect(request).toContain("offset=7");
  });

  test("CLI `session ingest` → POST /v1/sessions/ingest", async () => {
    const lines = await runScenario("cli-session-ingest");
    expect(routes(lines)).toContain("POST /v1/sessions/ingest");
  });

  test("CLI `session status` → GET /v1/sessions/jobs/:id", async () => {
    const lines = await runScenario("cli-session-status");
    expect(routes(lines)).toContain("GET /v1/sessions/jobs/job-1");
  });

  test("CLI `session list` → GET /v1/sessions/jobs and preserves offset/limit", async () => {
    const lines = await runScenario("cli-session-list");
    expect(routes(lines)).toContain("GET /v1/sessions/jobs");
    const request = lines.find((line) => line.startsWith("GET /v1/sessions/jobs?"))!;
    expect(request).toContain("session_id=session-1");
    expect(request).toContain("limit=4");
    expect(request).toContain("offset=9");
  });

  test("session queue stats → GET /v1/sessions/queue/stats", async () => {
    const lines = await runScenario("session-queue-stats");
    expect(routes(lines)).toContain("GET /v1/sessions/queue/stats");
  });
});

describe("PORT-TO-API slice A — regression cover for already-hosted reads", () => {
  test("memory_stale → GET /v1/memories/stale", async () => {
    const lines = await runScenario("memory_stale");
    expect(routes(lines)).toContain("GET /v1/memories/stale");
  });

  test("tool-events read → GET /v1/tool-events", async () => {
    const lines = await runScenario("tool-events");
    expect(routes(lines)).toContain("GET /v1/tool-events");
  });
});


describe("PORT-TO-API slice A — malformed hosted 2xx responses refuse", () => {
  const cases = [
    ["malformed-lock-acquire", "malformed-lock-acquire"],
    ["malformed-lock-list", "malformed-lock-list"],
    ["malformed-lock-release", "malformed-lock-release"],
    ["malformed-agent-lock-list", "malformed-agent-lock-list"],
    ["malformed-agent-lock-release", "malformed-agent-lock-release"],
    ["malformed-lock-clean", "malformed-lock-clean"],
    ["malformed-session-ingest", "malformed-session-ingest"],
    ["malformed-session-job", "malformed-session-job"],
    ["malformed-session-list", "malformed-session-list"],
    ["old-session-list", "old-session-list"],
    ["malformed-session-stats", "malformed-session-stats"],
    ["malformed-profile", "malformed-profile"],
  ] as const;

  for (const [scenario, mode] of cases) {
    test(`${scenario} refuses without creating a local database`, async () => {
      const lines = await runScenario(scenario, mode);
      expect(lines.length).toBeGreaterThan(0);
    });
  }
});
