import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const CWD = join(import.meta.dir, "../..");

let tmpDir: string;
let dbPath: string;
let fakeHome: string;

function run(args: string): string {
  return execSync(
    `HOME=${fakeHome} TODOS_DB_PATH=${dbPath} TODOS_AUTO_PROJECT=false bun run src/cli/index.tsx ${args}`,
    { encoding: "utf-8", cwd: CWD, timeout: 15000 },
  ).trim();
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todos-cli-qol-"));
  dbPath = join(tmpDir, "test.db");
  fakeHome = join(tmpDir, "home");
  await mkdir(join(fakeHome, ".hasna", "todos"), { recursive: true });
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("CLI QoL commands", () => {
  it("config --set writes to ~/.hasna/todos/config.json", () => {
    run("config --set cli_path_test=true");

    const newConfigPath = join(fakeHome, ".hasna", "todos", "config.json");
    const legacyConfigPath = join(fakeHome, ".todos", "config.json");
    const config = JSON.parse(readFileSync(newConfigPath, "utf-8"));

    expect(config.cli_path_test).toBe(true);
    expect(existsSync(legacyConfigPath)).toBe(false);
  });

  // ── count ──────────────────────────────────────────────────────

  it("count should return stats text", () => {
    const out = run("count");
    expect(out).toContain("total:");
    expect(out).toContain("pending:");
    expect(out).toContain("completed:");
  });

  it("count --json should return JSON stats", () => {
    // Seed a task so we have something to count
    run("add 'Count test task' --json");

    const out = run("--json count");
    const stats = JSON.parse(out);
    expect(stats).toHaveProperty("total");
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats).toHaveProperty("pending");
  });

  // ── bulk done ──────────────────────────────────────────────────

  it("bulk done should complete multiple tasks", () => {
    const t1 = JSON.parse(run("add 'Bulk done 1' --json"));
    const t2 = JSON.parse(run("add 'Bulk done 2' --json"));

    // Tasks must be in_progress before completing
    run(`--json bulk start ${t1.id} ${t2.id}`);

    const out = run(`--json bulk done ${t1.id} ${t2.id}`);
    const result = JSON.parse(out);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].success).toBe(true);
    expect(result.results[1].success).toBe(true);

    // Verify tasks are completed
    const task1 = JSON.parse(run(`--json show ${t1.id}`));
    expect(task1.status).toBe("completed");
    const task2 = JSON.parse(run(`--json show ${t2.id}`));
    expect(task2.status).toBe("completed");
  });

  // ── bulk start ─────────────────────────────────────────────────

  it("bulk start should start a task", () => {
    const t = JSON.parse(run("add 'Bulk start task' --json"));

    const out = run(`--json bulk start ${t.id}`);
    const result = JSON.parse(out);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    const task = JSON.parse(run(`--json show ${t.id}`));
    expect(task.status).toBe("in_progress");
  });

  // ── bulk delete ────────────────────────────────────────────────

  it("bulk delete should delete a task", () => {
    const t = JSON.parse(run("add 'Bulk delete task' --json"));

    const out = run(`--json bulk delete ${t.id}`);
    const result = JSON.parse(out);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    // Verify task no longer exists
    expect(() => run(`--json show ${t.id}`)).toThrow();
  });

  // ── bulk with invalid id ───────────────────────────────────────

  it("bulk done should fail for invalid ids", () => {
    // resolveTaskId calls process.exit(1) for unresolvable IDs,
    // so the subprocess exits non-zero and execSync throws
    let thrown = false;
    let errorOutput = "";
    try {
      run("--json bulk done nonexistent-id-12345678");
    } catch (e: any) {
      thrown = true;
      errorOutput = e.stderr?.toString() || e.message || "";
    }
    expect(thrown).toBe(true);
    expect(errorOutput).toContain("Could not resolve task ID");
  });

  // ── plan moves ─────────────────────────────────────────────────

  it("update --plan should move a task between plans", () => {
    const planA = JSON.parse(run("--json plans --add 'CLI QoL Plan A'"));
    const planB = JSON.parse(run("--json plans --add 'CLI QoL Plan B'"));
    const task = JSON.parse(run(`add 'Move between plans' --plan ${planA.id} --json`));
    expect(task.plan_id).toBe(planA.id);

    const updated = JSON.parse(run(`--json update ${task.id} --plan ${planB.id}`));
    expect(updated.plan_id).toBe(planB.id);

    const shown = JSON.parse(run(`--json show ${task.id}`));
    expect(shown.plan_id).toBe(planB.id);
  });

  it("update --clear-plan should remove a task from its plan", () => {
    const plan = JSON.parse(run("--json plans --add 'CLI QoL Clear Plan'"));
    const task = JSON.parse(run(`add 'Clear plan assignment' --plan ${plan.id} --json`));

    const updated = JSON.parse(run(`--json update ${task.id} --clear-plan`));
    expect(updated.plan_id).toBeNull();

    const shown = JSON.parse(run(`--json show ${task.id}`));
    expect(shown.plan_id).toBeNull();
  });

  it("bulk plan should move multiple tasks into a plan", () => {
    const plan = JSON.parse(run("--json plans --add 'CLI QoL Bulk Plan'"));
    const t1 = JSON.parse(run("add 'Bulk plan task 1' --json"));
    const t2 = JSON.parse(run("add 'Bulk plan task 2' --json"));

    const out = run(`--json bulk plan --plan ${plan.id} ${t1.id} ${t2.id}`);
    const result = JSON.parse(out);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);

    const task1 = JSON.parse(run(`--json show ${t1.id}`));
    const task2 = JSON.parse(run(`--json show ${t2.id}`));
    expect(task1.plan_id).toBe(plan.id);
    expect(task2.plan_id).toBe(plan.id);
  });

  it("bulk plan --clear-plan should clear multiple task plan assignments", () => {
    const plan = JSON.parse(run("--json plans --add 'CLI QoL Bulk Clear Plan'"));
    const t1 = JSON.parse(run(`add 'Bulk clear plan task 1' --plan ${plan.id} --json`));
    const t2 = JSON.parse(run(`add 'Bulk clear plan task 2' --plan ${plan.id} --json`));

    const out = run(`--json bulk plan --clear-plan ${t1.id} ${t2.id}`);
    const result = JSON.parse(out);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);

    const task1 = JSON.parse(run(`--json show ${t1.id}`));
    const task2 = JSON.parse(run(`--json show ${t2.id}`));
    expect(task1.plan_id).toBeNull();
    expect(task2.plan_id).toBeNull();
  });

  // ── list --sort updated ────────────────────────────────────────

  it("list --sort updated should return tasks sorted by update time", () => {
    const t1 = JSON.parse(run("add 'Sort task alpha' --json"));
    const t2 = JSON.parse(run("add 'Sort task beta' --json"));
    // Update t1 to make it more recently updated
    run(`update ${t1.id} --title 'Sort task alpha updated'`);

    const out = run("--json list --all --sort updated");
    const tasks = JSON.parse(out);

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(2);

    // Most recently updated should come first
    const idx1 = tasks.findIndex((t: any) => t.id === t1.id);
    const idx2 = tasks.findIndex((t: any) => t.id === t2.id);
    // t1 was updated more recently, so it should appear before t2
    expect(idx1).toBeLessThan(idx2);
  });

  // ── list --project-name ────────────────────────────────────────

  it("list --project-name should filter by project name", () => {
    // Create a project with a path (projects --add takes a path, --name sets the name)
    const projPath = join(tmpDir, "qol-test-project");
    const proj = JSON.parse(run(`--json projects --add ${projPath} --name 'QoL Test Project'`));

    // Add a task scoped to that project via --project <path>
    const t = JSON.parse(run(`add 'Project scoped task' --project ${projPath} --json`));
    expect(t.project_id).toBe(proj.id);

    const out = run("--json list --project-name 'QoL Test'");
    const tasks = JSON.parse(out);

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    // All returned tasks belong to the project
    for (const task of tasks) {
      expect(task.project_id).toBe(proj.id);
    }
  });

  it("project-panel --json should emit a project panel contract", () => {
    const projPath = join(tmpDir, "panel-project");
    const proj = JSON.parse(run(`--json projects --add ${projPath} --name 'Panel Project'`));
    run(`add 'Panel project task' --project ${proj.id} --json`);

    const panel = JSON.parse(run(`project-panel --project ${proj.id} --json --contract`));

    expect(panel.schema).toBe("hasna.project_panel.v1");
    expect(panel.projectId).toBe("panel-project");
    expect(panel.provider.kind).toBe("todos");
    expect(panel.metrics.some((metric: any) => metric.id === "total_tasks" && metric.value === 1)).toBe(true);
  });

  it("projects --deregister refuses projects with incomplete tasks", () => {
    const projPath = join(tmpDir, "deregister-open-project");
    const proj = JSON.parse(run(`--json projects --add ${projPath} --name 'Deregister Open Project'`));
    run(`add 'Still open' --project ${proj.id} --json`);

    expect(() => run(`--json projects --deregister ${proj.id} --path-prefix ${tmpDir}`)).toThrow();

    const projects = JSON.parse(run("--json projects"));
    expect(projects.some((p: any) => p.id === proj.id)).toBe(true);
  });

  it("projects --deregister path-prefix guard is directory-aware", () => {
    const prefix = join(tmpDir, "deregister-prefix");
    const siblingPath = `${prefix}-sibling`;
    const proj = JSON.parse(run(`--json projects --add ${siblingPath} --name 'Deregister Sibling Project'`));

    expect(() => run(`--json projects --deregister ${proj.id} --path-prefix ${prefix}`)).toThrow();

    const projects = JSON.parse(run("--json projects"));
    expect(projects.some((p: any) => p.id === proj.id)).toBe(true);
  });

  it("projects --deregister preserves completed tasks", () => {
    const projPath = join(tmpDir, "deregister-complete-project");
    const proj = JSON.parse(run(`--json projects --add ${projPath} --name 'Deregister Complete Project'`));
    const task = JSON.parse(run(`add 'Already complete' --project ${proj.id} --status completed --json`));

    const result = JSON.parse(run(`--json projects --deregister ${proj.id} --path-prefix ${tmpDir}`));
    expect(result).toMatchObject({
      action: "deregistered",
      project_id: proj.id,
      incomplete_tasks: 0,
      tasks_preserved: true,
    });

    const projects = JSON.parse(run("--json projects"));
    expect(projects.some((p: any) => p.id === proj.id)).toBe(false);

    const preserved = JSON.parse(run(`--json show ${task.id}`));
    expect(preserved.id).toBe(task.id);
    expect(preserved.project_id).toBeNull();
  });

  it("auto project detection does not register temp git worktrees", async () => {
    const repo = join(tmpDir, "auto-project-temp-worktree");
    await mkdir(repo, { recursive: true });
    execSync("git init -q", { cwd: repo });

    const before = JSON.parse(run("--json projects"));
    const out = execSync(
      `HOME=${fakeHome} TODOS_DB_PATH=${dbPath} TODOS_AUTO_PROJECT=true bun run ${join(CWD, "src/cli/index.tsx")} --json add 'Temp worktree task'`,
      { encoding: "utf-8", cwd: repo, timeout: 15000 },
    ).trim();
    const task = JSON.parse(out);
    const after = JSON.parse(run("--json projects"));

    expect(task.project_id).toBeNull();
    expect(after).toHaveLength(before.length);
    expect(after.some((p: any) => p.path === repo)).toBe(false);
  });

  it("auto project detection still registers non-temp git worktrees", async () => {
    const repo = await mkdtemp(join(CWD, ".tmp-auto-project-"));
    try {
      execSync("git init -q", { cwd: repo });

      const out = execSync(
        `HOME=${fakeHome} TODOS_DB_PATH=${dbPath} TODOS_AUTO_PROJECT=true bun run ${join(CWD, "src/cli/index.tsx")} --json add 'Non-temp worktree task'`,
        { encoding: "utf-8", cwd: repo, timeout: 15000 },
      ).trim();
      const task = JSON.parse(out);
      const projects = JSON.parse(run("--json projects"));

      expect(task.project_id).toBeTruthy();
      expect(projects.some((p: any) => p.id === task.project_id && p.path === repo)).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  // ── list --agent-name ──────────────────────────────────────────

  it("list --agent-name should filter by assigned agent name", () => {
    const t = JSON.parse(run("add 'Agent task' --assign 'test-agent-qol' --json"));

    const out = run("--json list --agent-name test-agent-qol");
    const tasks = JSON.parse(out);

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const found = tasks.find((task: any) => task.id === t.id);
    expect(found).toBeTruthy();
    expect(found.assigned_to).toBe("test-agent-qol");
  });

  it("list --assigned should include tasks from other projects when project is only auto-detected", async () => {
    const repoA = join(tmpDir, "auto-project-a");
    const repoB = join(tmpDir, "auto-project-b");
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });
    execSync("git init -q", { cwd: repoA });
    execSync("git init -q", { cwd: repoB });

    const created = JSON.parse(run(`add 'Cross-project assigned task' --assign cross-agent --project ${repoB} --json`));
    expect(created.assigned_to).toBe("cross-agent");

    const out = execSync(
      `HOME=${fakeHome} TODOS_DB_PATH=${dbPath} TODOS_AUTO_PROJECT=true bun run ${join(CWD, "src/cli/index.tsx")} --json list --assigned cross-agent`,
      { encoding: "utf-8", cwd: repoA, timeout: 15000 },
    ).trim();
    const tasks = JSON.parse(out);

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.some((task: any) => task.id === created.id)).toBe(true);
  });


  it("mine should include tasks from other projects when project is only auto-detected", async () => {
    const repoA = join(tmpDir, "mine-auto-project-a");
    const repoB = join(tmpDir, "mine-auto-project-b");
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });
    execSync("git init -q", { cwd: repoA });
    execSync("git init -q", { cwd: repoB });

    const created = JSON.parse(run(`add 'Mine cross-project task' --assign mine-cross-agent --project ${repoB} --json`));
    expect(created.assigned_to).toBe("mine-cross-agent");

    const out = execSync(
      `HOME=${fakeHome} TODOS_DB_PATH=${dbPath} TODOS_AUTO_PROJECT=true bun run ${join(CWD, "src/cli/index.tsx")} --json mine mine-cross-agent`,
      { encoding: "utf-8", cwd: repoA, timeout: 15000 },
    ).trim();
    const tasks = JSON.parse(out);

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.some((task: any) => task.id === created.id)).toBe(true);
  });

  // ── config (no args) ──────────────────────────────────────────

  it("config should show current configuration", () => {
    const out = run("config");
    // Config output is JSON (pretty-printed) — should be parseable
    const config = JSON.parse(out);
    expect(typeof config).toBe("object");
  });

  // ── config --get ───────────────────────────────────────────────

  it("config --get should retrieve a config value", () => {
    // First set a known value
    run("config --set test_qol_key=hello");

    const out = run("--json config --get test_qol_key");
    const result = JSON.parse(out);

    expect(result.key).toBe("test_qol_key");
    expect(result.value).toBe("hello");
  });

  // ── config --set ───────────────────────────────────────────────

  it("config --set should update a nested config value", () => {
    const out = run("--json config --set myguard.enabled=true");
    const result = JSON.parse(out);

    expect(result.key).toBe("myguard.enabled");
    expect(result.value).toBe(true);

    // Verify the value persisted
    const getOut = run("--json config --get myguard.enabled");
    const getResult = JSON.parse(getOut);
    expect(getResult.value).toBe(true);
  });

  // ── config --set nested key ────────────────────────────────────

  it("config --set should handle deeply nested keys", () => {
    run("--json config --set deeply.nested.key=42");

    const out = run("--json config --get deeply.nested.key");
    const result = JSON.parse(out);

    expect(result.key).toBe("deeply.nested.key");
    expect(result.value).toBe(42);
  });

  // ── list --sort priority ───────────────────────────────────────

  it("--help should show all expected subcommands (prevent holo-swan bug: registered but not accessible)", () => {
    const help = run("--help");
    // Core task commands
    expect(help).toContain("add");
    expect(help).toContain("list");
    expect(help).toContain("done");
    expect(help).toContain("start");
    expect(help).toContain("fail");
    // Agent coordination
    expect(help).toContain("claim");
    expect(help).toContain("next");
    expect(help).toContain("status");
    expect(help).toContain("active");
    expect(help).toContain("stale");
    // Analytics
    expect(help).toContain("report");
    expect(help).toContain("summary");
    // CLI shorthands
    expect(help).toContain("assign");
    expect(help).toContain("pin");
    expect(help).toContain("tag");
    expect(help).toContain("project-bootstrap");
    // Server
    expect(help).toContain("serve");
    expect(help).toContain("stream");
    expect(help).toContain("mcp");
    // Discoverability
    expect(help).toContain("completions");
    expect(help).toContain("manual");
    // Diagnostics
    expect(help).toContain("doctor");
    expect(help).toContain("health");
    // Daily activity
    expect(help).toContain("today");
    expect(help).toContain("yesterday");
  });

  it("doctor --json should report local dry-run diagnostics", () => {
    const out = run("--json doctor");
    const result = JSON.parse(out);
    expect(result.dry_run).toBe(true);
    expect(result.checks.some((check: { type: string }) => check.type === "migration_level")).toBe(true);
    expect(result.checks.some((check: { type: string }) => check.type === "database_permissions")).toBe(true);
  });

  it("list --sort priority should sort tasks by priority", () => {
    run("add 'Low prio task' --priority low --json");
    run("add 'High prio task' --priority high --json");
    run("add 'Critical prio task' --priority critical --json");

    const out = run("--json list --sort priority");
    const tasks = JSON.parse(out);

    expect(Array.isArray(tasks)).toBe(true);
    // Find the priority-ordered tasks we just created
    const priorities = tasks.map((t: any) => t.priority);
    // Verify order: critical < high < medium < low
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 0; i < priorities.length - 1; i++) {
      expect((priorityOrder[priorities[i]] ?? 4)).toBeLessThanOrEqual(
        priorityOrder[priorities[i + 1]] ?? 4,
      );
    }
  });

  it("list should reject invalid --limit values", () => {
    let thrown = false;
    let errorOutput = "";
    try {
      run("list --limit nope");
    } catch (e: any) {
      thrown = true;
      errorOutput = e.stderr?.toString() || e.message || "";
    }
    expect(thrown).toBe(true);
    expect(errorOutput).toContain("Invalid --limit value");
  });

  it("list should reject invalid --sort values", () => {
    let thrown = false;
    let errorOutput = "";
    try {
      run("list --sort random");
    } catch (e: any) {
      thrown = true;
      errorOutput = e.stderr?.toString() || e.message || "";
    }
    expect(thrown).toBe(true);
    expect(errorOutput).toContain("Invalid --sort value");
  });

  it("list should reject invalid --format values", () => {
    let thrown = false;
    let errorOutput = "";
    try {
      run("list --format yaml");
    } catch (e: any) {
      thrown = true;
      errorOutput = e.stderr?.toString() || e.message || "";
    }
    expect(thrown).toBe(true);
    expect(errorOutput).toContain("Invalid --format value");
  });

  it("global -j alias should enable json output", () => {
    run("add 'json alias task' --json");
    const out = run("-j list --all");
    const tasks = JSON.parse(out);
    expect(Array.isArray(tasks)).toBe(true);
  });

  it("help should show -j alias for json", () => {
    const help = run("--help");
    expect(help).toContain("-j, --json");
  });

  // ── update routing metadata (working_dir + task_list linkage) ─────────

  it("update --working-dir repairs a task's working_dir (was 'unknown option')", () => {
    const t = JSON.parse(run("add 'wd repair' --json"));
    const updated = JSON.parse(run(`update ${t.id} --working-dir /tmp/wd/repair --json`));
    expect(updated.working_dir).toBe("/tmp/wd/repair");
  });

  it("update --list resolves a slug to the canonical task-list UUID", () => {
    const list = JSON.parse(run("lists --add 'RepairList' --slug repair-list --json"));
    const t = JSON.parse(run("add 'link me' --json"));
    const updated = JSON.parse(run(`update ${t.id} --list repair-list --json`));
    expect(updated.task_list_id).toBe(list.id);
  });

  it("update --list accepts an exact task-list UUID", () => {
    const list = JSON.parse(run("lists --add 'UuidList' --slug uuid-list --json"));
    const t = JSON.parse(run("add 'link uuid' --json"));
    const updated = JSON.parse(run(`update ${t.id} --list ${list.id} --json`));
    expect(updated.task_list_id).toBe(list.id);
  });

  it("update --list reports an unresolvable reference without silently succeeding", () => {
    const t = JSON.parse(run("add 'bad link' --json"));
    let thrown = false;
    let errorOutput = "";
    try {
      run(`update ${t.id} --list todos-does-not-exist-xyz --json`);
    } catch (e: any) {
      thrown = true;
      errorOutput = e.stderr?.toString() || e.message || "";
    }
    expect(thrown).toBe(true);
    expect(errorOutput).toContain("Could not resolve task list");
    // and the task_list_id must remain unset (no silent partial write)
    const after = JSON.parse(run(`show ${t.id} --json`));
    expect(after.task_list_id ?? null).toBeNull();
  });

  it("update --clear-working-dir resets working_dir to null (undo round-trip)", () => {
    const t = JSON.parse(run("add 'wd roundtrip' --json"));
    const set = JSON.parse(run(`update ${t.id} --working-dir /tmp/wd/roundtrip --json`));
    expect(set.working_dir).toBe("/tmp/wd/roundtrip");
    const cleared = JSON.parse(run(`update ${t.id} --clear-working-dir --json`));
    expect(cleared.working_dir).toBeNull();
  });

  it("update --clear-list detaches the task from its list (undo round-trip)", () => {
    const list = JSON.parse(run("lists --add 'ClearList' --slug clear-list --json"));
    const t = JSON.parse(run("add 'list roundtrip' --json"));
    const linked = JSON.parse(run(`update ${t.id} --list ${list.id} --json`));
    expect(linked.task_list_id).toBe(list.id);
    const cleared = JSON.parse(run(`update ${t.id} --clear-list --json`));
    expect(cleared.task_list_id).toBeNull();
  });

  it("update rejects --working-dir together with --clear-working-dir (and --list with --clear-list)", () => {
    const t = JSON.parse(run("add 'conflict flags' --json"));
    for (const combo of [`--working-dir /tmp/x --clear-working-dir`, `--list some-list --clear-list`]) {
      let thrown = false;
      let errorOutput = "";
      try {
        run(`update ${t.id} ${combo} --json`);
      } catch (e: any) {
        thrown = true;
        errorOutput = e.stderr?.toString() || e.message || "";
      }
      expect(thrown).toBe(true);
      expect(errorOutput).toContain("not both");
    }
  });
});
