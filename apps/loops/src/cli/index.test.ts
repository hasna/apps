import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import type { Loop } from "../types.js";
import { Store } from "../lib/store.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

function runCli(dataDir: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, LOOPS_DATA_DIR: dataDir },
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

function seedRun(store: Store, loop: Loop, status: "succeeded" | "failed" | "timed_out", slot: string, patch: { error?: string; exitCode?: number } = {}) {
  const startedAt = new Date(slot);
  const claim = store.claimRun(loop, slot, "test", startedAt);
  expect(claim).toBeDefined();
  store.finalizeRun(
    claim!.run.id,
    {
      status,
      finishedAt: new Date(startedAt.getTime() + 1_000).toISOString(),
      durationMs: 1_000,
      stdout: "",
      stderr: "",
      error: patch.error,
      exitCode: patch.exitCode,
    },
    { claimedBy: "test", now: new Date(startedAt.getTime() + 1_000) },
  );
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

  test("create/list/show/runs support labels and label edits", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-labels-"));
    const createBrowser = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "browser",
      "--at",
      futureAt(),
      "--cmd",
      "printf browser",
      "--label",
      "BrowserPlan",
      "--label",
      "nightly",
    ]);
    expect(createBrowser.status).toBe(0);
    const browser = JSON.parse(createBrowser.stdout);
    expect(browser.labels).toEqual(["browserplan", "nightly"]);

    const createOther = runCli(dataDir, ["create", "command", "other", "--at", futureAt(), "--cmd", "true", "--label", "other"]);
    expect(createOther.status).toBe(0);

    const show = runCli(dataDir, ["--json", "show", "browser"]);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).labels).toEqual(["browserplan", "nightly"]);

    const list = runCli(dataDir, ["--json", "list", "--label", "browserplan"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout).map((loop: { name: string }) => loop.name)).toEqual(["browser"]);

    const run = runCli(dataDir, ["--json", "run-now", "browser"]);
    expect(run.status).toBe(0);
    const runs = runCli(dataDir, ["--json", "runs", "--label", "browserplan"]);
    expect(runs.status).toBe(0);
    expect(JSON.parse(runs.stdout).map((entry: { loopName: string }) => entry.loopName)).toEqual(["browser"]);

    const add = runCli(dataDir, ["--json", "labels", "add", "browser", "urgent"]);
    expect(add.status).toBe(0);
    expect(JSON.parse(add.stdout).labels).toEqual(["browserplan", "nightly", "urgent"]);

    const remove = runCli(dataDir, ["--json", "labels", "remove", "browser", "nightly"]);
    expect(remove.status).toBe(0);
    expect(JSON.parse(remove.stdout).labels).toEqual(["browserplan", "urgent"]);

    const set = runCli(dataDir, ["--json", "labels", "set", "browser", "browserplan"]);
    expect(set.status).toBe(0);
    expect(JSON.parse(set.stdout).labels).toEqual(["browserplan"]);

    const clear = runCli(dataDir, ["--json", "labels", "clear", "browser"]);
    expect(clear.status).toBe(0);
    expect(JSON.parse(clear.stdout).labels).toEqual([]);
  });

  test("list filters repo loops and includes latest-run health in human output", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-repo-list-"));
    const repoPath = join(dataDir, "open-codewith");
    const otherPath = join(dataDir, "other");
    const siblingPath = join(dataDir, "open-codewith-compact-cli-output");
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(otherPath, { recursive: true });
    mkdirSync(siblingPath, { recursive: true });

    const store = new Store(join(dataDir, "loops.db"));
    try {
      const longContextError = `Maximum context length exceeded while reviewing files ${"x".repeat(500)}`;
      const cwdLoop = store.createLoop({
        name: "repo-cwd-review",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "Review this checkout", cwd: repoPath, authProfile: "account015" },
      });
      seedRun(store, cwdLoop, "failed", "2026-01-01T00:00:00.000Z", { error: longContextError });

      const commandLoop = store.createLoop({
        name: "repo-command-status",
        schedule: { type: "interval", everyMs: 120_000 },
        target: { type: "command", command: `git -C ${repoPath} status --short`, cwd: otherPath },
      });
      seedRun(store, commandLoop, "succeeded", "2026-01-01T00:01:00.000Z");

      const workflow = store.createWorkflow({
        name: "workflow-open-codewith",
        steps: [{ id: "inspect", target: { type: "command", command: "true", cwd: otherPath } }],
      });
      const workflowLoop = store.createLoop({
        name: "repo-workflow-health",
        description: "OpenRepos multi-repo loop for hasna/open-codewith",
        schedule: { type: "cron", expression: "0 * * * *" },
        target: { type: "workflow", workflowId: workflow.id, input: { OPENLOOPS_REPO_PATH: repoPath, OPENLOOPS_REPO_NAME: "open-codewith" } },
      });
      seedRun(store, workflowLoop, "timed_out", "2026-01-01T00:02:00.000Z", { error: "operation timed out after lease" });

      const unrelated = store.createLoop({
        name: "unrelated",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true", cwd: otherPath },
      });
      seedRun(store, unrelated, "failed", "2026-01-01T00:03:00.000Z", { exitCode: 1 });

      const sibling = store.createLoop({
        name: "sibling-worktree",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true", cwd: siblingPath },
      });
      seedRun(store, sibling, "succeeded", "2026-01-01T00:04:00.000Z");
    } finally {
      store.close();
    }

    const byPath = runCli(dataDir, ["list", "--repo", repoPath]);
    expect(byPath.status).toBe(0);
    expect(byPath.stdout).toContain("repo-cwd-review");
    expect(byPath.stdout).toContain("repo-command-status");
    expect(byPath.stdout).toContain("repo-workflow-health");
    expect(byPath.stdout).not.toContain("unrelated");
    expect(byPath.stdout).not.toContain("sibling-worktree");
    expect(byPath.stdout).toContain("latest=failed");
    expect(byPath.stdout).toContain("run=");
    expect(byPath.stdout).toContain("context length");
    expect(byPath.stdout).toContain("cwd=");
    expect(byPath.stdout).toContain("provider=codewith");
    expect(byPath.stdout).toContain("account=account015");
    expect(byPath.stdout).toContain("Use `loops project show <repo>`");

    const byNameJson = runCli(dataDir, ["--json", "list", "--repo", "open-codewith", "--with-latest-run"]);
    expect(byNameJson.status).toBe(0);
    const values = JSON.parse(byNameJson.stdout);
    expect(values.map((entry: { loop: { name: string } }) => entry.loop.name).sort()).toEqual([
      "repo-command-status",
      "repo-cwd-review",
      "repo-workflow-health",
    ]);
    expect(values.find((entry: { loop: { name: string } }) => entry.loop.name === "repo-cwd-review").latestRun.status).toBe("failed");
    expect(values.find((entry: { loop: { name: string } }) => entry.loop.name === "repo-cwd-review").latestRun.error.length).toBeLessThan(300);
    expect(byNameJson.stdout).not.toContain("x".repeat(500));
    expect(
      values
        .find((entry: { loop: { name: string } }) => entry.loop.name === "repo-workflow-health")
        .match.reasons.some((reason: { field: string }) => reason.field.includes("OPENLOOPS_REPO")),
    ).toBe(true);

    const byCwd = runCli(dataDir, ["--json", "list", "--cwd", repoPath]);
    expect(byCwd.status).toBe(0);
    expect(JSON.parse(byCwd.stdout).map((loop: { name: string }) => loop.name)).toEqual(["repo-cwd-review", "repo-workflow-health"]);

    const byName = runCli(dataDir, ["--json", "list", "--name", "command"]);
    expect(byName.status).toBe(0);
    expect(JSON.parse(byName.stdout).map((loop: { name: string }) => loop.name)).toEqual(["repo-command-status"]);

    const paged = runCli(dataDir, ["list", "--repo", "open-codewith", "--limit", "1"]);
    expect(paged.status).toBe(0);
    expect(paged.stdout).toContain("repeat this command with --cursor 1");
    expect(paged.stdout).not.toContain("loops list --cursor 1");

    const empty = runCli(dataDir, ["list", "--repo", "   "]);
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain("--repo must not be empty");
  });

  test("runs and project show support repo discovery filters", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-repo-runs-"));
    const repoPath = join(dataDir, "open-codewith");
    const otherPath = join(dataDir, "other");
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(otherPath, { recursive: true });

    const store = new Store(join(dataDir, "loops.db"));
    try {
      const matched = store.createLoop({
        name: "repo-health",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "Check open-codewith health", cwd: repoPath },
      });
      seedRun(store, matched, "failed", "2026-01-02T00:00:00.000Z", { error: "Schema validation failed for tool input" });

      const textMatched = store.createLoop({
        name: "manual-project-watch",
        description: "Watch the open-codewith project even when cwd is elsewhere",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true", cwd: otherPath },
      });
      seedRun(store, textMatched, "succeeded", "2026-01-02T00:01:00.000Z");

      const unrelated = store.createLoop({
        name: "other-health",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true", cwd: otherPath },
      });
      seedRun(store, unrelated, "failed", "2026-01-02T00:02:00.000Z", { error: "other failure" });
    } finally {
      store.close();
    }

    const runs = runCli(dataDir, ["--json", "runs", "--repo", "open-codewith"]);
    expect(runs.status).toBe(0);
    expect(JSON.parse(runs.stdout).map((run: { loopName: string }) => run.loopName).sort()).toEqual(["manual-project-watch", "repo-health"]);

    const failedRuns = runCli(dataDir, ["--json", "runs", "--repo", "open-codewith", "--status", "failed"]);
    expect(failedRuns.status).toBe(0);
    expect(JSON.parse(failedRuns.stdout).map((run: { loopName: string }) => run.loopName)).toEqual(["repo-health"]);

    const project = runCli(dataDir, ["project", "show", "open-codewith"]);
    expect(project.status).toBe(0);
    expect(project.stdout).toContain("project=open-codewith");
    expect(project.stdout).toContain("loops=2");
    expect(project.stdout).toContain("failed=1");
    expect(project.stdout).toContain("schema_error=1");
    expect(project.stdout).toContain("repo-health");
    expect(project.stdout).toContain("manual-project-watch");
    expect(project.stdout).not.toContain("other-health");

    const projectPaged = runCli(dataDir, ["project", "show", "open-codewith", "--limit", "1"]);
    expect(projectPaged.status).toBe(0);
    expect(projectPaged.stdout).toContain("repeat this command with --cursor 1");
    expect(projectPaged.stdout).not.toContain("loops project show --cursor 1");

    const projectJson = runCli(dataDir, ["--json", "project", "show", "open-codewith"]);
    expect(projectJson.status).toBe(0);
    const value = JSON.parse(projectJson.stdout);
    expect(value.summary.total).toBe(2);
    expect(value.summary.failureFamilies.schema_error).toBe(1);
    expect(value.loops.map((entry: { loop: { name: string } }) => entry.loop.name).sort()).toEqual(["manual-project-watch", "repo-health"]);
  });

  test("default list is capped and points to pagination while JSON remains full", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-compact-list-"));
    for (let index = 1; index <= 30; index++) {
      const create = runCli(dataDir, ["create", "command", `loop-${String(index).padStart(2, "0")}`, "--at", futureAt(), "--cmd", "true"]);
      expect(create.status).toBe(0);
    }

    const list = runCli(dataDir, ["list"]);
    expect(list.status).toBe(0);
    const lines = list.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(26);
    expect(lines.at(-1)).toContain("more available: loops list --cursor 25");
    expect(list.stdout).not.toContain('"target"');

    const next = runCli(dataDir, ["list", "--cursor", "25"]);
    expect(next.status).toBe(0);
    expect(next.stdout).toContain("loop-26");

    const json = runCli(dataDir, ["--json", "list"]);
    expect(json.status).toBe(0);
    const values = JSON.parse(json.stdout);
    expect(values).toHaveLength(30);
    expect(values[0].target.type).toBe("command");
  });

  test("show and daemon status are compact by default and verbose/json disclose details", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-compact-show-"));
    const create = runCli(dataDir, ["create", "command", "compact-show", "--at", futureAt(), "--cmd", "printf detail"]);
    expect(create.status).toBe(0);

    const show = runCli(dataDir, ["show", "compact-show"]);
    expect(show.status).toBe(0);
    expect(show.stdout.trim().startsWith("{")).toBe(false);
    expect(show.stdout).toContain("Use --verbose or --json");

    const verboseShow = runCli(dataDir, ["show", "compact-show", "--verbose"]);
    expect(verboseShow.status).toBe(0);
    expect(JSON.parse(verboseShow.stdout).target.type).toBe("command");

    const status = runCli(dataDir, ["daemon", "status"]);
    expect(status.status).toBe(0);
    expect(status.stdout.trim().startsWith("{")).toBe(false);
    expect(status.stdout).toContain("loops total=");

    const verboseStatus = runCli(dataDir, ["daemon", "status", "--verbose"]);
    expect(verboseStatus.status).toBe(0);
    expect(JSON.parse(verboseStatus.stdout).loops.total).toBe(1);

    const standaloneStatus = spawnSync(process.execPath, [join(dirname(cliPath), "../daemon/index.ts"), "status"], {
      env: { ...process.env, LOOPS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    expect(standaloneStatus.status).toBe(0);
    expect(standaloneStatus.stdout.trim().startsWith("{")).toBe(false);
    expect(standaloneStatus.stdout).toContain("loops total=");

    const standaloneJson = spawnSync(process.execPath, [join(dirname(cliPath), "../daemon/index.ts"), "--json", "status"], {
      env: { ...process.env, LOOPS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    expect(standaloneJson.status).toBe(0);
    expect(JSON.parse(standaloneJson.stdout).loops.total).toBe(1);
  });

  test("shown command output is bounded by max-output-chars", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-bounded-output-"));
    const create = runCli(dataDir, ["create", "command", "bounded", "--at", futureAt(), "--cmd", "printf abcdefghij"]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["run-now", "bounded", "--show-output", "--max-output-chars", "4"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("stdout:");
    expect(run.stdout).toContain("abcd");
    expect(run.stdout).toContain("[truncated 6 chars]");
    expect(run.stdout).not.toContain("abcdefghij");

    const jsonRun = runCli(dataDir, ["--json", "run-now", "bounded", "--show-output", "--max-output-chars", "4"]);
    expect(jsonRun.status).toBe(0);
    const jsonRunValue = JSON.parse(jsonRun.stdout);
    expect(jsonRunValue.stdout).toContain("abcd");
    expect(jsonRunValue.stdout).toContain("[truncated 6 chars]");
    expect(jsonRun.stdout).not.toContain("abcdefghij");

    const jsonRuns = runCli(dataDir, ["--json", "runs", "bounded", "--show-output", "--max-output-chars", "4"]);
    expect(jsonRuns.status).toBe(0);
    const jsonRunsValue = JSON.parse(jsonRuns.stdout);
    expect(jsonRunsValue[0].stdout).toContain("[truncated 6 chars]");
    expect(jsonRuns.stdout).not.toContain("abcdefghij");
  });

  test("JSON show-output preserves full stdout unless max-output-chars is explicit", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-json-full-output-"));
    const create = runCli(dataDir, [
      "create",
      "command",
      "json-full-output",
      "--at",
      futureAt(),
      "--cmd",
      `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(5000))"`,
    ]);
    expect(create.status).toBe(0);

    const full = runCli(dataDir, ["--json", "run-now", "json-full-output", "--show-output"]);
    expect(full.status).toBe(0);
    const value = JSON.parse(full.stdout);
    expect(value.stdout).toHaveLength(5000);
    expect(value.stdout).not.toContain("[truncated");

    const bounded = runCli(dataDir, ["--json", "runs", "json-full-output", "--show-output", "--max-output-chars", "4"]);
    expect(bounded.status).toBe(0);
    const boundedValue = JSON.parse(bounded.stdout);
    expect(boundedValue[0].stdout).toContain("xxxx");
    expect(boundedValue[0].stdout).toContain("[truncated 4996 chars]");
  });

  test("--label validates label format", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-bad-label-"));
    const create = runCli(dataDir, ["create", "command", "bad-label", "--at", futureAt(), "--cmd", "true", "--label", "bad label"]);
    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("label");
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

    const boundedRun = runCli(dataDir, ["--json", "workflows", "run", "workflow-redact", "--show-output", "--max-output-chars", "6"]);
    expect(boundedRun.status).toBe(0);
    expect(boundedRun.stdout).not.toContain(secret);
    const boundedValue = JSON.parse(boundedRun.stdout);
    expect(boundedValue.result.stdout).toContain("[truncated");
    expect(boundedValue.steps[0].stdout).toContain("[truncated");

    const inspect = runCli(dataDir, ["--json", "workflows", "inspect", value.workflowRun.id]);
    expect(inspect.status).toBe(0);
    expect(inspect.stdout).not.toContain(secret);
    const inspected = JSON.parse(inspect.stdout);
    expect(inspected.steps[0].stdout).toContain("[redacted");
  });

  test("workflow inspect JSON keeps the larger event default", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflow-json-events-"));
    const store = new Store(join(dataDir, "loops.db"));
    let runId = "";
    try {
      const workflow = store.createWorkflow({
        name: "many-events",
        steps: [{ id: "step", target: { type: "command", command: "true" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      runId = run.id;
      for (let index = 0; index < 75; index++) {
        store.appendWorkflowEvent(run.id, "note", undefined, { index });
      }
    } finally {
      store.close();
    }

    const inspect = runCli(dataDir, ["--json", "workflows", "inspect", runId]);
    expect(inspect.status).toBe(0);
    const value = JSON.parse(inspect.stdout);
    expect(value.events).toHaveLength(76);
  });

  test("workflow compact step output is capped with a disclosure flag", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflow-step-cap-"));
    const store = new Store(join(dataDir, "loops.db"));
    let runId = "";
    try {
      const workflow = store.createWorkflow({
        name: "many-steps",
        steps: Array.from({ length: 55 }, (_, index) => ({
          id: `step-${String(index).padStart(2, "0")}`,
          target: { type: "command", command: "true" },
        })),
      });
      const run = store.createWorkflowRun({ workflow });
      runId = run.id;
      for (const step of workflow.steps) store.startWorkflowStepRun(run.id, step.id);
    } finally {
      store.close();
    }

    const compact = runCli(dataDir, ["workflows", "inspect", runId]);
    expect(compact.status).toBe(0);
    expect(compact.stdout).toContain("steps=50/55");
    expect(compact.stdout).toContain("use --steps-limit 55");
    expect(compact.stdout).toContain("step-49");
    expect(compact.stdout).not.toContain("step-50");

    const expanded = runCli(dataDir, ["workflows", "inspect", runId, "--steps-limit", "55"]);
    expect(expanded.status).toBe(0);
    expect(expanded.stdout).toContain("step-54");
    expect(expanded.stdout).toContain("steps=55.");
  });

  test("workflow compact step output redacts raw errors", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflow-error-redact-"));
    const store = new Store(join(dataDir, "loops.db"));
    let runId = "";
    try {
      const workflow = store.createWorkflow({
        name: "workflow-error-redact",
        steps: [{ id: "secret-error", target: { type: "command", command: "false" } }],
      });
      const run = store.createWorkflowRun({ workflow });
      runId = run.id;
      store.startWorkflowStepRun(run.id, "secret-error");
      store.finalizeWorkflowStepRun(run.id, "secret-error", {
        status: "failed",
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: "SECRET_ERROR_TOKEN should not be shown",
      });
    } finally {
      store.close();
    }

    const compact = runCli(dataDir, ["workflows", "inspect", runId]);
    expect(compact.status).toBe(0);
    expect(compact.stdout).toContain("error=[redacted");
    expect(compact.stdout).not.toContain("SECRET_ERROR_TOKEN");
  });

  test("workflow run compact step output is capped", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-workflow-run-step-cap-"));
    const file = workflowFile(dataDir, {
      name: "run-many-steps",
      steps: Array.from({ length: 55 }, (_, index) => ({
        id: `run-step-${String(index).padStart(2, "0")}`,
        target: { type: "command", command: "true" },
      })),
    });
    const create = runCli(dataDir, ["workflows", "create", file]);
    expect(create.status).toBe(0);

    const compact = runCli(dataDir, ["workflows", "run", "run-many-steps"]);
    expect(compact.status).toBe(0);
    expect(compact.stdout).toContain("steps=50/55");
    expect(compact.stdout).toContain("use --steps-limit 55");
    expect(compact.stdout).toContain("run-step-49");
    expect(compact.stdout).not.toContain("run-step-50");

    const expanded = runCli(dataDir, ["workflows", "run", "run-many-steps", "--steps-limit", "55"]);
    expect(expanded.status).toBe(0);
    expect(expanded.stdout).toContain("run-step-54");
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

  test("goal show JSON keeps the store default run count", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-goal-json-runs-"));
    const store = new Store(join(dataDir, "loops.db"));
    let goalId = "";
    try {
      const goal = store.createGoal({ objective: "track many events" });
      goalId = goal.goalId;
      for (let index = 0; index < 150; index++) {
        store.recordGoalEvent({
          goalId,
          phase: "status",
          status: "active",
          tokensUsed: index,
        });
      }
    } finally {
      store.close();
    }

    const show = runCli(dataDir, ["--json", "goal", "show", goalId]);
    expect(show.status).toBe(0);
    const value = JSON.parse(show.stdout);
    expect(value.runs).toHaveLength(150);
  });

  test("--goal requires a non-empty objective", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-empty-goal-"));
    const create = runCli(dataDir, ["create", "command", "bad-goal", "--at", futureAt(), "--cmd", "true", "--goal", " "]);
    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("goal.objective");
  });
});
