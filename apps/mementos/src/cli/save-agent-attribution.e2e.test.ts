import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";

// ============================================================================
// Regression: `save` never resolved WHO was writing, so an agent-source save
// with no `--agent` flag landed with agent_id/created_by_agent BOTH NULL.
//
// Measured 2026-08-17 on the fleet store: 12436 of 14370 rows (86.6%) carry no
// agent attribution while source='agent', including 170 created since Aug 15.
// The by_agent stats therefore cover only 13.4% of the store — the fleet's
// per-agent memory accounting was unenforced at write time.
//
// The fix resolves the writing identity at save time when `--agent` is omitted
// (MEMENTOS_AGENT, then the fleet identity surface ~/.hasna/conversations/
// agent-id), registers it on first use, and REFUSES an agent-source save that
// has no resolvable identity at all — an unattributed agent claim is
// unrecoverable afterwards (the columns are NULL whether the caller was
// unidentified or none existed).
//
// Each child env pins the identity sources explicitly, so a machine whose
// operator shell exports MEMENTOS_AGENT (or whose real ~/.hasna/conversations/
// agent-id file exists) cannot leak into the assertions.
// ============================================================================

const DB_PATH = join(tmpdir(), `mementos-save-attribution-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;
const FIXTURE_HOME = join(tmpdir(), `mementos-save-attribution-home-${Date.now()}`);
const EMPTY_HOME = join(tmpdir(), `mementos-save-attribution-empty-${Date.now()}`);

const AGENT_NAME = "attribution-probe-agent";

function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  return isolatedStoreEnv(DB_PATH, {
    extra: { ...blankLlmProviderEnv(), ...extra },
  });
}

/** Child env with no identity source at all: HOME is an empty fixture. */
function envWithNoIdentity(): Record<string, string> {
  const env = testEnv({ HOME: EMPTY_HOME });
  delete env["MEMENTOS_AGENT"];
  return env;
}

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

function readMemories(): { key: string; agent_id: string | null; created_by_agent: string | null; updated_by_agent: string | null; source: string }[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db
      .query(
        `SELECT key, agent_id, created_by_agent, updated_by_agent, source
         FROM memories WHERE key LIKE 'attr-%' ORDER BY key`,
      )
      .all() as {
      key: string;
      agent_id: string | null;
      created_by_agent: string | null;
      updated_by_agent: string | null;
      source: string;
    }[];
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  mkdirSync(FIXTURE_HOME, { recursive: true });
  mkdirSync(EMPTY_HOME, { recursive: true });
  // Fleet identity surface, written by `conversations agents register`.
  const convDir = join(FIXTURE_HOME, ".hasna", "conversations");
  mkdirSync(convDir, { recursive: true });
  writeFileSync(join(convDir, "agent-id"), AGENT_NAME, "utf8");

  await assertLocalStoreBackend(CLI_PATH, testEnv(), DB_PATH);
});

afterAll(() => {
  rmSync(FIXTURE_HOME, { recursive: true, force: true });
  rmSync(EMPTY_HOME, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) try { unlinkSync(f); } catch { /* already gone */ }
  }
});

describe("save: agent-source writes carry the writing agent identity", () => {
  test("FAILING: MEMENTOS_AGENT resolves to a registered agent stored as agent_id + created_by_agent", async () => {
    const env = testEnv({ MEMENTOS_AGENT: AGENT_NAME });
    const { stdout, exitCode } = await runCli(env, "--json", "save", "attr-env", "v1");
    expect(exitCode).toBe(0);

    const saved = JSON.parse(stdout) as { key: string; agent_id: string | null; created_by_agent: string | null };
    expect(saved.key).toBe("attr-env");
    // THE FIX: the row is attributed to the writing agent, not to nobody.
    expect(saved.agent_id).toBeTruthy();
    expect(saved.created_by_agent).toBe(saved.agent_id);

    // The name was registered on first use, so the attribution is resolvable.
    const agents = JSON.parse(
      (await runCli(env, "--json", "agents")).stdout,
    ) as { name: string }[];
    expect(agents.some((a) => a.name === AGENT_NAME)).toBe(true);

    // And the stored row agrees with the CLI's own receipt.
    const rows = readMemories();
    const row = rows.find((r) => r.key === "attr-env");
    expect(row).toBeTruthy();
    expect(row!.agent_id).toBe(saved.agent_id);
    expect(row!.created_by_agent).toBe(saved.agent_id);
  });

  test("FAILING: ~/.hasna/conversations/agent-id (the fleet identity surface) is the fallback", async () => {
    const env = testEnv({ HOME: FIXTURE_HOME });
    delete env["MEMENTOS_AGENT"];

    const { stdout, exitCode } = await runCli(env, "--json", "save", "attr-file", "v1");
    expect(exitCode).toBe(0);

    const saved = JSON.parse(stdout) as { agent_id: string | null; created_by_agent: string | null };
    expect(saved.agent_id).toBeTruthy();
    expect(saved.created_by_agent).toBe(saved.agent_id);

    const rows = readMemories();
    const row = rows.find((r) => r.key === "attr-file");
    expect(row!.agent_id).toBe(saved.agent_id);
  });

  test("FAILING: an agent-source save with NO resolvable identity is refused and writes NOTHING", async () => {
    const env = envWithNoIdentity();
    const { stdout, exitCode } = await runCli(env, "--json", "save", "attr-refused", "v1");
    expect(exitCode).toBe(1);

    const parsed = JSON.parse(stdout) as { error?: string };
    expect(typeof parsed.error).toBe("string");
    const msg = String(parsed.error);
    expect(msg).toContain("agent");
    // The remedies must be named so the caller can act without a ticket.
    expect(msg).toContain("--agent");
    expect(msg).toContain("MEMENTOS_AGENT");

    // Nothing landed in the unowned bucket — the refusal is a refusal.
    const rows = readMemories();
    expect(rows.find((r) => r.key === "attr-refused")).toBeUndefined();
  });

  test("a NON-agent source with no identity still saves (no agent claim to attribute)", async () => {
    const env = envWithNoIdentity();
    const { stdout, exitCode } = await runCli(
      env, "--json", "save", "attr-user", "v1", "--source", "user",
    );
    expect(exitCode).toBe(0);
    const saved = JSON.parse(stdout) as { agent_id: string | null; source: string };
    expect(saved.source).toBe("user");
    expect(saved.agent_id).toBeNull();
  });

  test("FAILING: an upsert (merge) records updated_by_agent as well", async () => {
    const env = testEnv({ MEMENTOS_AGENT: AGENT_NAME });
    const first = await runCli(env, "--json", "save", "attr-upsert", "v1");
    expect(first.exitCode).toBe(0);

    const second = await runCli(env, "--json", "save", "attr-upsert", "v2");
    expect(second.exitCode).toBe(0);
    const saved = JSON.parse(second.stdout) as {
      outcome: string;
      agent_id: string | null;
      created_by_agent: string | null;
      updated_by_agent: string | null;
    };
    expect(saved.outcome).toBe("updated");
    expect(saved.agent_id).toBeTruthy();
    expect(saved.created_by_agent).toBe(saved.agent_id);

    // THE FIX: the merge bump records WHO wrote the update. All 14370 rows
    // measured on 2026-08-17 had updated_by_agent NULL.
    expect(saved.updated_by_agent).toBe(saved.agent_id);

    const rows = readMemories();
    const row = rows.find((r) => r.key === "attr-upsert");
    expect(row!.updated_by_agent).toBe(saved.agent_id);
  });
});
