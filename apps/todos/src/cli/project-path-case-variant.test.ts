import { describe, it, expect, afterEach, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";
import { findCaseVariantProjectPaths } from "./commands/project-commands.js";

/**
 * Regression coverage for todos task 1dcb9e66 (PROJECT-ROWS-MERGE).
 *
 * The measured root cause of the four duplicate platform-nopen project rows is
 * path-casing drift in project registration: /home/hasna/workspace vs
 * /home/hasna/Workspace vs /Users/hasna/Workspace all minted separate rows
 * because `todos projects --add <path>` matched existing projects by exact
 * string equality only. Registry-wide this is the same shape as the agent-name
 * case-variant guard (task 1170f87b): 132 of 182 duplicate-name groups span
 * machines and 109 have differing paths, all workspace/Workspace casing.
 *
 * The fix mirrors findCaseVariantRows (agent-commands.ts): registration
 * REFUSES to mint a row whose path is an existing row's path under a different
 * letter case, and names the colliding row so the operator converges on one
 * project instead of duplicating.
 */

interface Row {
  id: string;
  path: string;
  name?: string;
}

// Shaped after the four real platform-nopen rows measured 2026-08-27 (todos
// task 1dcb9e66): the canonical row plus two legacy rows share the same
// /home/hasna/workspace path and one legacy row carries the macOS /Users casing.
const ROWS: Row[] = [
  { id: "a5854a09", path: "/home/hasna/workspace/hasnatools/platform/platform-nopen", name: "nopen" },
  { id: "aa46157c", path: "/home/hasna/workspace/hasnatools/platform/platform-nopen", name: "platform-nopen" },
  { id: "bafb23c3", path: "/Users/hasna/Workspace/hasnatools/platform/platform-nopen", name: "platform-nopen" },
];

describe("findCaseVariantProjectPaths", () => {
  it("REFUSES a path that would mint a new case variant", () => {
    const rows = findCaseVariantProjectPaths(ROWS, "/home/hasna/Workspace/hasnatools/platform/platform-nopen");
    expect(rows.map((r) => r.id).sort()).toEqual(["a5854a09", "aa46157c"]);
  });

  it("reports EVERY colliding row, so the message can name them all", () => {
    // The macOS row's path differs by the /Users prefix too, so only the two
    // /home/hasna rows collide with a WORKSPACE-cased registration.
    const rows = findCaseVariantProjectPaths(ROWS, "/home/hasna/WORKSPACE/hasnatools/platform/platform-nopen");
    expect(rows.map((r) => r.id).sort()).toEqual(["a5854a09", "aa46157c"]);
    // A /Users variant of the macOS row collides with bafb23c3 alone.
    const mac = findCaseVariantProjectPaths(ROWS, "/Users/hasna/workspace/hasnatools/platform/platform-nopen");
    expect(mac.map((r) => r.id)).toEqual(["bafb23c3"]);
  });

  it("ALLOWS re-registering the exact existing path — the ordinary restart path", () => {
    expect(findCaseVariantProjectPaths(ROWS, "/home/hasna/workspace/hasnatools/platform/platform-nopen")).toEqual([]);
    expect(findCaseVariantProjectPaths(ROWS, "/Users/hasna/Workspace/hasnatools/platform/platform-nopen")).toEqual([]);
  });

  it("ALLOWS a genuinely different path", () => {
    expect(findCaseVariantProjectPaths(ROWS, "/home/hasna/workspace/hasnatools/platform/platform-todos")).toEqual([]);
    expect(findCaseVariantProjectPaths(ROWS, "/srv/other/repo")).toEqual([]);
  });

  it("treats surrounding whitespace as the same path", () => {
    expect(findCaseVariantProjectPaths(ROWS, "  /home/hasna/Workspace/hasnatools/platform/platform-nopen  ").map((r) => r.id).sort()).toEqual(["a5854a09", "aa46157c"]);
    expect(findCaseVariantProjectPaths(ROWS, "  /home/hasna/workspace/hasnatools/platform/platform-nopen  ")).toEqual([]);
  });

  it("stays out of the way of an empty path", () => {
    expect(findCaseVariantProjectPaths(ROWS, "")).toEqual([]);
    expect(findCaseVariantProjectPaths(ROWS, "   ")).toEqual([]);
  });

  it("returns nothing against an empty project list", () => {
    expect(findCaseVariantProjectPaths([], "/home/hasna/Workspace/repo")).toEqual([]);
  });
});

setDefaultTimeout(30_000);

let testRoot = "";

type CliResult = { stdout: string; stderr: string; exitCode: number };

async function runCli(args: string[], dbPath: string): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env: localRoutingTestEnv({
      HOME: join(testRoot, "home"),
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

describe("todos projects --add path-case-variant guard (CLI)", () => {
  afterEach(() => {
    if (testRoot) rmSync(testRoot, { recursive: true, force: true });
    testRoot = "";
  });

  it("REFUSES to mint a second row for a case-variant path and names the collision", async () => {
    testRoot = mkdtempSync(join(tmpdir(), "todos-proj-case-"));
    mkdirSync(join(testRoot, "home"));
    const dbPath = join(testRoot, "todos.db");
    const repoPath = join(testRoot, "home", "workspace", "alpha-rocket");
    const caseVariant = join(testRoot, "home", "Workspace", "alpha-rocket");

    const first = await runCli(["projects", "--add", repoPath, "--name", "Alpha Rocket"], dbPath);
    expect(first.exitCode).toBe(0);

    // TDD: this is the regression — today the exact-string match misses the
    // case variant and mints a duplicate row with rc=0.
    const second = await runCli(["--json", "projects", "--add", caseVariant, "--name", "Alpha Rocket"], dbPath);
    expect(second.exitCode).not.toBe(0);
    expect(`${second.stdout}\n${second.stderr}`).toContain("case");
    expect(`${second.stdout}\n${second.stderr}`).toContain(repoPath);

    const listed = JSON.parse((await runCli(["--json", "projects"], dbPath)).stdout);
    expect(listed.filter((p: { path: string }) => p.path.toLowerCase() === repoPath.toLowerCase()).length).toBe(1);
  });

  it("ALLOWS re-registering the exact path and genuinely different paths", async () => {
    testRoot = mkdtempSync(join(tmpdir(), "todos-proj-case-ok-"));
    mkdirSync(join(testRoot, "home"));
    const dbPath = join(testRoot, "todos.db");
    const repoPath = join(testRoot, "home", "workspace", "alpha-rocket");

    expect((await runCli(["projects", "--add", repoPath, "--name", "Alpha Rocket"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["projects", "--add", repoPath, "--name", "Alpha Rocket"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["projects", "--add", join(testRoot, "home", "workspace", "beta"), "--name", "Beta"], dbPath)).exitCode).toBe(0);
  });

  it("REFUSES --update --path when the new path case-variants another project's path", async () => {
    testRoot = mkdtempSync(join(tmpdir(), "todos-proj-case-upd-"));
    mkdirSync(join(testRoot, "home"));
    const dbPath = join(testRoot, "todos.db");
    const repoPath = join(testRoot, "home", "workspace", "alpha-rocket");
    const otherPath = join(testRoot, "home", "workspace", "beta");

    const a = JSON.parse((await runCli(["--json", "projects", "--add", repoPath, "--name", "Alpha Rocket"], dbPath)).stdout);
    await runCli(["projects", "--add", otherPath, "--name", "Beta"], dbPath);

    const update = await runCli(["--json", "projects", "--update", a.id, "--path", join(testRoot, "home", "Workspace", "beta")], dbPath);
    expect(update.exitCode).not.toBe(0);
    expect(`${update.stdout}\n${update.stderr}`).toContain("case");

    const shown = JSON.parse((await runCli(["--json", "projects", "--show", a.id], dbPath)).stdout);
    expect(shown.path).toBe(repoPath);
  });
});
