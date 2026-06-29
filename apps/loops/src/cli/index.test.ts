import { createHash } from "node:crypto";
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

  test("create agent rejects unsupported provider add dirs before storing", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-adddirs-"));

    const create = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "bad-cursor-adddirs",
      "--provider",
      "cursor",
      "--prompt",
      "noop",
      "--add-dir",
      "/tmp/hasna-todos",
      "--at",
      futureAt(),
    ]);

    expect(create.status).toBe(1);
    const value = JSON.parse(create.stdout);
    expect(value.created).toBe(false);
    expect(value.validation.error).toContain("addDirs is currently supported only for provider codewith or codex");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(0);
  });

  test("create agent supports prompt files without printing prompt contents", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-prompt-file-"));
    const promptFile = join(dataDir, "prompt.md");
    writeFileSync(promptFile, "SECRET_PROMPT_FILE_VALUE\nRun the check.\n");

    const create = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "prompt-file-agent",
      "--provider",
      "codewith",
      "--prompt-file",
      promptFile,
      "--at",
      futureAt(),
    ]);

    expect(create.status).toBe(0);
    expect(create.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    const value = JSON.parse(create.stdout);
    expect(value.target.prompt).toContain("[redacted");
    expect(value.target.promptSource).toEqual({ type: "file", path: promptFile });

    const show = runCli(dataDir, ["--json", "show", "prompt-file-agent"]);
    expect(show.status).toBe(0);
    expect(show.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    expect(JSON.parse(show.stdout).target.promptSource.path).toBe(promptFile);

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(list.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    expect(JSON.parse(list.stdout)[0].target.promptSource.path).toBe(promptFile);

    const humanShow = runCli(dataDir, ["show", "prompt-file-agent"]);
    expect(humanShow.status).toBe(0);
    expect(humanShow.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
  });

  test("create agent requires exactly one prompt source", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-prompt-source-"));
    const promptFile = join(dataDir, "prompt.md");
    writeFileSync(promptFile, "hello\n");

    const missing = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "missing-prompt",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
    ]);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).validation.error).toContain("prompt");

    const both = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "both-prompts",
      "--provider",
      "codewith",
      "--prompt",
      "inline",
      "--prompt-file",
      promptFile,
      "--at",
      futureAt(),
    ]);
    expect(both.status).toBe(1);
    expect(JSON.parse(both.stdout).validation.error).toContain("either prompt or promptFile");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
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

  test("rename changes only the loop name and writes a backup", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-rename-"));
    const create = runCli(dataDir, ["--json", "create", "command", "old-loop-name", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);

    const rename = runCli(dataDir, ["--json", "rename", created.id, "better-loop-name"]);

    expect(rename.status).toBe(0);
    const value = JSON.parse(rename.stdout);
    expect(value).toMatchObject({
      changed: true,
      id: created.id,
      oldName: "old-loop-name",
      newName: "better-loop-name",
    });
    expect(value.backupPath).toContain(join(dataDir, "backups"));
    expect(existsSync(value.backupPath)).toBe(true);

    const renamed = runCli(dataDir, ["--json", "show", created.id]);
    expect(renamed.status).toBe(0);
    const loop = JSON.parse(renamed.stdout);
    expect(loop.id).toBe(created.id);
    expect(loop.name).toBe("better-loop-name");
    expect(loop.schedule).toEqual(created.schedule);

    const oldName = runCli(dataDir, ["--json", "show", "old-loop-name"]);
    expect(oldName.status).not.toBe(0);
  });

  test("rename reports no-op without writing a backup", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-rename-noop-"));
    const create = runCli(dataDir, ["create", "command", "stable-name", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);

    const rename = runCli(dataDir, ["--json", "rename", "stable-name", " stable-name "]);

    expect(rename.status).toBe(0);
    const value = JSON.parse(rename.stdout);
    expect(value.changed).toBe(false);
    expect(value.backupPath).toBeUndefined();
    expect(value.newName).toBe("stable-name");
  });

  test("rename rejects duplicate and empty names", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-rename-invalid-"));
    expect(runCli(dataDir, ["create", "command", "first-loop", "--at", futureAt(), "--cmd", "true"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "second-loop", "--at", futureAt(), "--cmd", "true"]).status).toBe(0);

    const duplicate = runCli(dataDir, ["--json", "rename", "first-loop", "second-loop"]);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("loop name already exists");

    const empty = runCli(dataDir, ["--json", "rename", "first-loop", "   "]);
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain("loop name must not be empty");
  });

  test("rename preserves archived loop state", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-rename-archived-"));
    const create = runCli(dataDir, ["--json", "create", "command", "archived-rename-source", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(runCli(dataDir, ["archive", created.id]).status).toBe(0);

    const rename = runCli(dataDir, ["--json", "rename", created.id, "archived-rename-target"]);

    expect(rename.status).toBe(0);
    const value = JSON.parse(rename.stdout);
    expect(value.changed).toBe(true);
    expect(value.loop.archivedAt).toBeDefined();
    expect(value.loop.archivedFromStatus).toBeDefined();

    const show = runCli(dataDir, ["--json", "show", "archived-rename-target"]);
    expect(show.status).toBe(0);
    const loop = JSON.parse(show.stdout);
    expect(loop.id).toBe(created.id);
    expect(loop.archivedAt).toBeDefined();
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

  test("workflows create resolves relative promptFile and redacts output", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflow-prompt-file-"));
    writeFileSync(join(dataDir, "agent-prompt.md"), "SECRET_WORKFLOW_PROMPT_FILE\nReview only.\n");
    const file = workflowFile(dataDir, {
      name: "workflow-prompt-file",
      steps: [
        {
          id: "review",
          target: {
            type: "agent",
            provider: "codewith",
            promptFile: "agent-prompt.md",
          },
        },
      ],
    });

    const validate = runCli(dataDir, ["--json", "workflows", "validate", file]);
    expect(validate.status).toBe(0);
    expect(validate.stdout).not.toContain("SECRET_WORKFLOW_PROMPT_FILE");
    const validated = JSON.parse(validate.stdout);
    expect(validated.workflow.steps[0].target.prompt).toContain("[redacted");
    expect(validated.workflow.steps[0].target.promptSource.path).toBe(join(dataDir, "agent-prompt.md"));

    const create = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(create.status).toBe(0);
    expect(create.stdout).not.toContain("SECRET_WORKFLOW_PROMPT_FILE");

    const show = runCli(dataDir, ["--json", "workflows", "show", "workflow-prompt-file"]);
    expect(show.status).toBe(0);
    expect(show.stdout).not.toContain("SECRET_WORKFLOW_PROMPT_FILE");
    expect(JSON.parse(show.stdout).steps[0].target.promptSource.path).toBe(join(dataDir, "agent-prompt.md"));

    const list = runCli(dataDir, ["--json", "workflows", "list"]);
    expect(list.status).toBe(0);
    expect(list.stdout).not.toContain("SECRET_WORKFLOW_PROMPT_FILE");
    expect(JSON.parse(list.stdout)[0].steps[0].target.promptSource.path).toBe(join(dataDir, "agent-prompt.md"));
  });

  test("workflows validate and create report promptFile failures as structured redacted JSON", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflow-prompt-file-error-"));
    const file = workflowFile(dataDir, {
      name: "workflow-missing-prompt-file",
      steps: [
        {
          id: "review",
          target: {
            type: "agent",
            provider: "codewith",
            promptFile: "missing-secret-prompt.md",
          },
        },
      ],
    });

    const validate = runCli(dataDir, ["--json", "workflows", "validate", file]);
    expect(validate.status).toBe(1);
    expect(validate.stderr).toBe("");
    const validation = JSON.parse(validate.stdout);
    expect(validation.created).toBe(false);
    expect(validation.validation.ok).toBe(false);
    expect(validation.validation.error).toContain("promptFile could not be read");

    const create = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const created = JSON.parse(create.stdout);
    expect(created.created).toBe(false);
    expect(created.validation.ok).toBe(false);
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

  test("workflows list is complete by default and warns for explicit pages", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflows-list-complete-"));
    const store = new Store(join(dataDir, "loops.db"));
    try {
      for (let index = 0; index < 205; index += 1) {
        store.createWorkflow({
          name: `workflow-list-${String(index).padStart(3, "0")}`,
          steps: [{ id: "step", target: { type: "command", command: "true" } }],
        });
      }
    } finally {
      store.close();
    }

    const complete = runCli(dataDir, ["--json", "workflows", "list"]);
    expect(complete.status).toBe(0);
    expect(JSON.parse(complete.stdout)).toHaveLength(205);
    expect(complete.stderr).toBe("");

    const limited = runCli(dataDir, ["--json", "workflows", "list", "--limit", "10"]);
    expect(limited.status).toBe(0);
    expect(JSON.parse(limited.stdout)).toHaveLength(10);
    expect(limited.stderr).toContain("showing 10 of 205 active workflows");
    expect(limited.stderr).toContain("--offset 10");

    const archived = runCli(dataDir, ["--json", "workflows", "archive", "workflow-list-000"]);
    expect(archived.status).toBe(0);
    const all = runCli(dataDir, ["--json", "workflows", "list", "--all"]);
    expect(all.status).toBe(0);
    expect(JSON.parse(all.stdout)).toHaveLength(205);
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
      "todosProjectPath=/tmp/todos-store",
      "--var",
      "provider=codewith",
      "--var",
      "authProfile=account005",
      "--var",
      "sandbox=workspace-write",
      "--var",
      "addDirs=/tmp/todos-store,/tmp/loops-store",
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
      sandbox: "workspace-write",
      addDirs: ["/tmp/todos-store", "/tmp/loops-store"],
    });
    expect(workflow.steps[0].target.prompt).toContain("[redacted");
    expect(workflow.steps[1].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("Do not dispatch or paste prompts into tmux panes");
    expect(render.stdout).not.toContain("todos --project /tmp/todos-store inspect task-12345678");
    expect(workflow.steps[1].target.addDirs).toEqual(["/tmp/todos-store", "/tmp/loops-store"]);
    expect(workflow.steps[1].target.idleTimeoutMs).toBe(600_000);
    expect(workflow.steps[1].dependsOn).toEqual(["worker"]);
  });

  test("templates fail closed for danger-full-access unless manual break-glass is explicit", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-danger-sandbox-"));
    const rejected = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-danger-12345678",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "sandbox=danger-full-access",
    ]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("manual break-glass");

    const allowed = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-danger-12345678",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "sandbox=danger-full-access",
      "--var",
      "manualBreakGlass=true",
    ]);
    expect(allowed.status).toBe(0);
    const workflow = JSON.parse(allowed.stdout);
    expect(workflow.steps[0].target.sandbox).toBe("danger-full-access");
    expect(workflow.steps[0].target.allowlist.commands).toContain("manual-break-glass");
  });

  test("templates render lifecycle and deterministic producer workflows", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-lifecycle-"));
    const repo = createGitRepo("loops-cli-template-lifecycle-repo-");
    const list = runCli(dataDir, ["--json", "templates", "list"]);
    expect(list.status).toBe(0);
    const ids = JSON.parse(list.stdout).map((template: { id: string }) => template.id);
    expect(ids).toEqual(expect.arrayContaining([
      "task-lifecycle",
      "pr-review",
      "scheduled-audit",
      "knowledge-refresh",
      "report-only",
      "incident-response",
      "deterministic-check-create-task",
    ]));

    const prReview = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "pr-review",
      "--var",
      "prUrl=https://github.com/hasna/loops/pull/123",
      "--var",
      `projectPath=${repo}`,
    ]);
    expect(prReview.status).toBe(0);
    const prWorkflow = JSON.parse(prReview.stdout);
    expect(prWorkflow.name).toContain("pr-review");
    expect(prWorkflow.steps.map((step: { id: string }) => step.id)).toEqual(["prepare-worktree", "worker", "verifier"]);
    expect(prWorkflow.steps[1].target.worktree.mode).toBe("required");

    const deterministic = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "deterministic-check-create-task",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "checkCommand=echo ok",
    ]);
    expect(deterministic.status).toBe(0);
    const deterministicWorkflow = JSON.parse(deterministic.stdout);
    expect(deterministicWorkflow.steps).toHaveLength(1);
    expect(deterministicWorkflow.steps[0].target.type).toBe("command");
    expect(deterministicWorkflow.steps[0].target.args).toEqual(["-lc", "echo ok"]);

    const reportOnly = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "report-only",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "objective=Inspect recent work and write a report only",
    ]);
    expect(reportOnly.status).toBe(0);
    const reportWorkflow = JSON.parse(reportOnly.stdout);
    expect(reportWorkflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(reportWorkflow.steps.map((step: { target: { sandbox?: string } }) => step.target.sandbox)).toEqual(["read-only", "read-only"]);
    expect(reportWorkflow.steps.map((step: { target: { worktree?: { mode?: string } } }) => step.target.worktree?.mode)).toEqual(["main", "main"]);
  });

  test("templates show explains task-lifecycle variables and usage", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-template-show-"));

    const show = runCli(dataDir, ["templates", "show", "task-lifecycle"]);

    expect(show.status).toBe(0);
    expect(show.stdout).toContain("task-lifecycle (workflow)");
    expect(show.stdout).toContain("Task Lifecycle");
    expect(show.stdout).toContain("Run the standard task-created lifecycle");
    expect(show.stdout).toContain("taskId");
    expect(show.stdout).toContain("required");
    expect(show.stdout).toContain("worktreeMode");
    expect(show.stdout).toContain("default=required");
    expect(show.stdout).toContain("loops templates render task-lifecycle");
    expect(show.stdout).toContain("loops templates create-workflow task-lifecycle");
  });

  test("custom templates import, list, show, render, and create workflow", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-custom-template-"));
    const sourceFile = join(dataDir, "custom-report-template.json");
    writeFileSync(sourceFile, JSON.stringify({
      id: "custom-report",
      name: "Custom Report",
      description: "Run a custom report workflow from the local template registry.",
      kind: "workflow",
      variables: [
        { name: "objective", required: true, description: "Report objective." },
        { name: "projectPath", required: true, description: "Working directory." },
        { name: "provider", default: "codewith", description: "Agent provider." },
        { name: "sandbox", default: "workspace-write", description: "Sandbox mode." },
        { name: "timeoutMs", default: "300000", type: "number", description: "Step timeout." },
      ],
      workflow: {
        name: "custom-report-${objective}",
        description: "Report workflow for ${objective}",
        version: 1,
        steps: [
          {
            id: "worker",
            name: "Worker",
            description: "Produce the custom report.",
            target: {
              type: "agent",
              provider: "${provider}",
              prompt: "/goal ${objective}\nProduce the requested report only.",
              cwd: "${projectPath}",
              configIsolation: "safe",
              permissionMode: "bypass",
              sandbox: "${sandbox}",
              timeoutMs: "${timeoutMs}",
            },
            timeoutMs: "${timeoutMs}",
          },
        ],
      },
    }));

    const imported = runCli(dataDir, ["--json", "templates", "import", sourceFile]);
    expect(imported.status).toBe(0);
    const importResult = JSON.parse(imported.stdout);
    expect(importResult.template).toMatchObject({ id: "custom-report", source: "custom" });
    expect(importResult.path).toContain(join(dataDir, "templates", "custom-report.json"));

    const list = runCli(dataDir, ["--json", "templates", "list"]);
    expect(list.status).toBe(0);
    const listed = JSON.parse(list.stdout) as Array<{ id: string; source: string }>;
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "todos-task-worker-verifier", source: "builtin" }),
      expect.objectContaining({ id: "custom-report", source: "custom" }),
    ]));

    const customOnly = runCli(dataDir, ["--json", "templates", "list", "--source", "custom"]);
    expect(customOnly.status).toBe(0);
    expect(JSON.parse(customOnly.stdout).map((template: { id: string }) => template.id)).toEqual(["custom-report"]);

    const show = runCli(dataDir, ["--json", "templates", "show", "custom-report"]);
    expect(show.status).toBe(0);
    const shown = JSON.parse(show.stdout);
    expect(shown.source).toBe("custom");
    expect(shown.sourcePath).toContain("custom-report.json");

    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "custom-report",
      "--var",
      "objective=Docs drift",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "timeoutMs=120000",
    ]);
    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toBe("custom-report-Docs drift");
    expect(workflow.steps[0].target).toMatchObject({
      type: "agent",
      provider: "codewith",
      cwd: "/tmp/repo",
      sandbox: "workspace-write",
      timeoutMs: 120000,
    });
    expect(workflow.steps[0].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("/goal Docs drift");
    expect(workflow.steps[0].timeoutMs).toBe(120000);

    const created = runCli(dataDir, [
      "--json",
      "templates",
      "create-workflow",
      "custom-report",
      "--var",
      "objective=Docs drift",
      "--var",
      "projectPath=/tmp/repo",
    ]);
    expect(created.status).toBe(0);
    const stored = JSON.parse(created.stdout);
    expect(stored.name).toBe("custom-report-Docs drift");
    expect(stored.steps).toHaveLength(1);
  });

  test("custom templates fail closed for invalid and dangerous definitions", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-custom-template-invalid-"));
    const registryDir = join(dataDir, "templates");
    mkdirSync(registryDir, { recursive: true });
    const dangerous = join(registryDir, "danger.json");
    writeFileSync(dangerous, JSON.stringify({
      id: "danger",
      name: "Danger",
      description: "Dangerous custom workflow.",
      kind: "workflow",
      workflow: {
        name: "danger",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "/goal danger",
              sandbox: "danger-full-access",
            },
          },
        ],
      },
    }));

    const list = runCli(dataDir, ["--json", "templates", "list", "--source", "custom"]);
    expect(list.status).not.toBe(0);
    expect(list.stderr).toContain("danger-full-access");

    const invalidDataDir = mkdtempSync(join(tmpdir(), "loops-cli-custom-template-invalid-shape-"));
    const invalidFile = join(invalidDataDir, "invalid-template.json");
    writeFileSync(invalidFile, JSON.stringify({ id: "invalid", name: "Invalid", kind: "workflow" }));
    const imported = runCli(invalidDataDir, ["--json", "templates", "import", invalidFile]);
    expect(imported.status).not.toBe(0);
    expect(imported.stderr).toContain("description");

    const invalidRequiredFile = join(invalidDataDir, "invalid-required-template.json");
    writeFileSync(invalidRequiredFile, JSON.stringify({
      id: "invalid-required",
      name: "Invalid Required",
      description: "Invalid required flag.",
      kind: "workflow",
      variables: [{ name: "objective", required: "false" }],
      workflow: {
        name: "invalid-required",
        steps: [{ id: "check", target: { type: "command", command: "true" } }],
      },
    }));
    const invalidRequired = runCli(invalidDataDir, ["--json", "templates", "import", invalidRequiredFile]);
    expect(invalidRequired.status).not.toBe(0);
    expect(invalidRequired.stderr).toContain("required");

    const implicitDangerDataDir = mkdtempSync(join(tmpdir(), "loops-cli-custom-template-implicit-danger-"));
    const implicitDangerFile = join(implicitDangerDataDir, "implicit-danger-template.json");
    writeFileSync(implicitDangerFile, JSON.stringify({
      id: "implicit-danger",
      name: "Implicit Danger",
      description: "Codewith bypass without explicit sandbox.",
      kind: "workflow",
      workflow: {
        name: "implicit-danger",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "/goal implicit danger",
              permissionMode: "bypass",
            },
          },
        ],
      },
    }));
    const implicitDanger = runCli(implicitDangerDataDir, ["--json", "templates", "import", implicitDangerFile]);
    expect(implicitDanger.status).not.toBe(0);
    expect(implicitDanger.stderr).toContain("explicit sandbox");

    const extraArgsDangerDataDir = mkdtempSync(join(tmpdir(), "loops-cli-custom-template-extra-args-danger-"));
    const extraArgsDangerFile = join(extraArgsDangerDataDir, "extra-args-danger-template.json");
    writeFileSync(extraArgsDangerFile, JSON.stringify({
      id: "extra-args-danger",
      name: "Extra Args Danger",
      description: "Dangerous sandbox hidden in extra args.",
      kind: "workflow",
      workflow: {
        name: "extra-args-danger",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "/goal extra args danger",
              sandbox: "workspace-write",
              extraArgs: ["--sandbox", "danger-full-access"],
            },
          },
        ],
      },
    }));
    const extraArgsDanger = runCli(extraArgsDangerDataDir, ["--json", "templates", "import", extraArgsDangerFile]);
    expect(extraArgsDanger.status).not.toBe(0);
    expect(extraArgsDanger.stderr).toContain("dangerous sandbox");

    const promptFileDataDir = mkdtempSync(join(tmpdir(), "loops-cli-custom-template-prompt-file-"));
    const promptFileTemplate = join(promptFileDataDir, "prompt-file-template.json");
    writeFileSync(promptFileTemplate, JSON.stringify({
      id: "prompt-file-template",
      name: "Prompt File Template",
      description: "Custom template must not read local prompt files.",
      kind: "workflow",
      workflow: {
        name: "prompt-file-template",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              promptFile: "/tmp/secret-prompt.md",
              sandbox: "workspace-write",
            },
          },
        ],
      },
    }));
    const promptFileImport = runCli(promptFileDataDir, ["--json", "templates", "import", promptFileTemplate]);
    expect(promptFileImport.status).not.toBe(0);
    expect(promptFileImport.stderr).toContain("promptFile is not allowed in custom templates");

    const safeDataDir = mkdtempSync(join(tmpdir(), "loops-cli-custom-template-safe-render-"));
    const safeFile = join(safeDataDir, "safe-template.json");
    writeFileSync(safeFile, JSON.stringify({
      id: "safe-custom",
      name: "Safe Custom",
      description: "Custom template with sandbox variable.",
      kind: "workflow",
      variables: [
        { name: "sandbox", default: "workspace-write" },
      ],
      workflow: {
        name: "safe-custom",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "/goal safe",
              sandbox: "${sandbox}",
            },
          },
        ],
      },
    }));
    const safeImport = runCli(safeDataDir, ["--json", "templates", "import", safeFile]);
    expect(safeImport.status).toBe(0);
    const render = runCli(safeDataDir, [
      "--json",
      "templates",
      "render",
      "safe-custom",
      "--var",
      "sandbox=danger-full-access",
    ]);
    expect(render.status).not.toBe(0);
    expect(render.stderr).toContain("danger-full-access");
  });

  test("custom templates cannot override built-in template ids", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-custom-template-collision-"));
    const collisionFile = join(dataDir, "collision-template.json");
    writeFileSync(collisionFile, JSON.stringify({
      id: "todos-task-worker-verifier",
      name: "Collision",
      description: "This must not override the built-in template.",
      kind: "workflow",
      workflow: {
        name: "collision",
        steps: [
          {
            id: "worker",
            target: {
              type: "command",
              command: "true",
            },
          },
        ],
      },
    }));

    const imported = runCli(dataDir, ["--json", "templates", "import", collisionFile]);
    expect(imported.status).not.toBe(0);
    expect(imported.stderr).toContain("collides with built-in");

    const firstCustomFile = join(dataDir, "first-custom-template.json");
    writeFileSync(firstCustomFile, JSON.stringify({
      id: "custom-one",
      name: "Custom One",
      description: "First custom template.",
      kind: "workflow",
      workflow: {
        name: "custom-one",
        steps: [{ id: "check", target: { type: "command", command: "true" } }],
      },
    }));
    expect(runCli(dataDir, ["--json", "templates", "import", firstCustomFile]).status).toBe(0);

    const customNameCollisionFile = join(dataDir, "custom-name-collision-template.json");
    writeFileSync(customNameCollisionFile, JSON.stringify({
      id: "custom-two",
      name: "custom-one",
      description: "Second custom template with name colliding with an existing id.",
      kind: "workflow",
      workflow: {
        name: "custom-two",
        steps: [{ id: "check", target: { type: "command", command: "true" } }],
      },
    }));
    const customNameCollision = runCli(dataDir, ["--json", "templates", "import", customNameCollisionFile]);
    expect(customNameCollision.status).not.toBe(0);
    expect(customNameCollision.stderr).toContain("collides with");

    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-collision-12345678",
      "--var",
      "projectPath=/tmp/repo",
    ]);
    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("todos-task-task-col");
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
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
    expect(workflow.steps[1].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("Use the isolated git worktree");
    expect(render.stdout).not.toContain("Do not mutate the original checkout/main branch");
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
    expect(workflow.steps[0].target.prompt).toContain("[redacted");
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
      "sandbox=workspace-write",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("bounded-agent");
    expect(workflow.name).toMatch(/^bounded-agent-[a-f0-9]{8}-worker-verifier$/);
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(workflow.steps[0].target.prompt).toContain("[redacted");
    expect(workflow.steps[1].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("/goal Check repo docs drift");
    expect(render.stdout).not.toContain("Inspect only recent commits and queue tasks for gaps.");
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
      "--todos-project",
      "/tmp/todos-store",
      "--add-dir",
      "/tmp/todos-store,/tmp/loops-store",
      "--sandbox",
      "workspace-write",
      "--permission-mode",
      "bypass",
    ];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.idempotencyKey).toBe("todos-task:task-created-0001");
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
        sandbox: "workspace-write",
        addDirs: ["/tmp/todos-store", "/tmp/loops-store"],
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

  test("todos task event handler replaces stale generated workflow policy metadata", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-stale-workflow-"));
    const event = {
      id: "evt-task-stale-policy-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-stale-policy-0001",
        title: "Refresh generated route policy",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--provider",
      "codewith",
      "--sandbox",
      "danger-full-access",
      "--manual-break-glass",
      "--permission-mode",
      "bypass",
    ];

    const preview = runCli(dataDir, [...args, "--dry-run"], JSON.stringify(event));
    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    const staleWorkflow = {
      name: previewValue.workflow.name,
      description: "stale generated route workflow missing breakglass metadata",
      version: 1,
      steps: previewValue.workflow.steps.map((step: { target: Record<string, unknown> }) => ({
        ...step,
        target: {
          ...step.target,
          allowlist: undefined,
        },
      })),
    };
    const staleCreated = runCli(dataDir, ["--json", "workflows", "create", workflowFile(dataDir, staleWorkflow)]);
    expect(staleCreated.status).toBe(0);
    const staleValue = JSON.parse(staleCreated.stdout);

    const routed = runCli(dataDir, args, JSON.stringify(event));
    expect(routed.status).toBe(0);
    const routedValue = JSON.parse(routed.stdout);
    expect(routedValue.workflow.id).not.toBe(staleValue.id);
    expect(routedValue.workflow.steps[0].target.allowlist.commands).toContain("manual-break-glass");

    const staleAfter = runCli(dataDir, ["--json", "workflows", "show", staleValue.id]);
    expect(staleAfter.status).toBe(0);
    expect(JSON.parse(staleAfter.stdout).status).toBe("archived");
  });

  test("routes commands expose workflow invocation admission state", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-routes-list-"));
    const event = {
      id: "evt-routes-list-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-list-0001",
        title: "Expose route state",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const created = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(created.status).toBe(0);
    const createdValue = JSON.parse(created.stdout);
    expect(createdValue.workItem.status).toBe("admitted");

    const routes = runCli(dataDir, ["--json", "routes", "list"]);
    expect(routes.status).toBe(0);
    const routeRows = JSON.parse(routes.stdout);
    expect(routeRows).toHaveLength(1);
    expect(routeRows[0].id).toBe(createdValue.workItem.id);
    expect(routeRows[0].routeKey).toBe("todos-task");

    const shown = runCli(dataDir, ["--json", "routes", "show", createdValue.workItem.id]);
    expect(shown.status).toBe(0);
    const shownValue = JSON.parse(shown.stdout);
    expect(shownValue.item.id).toBe(createdValue.workItem.id);
    expect(shownValue.invocation.id).toBe(createdValue.invocation.id);
    expect(shownValue.loop.id).toBe(createdValue.loop.id);
  });

  test("routes preview, create, and schedule expose first-class route lifecycle commands", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-routes-lifecycle-"));
    const event = {
      id: "evt-routes-lifecycle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-lifecycle-0001",
        title: "Route from routes command",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    expect(previewValue.loop.workflowId).toBeUndefined();
    expect(previewValue.sandboxPreflight[0].method).toBe("provider-native-sandbox");

    const created = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--sandbox",
      "workspace-write",
    ]);
    expect(created.status).toBe(0);
    const createdValue = JSON.parse(created.stdout);
    expect(createdValue.workItem.status).toBe("admitted");
    expect(createdValue.loop.target.input.workflowWorkItemId).toBe(createdValue.workItem.id);

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-test",
      "--every",
      "5m",
      "--task-list",
      "oss",
      "--max-dispatch",
      "2",
      "--sandbox",
      "workspace-write",
    ]);
    expect(scheduled.status).toBe(0);
    const loop = JSON.parse(scheduled.stdout);
    expect(loop.name).toBe("route-drain-test");
    expect(loop.target.command).toBe("loops");
    expect(loop.target.args).toEqual(expect.arrayContaining(["events", "drain", "todos-task", "--task-list", "oss", "--max-dispatch", "2"]));
  });

  test("todos task routes can select the full task-lifecycle template", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-routes-task-lifecycle-"));
    const event = {
      id: "evt-routes-task-lifecycle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-task-lifecycle-0001",
        title: "Route through full lifecycle",
        description: "Exercise triage, planner, worker, and verifier.",
        working_dir: "/tmp/open-codewith",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "task-lifecycle",
      "--triage-auth-profile",
      "account004",
      "--planner-auth-profile",
      "account005",
      "--worker-auth-profile",
      "account006",
      "--verifier-auth-profile",
      "account007",
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    expect(previewValue.invocation.templateId).toBe("task-lifecycle");
    expect(previewValue.invocation.scope.accountPolicy).toBe("role-explicit");
    expect(previewValue.workflow.steps.map((step: { id: string }) => step.id)).toEqual([
      "triage",
      "triage-gate",
      "planner",
      "planner-gate",
      "worker",
      "verifier",
    ]);
    const stepsById = Object.fromEntries(previewValue.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    expect(stepsById.triage.target.authProfile).toBe("account004");
    expect(stepsById.planner.target.authProfile).toBe("account005");
    expect(stepsById.worker.target.authProfile).toBe("account006");
    expect(stepsById.verifier.target.authProfile).toBe("account007");
    expect(stepsById.planner.dependsOn).toEqual(["triage-gate"]);
    expect(stepsById.worker.dependsOn).toEqual(["planner-gate"]);
    expect(stepsById["triage-gate"].target.type).toBe("command");
    expect(stepsById["triage-gate"].target.args.join("\n")).toContain("--json inspect");
    expect(stepsById["triage-gate"].target.args.join("\n")).toContain("openloops:triage=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001");
    expect(stepsById["planner-gate"].target.args.join("\n")).toContain("openloops:planner=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001");
    expect(stepsById["triage-gate"].target.args.join("\n")).toContain("task lifecycle ${stage} gate blocked");
    expect(stepsById["planner-gate"].target.args.join("\n")).toContain("task lifecycle ${stage} gate blocked");
    expect(previewValue.workflow.description).toContain("task-lifecycle");

    const fakeBin = join(dataDir, "fake-bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeTodos = join(fakeBin, "todos");
    writeFileSync(fakeTodos, "#!/usr/bin/env bash\nprintf '%s' \"$FAKE_TODOS_JSON\"\n");
    chmodSync(fakeTodos, 0o755);
    const runGate = (stepId: "triage-gate" | "planner-gate", task: Record<string, unknown>) => spawnSync(
      "bash",
      ["-lc", `PATH=${JSON.stringify(fakeBin)}:$PATH\n${stepsById[stepId].target.args[1]}`],
      {
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, FAKE_TODOS_JSON: JSON.stringify(task) },
        encoding: "utf8",
      },
    );
    const baseTask = {
      id: "task-routes-task-lifecycle-0001",
      status: "pending",
      tags: ["auto:route"],
      comments: [{ content: "openloops:triage=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001\neligible" }],
    };
    expect(runGate("triage-gate", baseTask).status).toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      comments: [{ content: "not adding openloops:triage=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001" }],
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      requires_approval: true,
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      tags: ["auto:route", "no-auto"],
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      manual_required: true,
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      comments: [
        { content: "openloops:triage=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001\nold", created_at: "2026-01-01T00:00:00.000Z" },
        { content: "openloops:triage=blocked task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001\nnew", created_at: "2026-01-01T00:01:00.000Z" },
      ],
    }).status).not.toBe(0);
    expect(runGate("planner-gate", {
      ...baseTask,
      comments: [{ content: "openloops:planner=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001\nplan" }],
    }).status).toBe(0);

    const invalid = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "pr-review",
    ]);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("--template must be todos-task-worker-verifier or task-lifecycle");
  });

  test("routes schedule preserves selected todos task template in the drain loop", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-routes-template-schedule-"));

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-template-test",
      "--every",
      "5m",
      "--template",
      "task-lifecycle",
      "--triage-auth-profile",
      "account004",
      "--planner-auth-profile",
      "account005",
      "--task-list",
      "oss",
      "--max-dispatch",
      "2",
      "--sandbox",
      "workspace-write",
    ]);
    expect(scheduled.status).toBe(0);
    const loop = JSON.parse(scheduled.stdout);
    expect(loop.target.args).toEqual(expect.arrayContaining(["--template", "task-lifecycle"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--triage-auth-profile", "account004", "--planner-auth-profile", "account005"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--max-dispatch", "2"]));
  });

  test("todos task lifecycle routes preserve explicit OpenAccounts role accounts", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-routes-task-lifecycle-accounts-"));
    const repo = createGitRepo("loops-cli-routes-task-lifecycle-accounts-repo-");
    const event = {
      id: "evt-routes-task-lifecycle-accounts-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-task-lifecycle-accounts-0001",
        title: "Route through full lifecycle with OpenAccounts",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "task-lifecycle",
      "--provider",
      "claude",
      "--account-tool",
      "claude",
      "--triage-account",
      "triage-profile",
      "--planner-account",
      "planner-profile",
      "--worker-account",
      "worker-profile",
      "--verifier-account",
      "verifier-profile",
      "--worktree-mode",
      "required",
    ]);

    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    expect(previewValue.invocation.scope.accountPolicy).toBe("role-explicit");
    const stepsById = Object.fromEntries(previewValue.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    expect(stepsById.triage.target.account).toEqual({ profile: "triage-profile", tool: "claude" });
    expect(stepsById.planner.target.account).toEqual({ profile: "planner-profile", tool: "claude" });
    expect(stepsById.worker.target.account).toEqual({ profile: "worker-profile", tool: "claude" });
    expect(stepsById.verifier.target.account).toEqual({ profile: "verifier-profile", tool: "claude" });
    expect(stepsById.triage.dependsOn).toEqual(["prepare-worktree"]);
    expect(stepsById.worker.dependsOn).toEqual(["planner-gate"]);
  });

  test("routes schedule rejects drain dry-run instead of storing a surprising loop", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-routes-schedule-dry-run-"));

    const scheduled = runCli(dataDir, [
      "routes",
      "schedule",
      "todos-task",
      "route-drain-dry-run",
      "--every",
      "5m",
      "--dry-run",
    ]);

    expect(scheduled.status).not.toBe(0);
    expect(scheduled.stderr).toContain("unknown option '--dry-run'");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("docs include the OSS task route drain safety recipe", () => {
    const usage = readFileSync(new URL("../../docs/USAGE.md", import.meta.url), "utf8");

    expect(usage).toContain("/home/hasna/workspace/hasna/opensource");
    expect(usage).toContain("--tags auto:route");
    expect(usage).toContain("--auth-profile-pool account004,account005,account006");
    expect(usage).toContain("--worktree-mode required");
    expect(usage).toContain("--max-active-per-project");
    expect(usage).toContain("--evidence-dir");
    expect(usage).toMatch(/Do not dispatch\s+or paste task prompts into tmux panes/);
  });

  test("routes create replaces a stale persisted unsafe workflow with the same generated name", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-routes-unsafe-existing-"));
    const event = {
      id: "evt-routes-unsafe-existing-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-unsafe-existing-0001",
        title: "Unsafe existing route workflow",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const suffix = createHash("sha256").update("todos-task:task-routes-unsafe-existing-0001").digest("hex").slice(0, 12);
    const workflowName = `event:todos-task:task-rou:${suffix}:workflow`;
    let staleWorkflowId = "";
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const staleWorkflow = store.createWorkflow({
        name: workflowName,
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "unsafe old workflow",
              sandbox: "danger-full-access",
            },
          },
        ],
      });
      staleWorkflowId = staleWorkflow.id;
    } finally {
      store.close();
    }

    const result = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--sandbox",
      "workspace-write",
    ]);
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.workflow.id).not.toBe(staleWorkflowId);
    expect(value.workflow.steps[0].target.sandbox).toBe("workspace-write");

    const staleAfter = runCli(dataDir, ["--json", "workflows", "show", staleWorkflowId]);
    expect(staleAfter.status).toBe(0);
    expect(JSON.parse(staleAfter.stdout).status).toBe("archived");
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

  test("todos task event handler refreshes invocation metadata when admitting a deferred task with a new template", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-reroute-template-"));
    const repo = createGitRepo("loops-cli-event-handler-reroute-template-repo-");
    const baseEvent = {
      type: "task.created",
      source: "@hasna/todos",
      data: {
        title: "Queue rerouted project task",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const throttledArgs = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--max-active-per-project",
      "1",
    ];

    const first = runCli(dataDir, throttledArgs, JSON.stringify({
      ...baseEvent,
      id: "evt-reroute-template-active",
      data: { ...baseEvent.data, id: "task-reroute-template-active" },
    }));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.workItem.status).toBe("admitted");
    expect(firstValue.invocation.templateId).toBe("todos-task-worker-verifier");

    const activeDedupe = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--template",
      "task-lifecycle",
    ], JSON.stringify({
      ...baseEvent,
      id: "evt-reroute-template-active-again",
      data: { ...baseEvent.data, id: "task-reroute-template-active" },
    }));
    expect(activeDedupe.status).toBe(0);
    const activeDedupeValue = JSON.parse(activeDedupe.stdout);
    expect(activeDedupeValue.deduped).toBe(true);
    expect(activeDedupeValue.invocation.id).toBe(firstValue.invocation.id);
    expect(activeDedupeValue.invocation.templateId).toBe("todos-task-worker-verifier");
    expect(activeDedupeValue.invocation.sourceRef.id).toBe("evt-reroute-template-active");

    const deferred = runCli(dataDir, throttledArgs, JSON.stringify({
      ...baseEvent,
      id: "evt-reroute-template-deferred",
      data: { ...baseEvent.data, id: "task-reroute-template-deferred" },
    }));
    expect(deferred.status).toBe(0);
    const deferredValue = JSON.parse(deferred.stdout);
    expect(deferredValue.skipped).toBe(true);
    expect(deferredValue.workItem.status).toBe("deferred");
    expect(deferredValue.invocation.templateId).toBe("todos-task-worker-verifier");

    const admitted = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--template",
      "task-lifecycle",
      "--auth-profile-pool",
      "account004,account005",
      "--worktree-mode",
      "required",
    ], JSON.stringify({
      ...baseEvent,
      id: "evt-reroute-template-deferred-again",
      data: { ...baseEvent.data, id: "task-reroute-template-deferred" },
    }));
    expect(admitted.status).toBe(0);
    const admittedValue = JSON.parse(admitted.stdout);
    expect(admittedValue.workItem.id).toBe(deferredValue.workItem.id);
    expect(admittedValue.workItem.status).toBe("admitted");
    expect(admittedValue.invocation.id).toBe(deferredValue.invocation.id);
    expect(admittedValue.invocation.templateId).toBe("task-lifecycle");
    expect(admittedValue.invocation.sourceRef.id).toBe("evt-reroute-template-deferred-again");
    expect(admittedValue.invocation.scope.accountPolicy).toBe("pool");
    expect(admittedValue.invocation.scope.worktreePolicy).toBe("required");
    expect(admittedValue.invocation.outputPolicy.createTask).toBe("on_failure");
    expect(admittedValue.workflow.steps.map((step: { id: string }) => step.id)).toContain("triage");

    const shown = runCli(dataDir, ["--json", "routes", "show", admittedValue.workItem.id]);
    expect(shown.status).toBe(0);
    const shownValue = JSON.parse(shown.stdout);
    expect(shownValue.invocation.templateId).toBe("task-lifecycle");
    expect(shownValue.invocation.sourceRef.id).toBe("evt-reroute-template-deferred-again");
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
    ], JSON.stringify({
      ...event,
      id: "evt-dedupe-before-render-0002",
      data: {
        ...event.data,
        working_dir: "/tmp/not-a-real-openloops-required-repo",
      },
    }));

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
        "--add-dir",
        join(dataDir, "todos-store"),
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
    const worker = value.results[0].workflow.steps.find((step: { id: string }) => step.id === "worker");
    expect(worker.target.addDirs).toEqual([join(dataDir, "todos-store")]);
  });

  test("todos task drain skips non-routeable tasks and continues dispatching", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-skip-non-git-"));
    const binDir = join(dataDir, "bin");
    const repo = createGitRepo("loops-cli-event-drain-skip-non-git-repo-");
    const nonGit = join(dataDir, "not-a-repo");
    mkdirSync(nonGit, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
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
        id: "task-drain-non-git",
        title: "Bad route task",
        status: "pending",
        working_dir: nonGit,
        tags: ["auto:route"],
      },
      {
        id: "task-drain-good-repo",
        title: "Good route task",
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
        "--worktree-mode",
        "required",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.considered).toBe(2);
    expect(value.skipped).toBe(1);
    expect(value.created).toBe(1);
    expect(value.results[0]).toMatchObject({
      kind: "skipped",
      taskId: "task-drain-non-git",
      routeError: true,
    });
    expect(value.results[0].reason).toContain("worktreeMode=required");
    expect(value.results[1].kind).toBe("created");
    expect(value.results[1].event.subject).toBe("task-drain-good-repo");

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

  test("todos task drain compact output omits bulky task and workflow details", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-compact-"));
    const binDir = join(dataDir, "bin");
    const evidenceDir = join(dataDir, "evidence");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '%s' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const bulkyDetail = "very long private task details ".repeat(200);
    const ready = [
      {
        id: "task-drain-compact",
        project_id: "project-route",
        title: "Compact route task",
        description: bulkyDetail,
        status: "pending",
        task_list_id: "list-route",
        working_dir: dataDir,
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
        "--task-list",
        "route",
        "--compact",
        "--evidence-dir",
        evidenceDir,
        "--max-dispatch",
        "1",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("very long private task details");
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(1);
    expect(value.results[0]).toMatchObject({
      kind: "created",
      taskId: "task-drain-compact",
    });
    expect(value.results[0].event).toBeUndefined();
    expect(value.results[0].workflow).toBeUndefined();
    expect(existsSync(value.evidencePath)).toBe(true);
    const evidence = readFileSync(value.evidencePath, "utf8");
    expect(evidence).toContain("very long private task details");
  });

  test("todos task drain derives project path from repository line in task descriptions", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-repo-line-"));
    const repo = createGitRepo("loops-cli-event-drain-repo-line-repo-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '%s' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-repo-line",
        project_id: "project-route",
        title: "Route PR task with unstructured repo path",
        description: `Fingerprint: github-pr:hasna/example#1\nRepository: ${repo}\nPR: https://github.com/hasna/example/pull/1`,
        status: "pending",
        task_list_id: "list-route",
        working_dir: "/home/hasna",
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
        "--task-list",
        "route",
        "--project-path-prefix",
        repo,
        "--project-path",
        "/home/hasna",
        "--tags",
        "auto:route",
        "--dry-run",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.filteredCandidates).toBe(1);
    expect(value.created).toBe(1);
    expect(value.results[0].event.data.cwd).toBe(repo);
    expect(value.results[0].event.data.project_path).toBe(repo);
    expect(value.results[0].workflow.steps[0].target.cwd).toBe(repo);
  });

  test("todos task drain parses large ready payloads without truncating JSON", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-large-ready-"));
    const binDir = join(dataDir, "bin");
    const readyFile = join(dataDir, "ready.json");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then cat \"$TODOS_READY_FILE\"; exit 0; fi",
        "done",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '[]\\n'; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    writeFileSync(
      readyFile,
      JSON.stringify([
        {
          id: "task-drain-large-ready",
          title: "Large ready task",
          status: "pending",
          description: "x".repeat(9 * 1024 * 1024),
          tags: ["manual"],
        },
      ]),
    );

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--tags",
        "auto:route",
        "--dry-run",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_FILE: readyFile },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.scanned).toBe(1);
    expect(value.filteredCandidates).toBe(0);
    expect(value.considered).toBe(0);
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

  test("todos task event handler --preflight replaces stale generated workflows before storing loop", () => {
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
    let staleWorkflowId = "";
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const staleWorkflow = store.createWorkflow({
        name: previewValue.workflow.name,
        steps: [{ id: "stale", target: { type: "command", command: "openloops-definitely-missing-binary" } }],
      });
      staleWorkflowId = staleWorkflow.id;
    } finally {
      store.close();
    }

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task", "--preflight"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.workflow.id).not.toBe(staleWorkflowId);
    expect(value.loop.target.workflowId).toBe(value.workflow.id);
    const loops = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(loops.stdout)).toHaveLength(1);

    const staleAfter = runCli(dataDir, ["--json", "workflows", "show", staleWorkflowId]);
    expect(staleAfter.status).toBe(0);
    expect(JSON.parse(staleAfter.stdout).status).toBe("archived");
  });

  test("todos task event handler ignores legacy event-id loop names and dedupes through work items", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-no-legacy-dedupe-"));
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
    expect(value.deduped).toBe(false);
    expect(value.loop.id).not.toBe(legacyLoopId);
    expect(value.workItem.status).toBe("admitted");

    const replay = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify({ ...event, id: "evt-task-created-legacy-replay" }));
    expect(replay.status).toBe(0);
    const replayValue = JSON.parse(replay.stdout);
    expect(replayValue.deduped).toBe(true);
    expect(replayValue.dedupedBy).toBe("work-item");
    expect(replayValue.workItem.id).toBe(value.workItem.id);
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
    expect(value.idempotencyKey).toBe("todos-task:task-created-cross-prefix");
    expect(value.loop.id).toBe(created.loop.id);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler dedupes task updates against the same task route", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-task-update-dedupe-"));
    const event = {
      id: "evt-task-created-update-dedupe-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-update-dedupe",
        title: "Only one worker per task",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const update = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-update-dedupe-b", type: "task.updated" }),
    );
    expect(update.status).toBe(0);
    const value = JSON.parse(update.stdout);
    expect(value.deduped).toBe(true);
    expect(value.idempotencyKey).toBe("todos-task:task-created-update-dedupe");
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
        "workspace-write",
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
      "--add-dir",
      "/tmp/knowledge-store,/tmp/loops-store",
      "--sandbox",
      "workspace-write",
      "--permission-mode",
      "bypass",
    ];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.workItem.status).toBe("admitted");
    expect(firstValue.workItem.routeKey).toBe("generic-event");
    expect(firstValue.invocation.sourceRef.kind).toBe("event");
    expect(firstValue.workflow.name).toContain("event:generic:knowledge:knowledge.record.created");
    expect(firstValue.workflow.steps[0].target.cwd).toBe("/tmp/open-knowledge");
    expect(firstValue.workflow.steps[0].target.addDirs).toEqual(["/tmp/knowledge-store", "/tmp/loops-store"]);
    expect(firstValue.workflow.steps[1].target.addDirs).toEqual(["/tmp/knowledge-store", "/tmp/loops-store"]);
    expect(firstValue.loop.target.input.workflowInvocationId).toBe(firstValue.invocation.id);
    expect(firstValue.loop.target.input.workflowWorkItemId).toBe(firstValue.workItem.id);
    const profiles = firstValue.workflow.steps.map((step: { target: { authProfile?: string } }) => step.target.authProfile);
    expect(new Set(profiles).size).toBe(2);

    const second = runCli(dataDir, args, JSON.stringify(event));
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue.deduped).toBe(true);
    expect(secondValue.dedupedBy).toBe("work-item");
    expect(secondValue.workItem.id).toBe(firstValue.workItem.id);
    expect(secondValue.loop.id).toBe(firstValue.loop.id);
  });

  test("generic event dry-run rejects unsupported provider add dirs", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-generic-event-invalid-adddirs-"));
    const event = {
      id: "evt-generic-invalid-adddirs",
      type: "knowledge.record.created",
      source: "knowledge",
      subject: "record-invalid-adddirs",
      data: {
        id: "record-invalid-adddirs",
        project_path: "/tmp/open-knowledge",
      },
      time: new Date().toISOString(),
      schemaVersion: "1.0",
      metadata: {},
    };

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "handle",
        "generic",
        "--provider",
        "cursor",
        "--add-dir",
        "/tmp/knowledge-store",
        "--dry-run",
      ],
      JSON.stringify(event),
    );

    expect(result.status).toBe(1);
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(false);
    expect(value.validation.error).toContain("addDirs is currently supported only for provider codewith or codex");
  });

  test("generic event handler throttles through admission work items", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-generic-event-throttle-"));
    const repo = createGitRepo("loops-cli-generic-event-throttle-repo-");
    const baseEvent = {
      type: "knowledge.record.created",
      source: "knowledge",
      severity: "info",
      data: {
        project_path: repo,
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
      "--max-active-per-project",
      "1",
    ];

    const first = runCli(dataDir, args, JSON.stringify({
      ...baseEvent,
      id: "evt-generic-throttle-0001",
      subject: "record-1",
      message: "First record",
      data: { ...baseEvent.data, id: "record-1" },
    }));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.workItem.status).toBe("admitted");

    const second = runCli(dataDir, args, JSON.stringify({
      ...baseEvent,
      id: "evt-generic-throttle-0002",
      subject: "record-2",
      message: "Second record",
      data: { ...baseEvent.data, id: "record-2" },
    }));
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue.skipped).toBe(true);
    expect(secondValue.workItem.status).toBe("deferred");
    expect(secondValue.reason).toContain("project active workflow limit reached");
    expect(secondValue.throttle.counts.project).toBe(1);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
    const routes = JSON.parse(runCli(dataDir, ["--json", "routes", "list", "--route-key", "generic-event"]).stdout);
    expect(routes.map((item: { status: string }) => item.status).sort()).toEqual(["admitted", "deferred"]);
  });
});
