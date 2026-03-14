import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

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
  await mkdir(join(fakeHome, ".todos"), { recursive: true });
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("CLI QoL commands", () => {
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
    // Server
    expect(help).toContain("serve");
    expect(help).toContain("stream");
    expect(help).toContain("mcp");
    // Diagnostics
    expect(help).toContain("doctor");
    expect(help).toContain("health");
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
});
