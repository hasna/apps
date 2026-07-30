import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { dbPath } from "../paths.js";
import { drainTodosTaskRoutes } from "./drain.js";

// Integration coverage for the freshness-close path: a route whose PR is
// definitively MERGED/CLOSED must not just skip (0.4.10 behavior, which left the
// task pending + auto:route and re-skipped it every tick) — the drain must close
// the source todos task so it leaves the queue. The close pathway shells out to
// `todos`, so tests install a deterministic fixture CLI on PATH instead of
// depending on the workstation's installed Todos release.

function installFakeTodosBin(root: string): string {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const todosBin = join(binDir, "todos");
  writeFileSync(todosBin, `#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const rawArgs = process.argv.slice(2);
let project = "";
let json = false;
const args = [];
for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (arg === "--project") project = rawArgs[++index] || "";
  else if (arg === "--json") json = true;
  else args.push(arg);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function dbFile(targetProject = project) {
  if (!targetProject) return undefined;
  const dir = join(targetProject, ".fake-todos");
  mkdirSync(dir, { recursive: true });
  return join(dir, "tasks.json");
}

function defaultDb(targetProject = project) {
  const listId = valueAfter("--task-list-id") || "default";
  const name = valueAfter("--name") || basename(targetProject || "default");
  return { seq: 0, lists: [{ id: listId, slug: listId, name }], tasks: [] };
}

function readDb(targetProject = project) {
  const file = dbFile(targetProject);
  if (!file) return defaultDb(targetProject);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return defaultDb(targetProject);
  }
}

function writeDb(db, targetProject = project) {
  const file = dbFile(targetProject);
  if (!file) return;
  writeFileSync(file, JSON.stringify(db), "utf8");
}

function print(value) {
  process.stdout.write(json ? JSON.stringify(value) : typeof value === "string" ? value : JSON.stringify(value));
}

function tagsFrom(value) {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function taskId() {
  return args.find((arg) => /^task-/.test(arg)) || args[1];
}

if (args[0] === "--version") {
  print("fake-todos 0.0.0\\n");
  process.exit(0);
}

if (args[0] === "projects") {
  if (args.includes("--add")) {
    const target = args[args.indexOf("--add") + 1];
    const db = defaultDb(target);
    writeDb(db, target);
    print({ ok: true, path: target });
    process.exit(0);
  }
  if (args.includes("--deregister")) {
    print({ ok: true });
    process.exit(0);
  }
  print([]);
  process.exit(0);
}

const db = readDb();
if (args[0] === "task-lists") {
  print(db.lists);
  process.exit(0);
}

if (args[0] === "add") {
  const title = args[1] || "Task";
  const description = valueAfter("-d") || valueAfter("--description") || "";
  const tagValue = valueAfter("-t") || valueAfter("--tag") || "";
  const listId = valueAfter("--list") || db.lists[0]?.id || "default";
  const id = "task-" + String((db.seq || 0) + 1).padStart(4, "0");
  db.seq = (db.seq || 0) + 1;
  const task = {
    id,
    title,
    description,
    status: "pending",
    tags: tagsFrom(tagValue),
    comments: [],
    task_list_id: listId,
    taskListId: listId,
    task_list: { id: listId, slug: listId, name: listId },
  };
  db.tasks.push(task);
  writeDb(db);
  print(task);
  process.exit(0);
}

const id = taskId();
const task = db.tasks.find((entry) => entry.id === id);
if ((args[0] === "show" || args[0] === "inspect") && task) {
  print(task);
  process.exit(0);
}
if (args[0] === "ready") {
  const rawLimit = Number(valueAfter("--limit") || db.tasks.length);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0 ? rawLimit : db.tasks.length;
  print(db.tasks.filter((entry) => entry.status === "pending").slice(0, limit));
  process.exit(0);
}
if (args[0] === "done" && task) {
  task.status = "completed";
  writeDb(db);
  print(task);
  process.exit(0);
}
if (args[0] === "tag" && task) {
  const tag = args[2];
  if (tag && !task.tags.includes(tag)) task.tags.push(tag);
  writeDb(db);
  print(task);
  process.exit(0);
}
if (args[0] === "untag" && task) {
  const tag = args[2];
  task.tags = task.tags.filter((entry) => entry !== tag);
  writeDb(db);
  print(task);
  process.exit(0);
}
if (args[0] === "comment" && task) {
  task.comments.push({ content: args.slice(2).join(" "), created_at: new Date().toISOString() });
  writeDb(db);
  print({ ok: true });
  process.exit(0);
}
if (args[0] === "delete") {
  const next = { ...db, tasks: db.tasks.filter((entry) => entry.id !== id) };
  writeDb(next);
  print({ ok: true });
  process.exit(0);
}

console.error("unsupported fake todos command: " + rawArgs.join(" "));
process.exit(2);
`);
  chmodSync(todosBin, 0o755);
  return binDir;
}

