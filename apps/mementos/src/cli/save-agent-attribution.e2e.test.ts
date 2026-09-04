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
// (MEMENTOS_AGENT, then the fleet identity surface the conversations data root/
// agent-id), registers it on first use, and REFUSES an agent-source save that
// has no resolvable identity at all — an unattributed agent claim is
// unrecoverable afterwards (the columns are NULL whether the caller was
// unidentified or none existed).
//
// Each child env pins the identity sources explicitly, so a machine whose
// operator shell exports MEMENTOS_AGENT (or whose real the conversations data root/
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

function readMemories(): { key: string; value: string; agent_id: string | null; created_by_agent: string | null; updated_by_agent: string | null; source: string }[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db
      .query(
        `SELECT key, value, agent_id, created_by_agent, updated_by_agent, source
         FROM memories WHERE key LIKE 'attr-%' ORDER BY key`,
      )
      .all() as {
      key: string;
      value: string;
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

  test("FAILING: the conversations data root/agent-id (the fleet identity surface) is the fallback", async () => {
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

  test("FAILING: an EXPLICIT --source agent save with NO resolvable identity is refused and writes NOTHING", async () => {
    const env = envWithNoIdentity();
    const { stdout, exitCode } = await runCli(
      env, "--json", "save", "attr-refused", "v1", "--source", "agent",
    );
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

  test("an OMITTED source with no identity saves UNOWNED (zero-config quick start)", async () => {
    // README + `mementos init` document a bare `mementos save` on a machine
    // with no service configuration. A save that claims no agent author must
    // not throw on such a machine — it writes the unowned bucket, as it did
    // before attribution was enforced.
    const env = envWithNoIdentity();
    const { stdout, exitCode } = await runCli(env, "--json", "save", "attr-quickstart", "v1");
    expect(exitCode).toBe(0);
    const saved = JSON.parse(stdout) as { agent_id: string | null; source: string | null };
    expect(saved.agent_id).toBeNull();

    const rows = readMemories();
    const row = rows.find((r) => r.key === "attr-quickstart");
    expect(row).toBeTruthy();
    expect(row!.agent_id).toBeNull();
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

  test("a NON-agent source with an identity PRESENT still saves UNOWNED", async () => {
    // An explicit non-agent source is not an agent claim, so an ambient
    // identity must not be attached even when one is resolvable — otherwise
    // the bucket identity of unowned non-agent rows would silently change
    // depending on machine state, contradicting the refusal remedy text.
    const env = testEnv({ MEMENTOS_AGENT: AGENT_NAME });
    const { stdout, exitCode } = await runCli(
      env, "--json", "save", "attr-user-ambient", "v1", "--source", "system",
    );
    expect(exitCode).toBe(0);
    const saved = JSON.parse(stdout) as { agent_id: string | null; source: string };
    expect(saved.source).toBe("system");
    expect(saved.agent_id).toBeNull();

    const rows = readMemories();
    const row = rows.find((r) => r.key === "attr-user-ambient");
    expect(row!.agent_id).toBeNull();
  });

  test("competing identities on the same key are isolated — a foreign write is refused, never attributed or merged across", async () => {
    // Regression for the machine-global identity fallback: two concurrent
    // sessions (here: two MEMENTOS_AGENT identities) writing the same key
    // must never attribute a write to the other agent and must never merge
    // into the other agent's row. The store enforces ONE active row per key:
    // the fork guard refuses a same-key save whose bucket
    // (scope/project/session/agent) matches no active row, so a competing
    // identity's write is REFUSED outright — it cannot land in the other
    // agent's bucket, and cannot fork a second active row by accident.
    const envA = testEnv({ MEMENTOS_AGENT: "attribution-agent-a" });
    const envB = testEnv({ MEMENTOS_AGENT: "attribution-agent-b" });

    const a = await runCli(envA, "--json", "save", "attr-shared-key", "value-from-a");
    expect(a.exitCode).toBe(0);

    // B's same-key write from a different bucket is refused by the fork guard.
    const b = await runCli(envB, "--json", "save", "attr-shared-key", "value-from-b");
    expect(b.exitCode).toBe(1);
    const bErr = JSON.parse(b.stdout) as { error?: string };
    expect(String(bErr.error)).toContain("Refusing to fork");
    expect(String(bErr.error)).toContain("attr-shared-key");

    // A's row is untouched: still one active row, still attributed to A.
    const rows = readMemories().filter((r) => r.key === "attr-shared-key");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("value-from-a");
    expect(rows[0]!.agent_id).toBe(JSON.parse(a.stdout).agent_id);

    // A re-saves the same key: the merge upsert lands in A's OWN bucket
    // (same agent_id), updating the value and never touching any other row.
    const a2 = await runCli(envA, "--json", "save", "attr-shared-key", "value-from-a-2");
    expect(a2.exitCode).toBe(0);
    const rows2 = readMemories().filter((r) => r.key === "attr-shared-key");
    expect(rows2).toHaveLength(1);
    expect(rows2[0]!.value).toBe("value-from-a-2");
    expect(rows2[0]!.agent_id).toBe(JSON.parse(a.stdout).agent_id);
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
