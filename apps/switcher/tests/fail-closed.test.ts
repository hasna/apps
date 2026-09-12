// Fail-closed contract (owner ruling 2026-09-07, hasna/apps#1720): no credential
// means a non-zero exit that names the tiers and the opt-in, never a local store.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCliRuntime, REMOTE_API_CONFIG_MISSING } from "../src/runtime";
import { announceSwitcherLocalMode, hasSwitcherEnvAuthorityIntent, resetSwitcherLocalModeAnnouncement, selectsSwitcherLocalMode } from "../src/lib/local-opt-in";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const mcp = fileURLToPath(new URL("../src/mcp.ts", import.meta.url));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive:true,force:true}); });
async function home() {
  const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace/scratch/switcher-tests");
  await mkdir(scratch, {recursive:true});
  const root = await mkdtemp(join(scratch, "fail-closed-")); roots.push(root); return root;
}
/** Every `*.db*` file under a fixture HOME — the acceptance test's `find "$HOME" -name '*.db*'`. */
async function dbFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, {withFileTypes:true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path); else if (entry.name.includes(".db")) found.push(path);
    }
  }
  await walk(root); return found;
}
async function run(bin: string, args: string[], env: Record<string,string>) {
  const child = Bun.spawn([process.execPath, bin, ...args], {env:{PATH:process.env.PATH!, ...env}, stdin:"ignore", stdout:"pipe", stderr:"pipe"});
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return {code, stdout, stderr};
  } finally { clearTimeout(timer); }
}
const sources = ["hasna.credentials.switcher.api-key", "~/.hasna/switcher/config/credentials", "HASNA_SWITCHER_API_KEY", "HASNA_SWITCHER_LOCAL=1"];

test("nothing configured fails closed: no local store, and the refusal names every tier and the opt-in", async () => {
  const root = await home();
  const env = {HOME: root, HASNA_STATION: "no-such-station"};
  let failure: unknown;
  try { await openCliRuntime(env); } catch (error) { failure = error; }
  expect(failure).toMatchObject({code: REMOTE_API_CONFIG_MISSING});
  for (const source of sources) expect((failure as Error).message).toContain(source);
  expect((failure as Error).message).not.toMatch(/[A-Za-z0-9_-]{32,}/); // names, never a value
  expect(selectsSwitcherLocalMode(env)).toBe(false);
  expect(await dbFiles(root)).toEqual([]);
});

test("the opt-in is answered from the environment, selects the owned local API and announces once", async () => {
  const root = await home();
  const lines: string[] = [];
  resetSwitcherLocalModeAnnouncement();
  announceSwitcherLocalMode(join(root, ".hasna/switcher"), line => lines.push(line));
  announceSwitcherLocalMode(join(root, ".hasna/switcher"), line => lines.push(line));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("switcher: LOCAL mode");
  expect(lines[0]).toContain("HASNA_SWITCHER_LOCAL");
  for (const flag of [{HASNA_SWITCHER_LOCAL: "1"}, {SWITCHER_LOCAL: "yes"}]) {
    expect(selectsSwitcherLocalMode({HOME: root, ...flag})).toBe(true);
  }
  expect(selectsSwitcherLocalMode({HOME: root, HASNA_SWITCHER_LOCAL: "  "})).toBe(false);
  const runtime = await openCliRuntime({HOME: root, HASNA_SWITCHER_LOCAL: "1"});
  try {
    expect(runtime.mode).toBe("local");
    expect((await runtime.client.health()).backend).toBe("sqlite");
  } finally { await runtime.close(); }
  expect(await dbFiles(root)).toContain(join(root, ".hasna/switcher/switcher.db"));
});

test("a configured environment outranks the opt-in, including a half-configured one", async () => {
  const root = await home();
  const remote = await openCliRuntime({HOME: root, HASNA_SWITCHER_LOCAL: "1", HASNA_SWITCHER_API_KEY: "fixture-operator-not-real"});
  try { expect(remote.mode).toBe("remote"); expect(remote.client.baseUrl).toBe("https://api.hasna.com/switcher"); }
  finally { await remote.close(); }
  await expect(openCliRuntime({HOME: root, HASNA_SWITCHER_LOCAL: "1", HASNA_SWITCHER_API_KEY_OVERRIDE: ""})).rejects.toThrow();
  await expect(openCliRuntime({HOME: root, HASNA_SWITCHER_LOCAL: "1", HASNA_SWITCHER_API_URL: "https://switcher.example"})).rejects.toThrow();
  expect(hasSwitcherEnvAuthorityIntent({HOME: root, HASNA_SWITCHER_LOCAL: "1"})).toBe(false);
  expect(hasSwitcherEnvAuthorityIntent({HASNA_PROFILE: "ops"})).toBe(true);
  expect(await dbFiles(root)).toEqual([]);
});

test("the CLI exits 1 with the refusal as its first stderr line and creates nothing; the opt-in runs locally", async () => {
  const root = await home();
  const refused = await run(cli, ["providers", "list"], {HOME: root, HASNA_STATION: "no-such-station"});
  expect(refused.code).toBe(1);
  expect(refused.stdout).toBe("");
  const first = refused.stderr.split("\n")[0]!;
  expect(JSON.parse(first).error.code).toBe(REMOTE_API_CONFIG_MISSING);
  for (const source of sources) expect(first).toContain(source);
  expect(refused.stderr).not.toContain("LOCAL mode");
  expect(await dbFiles(root)).toEqual([]);
  const local = await run(cli, ["providers", "list"], {HOME: root, HASNA_STATION: "no-such-station", HASNA_SWITCHER_LOCAL: "1"});
  expect(local.code, local.stderr).toBe(0);
  expect(JSON.parse(local.stdout)).toMatchObject({total: 0});
  expect(local.stderr.split("\n").filter(line => line.includes("switcher: LOCAL mode"))).toHaveLength(1);
  expect(await dbFiles(root)).toContain(join(root, ".hasna/switcher/switcher.db"));
});

test("switcher-mcp decides its authority before the stdio transport exists", async () => {
  const root = await home();
  const refused = await run(mcp, [], {HOME: root, HASNA_STATION: "no-such-station"});
  expect(refused.code).toBe(1);
  expect(refused.stdout).toBe("");
  expect(refused.stderr.split("\n")[0]).toMatch(/^REMOTE_API_CONFIG_MISSING: /);
  for (const source of sources) expect(refused.stderr).toContain(source);
  expect(await dbFiles(root)).toEqual([]);
  const version = await run(mcp, ["--version"], {HOME: root, HASNA_STATION: "no-such-station"});
  expect(version.code).toBe(0);
  expect(version.stderr).toBe("");
});
