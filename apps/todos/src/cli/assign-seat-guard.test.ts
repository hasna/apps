import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

/**
 * END-TO-END coverage for the seat refusal (todos 056f3597).
 *
 * WHY THIS FILE EXISTS, and it is the whole point: every other CLI test in this
 * repo points `HOME` at a temp dir, so the seat roster never exists and
 * `loadSeatSlugs()` correctly returns an empty set — which means the seat rule
 * is DISABLED in all of them. The unit tests in `lib/assignee-validation.test.ts`
 * inject a `Set` directly and never touch the file. So before this file, the
 * roster wiring could break and the suite would stay green: a check that cannot
 * fail, guarding a change whose entire subject is checks that cannot fail.
 * Raised as P2 in adversarial review by `porcia` on hasna/todos#146.
 *
 * `TODOS_SEAT_ROSTER_PATH` is the seam that makes this testable at all.
 */

/**
 * Subprocess CLI tests must not run on the 5s default. This repo already
 * learned that once — an ancestor commit gave the remote-entrypoint spawn test
 * a 45s budget "so CI stops flaking on the 5s default". Measured here at load
 * 32 on 20 cores, two of these were SIGTERMed at exactly 5000ms.
 */
const SPAWN_BUDGET_MS = 45_000;

let testRoot: string;
let dbPath: string;
let rosterPath: string;

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "todos-seat-guard-"));
  mkdirSync(join(testRoot, "home"), { recursive: true });
  dbPath = join(testRoot, "seat-guard.db");
  rosterPath = join(testRoot, "hasna-seats.roster.json");
  writeFileSync(
    rosterPath,
    JSON.stringify({
      name: "hasna-seats",
      agents: [{ slug: "agent-ceo" }, { slug: "agent-chief-staff" }],
    }),
  );
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: join(import.meta.dir, "..", ".."),
    env: localRoutingTestEnv({
      HOME: join(testRoot, "home"),
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

describe("todos add --assign <seat> — refused end to end, with the roster actually on disk", () => {
  it("REFUSES a seat slug when the roster names it", async () => {
    const r = await runCli(["add", "--assign", "agent-ceo", "seat routed"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("durable SEAT");
    expect(r.stderr).toContain("--assign-seat");
  }, SPAWN_BUDGET_MS);

  it("ACCEPTS the same seat with --assign-seat", async () => {
    const r = await runCli(["--json", "add", "--assign", "agent-ceo", "--assign-seat", "seat opt in"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { assigned_to: string | null }).assigned_to).toBe("agent-ceo");
  }, SPAWN_BUDGET_MS);

  it("REFUSES on `todos update --assign` too, not only on create", async () => {
    const created = await runCli(["--json", "add", "--unassigned", "to be reassigned"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.stdout) as { id: string }).id;

    const r = await runCli(["update", id, "--assign", "agent-chief-staff"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("durable SEAT");
  }, SPAWN_BUDGET_MS);

  it("REFUSES on the bare `todos assign <id> <agent>` subcommand", async () => {
    // This surface was MISSED on the first pass and only surfaced when the
    // failing-suite A/B against pristine main pointed at remote-entrypoint.test.ts,
    // which drives it directly. It is the most literally-named assignment
    // command, so an unguarded one made the whole rule bypassable.
    const created = await runCli(["--json", "add", "--unassigned", "bare assign target"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.stdout) as { id: string }).id;

    const refused = await runCli(["assign", id, "agent-ceo"], { TODOS_SEAT_ROSTER_PATH: rosterPath });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("durable SEAT");

    const allowed = await runCli(["assign", id, "agent-ceo", "--assign-seat"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(allowed.exitCode).toBe(0);
  }, SPAWN_BUDGET_MS);

  it("does NOT refuse a non-seat name — the guard must be able to not fire", async () => {
    // Without this the three assertions above would also pass if the CLI
    // refused everything.
    const r = await runCli(["--json", "add", "--assign", "brutus", "ordinary routing"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("durable SEAT");
  }, SPAWN_BUDGET_MS);

  it("SELF-DISABLES when the roster file is absent, so a sandboxed run is never stranded", async () => {
    // This is the e2b / cloud-runner case: no roster on the box. The seat must
    // go through rather than the CLI refusing every assignment.
    const r = await runCli(["--json", "add", "--assign", "agent-ceo", "no roster present"], {
      TODOS_SEAT_ROSTER_PATH: join(testRoot, "definitely-absent-roster.json"),
    });
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { assigned_to: string | null }).assigned_to).toBe("agent-ceo");
  }, SPAWN_BUDGET_MS);
});

/**
 * PR hasna/todos#162, remediation cycle 1 (pr162-reviewer, NO_GO).
 *
 * The seat-refusal message recommends a runnable invocation so the reader
 * never has to guess its shape — that is the entire point of the original
 * fix. But the message is shared by FOUR verbs, and one of them (the
 * standalone `assign <id> <agent>`) has no `--assign` flag at all, while the
 * other three (`add`, `update`, `task upsert`) do. A hardcoded snippet is
 * therefore right for three call sites and produces "unknown option
 * '--assign'" on the fourth — reproduced live by the reviewer.
 *
 * This suite does not trust the fix by reading the string. For each of the
 * four verbs it: triggers the real refusal against an isolated store,
 * EXTRACTS the exact invocation the message recommends, and RUNS that
 * invocation against the same verb — the reviewer's own method ("ideally by
 * running it"). A wrong hint on any one of the four fails here with the
 * verb's own error, not with a string assertion that could itself be wrong.
 */
describe("seat-refusal hint — verified by RUNNING it, per verb, not by reading it", () => {
  /** Pull the runnable suffix out of the refusal, whatever verb produced it. */
  function extractHint(stderr: string): string[] {
    const m = stderr.match(/to confirm the seat is deliberate: (.+?)\s*$/m);
    if (!m || !m[1]) {
      throw new Error(`No runnable hint found in refusal:\n${stderr}`);
    }
    return m[1].trim().split(/\s+/);
  }

  it("add: the hint recommends --assign <agent> --assign-seat, and running it succeeds", async () => {
    const refused = await runCli(["add", "--assign", "agent-ceo", "add hint check"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(refused.exitCode).toBe(1);
    const hint = extractHint(refused.stderr);
    expect(hint).toEqual(["--assign", "agent-ceo", "--assign-seat"]);

    const allowed = await runCli(["--json", "add", ...hint, "add hint check"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(allowed.exitCode).toBe(0);
    expect((JSON.parse(allowed.stdout) as { assigned_to: string | null }).assigned_to).toBe("agent-ceo");
  }, SPAWN_BUDGET_MS);

  it("update: the hint recommends --assign <agent> --assign-seat, and running it succeeds", async () => {
    const created = await runCli(["--json", "add", "--unassigned", "update hint check"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.stdout) as { id: string }).id;

    const refused = await runCli(["update", id, "--assign", "agent-chief-staff"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(refused.exitCode).toBe(1);
    const hint = extractHint(refused.stderr);
    expect(hint).toEqual(["--assign", "agent-chief-staff", "--assign-seat"]);

    const allowed = await runCli(["--json", "update", id, ...hint], { TODOS_SEAT_ROSTER_PATH: rosterPath });
    expect(allowed.exitCode).toBe(0);
    expect((JSON.parse(allowed.stdout) as { assigned_to: string | null }).assigned_to).toBe("agent-chief-staff");
  }, SPAWN_BUDGET_MS);

  it("task upsert: the hint recommends --assign <agent> --assign-seat, and running it succeeds", async () => {
    const refused = await runCli(
      ["task", "upsert", "--fingerprint", "upsert-hint-check", "--title", "upsert hint check", "--assign", "agent-ceo"],
      { TODOS_SEAT_ROSTER_PATH: rosterPath },
    );
    expect(refused.exitCode).toBe(1);
    const hint = extractHint(refused.stderr);
    expect(hint).toEqual(["--assign", "agent-ceo", "--assign-seat"]);

    const allowed = await runCli(
      ["--json", "task", "upsert", "--fingerprint", "upsert-hint-check", "--title", "upsert hint check", ...hint],
      { TODOS_SEAT_ROSTER_PATH: rosterPath },
    );
    expect(allowed.exitCode).toBe(0);
    // `task upsert --json` nests the row under `task`, unlike `add`/`update`,
    // which return it at the top level.
    expect((JSON.parse(allowed.stdout) as { task: { assigned_to: string | null } }).task.assigned_to).toBe(
      "agent-ceo",
    );
  }, SPAWN_BUDGET_MS);

  it("assign: the hint has NO --assign flag — it is <id> <agent> --assign-seat — and running it succeeds", async () => {
    const created = await runCli(["--json", "add", "--unassigned", "assign hint check"], {
      TODOS_SEAT_ROSTER_PATH: rosterPath,
    });
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.stdout) as { id: string }).id;

    const refused = await runCli(["assign", id, "agent-ceo"], { TODOS_SEAT_ROSTER_PATH: rosterPath });
    expect(refused.exitCode).toBe(1);
    const hint = extractHint(refused.stderr);
    // The defect this cycle fixes, made concrete: this hint must NEVER start
    // with "--assign" — that is the flag this verb does not have, and it is
    // exactly what the pre-fix shared message recommended here.
    expect(hint[0]).not.toBe("--assign");
    expect(hint).toEqual([id, "agent-ceo", "--assign-seat"]);

    const allowed = await runCli(["assign", ...hint], { TODOS_SEAT_ROSTER_PATH: rosterPath });
    expect(allowed.exitCode).toBe(0);
  }, SPAWN_BUDGET_MS);
});
