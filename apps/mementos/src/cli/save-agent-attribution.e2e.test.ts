import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Regression cover for the fleet attribution census (2026-08-17): 12,436 of
// 14,370 memories (86.6%) carry agent_id AND created_by_agent both NULL while
// source='agent' — including 170 rows created since 2026-08-15. Root cause:
// `save` only resolves the writing identity when `--agent` is passed; with no
// flag (the fleet's 74 skill call sites pass none) the write lands
// unattributed under the default `source="agent"`.
//
// The fix: `save` resolves the writing identity from `--agent` first, then
// from the `MEMENTOS_AGENT` env var (the CLI identity convention this codebase
// already uses in init.ts and the open-sessions connector), and REFUSES a
// write whose effective source is `agent` when no identity resolved. Sources
// other than `agent` (user/system/auto/imported) may stay unattributed.
//
// Every attribution assertion is a READ-BACK through `list` — a different verb
// than the `save` that wrote — because the success line is what concealed the
// gap for months.
const DB_PATH = join(tmpdir(), `mementos-save-attribution-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

/** A subprocess env pinned to the temp SQLite DB, plus optional overrides. */
function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  return isolatedStoreEnv(DB_PATH, { extra: { ...blankLlmProviderEnv(), ...extra } });
}

beforeAll(async () => {
  // Fail loudly BEFORE any write, rather than discovering afterwards that these
  // e2e writes went to the shared production store.
  await assertLocalStoreBackend(CLI_PATH, testEnv(), DB_PATH);
});

async function runCli(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: await proc.exited };
}

/** Read a memory row back through `list` — a different verb than the write. */
async function listMemory(
  env: Record<string, string>,
  key: string,
): Promise<Array<Record<string, unknown>>> {
  const r = await runCli(env, "--json", "list", "--limit", "500", "--status", "active");
  expect(r.exitCode).toBe(0);
  const rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
  return rows.filter((m) => m["key"] === key);
}

describe("save resolves and stores the writing agent identity", () => {
  test("default agent-source save with no identity is REJECTED and writes nothing", async () => {
    const env = testEnv();
    const r = await runCli(env, "--json", "save", "attribution.reject.me", "value");
    expect(r.exitCode).toBe(1);

    // The rejection must point at the resolution routes, so a caller can act.
    const body = `${r.stdout}\n${r.stderr}`;
    expect(body).toMatch(/agent/i);
    expect(body).toMatch(/--agent/);
    expect(body).toMatch(/MEMENTOS_AGENT/);

    // Nothing may have been written.
    const rows = await listMemory(env, "attribution.reject.me");
    expect(rows).toHaveLength(0);
  });

  test("save with --agent stores agent_id AND created_by_agent", async () => {
    const env = testEnv();
    const reg = await runCli(env, "register-agent", "attribution-tester-a");
    expect(reg.exitCode).toBe(0);
    const agents = await runCli(env, "--json", "agents", "--limit", "500");
    const rows = JSON.parse(agents.stdout) as Array<{ id: string; name: string }>;
    const id = rows.find((a) => a.name === "attribution-tester-a")?.id ?? "";
    expect(id).not.toBe("");

    const save = await runCli(env, "--json", "save", "attribution.agent.flag", "value", "--agent", "attribution-tester-a");
    expect(save.exitCode).toBe(0);

    const mem = await listMemory(env, "attribution.agent.flag");
    expect(mem).toHaveLength(1);
    expect(mem[0]!["agent_id"]).toBe(id);
    expect(mem[0]!["created_by_agent"]).toBe(id);
    expect(mem[0]!["source"]).toBe("agent");
  });

  test("save with MEMENTOS_AGENT env stores agent_id AND created_by_agent", async () => {
    const env = testEnv();
    const reg = await runCli(env, "register-agent", "attribution-tester-b");
    expect(reg.exitCode).toBe(0);
    const agents = await runCli(env, "--json", "agents", "--limit", "500");
    const rows = JSON.parse(agents.stdout) as Array<{ id: string; name: string }>;
    const id = rows.find((a) => a.name === "attribution-tester-b")?.id ?? "";
    expect(id).not.toBe("");

    const save = await runCli(
      { ...testEnv(), MEMENTOS_AGENT: "attribution-tester-b" },
      "--json", "save", "attribution.agent.env", "value",
    );
    expect(save.exitCode).toBe(0);

    const mem = await listMemory(testEnv(), "attribution.agent.env");
    expect(mem).toHaveLength(1);
    expect(mem[0]!["agent_id"]).toBe(id);
    expect(mem[0]!["created_by_agent"]).toBe(id);
    expect(mem[0]!["source"]).toBe("agent");
  });

  test("MEMENTOS_AGENT naming an UNREGISTERED agent is refused (fail closed)", async () => {
    const env = { ...testEnv(), MEMENTOS_AGENT: "attribution-ghost-agent" };
    const r = await runCli(env, "--json", "save", "attribution.ghost.env", "value");
    expect(r.exitCode).toBe(1);
    const body = `${r.stdout}\n${r.stderr}`;
    expect(body).toMatch(/attribution-ghost-agent/);

    const rows = await listMemory(testEnv(), "attribution.ghost.env");
    expect(rows).toHaveLength(0);
  });

  test("explicit non-agent source may stay unattributed", async () => {
    const env = testEnv();
    const r = await runCli(env, "--json", "save", "attribution.system.source", "value", "--source", "system");
    expect(r.exitCode).toBe(0);

    const mem = await listMemory(env, "attribution.system.source");
    expect(mem).toHaveLength(1);
    expect(mem[0]!["source"]).toBe("system");
    expect(mem[0]!["agent_id"]).toBeNull();
    expect(mem[0]!["created_by_agent"]).toBeNull();
  });
});

afterAll(() => {
  // The temp DB is under tmpdir(); nothing durable to clean up.
});
