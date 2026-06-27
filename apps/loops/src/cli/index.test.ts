import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { Store } from "../lib/store.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

function runCli(dataDir: string, args: string[], input?: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...env, LOOPS_DATA_DIR: dataDir },
    input,
    encoding: "utf8",
  });
}

function workflowFile(dataDir: string, body: unknown): string {
  const file = join(dataDir, "workflow.json");
  writeFileSync(file, JSON.stringify(body));
  return file;
}

function futureAt(): string {
  return new Date(Date.now() + 60_000).toISOString();
}

describe("loops CLI", () => {
  test("reports the package version", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-version-"));
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    const version = runCli(dataDir, ["--version"]);

    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(pkg.version);

    const daemonVersion = spawnSync(process.execPath, [join(dirname(cliPath), "../daemon/index.ts"), "--version"], {
      env: { ...process.env, LOOPS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    expect(daemonVersion.status).toBe(0);
    expect(daemonVersion.stdout.trim()).toBe(pkg.version);
  });

  test("compiled CLI reports the package version", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-cli-compiled-version-"));
    const outfile = join(root, "loops");
    const build = spawnSync("bun", ["build", cliPath, "--compile", "--outfile", outfile], { encoding: "utf8" });
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

    expect(build.status).toBe(0);
    const version = spawnSync(outfile, ["--version"], { encoding: "utf8" });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(pkg.version);
  });

  test("run-now exits zero for succeeded runs", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-ok-"));
    const create = runCli(dataDir, ["create", "command", "ok", "--at", futureAt(), "--cmd", "printf ok"]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["run-now", "--show-output", "ok"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("succeeded");
    expect(run.stdout).toContain("source=ad_hoc");
    expect(run.stdout).toContain("stdout:");
    expect(run.stdout).toContain("ok");
  });

  test("run-now exits non-zero for failed runs while preserving JSON output", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-fail-"));
    const create = runCli(dataDir, ["create", "command", "fail", "--at", futureAt(), "--cmd", "exit 23"]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["--json", "run-now", "fail"]);
    expect(run.status).toBe(1);
    const value = JSON.parse(run.stdout);
    expect(value.status).toBe("failed");
    expect(value.exitCode).toBe(23);
    expect(value.runNow.source).toBe("ad_hoc");
    expect(value.runNow.advancesLoop).toBe(false);
  });

  test("run-now falls back to an ad hoc slot when the due slot is already terminal", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-terminal-due-"));
    const store = new Store(join(dataDir, "loops.db"));
    let dueSlot = "";
    try {
      const loop = store.createLoop(
        {
          name: "terminal-due",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      dueSlot = loop.nextRunAt!;
      const claim = store.claimRun(loop, dueSlot, "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "seed",
          stderr: "",
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:01Z") },
      );
    } finally {
      store.close();
    }

    const run = runCli(dataDir, ["--json", "run-now", "terminal-due"]);
    expect(run.status).toBe(0);
    const value = JSON.parse(run.stdout);
    expect(value.status).toBe("succeeded");
    expect(value.scheduledFor).not.toBe(dueSlot);
    expect(value.runNow.source).toBe("ad_hoc");
    expect(value.runNow.advancesLoop).toBe(false);
  });

  test("archives loops without deleting them and blocks run-now until unarchived", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-archive-"));
    const create = runCli(dataDir, ["create", "command", "archivable", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);

    const archive = runCli(dataDir, ["--json", "archive", "archivable"]);
    expect(archive.status).toBe(0);
    const archived = JSON.parse(archive.stdout);
    expect(archived.status).toBe("paused");
    expect(archived.archivedAt).toBeDefined();
    expect(archived.archivedFromStatus).toBe("active");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(0);

    const archivedList = runCli(dataDir, ["--json", "list", "--archived"]);
    expect(archivedList.status).toBe(0);
    expect(JSON.parse(archivedList.stdout).map((loop: { name: string }) => loop.name)).toEqual(["archivable"]);

    const show = runCli(dataDir, ["--json", "show", "archivable"]);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).archivedAt).toBeDefined();

    const blockedRun = runCli(dataDir, ["run-now", "archivable"]);
    expect(blockedRun.status).not.toBe(0);
    expect(blockedRun.stderr).toContain("loop is archived");

    const unarchive = runCli(dataDir, ["--json", "unarchive", "archivable"]);
    expect(unarchive.status).toBe(0);
    const restored = JSON.parse(unarchive.stdout);
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeUndefined();
  });

  test("hygiene names reports canonical machine/repo loop names without applying by default", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-hygiene-names-"));
    const create = runCli(dataDir, [
      "create",
      "command",
      "ops:codewith:account001:loop-health-slo",
      "--at",
      futureAt(),
      "--cmd",
      "true",
    ]);
    expect(create.status).toBe(0);

    const report = runCli(dataDir, ["--json", "hygiene", "names"]);

    expect(report.status).toBe(1);
    const value = JSON.parse(report.stdout);
    expect(value.ok).toBe(false);
    expect(value.changed).toBe(1);
    expect(value.changes[0]).toMatchObject({
      oldName: "ops:codewith:account001:loop-health-slo",
      newName: "machine-ops-loop-health-slo",
      changed: true,
    });

    const show = runCli(dataDir, ["--json", "show", "ops:codewith:account001:loop-health-slo"]);
    expect(show.status).toBe(0);
  });

  test("hygiene duplicates groups overlapping loops by normalized name, cwd, and schedule", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-hygiene-duplicates-"));
    expect(runCli(dataDir, ["create", "command", "machine-foo", "--every", "1h", "--cmd", "true", "--cwd", "/tmp/repo"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "machine-foo-compact", "--every", "1h", "--cmd", "true", "--cwd", "/tmp/repo"]).status).toBe(0);

    const report = runCli(dataDir, ["--json", "hygiene", "duplicates"]);

    expect(report.status).toBe(1);
    const value = JSON.parse(report.stdout);
    expect(value.ok).toBe(false);
    expect(value.groups).toHaveLength(1);
    expect(value.groups[0].loops.map((loop: { name: string }) => loop.name).sort()).toEqual(["machine-foo", "machine-foo-compact"]);
  });

  test("hygiene scripts inventories local script-backed command loops", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-hygiene-scripts-"));
    const scriptsDir = join(dataDir, "scripts");
    expect(runCli(dataDir, ["create", "command", "script-backed", "--at", futureAt(), "--cmd", `${scriptsDir}/check.sh`]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "script-backed-tilde", "--at", futureAt(), "--cmd", "~/.hasna/loops/scripts/check.sh"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "script-backed-env", "--at", futureAt(), "--cmd", "$HOME/.hasna/loops/scripts/check.sh"]).status).toBe(0);

    const report = runCli(dataDir, ["--json", "hygiene", "scripts", "--scripts-dir", scriptsDir]);

    expect(report.status).toBe(1);
    const value = JSON.parse(report.stdout);
    expect(value.ok).toBe(false);
    expect(value.scriptBacked).toBe(3);
    expect(value.loops.map((loop: { name: string }) => loop.name).sort()).toEqual([
      "script-backed",
      "script-backed-env",
      "script-backed-tilde",
    ]);
  });

  test("create command stores an OpenMachines assignment", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-machine-"));
    const create = runCli(dataDir, ["--json", "create", "command", "machine-local", "--at", futureAt(), "--cmd", "true", "--machine", "local"]);
    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.machine.id).toBeTruthy();
    expect(value.machine.local).toBe(true);

    const show = runCli(dataDir, ["--json", "show", "machine-local"]);
    expect(show.status).toBe(0);
    const shown = JSON.parse(show.stdout);
    expect(shown.machine.id).toBe(value.machine.id);
  });

  test("create agent stores advisory allowlist metadata", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-agent-allowlist-"));
    const create = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "allowlisted-agent",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--allow-tool",
      "functions.exec_command",
      "--allow-command",
      "git,bun",
    ]);

    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.target.allowlist).toEqual({
      tools: ["functions.exec_command"],
      commands: ["git", "bun"],
      enforcement: "metadata_only",
    });
  });

  test("machines commands expose OpenMachines topology", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-machines-"));
    const list = runCli(dataDir, ["--json", "machines", "list"]);
    expect(list.status).toBe(0);
    const machines = JSON.parse(list.stdout);
    expect(Array.isArray(machines)).toBe(true);
    expect(machines.length).toBeGreaterThan(0);

    const show = runCli(dataDir, ["--json", "machines", "show", "local"]);
    expect(show.status).toBe(0);
    const local = JSON.parse(show.stdout);
    expect(local.id).toBeTruthy();
    expect(local.local).toBe(true);
  });

  test("doctor exits non-zero when an active loop cannot preflight", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-doctor-preflight-"));
    const create = runCli(dataDir, [
      "create",
      "command",
      "bad-preflight",
      "--at",
      futureAt(),
      "--cmd",
      "openloops-definitely-missing-binary",
      "--no-shell",
    ]);
    expect(create.status).toBe(0);

    const doctor = runCli(dataDir, ["--json", "doctor"]);
    expect(doctor.status).toBe(1);
    const value = JSON.parse(doctor.stdout);
    expect(value.ok).toBe(false);
    expect(value.checks.find((check: { id: string }) => check.id.includes(":preflight"))?.status).toBe("fail");
  });

  test("health JSON reports failed expectations with classification and task upsert fields", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-health-json-"));
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "agent-health",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "",
          stderr: "Rate limit exceeded by provider",
          error: "429 too many requests",
          exitCode: 1,
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const health = runCli(dataDir, ["health", "--json"]);
    expect(health.status).toBe(1);
    const value = JSON.parse(health.stdout);
    expect(value.ok).toBe(false);
    expect(value.summary.unhealthy).toBe(1);
    expect(value.classifications.rate_limit).toBe(1);
    expect(value.expectations[0].failure.classification).toBe("rate_limit");
    expect(value.expectations[0].failure.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(value.expectations[0].recommendedTask).toMatchObject({
      priority: "high",
      futureNativeUpsert: { command: "todos upsert" },
    });
    expect(value.expectations[0].recommendedTask.compatibilityFallback.search).toEqual(
      expect.arrayContaining(["todos", "search"]),
    );
  });

  test("health route-tasks dry-run reports deduped task upserts without mutating todos", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-health-route-dry-run-"));
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "agent-health-route",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "",
          stderr: "Invalid schema for response_format",
          error: "response_format json schema error",
          exitCode: 1,
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const result = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "2"]);

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.failures).toBe(1);
    expect(value.actions[0]).toMatchObject({
      action: "would-upsert",
      priority: "medium",
    });
    expect(value.actions[0].metadata).toMatchObject({
      classification: "schema_response_format",
      no_tmux_dispatch: true,
    });
  });

  test("health route-tasks ignores stopped loops unless include-inactive is set and dedupe survives renames", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-health-route-active-only-"));
    const store = new Store(join(dataDir, "loops.db"));
    let firstFingerprint = "";
    try {
      const active = store.createLoop({
        name: "agent-health-rename-old",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      const stopped = store.createLoop({
        name: "agent-health-stopped",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      store.updateLoop(stopped.id, { status: "stopped", nextRunAt: undefined });
      for (const loop of [active, stopped]) {
        const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
        expect(claim).toBeDefined();
        store.finalizeRun(
          claim!.run.id,
          {
            status: "failed",
            finishedAt: "2026-01-01T00:00:01.000Z",
            durationMs: 1_000,
            stderr: `Rate limit at 2026-01-01T00:00:01.000Z for ${loop.name}`,
            error: "429 too many requests",
            exitCode: 1,
          },
          { claimedBy: "seed", now: new Date("2026-01-01T00:00:00.500Z") },
        );
      }
    } finally {
      store.close();
    }

    const activeOnly = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "10"]);
    expect(activeOnly.status).toBe(0);
    const activeValue = JSON.parse(activeOnly.stdout);
    expect(activeValue.failures).toBe(1);
    firstFingerprint = activeValue.actions[0].fingerprint;

    const includeInactive = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--include-inactive", "--max-actions", "10"]);
    expect(includeInactive.status).toBe(0);
    expect(JSON.parse(includeInactive.stdout).failures).toBe(2);

    const renameStore = new Store(join(dataDir, "loops.db"));
    try {
      const loop = renameStore.findLoopByName("agent-health-rename-old")!;
      renameStore.renameLoop(loop.id, "agent-health-rename-new");
    } finally {
      renameStore.close();
    }
    const afterRename = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "10"]);
    expect(JSON.parse(afterRename.stdout).actions[0].fingerprint).toBe(firstFingerprint);
  });

  test("expectations JSON is read-only and honors temp LOOPS_DATA_DIR", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-expectations-temp-data-"));
    const home = mkdtempSync(join(tmpdir(), "loops-cli-expectations-home-"));
    const create = runCli(dataDir, ["create", "command", "isolated", "--at", futureAt(), "--cmd", "true"], undefined, { HOME: home });
    expect(create.status).toBe(0);

    const result = runCli(dataDir, ["expectations", "isolated", "--json"], undefined, { HOME: home });
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.loop.name).toBe("isolated");
    expect(value.check.status).toBe("warn");
    expect(existsSync(join(dataDir, "loops.db"))).toBe(true);
    expect(existsSync(join(home, ".hasna"))).toBe(false);
  });

  test("workflow JSON run and inspect redact step output without show-output", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflow-redact-"));
    const secret = "SECRET_WORKFLOW_JSON_OUTPUT";
    const file = workflowFile(dataDir, {
      name: "workflow-redact",
      steps: [
        {
          id: "secret-step",
          target: {
            type: "command",
            command: `printf ${JSON.stringify(secret)}`,
            shell: true,
          },
        },
      ],
    });
    const create = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["--json", "workflows", "run", "workflow-redact"]);
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain(secret);
    const value = JSON.parse(run.stdout);
    expect(value.result.stdout).toContain("[redacted");
    expect(value.steps[0].stdout).toContain("[redacted");

    const inspect = runCli(dataDir, ["--json", "workflows", "inspect", value.workflowRun.id]);
    expect(inspect.status).toBe(0);
    expect(inspect.stdout).not.toContain(secret);
    const inspected = JSON.parse(inspect.stdout);
    expect(inspected.steps[0].stdout).toContain("[redacted");
  });

  test("create --goal persists goal config and goal show renders it", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-goal-"));
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "goal-loop",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--goal",
      "verify the command result",
      "--goal-budget",
      "50",
      "--goal-model",
      "openai/gpt-4o-mini",
      "--goal-max-turns",
      "2",
    ]);
    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.goal.objective).toBe("verify the command result");
    expect(value.goal.tokenBudget).toBe(50);

    const show = runCli(dataDir, ["--json", "goal", "show", "goal-loop"]);
    expect(show.status).toBe(0);
    const goal = JSON.parse(show.stdout);
    expect(goal.config.objective).toBe("verify the command result");
    expect(goal.config.model).toBe("openai/gpt-4o-mini");
  });

  test("--goal requires a non-empty objective", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-empty-goal-"));
    const create = runCli(dataDir, ["create", "command", "bad-goal", "--at", futureAt(), "--cmd", "true", "--goal", " "]);
    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("goal.objective");
  });

  test("templates render task worker/verifier workflow JSON", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-render-"));
    const list = runCli(dataDir, ["--json", "templates", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout).map((template: { id: string }) => template.id)).toEqual(expect.arrayContaining(["todos-task-worker-verifier", "event-worker-verifier"]));

    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-12345678",
      "--var",
      "taskTitle=Fix parser",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "authProfile=account005",
      "--var",
      "sandbox=danger-full-access",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("task-123");
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(workflow.steps[0].target).toMatchObject({
      type: "agent",
      provider: "codewith",
      cwd: "/tmp/repo",
      authProfile: "account005",
      permissionMode: "bypass",
      sandbox: "danger-full-access",
    });
    expect(workflow.steps[1].dependsOn).toEqual(["worker"]);
  });

  test("templates select different worker and verifier auth profiles from a pool", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-pool-"));
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-pool-12345678",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "authProfilePool=account004,account005,account006",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    const profiles = workflow.steps.map((step: { target: { authProfile?: string } }) => step.target.authProfile);
    expect(profiles).toHaveLength(2);
    expect(new Set(profiles).size).toBe(2);
    expect(profiles.every((profile: string) => ["account004", "account005", "account006"].includes(profile))).toBe(true);
  });

  test("templates render generic event worker/verifier workflow JSON", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-template-render-"));
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "event-worker-verifier",
      "--var",
      "eventId=evt-12345678",
      "--var",
      "eventType=knowledge.record.created",
      "--var",
      "eventSource=knowledge",
      "--var",
      "eventJson={\"id\":\"evt-12345678\"}",
      "--var",
      "projectPath=/tmp/knowledge",
      "--var",
      "provider=codewith",
      "--var",
      "authProfile=account005",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("knowledge");
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(workflow.steps[0].target.prompt).toContain("knowledge.record.created");
    expect(workflow.steps[0].target.cwd).toBe("/tmp/knowledge");
  });

  test("templates render bounded agent worker/verifier workflow JSON", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-bounded-template-render-"));
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "bounded-agent-worker-verifier",
      "--var",
      "objective=Check repo docs drift",
      "--var",
      "prompt=Inspect only recent commits and queue tasks for gaps.",
      "--var",
      "projectPath=/tmp/open-loops",
      "--var",
      "provider=codewith",
      "--var",
      "authProfilePool=account004,account005",
      "--var",
      "sandbox=danger-full-access",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("bounded-agent");
    expect(workflow.name).toMatch(/^bounded-agent-[a-f0-9]{8}-worker-verifier$/);
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(workflow.steps[0].target.prompt).toContain("/goal Check repo docs drift");
    expect(workflow.steps[0].target.prompt).toContain("Do not dispatch or paste prompts into tmux panes");
    expect(workflow.steps[1].target.prompt).toContain("Adversarially verify");
    expect(new Set(workflow.steps.map((step: { target: { authProfile?: string } }) => step.target.authProfile)).size).toBe(2);
  });

  test("templates select different OpenAccounts profiles from a pool", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-template-pool-"));
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "event-worker-verifier",
      "--var",
      "eventId=evt-pool-12345678",
      "--var",
      "eventType=task.ready",
      "--var",
      "eventSource=todos",
      "--var",
      "eventJson={\"id\":\"evt-pool-12345678\"}",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=claude",
      "--var",
      "accountPool=account002,account003",
      "--var",
      "accountTool=claude",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    const accounts = workflow.steps.map((step: { target: { account?: { profile: string; tool?: string } } }) => step.target.account);
    expect(accounts.map((account: { profile: string }) => account.profile).sort()).toEqual(["account002", "account003"]);
    expect(accounts.every((account: { tool?: string }) => account.tool === "claude")).toBe(true);
  });

  test("todos task event handler creates a deduped one-shot workflow loop", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-"));
    const event = {
      id: "evt-task-created-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-0001",
        title: "Fix event bridge",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const replayedEvent = {
      ...event,
      id: "evt-task-created-0002",
    };
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--provider",
      "codewith",
      "--auth-profile",
      "account005",
      "--auth-profile-pool",
      "account004,account005,account006",
      "--sandbox",
      "danger-full-access",
      "--permission-mode",
      "bypass",
    ];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.idempotencyKey).toBe("todos-task:task-created-0001:task.created");
    expect(firstValue.workflow.steps).toHaveLength(2);
    expect(firstValue.loop.name).toContain("event:todos-task:task-cre:");
    expect(firstValue.loop.name).not.toContain("evt-task");
    expect(firstValue.loop.target.workflowId).toBe(firstValue.workflow.id);
    const routedProfiles = firstValue.workflow.steps.map((step: { target: { authProfile?: string } }) => step.target.authProfile);
    expect(new Set(routedProfiles).size).toBe(2);
    for (const step of firstValue.workflow.steps) {
      expect(step.target).toMatchObject({
        type: "agent",
        provider: "codewith",
        cwd: "/tmp/open-todos",
        permissionMode: "bypass",
        sandbox: "danger-full-access",
      });
      expect(["account004", "account005", "account006"]).toContain(step.target.authProfile);
    }

    const second = runCli(dataDir, args, JSON.stringify(replayedEvent));
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue.deduped).toBe(true);
    expect(secondValue.idempotencyKey).toBe(firstValue.idempotencyKey);
    expect(secondValue.loop.id).toBe(firstValue.loop.id);
  });

  test("todos task event handler dedupes legacy event-id loop names", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-legacy-dedupe-"));
    const event = {
      id: "evt-task-created-legacy",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-legacy",
        title: "Legacy route replay",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const store = new Store(join(dataDir, "loops.db"));
    let legacyLoopId = "";
    try {
      const workflow = store.createWorkflow({
        name: "event:todos-task:task-cre:evt-task:workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "event:todos-task:task-cre:evt-task:run",
        schedule: { type: "once", at: futureAt() },
        target: { type: "workflow", workflowId: workflow.id },
      });
      legacyLoopId = loop.id;
    } finally {
      store.close();
    }

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.deduped).toBe(true);
    expect(value.dedupedBy).toBe("legacy-event-name");
    expect(value.loop.id).toBe(legacyLoopId);
  });

  test("todos task event handler uses metadata project path when task data has no cwd", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-metadata-cwd-"));
    const event = {
      id: "evt-task-created-metadata",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-metadata",
        title: "Route from metadata",
      },
      metadata: {
        project_path: "/tmp/from-metadata",
        project_kind: "open-source",
        route_enabled: true,
      },
      timestamp: new Date().toISOString(),
    };
    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "handle",
        "todos-task",
        "--provider",
        "codewith",
        "--auth-profile",
        "account005",
        "--worker-auth-profile",
        "account004",
        "--verifier-auth-profile",
        "account006",
        "--sandbox",
        "danger-full-access",
        "--permission-mode",
        "bypass",
      ],
      JSON.stringify(event),
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.deduped).toBe(false);
    expect(value.workflow.steps[0].target.cwd).toBe("/tmp/from-metadata");
    expect(value.workflow.steps[1].target.cwd).toBe("/tmp/from-metadata");
    expect(value.workflow.steps[0].target.authProfile).toBe("account004");
    expect(value.workflow.steps[1].target.authProfile).toBe("account006");
  });

  test("todos task event handler does not let metadata override task cwd", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-data-cwd-"));
    const event = {
      id: "evt-task-created-data-cwd",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-data-cwd",
        title: "Route from data cwd",
        working_dir: "/tmp/from-data",
        tags: ["auto:route"],
      },
      metadata: {
        project_path: "/tmp/from-metadata",
      },
      timestamp: new Date().toISOString(),
    };
    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.workflow.steps[0].target.cwd).toBe("/tmp/from-data");
    expect(value.workflow.steps[1].target.cwd).toBe("/tmp/from-data");
  });

  test("todos task event handler skips tasks without explicit route opt-in", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-no-route-"));
    const event = {
      id: "evt-task-created-no-route",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-no-route",
        title: "Do not route implicitly",
        working_dir: "/tmp/open-todos",
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(true);
    expect(value.reason).toContain("missing explicit route opt-in");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      expect(store.listLoops({ includeArchived: true })).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test.each([
    ["approval-required", { data: { requires_approval: true, tags: ["auto:route"] } }],
    ["manual-required", { metadata: { automation: { allowed: true, manual_required: true } } }],
    ["no-auto", { data: { tags: ["auto:route", "no-auto"] } }],
    ["completed", { data: { status: "completed", tags: ["auto:route"] } }],
    ["blocked", { data: { status: "blocked", tags: ["auto:route"] } }],
  ])("todos task event handler skips %s tasks", (_, overrides) => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-ineligible-"));
    const event = {
      id: "evt-task-created-ineligible",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-ineligible",
        title: "Do not route ineligible task",
        working_dir: "/tmp/open-todos",
        ...(overrides as { data?: Record<string, unknown> }).data,
      },
      metadata: {
        ...(overrides as { metadata?: Record<string, unknown> }).metadata,
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(true);
    const store = new Store(join(dataDir, "loops.db"));
    try {
      expect(store.listLoops({ includeArchived: true })).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("generic event handler creates a deduped one-shot workflow loop", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-generic-event-handler-"));
    const event = {
      id: "evt-knowledge-created-0001",
      type: "knowledge.record.created",
      source: "knowledge",
      subject: "record-1",
      message: "Knowledge record created",
      severity: "info",
      data: {
        id: "record-1",
        title: "Loop automation note",
        project_path: "/tmp/open-knowledge",
      },
      time: new Date().toISOString(),
      schemaVersion: "1.0",
      metadata: {},
    };
    const args = [
      "--json",
      "events",
      "handle",
      "generic",
      "--provider",
      "codewith",
      "--auth-profile",
      "account005",
      "--auth-profile-pool",
      "account004,account005,account006",
      "--sandbox",
      "danger-full-access",
      "--permission-mode",
      "bypass",
    ];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.workflow.name).toContain("event:generic:knowledge:knowledge.record.created");
    expect(firstValue.workflow.steps[0].target.cwd).toBe("/tmp/open-knowledge");
    const profiles = firstValue.workflow.steps.map((step: { target: { authProfile?: string } }) => step.target.authProfile);
    expect(new Set(profiles).size).toBe(2);

    const second = runCli(dataDir, args, JSON.stringify(event));
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue.deduped).toBe(true);
    expect(secondValue.loop.id).toBe(firstValue.loop.id);
  });
});
