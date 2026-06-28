import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  expect(result.status).toBe(0);
}

function createGitRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "loops-test@example.com"]);
  git(repo, ["config", "user.name", "Loops Test"]);
  writeFileSync(join(repo, "README.md"), "# test\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
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

  test("hygiene names apply backs up the database before renaming loops", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-hygiene-names-apply-"));
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

    const apply = runCli(dataDir, ["--json", "hygiene", "names", "--apply"]);

    expect(apply.status).toBe(0);
    const value = JSON.parse(apply.stdout);
    expect(value.applied).toBe(true);
    expect(value.changed).toBe(1);
    expect(value.backupPath).toContain(join(dataDir, "backups"));
    expect(existsSync(value.backupPath)).toBe(true);

    const oldName = runCli(dataDir, ["--json", "show", "ops:codewith:account001:loop-health-slo"]);
    expect(oldName.status).not.toBe(0);

    const newName = runCli(dataDir, ["--json", "show", "machine-ops-loop-health-slo"]);
    expect(newName.status).toBe(0);
    expect(JSON.parse(newName.stdout).name).toBe("machine-ops-loop-health-slo");
  });

  test("hygiene names apply skips database backup when there are no renames", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-hygiene-names-apply-noop-"));
    const create = runCli(dataDir, [
      "create",
      "command",
      "machine-ops-loop-health-slo",
      "--at",
      futureAt(),
      "--cmd",
      "true",
    ]);
    expect(create.status).toBe(0);

    const apply = runCli(dataDir, ["--json", "hygiene", "names", "--apply"]);

    expect(apply.status).toBe(0);
    const value = JSON.parse(apply.stdout);
    expect(value.applied).toBe(true);
    expect(value.changed).toBe(0);
    expect(value.backupPath).toBeUndefined();
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

  test("hygiene route-tasks dry-run produces deduped task upserts without mutating todos", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-hygiene-route-tasks-"));
    const scriptsDir = join(dataDir, "scripts");
    const evidenceDir = join(dataDir, "evidence");
    expect(runCli(dataDir, ["create", "command", "machine-foo", "--every", "1h", "--cmd", "true", "--cwd", "/tmp/repo"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "machine-foo-compact", "--every", "1h", "--cmd", "true", "--cwd", "/tmp/repo"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "machine-script-backed", "--at", futureAt(), "--cmd", `${scriptsDir}/check.sh`]).status).toBe(0);

    const route = runCli(dataDir, [
      "--json",
      "hygiene",
      "route-tasks",
      "--checks",
      "duplicates,scripts",
      "--scripts-dir",
      scriptsDir,
      "--dry-run",
      "--max-actions",
      "10",
      "--auto-route",
      "--route-project-path",
      "/tmp/openloops-fallback",
      "--evidence-dir",
      evidenceDir,
    ]);

    expect(route.status).toBe(0);
    const value = JSON.parse(route.stdout);
    expect(value.ok).toBe(true);
    expect(value.findings).toBe(2);
    expect(value.actions.map((action: { check: string }) => action.check).sort()).toEqual(["duplicates", "scripts"]);
    expect(value.actions.every((action: { action: string }) => action.action === "would-upsert")).toBe(true);
    expect(value.actions.every((action: { metadata: { no_tmux_dispatch?: boolean } }) => action.metadata.no_tmux_dispatch === true)).toBe(true);
    expect(value.actions.every((action: { tags: string[] }) => action.tags.includes("auto:route"))).toBe(true);
    expect(value.actions.every((action: { metadata: { route_enabled?: boolean; automation?: { allowed?: boolean } } }) => action.metadata.route_enabled === true && action.metadata.automation?.allowed === true)).toBe(true);
    expect(value.actions.find((action: { check: string }) => action.check === "scripts").metadata.project_path).toBe("/tmp/openloops-fallback");
    expect(value.evidencePath).toContain(evidenceDir);
    expect(existsSync(value.evidencePath)).toBe(true);
    expect(JSON.parse(readFileSync(value.evidencePath, "utf8")).findings).toBe(2);

    const firstBatch = runCli(dataDir, [
      "--json",
      "hygiene",
      "route-tasks",
      "--checks",
      "duplicates,scripts",
      "--scripts-dir",
      scriptsDir,
      "--dry-run",
      "--max-actions",
      "1",
    ]);
    expect(firstBatch.status).toBe(0);
    const first = JSON.parse(firstBatch.stdout);
    writeFileSync(
      join(dataDir, "route-cursors.json"),
      JSON.stringify({ [first.routing.key]: { lastFingerprint: first.actions[0].fingerprint } }),
    );

    const nextBatch = runCli(dataDir, [
      "--json",
      "hygiene",
      "route-tasks",
      "--checks",
      "duplicates,scripts",
      "--scripts-dir",
      scriptsDir,
      "--dry-run",
      "--max-actions",
      "1",
    ]);
    expect(nextBatch.status).toBe(0);
    const next = JSON.parse(nextBatch.stdout);
    expect(next.actions[0].fingerprint).not.toBe(first.actions[0].fingerprint);
    expect(next.routing.previousFingerprint).toBe(first.actions[0].fingerprint);
  });

  test("hygiene route-tasks skips auto-route metadata for findings without cwd or explicit route project", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-hygiene-route-no-cwd-"));
    expect(runCli(dataDir, [
      "create",
      "command",
      "ops:codewith:account001:loop-health-slo",
      "--at",
      futureAt(),
      "--cmd",
      "true",
    ]).status).toBe(0);

    const result = runCli(dataDir, [
      "--json",
      "hygiene",
      "route-tasks",
      "--checks",
      "names",
      "--dry-run",
      "--max-actions",
      "1",
      "--auto-route",
    ]);

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.actions[0].tags).not.toContain("auto:route");
    expect(value.actions[0].autoRoute).toMatchObject({
      requested: true,
      enabled: false,
      skippedReason: "missing cwd or --route-project-path",
    });
    expect(value.actions[0].metadata).toMatchObject({
      auto_route_requested: true,
      auto_route_enabled: false,
      auto_route_skipped_reason: "missing cwd or --route-project-path",
      route_enabled: false,
      project_path: null,
      working_dir: null,
      automation: { allowed: false, source: "openloops.hygiene.route-tasks" },
      no_tmux_dispatch: true,
    });
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

  test("create stores runtime preflight policy on command, agent, and workflow loops", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-runtime-preflight-"));
    const command = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "runtime-command-preflight",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--no-shell",
      "--preflight-each-run",
    ]);
    expect(command.status).toBe(0);
    expect(JSON.parse(command.stdout).target.preflight).toEqual({ beforeRun: true });

    const agent = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "runtime-agent-preflight",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--preflight-each-run",
    ]);
    expect(agent.status).toBe(0);
    expect(JSON.parse(agent.stdout).target.preflight).toEqual({ beforeRun: true });

    const file = workflowFile(dataDir, {
      name: "runtime-preflight-workflow",
      steps: [{ id: "step", target: { type: "command", command: "true" } }],
    });
    expect(runCli(dataDir, ["workflows", "create", file]).status).toBe(0);
    const workflow = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "runtime-workflow-preflight",
      "--workflow",
      "runtime-preflight-workflow",
      "--at",
      futureAt(),
      "--preflight-each-run",
    ]);
    expect(workflow.status).toBe(0);
    expect(JSON.parse(workflow.stdout).target.preflight).toEqual({ beforeRun: true });
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

  test("create command --preflight fails before storing a broken loop", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-preflight-fail-"));
    const create = runCli(dataDir, [
      "create",
      "command",
      "bad-create-preflight",
      "--at",
      futureAt(),
      "--cmd",
      "openloops-definitely-missing-binary",
      "--no-shell",
      "--preflight",
    ]);

    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("Executable not found");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create command --preflight includes stable JSON evidence on success", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-preflight-ok-"));
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "ok-create-preflight",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--no-shell",
      "--preflight",
    ]);

    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.loop.name).toBe("ok-create-preflight");
    expect(value.preflight).toMatchObject({ command: "true" });
  });

  test("create command --preflight reports bounded JSON without storing on failure", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-preflight-json-fail-"));
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "bad-create-preflight-json",
      "--at",
      futureAt(),
      "--cmd",
      "openloops-definitely-missing-binary",
      "--no-shell",
      "--preflight",
    ]);

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value).toMatchObject({
      ok: false,
      created: false,
      type: "command",
      name: "bad-create-preflight-json",
      preflight: { ok: false },
    });
    expect(value.preflight.error).toContain("Executable not found");
    expect(value.preflight.error.length).toBeLessThan(380);

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create command --preflight fails before storing when OpenAccounts env fails", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-account-preflight-fail-"));
    const home = mkdtempSync(join(tmpdir(), "loops-cli-create-account-home-"));
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const accounts = join(binDir, "accounts");
    writeFileSync(
      accounts,
      "#!/usr/bin/env bash\nprintf 'missing account profile' >&2\nexit 42\n",
    );
    chmodSync(accounts, 0o755);

    const create = runCli(
      dataDir,
      [
        "--json",
        "create",
        "command",
        "bad-account-preflight",
        "--at",
        futureAt(),
        "--cmd",
        "true",
        "--no-shell",
        "--account",
        "missing",
        "--account-tool",
        "codewith",
        "--preflight",
      ],
      undefined,
      { HOME: home, PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value.preflight.error).toContain("accounts env failed for missing/codewith");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create agent --preflight fails before storing when provider binary is missing", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-preflight-fail-"));
    const home = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-home-"));
    const create = runCli(
      dataDir,
      [
        "--json",
        "create",
        "agent",
        "bad-agent-preflight",
        "--provider",
        "codewith",
        "--prompt",
        "run",
        "--at",
        futureAt(),
        "--preflight",
      ],
      undefined,
      { BUN_INSTALL: join(home, ".bun"), HOME: home, PATH: "/usr/bin:/bin" },
    );

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value).toMatchObject({
      ok: false,
      created: false,
      type: "agent",
      provider: "codewith",
      name: "bad-agent-preflight",
      preflight: { ok: false },
    });
    expect(value.preflight.error).toContain("Executable not found");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create agent --preflight validates provider-native Codewith auth profiles", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-auth-preflight-"));
    const home = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-auth-home-"));
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const codewith = join(binDir, "codewith");
    writeFileSync(
      codewith,
      [
        "#!/usr/bin/env bash",
        "if [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then",
        "  printf 'NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(codewith, 0o755);

    const create = runCli(
      dataDir,
      [
        "--json",
        "create",
        "agent",
        "bad-codewith-auth-profile",
        "--provider",
        "codewith",
        "--auth-profile",
        "missing",
        "--prompt",
        "run",
        "--at",
        futureAt(),
        "--preflight",
      ],
      undefined,
      { HOME: home, PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value.preflight.error).toContain("codewith auth profile not found: missing");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create workflow --preflight fails before storing the scheduling loop", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-workflow-preflight-fail-"));
    const file = workflowFile(dataDir, {
      name: "workflow-preflight-fails",
      steps: [
        {
          id: "missing-command",
          target: { type: "command", command: "openloops-definitely-missing-binary" },
        },
      ],
    });
    const workflow = runCli(dataDir, ["workflows", "create", file]);
    expect(workflow.status).toBe(0);

    const create = runCli(dataDir, [
      "create",
      "workflow",
      "bad-workflow-loop",
      "--workflow",
      "workflow-preflight-fails",
      "--at",
      futureAt(),
      "--preflight",
    ]);

    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("workflow step missing-command preflight failed");
    expect(create.stderr).toContain("Executable not found");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create workflow --preflight includes step-mapped JSON evidence on success", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-workflow-preflight-ok-"));
    const file = workflowFile(dataDir, {
      name: "workflow-preflight-ok",
      steps: [
        {
          id: "first",
          target: { type: "command", command: "true" },
        },
        {
          id: "second",
          dependsOn: ["first"],
          target: { type: "command", command: "true" },
        },
      ],
    });
    const workflow = runCli(dataDir, ["workflows", "create", file]);
    expect(workflow.status).toBe(0);

    const create = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "ok-workflow-loop",
      "--workflow",
      "workflow-preflight-ok",
      "--at",
      futureAt(),
      "--preflight",
    ]);

    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.loop.name).toBe("ok-workflow-loop");
    expect(value.preflight.map((item: { workflowStepId: string }) => item.workflowStepId)).toEqual(["first", "second"]);
    expect(value.preflight.every((item: { command: string }) => item.command === "true")).toBe(true);
  });

  test("workflows create --preflight fails before storing a broken workflow", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflows-create-preflight-fail-"));
    const file = workflowFile(dataDir, {
      name: "stored-workflow-preflight-fails",
      steps: [
        {
          id: "missing-command",
          target: { type: "command", command: "openloops-definitely-missing-binary" },
        },
      ],
    });

    const create = runCli(dataDir, ["--json", "workflows", "create", file, "--preflight"]);

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value).toMatchObject({
      ok: false,
      created: false,
      type: "workflow",
      name: "stored-workflow-preflight-fails",
      preflight: { ok: false },
    });
    expect(value.preflight.error).toContain("workflow step missing-command preflight failed");

    const list = runCli(dataDir, ["--json", "workflows", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([]);
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
          stdout: "fake-project-stdout-secret",
          stderr: "Rate limit exceeded by provider fake-project-stderr-secret",
          error: "429 too many requests fake-project-error-secret",
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
    expect(JSON.stringify(value)).not.toContain("fake-project-");
    expect(value.expectations[0].latestRun.error).toMatch(/^\[redacted \d+ chars\]$/);
    expect(value.expectations[0].failure.evidence.stderr).toMatch(/^\[redacted \d+ chars\]$/);
    expect(value.expectations[0].recommendedTask).toMatchObject({
      priority: "high",
      futureNativeUpsert: { command: "todos upsert" },
    });
    expect(value.expectations[0].recommendedTask.description).toContain("Do not dispatch or paste prompts into tmux panes");
    expect(value.expectations[0].recommendedTask.compatibilityFallback.search).toEqual(
      expect.arrayContaining(["todos", "search"]),
    );
  });

  test("health route-tasks dry-run reports deduped task upserts without mutating todos", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-health-route-dry-run-"));
    const evidenceDir = join(dataDir, "evidence");
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

    const defaultResult = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "2"]);
    expect(defaultResult.status).toBe(0);
    const defaultValue = JSON.parse(defaultResult.stdout);
    expect(defaultValue.actions[0].tags).not.toContain("auto:route");
    expect(defaultValue.actions[0].metadata.route_enabled).toBe(false);
    expect(defaultValue.actions[0].metadata.project_path).toBeNull();
    expect(defaultValue.actions[0].metadata.working_dir).toBeNull();
    expect(defaultValue.actions[0].autoRoute).toMatchObject({ requested: false, enabled: false });

    const result = runCli(dataDir, [
      "--json",
      "health",
      "route-tasks",
      "--dry-run",
      "--max-actions",
      "2",
      "--auto-route",
      "--evidence-dir",
      evidenceDir,
    ]);

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.routing.key).not.toBe(defaultValue.routing.key);
    expect(value.failures).toBe(1);
    expect(value.actions[0]).toMatchObject({
      action: "would-upsert",
      priority: "medium",
    });
    expect(value.actions[0].tags).toContain("auto:route");
    expect(value.actions[0].metadata).toMatchObject({
      classification: "schema_response_format",
      route_enabled: true,
      project_path: "/tmp/repo",
      automation: { allowed: true, source: "openloops.health.route-tasks" },
      no_tmux_dispatch: true,
    });
    expect(value.evidencePath).toContain(evidenceDir);
    expect(existsSync(value.evidencePath)).toBe(true);
    expect(JSON.parse(readFileSync(value.evidencePath, "utf8")).failures).toBe(1);

    const repeated = runCli(dataDir, [
      "--json",
      "health",
      "route-tasks",
      "--dry-run",
      "--max-actions",
      "2",
      "--auto-route",
      "--evidence-dir",
      evidenceDir,
    ]);
    expect(repeated.status).toBe(0);
    const repeatedValue = JSON.parse(repeated.stdout);
    expect(repeatedValue.evidencePath).not.toBe(value.evidencePath);
    expect(existsSync(repeatedValue.evidencePath)).toBe(true);
  });

  test("health route-tasks passes working-dir to todos upsert for auto-routed tasks", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-health-route-working-dir-"));
    const binDir = join(dataDir, "bin");
    const argLog = join(dataDir, "todos-args.log");
    mkdirSync(binDir, { recursive: true });
    const todos = join(binDir, "todos");
    writeFileSync(
      todos,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$TODOS_ARG_LOG\"",
        "if [[ \"$*\" == *\"task-lists\"* && \"$*\" == *\"--json\"* ]]; then",
        "  printf '[{\"id\":\"list-1\",\"slug\":\"loop-error-self-heal\"}]\\n'",
        "  exit 0",
        "fi",
        "if [[ \"$*\" == *\"task upsert\"* ]]; then",
        "  prev=''",
        "  for arg in \"$@\"; do",
        "    if [[ \"$prev\" == \"--working-dir\" ]]; then printf 'WORKING_DIR=%s\\n' \"$arg\" >> \"$TODOS_ARG_LOG\"; fi",
        "    if [[ \"$prev\" == \"--tags\" ]]; then printf 'TAGS=%s\\n' \"$arg\" >> \"$TODOS_ARG_LOG\"; fi",
        "    prev=\"$arg\"",
        "  done",
        "  printf '{\"task\":{\"id\":\"task-1\"}}\\n'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(todos, 0o755);
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "agent-health-working-dir",
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
          error: "429 too many requests",
          exitCode: 1,
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const result = runCli(
      dataDir,
      ["--json", "health", "route-tasks", "--max-actions", "1", "--auto-route", "--project", join(dataDir, "todos-project")],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_ARG_LOG: argLog },
    );

    expect(result.status).toBe(0);
    const log = readFileSync(argLog, "utf8");
    expect(log).toContain("WORKING_DIR=/tmp/repo");
    expect(log).toContain("TAGS=bug,openloops,loop-health,rate_limit,auto:route");
  });

  test("runtime preflight failures are finalized and routed as preflight health tasks", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-runtime-preflight-health-"));
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "runtime-preflight-health",
      "--at",
      futureAt(),
      "--cmd",
      "definitely-missing-openloops-runtime-preflight-binary",
      "--no-shell",
      "--preflight-each-run",
    ]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["--json", "run-now", "runtime-preflight-health"]);
    expect(run.status).toBe(1);
    const runValue = JSON.parse(run.stdout);
    expect(runValue.status).toBe("failed");
    expect(runValue.error).toContain("runtime preflight failed");

    const result = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "2"]);
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.failures).toBe(1);
    expect(value.actions[0]).toMatchObject({
      action: "would-upsert",
      priority: "medium",
    });
    expect(value.actions[0].metadata).toMatchObject({
      classification: "preflight",
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
    expect(workflow.steps[0].target.prompt).toContain("Do not dispatch or paste prompts into tmux panes");
    expect(workflow.steps[1].target.prompt).toContain("Do not dispatch or paste prompts into tmux panes");
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

  test("templates default git projects to isolated worktrees", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-worktree-"));
    const repo = createGitRepo("loops-cli-template-worktree-repo-");
    const worktreeRoot = join(dataDir, "worktrees");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-worktree-12345678",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "provider=codewith",
      "--var",
      "authProfile=account005",
      "--var",
      `worktreeRoot=${worktreeRoot}`,
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["prepare-worktree", "worker", "verifier"]);
    expect(workflow.steps[0].target).toMatchObject({ type: "command", command: "bash", cwd: repo });
    expect(workflow.steps[1].dependsOn).toEqual(["prepare-worktree"]);
    expect(workflow.steps[1].target.cwd).toContain(worktreeRoot);
    expect(workflow.steps[1].target.worktree).toMatchObject({
      mode: "auto",
      enabled: true,
      originalCwd: repo,
      repoRoot: repo,
      root: worktreeRoot,
    });
    expect(workflow.steps[1].target.worktree.branch).toContain("openloops/");
    expect(workflow.steps[2].target.cwd).toBe(workflow.steps[1].target.cwd);
    expect(workflow.steps[1].target.prompt).toContain("Use the isolated git worktree");
    expect(workflow.steps[1].target.prompt).toContain("Do not mutate the original checkout/main branch");
  });

  test("prepare-worktree refuses a stale checkout from a different git repo", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-stale-worktree-"));
    const repo = createGitRepo("loops-cli-template-stale-worktree-repo-");
    const worktreeRoot = join(dataDir, "worktrees");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-stale-worktree",
      "--var",
      `projectPath=${repo}`,
      "--var",
      `worktreeRoot=${worktreeRoot}`,
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    const stalePath = workflow.steps[1].target.worktree.path;
    mkdirSync(stalePath, { recursive: true });
    git(stalePath, ["init"]);
    git(stalePath, ["config", "user.email", "loops-test@example.com"]);
    git(stalePath, ["config", "user.name", "Loops Test"]);
    writeFileSync(join(stalePath, "README.md"), "# stale\n");
    git(stalePath, ["add", "README.md"]);
    git(stalePath, ["commit", "-m", "stale"]);

    const prepare = spawnSync("bash", ["-lc", workflow.steps[0].target.args[1]], {
      cwd: workflow.steps[0].target.cwd,
      encoding: "utf8",
    });

    expect(prepare.status).not.toBe(0);
    expect(prepare.stderr).toContain("different git common dir");
  });

  test("templates allow explicit main checkout mode instead of worktrees", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-worktree-main-"));
    const repo = createGitRepo("loops-cli-template-worktree-main-repo-");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-main-12345678",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "worktreeMode=main",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(workflow.steps[0].target.cwd).toBe(repo);
    expect(workflow.steps[0].target.worktree).toMatchObject({
      mode: "main",
      enabled: false,
      cwd: repo,
      reason: "explicit main/default checkout mode",
    });
  });

  test("templates fail required worktree mode for non-git project paths", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-worktree-required-"));
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-required-worktree",
      "--var",
      "projectPath=/tmp/not-a-real-openloops-repo",
      "--var",
      "worktreeMode=required",
    ]);

    expect(render.status).not.toBe(0);
    expect(render.stderr).toContain("worktreeMode=required");
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

  test("templates reject provider-native auth profile pools for non-Codewith providers", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-native-auth-provider-"));
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-native-auth",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=claude",
      "--var",
      "authProfilePool=account004,account005",
    ]);

    expect(render.status).not.toBe(0);
    expect(render.stderr).toContain("authProfile");
    expect(render.stderr).toContain("provider codewith");
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

  test("todos task event handler dry-run exposes default worktree routing for git repos", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-worktree-"));
    const repo = createGitRepo("loops-cli-event-handler-worktree-repo-");
    const worktreeRoot = join(dataDir, "worktrees");
    const event = {
      id: "evt-task-worktree-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-event-worktree-0001",
        title: "Fix event bridge in worktree",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--worktree-root",
      worktreeRoot,
    ], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.workflow.steps.map((step: { id: string }) => step.id)).toEqual(["prepare-worktree", "worker", "verifier"]);
    expect(value.workflow.steps[1].target.cwd).toContain(worktreeRoot);
    expect(value.workflow.steps[1].target.worktree.enabled).toBe(true);
    expect(value.workflow.steps[1].target.worktree.originalCwd).toBe(repo);
  });

  test("todos task event handler throttles active workflows per project", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-project-throttle-"));
    const repo = createGitRepo("loops-cli-event-handler-project-throttle-repo-");
    const baseEvent = {
      type: "task.created",
      source: "@hasna/todos",
      data: {
        title: "Queue project task",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--max-active-per-project",
      "1",
    ];

    const first = runCli(dataDir, args, JSON.stringify({
      ...baseEvent,
      id: "evt-project-throttle-0001",
      data: { ...baseEvent.data, id: "task-project-throttle-0001" },
    }));
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).deduped).toBe(false);

    const second = runCli(dataDir, args, JSON.stringify({
      ...baseEvent,
      id: "evt-project-throttle-0002",
      data: { ...baseEvent.data, id: "task-project-throttle-0002" },
    }));
    expect(second.status).toBe(0);
    const value = JSON.parse(second.stdout);
    expect(value.skipped).toBe(true);
    expect(value.reason).toContain("project active workflow limit reached");
    expect(value.throttle.counts.project).toBe(1);
    expect(value.throttle.limits.maxActivePerProject).toBe(1);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler canonicalizes repo subdirectories for per-project throttles", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-canonical-throttle-"));
    const repo = createGitRepo("loops-cli-event-handler-canonical-throttle-repo-");
    const subdir = join(repo, "packages", "sdk");
    mkdirSync(subdir, { recursive: true });
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--max-active-per-project",
      "1",
    ];

    const first = runCli(dataDir, args, JSON.stringify({
      id: "evt-canonical-throttle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-canonical-throttle-0001",
        title: "Queue repo-root task",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    }));
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).deduped).toBe(false);

    const second = runCli(dataDir, args, JSON.stringify({
      id: "evt-canonical-throttle-0002",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-canonical-throttle-0002",
        title: "Queue subdir task",
        working_dir: subdir,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    }));
    expect(second.status).toBe(0);
    const value = JSON.parse(second.stdout);
    expect(value.skipped).toBe(true);
    expect(value.throttle.counts.project).toBe(1);
    expect(value.throttle.projectPath).toBe(repo);
  });

  test("todos task event handler throttles active workflows per project group", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-group-throttle-"));
    const repoA = createGitRepo("loops-cli-event-handler-group-throttle-a-");
    const repoB = createGitRepo("loops-cli-event-handler-group-throttle-b-");
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--project-group",
      "oss",
      "--max-active-per-project-group",
      "1",
    ];

    const first = runCli(dataDir, args, JSON.stringify({
      id: "evt-group-throttle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-group-throttle-0001",
        title: "Queue group task A",
        working_dir: repoA,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    }));
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).deduped).toBe(false);

    const second = runCli(dataDir, args, JSON.stringify({
      id: "evt-group-throttle-0002",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-group-throttle-0002",
        title: "Queue group task B",
        working_dir: repoB,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    }));
    expect(second.status).toBe(0);
    const value = JSON.parse(second.stdout);
    expect(value.skipped).toBe(true);
    expect(value.reason).toContain("project-group active workflow limit reached");
    expect(value.throttle.counts.projectGroup).toBe(1);
    expect(value.throttle.limits.maxActivePerProjectGroup).toBe(1);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler dry-run with throttle options does not create a loop database", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-dry-throttle-"));
    const repo = createGitRepo("loops-cli-event-handler-dry-throttle-repo-");
    const event = {
      id: "evt-dry-throttle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-dry-throttle-0001",
        title: "Preview throttled route",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--max-active",
      "1",
    ], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.throttle.evaluated).toBe(false);
    expect(existsSync(join(dataDir, "loops.db"))).toBe(false);
  });

  test("todos task event handler dedupes before required worktree validation", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-dedupe-before-render-"));
    const repo = createGitRepo("loops-cli-event-handler-dedupe-before-render-repo-");
    const event = {
      id: "evt-dedupe-before-render-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-dedupe-before-render",
        title: "Create first routable task",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const replay = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--worktree-mode",
      "required",
      "--project-path",
      "/tmp/not-a-real-openloops-required-repo",
    ], JSON.stringify({ ...event, id: "evt-dedupe-before-render-0002" }));

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.loop.id).toBe(created.loop.id);
  });

  test("todos task drain uses todos ready and throttles active workflows per project", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-throttle-"));
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const repo = createGitRepo("loops-cli-event-drain-throttle-repo-");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-throttle-a",
        title: "Route first ready task",
        status: "pending",
        working_dir: repo,
        tags: ["auto:route"],
      },
      {
        id: "task-drain-throttle-b",
        title: "Route second ready task",
        status: "pending",
        working_dir: repo,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "5",
        "--max-active-per-project",
        "1",
        "--worktree-mode",
        "off",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, CALLS_FILE: callsFile, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.source).toBe("todos ready");
    expect(value.scanned).toBe(2);
    expect(value.candidates).toBe(2);
    expect(value.considered).toBe(2);
    expect(value.created).toBe(1);
    expect(value.throttled).toBe(1);
    expect(value.results[1].queuedAtSource).toBe(true);
    expect(readFileSync(callsFile, "utf8")).toContain("ready --limit 10");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task drain filters by task list and limits new dispatches", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-filter-"));
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const repo = createGitRepo("loops-cli-event-drain-filter-repo-");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '%s\\n' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"project-route\" ]]; then printf 'project id leaked into todos ready args\\n' >&2; exit 7; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-filter-a",
        project_id: "project-route",
        title: "Route matching list task",
        status: "pending",
        task_list_id: "list-route",
        working_dir: repo,
        tags: ["auto:route", "repoops"],
      },
      {
        id: "task-drain-filter-b",
        project_id: "project-route",
        title: "Route second matching list task later",
        status: "pending",
        task_list_id: "list-route",
        working_dir: repo,
        tags: ["auto:route", "repoops"],
      },
      {
        id: "task-drain-filter-c",
        project_id: "project-other",
        title: "Ignore other list task",
        status: "pending",
        task_list_id: "list-route",
        working_dir: repo,
        tags: ["auto:route", "repoops"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--task-list",
        "route",
        "--todos-project-id",
        "project-route",
        "--project-path-prefix",
        repo,
        "--tags",
        "repoops",
        "--max-dispatch",
        "1",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.scanned).toBe(3);
    expect(value.candidates).toBe(2);
    expect(value.filteredCandidates).toBe(2);
    expect(value.scanLimit).toBe(500);
    expect(value.considered).toBe(1);
    expect(value.created).toBe(1);
    expect(value.taskListId).toBe("list-route");
    expect(value.projectPathPrefix).toBe(repo);
    expect(readFileSync(callsFile, "utf8")).toContain("ready --limit 500");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
    expect(loops[0].name).toContain("task-dra");
  });

  test("todos task event handler --preflight fails before storing generated workflow loops", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-preflight-fail-"));
    const home = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-preflight-home-"));
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const codewith = join(binDir, "codewith");
    writeFileSync(
      codewith,
      [
        "#!/usr/bin/env bash",
        "if [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then",
        "  printf 'NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(codewith, 0o755);
    const event = {
      id: "evt-task-created-preflight-fail",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-preflight-fail",
        title: "Route with bad profile",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
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
        "missing",
        "--preflight",
      ],
      JSON.stringify(event),
      { HOME: home, PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(false);
    expect(value.preflight.error).toContain("workflow step worker preflight failed");
    expect(value.preflight.error).toContain("codewith auth profile not found: missing");

    const loops = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(loops.stdout)).toEqual([]);
    const workflows = runCli(dataDir, ["--json", "workflows", "list"]);
    expect(JSON.parse(workflows.stdout)).toEqual([]);
  });

  test("todos task event handler --preflight dedupes existing loops before provider checks", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-preflight-dedupe-"));
    const home = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-preflight-dedupe-home-"));
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const codewith = join(binDir, "codewith");
    writeFileSync(
      codewith,
      [
        "#!/usr/bin/env bash",
        "if [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then",
        "  printf 'NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(codewith, 0o755);
    const event = {
      id: "evt-task-created-dedupe-preflight-1",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-dedupe-preflight",
        title: "Dedupe before bad profile",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const create = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);

    const replay = runCli(
      dataDir,
      [
        "--json",
        "events",
        "handle",
        "todos-task",
        "--provider",
        "codewith",
        "--auth-profile",
        "missing",
        "--preflight",
      ],
      JSON.stringify({ ...event, id: "evt-task-created-dedupe-preflight-2" }),
      { HOME: home, PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.loop.id).toBe(created.loop.id);
  });

  test("todos task event handler --preflight validates reused workflows before storing loop", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-preflight-existing-workflow-"));
    const event = {
      id: "evt-existing-workflow-preflight",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-existing-workflow-preflight",
        title: "Reuse existing workflow",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const preview = runCli(dataDir, ["--json", "events", "handle", "todos-task", "--dry-run"], JSON.stringify(event));
    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    const store = new Store(join(dataDir, "loops.db"));
    try {
      store.createWorkflow({
        name: previewValue.workflow.name,
        steps: [{ id: "stale", target: { type: "command", command: "openloops-definitely-missing-binary" } }],
      });
    } finally {
      store.close();
    }

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task", "--preflight"], JSON.stringify(event));

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const value = JSON.parse(result.stdout);
    expect(value.preflight.error).toContain("workflow step stale preflight failed");
    const loops = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(loops.stdout)).toEqual([]);
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

  test("todos task event handler dedupes by task idempotency across route prefixes", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-idempotency-dedupe-"));
    const event = {
      id: "evt-task-created-cross-prefix-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-cross-prefix",
        title: "Do not duplicate across route drains",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--name-prefix", "event:first-route"],
      JSON.stringify(event),
    );
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--name-prefix", "event:second-route"],
      JSON.stringify({ ...event, id: "evt-task-created-cross-prefix-b" }),
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.idempotencyKey).toBe("todos-task:task-created-cross-prefix:task.created");
    expect(value.loop.id).toBe(created.loop.id);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
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

  test("todos task event handler ignores bare allowed=true without documented route opt-in", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-bare-allowed-"));
    const event = {
      id: "evt-task-created-bare-allowed",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-bare-allowed",
        title: "Bare allowed should not route",
        working_dir: "/tmp/open-todos",
        allowed: true,
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(true);
    expect(value.reason).toContain("missing explicit route opt-in");
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
