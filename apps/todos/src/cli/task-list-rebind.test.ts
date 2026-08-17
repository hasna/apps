/**
 * Regression: the production task-list layer held 46 lists with `project_id`
 * null (doctor `task_lists_without_project`) and 1 list whose `project_id` was
 * a filesystem path (`task_lists_with_unregistered_project`), while the CLI
 * exposed NO supported path to rebind a list to its registry project. The
 * repair was impossible through the supported surface, so the integrity
 * finding could only be reported, never cleared.
 *
 * This drives the REAL CLI against a throwaway store and asserts the repair
 * contract end to end. The rebind flag is the global `--project` option (the
 * same one `lists --add` scopes with — commander routes a same-named
 * subcommand flag to the parent's opts, so this form is the one that works):
 *   - `--project <ref> lists --update <id>` rebinds the list;
 *   - `--project "" lists --update <id>` unbinds it;
 *   - a nonexistent project ref fails loudly;
 *   - a rebind into a scope that holds the slug fails loudly;
 *   - after rebinding, `todos doctor` reports `task_lists_without_project 0` —
 *     the finding the repair exists to clear.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const CWD = join(import.meta.dir, "../..");

let tmpDir: string;
let dbPath: string;
let fakeHome: string;

setDefaultTimeout(30_000);

interface CliRun { out: string; err: string; code: number }

function run(args: string): CliRun {
  try {
    const out = execSync(`bun run src/cli/index.tsx ${args}`, {
      encoding: "utf-8",
      cwd: CWD,
      timeout: 15000,
      env: localRoutingTestEnv({ HOME: fakeHome, TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" }),
    }).trim();
    return { out, err: "", code: 0 };
  } catch (e) {
    const error = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      out: String(error.stdout ?? "").trim(),
      err: String(error.stderr ?? "").trim(),
      code: error.status ?? 1,
    };
  }
}

function asJson(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todos-list-rebind-"));
  dbPath = join(tmpDir, "test.db");
  fakeHome = join(tmpDir, "home");
  await mkdir(join(fakeHome, ".hasna", "todos"), { recursive: true });
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("todos lists --update --project (task-list rebind)", () => {
  it("rebinds a standalone list to its registry project", () => {
    run(`projects --add ${join(tmpDir, "rebind-target")} --name "Rebind Target" --json`);
    const created = asJson(run("lists --add 'Unbound' --slug unbound --json").out) as { id: string; project_id: string | null };
    expect(created.project_id).toBeNull();

    const updated = asJson(run(`--project rebind-target lists --update ${created.id} --json`).out) as {
      id: string;
      project_id: string | null;
    };
    expect(updated.id).toBe(created.id);
    expect(updated.project_id).not.toBeNull();
  });

  it("clears doctor's task_lists_without_project once every unbound list is rebound", () => {
    // The finding this repair exists to clear: an unbound list makes doctor
    // fail. With the list rebound (previous test), doctor must be clean.
    const doctor = run("doctor");
    expect(doctor.code).toBe(0);
    expect(doctor.out).toContain("task_lists_without_project 0");
  });

  it("unbinds a project-bound list with --project ''", () => {
    const list = asJson(run("lists --add 'Bound' --slug bound --json").out) as { id: string; project_id: string | null };
    run(`--project rebind-target lists --update ${list.id} --json`);
    const cleared = asJson(run(`--project '' lists --update ${list.id} --json`).out) as { id: string; project_id: string | null };
    expect(cleared.project_id).toBeNull();
    // Rebind again so doctor stays clean for the other cases.
    run(`--project rebind-target lists --update ${list.id} --json`);
  });

  it("fails loudly on a rebind to a project that does not exist", () => {
    const list = asJson(run("lists --add 'UnboundTwo' --slug unbound-two --json").out) as { id: string };
    const result = run(`--project no-such-project lists --update ${list.id} --json`);
    expect(result.code).not.toBe(0);
    expect(`${result.out}\n${result.err}`).toMatch(/not found|no-such-project/i);
    // Unchanged by the rejected rebind.
    const after = asJson(run(`lists --show ${list.id} --json`).out) as { project_id: string | null };
    expect(after.project_id).toBeNull();
  });

  it("fails loudly when rebinding into a scope that holds the same slug", () => {
    // `taken-two` first claims the STANDALONE scope.
    const taken = asJson(run("lists --add 'TakenTwo' --slug taken-two --json").out) as { id: string };
    // Rebind moves that claim into the project scope.
    run(`--project rebind-target lists --update ${taken.id} --json`);
    // A new standalone list may legally reuse the slug — different scope.
    const moved = asJson(run("lists --add 'Moved' --slug taken-two --json").out) as { id: string };
    // Moving it into the project scope must collide, not silently shadow.
    const result = run(`--project rebind-target lists --update ${moved.id} --json`);
    expect(result.code).not.toBe(0);
    expect(`${result.out}\n${result.err}`).toMatch(/already exists|conflict/i);
  });
});