const TODOS_INTEGRATION_TIMEOUT_MS = 15_000;

const BASE_OPTS = {
  tags: "auto:route",
  template: "task-lifecycle",
  provider: "codewith",
  sandbox: "workspace-write",
  worktreeMode: "auto",
  maxDispatch: "1",
} as const;

// Merge intent + baked-in MERGED state => the freshness gate fires from evidence
// text with no `gh` probe (hermetic, deterministic).
const MERGED_PR_DESCRIPTION = "please merge https://github.com/hasna/example/pull/7 pr_state=MERGED";

/**
 * Environment keys that point the Todos CLI/SDK at a SHARED store. A test that
 * inherits any of them writes into production.
 *
 * This is not hypothetical. Between 2026-07-05 and 2026-07-15 this very describe
 * block leaked 943 `Merge the release PR` rows into the shared hosted store,
 * under a project id of `/tmp/loops-drain-src-XXXXXX` — the temp
 * directory registered below. Every fleet shell exports HASNA_TODOS_API_URL and
 * HASNA_TODOS_API_KEY, and `{ ...process.env }` carried them into every child.
 *
 * The fake `todos` binary installed on PATH stops the bleeding, but PATH shadowing
 * is a single point of failure: an absolute invocation, a shell that resets PATH,
 * or a code path that reaches the SDK in-process all bypass it. Blanking the
 * routing credentials means the child physically cannot reach the shared store,
 * so the two defenses fail independently.
 *
 * Kept as a named local fixture rather than imported from @hasna/todos because the
 * helper there (`localRoutingTestEnv`) lives inside a *.test.ts file and is not part
 * of the published package; promoting it is tracked separately.
 */
const SHARED_TODOS_STORE_ENV_KEYS = [
  "HASNA_TODOS_API_URL",
  "HASNA_TODOS_API_KEY",
  "HASNA_TODOS_DATABASE_URL",
  "TODOS_API_URL",
  "TODOS_API_KEY",
] as const;

/** process.env with every shared-store pointer blanked and storage pinned local. */
function scrubbedTodosEnv(dbPathOverride: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SHARED_TODOS_STORE_ENV_KEYS) env[key] = "";
  env.HASNA_TODOS_STORAGE_MODE = "local";
  env.TODOS_STORAGE_MODE = "local";
  env.HASNA_TODOS_DB_PATH = dbPathOverride;
  env.TODOS_DB_PATH = dbPathOverride;
  return env;
}

