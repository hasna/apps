import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database as SqliteDatabase } from "bun:sqlite";

const HOME_DIR = mkdtempSync(join(tmpdir(), "conversations-presence-home-"));
const TEST_DB = join(tmpdir(), `conversations-presence-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const env = { ...process.env } as Record<string, string>;
  for (const key of Object.keys(env)) {
    if (key === "CONVERSATIONS_AGENT_ID" || key.startsWith("HASNA_CONVERSATIONS_")) {
      delete env[key];
    }
  }

  env.HOME = HOME_DIR;
  env.USERPROFILE = HOME_DIR;
  env.CONVERSATIONS_DB_PATH = TEST_DB;
  env.FORCE_COLOR = "0";

  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function backdatePresence(agent: string, secondsAgo: number): void {
  const db = new SqliteDatabase(TEST_DB);
  db.prepare(
    "UPDATE agent_presence SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', ?) WHERE agent = ?"
  ).run(`-${secondsAgo} seconds`, agent);
  db.close();
}

function seedSingleTouch(agent: string, daysAgo: number): void {
  const db = new SqliteDatabase(TEST_DB);
  db.prepare(
    `INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
     VALUES (?, ?, ?, 'agent', '', 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now', ?), strftime('%Y-%m-%dT%H:%M:%f', 'now', ?), NULL)`
  ).run("st" + agent.slice(0, 6), agent, `sess-${agent}`, `-${daysAgo} days`, `-${daysAgo} days`);
  db.close();
}

describe("CLI agent presence status staleness (e2e)", () => {
  afterAll(() => {
    try { rmSync(HOME_DIR, { recursive: true, force: true }); } catch {}
    for (const suffix of ["", "-wal", "-shm"]) {
      try { rmSync(`${TEST_DB}${suffix}`, { force: true }); } catch {}
    }
  });

  test("agents list reports a self-declared 'online' status only while last_seen_at is fresh", () => {
    runCli(["agents", "register", "fresh-list-agent", "--session", "sess-fresh", "--json"]);
    runCli(["agents", "register", "stale-list-agent", "--session", "sess-stale", "--json"]);
    backdatePresence("stale-list-agent", 2 * 60 * 60);

    const listing = runCli(["agents", "list", "-j"]);
    expect(listing.exitCode).toBe(0);
    const rows = JSON.parse(listing.stdout) as Array<Record<string, string | boolean>>;
    const byName = new Map(rows.map((row) => [row.agent, row]));
    expect(byName.get("stale-list-agent")).toMatchObject({ status: "offline", online: false });
    expect(byName.get("fresh-list-agent")).toMatchObject({ status: "online", online: true });
  });

  test("agents reap-stale flags a stale single-touch registration and --apply removes it", () => {
    seedSingleTouch("reap-cli-single", 10);
    runCli(["agents", "register", "reap-cli-active", "--session", "sess-active", "--json"]);
    backdatePresence("reap-cli-active", 10 * 24 * 60 * 60);
    // Active again after creation — must never be a candidate.
    runCli(["agents", "heartbeat", "--from", "reap-cli-active", "--status", "online", "--json"]);

    const dry = runCli(["agents", "reap-stale", "-j"]);
    expect(dry.exitCode).toBe(0);
    const dryJson = JSON.parse(dry.stdout);
    expect(dryJson).toMatchObject({ candidates: 1, reaped: 0, agents: ["reap-cli-single"] });

    const afterDry = runCli(["agents", "list", "-j"]);
    expect(JSON.parse(afterDry.stdout).some((row: { agent: string }) => row.agent === "reap-cli-single")).toBe(true);

    const applied = runCli(["agents", "reap-stale", "--apply", "-j"]);
    expect(applied.exitCode).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ candidates: 1, reaped: 1, archived: 1, agents: ["reap-cli-single"] });

    // The removed row is preserved in the append-only archive with its full
    // registration, so the delete has a rollback path.
    const archiveDb = new SqliteDatabase(TEST_DB);
    const archived = archiveDb.prepare(
      "SELECT id, agent, session_id, status FROM agent_presence_reap_archive WHERE agent = ?"
    ).all("reap-cli-single");
    archiveDb.close();
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ agent: "reap-cli-single", session_id: "sess-reap-cli-single", status: "online" });

    const afterApply = runCli(["agents", "list", "-j"]);
    const remaining = JSON.parse(afterApply.stdout) as Array<{ agent: string }>;
    expect(remaining.some((row) => row.agent === "reap-cli-single")).toBe(false);
    expect(remaining.some((row) => row.agent === "reap-cli-active")).toBe(true);
  });
});
