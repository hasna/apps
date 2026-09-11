/**
 * Command-surface census — every command works in ANY transport.
 *
 * The storage-mode axis is retired (owner directive 2026-08-15): there is no
 * mode selector and no transport-conditional command registration. These tests
 * lock the census for the `calendar` CLI:
 *
 *   1. every leaf command renders `--help` with exit 0 BOTH under a hosted
 *      credential env AND under a bare env with no credential — registration
 *      never depends on which transport resolves;
 *   2. the root `--help` lists the complete census;
 *   3. every store-backed domain command completes a full
 *      create → read → update → delete lifecycle through the real HTTPS
 *      client and `/v1` routing backed by the local SQLite store fixture (the
 *      only sanctioned local transport);
 *   4. the embedded events/channels local surface runs with no Calendar
 *      credential at all — its transport never depends on the Calendar
 *      resolver;
 *   5. `agent-update` of a missing agent fails loudly with a non-zero exit
 *      instead of printing a false-green "Agent updated: undefined" (the /v1
 *      404 becomes absence, and absence must never look like success).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";

const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..", "..");

interface SpawnResult { stdout: string; stderr: string; exitCode: number }

/** Spawn CLI with the FULL caller env — used only under the fixture preloads. */
async function runCalendar(args: string[], env: Record<string, string>): Promise<SpawnResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "--preload", "./src/test/cli-domain.preload.ts", "src/cli/index.tsx", ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      ...env,
    },
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

/** Spawn CLI with an explicit env dictionary — nothing inherited from the host. */
async function runCalendarMinimal(args: string[], env: Record<string, string>): Promise<SpawnResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: repoRoot,
    env,
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

/** Commands WITH subcommands (groups), and the leaf commands of each group. */
const GROUPS: Record<string, string[]> = {
  channels: ["add", "list", "status", "remove", "test", "match"],
  events: ["emit", "list", "replay"],
};

/** The flat leaf-command census: every command a user can execute. */
const CENSUS = [
  // orgs
  "org-add", "org-list", "org-show", "org-update", "org-delete",
  // agents
  "init", "agents", "heartbeat", "agent-update", "agent-delete",
  // calendars
  "cal-add", "cal-list", "cal-update", "cal-delete",
  // events
  "add", "list", "show", "update", "delete", "search", "conflicts",
  // attendees
  "attendee-add", "attendee-respond", "attendee-delete",
  // availability
  "availability-set", "availability-show", "availability-delete",
  // memberships
  "member-add", "members", "member-remove", "agent-orgs",
  // status + the legacy local surface
  "status", "db-migrate",
  // groups
  "channels", "events",
];

