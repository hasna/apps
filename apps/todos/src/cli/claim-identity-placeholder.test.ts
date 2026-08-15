import { describe, it, expect, beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

/**
 * Regression: the CLAIM verbs stamped the literal string "cli" into the two
 * columns that decide who owns a task and who holds its lock (todos task
 * cf995f20).
 *
 * `todos start`, `todos lock` and `todos bulk start` each resolved their actor
 * as `globalOpts.agent || "cli"`, and `startTask` writes that value into BOTH
 * `assigned_to` and `locked_by` (src/db/task-lifecycle.ts). Two consequences,
 * and the second is the serious one:
 *
 *  1. It silently OVERWRITES a correct assignee with a placeholder the moment
 *     anyone starts the task. A non-empty bogus assignee is worse than NULL,
 *     because a coverage audit reads it as routed and skips the row.
 *
 *  2. `locked_by = "cli"` is a coordination hazard rather than a cosmetic one.
 *     `startTask`'s claim predicate admits `locked_by = ?` and `lockTask`
 *     (task-lifecycle.ts:305) treats `task.locked_by === agentId` as a LEASE
 *     RENEWAL. So every session that omitted `--agent` shared ONE lock
 *     identity and could take, renew, and hold any other such session's lock.
 *     A lock that cannot distinguish its holders is not a lock.
 *
 * These paths also never consulted TODOS_AGENT_ID, so the per-session escape
 * hatch that `lib/creator-identity.ts` recommends for concurrent sessions on a
 * shared HOME was inert on exactly the verbs where holder identity matters.
 *
 * THE FIX IS NOT "use the persisted identity". `resolveWritableIdentity`
 * deliberately refuses it (creator-identity.ts:138-152): `identity.json` is
 * keyed on $HOME and this fleet runs many sessions per station under one HOME,
 * so it names the BOX and not the caller. Promoting it to a lock holder would
 * not fix the shared-lock defect, it would rename it. A claim is an inherently
 * identified act, so a caller with no process-bound identity is refused.
 */

setDefaultTimeout(30_000);

let testRoot = "";
let homeDir = "";
let dbPath = "";

/** The identity a DIFFERENT session on this station registered and never released. */
const STATION_IDENTITY = "titus-skill-corpus";

/**
 * The suite that tests a shared-identity defect must not itself touch the shared
 * identity. Setting HOME is a request, not a guarantee: a resolver that consults
 * anything else escapes it silently, and the escape is invisible because the run
 * still reports green. So isolation is ASSERTED after every case, in both
 * directions -- the temp HOME is where the fixture identity lands (the cases below
 * depend on it, which is the positive control) and the real file is byte-identical
 * afterwards.
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
  testRoot = mkdtempSync(join(tmpdir(), "todos-claim-identity-"));
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

/** Stand in for another session's `todos init` having already run under this HOME. */
function persistStationIdentity() {
  writeFileSync(
    join(homeDir, ".hasna", "todos", "identity.json"),
    JSON.stringify({
      agent_id: "af774e59",
      agent_name: STATION_IDENTITY,
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

interface TaskRow {
  id: string;
  short_id?: string;
  title: string;
  status: string;
  assigned_to: string | null;
  locked_by: string | null;
}

/** Create a task owned by a named agent, using the process-bound escape hatch. */
async function addTask(title: string, extra: string[] = []): Promise<TaskRow> {
  const result = await runCli(["--json", "add", title, ...extra], { TODOS_AGENT_ID: "owner-agent" });
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as TaskRow;
}

async function showTask(id: string): Promise<TaskRow> {
  const result = await runCli(["--json", "show", id], { TODOS_AGENT_ID: "reader-agent" });
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as TaskRow;
}

describe("todos start — a claim must carry a real, process-bound identity", () => {
  it("does not write the literal 'cli' into assigned_to", async () => {
    const task = await addTask("work that belongs to someone");
    await runCli(["start", task.id]);
    const after = await showTask(task.id);
    expect(after.assigned_to).not.toBe("cli");
  });

  it("does not write the literal 'cli' into locked_by", async () => {
    // The serious half: locked_by is the lock HOLDER, and a placeholder holder
    // is shared by every unidentified session on the station.
    const task = await addTask("work that belongs to someone");
    await runCli(["start", task.id]);
    const after = await showTask(task.id);
    expect(after.locked_by).not.toBe("cli");
  });

  it("refuses the claim outright when no process-bound identity exists", async () => {
    const task = await addTask("work that belongs to someone");
    const result = await runCli(["start", task.id]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("TODOS_AGENT_ID");
  });

  it("does not replace an existing assignee with a placeholder WHEN THE CALLER IS UNIDENTIFIED", async () => {
    // Name narrowed after adversarial review (hortensia). The original read
    // "does not overwrite an existing correct assignee", which overstated it:
    // this passes because the unidentified claim is REFUSED, not because
    // `startTask` stopped reassigning. An IDENTIFIED caller still overwrites a
    // correct assignee — measured, `owner-agent` -> `other-agent` — and that is
    // unchanged by this PR and arguably correct for a claim verb, since taking
    // a task is what `start` is for. Pinned with an accurate name so the
    // residual stays visible instead of looking covered.
    //
    // The audit-blinding shape this DOES close: a real owner replaced by "cli",
    // after which a coverage sweep reads the row as routed and skips it.
    const task = await addTask("work that belongs to someone", ["--assign", "owner-agent"]);
    expect(task.assigned_to).toBe("owner-agent");
    await runCli(["start", task.id]);
    const after = await showTask(task.id);
    expect(after.assigned_to).toBe("owner-agent");
  });

  it("refuses rather than promoting the station's persisted identity to a lock holder", async () => {
    // The naive fix -- "use the identity todos init persisted" -- would pass the
    // two cases above while leaving the defect intact under a nicer name, because
    // identity.json is keyed on $HOME and every session on the box reads the same
    // one. This case is what discriminates the real fix from that one.
    persistStationIdentity();
    const task = await addTask("work that belongs to someone");
    const result = await runCli(["start", task.id]);
    expect(result.exitCode).not.toBe(0);
    const after = await showTask(task.id);
    expect(after.locked_by).not.toBe(STATION_IDENTITY);
    expect(after.assigned_to).not.toBe(STATION_IDENTITY);
  });

  it("honours TODOS_AGENT_ID, the per-session escape hatch these paths ignored", async () => {
    const task = await addTask("work that belongs to someone");
    const result = await runCli(["start", task.id], { TODOS_AGENT_ID: "session-b" });
    expect(result.exitCode).toBe(0);
    const after = await showTask(task.id);
    expect(after.assigned_to).toBe("session-b");
    expect(after.locked_by).toBe("session-b");
  });

  it("still starts normally with an explicit --agent — the positive control", async () => {
    // Without this, every assertion above would pass on a CLI that refused
    // every claim unconditionally.
    const task = await addTask("work that belongs to someone");
    const result = await runCli(["--agent", "session-a", "start", task.id]);
    expect(result.exitCode).toBe(0);
    const after = await showTask(task.id);
    expect(after.status).toBe("in_progress");
    expect(after.assigned_to).toBe("session-a");
    expect(after.locked_by).toBe("session-a");
  });

  it("reports an UNRESOLVABLE task reference as a task error, not as an identity refusal", async () => {
    // Ordering guard. The first cut of this fix resolved identity BEFORE the task
    // reference, which masked `start`'s "ambiguous short id -> candidate project
    // IDs" diagnostic while `done`, `update` and `comment` kept reporting it.
    // CI caught it; a local subset run did not. A safety diagnostic that only some
    // verbs emit is worse than one none of them emit, because the gap is invisible.
    //
    // Scope of the guarantee, stated precisely because the first draft of THIS
    // test got it wrong: it holds where resolution itself fails. A syntactically
    // valid but nonexistent UUID resolves fine and is then correctly refused for
    // want of an identity — that is not a masked diagnostic, and asserting
    // otherwise made this case fail against the corrected code.
    const result = await runCli(["start", "zzzzzzzz"]);
    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("Could not resolve task ID");
    expect(combined).not.toContain("TODOS_AGENT_ID");
  });
});

describe("todos start/done — the same --agent value must claim and release", () => {
  it("refuses done without a process-bound identity and preserves the named live lock", async () => {
    const task = await addTask("named lock must survive unidentified done");
    expect((await runCli(["--agent", "session-a", "start", task.id])).exitCode).toBe(0);
    expect((await showTask(task.id)).locked_by).toBe("session-a");

    const done = await runCli(["done", task.id]);
    expect(done.exitCode).not.toBe(0);
    expect(done.stderr).toContain("TODOS_AGENT_ID");
    expect(await showTask(task.id)).toMatchObject({ status: "in_progress", locked_by: "session-a" });

    expect((await runCli(["delete", task.id])).exitCode).toBe(0);
    expect((await runCli(["--json", "show", task.id])).exitCode).not.toBe(0);
  });

  it("uses TODOS_AGENT_ID for done and releases the legitimate holder's live lock", async () => {
    const task = await addTask("environment holder completes");
    expect((await runCli(["--agent", "session-a", "start", task.id])).exitCode).toBe(0);
    expect((await showTask(task.id)).locked_by).toBe("session-a");

    const done = await runCli(["done", task.id], { TODOS_AGENT_ID: "session-a" });
    expect(done.exitCode).toBe(0);
    expect(await showTask(task.id)).toMatchObject({ status: "completed", locked_by: null });

    expect((await runCli(["delete", task.id])).exitCode).toBe(0);
    expect((await runCli(["--json", "show", task.id])).exitCode).not.toBe(0);
  });

  it("releases a lock taken with a capitalised --agent, using that same value", async () => {
    // Found by adversarial review (hortensia) and it is a defect this fix
    // CREATED rather than inherited. `resolveClaimIdentity` folds case, as
    // `resolveCreatorIdentity` and `registerAgent` already do; `done`, `unlock`,
    // `bulk done`, `claim` and `steal` passed the raw flag into a `locked_by`
    // string comparison. So `start --agent Cassius` recorded locked_by='cassius'
    // and `done --agent Cassius` — the identical flag value — was refused.
    //
    // It matters disproportionately here: the PR designates per-invocation
    // `--agent` as the ONLY remedy that works on a Claude Code seat, and this
    // fleet names agents in capitalised Roman form. `unlockTask` has no expiry
    // term either, so the named form could never recover the lock.
    const task = await addTask("case folding round trip");
    const started = await runCli(["--agent", "Cassius", "start", task.id]);
    expect(started.exitCode).toBe(0);
    const done = await runCli(["--agent", "Cassius", "done", task.id]);
    expect(done.exitCode).toBe(0);
  });

  it("releases a lock taken by the POSITIONAL claim verb, using --agent", async () => {
    // The cycle-2 blocking finding (hortensia), and the reason the fold moved
    // from the `--agent` flag to the store. `claim <agent>` and `steal <agent>`
    // take the agent POSITIONALLY, so a parse-time fold on the flag never
    // reached them and the round trip broke one verb over — inside the CLI this
    // PR owns, with no foreign client and no legacy data involved. Measured
    // then: `claim Cassius` stored locked_by='Cassius', after which
    // `--agent Cassius unlock` and `done` were both rc=1, permanently for
    // unlock, which has no expiry term.
    const task = await addTask("positional claim round trip");
    const claimed = await runCli(["claim", "Cassius"]);
    expect(claimed.exitCode).toBe(0);
    const started = await runCli(["--agent", "Cassius", "start", task.id]);
    expect(started.exitCode).toBe(0);
    const unlocked = await runCli(["--agent", "Cassius", "unlock", task.id]);
    expect(unlocked.exitCode).toBe(0);
  });

  it("lets the named owner release a lock stored with DIFFERENT case — the legacy rows", async () => {
    // A non-folding writer (the MCP, the TUI, the dashboard, or any pre-fix CLI)
    // can leave a capitalised holder. Measured on the live store: 10 of 357
    // non-null locked_by values are capitalised — a floor, that read was
    // page-capped. Before the store-boundary comparison those were unreleasable
    // by their named owner, and `unlockTask` has no expiry term, so permanently.
    const task = await addTask("legacy capitalised holder");
    expect((await runCli(["--agent", "Cassius", "start", task.id])).exitCode).toBe(0);
    const stored = await showTask(task.id);
    expect((await runCli(["--agent", stored.locked_by!.toUpperCase(), "unlock", task.id])).exitCode).toBe(0);
  });

  it("treats differently-cased spellings as ONE holder, not two — pins resolveClaimIdentity, NOT the global coercion", async () => {
    // Honest label: this case passes with the parse-time `--agent` coercion
    // REMOVED, because both verbs here route through `resolveClaimIdentity`,
    // which folds case on its own. Measured, so nobody reads it as evidence for
    // the coercion — the case above is the one that discriminates. What this
    // pins is that folding must stop two spellings becoming two holders, which
    // would reintroduce a split-holder lock under new names.
    const task = await addTask("case folding holder identity");
    expect((await runCli(["--agent", "Cassius", "start", task.id])).exitCode).toBe(0);
    expect((await showTask(task.id)).locked_by).toBe("cassius");
    const renew = await runCli(["--agent", "cassius", "lock", task.id]);
    expect(renew.exitCode).toBe(0);
  });
});

describe("todos unlock — omitting identity must not become force release", () => {
  it("refuses an unidentified caller and preserves another agent's live lock", async () => {
    const task = await addTask("named lock must survive unidentified unlock");
    const locked = await runCli(["--agent", "session-a", "lock", task.id]);
    expect(locked.exitCode).toBe(0);
    expect((await showTask(task.id)).locked_by).toBe("session-a");

    const unlock = await runCli(["unlock", task.id]);
    expect(unlock.exitCode).not.toBe(0);
    expect(unlock.stderr).toContain("TODOS_AGENT_ID");
    expect((await showTask(task.id)).locked_by).toBe("session-a");
  });
});

describe("todos lock — the shared placeholder let one session take another's lock", () => {
  it("does not let two unidentified sessions both hold the same task", async () => {
    // The exploit, end to end, and it needs BOTH sessions unidentified — an
    // earlier draft of this case gave session A an explicit --agent and passed
    // against the unfixed CLI, because a named holder was never the bug. Pre-fix
    // both sessions resolve to "cli", so lockTask's same-agent branch
    // (task-lifecycle.ts:305) reads session B's acquisition as a LEASE RENEWAL of
    // session A's lock and returns success to both.
    const task = await addTask("contended work");
    const claimA = await runCli(["start", task.id]);
    const claimB = await runCli(["lock", task.id]);
    expect([claimA.exitCode, claimB.exitCode]).not.toEqual([0, 0]);
  });

  it("does not let a second session take a NAMED session's lock — non-regression", async () => {
    // Passes before and after the fix. Kept as a control on the surrounding
    // behaviour, and labelled so nobody reads it as evidence for the fix.
    const task = await addTask("contended work");
    expect((await runCli(["--agent", "session-a", "start", task.id])).exitCode).toBe(0);
    await runCli(["lock", task.id]);
    expect((await showTask(task.id)).locked_by).toBe("session-a");
  });

  it("does not write the literal 'cli' into locked_by", async () => {
    const task = await addTask("lockable work");
    await runCli(["lock", task.id]);
    const after = await showTask(task.id);
    expect(after.locked_by).not.toBe("cli");
  });

  it("still locks normally with an explicit --agent — the positive control", async () => {
    const task = await addTask("lockable work");
    const result = await runCli(["--agent", "session-a", "lock", task.id]);
    expect(result.exitCode).toBe(0);
    const after = await showTask(task.id);
    expect(after.locked_by).toBe("session-a");
  });
});

describe("todos bulk start — the same claim, taken in a loop", () => {
  it("does not write the literal 'cli' into the routing columns", async () => {
    const task = await addTask("bulk work");
    await runCli(["bulk", "start", task.id]);
    const after = await showTask(task.id);
    expect(after.assigned_to).not.toBe("cli");
    expect(after.locked_by).not.toBe("cli");
  });

  it("still starts normally with an explicit --agent — the positive control", async () => {
    const task = await addTask("bulk work");
    const result = await runCli(["--agent", "session-a", "bulk", "start", task.id]);
    expect(result.exitCode).toBe(0);
    const after = await showTask(task.id);
    expect(after.status).toBe("in_progress");
    expect(after.locked_by).toBe("session-a");
  });
});
