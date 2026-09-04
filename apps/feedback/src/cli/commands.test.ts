// Sol-guided coverage — Priority 1: CLI command contract (success AND failure
// arm per command, exit status + message assertions).
//
// The CLI is spawned as a subprocess against a temp data dir, so stdout/stderr
// and the exit code are measured exactly as an operator would see them. Each
// test carries a positive and a negative case: the command's success arm is
// pinned against its failure arm.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "index.ts");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  dataDir: string;
}

async function runCli(args: string[], env: Record<string, string> = {}, dataDir?: string): Promise<RunResult> {
  const resolvedDir = dataDir ?? mkdtempSync(join(tmpdir(), "feedback-cli-cmd-"));
  // Local-store flows require the explicit opt-in since the fail-closed rule
  // (2026-09-04): no FEEDBACK_API_URL and no FEEDBACK_LOCAL=1 means the CLI
  // refuses instead of silently writing to the machine-local store. Tests of
  // the fail-closed arms override FEEDBACK_LOCAL to "".
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    env: {
      ...process.env,
      HASNA_FEEDBACK_DATA_DIR: resolvedDir,
      HASNA_FEEDBACK_STORE: "jsonl",
      FEEDBACK_TASK_SINK: "none",
      FEEDBACK_LOCAL: "1",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr, dataDir: resolvedDir };
}

/** A fake `todos` binary that always "creates" a task, for sync-tasks tests. */
function fakeTodosBin(): string {
  const binDir = mkdtempSync(join(tmpdir(), "feedback-todos-bin-"));
  const bin = join(binDir, "todos");
  writeFileSync(bin, '#!/usr/bin/env bash\nprintf \'{"id":"task-late-1","short_id":"X-1"}\\n\'\n');
  chmodSync(bin, 0o755);
  return binDir;
}

async function submitItem(args: string[], env: Record<string, string> = {}): Promise<RunResult & { id: string }> {
  const result = await runCli(["submit", "needs a fix", "--app", "app-cli", ...args], env);
  expect(result.code).toBe(0);
  return { ...result, id: (JSON.parse(result.stdout) as { id: string }).id };
}