/** Minimal env with a hosted credential — the hosted-transport world. */
function hostedMinimalEnv(): Record<string, string> {
  return {
    HOME: process.env.HOME ?? "/tmp",
    USER: "calendar-test-fixture",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HASNA_CALENDAR_API_URL: "https://calendar.example.test",
    HASNA_CALENDAR_API_KEY: "fixture-key",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
}

/** Minimal env with NO credential at all — the bare world. */
function bareMinimalEnv(): Record<string, string> {
  const env = hostedMinimalEnv();
  delete env.HASNA_CALENDAR_API_URL;
  delete env.HASNA_CALENDAR_API_KEY;
  return env;
}

async function runWithPool(
  jobs: Array<{ args: string[]; label: string }>,
  env: Record<string, string>,
): Promise<Array<{ label: string; result: SpawnResult }>> {
  const results: Array<{ label: string; result: SpawnResult }> = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const result = await runCalendarMinimal(job.args, env);
      results.push({ label: job.label, result });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  results.sort((a, b) => jobs.findIndex((j) => j.label === a.label) - jobs.findIndex((j) => j.label === b.label));
  return results;
}

test("root --help lists the full command census", async () => {
  const result = await runCalendarMinimal(["--help"], bareMinimalEnv());
  expect(result.exitCode).toBe(0);
  for (const command of CENSUS) {
    expect(result.stdout).toContain(command);
  }
  for (const [group, leaves] of Object.entries(GROUPS)) {
    const groupHelp = await runCalendarMinimal([group, "--help"], bareMinimalEnv());
    expect(groupHelp.exitCode).toBe(0);
    for (const leaf of leaves) expect(groupHelp.stdout).toContain(leaf);
  }
});

test("every command renders --help with a hosted credential env", async () => {
  const jobs = CENSUS.map((command) => ({ label: command, args: [command, "--help"] }));
  const results = await runWithPool(jobs, hostedMinimalEnv());
  for (const { label, result } of results) {
    expect(result.exitCode, `${label} --help under a hosted env`).toBe(0);
  }
});

test("every command renders --help with no credential env", async () => {
  const jobs = CENSUS.map((command) => ({ label: command, args: [command, "--help"] }));
  const results = await runWithPool(jobs, bareMinimalEnv());
  for (const { label, result } of results) {
    expect(result.exitCode, `${label} --help under a bare env`).toBe(0);
  }
});

test("every store-backed command completes its lifecycle on the local transport", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "calendar-census-"));
  const dbPath = join(tempDir, "calendar.db");
  const eventDir = join(tempDir, "events");
  const env = { BUN_TEST: "", CALENDAR_DB_PATH: dbPath, HASNA_EVENTS_DIR: eventDir };
  try {
    // ── orgs ──
    const org = JSON.parse((await runCalendar(["--json", "org-add", "Census Org", "--slug", "census-org"], env)).stdout) as { id: string; name: string };
    expect(org.id).toBeTruthy();
    const orgById = JSON.parse((await runCalendar(["--json", "org-show", org.id], env)).stdout) as { name: string };
    expect(orgById.name).toBe("Census Org");
    const orgBySlug = JSON.parse((await runCalendar(["--json", "org-show", "census-org"], env)).stdout) as { name: string };
    expect(orgBySlug.name).toBe("Census Org");
    const orgUpdated = JSON.parse((await runCalendar(["--json", "org-update", org.id, "--name", "Census Org Updated", "--description", "born in the census"], env)).stdout) as { name: string; description: string };
    expect(orgUpdated).toMatchObject({ name: "Census Org Updated", description: "born in the census" });
    const orgList = JSON.parse((await runCalendar(["--json", "org-list"], env)).stdout) as Array<{ id: string }>;
    expect(orgList.some((o) => o.id === org.id)).toBe(true);

    // ── agents ──
    const agent = JSON.parse((await runCalendar(["--json", "init", "census-agent", "--org", org.id, "--role", "member"], env)).stdout) as { id: string; name: string };
    const agents = JSON.parse((await runCalendar(["--json", "agents"], env)).stdout) as Array<{ name: string }>;
    expect(agents.some((a) => a.name === "census-agent")).toBe(true);
    const heartbeat = JSON.parse((await runCalendar(["--json", "heartbeat", "census-agent"], env)).stdout) as { name: string };
    expect(heartbeat.name).toBe("census-agent");
    const agentUpdated = JSON.parse((await runCalendar(["--json", "agent-update", agent.id, "--role", "service", "--description", "census role"], env)).stdout) as { name: string; role: string };
    expect(agentUpdated).toMatchObject({ name: "census-agent", role: "service" });

    // ── calendars ──
    const cal = JSON.parse((await runCalendar(["--json", "cal-add", "Census Cal", "--org", org.id, "--timezone", "UTC", "--color", "#ff0000"], env)).stdout) as { id: string; name: string };
    const calList = JSON.parse((await runCalendar(["--json", "cal-list", "--org", org.id], env)).stdout) as Array<{ id: string }>;
    expect(calList.some((c) => c.id === cal.id)).toBe(true);
    const calUpdated = JSON.parse((await runCalendar(["--json", "cal-update", cal.id, "--visibility", "public"], env)).stdout) as { name: string; visibility: string };
    expect(calUpdated.visibility).toBe("public");

    // ── events ──
    const event = JSON.parse((await runCalendar([
      "--json", "add", "Census Event", "--calendar", cal.id, "--org", org.id,
      "--start", "2026-10-01T10:00:00Z", "--end", "2026-10-01T11:00:00Z", "--agent", agent.id,
    ], env)).stdout) as { id: string; title: string };
    const list = JSON.parse((await runCalendar(["--json", "list", "--calendar", cal.id], env)).stdout) as Array<{ id: string }>;
    expect(list.some((e) => e.id === event.id)).toBe(true);
    const shown = JSON.parse((await runCalendar(["--json", "show", event.id], env)).stdout) as { event: { title: string }; attendees: unknown[] };
    expect(shown.event.title).toBe("Census Event");
    const search = JSON.parse((await runCalendar(["--json", "search", "Census"], env)).stdout) as Array<{ id: string }>;
    expect(search.some((e) => e.id === event.id)).toBe(true);
    const conflicts = JSON.parse((await runCalendar(["--json", "conflicts", cal.id, "--start", "2026-10-01T10:30:00Z", "--end", "2026-10-01T10:45:00Z"], env)).stdout) as Array<{ id: string }>;
    expect(conflicts.some((e) => e.id === event.id)).toBe(true);
    const updated = JSON.parse((await runCalendar(["--json", "update", event.id, "--title", "Census Event Updated"], env)).stdout) as { title: string };
    expect(updated.title).toBe("Census Event Updated");

    // ── attendees ──
    const attendee = JSON.parse((await runCalendar(["--json", "attendee-add", "--event", event.id, "--name", "Ada Lovelace", "--email", "ada@example.test"], env)).stdout) as { id: string; display_name: string };
    const responded = JSON.parse((await runCalendar(["--json", "attendee-respond", attendee.id, "--status", "accepted", "--comment", "confirmed"], env)).stdout) as { status: string };
    expect(responded.status).toBe("accepted");
    const attendeeDeleted = JSON.parse((await runCalendar(["--json", "attendee-delete", attendee.id], env)).stdout) as { deleted: boolean };
    expect(attendeeDeleted.deleted).toBe(true);

    // ── availability ──
    const availability = JSON.parse((await runCalendar(["--json", "availability-set", "--agent", agent.id, "--org", org.id, "--day", "1", "--start", "09:00", "--end", "17:00"], env)).stdout) as { id: string; day_of_week: number };
    expect(availability.day_of_week).toBe(1);
    const availList = JSON.parse((await runCalendar(["--json", "availability-show", agent.id, "--org", org.id], env)).stdout) as Array<{ id: string }>;
    expect(availList.some((a) => a.id === availability.id)).toBe(true);
    const availDeleted = JSON.parse((await runCalendar(["--json", "availability-delete", availability.id], env)).stdout) as { deleted: boolean };
    expect(availDeleted.deleted).toBe(true);

    // ── memberships ──
    const member = JSON.parse((await runCalendar(["--json", "member-add", "--org", org.id, "--agent", agent.id, "--role", "member"], env)).stdout) as { role: string };
    expect(member.role).toBe("member");
    const members = JSON.parse((await runCalendar(["--json", "members", org.id], env)).stdout) as Array<{ agent_id: string }>;
    expect(members.some((m) => m.agent_id === agent.id)).toBe(true);
    const agentOrgs = JSON.parse((await runCalendar(["--json", "agent-orgs", agent.id], env)).stdout) as Array<{ org_id: string }>;
    expect(agentOrgs.some((m) => m.org_id === org.id)).toBe(true);
    const memberRemoved = JSON.parse((await runCalendar(["--json", "member-remove", agent.id, org.id], env)).stdout) as { removed: boolean };
    expect(memberRemoved.removed).toBe(true);

    // ── teardown deletes ──
    const eventDeleted = JSON.parse((await runCalendar(["--json", "delete", event.id], env)).stdout) as { deleted: boolean };
    expect(eventDeleted.deleted).toBe(true);
    const calDeleted = JSON.parse((await runCalendar(["--json", "cal-delete", cal.id], env)).stdout) as { deleted: boolean };
    expect(calDeleted.deleted).toBe(true);
    const agentDeleted = JSON.parse((await runCalendar(["--json", "agent-delete", agent.id], env)).stdout) as { deleted: boolean };
    expect(agentDeleted.deleted).toBe(true);
    const orgDeleted = JSON.parse((await runCalendar(["--json", "org-delete", org.id], env)).stdout) as { deleted: boolean };
    expect(orgDeleted.deleted).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agent-update of a missing agent fails loudly instead of a false green", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "calendar-census-"));
  const env = { BUN_TEST: "", CALENDAR_DB_PATH: join(tempDir, "calendar.db"), HASNA_EVENTS_DIR: join(tempDir, "events") };
  try {
    const result = await runCalendar(["--json", "agent-update", "missing-agent", "--role", "service"], env);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: "Agent not found" });
    const human = await runCalendar(["agent-update", "missing-agent", "--role", "service"], env);
    expect(human.exitCode).toBe(1);
    expect(human.stdout).toContain("Agent not found");
    expect(human.stdout).not.toContain("Agent updated");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("embedded events/channels local surface runs with no Calendar credential", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "calendar-census-"));
  const env = { ...bareMinimalEnv(), HASNA_EVENTS_DIR: join(tempDir, "events") };
  try {
    const emitted = JSON.parse((await runCalendarMinimal(["--json", "events", "emit", "calendar.census", "--subject", "local surface", "--message", "no credential needed"], env)).stdout) as { event: { id: string } };
    const list = JSON.parse((await runCalendarMinimal(["--json", "events", "list"], env)).stdout) as Array<{ type: string }>;
    expect(list.some((e) => e.type === "calendar.census")).toBe(true);
    const replay = JSON.parse((await runCalendarMinimal(["--json", "events", "replay", "--id", emitted.event.id, "--dry-run"], env)).stdout) as { events: unknown[] };
    expect(replay.events.length).toBeGreaterThan(0);

    const added = JSON.parse((await runCalendarMinimal(["--json", "channels", "add", "/bin/echo", "--transport", "command", "--id", "ch-census", "--type", "calendar.*"], env)).stdout) as { id: string };
    expect(added.id).toBe("ch-census");
    const matched = JSON.parse((await runCalendarMinimal(["--json", "channels", "match", "ch-census", "--type", "calendar.census"], env)).stdout) as { matched: boolean };
    expect(matched.matched).toBe(true);
    const status = JSON.parse((await runCalendarMinimal(["--json", "channels", "status"], env)).stdout) as { dataDir: string };
    expect(status.dataDir).toBe(join(tempDir, "events"));
    const removed = JSON.parse((await runCalendarMinimal(["--json", "channels", "remove", "ch-census"], env)).stdout) as { removed: boolean };
    expect(removed.removed).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});