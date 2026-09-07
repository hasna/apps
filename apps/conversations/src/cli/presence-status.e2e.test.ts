import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
beforeAll(async () => { fixture = await startLoopbackApiFixture(); });
afterAll(async () => { await fixture?.stop(); });
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const HOME_DIR = mkdtempSync(join(tmpdir(), "conversations-presence-home-"));
const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const env={...fixture.env};
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

async function backdatePresence(agent:string, secondsAgo:number) { await fixture.seed({presence:[{agent,last_seen_at:new Date(Date.now()-secondsAgo*1000).toISOString()}]}); }
async function seedSingleTouch(agent:string,daysAgo:number) { const at=new Date(Date.now()-daysAgo*86400000).toISOString(); await fixture.seed({presence:[{id:"st"+agent.slice(0,6),agent,session_id:`sess-${agent}`,role:"agent",project_id:"",status:"online",created_at:at,last_seen_at:at,metadata:null}]}); }

describe("CLI agent presence status staleness (e2e)", () => {
  afterAll(() => {
    try { rmSync(HOME_DIR, { recursive: true, force: true }); } catch {}
  });

  test("agents list reports a self-declared 'online' status only while last_seen_at is fresh", async () => {
    runCli(["agents", "register", "fresh-list-agent", "--session", "sess-fresh", "--json"]);
    runCli(["agents", "register", "stale-list-agent", "--session", "sess-stale", "--json"]);
    await backdatePresence("stale-list-agent", 2 * 60 * 60);

    const listing = runCli(["agents", "list", "-j"]);
    expect(listing.exitCode).toBe(0);
    const rows = JSON.parse(listing.stdout) as Array<Record<string, string | boolean>>;
    const byName = new Map(rows.map((row) => [row.agent, row]));
    expect(byName.get("stale-list-agent")).toMatchObject({ status: "offline", online: false });
    expect(byName.get("fresh-list-agent")).toMatchObject({ status: "online", online: true });
  });

  test("agents reap-stale flags a stale single-touch registration and --apply removes it", async () => {
    await seedSingleTouch("reap-cli-single", 10);
    runCli(["agents", "register", "reap-cli-active", "--session", "sess-active", "--json"]);
    await backdatePresence("reap-cli-active", 10 * 24 * 60 * 60);
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
    const archived = (await fixture.inspect()).presenceArchive.filter(row=>row.agent === "reap-cli-single");
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ agent: "reap-cli-single", session_id: "sess-reap-cli-single", status: "online" });

    const afterApply = runCli(["agents", "list", "-j"]);
    const remaining = JSON.parse(afterApply.stdout) as Array<{ agent: string }>;
    expect(remaining.some((row) => row.agent === "reap-cli-single")).toBe(false);
    expect(remaining.some((row) => row.agent === "reap-cli-active")).toBe(true);
  });
});
