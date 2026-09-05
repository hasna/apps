import { describe, it, expect, beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

/**
 * Regression: the persisted identity file is MACHINE-GLOBAL, and `todos add`
 * routed other sessions' work with it (todos task 64131fb1).
 *
 * `the todos data root/identity.json` is keyed on $HOME, and this fleet runs many
 * named agent sessions per station under one HOME. `todos init` refuses to
 * clobber a foreign identity — but nothing guarded the READ side, so every
 * session that had not registered silently inherited whichever agent had run
 * `todos init` last, and #138 then wrote that inherited name into `assigned_to`
 * and `agent_id`.
 *
 * Measured on station01, 2026-07-31: `titus-skill-corpus` ran `todos init` at
 * 17:31:04Z; the first misattributed row appeared at 17:37:36Z and the
 * population was still growing at ~0.7 rows/min at 19:26Z (48 -> 52 in six
 * minutes, 2466 pending). 42 of those rows carried `assigned_to` of a
 * DIFFERENT, correct agent alongside `agent_id: titus-skill-corpus` — the shape
 * a single `todos add --assign <someone>` produces on its own, with no repair
 * step involved.
 *
 * The invariant these pin: an identity that a DIFFERENT session persisted may
 * never become this session's assignee, agent_id, OR created_by. A wrong
 * attribution is worse than a missing one, because a null is visibly absent
 * while a name is simply believed — and in this case believed by a live agent
 * that never asked for the work.
 *
 * created_by was originally left out of this fix (see git history on this
 * describe block) on the premise that it was "bounded and currently inert on
 * the hosted path... because the deployed server drops the column outright."
 * That premise is now FALSE: the hosted server persists and serves created_by,
 * and the residual materialised exactly as this file always said it could —
 * measured 2026-08-03/04 on the live station01 hosted store: `todos list
 * --created-by <a real but wrong agent name> --json` returned 489 rows
 * (todos task 9090972e), including rows independently confirmed by their true
 * filer to have been misattributed. created_by is now covered by the same
 * guard as assigned_to and agent_id.
 */

setDefaultTimeout(30_000);

let testRoot = "";
let homeDir = "";
let dbPath = "";

/** The identity a DIFFERENT session on this station registered and never released. */
const FOREIGN = "titus-skill-corpus";

/**
 * The suite that tests the shared-identity defect must not itself touch the shared
 * identity. `the todos data root/identity.json` is the very file under discussion: it is
 * keyed on $HOME, every agent on a station shares one HOME, and a test that reads it
 * would pass or fail according to whichever agent registered last — while a test that
 * WROTE it would stamp a fixture name onto every other agent's tasks.
 *
 * Setting HOME is a request, not a guarantee: a resolver that consults anything else
 * silently escapes it, and the escape is invisible because the run still reports
 * green. So the isolation is ASSERTED after every case rather than assumed, in both
 * directions — the temp HOME is where the identity lands (the cases below rely on
 * it, which is the positive control) and the real file is byte-identical afterwards.
 */
const realIdentityPath = join(homedir(), ".hasna", "todos", "identity.json");
let realIdentityFingerprint: string | null = null;

function fingerprintRealIdentity(): string | null {
  if (!existsSync(realIdentityPath)) return null;
  const s = statSync(realIdentityPath);
  return `${s.mtimeMs}:${s.size}:${readFileSync(realIdentityPath, "utf8")}`;
}

beforeEach(() => {
  realIdentityFingerprint = fingerprintRealIdentity();
  testRoot = mkdtempSync(join(tmpdir(), "todos-ambient-identity-"));
  homeDir = join(testRoot, "home");
  mkdirSync(join(homeDir, ".hasna", "todos"), { recursive: true });
  dbPath = join(testRoot, "todos.db");
});

afterEach(() => {
  // Fail the suite rather than the fleet: if a case ever reaches the real file,
  // that is a defect in identity resolution and it must surface here, loudly.
  expect(fingerprintRealIdentity()).toBe(realIdentityFingerprint);
  rmSync(testRoot, { recursive: true, force: true });
});

/** Stand in for the other session's `todos init` having already run under this HOME. */
function persistForeignIdentity() {
  writeFileSync(
    join(homeDir, ".hasna", "todos", "identity.json"),
    JSON.stringify({
      agent_id: "af774e59",
      agent_name: FOREIGN,
      registered_at: new Date().toISOString(),
    }),
  );
}

async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env: localRoutingTestEnv({
      HOME: homeDir,
      HASNA_EVENTS_DIR: join(testRoot, "events"),
      ...extraEnv,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

interface AddedTask {
  id: string;
  title: string;
  created_by: string | null;
  assigned_to: string | null;
  agent_id: string | null;
}

async function addJson(args: string[], extraEnv: Record<string, string> = {}): Promise<AddedTask> {
  const result = await runCli(["--json", "add", ...args], extraEnv);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as AddedTask;
}

describe("todos add — a foreign session's persisted identity must not route work", () => {
  it("does not assign the task to the agent that registered under this HOME", async () => {
    persistForeignIdentity();
    const task = await addJson(["unregistered session files a task"]);
    expect(task.assigned_to).not.toBe(FOREIGN);
  });

  it("does not stamp agent_id with the foreign identity", async () => {
    persistForeignIdentity();
    const task = await addJson(["unregistered session files a task"]);
    expect(task.agent_id).not.toBe(FOREIGN);
  });

  it("does not stamp agent_id with the foreign identity when an assignee IS given", async () => {
    // The dominant measured shape: 42 of 48 rows had a correct assigned_to and a
    // foreign agent_id. One `todos add --assign` produces it; no repair needed.
    persistForeignIdentity();
    const task = await addJson(["--assign", "agent-chief-harness", "correctly routed work"]);
    expect(task.assigned_to).toBe("agent-chief-harness");
    expect(task.agent_id).not.toBe(FOREIGN);
  });

  it("no longer records the ambient identity as created_by — the RESIDUAL is CLOSED (todos task 9090972e)", async () => {
    // This test used to pin the opposite behaviour, deliberately, on the premise
    // that the hosted server dropped created_by entirely (0 of 50000 rows on
    // 2026-07-31) so a station-shared name landing in created_by LOCALLY was
    // "bounded and currently inert." That premise is falsified: the hosted
    // server now persists and serves created_by, and measured live on
    // station01 2026-08-03/04, `todos list --created-by <name> --json` returned
    // 489 real rows carrying a station-shared identity that never filed them —
    // including rows whose true filer confirmed the misattribution directly.
    //
    // created_by gets the exact same treatment as assigned_to and agent_id now:
    // an identity read back from the todos data root/identity.json is DISPLAYABLE
    // (see resolveCreatorIdentity, still used for --inbox diagnostics) but must
    // never be WRITTEN into a task, because it identifies the STATION, not the
    // caller. `resolveWritableIdentity` already enforces exactly this for the
    // routing columns; created_by now goes through the same guard instead of
    // the wider resolver.
    persistForeignIdentity();
    const task = await addJson(["unregistered session files a task"]);
    expect(task.created_by).not.toBe(FOREIGN);
    expect(task.created_by).toBeNull();
    expect(task.assigned_to).not.toBe(FOREIGN);
    expect(task.agent_id).not.toBe(FOREIGN);
  });

  it("still warns that the task is ownerless so the omission is not silent", async () => {
    persistForeignIdentity();
    const result = await runCli(["--json", "add", "unregistered session files a task"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("ownerless");
  });
});

describe("todos update --set-agent — the repair path that did not exist", () => {
  // Before this, UpdateTaskInput had no agent_id member at all, so a row stamped
  // with the wrong agent at creation could not be corrected by any CLI or API
  // call. The ~54 misattributed rows on station01 had no remedy, and the backfill
  // had no mechanism to run. `--assign` was NOT that mechanism: it moves
  // assigned_to, and it must not touch agent_id, because agent_id after #138
  // carries the FILER and rewriting it on every reassignment would destroy the
  // authorship the same PR was built to record.

  async function addAndGetId(args: string[], extraEnv: Record<string, string> = {}) {
    const task = await addJson(args, extraEnv);
    return task.id;
  }

  it("rewrites a misattributed agent_id", async () => {
    persistForeignIdentity();
    const id = await addAndGetId(["--agent", FOREIGN, "misattributed row"]);
    const result = await runCli(["--json", "update", id, "--set-agent", "fabricius"]);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as AddedTask).agent_id).toBe("fabricius");
  });

  it("clears agent_id to null when the true filer is unknown", async () => {
    const id = await addAndGetId(["--agent", FOREIGN, "unattributable row"]);
    const result = await runCli(["--json", "update", id, "--set-agent", ""]);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as AddedTask).agent_id).toBeNull();
  });

  it("leaves agent_id untouched when --set-agent is not passed", async () => {
    // Guards the other direction: the repair verb must not fire implicitly, or
    // every ordinary update silently rewrites provenance.
    const id = await addAndGetId(["--agent", "brutus", "ordinary row"]);
    const result = await runCli(["--json", "update", id, "--priority", "high"]);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as AddedTask).agent_id).toBe("brutus");
  });

  it("does not let --assign rewrite agent_id", async () => {
    const id = await addAndGetId(["--agent", "brutus", "reassigned row"]);
    const result = await runCli(["--json", "update", id, "--assign", "cassius"]);
    expect(result.exitCode).toBe(0);
    const task = JSON.parse(result.stdout) as AddedTask;
    expect(task.assigned_to).toBe("cassius");
    expect(task.agent_id).toBe("brutus");
  });
});

