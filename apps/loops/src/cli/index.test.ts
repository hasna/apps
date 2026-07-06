import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
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

let templateDb: string | undefined;

/**
 * mkdtemp a CLI data dir pre-seeded with an already-migrated loops.db so each
 * test skips the fresh-database migration cost inside its first CLI spawn.
 * The template database is built once per suite run by a real CLI invocation,
 * so seeded dirs are byte-identical to what that first spawn would create.
 */
function freshDataDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (!templateDb) {
    const templateDir = mkdtempSync(join(tmpdir(), "loops-cli-template-db-"));
    const init = runCli(templateDir, ["--json", "list"]);
    if (init.status !== 0) throw new Error(`failed to initialize template loops.db: ${init.stderr}`);
    templateDb = join(templateDir, "loops.db");
  }
  const db = join(dir, "loops.db");
  copyFileSync(templateDb, db);
  chmodSync(db, 0o600);
  return dir;
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

function createGitRepoIn(parent: string, prefix: string): string {
  const repo = mkdtempSync(join(parent, prefix));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "loops-test@example.com"]);
  git(repo, ["config", "user.name", "Loops Test"]);
  writeFileSync(join(repo, "README.md"), "# test\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}

function createGitRepo(prefix: string): string {
  return createGitRepoIn(tmpdir(), prefix);
}

function testPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function testPaths(paths: string[]): string[] {
  return paths.map(testPath);
}

type TestWorkflowStep = { id?: string; target: Record<string, any>; [key: string]: any };

function agentStepsOf(workflow: { steps: TestWorkflowStep[] }): TestWorkflowStep[] {
  return workflow.steps.filter((step) => step.target.type === "agent");
}

function authProfilesOf(workflow: { steps: TestWorkflowStep[] }): string[] {
  return agentStepsOf(workflow)
    .map((step) => step.target.authProfile as string | undefined)
    .filter((profile: string | undefined): profile is string => Boolean(profile));
}

describe("loops CLI", () => {
  test("reports the package version", () => {
    const dataDir = freshDataDir("loops-cli-version-");
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

  test("reports local deployment mode by default", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-mode-local-"));
    const mode = runCli(dataDir, ["--json", "mode"], undefined, {
      LOOPS_MODE: "",
      HASNA_LOOPS_MODE: "",
      LOOPS_API_URL: "",
      HASNA_LOOPS_API_URL: "",
      LOOPS_CLOUD_API_URL: "",
      HASNA_LOOPS_CLOUD_API_URL: "",
      LOOPS_DATABASE_URL: "",
      HASNA_LOOPS_DATABASE_URL: "",
    });

    expect(mode.status).toBe(0);
    const value = JSON.parse(mode.stdout);
    expect(value.deploymentMode).toBe("local");
    expect(value.sourceOfTruth).toBe("local_sqlite");
    expect(value.localStore.role).toBe("authoritative");
    expect(value.schedulerState).toMatchObject({
      authority: "local_sqlite",
      localStore: { backend: "sqlite", role: "authoritative", runArtifacts: "local_files" },
      remoteStore: { backend: "none", configured: false, applySupported: false, mutatesAws: false },
      routeAdmission: { stateStore: "local_sqlite", activeStatuses: ["admitted", "running"] },
    });
    expect(mode.stdout).not.toContain("dataDir");
    expect(mode.stdout).not.toContain("dbPath");
  });

  test("reports self-hosted and cloud contract perspectives without exposing tokens", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-mode-cloud-"));
    const selfHosted = runCli(dataDir, ["--json", "self-hosted", "status"], undefined, {
      LOOPS_MODE: "self-hosted",
      LOOPS_API_URL: "http://127.0.0.1:8787",
      LOOPS_API_TOKEN: "do-not-print-this-token",
    });
    expect(selfHosted.status).toBe(0);
    expect(selfHosted.stdout).not.toContain("do-not-print-this-token");
    expect(JSON.parse(selfHosted.stdout)).toMatchObject({
      deploymentMode: "self_hosted",
      activeDeploymentMode: "self_hosted",
      sourceOfTruth: "self_hosted_control_plane",
      controlPlane: {
        kind: "self_hosted",
        configured: true,
        apiUrl: "http://127.0.0.1:8787",
        authTokenPresent: true,
      },
      schedulerState: {
        authority: "self_hosted_control_plane",
        localStore: { backend: "sqlite", role: "cache_and_spool" },
        remoteStore: { backend: "api_control_plane_contract", configured: true, applySupported: false },
        routeAdmission: { stateStore: "control_plane_contract" },
      },
    });

    const cloud = runCli(dataDir, ["--json", "cloud", "status"], undefined, {
      LOOPS_MODE: "local",
      LOOPS_CLOUD_API_URL: "https://loops.example.test",
      LOOPS_CLOUD_TOKEN: "do-not-print-this-cloud-token",
    });
    expect(cloud.status).toBe(0);
    expect(cloud.stdout).not.toContain("do-not-print-this-cloud-token");
    const cloudValue = JSON.parse(cloud.stdout);
    expect(cloudValue).toMatchObject({
      deploymentMode: "cloud",
      activeDeploymentMode: "local",
      active: false,
      sourceOfTruth: "cloud_control_plane",
      controlPlane: {
        kind: "cloud",
        configured: true,
        apiUrl: "https://loops.example.test",
        authTokenPresent: true,
      },
      schedulerState: {
        authority: "cloud_control_plane",
        remoteStore: { backend: "hosted_control_plane_contract", configured: true, applySupported: false, mutatesAws: false },
        routeAdmission: { stateStore: "control_plane_contract" },
      },
    });
    expect(cloudValue.warnings.join(" ")).toContain("active deployment mode is local");
    expect(cloud.stdout).not.toContain("dataDir");
    expect(cloud.stdout).not.toContain("dbPath");
  });

  test("exports and imports id-preserving migration bundles idempotently", () => {
    const sourceDir = freshDataDir("loops-cli-export-source-");
    const targetDir = freshDataDir("loops-cli-export-target-");
    const bundleFile = join(sourceDir, "loops-export.json");
    let workflowId = "";
    let loopId = "";
    let runId = "";
    const store = new Store(join(sourceDir, "loops.db"));
    try {
      const workflow = store.createWorkflow({
        name: "migration-workflow",
        steps: [{ id: "one", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "migration-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "printf", args: ["migrated"] },
      });
      const claim = store.claimRun(loop, loop.nextRunAt!, "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const run = store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "migrated",
          stderr: "",
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:01Z") },
      );
      workflowId = workflow.id;
      loopId = loop.id;
      runId = run.id;
    } finally {
      store.close();
    }

    const dryRunFile = join(sourceDir, "dry-run-export.json");
    const exportDryRun = runCli(sourceDir, ["--json", "export", "--file", dryRunFile, "--dry-run"]);
    expect(exportDryRun.status).toBe(0);
    expect(JSON.parse(exportDryRun.stdout)).toMatchObject({ ok: true, dryRun: true, file: dryRunFile });
    expect(existsSync(dryRunFile)).toBe(false);

    const exported = runCli(sourceDir, ["--json", "export", "--file", bundleFile]);
    expect(exported.status).toBe(0);
    const exportedValue = JSON.parse(exported.stdout);
    expect(exportedValue.bundle.importable).toBe(true);
    expect(existsSync(bundleFile)).toBe(true);

    const dryRun = runCli(targetDir, ["--json", "import", bundleFile]);
    expect(dryRun.status).toBe(0);
    const plan = JSON.parse(dryRun.stdout);
    expect(plan.summary).toMatchObject({ insert: 3, conflict: 0, blocked: 0, workflows: 1, loops: 1, runs: 1 });

    const applied = runCli(targetDir, ["--json", "import", bundleFile, "--apply"]);
    expect(applied.status).toBe(0);
    const appliedValue = JSON.parse(applied.stdout);
    expect(appliedValue.applied).toEqual({ workflows: 1, loops: 1, runs: 1 });
    expect(appliedValue.backupPath).toBeString();

    const secondDryRun = runCli(targetDir, ["--json", "import", bundleFile]);
    expect(secondDryRun.status).toBe(0);
    expect(JSON.parse(secondDryRun.stdout).summary).toMatchObject({ insert: 0, skip: 3, conflict: 0, blocked: 0 });

    const imported = new Store(join(targetDir, "loops.db"));
    try {
      expect(imported.getWorkflow(workflowId)?.name).toBe("migration-workflow");
      expect(imported.getLoop(loopId)?.name).toBe("migration-loop");
      expect(imported.getRun(runId)?.status).toBe("succeeded");
    } finally {
      imported.close();
    }
  });

  test("export refuses redacted env bundles unless explicitly allowed", () => {
    const dataDir = freshDataDir("loops-cli-export-redacted-");
    const bundleFile = join(dataDir, "redacted-export.json");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      store.createLoop({
        name: "env-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "env", env: { PRIVATE_TOKEN: "very-secret-value" } },
      });
    } finally {
      store.close();
    }

    const refused = runCli(dataDir, ["--json", "export", "--file", bundleFile]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("not no-loss");
    expect(existsSync(bundleFile)).toBe(false);

    const allowed = runCli(dataDir, ["--json", "export", "--file", bundleFile, "--allow-redacted"]);
    expect(allowed.status).toBe(0);
    const bundle = JSON.parse(readFileSync(bundleFile, "utf8"));
    expect(bundle.importable).toBe(false);
    expect(JSON.stringify(bundle)).toContain("[redacted]");
    expect(JSON.stringify(bundle)).not.toContain("very-secret-value");
  });

  test("self-hosted migrate preview reports blocked unsupported rows without tokens", () => {
    const dataDir = freshDataDir("loops-cli-self-hosted-migrate-");
    const create = runCli(dataDir, ["create", "command", "remote-loop", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);

    const preview = runCli(dataDir, ["--json", "self-hosted", "migrate", "--dry-run"], undefined, {
      LOOPS_API_TOKEN: "do-not-print-this-token",
      HASNA_LOOPS_API_TOKEN: "",
    });
    expect(preview.status).toBe(0);
    expect(preview.stdout).not.toContain("do-not-print-this-token");
    const plan = JSON.parse(preview.stdout);
    expect(plan.operation).toBe("self-hosted-migrate");
    expect(plan.dryRun).toBe(true);
    expect(plan.importable).toBe(false);
    expect(plan.summary.blocked).toBeGreaterThan(0);
    expect(plan.warnings.join(" ")).toContain("LOOPS_API_URL");

    for (const command of ["push", "pull"]) {
      const documented = runCli(dataDir, ["--json", "self-hosted", command, "--dry-run"]);
      expect(documented.status).toBe(0);
      expect(JSON.parse(documented.stdout).operation).toBe(`self-hosted-${command}`);
    }
  });

  test("self-hosted runner-register previews by default", () => {
    const dataDir = freshDataDir("loops-cli-runner-register-dry-run-");
    const registered = runCli(dataDir, [
      "--json",
      "self-hosted",
      "runner-register",
      "--runner-id",
      "runner-cli-test",
      "--machine-id",
      "machine-cli-test",
      "--label",
      "role=worker",
      "--capability",
      "concurrency=1",
    ]);
    expect(registered.status).toBe(0);
    expect(JSON.parse(registered.stdout)).toMatchObject({
      ok: true,
      dryRun: true,
      runner: {
        runnerId: "runner-cli-test",
        machineId: "machine-cli-test",
        labels: { role: "worker" },
        capabilities: { concurrency: 1 },
      },
    });
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
    const dataDir = freshDataDir("loops-cli-ok-");
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
    const dataDir = freshDataDir("loops-cli-fail-");
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
    const dataDir = freshDataDir("loops-cli-create-agent-adddirs-");

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
    const dataDir = freshDataDir("loops-cli-create-agent-prompt-file-");
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
    const dataDir = freshDataDir("loops-cli-create-agent-prompt-source-");
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
    const dataDir = freshDataDir("loops-cli-terminal-due-");
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
    const dataDir = freshDataDir("loops-cli-archive-");
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

  test("resume from stopped recomputes the next slot so the loop becomes due again", () => {
    const dataDir = freshDataDir("loops-cli-resume-stopped-");
    const create = runCli(dataDir, ["create", "command", "resumable", "--every", "60s", "--cmd", "true"]);
    expect(create.status).toBe(0);

    const stopped = runCli(dataDir, ["--json", "stop", "resumable"]);
    expect(stopped.status).toBe(0);
    expect(JSON.parse(stopped.stdout).status).toBe("stopped");
    expect(JSON.parse(stopped.stdout).nextRunAt).toBeUndefined();

    const resumed = runCli(dataDir, ["--json", "resume", "resumable"]);
    expect(resumed.status).toBe(0);
    const value = JSON.parse(resumed.stdout);
    expect(value.status).toBe("active");
    // Regression: resume left nextRunAt null, so dueLoops never picked it up and
    // the "active" loop was permanently dormant.
    expect(value.nextRunAt).toBeString();
  });

  test("daemon logs honors --tail and rejects a non-numeric count", () => {
    const dataDir = freshDataDir("loops-cli-daemon-logs-tail-");
    writeFileSync(join(dataDir, "daemon.log"), ["l1", "l2", "l3", "l4", "l5"].join("\n"));

    const tail = runCli(dataDir, ["daemon", "logs", "--tail", "2"]);
    expect(tail.status).toBe(0);
    expect(tail.stdout.trim().split("\n")).toEqual(["l4", "l5"]);

    // -n stays supported and must agree with --tail.
    const lines = runCli(dataDir, ["daemon", "logs", "-n", "3"]);
    expect(lines.status).toBe(0);
    expect(lines.stdout.trim().split("\n")).toEqual(["l3", "l4", "l5"]);

    // Non-numeric count must error, not dump the whole log via slice(NaN).
    const bad = runCli(dataDir, ["daemon", "logs", "-n", "abc"]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("positive integer");
  });

  test("mutation commands reject ambiguous loop names instead of touching the newest match", () => {
    const dataDir = freshDataDir("loops-cli-ambiguous-name-");
    let firstId = "";
    let secondId = "";
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const spec = { schedule: { type: "interval" as const, everyMs: 60_000 }, target: { type: "command" as const, command: "true" } };
      firstId = store.createLoop({ name: "dupe-name", ...spec }).id;
      secondId = store.createLoop({ name: "dupe-name", ...spec }).id;
    } finally {
      store.close();
    }
    expect(firstId).not.toBe(secondId);

    for (const command of ["pause", "resume", "stop", "remove", "run-now"]) {
      const result = runCli(dataDir, [command, "dupe-name"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ambiguous loop name");
    }
    // Both loops are untouched: still active.
    const showFirst = runCli(dataDir, ["--json", "show", firstId]);
    const showSecond = runCli(dataDir, ["--json", "show", secondId]);
    expect(JSON.parse(showFirst.stdout).status).toBe("active");
    expect(JSON.parse(showSecond.stdout).status).toBe("active");
    // The id path still resolves precisely.
    const pausedById = runCli(dataDir, ["--json", "pause", secondId]);
    expect(pausedById.status).toBe(0);
    expect(JSON.parse(pausedById.stdout).status).toBe("paused");
  });

  test("hygiene names reports canonical machine/repo loop names without applying by default", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-names-");
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

  test("hygiene names removes cadence suffixes from canonical loop names", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-names-cadence-");
    const createInterval = runCli(dataDir, [
      "create",
      "command",
      "machine-loop-health-slo-5m",
      "--every",
      "5m",
      "--cmd",
      "true",
    ]);
    expect(createInterval.status).toBe(0);

    const createDaily = runCli(dataDir, [
      "create",
      "command",
      "ops:codewith:account001:repo-health-daily",
      "--every",
      "1d",
      "--cmd",
      "true",
    ]);
    expect(createDaily.status).toBe(0);

    const report = runCli(dataDir, ["--json", "hygiene", "names"]);

    expect(report.status).toBe(1);
    const value = JSON.parse(report.stdout);
    expect(value.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        oldName: "machine-loop-health-slo-5m",
        newName: "machine-loop-health-slo",
      }),
      expect.objectContaining({
        oldName: "ops:codewith:account001:repo-health-daily",
        newName: "machine-ops-repo-health",
      }),
    ]));
  });

  test("hygiene names apply backs up the database before renaming loops", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-names-apply-");
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
    const dataDir = freshDataDir("loops-cli-hygiene-names-apply-noop-");
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

  test("created loops get default descriptions and human list cadence", () => {
    const dataDir = freshDataDir("loops-cli-description-cadence-");
    const created = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "machine-report",
      "--every",
      "5m",
      "--cmd",
      "true",
    ]);
    expect(created.status).toBe(0);
    const value = JSON.parse(created.stdout);
    expect(value.description).toContain("Why:");
    expect(value.description).toContain("How:");
    expect(value.description).toContain("Outcome:");
    expect(value.description).toContain("cadence every:5m");

    const explicit = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "machine-explicit",
      "--every",
      "1h",
      "--cmd",
      "true",
      "--description",
      "Custom operator description.",
    ]);
    expect(explicit.status).toBe(0);
    expect(JSON.parse(explicit.stdout).description).toBe("Custom operator description.");

    const list = runCli(dataDir, ["list"]);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain("cadence=every:5m");
    expect(list.stdout).toContain("cadence=every:1h");
  });

  test("rename changes only the loop name and writes a backup", () => {
    const dataDir = freshDataDir("loops-cli-rename-");
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
    const dataDir = freshDataDir("loops-cli-rename-noop-");
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
    const dataDir = freshDataDir("loops-cli-rename-invalid-");
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
    const dataDir = freshDataDir("loops-cli-rename-archived-");
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
    const dataDir = freshDataDir("loops-cli-hygiene-duplicates-");
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
    const dataDir = freshDataDir("loops-cli-hygiene-scripts-");
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
    const dataDir = freshDataDir("loops-cli-hygiene-route-tasks-");
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
    const dataDir = freshDataDir("loops-cli-hygiene-route-no-cwd-");
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
    const dataDir = freshDataDir("loops-cli-machine-");
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
    const dataDir = freshDataDir("loops-cli-agent-allowlist-");
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

  test("create command, agent, and workflow accept explicit unlimited timeouts", () => {
    const dataDir = freshDataDir("loops-cli-timeout-none-");
    const command = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "no-timeout-command",
      "--at",
      futureAt(),
      "--cmd",
      "sleep 0.1",
      "--timeout",
      "none",
    ]);
    expect(command.status).toBe(0);
    expect(JSON.parse(command.stdout).target.timeoutMs).toBeNull();

    const agent = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "no-timeout-agent",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--timeout",
      "unlimited",
    ]);
    expect(agent.status).toBe(0);
    expect(JSON.parse(agent.stdout).target.timeoutMs).toBeNull();

    const file = workflowFile(dataDir, {
      name: "no-timeout-workflow",
      steps: [{ id: "step", target: { type: "command", command: "true", shell: true } }],
    });
    const workflowCreate = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(workflowCreate.status).toBe(0);
    const workflow = JSON.parse(workflowCreate.stdout);
    const workflowLoop = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "no-timeout-workflow-loop",
      "--workflow",
      workflow.id,
      "--at",
      futureAt(),
      "--timeout",
      "null",
    ]);
    expect(workflowLoop.status).toBe(0);
    expect(JSON.parse(workflowLoop.stdout).target.timeoutMs).toBeNull();
  });

  test("workflows migrate-agent-timeouts clones specs and retargets loops append-only", () => {
    const dataDir = freshDataDir("loops-cli-migrate-agent-timeouts-");
    const file = workflowFile(dataDir, {
      name: "finite-agent-workflow",
      steps: [
        {
          id: "worker",
          timeoutMs: 2_700_000,
          target: { type: "agent", provider: "codewith", prompt: "work", timeoutMs: 2_700_000, idleTimeoutMs: 600_000 },
        },
      ],
    });
    const created = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    const loop = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "finite-agent-workflow-loop",
      "--workflow",
      workflow.id,
      "--at",
      futureAt(),
      "--timeout",
      "45m",
    ]);
    expect(loop.status).toBe(0);
    const loopValue = JSON.parse(loop.stdout);

    const dryRun = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", loopValue.id]);
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout).summary.wouldMigrate).toBe(1);

    const applied = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", loopValue.id, "--apply"]);
    expect(applied.status).toBe(0);
    const appliedValue = JSON.parse(applied.stdout);
    expect(appliedValue.summary.migrated).toBe(1);
    const nextWorkflowId = appliedValue.rows[0].workflow.id;
    expect(nextWorkflowId).not.toBe(workflow.id);

    const shownLoop = runCli(dataDir, ["--json", "show", loopValue.id]);
    expect(shownLoop.status).toBe(0);
    const shownLoopValue = JSON.parse(shownLoop.stdout);
    expect(shownLoopValue.target.workflowId).toBe(nextWorkflowId);
    expect(shownLoopValue.target.timeoutMs).toBeNull();

    const shownWorkflow = runCli(dataDir, ["--json", "workflows", "show", nextWorkflowId]);
    expect(shownWorkflow.status).toBe(0);
    const migratedWorkflow = JSON.parse(shownWorkflow.stdout);
    expect(migratedWorkflow.steps[0].timeoutMs).toBeNull();
    expect(migratedWorkflow.steps[0].target.timeoutMs).toBeNull();
    expect(migratedWorkflow.steps[0].target.idleTimeoutMs).toBeUndefined();

    const oldWorkflow = runCli(dataDir, ["--json", "workflows", "show", workflow.id]);
    expect(oldWorkflow.status).toBe(0);
    expect(JSON.parse(oldWorkflow.stdout).status).toBe("active");
  });

  test("workflows migrate-goal-wrappers removes redundant workflow goals append-only", () => {
    const dataDir = freshDataDir("loops-cli-migrate-goal-wrappers-");
    const promptFile = join(dataDir, "worker-prompt.md");
    writeFileSync(promptFile, "SECRET_PROMPT_FILE_VALUE\nDo the work.\n");
    const file = workflowFile(dataDir, {
      name: "double-goal-workflow",
      goal: { objective: "SECRET_WORKFLOW_GOAL that should be removed" },
      steps: [
        { id: "worker", target: { type: "command", command: "printf ok", shell: true } },
        { id: "reviewer", target: { type: "agent", provider: "codewith", promptFile } },
      ],
    });
    const created = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    const loop = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "double-goal-workflow-loop",
      "--workflow",
      workflow.id,
      "--at",
      futureAt(),
    ]);
    expect(loop.status).toBe(0);
    const loopValue = JSON.parse(loop.stdout);

    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE loops SET goal_json = ? WHERE id = ?").run(
        JSON.stringify({ objective: "Outer loop goal" }),
        loopValue.id,
      );
    } finally {
      db.close();
    }

    const dryRun = runCli(dataDir, ["--json", "workflows", "migrate-goal-wrappers", "--loop", loopValue.id]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).not.toContain("SECRET_WORKFLOW_GOAL");
    expect(dryRun.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    const dryRunValue = JSON.parse(dryRun.stdout);
    expect(dryRunValue.summary.wouldMigrate).toBe(1);
    expect(dryRunValue.rows[0].removedGoal.objective).toContain("[redacted");

    const applied = runCli(dataDir, [
      "--json",
      "workflows",
      "migrate-goal-wrappers",
      "--loop",
      loopValue.id,
      "--apply",
      "--archive-old",
    ]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).not.toContain("SECRET_WORKFLOW_GOAL");
    expect(applied.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    const appliedValue = JSON.parse(applied.stdout);
    expect(appliedValue.summary.migrated).toBe(1);
    expect(appliedValue.rows[0].previousWorkflow.id).toBe(workflow.id);
    expect(appliedValue.rows[0].previousWorkflow.goal.objective).toContain("[redacted");
    expect(appliedValue.rows[0].workflow.hasGoal).toBe(false);
    expect(appliedValue.rows[0].workflow.goal).toBeUndefined();
    expect(appliedValue.rows[0].archivedOld.status).toBe("archived");

    const shownLoop = runCli(dataDir, ["--json", "show", loopValue.id]);
    expect(shownLoop.status).toBe(0);
    const shownLoopValue = JSON.parse(shownLoop.stdout);
    expect(shownLoopValue.goal.objective).toBe("Outer loop goal");
    expect(shownLoopValue.target.workflowId).toBe(appliedValue.rows[0].workflow.id);

    const shownWorkflow = runCli(dataDir, ["--json", "workflows", "show", appliedValue.rows[0].workflow.id]);
    expect(shownWorkflow.status).toBe(0);
    const shownWorkflowValue = JSON.parse(shownWorkflow.stdout);
    expect(shownWorkflowValue.goal).toBeUndefined();
    expect(shownWorkflowValue.steps[1].target.promptSource).toEqual({ type: "file", path: promptFile });
  });

  test("workflows migrate-goal-wrappers skips workflow-goal-only loops", () => {
    const dataDir = freshDataDir("loops-cli-migrate-workflow-goal-only-");
    const file = workflowFile(dataDir, {
      name: "workflow-goal-only",
      goal: { objective: "SECRET_WORKFLOW_ONLY_GOAL" },
      steps: [{ id: "worker", target: { type: "command", command: "printf ok", shell: true } }],
    });
    const created = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    const loop = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "workflow-goal-only-loop",
      "--workflow",
      workflow.id,
      "--at",
      futureAt(),
    ]);
    expect(loop.status).toBe(0);
    const loopValue = JSON.parse(loop.stdout);

    const migrated = runCli(dataDir, ["--json", "workflows", "migrate-goal-wrappers", "--loop", loopValue.id, "--apply"]);

    expect(migrated.status).toBe(0);
    expect(migrated.stdout).not.toContain("SECRET_WORKFLOW_ONLY_GOAL");
    const migratedValue = JSON.parse(migrated.stdout);
    expect(migratedValue.summary.migrated).toBe(0);
    expect(migratedValue.summary.skipped).toBe(1);
    expect(migratedValue.rows[0].reason).toBe("loop has no loop-level goal wrapper");
    expect(migratedValue.rows[0].workflow.goal.objective).toContain("[redacted");

    const shownLoop = runCli(dataDir, ["--json", "show", loopValue.id]);
    expect(JSON.parse(shownLoop.stdout).target.workflowId).toBe(workflow.id);
  });

  test("workflows migrate-agent-timeouts rejects ambiguous loop names", () => {
    const dataDir = freshDataDir("loops-cli-migrate-ambiguous-loop-");
    const file = workflowFile(dataDir, {
      name: "ambiguous-agent-workflow",
      steps: [{ id: "worker", target: { type: "agent", provider: "codewith", prompt: "work", timeoutMs: 2_700_000 } }],
    });
    const created = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    for (const at of [futureAt(), new Date(Date.now() + 120_000).toISOString()]) {
      const loop = runCli(dataDir, [
        "--json",
        "create",
        "workflow",
        "duplicate-loop-name",
        "--workflow",
        workflow.id,
        "--at",
        at,
      ]);
      expect(loop.status).toBe(0);
    }

    const migrated = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", "duplicate-loop-name"]);
    expect(migrated.status).not.toBe(0);
    expect(migrated.stderr).toContain("ambiguous loop name");
  });

  test("create stores runtime preflight policy on command, agent, and workflow loops", () => {
    const dataDir = freshDataDir("loops-cli-runtime-preflight-");
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
    const dataDir = freshDataDir("loops-cli-machines-");
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
    const dataDir = freshDataDir("loops-cli-doctor-preflight-");
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
    const dataDir = freshDataDir("loops-cli-create-preflight-fail-");
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
    const dataDir = freshDataDir("loops-cli-create-preflight-ok-");
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
    const dataDir = freshDataDir("loops-cli-create-preflight-json-fail-");
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
    const dataDir = freshDataDir("loops-cli-create-account-preflight-fail-");
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
    const dataDir = freshDataDir("loops-cli-create-agent-preflight-fail-");
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
    const dataDir = freshDataDir("loops-cli-create-agent-auth-preflight-");
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
    const dataDir = freshDataDir("loops-cli-create-workflow-preflight-fail-");
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
    const dataDir = freshDataDir("loops-cli-workflow-prompt-file-");
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
    const dataDir = freshDataDir("loops-cli-workflow-prompt-file-error-");
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
    const dataDir = freshDataDir("loops-cli-create-workflow-preflight-ok-");
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
    const dataDir = freshDataDir("loops-cli-workflows-create-preflight-fail-");
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
    const dataDir = freshDataDir("loops-cli-workflows-list-complete-");
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
    const dataDir = freshDataDir("loops-cli-health-json-");
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
      futureNativeUpsert: { command: "todos task upsert" },
    });
    expect(value.expectations[0].recommendedTask.description).toContain("Do not dispatch or paste prompts into tmux panes");
    expect(value.expectations[0].recommendedTask.compatibilityFallback.search).toEqual(
      expect.arrayContaining(["todos", "search"]),
    );
  });

  test("health JSON reports functional route blockers even when latest drain run succeeded", () => {
    const dataDir = freshDataDir("loops-cli-health-route-functional-");
    const evidenceDir = join(dataDir, "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, "route-drain.json");
    writeFileSync(evidencePath, JSON.stringify({
      results: [
        {
          kind: "created",
          event: {
            subject: "task-route-blocked",
            data: {
              id: "task-route-blocked",
              status: "pending",
              tags: ["auto:route", "blocked"],
            },
          },
          loop: { id: "child-loop-route-blocked" },
          idempotencyKey: "todos-task:task-route-blocked",
        },
      ],
    }));
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "machine-oss-task-lifecycle-router",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "loops", args: ["events", "drain", "todos-task", "--json", "--compact"] },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: JSON.stringify({ created: 1, skipped: 0, evidencePath }),
          stderr: "",
          exitCode: 0,
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
    expect(value.classifications.route_functional).toBe(1);
    expect(value.expectations[0].check.id).toBe("route-functional-health");
    expect(value.expectations[0].failure.classification).toBe("route_functional");
    expect(value.expectations[0].failure.evidence.error).toContain("disallowed tag blocked");
    expect(value.expectations[0].recommendedTask.tags).toContain("route_functional");
    const firstDedupeKey = value.expectations[0].recommendedTask.dedupeKey;

    const laterStore = new Store(join(dataDir, "loops.db"));
    try {
      const loop = laterStore.requireLoop("machine-oss-task-lifecycle-router");
      const claim = laterStore.claimRun(loop, "2026-01-01T00:01:00.000Z", "seed", new Date("2026-01-01T00:01:00Z"));
      expect(claim).toBeDefined();
      laterStore.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:01:01.000Z",
          durationMs: 1_000,
          stdout: JSON.stringify({ created: 1, skipped: 0, evidencePath }),
          stderr: "",
          exitCode: 0,
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:01:00.500Z") },
      );
    } finally {
      laterStore.close();
    }

    const laterHealth = runCli(dataDir, ["health", "--json"]);
    expect(laterHealth.status).toBe(1);
    const laterValue = JSON.parse(laterHealth.stdout);
    expect(laterValue.expectations[0].latestRun.id).not.toBe(value.expectations[0].latestRun.id);
    expect(laterValue.expectations[0].recommendedTask.dedupeKey).toBe(firstDedupeKey);
  });

  test("health JSON flags skipped route source task update failures", () => {
    const dataDir = freshDataDir("loops-cli-health-route-source-update-");
    const evidenceDir = join(dataDir, "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, "route-drain.json");
    writeFileSync(evidencePath, JSON.stringify({
      results: [
        {
          kind: "skipped",
          reason: "invalid project path /tmp/missing",
          event: {
            subject: "task-route-invalid-path",
            data: {
              id: "task-route-invalid-path",
              status: "pending",
              tags: ["auto:route"],
            },
          },
          sourceTaskUpdate: {
            ok: false,
            error: "source task updates failed: tagNoAuto failed",
            tagNoAuto: { ok: false },
            untagAutoRoute: { ok: true },
          },
        },
      ],
    }));
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "machine-oss-task-lifecycle-router",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "loops", args: ["events", "drain", "todos-task", "--json", "--compact"] },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: JSON.stringify({ created: 0, skipped: 1, evidencePath }),
          stderr: "",
          exitCode: 0,
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const health = runCli(dataDir, ["health", "--json"]);
    expect(health.status).toBe(1);
    const value = JSON.parse(health.stdout);
    expect(value.expectations[0].failure.classification).toBe("route_functional");
    expect(value.expectations[0].failure.evidence.error).toContain("failed to update source task");
  });

  test("health JSON does not treat unrelated successful result arrays as route blockers", () => {
    const dataDir = freshDataDir("loops-cli-health-route-functional-scope-");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "successful-json-report",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "reporter", args: ["--json"] },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: JSON.stringify({
            results: [
              {
                kind: "created",
                event: {
                  subject: "unrelated-blocked-record",
                  data: { tags: ["blocked"], status: "blocked" },
                },
              },
            ],
          }),
          stderr: "",
          exitCode: 0,
        },
        { claimedBy: "seed", now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const health = runCli(dataDir, ["health", "--json"]);
    expect(health.status).toBe(0);
    const value = JSON.parse(health.stdout);
    expect(value.ok).toBe(true);
    expect(value.classifications.route_functional).toBe(0);
    expect(value.expectations[0].check.id).toBe("latest-run-succeeded");
  });

  test("health route-tasks dry-run reports deduped task upserts without mutating todos", () => {
    const dataDir = freshDataDir("loops-cli-health-route-dry-run-");
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
    const dataDir = freshDataDir("loops-cli-health-route-working-dir-");
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
    expect(log).toContain("TAGS=bug,openloops,loops,loop-health,rate_limit,auto:route");
  });

  test("runtime preflight failures are finalized and routed as preflight health tasks", () => {
    const dataDir = freshDataDir("loops-cli-runtime-preflight-health-");
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
    const dataDir = freshDataDir("loops-cli-health-route-active-only-");
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
    // Deliberately unseeded: this test proves the CLI creates loops.db inside
    // LOOPS_DATA_DIR (and never under $HOME/.hasna), so the db must not exist yet.
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
    const dataDir = freshDataDir("loops-cli-workflow-redact-");
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
    const dataDir = freshDataDir("loops-cli-goal-");
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
    const dataDir = freshDataDir("loops-cli-empty-goal-");
    const create = runCli(dataDir, ["create", "command", "bad-goal", "--at", futureAt(), "--cmd", "true", "--goal", " "]);
    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("goal.objective");
  });

  test("templates render task worker/verifier workflow JSON", () => {
    const dataDir = freshDataDir("loops-cli-template-render-");
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
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier"]);
    expect(workflow.steps[0].target).toMatchObject({
      type: "command",
      command: "bash",
      cwd: "/tmp/repo",
    });
    expect(workflow.steps[0].target.args.join("\n")).toContain("todos --project '/tmp/todos-store' --json inspect 'task-12345678'");
    expect(workflow.steps[1].dependsOn).toEqual(["source-task-gate"]);
    expect(workflow.steps[1].target).toMatchObject({
      type: "agent",
      provider: "codewith",
      cwd: "/tmp/repo",
      authProfile: "account005",
      permissionMode: "bypass",
      sandbox: "workspace-write",
      addDirs: ["/tmp/todos-store", "/tmp/loops-store"],
    });
    expect(workflow.steps[1].target.prompt).toContain("[redacted");
    expect(workflow.steps[2].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("Do not dispatch or paste prompts into tmux panes");
    expect(workflow.steps[2].target.addDirs).toEqual(["/tmp/todos-store", "/tmp/loops-store"]);
    expect(workflow.steps[1].target.timeoutMs).toBeNull();
    expect(workflow.steps[1].timeoutMs).toBeNull();
    expect(workflow.steps[2].target.timeoutMs).toBeNull();
    expect(workflow.steps[2].timeoutMs).toBeNull();
    expect(workflow.steps[2].target.idleTimeoutMs).toBe(900_000);
    expect(workflow.steps[2].dependsOn).toEqual(["worker"]);

    const noIdleRender = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-no-idle-12345678",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "verifierIdleTimeoutMs=none",
    ]);
    expect(noIdleRender.status).toBe(0);
    const noIdleWorkflow = JSON.parse(noIdleRender.stdout);
    expect(noIdleWorkflow.steps.find((step: { id: string }) => step.id === "verifier").target.idleTimeoutMs).toBeUndefined();

    const finiteRender = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-87654321",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "timeoutMs=600000",
    ]);
    expect(finiteRender.status).toBe(0);
    const finiteWorkflow = JSON.parse(finiteRender.stdout);
    expect(finiteWorkflow.steps[1].timeoutMs).toBe(600_000);
    expect(finiteWorkflow.steps[2].timeoutMs).toBe(600_000);
  });

  test("templates fail closed for danger-full-access unless manual break-glass is explicit", () => {
    const dataDir = freshDataDir("loops-cli-template-danger-sandbox-");
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
    expect(workflow.steps[1].target.sandbox).toBe("danger-full-access");
    expect(workflow.steps[1].target.allowlist.commands).toContain("manual-break-glass");
  });

  test("templates render lifecycle and deterministic producer workflows", () => {
    const dataDir = freshDataDir("loops-cli-template-lifecycle-");
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
    expect(prWorkflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(prWorkflow.steps[0].target.worktree.mode).toBe("required");
    expect(prWorkflow.steps[0].timeoutMs).toBeNull();
    expect(prWorkflow.steps[1].timeoutMs).toBeNull();
    expect(prWorkflow.steps[1].target.idleTimeoutMs).toBe(900_000);

    const lifecycle = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "task-lifecycle",
      "--var",
      "taskId=task-lifecycle-12345678",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "provider=codewith",
      "--var",
      "timeoutMs=600000",
    ]);
    expect(lifecycle.status).toBe(0);
    const lifecycleWorkflow = JSON.parse(lifecycle.stdout);
    const lifecycleStepsById = Object.fromEntries(lifecycleWorkflow.steps.map((step: { id: string }) => [step.id, step]));
    expect(lifecycleStepsById.triage.timeoutMs).toBe(600_000);
    expect(lifecycleStepsById.planner.timeoutMs).toBe(600_000);
    expect(lifecycleStepsById.worker.timeoutMs).toBe(600_000);
    expect(lifecycleStepsById.verifier.timeoutMs).toBe(600_000);
    expect(lifecycleStepsById["triage-gate"].timeoutMs).toBe(120_000);
    expect(lifecycleStepsById["planner-gate"].timeoutMs).toBe(120_000);

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
    expect(deterministicWorkflow.steps[0].target.timeoutMs).toBe(300_000);

    const deterministicNoTimeout = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "deterministic-check-create-task",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "checkCommand=echo ok",
      "--var",
      "timeoutMs=none",
    ]);
    expect(deterministicNoTimeout.status).not.toBe(0);
    expect(deterministicNoTimeout.stderr).toContain("timeoutMs");

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
    const dataDir = freshDataDir("loops-cli-template-show-");

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
    expect(show.stdout).toContain("loops workflows create --template task-lifecycle");
  });

  test("custom templates import, list, show, render, and create workflow", () => {
    const dataDir = freshDataDir("loops-cli-custom-template-");
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
    const dataDir = freshDataDir("loops-cli-custom-template-invalid-");
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

    const invalidDataDir = freshDataDir("loops-cli-custom-template-invalid-shape-");
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

    const implicitDangerDataDir = freshDataDir("loops-cli-custom-template-implicit-danger-");
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

    const extraArgsDangerDataDir = freshDataDir("loops-cli-custom-template-extra-args-danger-");
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

    const promptFileDataDir = freshDataDir("loops-cli-custom-template-prompt-file-");
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

    const safeDataDir = freshDataDir("loops-cli-custom-template-safe-render-");
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
    const dataDir = freshDataDir("loops-cli-custom-template-collision-");
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
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier"]);
  });

  test("templates select different worker and verifier auth profiles from a pool", () => {
    const dataDir = freshDataDir("loops-cli-template-pool-");
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
    const profiles = workflow.steps
      .map((step: { target: { authProfile?: string } }) => step.target.authProfile)
      .filter((profile: string | undefined): profile is string => Boolean(profile));
    expect(profiles).toHaveLength(2);
    expect(new Set(profiles).size).toBe(2);
    expect(profiles.every((profile: string) => ["account004", "account005", "account006"].includes(profile))).toBe(true);
  });

  test("templates default git projects to isolated worktrees", () => {
    const dataDir = freshDataDir("loops-cli-template-worktree-");
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
      `addDirs=${join(dataDir, "todos-store")}`,
      "--var",
      `worktreeRoot=${worktreeRoot}`,
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier"]);
    expect(workflow.steps[1].dependsOn).toEqual(["source-task-gate"]);
    expect(workflow.steps[1].target.cwd).toContain(worktreeRoot);
    expect(workflow.steps[1].target.worktree).toMatchObject({
      mode: "auto",
      enabled: true,
      root: worktreeRoot,
    });
    expect(testPath(workflow.steps[1].target.worktree.originalCwd)).toBe(testPath(repo));
    expect(testPath(workflow.steps[1].target.worktree.repoRoot)).toBe(testPath(repo));
    expect(testPaths(workflow.steps[1].target.addDirs)).toEqual(testPaths([join(dataDir, "todos-store"), join(repo, ".git")]));
    expect(workflow.steps[1].target.worktree.branch).toContain("openloops/");
    expect(workflow.steps[2].target.cwd).toBe(workflow.steps[1].target.cwd);
    expect(workflow.steps[1].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("Use the isolated git worktree");
    expect(render.stdout).not.toContain("Do not mutate the original checkout/main branch");
  });

  function stubPwdAgentBin(dataDir: string): string {
    const bin = join(dataDir, "stub-bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(claude, "#!/usr/bin/env bash\npwd\ncat >/dev/null\n");
    chmodSync(claude, 0o755);
    return bin;
  }

  function worktreeWorkflowFile(dataDir: string, repo: string, worktree: Record<string, unknown>): string {
    return workflowFile(dataDir, {
      name: "cli-worktree-exec",
      steps: [
        {
          id: "worker",
          target: {
            type: "agent",
            provider: "claude",
            prompt: "print working directory",
            cwd: worktree.cwd,
            timeoutMs: 60_000,
            worktree,
          },
        },
      ],
    });
  }

  test("workflows run prepares and reuses executor-managed worktrees", () => {
    const dataDir = freshDataDir("loops-cli-executor-worktree-");
    const repo = createGitRepo("loops-cli-executor-worktree-repo-");
    const bin = stubPwdAgentBin(dataDir);
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
    const worktreeRoot = join(dataDir, "worktrees");
    const wtPath = join(worktreeRoot, "repo", "cli-worktree-test");
    const branch = "openloops/cli-worktree-test";
    const file = worktreeWorkflowFile(dataDir, repo, {
      mode: "required",
      enabled: true,
      originalCwd: repo,
      cwd: wtPath,
      repoRoot: repo,
      root: worktreeRoot,
      path: wtPath,
      branch,
    });
    expect(runCli(dataDir, ["workflows", "create", file], undefined, env).status).toBe(0);

    const first = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec", "--show-output"], undefined, env);
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.result.status).toBe("succeeded");
    expect(firstValue.steps[0].stdout.trim().endsWith("cli-worktree-test")).toBe(true);
    const shown = spawnSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" });
    expect(shown.status).toBe(0);
    expect(shown.stdout.trim()).toBe(branch);

    const markerPath = join(wtPath, "untracked-marker.txt");
    writeFileSync(markerPath, "preserve me\n");
    const second = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec"], undefined, env);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).result.status).toBe("succeeded");
    expect(readFileSync(markerPath, "utf8")).toBe("preserve me\n");
  });

  test("workflows run fails closed when a required worktree is on an unexpected branch", () => {
    const dataDir = freshDataDir("loops-cli-executor-worktree-branch-");
    const repo = createGitRepo("loops-cli-executor-worktree-branch-repo-");
    const bin = stubPwdAgentBin(dataDir);
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
    const worktreeRoot = join(dataDir, "worktrees");
    const wtPath = join(worktreeRoot, "repo", "cli-worktree-branch");
    const branch = "openloops/cli-worktree-branch";
    const file = worktreeWorkflowFile(dataDir, repo, {
      mode: "required",
      enabled: true,
      originalCwd: repo,
      cwd: wtPath,
      repoRoot: repo,
      root: worktreeRoot,
      path: wtPath,
      branch,
    });
    expect(runCli(dataDir, ["workflows", "create", file], undefined, env).status).toBe(0);

    const first = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec"], undefined, env);
    expect(first.status).toBe(0);
    git(wtPath, ["checkout", "-b", "unexpected-openloops-branch"]);

    const second = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec", "--show-output"], undefined, env);
    expect(second.status).toBe(1);
    const value = JSON.parse(second.stdout);
    expect(value.result.status).toBe("failed");
    expect(value.steps[0].status).toBe("failed");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const stepError = store.listWorkflowStepRuns(value.workflowRun.id)[0]?.error ?? "";
      expect(stepError).toContain("worktree preparation failed (mode=required)");
      expect(stepError).toContain("unexpected-openloops-branch");
      expect(stepError).toContain(`expected ${branch}`);
    } finally {
      store.close();
    }
  });

  test("templates allow explicit main checkout mode instead of worktrees", () => {
    const dataDir = freshDataDir("loops-cli-template-worktree-main-");
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
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier"]);
    expect(workflow.steps[1].target.cwd).toBe(repo);
    expect(workflow.steps[1].target.worktree).toMatchObject({
      mode: "main",
      enabled: false,
      cwd: repo,
      reason: "explicit main/default checkout mode",
    });
  });

  test("templates fail required worktree mode for non-git project paths", () => {
    const dataDir = freshDataDir("loops-cli-template-worktree-required-");
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
    const dataDir = freshDataDir("loops-cli-event-template-render-");
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
    expect(workflow.steps[0].timeoutMs).toBeNull();
    expect(workflow.steps[1].timeoutMs).toBeNull();

    const finiteRender = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "event-worker-verifier",
      "--var",
      "eventId=evt-87654321",
      "--var",
      "eventType=knowledge.record.created",
      "--var",
      "eventSource=knowledge",
      "--var",
      "eventJson={\"id\":\"evt-87654321\"}",
      "--var",
      "projectPath=/tmp/knowledge",
      "--var",
      "provider=codewith",
      "--var",
      "timeoutMs=600000",
    ]);
    expect(finiteRender.status).toBe(0);
    const finiteWorkflow = JSON.parse(finiteRender.stdout);
    expect(finiteWorkflow.steps[0].timeoutMs).toBe(600_000);
    expect(finiteWorkflow.steps[1].timeoutMs).toBe(600_000);
  });

  test("templates render bounded agent worker/verifier workflow JSON", () => {
    const dataDir = freshDataDir("loops-cli-bounded-template-render-");
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
    expect(workflow.steps[0].timeoutMs).toBeNull();
    expect(workflow.steps[1].timeoutMs).toBeNull();
  });

  test("templates select different OpenAccounts profiles from a pool", () => {
    const dataDir = freshDataDir("loops-cli-event-template-pool-");
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
    const dataDir = freshDataDir("loops-cli-template-native-auth-provider-");
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
    const dataDir = freshDataDir("loops-cli-event-handler-");
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
      "--timeout",
      "10m",
      "--verifier-idle-timeout",
      "2m",
    ];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.idempotencyKey).toBe("todos-task:task-created-0001");
    expect(firstValue.workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier"]);
    expect(firstValue.loop.name).toContain("event:todos-task:task-cre:");
    expect(firstValue.loop.name).not.toContain("evt-task");
    expect(firstValue.loop.target.workflowId).toBe(firstValue.workflow.id);
    const routedProfiles = firstValue.workflow.steps
      .map((step: { target: { authProfile?: string } }) => step.target.authProfile)
      .filter((profile: string | undefined): profile is string => Boolean(profile));
    expect(new Set(routedProfiles).size).toBe(2);
    const agentSteps = firstValue.workflow.steps.filter((step: { target: { type?: string } }) => step.target.type === "agent");
    for (const step of agentSteps) {
      expect(step.target).toMatchObject({
        type: "agent",
        provider: "codewith",
        cwd: "/tmp/open-todos",
        permissionMode: "bypass",
        sandbox: "workspace-write",
        addDirs: ["/tmp/todos-store", "/tmp/loops-store"],
      });
      expect(step.timeoutMs).toBe(600_000);
      expect(step.target.timeoutMs).toBe(600_000);
      expect(["account004", "account005", "account006"]).toContain(step.target.authProfile);
    }
    const verifierStep = firstValue.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(verifierStep.target.idleTimeoutMs).toBe(120_000);

    const second = runCli(dataDir, args, JSON.stringify(replayedEvent));
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue.deduped).toBe(true);
    expect(secondValue.idempotencyKey).toBe(firstValue.idempotencyKey);
    expect(secondValue.loop.id).toBe(firstValue.loop.id);
  });

  test("todos task event handler selects provider and account pools from metadata hints", () => {
    const dataDir = freshDataDir("loops-cli-event-provider-metadata-");
    const repo = createGitRepo("loops-cli-event-provider-metadata-repo-");
    const event = {
      id: "evt-task-created-provider-metadata",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-provider-metadata",
        title: "Route frontend task with metadata",
        working_dir: repo,
      },
      metadata: {
        route_enabled: true,
        provider_hint: "claude",
        auth_profile_pool: "claude-ui-a,claude-ui-b",
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.providerRouting).toMatchObject({
      provider: "claude",
      source: "metadata",
      reason: "selected provider from task metadata",
    });
    expect(value.invocation.scope.providerRouting.provider).toBe("claude");
    expect(value.invocation.scope.accountPolicy).toBe("pool");
    const worker = value.workflow.steps.find((step: { id: string }) => step.id === "worker");
    const verifier = value.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(worker.target.provider).toBe("claude");
    expect(verifier.target.provider).toBe("claude");
    expect(worker.target.account.tool).toBe("claude");
    expect(verifier.target.account.tool).toBe("claude");
    expect(["claude-ui-a", "claude-ui-b"]).toContain(worker.target.account.profile);
    expect(["claude-ui-a", "claude-ui-b"]).toContain(verifier.target.account.profile);
    expect(worker.target.account.profile).not.toBe(verifier.target.account.profile);
  });

  test("todos task provider rules fall back to fixed Codewith pools and reject invalid hints", () => {
    const dataDir = freshDataDir("loops-cli-event-provider-fallback-");
    const event = {
      id: "evt-task-created-provider-fallback",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-provider-fallback",
        title: "Route backend task with fallback",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      metadata: {
        area: "backend",
      },
      timestamp: new Date().toISOString(),
    };

    const fallback = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "area=frontend:claude:claude-ui-a,claude-ui-b",
      "--auth-profile-pool",
      "account004,account005",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify(event));

    expect(fallback.status).toBe(0);
    const fallbackValue = JSON.parse(fallback.stdout);
    expect(fallbackValue.providerRouting.provider).toBe("codewith");
    expect(fallbackValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(agentStepsOf(fallbackValue.workflow)[0].target.provider).toBe("codewith");
    expect(new Set(authProfilesOf(fallbackValue.workflow)).size).toBe(2);

    const explicitProvider = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "codewith",
      "--auth-profile-pool",
      "account004,account005",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-explicit",
      metadata: { ...event.metadata, provider_hint: "claude", account_pool: "claude-ui-a,claude-ui-b" },
    }));

    expect(explicitProvider.status).toBe(0);
    const explicitValue = JSON.parse(explicitProvider.stdout);
    expect(explicitValue.providerRouting.provider).toBe("codewith");
    expect(explicitValue.providerRouting.source).toBe("option");
    expect(agentStepsOf(explicitValue.workflow)[0].target.provider).toBe("codewith");
    expect(agentStepsOf(explicitValue.workflow)[0].target.account).toBeUndefined();
    expect(agentStepsOf(explicitValue.workflow)[1].target.account).toBeUndefined();

    const explicitMetadataAuth = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "codewith",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-explicit-metadata-auth",
      metadata: {
        ...event.metadata,
        provider_hint: "claude",
        auth_profile_pool: "account004,account005",
        account_pool: "claude-ui-a,claude-ui-b",
      },
    }));

    expect(explicitMetadataAuth.status).toBe(0);
    const explicitMetadataAuthValue = JSON.parse(explicitMetadataAuth.stdout);
    expect(explicitMetadataAuthValue.providerRouting.provider).toBe("codewith");
    expect(explicitMetadataAuthValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(agentStepsOf(explicitMetadataAuthValue.workflow)[0].target.authProfile).toBeDefined();
    expect(agentStepsOf(explicitMetadataAuthValue.workflow)[0].target.account).toBeUndefined();
    expect(agentStepsOf(explicitMetadataAuthValue.workflow)[1].target.account).toBeUndefined();

    const explicitSingleAuth = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "codewith",
      "--auth-profile",
      "account009",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-explicit-single-auth",
      metadata: {
        ...event.metadata,
        auth_profile_pool: "account004,account005",
      },
    }));

    expect(explicitSingleAuth.status).toBe(0);
    const explicitSingleAuthValue = JSON.parse(explicitSingleAuth.stdout);
    expect(agentStepsOf(explicitSingleAuthValue.workflow)[0].target.authProfile).toBe("account009");
    expect(agentStepsOf(explicitSingleAuthValue.workflow)[1].target.authProfile).toBe("account009");

    const ruleCodewith = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "area=backend:codewith:account004,account005",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-rule-codewith",
      metadata: { ...event.metadata, account_pool: "claude-ui-a,claude-ui-b", account_tool: "claude" },
    }));

    expect(ruleCodewith.status).toBe(0);
    const ruleCodewithValue = JSON.parse(ruleCodewith.stdout);
    expect(ruleCodewithValue.providerRouting.provider).toBe("codewith");
    expect(ruleCodewithValue.providerRouting.source).toBe("rule");
    expect(ruleCodewithValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(agentStepsOf(ruleCodewithValue.workflow)[0].target.account).toBeUndefined();
    expect(agentStepsOf(ruleCodewithValue.workflow)[1].target.account).toBeUndefined();

    const ruleCodewithWithFallbackAuth = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "area=backend:codewith:account004,account005",
      "--auth-profile",
      "account009",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-rule-codewith-fallback-auth",
    }));

    expect(ruleCodewithWithFallbackAuth.status).toBe(0);
    const ruleCodewithWithFallbackAuthValue = JSON.parse(ruleCodewithWithFallbackAuth.stdout);
    expect(ruleCodewithWithFallbackAuthValue.providerRouting.authProfile).toBe("account009");
    expect(ruleCodewithWithFallbackAuthValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(new Set(authProfilesOf(ruleCodewithWithFallbackAuthValue.workflow))).toEqual(new Set(["account004", "account005"]));

    const defaultCodewith = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-default-codewith",
      metadata: {
        ...event.metadata,
        auth_profile_pool: "account004,account005",
        account_pool: "claude-ui-a,claude-ui-b",
        account_tool: "claude",
      },
    }));

    expect(defaultCodewith.status).toBe(0);
    const defaultCodewithValue = JSON.parse(defaultCodewith.stdout);
    expect(defaultCodewithValue.providerRouting.provider).toBe("codewith");
    expect(defaultCodewithValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(agentStepsOf(defaultCodewithValue.workflow)[0].target.account).toBeUndefined();
    expect(agentStepsOf(defaultCodewithValue.workflow)[1].target.account).toBeUndefined();

    const genericProviderField = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-field",
      data: { ...event.data, provider: "github" },
    }));

    expect(genericProviderField.status).toBe(0);
    const genericProviderValue = JSON.parse(genericProviderField.stdout);
    expect(genericProviderValue.providerRouting.provider).toBe("codewith");
    expect(agentStepsOf(genericProviderValue.workflow)[0].target.provider).toBe("codewith");

    const claudeRepo = createGitRepo("loops-cli-event-provider-explicit-account-repo-");
    const explicitAccount = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "claude",
      "--account",
      "claude-main",
      "--account-tool",
      "claude",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-explicit-account",
      data: { ...event.data, working_dir: claudeRepo },
      metadata: { ...event.metadata, account_pool: "claude-ui-a,claude-ui-b" },
    }));

    expect(explicitAccount.status).toBe(0);
    const explicitAccountValue = JSON.parse(explicitAccount.stdout);
    const explicitAccountWorker = explicitAccountValue.workflow.steps.find((step: { id: string }) => step.id === "worker");
    const explicitAccountVerifier = explicitAccountValue.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(explicitAccountWorker.target.account).toEqual({ profile: "claude-main", tool: "claude" });
    expect(explicitAccountVerifier.target.account).toEqual({ profile: "claude-main", tool: "claude" });

    const explicitProviderMetadataTool = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "claude",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-metadata-account-tool",
      data: { ...event.data, working_dir: claudeRepo },
      metadata: {
        ...event.metadata,
        account_pool: "cursor-a,cursor-b",
        account_tool: "cursor",
      },
    }));

    expect(explicitProviderMetadataTool.status).toBe(0);
    const explicitProviderMetadataToolValue = JSON.parse(explicitProviderMetadataTool.stdout);
    const metadataToolWorker = explicitProviderMetadataToolValue.workflow.steps.find((step: { id: string }) => step.id === "worker");
    const metadataToolVerifier = explicitProviderMetadataToolValue.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(metadataToolWorker.target.provider).toBe("claude");
    expect(metadataToolWorker.target.account.tool).toBe("cursor");
    expect(metadataToolVerifier.target.account.tool).toBe("cursor");

    const invalid = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-invalid",
      metadata: { ...event.metadata, provider_hint: "unsupported-provider" },
    }));

    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("unsupported provider");
    expect(invalid.stderr).toContain("unsupported-provider");
  });

  test("todos task PR approval routes require non-author GitHub reviewer evidence", () => {
    const dataDir = freshDataDir("loops-cli-event-pr-review-routing-");
    const event = {
      id: "evt-task-created-pr-review",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-pr-review-required",
        title: "Approve blocked PR",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
        description: [
          "GitHub PR #1 author is also andrei-hasna.",
          "reviewDecision=REVIEW_REQUIRED",
          "mergeStateStatus=BLOCKED",
          "PR: https://github.com/hasna/example/pull/1",
        ].join("\n"),
      },
      timestamp: new Date().toISOString(),
    };
    const baseArgs = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ];

    const missingReviewer = runCli(dataDir, baseArgs, JSON.stringify(event));
    expect(missingReviewer.status).toBe(0);
    const missingValue = JSON.parse(missingReviewer.stdout);
    expect(missingValue.skipped).toBe(true);
    expect(missingValue.reason).toContain("--github-reviewer");
    expect(missingValue.workflow).toBeUndefined();
    expect(missingValue.prReviewRouting).toMatchObject({
      required: true,
      allowed: false,
      author: "andrei-hasna",
      reviewers: [],
    });

    const selfReviewer = runCli(dataDir, [...baseArgs, "--github-reviewer", "andrei-hasna"], JSON.stringify(event));
    expect(selfReviewer.status).toBe(0);
    const selfValue = JSON.parse(selfReviewer.stdout);
    expect(selfValue.skipped).toBe(true);
    expect(selfValue.reason).toContain("self-review");
    expect(selfValue.prReviewRouting.reviewers).toEqual(["andrei-hasna"]);

    const nonAuthorReviewer = runCli(dataDir, [...baseArgs, "--github-reviewer", "reviewer-hasna"], JSON.stringify(event));
    expect(nonAuthorReviewer.status).toBe(0);
    const nonAuthorValue = JSON.parse(nonAuthorReviewer.stdout);
    expect(nonAuthorValue.skipped).toBeUndefined();
    expect(nonAuthorValue.workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier"]);
    expect(nonAuthorValue.prReviewRouting).toMatchObject({
      required: true,
      allowed: true,
      author: "andrei-hasna",
      selectedReviewer: "reviewer-hasna",
    });
    expect(nonAuthorValue.invocation.scope.prReviewRouting.selectedReviewer).toBe("reviewer-hasna");

    const textReviewerPool = runCli(dataDir, baseArgs, JSON.stringify({
      ...event,
      id: "evt-task-created-pr-review-text-pool",
      data: {
        ...event.data,
        id: "task-pr-review-text-pool",
        description: [
          "GitHub author is andrei-hasna",
          "GitHub reviewer pool: andrei-hasna, reviewer-hasna",
          "reviewDecision=REVIEW_REQUIRED",
          "PR: https://github.com/hasna/example/pull/2",
        ].join("\n"),
      },
    }));
    expect(textReviewerPool.status).toBe(0);
    const textReviewerPoolValue = JSON.parse(textReviewerPool.stdout);
    expect(textReviewerPoolValue.skipped).toBeUndefined();
    expect(textReviewerPoolValue.prReviewRouting).toMatchObject({
      required: true,
      allowed: true,
      author: "andrei-hasna",
      selectedReviewer: "reviewer-hasna",
    });
    expect(textReviewerPoolValue.prReviewRouting.reviewers).toEqual(["andrei-hasna", "reviewer-hasna"]);

    const selfPoolWithStatusLine = runCli(dataDir, baseArgs, JSON.stringify({
      ...event,
      id: "evt-task-created-pr-review-self-pool-status",
      data: {
        ...event.data,
        id: "task-pr-review-self-pool-status",
        description: [
          "GitHub author is andrei-hasna",
          "GitHub reviewer pool: andrei-hasna",
          "manual",
          "reviewDecision=REVIEW_REQUIRED",
          "PR: https://github.com/hasna/example/pull/3",
        ].join("\n"),
      },
    }));
    expect(selfPoolWithStatusLine.status).toBe(0);
    const selfPoolWithStatusLineValue = JSON.parse(selfPoolWithStatusLine.stdout);
    expect(selfPoolWithStatusLineValue.skipped).toBe(true);
    expect(selfPoolWithStatusLineValue.reason).toContain("self-review");
    expect(selfPoolWithStatusLineValue.prReviewRouting.reviewers).toEqual(["andrei-hasna"]);

    const unprefixedReviewerPool = runCli(dataDir, baseArgs, JSON.stringify({
      ...event,
      id: "evt-task-created-pr-review-unprefixed-pool",
      data: {
        ...event.data,
        id: "task-pr-review-unprefixed-pool",
        description: [
          "GitHub author is andrei-hasna",
          "Reviewer pool: andrei-hasna, reviewer-hasna",
          "reviewDecision=REVIEW_REQUIRED",
          "PR: https://github.com/hasna/example/pull/4",
        ].join("\n"),
      },
    }));
    expect(unprefixedReviewerPool.status).toBe(0);
    const unprefixedReviewerPoolValue = JSON.parse(unprefixedReviewerPool.stdout);
    expect(unprefixedReviewerPoolValue.skipped).toBe(true);
    expect(unprefixedReviewerPoolValue.reason).toContain("--github-reviewer");
    expect(unprefixedReviewerPoolValue.prReviewRouting.reviewers).toEqual([]);
  });

  test("todos task event handler replaces stale generated workflow policy metadata", () => {
    const dataDir = freshDataDir("loops-cli-event-stale-workflow-");
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
    expect(agentStepsOf(routedValue.workflow)[0].target.allowlist.commands).toContain("manual-break-glass");

    const staleAfter = runCli(dataDir, ["--json", "workflows", "show", staleValue.id]);
    expect(staleAfter.status).toBe(0);
    expect(JSON.parse(staleAfter.stdout).status).toBe("archived");
  });

  test("routes commands expose workflow invocation admission state", () => {
    const dataDir = freshDataDir("loops-cli-routes-list-");
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

    const activeRequeue = runCli(dataDir, ["--json", "routes", "requeue", createdValue.workItem.id, "--reason", "still active"]);
    expect(activeRequeue.status).not.toBe(0);
    expect(activeRequeue.stderr).toContain("not requeueable");
  });

  test("routes preview, create, and schedule expose first-class route lifecycle commands", () => {
    const dataDir = freshDataDir("loops-cli-routes-lifecycle-");
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
      "--timeout",
      "10m",
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
      "--timeout",
      "10m",
    ]);
    expect(scheduled.status).toBe(0);
    const loop = JSON.parse(scheduled.stdout);
    expect(loop.name).toBe("route-drain-test");
    expect(loop.target.command).toBe("loops");
    expect(loop.target.args).toEqual(expect.arrayContaining(["routes", "drain", "todos-task", "--task-list", "oss", "--max-dispatch", "2", "--timeout", "10m"]));
  });

  test("todos task routes can select the full task-lifecycle template", () => {
    const dataDir = freshDataDir("loops-cli-routes-task-lifecycle-");
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
      "--provider-rule",
      "area=backend:codewith:account004,account005",
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
      "source-task-gate",
      "triage",
      "triage-gate",
      "planner",
      "planner-gate",
      "worker",
      "verifier",
    ]);
    const stepsById = Object.fromEntries(previewValue.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    expect(stepsById.triage.dependsOn).toEqual(["source-task-gate"]);
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
      tags: ["auto:route", "blocked"],
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

  test("todos task lifecycle routes pass PR review routing evidence into follow-up guidance", () => {
    const dataDir = freshDataDir("loops-cli-routes-task-lifecycle-pr-routing-");
    const event = {
      id: "evt-routes-task-lifecycle-pr-routing-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-task-lifecycle-pr-routing-0001",
        title: "Route PR follow-up lifecycle",
        description: [
          "GitHub author is andrei-hasna",
          "GitHub reviewer pool: andrei-hasna, kriptoburak",
          "reviewDecision=REVIEW_REQUIRED",
          "PR: https://github.com/hasna/example/pull/7",
        ].join("\n"),
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
      "--worktree-mode",
      "off",
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    expect(value.prReviewRouting).toMatchObject({
      required: true,
      allowed: true,
      author: "andrei-hasna",
      selectedReviewer: "kriptoburak",
    });
    expect(value.invocation.scope.prReviewRouting).toMatchObject({
      author: "andrei-hasna",
      selectedReviewer: "kriptoburak",
    });
    const stepsById = Object.fromEntries(value.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    for (const id of ["triage", "planner", "worker", "verifier"]) {
      const prompt = stepsById[id].target.prompt;
      expect(prompt).toContain("PR-derived follow-up todos:");
      expect(prompt).toContain("Source PR author evidence: GitHub author is andrei-hasna");
      expect(prompt).toContain("Source PR reviewer evidence: GitHub reviewer pool: andrei-hasna, kriptoburak");
      expect(prompt).toContain('"prReviewRouting":{"required":true');
      expect(prompt).toContain('"selectedReviewer":"kriptoburak"');
    }

    const created = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "task-lifecycle",
      "--worktree-mode",
      "off",
      "--sandbox",
      "workspace-write",
    ]);
    expect(created.status).toBe(0);
    const createdValue = JSON.parse(created.stdout);
    expect(createdValue.invocation.templateId).toBe("task-lifecycle");
    expect(createdValue.invocation.scope.prReviewRouting).toMatchObject({
      author: "andrei-hasna",
      reviewers: ["andrei-hasna", "kriptoburak"],
      selectedReviewer: "kriptoburak",
    });
  });

  test("task lifecycle routes can queue bounded PR handoff from worker artifacts", () => {
    const dataDir = freshDataDir("loops-cli-routes-pr-handoff-");
    const repo = createGitRepo("loops-cli-routes-pr-handoff-repo-");
    const event = {
      id: "evt-routes-pr-handoff-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-pr-handoff-0001",
        title: "Route with PR handoff",
        description: "Exercise worker-network-failure handoff.",
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
      "--worktree-mode",
      "main",
      "--pr-handoff",
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    expect(value.invocation.scope.prHandoff).toBe(true);
    expect(value.workflow.steps.map((step: { id: string }) => step.id)).toEqual([
      "source-task-gate",
      "triage",
      "triage-gate",
      "planner",
      "planner-gate",
      "worker",
      "pr-handoff",
      "verifier",
    ]);
    const stepsById = Object.fromEntries(value.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    expect(stepsById["pr-handoff"].dependsOn).toEqual(["worker"]);
    expect(stepsById.verifier.dependsOn).toEqual(["pr-handoff"]);
    expect(stepsById.worker.target.prompt).toContain(".openloops/pr-handoff/task-routes-pr-handoff-0001.json");
    const command = stepsById["pr-handoff"].target.args[1];
    expect(command).toContain("openloops:pr-handoff:");
    expect(command).toContain("const result = todos(");
    expect(command).toContain("'task'");

    const artifactDir = join(repo, ".openloops", "pr-handoff");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "task-routes-pr-handoff-0001.json"), JSON.stringify({
      taskId: "task-routes-pr-handoff-0001",
      worktreePath: repo,
      githubRepo: "hasna/open-loops",
      branch: "openloops/pr-handoff-test",
      base: "main",
      remote: "origin",
      commit: "0123456789abcdef0123456789abcdef01234567",
      validation: "bun test passed",
      error: "getaddrinfo ENOTFOUND github.com",
    }));
    const fakeBin = join(dataDir, "fake-bin");
    const calls = join(dataDir, "calls.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      join(fakeBin, "git"),
      [
        "#!/usr/bin/env bash",
        "printf 'git %s\\n' \"$*\" >> \"$OPENLOOPS_TEST_CALLS\"",
        "if [[ \"$1\" == \"-C\" && \"$3\" == \"rev-parse\" && \"$4\" == \"--show-toplevel\" ]]; then printf '%s\\n' \"$2\"; exit 0; fi",
        "if [[ \"$1\" == \"-C\" && \"$3\" == \"branch\" && \"$4\" == \"--show-current\" ]]; then printf 'openloops/pr-handoff-test\\n'; exit 0; fi",
        "if [[ \"$1\" == \"-C\" && \"$3\" == \"rev-parse\" && \"$4\" == \"--verify\" ]]; then printf '0123456789abcdef0123456789abcdef01234567\\n'; exit 0; fi",
        "if [[ \"$1\" == \"-C\" && \"$3\" == \"merge-base\" ]]; then exit 0; fi",
        "if [[ \"$3\" == \"push\" ]]; then printf 'network blocked' >&2; exit 128; fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(fakeBin, "todos"),
      [
        "#!/usr/bin/env bash",
        "printf 'todos %s\\n' \"$*\" >> \"$OPENLOOPS_TEST_CALLS\"",
        "exit 0",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(fakeBin, "gh"),
      [
        "#!/usr/bin/env bash",
        "printf 'gh %s\\n' \"$*\" >> \"$OPENLOOPS_TEST_CALLS\"",
        "if [[ \"$1\" == \"pr\" && \"$2\" == \"view\" ]]; then printf 'https://github.com/hasna/open-loops/pull/9\\nopenloops/pr-handoff-test\\n'; exit 0; fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(join(fakeBin, "git"), 0o755);
    chmodSync(join(fakeBin, "todos"), 0o755);
    chmodSync(join(fakeBin, "gh"), 0o755);

    const handoff = spawnSync("bash", ["-lc", command], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        OPENLOOPS_TEST_CALLS: calls,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: join(fakeBin, "git"),
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: join(fakeBin, "todos"),
      },
      encoding: "utf8",
    });
    expect(handoff.status).toBe(0);
    expect(handoff.stdout).toContain("queued PR handoff task");
    const callLog = readFileSync(calls, "utf8");
    expect(callLog).toContain("git -C");
    expect(callLog).toContain("push origin 0123456789abcdef0123456789abcdef01234567:refs/heads/openloops/pr-handoff-test");
    expect(callLog).toContain("todos --project");
    expect(callLog).toContain("task upsert --fingerprint openloops:pr-handoff:task-routes-pr-handoff-0001:openloops/pr-handoff-test:0123456789abcdef0123456789abcdef01234567");
    expect(callLog).toContain("auto:route,pr-handoff,github,network,repo:open-loops");
    expect(callLog).toContain("comment task-routes-pr-handoff-0001 openloops:pr-handoff=pending");

    writeFileSync(calls, "");
    writeFileSync(join(artifactDir, "task-routes-pr-handoff-0001.json"), JSON.stringify({
      taskId: "task-routes-pr-handoff-0001",
      worktreePath: repo,
      githubRepo: "hasna/open-loops",
      branch: "untrusted/branch",
      base: "main",
      remote: "origin",
      commit: "0123456789abcdef0123456789abcdef01234567",
      validation: "bun test passed",
    }));
    const invalidHandoff = spawnSync("bash", ["-lc", command], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        OPENLOOPS_TEST_CALLS: calls,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: join(fakeBin, "git"),
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: join(fakeBin, "todos"),
      },
      encoding: "utf8",
    });
    expect(invalidHandoff.status).toBe(0);
    expect(invalidHandoff.stderr).toContain("invalid PR handoff artifact");
    const invalidCallLog = readFileSync(calls, "utf8");
    expect(invalidCallLog).toContain("comment task-routes-pr-handoff-0001 openloops:pr-handoff=invalid");
    expect(invalidCallLog).not.toContain("task upsert");
    expect(invalidCallLog).not.toContain("auto:route");

    writeFileSync(calls, "");
    writeFileSync(join(artifactDir, "task-routes-pr-handoff-0001.json"), JSON.stringify({
      taskId: "task-routes-pr-handoff-0001",
      worktreePath: repo,
      githubRepo: "hasna/open-loops",
      branch: "openloops/pr-handoff-test",
      base: "main",
      remote: "origin",
      commit: "0123456789abcdef0123456789abcdef01234567",
      prUrl: "https://github.com/hasna/open-loops/pull/9",
      validation: "bun test passed",
    }));
    const verifiedHandoff = spawnSync("bash", ["-lc", command], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        OPENLOOPS_TEST_CALLS: calls,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: join(fakeBin, "git"),
        OPENLOOPS_PR_HANDOFF_GH_BIN: join(fakeBin, "gh"),
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: join(fakeBin, "todos"),
      },
      encoding: "utf8",
    });
    expect(verifiedHandoff.status).toBe(0);
    expect(verifiedHandoff.stdout).toContain("PR handoff already complete");
    const verifiedCallLog = readFileSync(calls, "utf8");
    expect(verifiedCallLog).toContain("gh pr view https://github.com/hasna/open-loops/pull/9");
    expect(verifiedCallLog).toContain("comment task-routes-pr-handoff-0001 openloops:pr-handoff=done");
    expect(verifiedCallLog).not.toContain("push origin");
  });

  test("routes schedule preserves selected todos task template in the drain loop", () => {
    const dataDir = freshDataDir("loops-cli-routes-template-schedule-");

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
      "--provider-rule",
      "area=backend:codewith:account004,account005",
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
    expect(loop.target.args).toEqual(expect.arrayContaining(["--provider-rule", "area=backend:codewith:account004,account005"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--triage-auth-profile", "account004", "--planner-auth-profile", "account005"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--max-dispatch", "2"]));
  });

  test("routes schedule rejects unsupported todos task templates before storing a drain loop", () => {
    const dataDir = freshDataDir("loops-cli-routes-template-schedule-invalid-");

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-invalid-template",
      "--every",
      "5m",
      "--template",
      "pr-review",
    ]);
    expect(scheduled.status).not.toBe(0);
    expect(scheduled.stderr).toContain("--template must be todos-task-worker-verifier or task-lifecycle");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("routes schedule preserves registry drain options", () => {
    const dataDir = freshDataDir("loops-cli-routes-template-schedule-registry-");

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-registry-test",
      "--every",
      "5m",
      "--todos-projects-from-registry",
      "--project-path-prefix",
      "/tmp/todos-registry-prefix",
      "--todos-project-include",
      "/tmp/registry/include-one",
      "--todos-project-include",
      "/tmp/registry/include-two,/tmp/registry/include-three",
      "--max-dispatch",
      "3",
    ]);
    expect(scheduled.status).toBe(0);
    const loop = JSON.parse(scheduled.stdout);
    expect(loop.target.args).toEqual(expect.arrayContaining(["--todos-projects-from-registry"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--project-path-prefix", "/tmp/todos-registry-prefix"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--todos-project-include", "/tmp/registry/include-one"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--todos-project-include", "/tmp/registry/include-two"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--todos-project-include", "/tmp/registry/include-three"]));
    expect(loop.target.args).toEqual(expect.arrayContaining(["--max-dispatch", "3"]));
  });

  test("todos task lifecycle routes preserve explicit OpenAccounts role accounts", () => {
    const dataDir = freshDataDir("loops-cli-routes-task-lifecycle-accounts-");
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
    expect(stepsById["source-task-gate"].dependsOn ?? []).toEqual([]);
    expect(stepsById.triage.dependsOn).toEqual(["source-task-gate"]);
    expect(stepsById.worker.dependsOn).toEqual(["planner-gate"]);
  });

  test("routes schedule rejects drain dry-run instead of storing a surprising loop", () => {
    const dataDir = freshDataDir("loops-cli-routes-schedule-dry-run-");

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

    expect(usage).toContain("$HOME/workspace/example/opensource");
    expect(usage).toContain("--tags auto:route");
    expect(usage).toContain("--auth-profile-pool account001,account002,account003");
    expect(usage).toContain("--worktree-mode required");
    expect(usage).toContain("--max-active-per-project");
    expect(usage).toContain("--evidence-dir");
    expect(usage).toMatch(/Do not dispatch\s+or paste task prompts into tmux panes/);
  });

  test("routes create replaces a stale persisted unsafe workflow with the same generated name", () => {
    const dataDir = freshDataDir("loops-cli-routes-unsafe-existing-");
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
    expect(agentStepsOf(value.workflow)[0].target.sandbox).toBe("workspace-write");

    const staleAfter = runCli(dataDir, ["--json", "workflows", "show", staleWorkflowId]);
    expect(staleAfter.status).toBe(0);
    expect(JSON.parse(staleAfter.stdout).status).toBe("archived");
  });

  test("todos task event handler dry-run exposes default worktree routing for git repos", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-worktree-");
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
    expect(value.workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier"]);
    expect(value.workflow.steps[1].target.cwd).toContain(worktreeRoot);
    expect(value.workflow.steps[1].target.worktree.enabled).toBe(true);
    expect(testPath(value.workflow.steps[1].target.worktree.originalCwd)).toBe(testPath(repo));
    expect(testPaths(value.workflow.steps[1].target.addDirs)).toContain(testPath(join(repo, ".git")));
    expect(testPaths(value.workflow.steps[2].target.addDirs)).toContain(testPath(join(repo, ".git")));
  });

  test("todos task event handler throttles active workflows per project", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-project-throttle-");
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
    const dataDir = freshDataDir("loops-cli-event-handler-reroute-template-");
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
    const dataDir = freshDataDir("loops-cli-event-handler-canonical-throttle-");
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
    expect(testPath(value.throttle.projectPath)).toBe(testPath(repo));
  });

  test("todos task event handler throttles active workflows per project group", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-group-throttle-");
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
    // Deliberately unseeded: this test asserts the dry-run never creates loops.db.
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
    const dataDir = freshDataDir("loops-cli-event-handler-dedupe-before-render-");
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
    const dataDir = freshDataDir("loops-cli-event-drain-throttle-");
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

  test("todos task drain single-project keeps old idempotency and single ready scan", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-single-idem-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const repo = createGitRepo("loops-cli-event-drain-single-idem-repo-");
    const spoofedSourceProject = createGitRepo("loops-cli-event-drain-single-spoofed-source-");
    const todosProject = join(dataDir, "todos-store");
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
      { encoding: "utf8" },
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-single-idempotency",
        title: "Route single project task",
        status: "pending",
        source_project_path: spoofedSourceProject,
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
        todosProject,
        "--limit",
        "10",
        "--max-dispatch",
        "1",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(1);
    expect(value.results[0].idempotencyKey).toBe("todos-task:task-drain-single-idempotency");
    expect(value.results[0].event.data.source_project_path).toBeUndefined();
    const sourceGateArgs = value.results[0].workflow.steps[0].target.args.join("\n");
    expect(sourceGateArgs).toContain(todosProject);
    expect(sourceGateArgs).not.toContain(spoofedSourceProject);
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean);
    expect(calls.some((entry) => entry.includes("projects --json"))).toBe(false);
    expect(calls.filter((entry) => entry.includes("ready --limit")).length).toBe(1);
  });

  test("todos task drain from registered projects ignores task-controlled cross-repo route paths", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-registry-source-path-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const sourceA = createGitRepo("loops-cli-event-drain-registry-source-a-");
    const sourceB = createGitRepo("loops-cli-event-drain-registry-source-b-");
    const canonicalSourceA = testPath(sourceA);
    const canonicalSourceB = testPath(sourceB);
    const projectPrefix = testPath(tmpdir());
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "if [[ \"$*\" == *\"projects --json\"* ]]; then printf '%s\\n' \"$TODOS_PROJECTS_JSON\"; exit 0; fi",
        "project=",
        "args=\"$*\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$prev\" == \"--project\" ]]; then project=\"$arg\"; fi",
        "  prev=\"$arg\"",
        "done",
        "if [[ \"$args\" == *\" ready \"* ]]; then",
        "  if [[ \"$project\" == \"$PROJECT_A\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_A\"; exit 0; fi",
        "  if [[ \"$project\" == \"$PROJECT_B\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_B\"; exit 0; fi",
        "  if [[ \"$project\" == * ]]; then printf '%s\\n' \"[]\"; exit 0; fi",
        "fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '[]\\n'; exit 0; fi",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
      { encoding: "utf8" },
    );
    chmodSync(todosBin, 0o755);
    const taskId = "task-drain-registry-shared-id";
    const readyA = [
      {
        id: taskId,
        title: "Registry route with malicious project_path",
        status: "pending",
        source_project_path: sourceB,
        route_project_path: sourceB,
        routeProjectPath: sourceB,
        project_path: sourceB,
        working_dir: sourceB,
        metadata: { route_project_path: sourceB, routeProjectPath: sourceB, project_path: sourceB, working_dir: sourceB },
        tags: ["auto:route"],
      },
    ];
    const readyB = [
      {
        id: taskId,
        title: "Registry route from second source",
        status: "pending",
        working_dir: sourceB,
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
        "--todos-projects-from-registry",
        "--project-path-prefix",
        projectPrefix,
        "--max-dispatch",
        "2",
        "--max-active",
        "10",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        PROJECT_A: sourceA,
        PROJECT_B: sourceB,
        TODOS_PROJECTS_JSON: JSON.stringify([{ path: sourceA }, { path: sourceB }]),
        TODOS_READY_JSON_A: JSON.stringify(readyA),
        TODOS_READY_JSON_B: JSON.stringify(readyB),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.source).toBe("todos ready");
    expect(value.scanned).toBe(2);
    expect(value.results).toHaveLength(2);
    expect(value.created).toBe(2);
    expect(value.results[0].idempotencyKey).toBe(`todos-task:${canonicalSourceA}:${taskId}`);
    expect(value.results[1].idempotencyKey).toBe(`todos-task:${canonicalSourceB}:${taskId}`);
    expect(value.results[0].idempotencyKey).not.toBe(value.results[1].idempotencyKey);
    expect(value.results[0].event.data.source_project_path).toBe(sourceA);
    expect(value.results[1].event.data.source_project_path).toBe(sourceB);
    expect(value.results[0].event.data.project_path).toBe(canonicalSourceA);
    expect(value.results[0].event.data.route_project_path).toBe(canonicalSourceA);
    expect(value.results[0].event.data.routeProjectPath).toBe(canonicalSourceA);
    expect(value.results[0].event.data.working_dir).toBe(canonicalSourceA);
    expect(value.results[0].event.metadata.route_project_path).toBe(canonicalSourceA);
    expect(value.results[0].event.metadata.routeProjectPath).toBe(canonicalSourceA);
    expect(value.results[0].invocation.subjectRef.path).toBe(canonicalSourceA);
    expect(value.results[0].invocation.scope.projectPath).toBe(canonicalSourceA);
    expect(value.results[0].workItem.projectKey).toBe(canonicalSourceA);
    expect(value.results[0].workflow.steps[0].target.cwd).toBe(canonicalSourceA);
    const sourceGateArgs = value.results[0].workflow.steps[0].target.args.join("\n");
    expect(sourceGateArgs).toContain(sourceA);
    expect(sourceGateArgs).not.toContain(sourceB);
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean);
    expect(calls.some((entry) => entry.includes("projects --json"))).toBe(true);
    expect(calls.filter((entry) => entry.includes("ready --limit")).length).toBe(2);
  });

  test("todos task drain filters registered projects by prefix and include before ready scans", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-registry-filter-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const registryRoot = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-registry-root-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-registry-outside-root-"));
    const sourceA = createGitRepoIn(registryRoot, "source-a-");
    const sourceB = createGitRepoIn(registryRoot, "source-b-");
    const sourceOutside = createGitRepoIn(outsideRoot, "source-outside-");
    const canonicalSourceA = testPath(sourceA);
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "if [[ \"$*\" == *\"projects --json\"* ]]; then printf '%s\\n' \"$TODOS_PROJECTS_JSON\"; exit 0; fi",
        "project=",
        "args=\"$*\"",
        "prev=",
        "for arg in \"$@\"; do",
        "  if [[ \"$prev\" == \"--project\" ]]; then project=\"$arg\"; fi",
        "  prev=\"$arg\"",
        "done",
        "if [[ \"$args\" == *\" ready \"* ]]; then",
        "  if [[ \"$project\" == \"$PROJECT_A\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_A\"; exit 0; fi",
        "  if [[ \"$project\" == \"$PROJECT_B\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_B\"; exit 0; fi",
        "  if [[ \"$project\" == \"$PROJECT_OUTSIDE\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_OUTSIDE\"; exit 0; fi",
        "  printf '[]\\n'; exit 0",
        "fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '[]\\n'; exit 0; fi",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
      { encoding: "utf8" },
    );
    chmodSync(todosBin, 0o755);
    const readyA = [
      {
        id: "task-drain-registry-filter-a",
        title: "Registry route included by both filters",
        status: "pending",
        working_dir: sourceA,
        tags: ["auto:route"],
      },
    ];
    const readyB = [
      {
        id: "task-drain-registry-filter-b",
        title: "Registry route excluded by include",
        status: "pending",
        working_dir: sourceB,
        tags: ["auto:route"],
      },
    ];
    const readyOutside = [
      {
        id: "task-drain-registry-filter-outside",
        title: "Registry route excluded by prefix",
        status: "pending",
        working_dir: sourceOutside,
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
        "--todos-projects-from-registry",
        "--project-path-prefix",
        registryRoot,
        "--todos-project-include",
        `${sourceA},${sourceOutside}`,
        "--max-dispatch",
        "3",
        "--max-active",
        "10",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        PROJECT_A: sourceA,
        PROJECT_B: sourceB,
        PROJECT_OUTSIDE: sourceOutside,
        TODOS_PROJECTS_JSON: JSON.stringify([{ path: sourceA }, { path: sourceB }, { path: sourceOutside }]),
        TODOS_READY_JSON_A: JSON.stringify(readyA),
        TODOS_READY_JSON_B: JSON.stringify(readyB),
        TODOS_READY_JSON_OUTSIDE: JSON.stringify(readyOutside),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.scanned).toBe(1);
    expect(value.candidates).toBe(1);
    expect(value.created).toBe(1);
    expect(value.results).toHaveLength(1);
    expect(value.results[0].event.subject).toBe("task-drain-registry-filter-a");
    expect(value.results[0].event.data.source_project_path).toBe(sourceA);
    expect(value.results[0].event.data.project_path).toBe(canonicalSourceA);
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean);
    expect(calls.some((entry) => entry.includes("projects --json"))).toBe(true);
    const readyCalls = calls.filter((entry) => entry.includes(" ready "));
    expect(readyCalls).toHaveLength(1);
    expect(readyCalls[0]).toContain(sourceA);
    expect(readyCalls[0]).not.toContain(sourceB);
    expect(readyCalls[0]).not.toContain(sourceOutside);
  });

  test("todos task drain counts non-skippable per-task errors as fatal and exits non-zero", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-fatal-");
    const binDir = join(dataDir, "bin");
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
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    // Ready tasks missing an id hit a non-skippable route error in taskDrainEvent
    // for every candidate: a systemic failure that used to abort the batch.
    const ready = [
      { title: "no id one", status: "pending", tags: ["auto:route"] },
      { title: "no id two", status: "pending", tags: ["auto:route"] },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "routes",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "5",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    // Regression: a fully-fatal drain must NOT exit 0 (a scheduled loop would
    // otherwise mark a route-nothing run "succeeded").
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("non-skippable");
    const value = JSON.parse(result.stdout);
    expect(value.considered).toBe(2);
    expect(value.created).toBe(0);
    expect(value.fatal).toBe(2);
    // Every fatal result is individually flagged so compact/cron output keeps it.
    expect(value.results.filter((entry: { fatal?: boolean }) => entry.fatal === true)).toHaveLength(2);
  });

  test("todos task drain applies metadata provider rules with account separation evidence", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-provider-rule-");
    const binDir = join(dataDir, "bin");
    const repo = createGitRepo("loops-cli-event-drain-provider-rule-repo-");
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
        id: "task-drain-provider-rule",
        title: "Route frontend task",
        status: "pending",
        working_dir: repo,
        tags: ["auto:route"],
        metadata: {
          area: "frontend",
          account_tool: "cursor",
        },
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
        "1",
        "--dry-run",
        "--provider-rule",
        "area=frontend:claude:claude-ui-a,claude-ui-b",
        "--worktree-mode",
        "required",
        "--worktree-root",
        join(dataDir, "worktrees"),
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(1);
    expect(value.results[0].providerRouting).toMatchObject({
      provider: "claude",
      source: "rule",
      reason: "matched provider rule area=frontend",
    });
    expect(value.results[0].invocation.scope.providerRouting.rule.raw).toBe("area=frontend:claude:claude-ui-a,claude-ui-b");
    const worker = value.results[0].workflow.steps.find((step: { id: string }) => step.id === "worker");
    const verifier = value.results[0].workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(worker.target.provider).toBe("claude");
    expect(verifier.target.provider).toBe("claude");
    expect(worker.target.account.tool).toBe("claude");
    expect(verifier.target.account.tool).toBe("claude");
    expect(worker.target.account.profile).not.toBe(verifier.target.account.profile);
    expect([worker.target.account.profile, verifier.target.account.profile].sort()).toEqual(["claude-ui-a", "claude-ui-b"]);
  });

  test("todos task drain skips non-routeable tasks and continues dispatching", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-skip-non-git-");
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
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"comment\" || \"$arg\" == \"tag\" || \"$arg\" == \"untag\" ]]; then printf 'ok\\n'; exit 0; fi",
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
    expect(value.results[0].sourceTaskUpdate).toMatchObject({
      ok: true,
      attempted: true,
      taskId: "task-drain-non-git",
    });
    expect(value.results[0].sourceTaskUpdate.tagNoAuto.ok).toBe(true);
    expect(value.results[0].sourceTaskUpdate.untagAutoRoute.ok).toBe(true);
    expect(value.results[1].kind).toBe("created");
    expect(value.results[1].event.subject).toBe("task-drain-good-repo");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task drain reports failed source task cleanup for invalid project paths", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-cleanup-fail-");
    const binDir = join(dataDir, "bin");
    const nonGit = join(dataDir, "not-a-repo");
    mkdirSync(nonGit, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "args=\" $* \"",
        "if [[ \"$args\" == *\" task-lists \"* ]]; then printf '[]\\n'; exit 0; fi",
        "if [[ \"$args\" == *\" ready \"* ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$args\" == *\" comment \"* ]]; then printf 'commented\\n'; exit 0; fi",
        "if [[ \"$args\" == *\" untag \"* ]]; then printf 'untagged\\n'; exit 0; fi",
        "if [[ \"$args\" == *\" tag \"* ]]; then printf 'lock unavailable\\n' >&2; exit 9; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-cleanup-fail",
        title: "Bad route task cleanup failure",
        status: "pending",
        working_dir: nonGit,
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
    expect(value.skipped).toBe(1);
    expect(value.results[0].sourceTaskUpdate).toMatchObject({
      ok: false,
      attempted: true,
      taskId: "task-drain-cleanup-fail",
    });
    expect(value.results[0].sourceTaskUpdate.error).toContain("source task updates failed");
    expect(value.results[0].sourceTaskUpdate.comment.ok).toBe(true);
    expect(value.results[0].sourceTaskUpdate.tagNoAuto.ok).toBe(false);
    expect(value.results[0].sourceTaskUpdate.untagAutoRoute.ok).toBe(true);
  });

  test("todos task drain quarantines invalid PR project paths before reviewer gating", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-invalid-pr-path-");
    const binDir = join(dataDir, "bin");
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
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"comment\" || \"$arg\" == \"tag\" || \"$arg\" == \"untag\" ]]; then printf 'ok\\n'; exit 0; fi",
        "done",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-invalid-pr-path",
        title: "Review and safely merge hasna/secrets#5",
        description: [
          "Fingerprint: github-pr:hasna/secrets#5",
          `Repository: ${nonGit}`,
          "PR: https://github.com/hasna/secrets/pull/5",
          "",
          "Merge only when validation and policy allow it.",
        ].join("\n"),
        status: "pending",
        working_dir: dataDir,
        tags: ["auto:route", "github-pr", "pr-merge-queue"],
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
    expect(value.skipped).toBe(1);
    expect(value.created).toBe(0);
    expect(value.results[0]).toMatchObject({
      kind: "skipped",
      taskId: "task-drain-invalid-pr-path",
      routeError: true,
    });
    expect(value.results[0].reason).toContain("worktreeMode=required");
    expect(value.results[0].reason).not.toContain("PR approval/merge");
    expect(value.results[0].sourceTaskUpdate).toMatchObject({
      ok: true,
      attempted: true,
      taskId: "task-drain-invalid-pr-path",
    });
  });

  test("todos task drain skips no-auto and blocked tags before workflow creation", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-disallowed-tags-");
    const binDir = join(dataDir, "bin");
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
        id: "task-drain-no-auto",
        title: "No auto task",
        status: "pending",
        working_dir: "/tmp/not-a-real-openloops-required-repo",
        tags: ["auto:route", "no-auto"],
      },
      {
        id: "task-drain-blocked-tag",
        title: "Blocked tag task",
        status: "pending",
        working_dir: "/tmp/not-a-real-openloops-required-repo",
        tags: ["auto:route", "blocked"],
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
    expect(value.created).toBe(0);
    expect(value.skipped).toBe(2);
    expect(value.results.map((entry: { reason: string }) => entry.reason)).toEqual([
      "task has disallowed tag: no-auto",
      "task has disallowed tag: blocked",
    ]);
    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("todos task drain filters by task list and limits new dispatches", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-filter-");
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
    const dataDir = freshDataDir("loops-cli-event-drain-compact-");
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
    const dataDir = freshDataDir("loops-cli-event-drain-repo-line-");
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
    const dataDir = freshDataDir("loops-cli-event-drain-large-ready-");
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
    const dataDir = freshDataDir("loops-cli-event-handler-preflight-fail-");
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
    const dataDir = freshDataDir("loops-cli-event-handler-preflight-dedupe-");
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
    const dataDir = freshDataDir("loops-cli-event-handler-preflight-existing-workflow-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const codewith = join(binDir, "codewith");
    writeFileSync(codewith, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(codewith, 0o755);
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

    const result = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--preflight"],
      JSON.stringify(event),
      { PATH: `${binDir}:/usr/bin:/bin` },
    );

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
    const dataDir = freshDataDir("loops-cli-event-no-legacy-dedupe-");
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
    const dataDir = freshDataDir("loops-cli-event-idempotency-dedupe-");
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
    const dataDir = freshDataDir("loops-cli-event-task-update-dedupe-");
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

  test("todos task event handler dedupes failed routed work items until explicit requeue", () => {
    const dataDir = freshDataDir("loops-cli-event-failed-dedupe-");
    const event = {
      id: "evt-task-created-failed-dedupe-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-failed-dedupe",
        title: "Do not retry failed task without requeue",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='failed', loop_id=NULL, last_reason='triage gate failed' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-failed-dedupe-b" }),
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.dedupedBy).toBe("work-item");
    expect(value.workItem.id).toBe(created.workItem.id);
    expect(value.workItem.status).toBe("failed");
    expect(value.loop).toBeUndefined();
    const loopsBeforeRequeue = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loopsBeforeRequeue).toHaveLength(1);

    const requeue = runCli(dataDir, ["--json", "routes", "requeue", created.workItem.id, "--reason", "fixed project path"]);
    expect(requeue.status).toBe(0);
    const requeued = JSON.parse(requeue.stdout);
    expect(requeued.id).toBe(created.workItem.id);
    expect(requeued.status).toBe("queued");
    expect(requeued.loopId).toBeUndefined();
    expect(requeued.lastReason).toBe("fixed project path");

    const afterRequeueReplay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-failed-dedupe-c" }),
    );
    expect(afterRequeueReplay.status).toBe(0);
    const recreated = JSON.parse(afterRequeueReplay.stdout);
    expect(recreated.deduped).toBe(false);
    expect(recreated.workItem.id).toBe(created.workItem.id);
    expect(recreated.workItem.status).toBe("admitted");
    expect(recreated.loop.id).not.toBe(created.loop.id);
    const loopsAfterRequeue = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loopsAfterRequeue).toHaveLength(2);
  });

  test("todos task event handler requeues succeeded work items with operator evidence", () => {
    const dataDir = freshDataDir("loops-cli-event-succeeded-requeue-");
    const event = {
      id: "evt-task-created-succeeded-requeue-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-succeeded-requeue",
        title: "Requeue after dependency is resolved",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);
    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='succeeded', last_reason='first route completed' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-succeeded-requeue-b" }),
    );
    expect(replay.status).toBe(0);
    const deduped = JSON.parse(replay.stdout);
    expect(deduped.deduped).toBe(true);
    expect(deduped.workItem.status).toBe("succeeded");
    expect(deduped.loop.id).toBe(created.loop.id);

    const refusedActive = runCli(dataDir, ["--json", "routes", "requeue", created.workItem.id]);
    expect(refusedActive.status).not.toBe(0);
    expect(refusedActive.stderr).toContain("--reason");

    const requeue = runCli(dataDir, [
      "--json",
      "routes",
      "requeue",
      created.workItem.id,
      "--reason",
      "dependency resolved",
    ]);
    expect(requeue.status).toBe(0);
    const requeued = JSON.parse(requeue.stdout);
    expect(requeued.id).toBe(created.workItem.id);
    expect(requeued.status).toBe("queued");
    expect(requeued.lastReason).toBe("dependency resolved");

    const store = new Store(join(dataDir, "loops.db"));
    try {
      const activeInvocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-active-route", dedupeKey: "todos-task:active-route" },
        subjectRef: { kind: "task", id: "active-route", path: "/tmp/open-todos" },
        intent: "route",
        scope: { projectPath: "/tmp/open-todos" },
      });
      const activeItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:active-route",
        invocationId: activeInvocation.id,
        sourceType: "task.created",
        sourceRef: "evt-active-route",
        subjectRef: "active-route",
        projectKey: "/tmp/open-todos",
      });
      const activeWorkflow = store.createWorkflow({
        name: "active-route-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const activeLoop = store.createLoop({
        name: "active-route-loop",
        schedule: { type: "once", at: futureAt() },
        target: { type: "workflow", workflowId: activeWorkflow.id },
      });
      store.admitWorkflowWorkItem(activeItem.id, {
        workflowId: activeWorkflow.id,
        loopId: activeLoop.id,
        reason: "active capacity seed",
      });
    } finally {
      store.close();
    }

    const throttledReplay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--max-active-per-project", "1"],
      JSON.stringify({ ...event, id: "evt-task-created-succeeded-requeue-throttled" }),
    );
    expect(throttledReplay.status).toBe(0);
    const throttled = JSON.parse(throttledReplay.stdout);
    expect(throttled.queuedAtSource).toBe(true);
    expect(throttled.workItem.id).toBe(created.workItem.id);
    expect(throttled.workItem.status).toBe("deferred");
    expect(throttled.workItem.lastReason).toContain("dependency resolved");

    const throttleDb = new Database(join(dataDir, "loops.db"));
    try {
      throttleDb.query("UPDATE workflow_work_items SET status='succeeded' WHERE id <> ?").run(created.workItem.id);
    } finally {
      throttleDb.close();
    }

    const afterRequeueReplay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-succeeded-requeue-c" }),
    );
    expect(afterRequeueReplay.status).toBe(0);
    const recreated = JSON.parse(afterRequeueReplay.stdout);
    expect(recreated.deduped).toBe(false);
    expect(recreated.workItem.id).toBe(created.workItem.id);
    expect(recreated.workItem.attempts).toBe(created.workItem.attempts + 1);
    expect(recreated.workItem.lastReason).toContain("dependency resolved");
    expect(recreated.workItem.lastReason).toContain("admitted by todos-task route");
    expect(recreated.loop.id).not.toBe(created.loop.id);
    expect(recreated.workflow.id).not.toBe(created.workflow.id);
    expect(recreated.requeue).toMatchObject({
      previousWorkItemId: created.workItem.id,
      previousAttempts: created.workItem.attempts,
      attempt: created.workItem.attempts + 1,
      newWorkflowId: recreated.workflow.id,
      newLoopId: recreated.loop.id,
    });
    expect(recreated.requeue.reason).toContain("dependency resolved");
  });

  test("todos task event handler dedupes cancelled routed work items instead of crashing", () => {
    const dataDir = freshDataDir("loops-cli-event-cancelled-dedupe-");
    const event = {
      id: "evt-task-created-cancelled-dedupe-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-cancelled-dedupe",
        title: "Do not crash on cancelled task route history",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='cancelled', last_reason='loop deleted' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-cancelled-dedupe-b" }),
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.dedupedBy).toBe("work-item");
    expect(value.workItem.id).toBe(created.workItem.id);
    expect(value.workItem.status).toBe("cancelled");
    expect(value.loop.id).toBe(created.loop.id);
  });

  test("todos task event handler uses metadata project path when task data has no cwd", () => {
    const dataDir = freshDataDir("loops-cli-event-metadata-cwd-");
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
    expect(value.workflow.steps[2].target.cwd).toBe("/tmp/from-metadata");
    expect(value.workflow.steps[1].target.authProfile).toBe("account004");
    expect(value.workflow.steps[2].target.authProfile).toBe("account006");
  });

  test("todos task event handler does not let metadata override task cwd", () => {
    const dataDir = freshDataDir("loops-cli-event-data-cwd-");
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
    expect(value.workflow.steps[2].target.cwd).toBe("/tmp/from-data");
  });

  test("todos task event handler skips tasks without explicit route opt-in", () => {
    const dataDir = freshDataDir("loops-cli-event-no-route-");
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
    const dataDir = freshDataDir("loops-cli-event-bare-allowed-");
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
    ["nested-data-automation-manual-required", { data: { automation: { allowed: true, manual_required: true } } }],
    ["nested-data-task-metadata-automation-manual-required", { data: { task: { metadata: { automation: { allowed: true, manual_required: true } } } } }],
    ["nested-payload-task-metadata-automation-manual-required", { data: { payload: { task: { metadata: { automation: { allowed: true, manual_required: true } } } } } }],
    ["no-auto", { data: { tags: ["auto:route", "no-auto"] } }],
    ["blocked-tag", { data: { tags: ["auto:route", "blocked"] } }],
    ["completed", { data: { status: "completed", tags: ["auto:route"] } }],
    ["blocked", { data: { status: "blocked", tags: ["auto:route"] } }],
  ])("todos task event handler skips %s tasks", (_, overrides) => {
    const dataDir = freshDataDir("loops-cli-event-ineligible-");
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
    const dataDir = freshDataDir("loops-cli-generic-event-handler-");
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

  test("generic event handler applies provider routing rules", () => {
    const dataDir = freshDataDir("loops-cli-generic-provider-rule-");
    const repo = createGitRepo("loops-cli-generic-provider-rule-repo-");
    const event = {
      id: "evt-generic-provider-rule",
      type: "knowledge.record.created",
      source: "knowledge",
      subject: "record-provider-rule",
      data: {
        id: "record-provider-rule",
        area: "backend",
        project_path: repo,
      },
      metadata: {},
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "generic",
      "--dry-run",
      "--provider-rule",
      "area=backend:claude:claude-net-a,claude-net-b",
      "--account-tool",
      "claude",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.providerRouting).toMatchObject({
      provider: "claude",
      source: "rule",
    });
    expect(value.invocation.scope.providerRouting.provider).toBe("claude");
    expect(value.invocation.scope.accountPolicy).toBe("pool");
    const worker = value.workflow.steps.find((step: { id: string }) => step.id === "worker");
    const verifier = value.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(worker.target.provider).toBe("claude");
    expect(verifier.target.provider).toBe("claude");
    expect(worker.target.account.tool).toBe("claude");
    expect(verifier.target.account.tool).toBe("claude");
    expect(new Set([worker.target.account.profile, verifier.target.account.profile])).toEqual(new Set(["claude-net-a", "claude-net-b"]));
  });

  test("generic event handler returns requeue evidence after explicit route requeue", () => {
    const dataDir = freshDataDir("loops-cli-generic-event-requeue-");
    const event = {
      id: "evt-generic-requeue-a",
      type: "knowledge.record.created",
      source: "knowledge",
      subject: "record-requeue",
      data: {
        id: "record-requeue",
        project_path: "/tmp/open-knowledge",
      },
      time: new Date().toISOString(),
      schemaVersion: "1.0",
      metadata: {},
    };
    const args = ["--json", "events", "handle", "generic"];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);
    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='succeeded', last_reason='first generic route completed' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }

    const requeue = runCli(dataDir, [
      "--json",
      "routes",
      "requeue",
      created.workItem.id,
      "--reason",
      "generic dependency resolved",
    ]);
    expect(requeue.status).toBe(0);

    const replay = runCli(dataDir, args, JSON.stringify(event));
    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(false);
    expect(value.workItem.id).toBe(created.workItem.id);
    expect(value.workItem.lastReason).toContain("generic dependency resolved");
    expect(value.workItem.lastReason).toContain("admitted by generic-event route");
    expect(value.loop.id).not.toBe(created.loop.id);
    expect(value.workflow.id).toBeDefined();
    expect(value.requeue).toMatchObject({
      previousWorkItemId: created.workItem.id,
      previousAttempts: created.workItem.attempts,
      attempt: created.workItem.attempts + 1,
      reason: "generic dependency resolved",
      newWorkflowId: value.workflow.id,
      newLoopId: value.loop.id,
    });
  });

  test("generic event dry-run rejects unsupported provider add dirs", () => {
    const dataDir = freshDataDir("loops-cli-generic-event-invalid-adddirs-");
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
    const dataDir = freshDataDir("loops-cli-generic-event-throttle-");
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

  test("errors print structured JSON envelopes with stable codes", () => {
    const dataDir = freshDataDir("loops-cli-error-envelope-");

    const missing = runCli(dataDir, ["--json", "show", "no-such-loop"]);
    expect(missing.status).toBe(1);
    const value = JSON.parse(missing.stdout);
    expect(value.ok).toBe(false);
    expect(value.error.code).toBe("LOOP_NOT_FOUND");
    expect(value.error.message).toContain("loop not found: no-such-loop");
    expect(missing.stdout).not.toContain("    at ");
    expect(missing.stderr).toContain("loop not found: no-such-loop");

    const human = runCli(dataDir, ["show", "no-such-loop"]);
    expect(human.status).toBe(1);
    expect(human.stderr).toContain("loop not found: no-such-loop");
    expect(human.stderr).not.toContain("    at ");
  });

  test("goal status is merged into goal show", () => {
    const dataDir = freshDataDir("loops-cli-goal-status-merged-");
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "goal-status-merged",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--goal",
      "Keep the check green",
    ]);
    expect(create.status).toBe(0);

    const shown = runCli(dataDir, ["--json", "goal", "show", "goal-status-merged"]);
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout).config.objective).toBe("Keep the check green");

    const status = runCli(dataDir, ["--json", "goal", "status", "goal-status-merged"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout).config.objective).toBe("Keep the check green");

    const missing = runCli(dataDir, ["--json", "goal", "status", "missing-goal-run"]);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).error.message).toContain("goal not found");
  });

  test("routes create --dry-run previews without storing anything", () => {
    const dataDir = freshDataDir("loops-cli-routes-create-dry-run-");
    const event = {
      id: "evt-routes-create-dry-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-create-dry-0001",
        title: "Preview via routes create --dry-run",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--dry-run",
      "--event-json",
      JSON.stringify(event),
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    expect(value.deduped).toBe(false);
    expect(value.loop.target.workflowId).toBe("<created-workflow-id>");
    expect(value.sandboxPreflight[0].method).toBe("provider-native-sandbox");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toEqual([]);
    const items = JSON.parse(runCli(dataDir, ["--json", "routes", "list"]).stdout);
    expect(items).toEqual([]);
  });

  test("events handle todos-task accepts --pr-handoff for task-lifecycle routes", () => {
    const dataDir = freshDataDir("loops-cli-events-pr-handoff-");
    const event = {
      id: "evt-pr-handoff-flag-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-pr-handoff-flag-0001",
        title: "Route with PR handoff",
        working_dir: "/tmp/open-loops",
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
      "--template",
      "task-lifecycle",
      "--pr-handoff",
      "--sandbox",
      "workspace-write",
    ], JSON.stringify(event));
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.invocation.scope.prHandoff).toBe(true);
    expect(value.workflow.steps.some((step: { id: string }) => step.id === "pr-handoff")).toBe(true);
  });

  test("workflows create --template renders and stores a workflow template", () => {
    const dataDir = freshDataDir("loops-cli-workflows-create-template-");

    const created = runCli(dataDir, [
      "--json",
      "workflows",
      "create",
      "--template",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-create-template-1",
      "--var",
      "projectPath=/tmp/open-loops",
      "--var",
      "sandbox=workspace-write",
    ]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    expect(workflow.name).toContain("worker-verifier");
    expect(workflow.steps.length).toBeGreaterThan(0);

    const shown = runCli(dataDir, ["--json", "workflows", "show", workflow.id]);
    expect(shown.status).toBe(0);

    const conflicting = runCli(dataDir, ["--json", "workflows", "create", "somefile.json", "--template", "todos-task-worker-verifier"]);
    expect(conflicting.status).toBe(1);
    expect(conflicting.stderr).toContain("not both");

    const neither = runCli(dataDir, ["--json", "workflows", "create"]);
    expect(neither.status).toBe(1);
    expect(neither.stderr).toContain("requires a workflow JSON file or --template");
  });

  test("gc prunes run history, backups, and stray temp files with dry-run default", () => {
    const dataDir = freshDataDir("loops-cli-gc-");
    expect(runCli(dataDir, ["create", "command", "gc-target", "--at", futureAt(), "--cmd", "true"]).status).toBe(0);
    expect(runCli(dataDir, ["run-now", "gc-target"]).status).toBe(0);

    const backupsDir = join(dataDir, "backups");
    mkdirSync(backupsDir, { recursive: true });
    const backupNames = [1, 2, 3, 4, 5].map((n) => `loops-rename-2020-01-0${n}T00-00-00-000Z.db`);
    backupNames.forEach((name, index) => {
      const path = join(backupsDir, name);
      writeFileSync(path, "backup");
      const mtime = new Date(Date.UTC(2020, 0, index + 1));
      utimesSync(path, mtime, mtime);
    });
    writeFileSync(join(dataDir, "leftover.tmp"), "stray");

    const dry = runCli(dataDir, ["--json", "gc", "--max-age-days", "0", "--keep-per-loop", "0"]);
    expect(dry.status).toBe(0);
    const dryValue = JSON.parse(dry.stdout);
    expect(dryValue.dryRun).toBe(true);
    expect(dryValue.history.dryRun).toBe(true);
    expect(dryValue.history.loopRuns).toBe(1);
    expect(dryValue.backups.pruned).toHaveLength(2);
    expect(dryValue.strayFiles).toEqual([join(dataDir, "leftover.tmp")]);
    expect(existsSync(join(dataDir, "leftover.tmp"))).toBe(true);
    expect(JSON.parse(runCli(dataDir, ["--json", "runs", "gc-target"]).stdout)).toHaveLength(1);

    const both = runCli(dataDir, ["--json", "gc", "--dry-run", "--apply"]);
    expect(both.status).toBe(1);

    const apply = runCli(dataDir, ["--json", "gc", "--max-age-days", "0", "--keep-per-loop", "0", "--apply"]);
    expect(apply.status).toBe(0);
    const applyValue = JSON.parse(apply.stdout);
    expect(applyValue.dryRun).toBe(false);
    expect(applyValue.history.loopRuns).toBe(1);
    expect(applyValue.walCheckpoint.ran).toBe(true);
    expect(existsSync(join(dataDir, "leftover.tmp"))).toBe(false);
    const remaining = backupNames.filter((name) => existsSync(join(backupsDir, name)));
    expect(remaining).toEqual(backupNames.slice(2));
    expect(JSON.parse(runCli(dataDir, ["--json", "runs", "gc-target"]).stdout)).toEqual([]);
    expect(JSON.parse(runCli(dataDir, ["--json", "list"]).stdout)).toHaveLength(1);
  });
});