describe("feedback CLI command contract", () => {
  test("shipped with an unknown id exits 1 and names the id on stderr", async () => {
    const result = await runCli(["shipped", "missing-id", "--changelog-ref", "CH-1"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Feedback not found");
    expect(result.stderr).toContain("missing-id");
    expect(result.stdout).toBe("");
  });

  test("shipped persists the changelog receipt locally when the store supports it", async () => {
    const submitted = await submitItem([]);
    const result = await runCli(
      ["shipped", submitted.id, "--changelog-ref", "CH-42"],
      { HASNA_FEEDBACK_DATA_DIR: submitted.dataDir },
      submitted.dataDir,
    );
    expect(result.code).toBe(0);
    const shipped = JSON.parse(result.stdout) as { status: string; changelogRef: string; shippedAt: string };
    expect(shipped.status).toBe("shipped");
    expect(shipped.changelogRef).toBe("CH-42");
    expect(shipped.shippedAt).toBeDefined();
  });

  test("sync-tasks with no sink configured exits 1 and names the fix", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "feedback-cli-nosink-"));
    await submitItem([], { HASNA_FEEDBACK_DATA_DIR: dataDir });
    const result = await runCli(["sync-tasks"], { HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No task sink is configured");
    expect(result.stderr).toContain("FEEDBACK_TASK_SINK");
  });

  test("sync-tasks reports uncertain items without re-filing them, and --retry-uncertain is the only way to file them", async () => {
    // Simulate the crash window: a stored row that carries a taskAttempt marker
    // (the create-time write happened) but no recorded outcome (the linkage
    // patch never landed). sync-tasks must report it as uncertain and NOT file
    // a duplicate task.
    const dataDir = mkdtempSync(join(tmpdir(), "feedback-cli-uncertain-"));
    writeFileSync(
      join(dataDir, "feedback.jsonl"),
      JSON.stringify({
        id: "fb-uncertain-1",
        appId: "app-cli",
        message: "crashed between task and link",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        status: "new",
        source: "cli",
        kind: "bug",
        tags: [],
        taskAttempt: { startedAt: "2026-08-01T00:00:01.000Z", attempts: 1 },
      }) + "\n",
    );
    const env = {
      HASNA_FEEDBACK_DATA_DIR: dataDir,
      FEEDBACK_TASK_SINK: "todos",
      PATH: `${fakeTodosBin()}:${process.env.PATH ?? ""}`,
    };

    const result = await runCli(["sync-tasks"], env, dataDir);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("1 item(s) have an attempt with no recorded outcome");
    expect(result.stderr).toContain("NOT re-filed");
    const parsed = JSON.parse(result.stdout) as { created: number; uncertain: number; failed: number };
    expect(parsed.created).toBe(0);
    expect(parsed.uncertain).toBe(1);
    expect(parsed.failed).toBe(0);
    const after = await runCli(["sync-tasks", "--retry-uncertain"], env, dataDir);
    const forced = JSON.parse(after.stdout) as { created: number; uncertain: number };
    expect(forced.created).toBe(1);
    expect(forced.uncertain).toBe(0);
  });

  test("submit merges --metadata and --meta and normalizes repeated tags", async () => {
    const result = await runCli([
      "submit", "merge me",
      "--app", "app-cli",
      "--tag", "Beta, alpha",
      "--tag", "gamma",
      "--tag", "alpha",
      "--metadata", '{"fromJson": 1}',
      "--meta", "fromKey=value",
    ]);
    expect(result.code).toBe(0);
    const item = JSON.parse(result.stdout) as { tags: string[]; metadata: Record<string, unknown> };
    expect(item.tags).toEqual(["alpha", "beta", "gamma"]);
    expect(item.metadata).toEqual({ fromJson: 1, fromKey: "value" });
  });

  test("submit rejects a --metadata value that is not a JSON object", async () => {
    const result = await runCli(["submit", "bad metadata", "--app", "app-cli", "--metadata", '["not", "an", "object"]']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--metadata must be a JSON object");
  });

  test("submit rejects malformed --metadata JSON and a --meta value without =", async () => {
    const badJson = await runCli(["submit", "bad json", "--app", "app-cli", "--metadata", "not json at all"]);
    expect(badJson.code).toBe(1);

    const badKeyValue = await runCli(["submit", "bad kv", "--app", "app-cli", "--meta", "novalue"]);
    expect(badKeyValue.code).toBe(1);
    expect(badKeyValue.stderr).toContain("Expected key=value");
  });

  test("submit --context merges with explicit flags winning over context values", async () => {
    const result = await runCli([
      "submit", "context me",
      "--app", "app-cli",
      "--route", "/home",
      "--env", "prod",
      "--screen", "settings",
      "--context", "route=/from-context",
      "--context", "custom=yes",
    ]);
    expect(result.code).toBe(0);
    const item = JSON.parse(result.stdout) as { context: Record<string, string> };
    expect(item.context.route).toBe("/home");
    expect(item.context.environment).toBe("prod");
    expect(item.context.screen).toBe("settings");
    expect(item.context.custom).toBe("yes");
  });

  test("list applies the common filter (app/status) with a defaulted limit", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "feedback-cli-list-"));
    await submitItem([], { HASNA_FEEDBACK_DATA_DIR: dataDir });
    await runCli(["submit", "other app feedback", "--app", "other-app"], { HASNA_FEEDBACK_DATA_DIR: dataDir });
    const result = await runCli(["list", "--app", "app-cli", "--status", "new", "--limit", "10"], { HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
    expect(result.code).toBe(0);
    const items = JSON.parse(result.stdout) as { appId: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]!.appId).toBe("app-cli");
  });

  test("export emits one JSON object per line for jsonl and a JSON array for json", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "feedback-cli-export-"));
    await submitItem([], { HASNA_FEEDBACK_DATA_DIR: dataDir });

    const jsonl = await runCli(["export", "--format", "jsonl"], { HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
    expect(jsonl.code).toBe(0);
    expect(jsonl.stdout.startsWith("{")).toBe(true);
    const lines = jsonl.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line.startsWith("[")).toBe(false);
    }

    const json = await runCli(["export", "--format", "json"], { HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
    expect(json.code).toBe(0);
    const array = JSON.parse(json.stdout) as unknown[];
    expect(Array.isArray(array)).toBe(true);
    expect(array).toHaveLength(1);
  });

  test("status with an unknown id exits 1 and names the id on stderr", async () => {
    const result = await runCli(["status", "missing-status-id", "new"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Feedback not found");
    expect(result.stderr).toContain("missing-status-id");
  });

  test("status with a valid id updates the item and prints it", async () => {
    const submitted = await submitItem([]);
    const result = await runCli(
      ["status", submitted.id, "triaged"],
      { HASNA_FEEDBACK_DATA_DIR: submitted.dataDir },
      submitted.dataDir,
    );
    expect(result.code).toBe(0);
    const item = JSON.parse(result.stdout) as { status: string };
    expect(item.status).toBe("triaged");
  });

  test("submit with --api-url selects the remote client path — a dead endpoint fails instead of writing locally", async () => {
    const result = await runCli([
      "submit", "must go remote",
      "--app", "app-cli",
      "--api-url", "http://127.0.0.1:9",
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
    // The item must NOT have been stored locally: the remote path was taken.
    const list = await runCli(["list", "--limit", "10"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });
});

describe("feedback CLI fails closed without a configured target", () => {
  // No FEEDBACK_API_URL and no explicit FEEDBACK_LOCAL opt-in: every data verb
  // must refuse with a non-zero exit and never open the on-box store.
  const UNCONFIGURED = { FEEDBACK_LOCAL: "" };

  test("data verbs exit 1, name the required env, and create no local store", async () => {
    for (const args of [
      ["submit", "must not go local", "--app", "app-cli"],
      ["list", "--limit", "10"],
      ["stats"],
      ["show", "missing-id"],
      ["export", "--format", "jsonl"],
    ]) {
      const dataDir = mkdtempSync(join(tmpdir(), "feedback-cli-fc-"));
      const result = await runCli(args, { ...UNCONFIGURED, HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("FEEDBACK_API_URL");
      expect(result.stderr).toContain("FEEDBACK_LOCAL");
      // Fail-closed runs must not leave a local SQLite/JSONL store behind.
      expect(readdirSync(dataDir)).toEqual([]);
    }
  });

  test("sync-tasks refuses to open the on-box store without the opt-in", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "feedback-cli-fc-"));
    const result = await runCli(["sync-tasks"], { ...UNCONFIGURED, HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("FEEDBACK_API_URL");
    expect(result.stderr).toContain("FEEDBACK_LOCAL");
    expect(readdirSync(dataDir)).toEqual([]);
  });

  test("doctor exits 1 and reports the fail-closed none target without touching local storage", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "feedback-cli-fc-"));
    const result = await runCli(["doctor"], { ...UNCONFIGURED, HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout) as { ok: boolean; target: string; blockers: string[] };
    expect(report.ok).toBe(false);
    expect(report.target).toBe("none");
    expect(report.blockers.join(" ")).toContain("FEEDBACK_API_URL");
    expect(report.blockers.join(" ")).toContain("FEEDBACK_LOCAL");
    expect(readdirSync(dataDir)).toEqual([]);
  });

  test("the same verbs reach the on-box store once FEEDBACK_LOCAL=1 is set", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "feedback-cli-fc-"));
    const submitted = await submitItem([], { HASNA_FEEDBACK_DATA_DIR: dataDir });
    const listed = await runCli(["list", "--limit", "10"], { HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
    expect(listed.code).toBe(0);
    const items = JSON.parse(listed.stdout) as { id: string }[];
    expect(items.map((item) => item.id)).toContain(submitted.id);
    // sync-tasks reaches the local store (and then reports the deliberately
    // unconfigured sink) — the fail-closed env error would say FEEDBACK_API_URL
    // instead, so reaching the sink check proves the opt-in path ran.
    const synced = await runCli(["sync-tasks"], { HASNA_FEEDBACK_DATA_DIR: dataDir }, dataDir);
    expect(synced.code).toBe(1);
    expect(synced.stderr).toContain("No task sink is configured");
    expect(synced.stderr).not.toContain("FEEDBACK_API_URL");
    const report = await runCli(["doctor"], { HASNA_FEEDBACK_DATA_DIR: dataDir, FEEDBACK_LOCAL: "1" }, dataDir);
    expect(report.code).toBe(0);
    expect((JSON.parse(report.stdout) as { target: string }).target).toBe("local");
  });
});