describe("todos add — per-process identity still attributes and assigns (non-regression)", () => {
  // These must keep passing: TODOS_AGENT_ID and --agent are per-PROCESS, so they
  // cannot leak between concurrent sessions the way the shared file does. The fix
  // must narrow the shared file, not the feature #138 shipped.

  it("assigns to the env identity even while a foreign file is present", async () => {
    persistForeignIdentity();
    const task = await addJson(["env-identified task"], { TODOS_AGENT_ID: "cassius" });
    expect(task.assigned_to).toBe("cassius");
    expect(task.created_by).toBe("cassius");
  });

  it("assigns to the --agent identity even while a foreign file is present", async () => {
    persistForeignIdentity();
    const task = await addJson(["--agent", "brutus", "flag-identified task"]);
    expect(task.assigned_to).toBe("brutus");
    expect(task.created_by).toBe("brutus");
  });

  it("keeps an explicit --assign winning over the filer's own identity", async () => {
    const task = await addJson(["--assign", "brutus", "routed work"], { TODOS_AGENT_ID: "cassius" });
    expect(task.assigned_to).toBe("brutus");
    expect(task.created_by).toBe("cassius");
  });

  it("keeps --unassigned deliberate and silent", async () => {
    const result = await runCli(["--json", "add", "--unassigned", "deliberately ownerless"], { TODOS_AGENT_ID: "cassius" });
    expect(result.exitCode).toBe(0);
    const task = JSON.parse(result.stdout) as AddedTask;
    expect(task.assigned_to).toBeNull();
    expect(task.created_by).toBe("cassius");
    expect(result.stderr).not.toContain("ownerless");
  });
});
