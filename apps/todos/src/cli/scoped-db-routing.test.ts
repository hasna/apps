import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

type CliResult = { stdout: string; stderr: string; exitCode: number };

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runCli(
  args: string[],
  options: { cwd: string; home: string; env?: Record<string, string> },
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "index.tsx"), ...args], {
    cwd: options.cwd,
    env: localRoutingTestEnv({
      HOME: options.home,
      HASNA_TODOS_DB_PATH: "",
      TODOS_DB_PATH: "",
      TODOS_DB_SCOPE: "",
      TODOS_AUTO_PROJECT: "false",
      ...options.env,
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

function fixture(name: string): { root: string; home: string; repo: string; globalDb: string; scopedDb: string } {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  roots.push(root);
  const home = join(root, "home");
  const repo = join(root, "workspace", "project");
  const globalDb = join(home, ".hasna", "todos", "todos.db");
  const scopedDb = join(repo, ".hasna", "todos", "todos.db");
  mkdirSync(join(repo, ".git"), { recursive: true });
  return { root, home, repo, globalDb, scopedDb };
}

describe("scoped database CLI routing", () => {
  it("resolves an explicit --project against the global registry despite an empty scoped database", async () => {
    const { home, repo, globalDb, scopedDb } = fixture("todos-explicit-project-shadow");
    const pinned = { TODOS_DB_PATH: globalDb };

    const registered = await runCli(
      ["projects", "--add", repo, "--name", "Shadowed Project", "--json"],
      { cwd: repo, home, env: pinned },
    );
    expect(registered.exitCode).toBe(0);

    const added = await runCli(
      ["add", "Global registry task", "--project", repo, "--json"],
      { cwd: repo, home, env: pinned },
    );
    expect(added.exitCode).toBe(0);

    mkdirSync(dirname(scopedDb), { recursive: true });
    const initializedShadow = await runCli(["projects", "--json"], {
      cwd: repo,
      home,
      env: { TODOS_DB_PATH: scopedDb },
    });
    expect(initializedShadow.exitCode).toBe(0);
    expect(JSON.parse(initializedShadow.stdout)).toEqual([]);

    const listed = await runCli(
      ["--project", repo, "--json", "list", "--limit", "1", "-a"],
      { cwd: repo, home },
    );
    expect(listed.exitCode).toBe(0);
    expect(listed.stderr).not.toContain("Project not found");
    expect(JSON.parse(listed.stdout).map((task: { title: string }) => task.title)).toEqual([
      "Global registry task",
    ]);
  }, 30_000);

  it("does not auto-create a scoped database for reads or ordinary writes", async () => {
    const { home, repo, scopedDb } = fixture("todos-no-shadow-create");
    const scoped = { TODOS_DB_SCOPE: "project" };

    const listed = await runCli(["--json", "list", "--limit", "1"], {
      cwd: repo,
      home,
      env: scoped,
    });
    expect(listed.exitCode).toBe(0);
    expect(existsSync(scopedDb)).toBe(false);

    const added = await runCli(["add", "Global fallback task", "--json"], {
      cwd: repo,
      home,
      env: scoped,
    });
    expect(added.exitCode).toBe(0);
    expect(existsSync(scopedDb)).toBe(false);

    const bootstrapped = await runCli(["project-bootstrap", ".", "--json"], {
      cwd: repo,
      home,
      env: scoped,
    });
    expect(bootstrapped.exitCode).toBe(0);
    expect(existsSync(scopedDb)).toBe(true);
  }, 30_000);
});