describe.serial("drainTodosTaskRoutes freshness close", () => {
  let todosProject: string;
  let taskListId: string;
  let dataDir: string;
  let oldDataDir: string | undefined;
  let oldPath: string | undefined;
  let fakeTodosRoot: string;
  let createdTaskIds: string[];

  function todosEnv(): NodeJS.ProcessEnv {
    return scrubbedTodosEnv(join(fakeTodosRoot, "todos.db"));
  }

  beforeEach(() => {
    fakeTodosRoot = mkdtempSync(join(tmpdir(), "loops-fake-todos-"));
    oldPath = process.env.PATH;
    process.env.PATH = `${installFakeTodosBin(fakeTodosRoot)}${oldPath ? `:${oldPath}` : ""}`;
    todosProject = mkdtempSync(join(tmpdir(), "loops-drain-src-"));
    taskListId = `todos-${basename(todosProject).toLowerCase()}`;
    const registered = spawnSync(
      "todos",
      ["projects", "--add", todosProject, "--name", basename(todosProject), "--task-list-id", taskListId],
      { encoding: "utf8", timeout: 30_000, env: todosEnv() },
    );
    if (registered.status !== 0) throw new Error(`todos project registration failed: ${registered.stderr}`);
    dataDir = mkdtempSync(join(tmpdir(), "loops-drain-data-"));
    oldDataDir = process.env.LOOPS_DATA_DIR;
    process.env.LOOPS_DATA_DIR = dataDir;
    createdTaskIds = [];
  });

  afterEach(() => {
    if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
    else process.env.LOOPS_DATA_DIR = oldDataDir;
    for (const taskId of createdTaskIds) {
      spawnSync("todos", ["--project", todosProject, "delete", taskId], { encoding: "utf8", timeout: 30_000, env: todosEnv() });
    }
    spawnSync("todos", ["projects", "--deregister", todosProject, "--path-prefix", tmpdir()], { encoding: "utf8", timeout: 30_000, env: todosEnv() });
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(todosProject, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(fakeTodosRoot, { recursive: true, force: true });
  });

  function addTask(description: string, tags = "auto:route"): string {
    const result = spawnSync(
      "todos",
      ["--project", todosProject, "--json", "add", "Merge the release PR", "-d", description, "-t", tags, "--list", taskListId],
      { encoding: "utf8", timeout: 30_000, env: todosEnv() },
    );
    if (result.status !== 0) throw new Error(`todos add failed: ${result.stderr}`);
    const id = JSON.parse(result.stdout).id as string;
    createdTaskIds.push(id);
    return id;
  }

  function taskState(id: string): { status: string; tags: string[] } {
    const result = spawnSync("todos", ["--project", todosProject, "--json", "show", id], { encoding: "utf8", timeout: 30_000, env: todosEnv() });
    const task = JSON.parse(result.stdout);
    return { status: task.status, tags: task.tags ?? [] };
  }

  function completeTask(id: string): void {
    const result = spawnSync(
      "todos",
      ["--project", todosProject, "done", id, "--notes", "launch gate blocker resolved for test"],
      { encoding: "utf8", timeout: 30_000, env: todosEnv() },
    );
    if (result.status !== 0) throw new Error(`todos done failed: ${result.stderr}`);
  }

  function readyCount(): number {
    const result = spawnSync("todos", ["--project", todosProject, "--json", "ready", "--limit", "20"], { encoding: "utf8", timeout: 30_000, env: todosEnv() });
    return (JSON.parse(result.stdout || "[]") as unknown[]).length;
  }

  // Regression for the 943 `Merge the release PR` rows this block leaked into the
  // live hosted store between 2026-07-05 and 2026-07-15. Two independent defenses
  // must hold: the fake `todos` on PATH, and an env that cannot reach a shared store.
  test("never hands a child process a pointer to a shared todos store", () => {
    const env = todosEnv();
    for (const key of SHARED_TODOS_STORE_ENV_KEYS) {
      expect(env[key] ?? "").toBe("");
    }
    expect(env.HASNA_TODOS_STORAGE_MODE).toBe("local");
    expect(env.HASNA_TODOS_DB_PATH).toStartWith(tmpdir());

    // And PATH still resolves `todos` to the hermetic fixture, not the real CLI.
    const which = spawnSync("sh", ["-c", "command -v todos"], { encoding: "utf8", env, timeout: 10_000 });
    expect((which.stdout || "").trim()).toBe(join(fakeTodosRoot, "bin", "todos"));
  });

  test("closes a merged-PR task out of the queue instead of re-skipping it", () => {
    const taskId = addTask(MERGED_PR_DESCRIPTION);
    expect(readyCount()).toBe(1);

    const result = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject });

    expect(result.value.created).toBe(0);
    expect(result.value.freshnessClosed).toBe(1);
    const r0 = (result.value.results as Array<Record<string, unknown>>)[0]!;
    expect(r0.kind).toBe("skipped");
    expect(r0.freshnessSkip).toBe(true);
    expect(r0.prState).toBe("MERGED");
    expect((r0.sourceTaskUpdate as { action?: string }).action).toBe("freshness-close");

    // Regression: the task left the routable queue — marked done and untagged.
    const after = taskState(taskId);
    expect(after.status).toBe("completed");
    expect(after.tags).not.toContain("auto:route");
    expect(readyCount()).toBe(0);
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test("dry-run never mutates the source task", () => {
    const taskId = addTask(MERGED_PR_DESCRIPTION);

    const result = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject, dryRun: true });

    expect(result.value.freshnessClosed).toBe(0);
    const after = taskState(taskId);
    expect(after.status).toBe("pending");
    expect(after.tags).toContain("auto:route");
    expect(readyCount()).toBe(1);
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test("launch gate blocks a drain before route work is created", () => {
    const blockerId = addTask("PA-19 blocker remains open", "controlled-launch");
    const candidateId = addTask("Route candidate that must wait for the launch gate");

    const result = drainTodosTaskRoutes({
      ...BASE_OPTS,
      todosProject,
      launchGate: "pa19-controlled-launch",
      launchGateBlocker: [`${todosProject}::${blockerId}`],
    });

    expect(result.value.created).toBe(0);
    expect(result.value.blocked).toBe(1);
    expect(result.value.considered).toBe(0);
    expect(result.value.scanned).toBe(0);
    expect(existsSync(join(dataDir, "loops.db"))).toBe(false);
    const gate = result.value.launchGate as { blocked?: boolean; blockers?: Array<{ taskId?: string; status?: string; resolved?: boolean }> };
    expect(gate.blocked).toBe(true);
    expect(gate.blockers?.[0]).toMatchObject({ taskId: blockerId, status: "pending", resolved: false });

    expect(taskState(blockerId).status).toBe("pending");
    const candidate = taskState(candidateId);
    expect(candidate.status).toBe("pending");
    expect(candidate.tags).toContain("auto:route");
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test("launch gate dry-run is non-mutating", () => {
    const blockerId = addTask("PA-19 blocker remains open", "controlled-launch");
    const candidateId = addTask("Route candidate that must wait for the launch gate");

    const result = drainTodosTaskRoutes({
      ...BASE_OPTS,
      todosProject,
      dryRun: true,
      launchGate: "pa19-controlled-launch",
      launchGateBlocker: [`${todosProject}::${blockerId}`],
    });

    expect(result.value.created).toBe(0);
    expect(result.value.blocked).toBe(1);
    expect(result.value.dryRun).toBe(true);
    expect(taskState(blockerId).status).toBe("pending");
    const candidate = taskState(candidateId);
    expect(candidate.status).toBe("pending");
    expect(candidate.tags).toContain("auto:route");
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test("launch gate opens when blockers are completed", () => {
    const blockerId = addTask("PA-19 blocker resolved", "controlled-launch");
    completeTask(blockerId);
    const candidateId = addTask("Route candidate that may run once the launch gate opens");

    const result = drainTodosTaskRoutes({
      ...BASE_OPTS,
      todosProject,
      dryRun: true,
      launchGate: "pa19-controlled-launch",
      launchGateBlocker: [`${todosProject}::${blockerId}`],
    });

    expect(result.value.created).toBe(1);
    expect(result.value.blocked).toBe(0);
    expect(result.value.considered).toBe(1);
    const gate = result.value.launchGate as { blocked?: boolean; blockers?: Array<{ taskId?: string; status?: string; resolved?: boolean }> };
    expect(gate.blocked).toBe(false);
    expect(gate.blockers?.[0]).toMatchObject({ taskId: blockerId, status: "completed", resolved: true });
    const routed = (result.value.results as Array<Record<string, unknown>>)[0]!;
    expect(routed.kind).toBe("created");
    expect(taskState(candidateId).status).toBe("pending");
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test("holds route-disallowed tasks out of the candidate window", () => {
    // A no-auto task can never route; before the fix it occupied one of the
    // bounded candidate rows every tick (rejected by eligibility only AFTER
    // taking the slot), so enough marked tasks starved the window forever.
    const markedId = addTask("Marked non-routeable earlier", "auto:route,no-auto");
    const routableId = addTask(MERGED_PR_DESCRIPTION);
    expect(readyCount()).toBe(2);

    const result = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject });

    // The no-auto task is excluded BEFORE the candidate slice (counted), so the
    // routable task gets the window; no slot burns on an eligibility skip.
    expect(result.value.excludedDisallowedTag).toBe(1);
    expect(result.value.candidates).toBe(1);
    expect(result.value.considered).toBe(1);
    expect(result.human).toContain("excludedDisallowedTag=1");
    const ids = (result.value.results as Array<Record<string, unknown>>).map((entry) => entry.taskId);
    expect(ids).toEqual([routableId]);
    expect(ids).not.toContain(markedId);

    // The excluded task is untouched at the source (the memory only affects the window).
    expect(taskState(markedId).status).toBe("pending");
    expect(taskState(markedId).tags).toContain("no-auto");
  }, TODOS_INTEGRATION_TIMEOUT_MS);

  test("reports a redispatch-cap dead-letter instead of a silent created=0", () => {
    const taskId = addTask("Worker keeps finishing without closing this task");
    // First drain admits the work item (attempts=1).
    const first = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject });
    expect(first.value.created).toBe(1);
    expect(first.value.deadLettered).toBe(0);

    // Simulate 8 prior runs that finished terminal without closing the task,
    // backdated past the backoff window — the redispatch cap is now reached.
    const db = new Database(dbPath());
    try {
      const backdated = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      db.query("UPDATE workflow_work_items SET status='failed', attempts=8, updated_at=? WHERE route_key='todos-task'").run(backdated);
    } finally {
      db.close();
    }

    // Next drain: no new dispatch, but the cap is now VISIBLE (not a silent hole).
    const second = drainTodosTaskRoutes({ ...BASE_OPTS, todosProject });
    expect(second.value.created).toBe(0);
    expect(second.value.deduped).toBe(1);
    expect(second.value.deadLettered).toBe(1);
    expect(second.human).toContain("deadLettered=1");
    const dl = (second.value.results as Array<Record<string, unknown>>)[0]!;
    expect(dl.kind).toBe("deduped");
    expect(dl.deadLettered).toBe(true);

    // The task is still actionable (pending), but its work item is now dead_letter.
    expect(taskState(taskId).status).toBe("pending");
    const after = new Database(dbPath());
    try {
      const row = after.query<{ status: string }, []>("SELECT status FROM workflow_work_items WHERE route_key='todos-task' LIMIT 1").get();
      expect(row?.status).toBe("dead_letter");
    } finally {
      after.close();
    }
  }, TODOS_INTEGRATION_TIMEOUT_MS);
});
