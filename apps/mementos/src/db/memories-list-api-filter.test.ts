// Client-side regression tests for the silent filter-drop family (todos
// d5a181fa): the listMemoriesPage API branch must SERIALIZE the five list
// filters that the server route parses —
//
//   machine_id  visible_to_machine_id  search  source  flag
//
// Before the fix the toQuery allowlist omitted all five, so in API/cloud mode
// the request carried no machine/visibility/search/source/flag parameters while
// the local SQLite branch applied them — a silent transport divergence.
//
// These tests fail against the pre-fix client: the captured request query
// string carries none of the five fields.
//
// PROCESS ARCHITECTURE (why nothing here touches the ambient env):
//   - The api-mode transport is a blocking Bun.spawnSync(curl), so the
//     request-capture stub must live in its own process (an in-process
//     Bun.serve can never answer — the event loop is held by the spawnSync).
//   - The client call itself also runs in its own process
//     (__fixtures__/list-filter-client-runner.ts): the suite's api-mode tests
//     configure HASNA_MEMENTOS_API_URL / KEY in their own beforeEach/afterEach,
//     and a sibling test file re-pointing those vars mid-process breaks their
//     fixtures. Spawning the runner with a clean env keeps the shared bun-test
//     process environment untouched.
//
// The runner points the client at the loopback capture stub and writes a done
// marker; this suite asserts on the captured request lines. The loopback host
// is the sanctioned test endpoint (api-mode.ts assertRequestAllowedUnderTest
// allows loopback under NODE_ENV=test).

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let stubProc: ReturnType<typeof Bun.spawn> | undefined;
let captureFile = "";
let baseUrl = "";

const SELECTOR_KEYS = [
  "HASNA_MEMENTOS_API_URL",
  "HASNA_MEMENTOS_API_KEY",
  "HASNA_MEMENTOS_API_TIMEOUT",
  "MEMENTOS_API_URL",
  "MEMENTOS_API_KEY",
  "MEMENTOS_DATABASE_URL",
  "HASNA_MEMENTOS_DATABASE_URL",
  "MEMENTOS_STORAGE_MODE",
  "HASNA_MEMENTOS_STORAGE_MODE",
  "HASNA_MEMENTOS_DB_PATH",
  "MEMENTOS_DB_PATH",
];

/** The child env for both spawned processes: ambient env minus every store
 *  selector, plus the fixture variables. Nothing here mutates the test
 *  process's own environment. */
function fixtureEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SELECTOR_KEYS.includes(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

async function spawnCaptureStub(): Promise<string> {
  captureFile = join(tmpdir(), `mementos-list-filter-capture-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  const proc = Bun.spawn(
    ["bun", "run", `${import.meta.dir}/__fixtures__/list-filter-capture-server.ts`],
    {
      env: fixtureEnv({ CAPTURE_FILE: captureFile }),
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const reader = proc.stdout?.getReader();
  const line = await reader?.read();
  const text = new TextDecoder().decode(line?.value ?? new Uint8Array());
  const m = /READY (\d+)/.exec(text);
  if (!m) {
    proc.kill();
    throw new Error(`capture stub did not start: ${text}`);
  }
  stubProc = proc;
  return `http://127.0.0.1:${m[1]}`;
}

async function runClientScenario(scenario: string): Promise<void> {
  // Fresh capture per scenario: the stub appends, so each run must start from
  // an empty file or the assertions see the previous scenarios' lines.
  writeFileSync(captureFile, "");
  const runner = Bun.spawn(
    ["bun", "run", `${import.meta.dir}/__fixtures__/list-filter-client-runner.ts`],
    {
      env: fixtureEnv({ STUB_BASE_URL: baseUrl, CAPTURE_FILE: captureFile, SCENARIO: scenario }),
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const exitCode = await runner.exited;
  if (exitCode !== 0) {
    const err = new TextDecoder().decode(await new Response(runner.stderr).arrayBuffer());
    throw new Error(`client runner failed (${scenario}): ${err}`);
  }
}

beforeAll(async () => {
  baseUrl = await spawnCaptureStub();
});

afterAll(() => {
  stubProc?.kill();
  stubProc = undefined;
  if (captureFile) {
    for (const suffix of ["", ".done"]) {
      const f = captureFile + suffix;
      if (existsSync(f)) rmSync(f);
    }
  }
});

function captured(): string[] {
  return readFileSync(captureFile, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

describe("listMemoriesPage API branch serializes the five filters", () => {
  test("machine_id, visible_to_machine_id, search, source, flag reach the request query string", async () => {
    await runClientScenario("all-five");
    const lines = captured();
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`GET ${baseUrl}/v1/memories?`);
    expect(lines[0]).toContain("machine_id=machine-abc");
    expect(lines[0]).toContain("visible_to_machine_id=machine-abc");
    expect(lines[0]).toContain("search=invoice");
    expect(lines[0]).toContain("source=user");
    expect(lines[0]).toContain("flag=important");
  });

  test("an array source is comma-joined into a single param (server splits it back)", async () => {
    await runClientScenario("array-source");
    const lines = captured();
    expect(lines.length).toBe(1);
    expect(decodeURIComponent(lines[0])).toContain("source=user,agent");
  });

  test("absent filters stay absent from the query string (no-filter means no filter)", async () => {
    await runClientScenario("empty");
    const lines = captured();
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe(`GET ${baseUrl}/v1/memories`);
    expect(lines[0]).not.toContain("machine_id");
    expect(lines[0]).not.toContain("visible_to_machine_id");
    expect(lines[0]).not.toContain("search");
    expect(lines[0]).not.toContain("source");
    expect(lines[0]).not.toContain("flag");
  });
});
