import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

/**
 * END-TO-END coverage for `todos delegate`, driven as a real subprocess.
 *
 * WHAT THIS VERB IS FOR, because it decides what is worth asserting: at 24.8
 * actionable signals an hour, an ATOMIC act survives and a PIPELINE does not.
 * Filing a task is one step and ran 13/14. Dispatching one was six steps across
 * three CLIs and ran 0/14. `delegate` collapses those six into one call, so the
 * thing under test is not "does the command exit 0" but "did all seven effects
 * actually land, in one invocation, and did the ones that must NOT happen stay
 * un-happened".
 *
 * Every assertion therefore READS THE ROW OR THE ARTEFACT BACK. An exit code is
 * never accepted as evidence: the failure shape this verb is most exposed to is
 * a silent no-op — a PATCH that returns 200 having written nothing — which is
 * indistinguishable from success at the exit code.
 */

const SPAWN_BUDGET_MS = 45_000;

let testRoot: string;
let homeDir: string;
let dbPath: string;
let briefPath: string;
let rosterPath: string;
let embargoPath: string;
let noticeLog: string;
let fakeNotifyBin: string;

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "todos-delegate-"));
  homeDir = join(testRoot, "home");
  mkdirSync(homeDir, { recursive: true });
  dbPath = join(testRoot, "delegate.db");

  briefPath = join(testRoot, "brief.md");
  writeFileSync(
    briefPath,
    "# Brief\n\nEverything the worker needs, because it will see no announcement published after it starts.\n",
  );

  rosterPath = join(testRoot, "hasna-seats.roster.json");
  writeFileSync(
    rosterPath,
    JSON.stringify({ name: "hasna-seats", agents: [{ slug: "agent-ceo" }, { slug: "agent-chief-staff" }] }),
  );

  embargoPath = join(testRoot, "delegation-embargo.json");
  writeFileSync(embargoPath, JSON.stringify({ embargoed: ["vespasian"] }));

  // The channel notice (step 6) crosses into a DIFFERENT CLI. Substituting the
  // binary is what makes step 6 testable in BOTH directions without touching
  // the real conversations service: a suppression-only test would pass even if
  // the notice never worked at all.
  noticeLog = join(testRoot, "notices.log");
  fakeNotifyBin = join(testRoot, "fake-conversations");
  writeFileSync(fakeNotifyBin, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(noticeLog)}\n`);
  chmodSync(fakeNotifyBin, 0o755);
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

beforeEach(() => {
  if (existsSync(noticeLog)) rmSync(noticeLog, { force: true });
});

async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: join(import.meta.dir, "..", ".."),
    env: localRoutingTestEnv({
      HOME: homeDir,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      TODOS_AGENT_ID: "agent-ceo",
      TODOS_SEAT_ROSTER_PATH: rosterPath,
      TODOS_DELEGATE_NOTIFY_BIN: fakeNotifyBin,
      ...extraEnv,
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

/** File a task the way the fleet actually does, and return its id. */
async function fileTask(title: string): Promise<string> {
  const created = await runCli(["--json", "add", "--unassigned", title]);
  expect(created.exitCode).toBe(0);
  return (JSON.parse(created.stdout) as { id: string }).id;
}

async function readTask(id: string): Promise<Record<string, unknown>> {
  const shown = await runCli(["--json", "show", id]);
  expect(shown.exitCode).toBe(0);
  return JSON.parse(shown.stdout) as Record<string, unknown>;
}

// ── Step 1: the brief gate, end to end ──────────────────────────────────────
describe("delegate step 1 — REFUSES an absent or empty brief, before writing anything", () => {
  it("REFUSES with no brief at all, and leaves the row untouched", async () => {
    const id = await fileTask("no brief given");
    const before = await readTask(id);

    const r = await runCli(["delegate", id, "lucilius"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--brief");

    // The gate runs FIRST, so nothing may have been written. Asserting the
    // exit code alone would not catch a gate that refuses after assigning.
    const after = await readTask(id);
    expect(after["assigned_to"]).toBe(before["assigned_to"] as never);
    expect(after["delegated_from"]).toBeNull();
    expect(after["version"]).toBe(before["version"] as never);
  }, SPAWN_BUDGET_MS);

  it("REFUSES an unreadable --brief path and names the path", async () => {
    const id = await fileTask("unreadable brief");
    const missing = join(testRoot, "definitely-absent-brief.md");
    const r = await runCli(["delegate", id, "lucilius", "--brief", missing]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(missing);
    expect((await readTask(id))["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);

  it("REFUSES a whitespace-only brief file", async () => {
    const id = await fileTask("whitespace brief");
    const wsPath = join(testRoot, "whitespace-brief.md");
    writeFileSync(wsPath, "   \n\t\n  ");
    const r = await runCli(["delegate", id, "lucilius", "--brief", wsPath]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/empty/i);
    expect((await readTask(id))["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);

  it("REFUSES both --brief and --brief-text together", async () => {
    const id = await fileTask("two briefs");
    const r = await runCli([
      "delegate", id, "lucilius", "--brief", briefPath, "--brief-text", "also inline",
    ]);
    expect(r.exitCode).toBe(1);
    expect((await readTask(id))["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);

  it("ACCEPTS a real brief — so every refusal above is a gate, not a verb that always fails", async () => {
    const id = await fileTask("good brief");
    const r = await runCli(["--json", "delegate", id, "lucilius", "--brief", briefPath, "--no-post"]);
    expect(r.exitCode).toBe(0);
  }, SPAWN_BUDGET_MS);

  it("ACCEPTS --brief-text as the inline alternative", async () => {
    const id = await fileTask("inline brief");
    const r = await runCli([
      "--json", "delegate", id, "lucilius", "--brief-text", "inline but real", "--no-post",
    ]);
    expect(r.exitCode).toBe(0);
  }, SPAWN_BUDGET_MS);
});

// ── Step 4: the row actually carries the handover ───────────────────────────
describe("delegate step 4 — the ROW carries the handover, read back from the store", () => {
  it("writes assigned_to, assigned_by, delegated_from and delegation_depth in one call", async () => {
    const id = await fileTask("lineage target");
    const r = await runCli([
      "--json", "delegate", id, "lucilius", "--brief", briefPath, "--no-post",
    ]);
    expect(r.exitCode).toBe(0);

    const row = await readTask(id);
    expect(row["assigned_to"]).toBe("lucilius");
    expect(row["assigned_by"]).toBe("agent-ceo");
    expect(row["delegated_from"]).toBe("agent-ceo");
    expect(row["delegation_depth"]).toBe(1);
  }, SPAWN_BUDGET_MS);

  it("LEAVES started_at NULL — the property that keeps this verb's own failure rate countable", async () => {
    // If delegate stamped started_at, a dispatched-but-never-claimed row would
    // be indistinguishable from a worked one, and the N2 dispatch-laundering
    // counter this verb is measured by could not be computed at all.
    const id = await fileTask("must stay unclaimed");
    expect((await runCli(["delegate", id, "lucilius", "--brief", briefPath, "--no-post"])).exitCode).toBe(0);

    const row = await readTask(id);
    expect(row["started_at"]).toBeNull();
    expect(row["locked_by"]).toBeNull();
    expect(row["status"]).toBe("pending");
  }, SPAWN_BUDGET_MS);

  it("increments depth from the parent row rather than always writing 1", async () => {
    const id = await fileTask("depth chain");
    expect((await runCli([
      "delegate", id, "lucilius", "--brief", briefPath, "--depth", "4", "--no-post",
    ])).exitCode).toBe(0);
    expect((await readTask(id))["delegation_depth"]).toBe(4);
  }, SPAWN_BUDGET_MS);

  it("REFUSES a worker name no agent could ever register as, and says nothing was written", async () => {
    // A row routed to an unregisterable name is routed to NOBODY while reading
    // as covered to every audit that counts assignees — 44 of 493 assigned rows
    // measured on this fleet named something that was not an agent at all.
    const id = await fileTask("unregisterable worker");
    const r = await runCli(["delegate", id, "worker-2", "--brief", briefPath, "--no-post"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Nothing was written");
    const row = await readTask(id);
    expect(row["assigned_to"]).toBeNull();
    expect(row["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);

  it("REFUSES an unregisterable name EVEN WITH --reuse-identity, which skips registration", async () => {
    // This is the arm the early check exists for. `--reuse-identity` skips step
    // 3, so registration would never raise, and without the pre-write check the
    // bad name would be written straight into assigned_to.
    const id = await fileTask("unregisterable worker, registration skipped");
    const r = await runCli([
      "delegate", id, "worker-2", "--brief", briefPath, "--reuse-identity", "--no-post",
    ]);
    expect(r.exitCode).toBe(1);
    expect((await readTask(id))["assigned_to"]).toBeNull();
  }, SPAWN_BUDGET_MS);

  it("REFUSES a worker that names a durable seat — a seat queue has no session watching it", async () => {
    const id = await fileTask("seat as worker");
    const r = await runCli(["delegate", id, "agent-chief-staff", "--brief", briefPath, "--no-post"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("durable SEAT");
    expect((await readTask(id))["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);
});

// ── Step 5: act and record are one event ────────────────────────────────────
describe("delegate step 5 — the [DISPATCH] comment is written in the same call", () => {
  it("appends a greppable [DISPATCH] comment carrying the brief source and digest", async () => {
    const id = await fileTask("comment target");
    const r = await runCli([
      "--json", "delegate", id, "porcia", "--brief", briefPath, "--runtime", "claude-code-subagent", "--no-post",
    ]);
    expect(r.exitCode).toBe(0);
    const payload = JSON.parse(r.stdout) as { delegation: { brief: { sha256: string } } };

    const shown = await runCli(["--json", "show", id]);
    expect(shown.exitCode).toBe(0);
    const comments = (JSON.parse(shown.stdout) as { comments: Array<{ content: string }> }).comments;
    const dispatch = comments.find((c) => c.content.startsWith("[DISPATCH]"));
    expect(dispatch).toBeDefined();
    expect(dispatch!.content).toContain("porcia");
    expect(dispatch!.content).toContain("claude-code-subagent");
    expect(dispatch!.content).toContain(briefPath);
    // The digest in the record must be the digest of the real bytes, so a
    // reader can verify the worker was handed the brief that is on disk.
    expect(dispatch!.content).toContain(payload.delegation.brief.sha256);
  }, SPAWN_BUDGET_MS);

  it("records the claim deadline in the comment AND in queryable task metadata", async () => {
    const id = await fileTask("deadline target");
    const r = await runCli([
      "--json", "delegate", id, "porcia", "--brief", briefPath, "--claim-window", "45", "--no-post",
    ]);
    expect(r.exitCode).toBe(0);
    const payload = JSON.parse(r.stdout) as { delegation: { claim_deadline: string } };

    const row = await readTask(id);
    const metadata = row["metadata"] as Record<string, unknown>;
    const delegation = metadata["delegation"] as Record<string, unknown>;
    expect(delegation["claim_deadline"]).toBe(payload.delegation.claim_deadline);

    // 45 minutes after dispatch, not the 30-minute default — proving the flag
    // is read rather than a constant being echoed back.
    const dispatchedAt = Date.parse(delegation["dispatched_at"] as string);
    const deadline = Date.parse(delegation["claim_deadline"] as string);
    expect(deadline - dispatchedAt).toBe(45 * 60 * 1000);
  }, SPAWN_BUDGET_MS);

  it("PRESERVES unrelated task metadata — the merge must not clobber another writer's keys", async () => {
    // Seed a foreign key in metadata the way another tool would. `task upsert`
    // is the ONLY CLI surface that writes task metadata — `add` and `update`
    // have no metadata flag at all, which is itself why delegate writes the
    // column directly rather than shelling out to another verb.
    const created = await runCli([
      "--json", "task", "upsert",
      "--fingerprint", "delegate-metadata-merge",
      "--title", "metadata merge target",
      "--metadata-json", JSON.stringify({ keep_me: "untouched" }),
    ]);
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.stdout) as { task: { id: string } }).task.id;

    expect((await runCli(["delegate", id, "porcia", "--brief", briefPath, "--no-post"])).exitCode).toBe(0);

    const metadata = (await readTask(id))["metadata"] as Record<string, unknown>;
    expect(metadata["keep_me"]).toBe("untouched");
    expect(metadata["delegation"]).toBeDefined();
  }, SPAWN_BUDGET_MS);
});

// ── Step 2: depth is printed always, and parks only when armed ──────────────
describe("delegate step 2 — seat depth is always reported, and parks only when a threshold is armed", () => {
  it("PRINTS the seat's open count even with no threshold armed", async () => {
    const id = await fileTask("depth report");
    const r = await runCli([
      "--json", "delegate", id, "lucilius", "--brief", briefPath, "--seat", "agent-ceo", "--no-post",
    ]);
    expect(r.exitCode).toBe(0);
    const seat = (JSON.parse(r.stdout) as { delegation: { seat: Record<string, unknown> } }).delegation.seat;
    expect(seat["slug"]).toBe("agent-ceo");
    expect(typeof seat["open_tasks"]).toBe("number");
    expect(seat["threshold"]).toBeNull();
    expect(seat["parked"]).toBe(false);
  }, SPAWN_BUDGET_MS);

  it("PARKS when the armed threshold is exceeded, and writes nothing", async () => {
    const id = await fileTask("parked delegation");
    // Assign a couple of rows to the seat so the count is genuinely above 0.
    await runCli(["assign", await fileTask("seat load 1"), "agent-ceo", "--assign-seat"]);
    await runCli(["assign", await fileTask("seat load 2"), "agent-ceo", "--assign-seat"]);

    const r = await runCli([
      "delegate", id, "lucilius", "--brief", briefPath,
      "--seat", "agent-ceo", "--depth-threshold", "1", "--no-post",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--despite-depth");
    expect((await readTask(id))["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);

  it("PROCEEDS past an armed threshold with --despite-depth, and records the override", async () => {
    const id = await fileTask("override delegation");
    const r = await runCli([
      "--json", "delegate", id, "lucilius", "--brief", briefPath,
      "--seat", "agent-ceo", "--depth-threshold", "1", "--despite-depth", "--no-post",
    ]);
    expect(r.exitCode).toBe(0);
    const seat = (JSON.parse(r.stdout) as { delegation: { seat: Record<string, unknown> } }).delegation.seat;
    expect(seat["override"]).toBe("despite-depth");
    expect((await readTask(id))["delegated_from"]).toBe("agent-ceo");

    const shown = await runCli(["--json", "show", id]);
    const comments = (JSON.parse(shown.stdout) as { comments: Array<{ content: string }> }).comments;
    // The override must be legible in the durable record, not only on stdout.
    expect(comments.find((c) => c.content.startsWith("[DISPATCH]"))!.content).toContain("despite-depth");
  }, SPAWN_BUDGET_MS);

  it("NEVER parks an --owner-directive row, and says so", async () => {
    const id = await fileTask("owner directive row");
    const r = await runCli([
      "--json", "delegate", id, "lucilius", "--brief", briefPath,
      "--seat", "agent-ceo", "--depth-threshold", "1", "--owner-directive", "--no-post",
    ]);
    expect(r.exitCode).toBe(0);
    const seat = (JSON.parse(r.stdout) as { delegation: { seat: Record<string, unknown> } }).delegation.seat;
    expect(seat["override"]).toBe("owner-directive");
    expect(seat["parked"]).toBe(false);
    expect((await readTask(id))["delegated_from"]).toBe("agent-ceo");
  }, SPAWN_BUDGET_MS);

  it("reads the threshold from the environment when no flag is given", async () => {
    const id = await fileTask("env threshold");
    const r = await runCli(
      ["delegate", id, "lucilius", "--brief", briefPath, "--seat", "agent-ceo", "--no-post"],
      { TODOS_DELEGATION_DEPTH_THRESHOLD: "1" },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--despite-depth");
  }, SPAWN_BUDGET_MS);
});

// ── Step 3: the worker identity is registered, lineage-linked ───────────────
describe("delegate step 3 — the worker identity is registered and lineage-linked", () => {
  it("registers an unknown worker with reports_to pointing at the dispatcher", async () => {
    const id = await fileTask("identity registration");
    const worker = "nicanor";
    const r = await runCli(["--json", "delegate", id, worker, "--brief", briefPath, "--no-post"]);
    expect(r.exitCode).toBe(0);
    const identity = (JSON.parse(r.stdout) as { delegation: { identity: Record<string, unknown> } })
      .delegation.identity;
    expect(identity["outcome"]).toBe("created");

    const agents = await runCli(["--json", "agents"]);
    expect(agents.exitCode).toBe(0);
    const rows = JSON.parse(agents.stdout) as Array<{ name: string; reports_to: string | null }>;
    const registered = rows.find((a) => a.name === worker);
    expect(registered).toBeDefined();
    expect(registered!.reports_to).toBe("agent-ceo");
  }, SPAWN_BUDGET_MS);

  it("REUSES an existing identity instead of failing the whole delegation", async () => {
    // Re-dispatching the same worker is routine. Refusing it because the name
    // is already registered would break the atomic property the verb exists for.
    const worker = "hostilius";
    const first = await fileTask("first dispatch");
    expect((await runCli(["delegate", first, worker, "--brief", briefPath, "--no-post"])).exitCode).toBe(0);

    const second = await fileTask("second dispatch");
    const r = await runCli(["--json", "delegate", second, worker, "--brief", briefPath, "--no-post"]);
    expect(r.exitCode).toBe(0);
    const identity = (JSON.parse(r.stdout) as { delegation: { identity: Record<string, unknown> } })
      .delegation.identity;
    expect(identity["outcome"]).toBe("reused");
    expect((await readTask(second))["assigned_to"]).toBe(worker);
  }, SPAWN_BUDGET_MS);

  it("skips registration entirely with --reuse-identity", async () => {
    const id = await fileTask("skip registration");
    const r = await runCli([
      "--json", "delegate", id, "menenius", "--brief", briefPath, "--reuse-identity", "--no-post",
    ]);
    expect(r.exitCode).toBe(0);
    const identity = (JSON.parse(r.stdout) as { delegation: { identity: Record<string, unknown> } })
      .delegation.identity;
    expect(identity["outcome"]).toBe("skipped");
  }, SPAWN_BUDGET_MS);

  it("REFUSES when no dispatcher identity can be resolved — lineage to nobody is not lineage", async () => {
    const id = await fileTask("no dispatcher identity");
    const r = await runCli(["delegate", id, "lucilius", "--brief", briefPath, "--no-post"], {
      TODOS_AGENT_ID: "",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("TODOS_AGENT_ID");
    // The refusal must not assert this verb changes a lock — it does not, and a
    // message that says so sends the reader to debug the wrong subsystem.
    expect(r.stderr).not.toContain("lock");
    expect((await readTask(id))["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);
});

// ── Step 6: the channel notice, proven in both directions ───────────────────
describe("delegate step 6 — the channel notice fires once, and can be suppressed", () => {
  it("POSTS one notice through the conversations CLI", async () => {
    const id = await fileTask("notice target");
    const r = await runCli([
      "--json", "delegate", id, "lucilius", "--brief", briefPath, "--channel", "test-channel",
    ]);
    expect(r.exitCode).toBe(0);

    expect(existsSync(noticeLog)).toBe(true);
    const lines = readFileSync(noticeLog, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("test-channel");
    expect(lines[0]).toContain("lucilius");
  }, SPAWN_BUDGET_MS);

  it("POSTS NOTHING with --no-post — and this pair is why the test above is not vacuous", async () => {
    const id = await fileTask("suppressed notice");
    const r = await runCli([
      "--json", "delegate", id, "lucilius", "--brief", briefPath, "--channel", "test-channel", "--no-post",
    ]);
    expect(r.exitCode).toBe(0);
    expect(existsSync(noticeLog)).toBe(false);
  }, SPAWN_BUDGET_MS);

  it("falls back to TODOS_DELEGATE_NOTICE_CHANNEL when --channel is omitted", async () => {
    // There is no project-channel default available in this package: `Project`
    // here has no integrations map, and the conversations channel lives in
    // @hasna/projects. Configuration is the seam that keeps this one call.
    const id = await fileTask("env channel");
    const r = await runCli(
      ["--json", "delegate", id, "lucilius", "--brief", briefPath],
      { TODOS_DELEGATE_NOTICE_CHANNEL: "env-channel" },
    );
    expect(r.exitCode).toBe(0);
    expect(readFileSync(noticeLog, "utf8")).toContain("env-channel");
  }, SPAWN_BUDGET_MS);

  it("REPORTS an unposted notice when no channel is resolvable anywhere", async () => {
    const id = await fileTask("no channel at all");
    const r = await runCli(["--json", "delegate", id, "lucilius", "--brief", briefPath]);
    expect(r.exitCode).toBe(0);
    const notice = (JSON.parse(r.stdout) as { delegation: { notice: Record<string, unknown> } }).delegation.notice;
    expect(notice["posted"]).toBe(false);
    expect(String(notice["error"])).toContain("--channel");
    // The delegation still landed: a missing channel is not a reason to refuse
    // a handover that is otherwise complete.
    expect((await readTask(id))["delegated_from"]).toBe("agent-ceo");
  }, SPAWN_BUDGET_MS);

  it("STILL DELEGATES when the notice command fails — steps 1-5 are the commit point", async () => {
    // Step 6 crosses into a different CLI and a different service, so it cannot
    // be transactional with the store writes. A failed notice must not roll
    // back or fail a delegation that already landed, or a conversations outage
    // becomes a delegation outage.
    const id = await fileTask("notice failure");
    const r = await runCli(
      ["--json", "delegate", id, "lucilius", "--brief", briefPath, "--channel", "test-channel"],
      { TODOS_DELEGATE_NOTIFY_BIN: join(testRoot, "no-such-binary-at-all") },
    );
    expect(r.exitCode).toBe(0);
    const notice = (JSON.parse(r.stdout) as { delegation: { notice: Record<string, unknown> } })
      .delegation.notice;
    expect(notice["posted"]).toBe(false);
    expect(notice["error"]).toBeTruthy();
    // The delegation itself still landed.
    expect((await readTask(id))["delegated_from"]).toBe("agent-ceo");
  }, SPAWN_BUDGET_MS);
});

// ── --dry-run writes nothing ────────────────────────────────────────────────
describe("delegate --dry-run — reports all seven effects and performs none", () => {
  it("changes no row, adds no comment, posts no notice", async () => {
    const id = await fileTask("dry run target");
    const before = await readTask(id);

    const r = await runCli(["--json", "delegate", id, "lucilius", "--brief", briefPath, "--dry-run"]);
    expect(r.exitCode).toBe(0);

    const after = await readTask(id);
    expect(after["version"]).toBe(before["version"] as never);
    expect(after["assigned_to"]).toBe(before["assigned_to"] as never);
    expect(after["delegated_from"]).toBeNull();
    expect(existsSync(noticeLog)).toBe(false);

    const shown = await runCli(["--json", "show", id]);
    const comments = (JSON.parse(shown.stdout) as { comments: Array<{ content: string }> }).comments;
    expect(comments.some((c) => c.content.startsWith("[DISPATCH]"))).toBe(false);
  }, SPAWN_BUDGET_MS);
});

// ── The embargo, which must be data and never a hardcoded name ──────────────
describe("delegate — the embargo list is an owner-editable file, not a constant", () => {
  it("REFUSES an embargoed worker", async () => {
    const id = await fileTask("embargoed worker");
    const r = await runCli(
      ["delegate", id, "vespasian", "--brief", briefPath, "--no-post"],
      { TODOS_DELEGATION_EMBARGO_PATH: embargoPath },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/embargo/i);
    expect((await readTask(id))["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);

  it("REFUSES the embargoed agent addressed by its ID, not just by its name", async () => {
    // `resolveValidatedAssignee` accepts an agent ID and returns that agent's
    // NAME, so an embargo checked only against the raw argument is bypassed by
    // spelling the same agent differently. An embargo defeated by a synonym is
    // not an embargo.
    const registered = await runCli(["--json", "init", "vespasian"]);
    expect(registered.exitCode).toBe(0);
    const agentId = (JSON.parse(registered.stdout) as { id?: string; agent?: { id: string } }).agent?.id
      ?? (JSON.parse(registered.stdout) as { id: string }).id;
    expect(agentId).toBeTruthy();

    const id = await fileTask("embargo via agent id");
    const r = await runCli(
      ["delegate", id, agentId!, "--brief", briefPath, "--no-post"],
      { TODOS_DELEGATION_EMBARGO_PATH: embargoPath },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/embargo/i);
    expect((await readTask(id))["delegated_from"]).toBeNull();
  }, SPAWN_BUDGET_MS);

  it("ALLOWS a worker that is not on the list — the embargo must be able to not fire", async () => {
    const id = await fileTask("non-embargoed worker");
    const r = await runCli(
      ["delegate", id, "lucilius", "--brief", briefPath, "--no-post"],
      { TODOS_DELEGATION_EMBARGO_PATH: embargoPath },
    );
    expect(r.exitCode).toBe(0);
  }, SPAWN_BUDGET_MS);

  it("SELF-DISABLES when the embargo file is absent, so a sandboxed run is never stranded", async () => {
    const id = await fileTask("no embargo file");
    const r = await runCli(
      ["delegate", id, "vespasian", "--brief", briefPath, "--no-post"],
      { TODOS_DELEGATION_EMBARGO_PATH: join(testRoot, "absent-embargo.json") },
    );
    expect(r.exitCode).toBe(0);
  }, SPAWN_BUDGET_MS);
});
