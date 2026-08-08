import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Command } from "commander";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { acquireWorkspaceLock, completeAgentRun, createRoot, createWorkspace, startAgentRun } from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import { closeDatabase } from "../db/database.js";
import { deriveWorkspaceRegistryFields } from "../lib/workspace-plan.js";
import { PROJECT_REGISTRATION_DEPENDENCY_TASKS } from "../lib/project-registration.js";
import { registerWorkspaceCommands } from "./commands/workspaces.js";
import { API_MODE_ENV_KEYS, testSpawnEnv } from "../testing/spawn-env.js";
import { __resetProjectStore } from "../store/project-store.js";
import type { Root, WorkspaceKind } from "../types/workspace.js";

const CLI_PATH = join(process.cwd(), "src/cli/index.ts");

function runProjects(args: string[], env: Record<string, string> = {}, cwd = process.cwd()) {
  return Bun.spawnSync({
    cmd: ["bun", "run", CLI_PATH, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: testSpawnEnv(env),
    cwd,
  });
}

async function runProjectsAsync(args: string[], env: Record<string, string> = {}, cwd = process.cwd()) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI_PATH, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: testSpawnEnv(env),
    cwd,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
  };
}

async function runProjectsWithStdin(
  args: string[],
  stdin: string,
  env: Record<string, string> = {},
  cwd = process.cwd(),
) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI_PATH, ...args],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: testSpawnEnv(env),
    cwd,
  });
  proc.stdin.write(stdin);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
  };
}

async function runWorkspaceCommandInProcess(args: string[], env: Record<string, string> = {}) {
  const program = new Command();
  program.name("projects").exitOverride();
  registerWorkspaceCommands(program);

  const previousEnv = new Map<string, string | undefined>();
  // Same reasoning as testSpawnEnv(): an operator shell that exports the cloud
  // selectors would otherwise silently turn these in-process local-store runs
  // into api-mode runs against the real backend.
  for (const key of API_MODE_ENV_KEYS) {
    if (key in env) continue;
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
  // resolveProjectStore() memoises the store it built from process.env, and the
  // module registry is shared across test files in one `bun test` run. Clearing
  // the API env vars is therefore not enough: a store another file already
  // resolved in api mode survives, and these local-store runs then read and
  // report against the REAL production registry. Observed as
  // "top-level list JSON output is not truncated above 64 KiB" returning live
  // rows whenever this file ran alongside src/mcp. Reset on both sides of the
  // swap so the run is pinned to the temp database it set up.
  __resetProjectStore();

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const capture = (chunks: string[], chunk: unknown, encodingOrCallback?: BufferEncoding | ((err?: Error) => void), callback?: (err?: Error) => void): boolean => {
    chunks.push(typeof chunk === "string"
      ? chunk
      : Buffer.from(chunk as Uint8Array).toString(typeof encodingOrCallback === "string" ? encodingOrCallback : "utf-8"));
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();
    return true;
  };

  process.stdout.write = ((chunk: unknown, encodingOrCallback?: BufferEncoding | ((err?: Error) => void), callback?: (err?: Error) => void) => (
    capture(stdoutChunks, chunk, encodingOrCallback, callback)
  )) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, encodingOrCallback?: BufferEncoding | ((err?: Error) => void), callback?: (err?: Error) => void) => (
    capture(stderrChunks, chunk, encodingOrCallback, callback)
  )) as typeof process.stderr.write;

  try {
    await program.parseAsync(args, { from: "user" });
    return { exitCode: 0, stdout: Buffer.from(stdoutChunks.join("")), stderr: Buffer.from(stderrChunks.join("")) };
  } catch (err) {
    const exitCode = typeof (err as { exitCode?: unknown }).exitCode === "number" ? (err as { exitCode: number }).exitCode : undefined;
    if (exitCode === undefined) throw err;
    return { exitCode, stdout: Buffer.from(stdoutChunks.join("")), stderr: Buffer.from(stderrChunks.join("")) };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    closeDatabase();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetProjectStore();
  }
}

async function readStreamChunk(stream: ReadableStream<Uint8Array> | null, timeoutMs = 3_000): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const timeout = setTimeout(() => undefined, timeoutMs);
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs)),
    ]);
    return result.value ? Buffer.from(result.value).toString("utf-8") : "";
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf-8");
}

function reserveFreePort(): number {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });
  const port = server.port;
  server.stop(true);
  if (!port) throw new Error("Failed to reserve test port");
  return port;
}

function cloudDoctorFixture() {
  const root = mkdtempSync(join(tmpdir(), "projects-cloud-doctor-"));
  const dbPath = join(root, "projects.db");
  const projectPath = join(root, "monthly-filing");
  const projectId = "wks_oyhvttd02j1b";
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(
    join(projectPath, ".project.json"),
    JSON.stringify({ schema_version: 1, id: projectId, slug: "monthly-accounting" }, null, 2) + "\n",
  );
  const db = new Database(dbPath);
  runMigrations(db);
  db.close();

  const port = reserveFreePort();
  const project = {
    id: projectId,
    slug: "monthly-filing",
    name: "Monthly Filing",
    description: null,
    kind: "generic",
    status: "active",
    root_id: null,
    recipe_id: null,
    canonical_machine: null,
    primary_path: projectPath,
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags: [],
    integrations: {},
    metadata: {},
    last_opened_at: null,
    created_at: "2026-08-07 11:42:01.569",
    updated_at: "2026-08-07 11:42:01.569",
    synced_at: null,
  };
  const requests: Array<{ method: string; path: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      requests.push({ method: req.method, path: url.pathname });
      if (req.method === "GET" && url.pathname === `/v1/projects/${projectId}`) {
        return Response.json(project);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  const env = {
    HASNA_PROJECTS_DB_PATH: dbPath,
    HASNA_PROJECTS_HOME: join(root, "home"),
    HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_PROJECTS_API_KEY: "test-key",
  };
  const runDoctor = async (extraArgs: string[]) => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", CLI_PATH, "doctor", projectId, "--fix", "--verbose", "--json", ...extraArgs],
      stdout: "pipe",
      stderr: "pipe",
      env: testSpawnEnv(env),
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    return { exitCode: proc.exitCode, stdout, stderr };
  };
  return {
    dbPath,
    projectId,
    projectPath,
    requests,
    runDoctor,
    close() {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("project-first CLI surface", () => {
  test("registers project-first commands on the main CLI", () => {
    const source = readFileSync("src/cli/index.ts", "utf-8");

    expect(source).toContain("registerWorkspaceCommands");
  });

  test("help exposes project commands and hides the legacy workspace group", () => {
    const eventsDir = mkdtempSync(join(tmpdir(), "projects-events-"));
    try {
      const result = runProjects(["--help"], { HASNA_EVENTS_DIR: eventsDir });
      const stdout = text(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("High-level project management and launcher CLI");
      expect(stdout).toContain("start");
      expect(stdout).toContain("create");
      expect(stdout).toContain("register-full");
      expect(stdout).toContain("list");
      expect(stdout).toContain("show");
      expect(stdout).toContain("sessions");
      expect(stdout).not.toContain("workspaces");
      expect(stdout).toContain("store");
      expect(stdout).toContain("labels");
      expect(stdout).toContain("oss");
      expect(stdout).toContain("roots");
      expect(stdout).toContain("tmux-profiles");
      expect(stdout).toContain("hasna-events");
      expect(stdout).toContain("webhooks");
      expect(stdout).toContain("reports");
    } finally {
      rmSync(eventsDir, { recursive: true, force: true });
    }
  });

  test("register-full consumes a bounded stdin request and fails closed before local mutation when authority contracts are unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const payload = JSON.stringify({
      operation_id: "op-cli-register-full",
      project: {
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
      },
      target_path: targetPath,
      goals_markdown: "# Goals\n\n- Register safely.\n",
      response_byte_limit: 512_000,
      time_budget_ms: 10_000,
    });
    try {
      const result = await runProjectsWithStdin(
        ["register-full", "--json"],
        payload,
        { HASNA_PROJECTS_DB_PATH: dbPath },
      );
      expect(result.exitCode).toBe(1);
      expect(text(result.stderr)).toBe("");
      const body = JSON.parse(text(result.stdout)) as {
        ok: boolean;
        outcome: string;
        dependencies: Array<{ dependency_task_id: string }>;
      };
      expect(body.ok).toBe(false);
      expect(body.outcome).toBe("no_go");
      expect(body.dependencies.map((item) => item.dependency_task_id).sort()).toEqual(
        Object.values(PROJECT_REGISTRATION_DEPENDENCY_TASKS).sort(),
      );
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(targetPath)).toBe(false);
      expect(text(result.stdout)).not.toContain(targetPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("subcommand --help/-h print commander usage instead of invoking the prompt agent", () => {
    for (const helpFlag of ["--help", "-h"]) {
      const result = runProjects(["create", helpFlag]);
      const stdout = text(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("Usage: projects create [options]");
      expect(stdout).toContain("Create or plan a project anywhere on disk");
      // Regression guard: prompt-agent output describes "parameters" in prose and
      // never emits a commander usage banner. If routing regresses, the help flag
      // is treated as a natural-language prompt and this banner disappears.
      expect(stdout).toContain("--name <name>");
    }
  });

  test("prompt flags cannot hijack delete dispatch and delete requires a target", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-delete-dispatch-"));
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      WORKSPACES_AGENT_MOCK: "1",
    };
    try {
      const create = runProjects([
        "create",
        "--name",
        "Dispatch Target",
        "--path",
        join(root, "dispatch-target"),
        "--json",
      ], env);
      expect(create.exitCode).toBe(0);

      for (const promptFlag of [
        { name: "--yes", args: ["--yes"] },
        { name: "--model", args: ["--model", "test-model"] },
        { name: "--max-steps", args: ["--max-steps", "2"] },
        { name: "--no-tmux", args: ["--no-tmux"] },
      ]) {
        const result = runProjects(["delete", "--hard", ...promptFlag.args, "dispatch-target"], env);
        expect(result.exitCode).toBe(1);
        expect(text(result.stderr)).toContain(`unknown option '${promptFlag.name}'`);
      }

      const stillPresent = runProjects(["show", "dispatch-target", "--json"], env);
      expect(stillPresent.exitCode).toBe(0);

      const missingTarget = runProjects(["delete", "--hard"], env);
      expect(missingTarget.exitCode).toBe(1);
      expect(text(missingTarget.stderr)).toContain("missing required argument 'id-or-slug'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("reports serve defaults to loopback and keeps existing project registry semantics", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-reports-serve-"));
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_HOME: join(root, "projects-home"),
    };
    const projectPath = join(root, "fleet-reports");
    const reportsDir = join(projectPath, "reports", "2026-07-04");
    const port = reserveFreePort();
    try {
      expect(runProjects(["create", "--name", "Fleet Reports", "--slug", "fleet-reports", "--path", projectPath, "--mkdir", "--json"], env).exitCode).toBe(0);
      mkdirSync(reportsDir, { recursive: true });
      writeFileSync(join(reportsDir, "daily.md"), "# Fleet daily\n");

      const help = runProjects(["reports", "serve", "--help"], env);
      const helpStdout = text(help.stdout);
      expect(help.exitCode).toBe(0);
      expect(helpStdout).toContain('--host <host>');
      expect(helpStdout).toContain('(default: "127.0.0.1")');
      expect(helpStdout).toContain("--token <token>");
      expect(helpStdout).toContain("--trust-network");

      const rejected = runProjects(["reports", "serve", "--host", "0.0.0.0", "--port", String(port), "--json"], env);
      expect(rejected.exitCode).toBe(1);
      expect(text(rejected.stderr)).toBe("");
      expect(JSON.parse(text(rejected.stdout)).error.message).toContain("PROJECTS_REPORTS_TOKEN");

      const proc = Bun.spawn({
        cmd: ["bun", "run", CLI_PATH, "reports", "serve", "--port", String(port), "--json"],
        stdout: "pipe",
        stderr: "pipe",
        env: testSpawnEnv(env),
      });
      try {
        const stdout = await readStreamChunk(proc.stdout);
        const payload = JSON.parse(stdout) as {
          ok: boolean;
          mode: string;
          host: string;
          port: number;
          url: string;
        };
        expect(payload).toMatchObject({
          ok: true,
          mode: "reports",
          host: "127.0.0.1",
          port,
          url: `http://127.0.0.1:${port}/`,
        });
        await Bun.sleep(500);
        expect(proc.exitCode).toBeNull();

        const rootPage = await fetch(`http://127.0.0.1:${port}/`);
        expect(rootPage.status).toBe(200);
        expect(await rootPage.text()).toContain("Fleet Reports");
      } finally {
        proc.kill("SIGTERM");
        await proc.exited;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Parse the top-level command surface advertised by `--help`.
  // `primary` = canonical command names; `all` = names plus aliases (e.g. show|get).
  function actualTopLevelCommands(): { primary: Set<string>; all: Set<string> } {
    const help = text(runProjects(["--help"]).stdout);
    const start = help.indexOf("Commands:");
    expect(start).toBeGreaterThanOrEqual(0);
    // The Commands: block runs until the next blank line / section header.
    const block = help.slice(start).split("\n\n")[0] ?? "";
    const primary = new Set<string>();
    const all = new Set<string>();
    for (const line of block.split("\n")) {
      const match = line.match(/^ {2}([a-z][a-z-]*(?:\|[a-z-]+)?)/);
      if (!match) continue;
      const tokens = match[1]!.split("|");
      if (tokens[0] === "help") continue;
      primary.add(tokens[0]!);
      for (const token of tokens) all.add(token);
    }
    return { primary, all };
  }

  test("completion command list matches the actual CLI surface", () => {
    const { primary, all } = actualTopLevelCommands();
    // Sanity: help parsing found a plausible surface.
    expect(primary.size).toBeGreaterThan(20);

    const result = runProjects(["completion"]);
    const stdout = text(result.stdout);
    expect(result.exitCode).toBe(0);

    const listMatch = stdout.match(/local commands="([^"]+)"/);
    expect(listMatch).not.toBeNull();
    const offered = new Set(listMatch![1]!.split(" ").filter(Boolean));

    // No omissions: every real command/alias is offered by bash completion.
    for (const command of all) {
      expect(offered.has(command)).toBe(true);
    }
    // No stale tokens: every offered token is a real command/alias.
    for (const token of offered) {
      expect(all.has(token)).toBe(true);
    }

    // Regression guard for the specific commands the static list dropped/misnamed.
    for (const command of ["budgets", "webhooks", "hasna-events", "store"]) {
      expect(offered.has(command)).toBe(true);
    }
    expect(offered.has("storage")).toBe(all.has("storage"));

    expect(stdout).toContain("projects list");
    expect(stdout).toContain("project>");
    expect(stdout).not.toContain("workspace>");

    // zsh completion is derived from the same live command surface (primary names).
    const zsh = runProjects(["completion", "--shell", "zsh"]);
    const zshStdout = text(zsh.stdout);
    expect(zsh.exitCode).toBe(0);
    for (const command of primary) {
      expect(zshStdout).toContain(`'${command}:`);
    }
    for (const command of ["budgets", "webhooks", "hasna-events"]) {
      expect(zshStdout).toContain(`'${command}:`);
    }
  });

  test("oss matrix CLI emits capped JSON without optional external refs", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-oss-matrix-"));
    mkdirSync(join(root, "open-alpha"));
    mkdirSync(join(root, "open-beta"));
    mkdirSync(join(root, "not-open"));
    writeFileSync(join(root, "open-alpha", "package.json"), JSON.stringify({
      name: "@hasna/open-alpha",
      version: "0.0.1",
      bin: { "open-alpha": "dist/cli.js" },
    }));

    try {
      const result = runProjects([
        "oss",
        "matrix",
        "--root",
        root,
        "--prefix",
        "open-",
        "--limit",
        "1",
        "--no-tasks",
        "--no-prs",
        "--no-tmux",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(text(result.stdout)) as {
        kind: string;
        total_candidates: number;
        returned: number;
        truncated: boolean;
        rows: Array<{ name: string; package: { name: string; bins: string[] } | null; task_refs: unknown[]; pr_refs: unknown[]; tmux: unknown }>;
      };
      expect(payload.kind).toBe("projects.oss_matrix");
      expect(payload.total_candidates).toBe(2);
      expect(payload.returned).toBe(1);
      expect(payload.truncated).toBe(true);
      expect(payload.rows[0]?.name).toBe("open-alpha");
      expect(payload.rows[0]?.package?.name).toBe("@hasna/open-alpha");
      expect(payload.rows[0]?.package?.bins).toEqual(["open-alpha"]);
      expect(payload.rows[0]?.task_refs).toEqual([]);
      expect(payload.rows[0]?.pr_refs).toEqual([]);
      expect(payload.rows[0]?.tmux).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("oss matrix CLI rejects malformed positive integer options", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-oss-matrix-invalid-"));
    try {
      const result = runProjects([
        "oss",
        "matrix",
        "--root",
        root,
        "--limit",
        "1abc",
        "--no-tasks",
        "--no-prs",
        "--no-tmux",
        "--json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(text(result.stderr)).toContain("--limit must be a positive integer");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("package publishes Cursor goal hook files", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { files: string[] };
    expect(pkg.files).toContain(".cursor/hooks.json");
    expect(pkg.files).toContain(".cursor/hooks/goal-continue.sh");
    expect(pkg.files).toContain("docs");
  });

  test("agent-assist CLI commands emit JSON, agent text, and run detail by default", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-agent-assist-"));
    const dbPath = join(root, "projects.db");
    const env = { HASNA_PROJECTS_DB_PATH: dbPath };
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);
    const project = createWorkspace({
      name: "Agent Assist",
      slug: "agent-assist",
      kind: "project",
      primary_path: join(root, "agent-assist"),
    }, db);
    const run = startAgentRun({ workspace_id: project.id, prompt: "inspect state", model: "test-model" }, db);
    completeAgentRun(run.id, { status: "completed", tool_calls: [{ name: "projects_show" }] }, db);
    db.close();

    const context = runProjects(["context", "agent-assist", "--json"], env);
    expect(context.exitCode).toBe(0);
    expect((JSON.parse(text(context.stdout)) as { kind: string; target: { resolved: boolean } }).kind).toBe("projects.agent_context");

    const next = runProjects(["next", "agent-assist", "--json"], env);
    expect(next.exitCode).toBe(0);
    expect((JSON.parse(text(next.stdout)) as { kind: string; actions: unknown[] }).kind).toBe("projects.next");

    const why = runProjects(["why", "agent-assist", "--for-agent"], env);
    expect(why.exitCode).toBe(0);
    expect(text(why.stdout)).toContain("Resolution");

    const channel = runProjects(["channel", "agent-assist"], env);
    expect(channel.exitCode).toBe(0);
    expect(text(channel.stdout).trim()).toBe("agent-assist");

    const channelJson = runProjects(["channel", "agent-assist", "--json"], env);
    expect(channelJson.exitCode).toBe(0);
    const channelPayload = JSON.parse(text(channelJson.stdout)) as { channel: string; channel_class: string; linked: boolean };
    expect(channelPayload.channel).toBe("agent-assist");
    expect(channelPayload.channel_class).toBe("work-project");
    expect(channelPayload.linked).toBe(false);

    const handoff = runProjects(["handoff", "agent-assist", "--json"], env);
    expect(handoff.exitCode).toBe(0);
    expect((JSON.parse(text(handoff.stdout)) as { kind: string }).kind).toBe("projects.handoff");

    const runs = runProjects(["runs", "list", "agent-assist", "--json"], env);
    expect(runs.exitCode).toBe(0);
    expect((JSON.parse(text(runs.stdout)) as { kind: string; runs: unknown[] }).kind).toBe("projects.runs");

    const showDefault = runProjects(["runs", "show", run.id, "agent-assist"], env);
    expect(showDefault.exitCode).toBe(0);
    const showText = text(showDefault.stdout);
    expect(showText).toContain(`# Run ${run.id} [completed]`);
    expect(showText).toContain("tool calls (1):");
  });

  test("top-level create, list, and show use project-first JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-surface-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const targetPath = join(root, "surface-app");

    const create = runProjects([
      "create",
      "--name",
      "Surface App",
      "--path",
      targetPath,
      "--json",
    ], env);
    expect(create.exitCode).toBe(0);
    const created = JSON.parse(text(create.stdout)) as {
      project?: { slug: string; primary_path: string };
      workspace?: unknown;
    };
    expect(created.project?.slug).toBe("surface-app");
    expect(created.project?.primary_path).toBe(targetPath);
    expect(created.workspace).toBeUndefined();

    const list = runProjects(["list", "--json"], env);
    expect(list.exitCode).toBe(0);
    const rows = JSON.parse(text(list.stdout)) as Array<{ slug: string }>;
    expect(rows.some((row) => row.slug === "surface-app")).toBe(true);

    const show = runProjects(["show", "surface-app", "--json"], env);
    expect(show.exitCode).toBe(0);
    const shown = JSON.parse(text(show.stdout)) as {
      project?: { slug: string; primary_path: string };
      workspace?: unknown;
    };
    expect(shown.project?.slug).toBe("surface-app");
    expect(shown.project?.primary_path).toBe(targetPath);
    expect(shown.workspace).toBeUndefined();
    expect((shown as { schema_version?: number; kind?: string; render?: unknown }).schema_version).toBeUndefined();
    expect((shown as { schema_version?: number; kind?: string; render?: unknown }).kind).toBeUndefined();
    expect((shown as { schema_version?: number; kind?: string; render?: unknown }).render).toBeUndefined();

    const get = runProjects(["get", "surface-app", "--json"], env);
    expect(get.exitCode).toBe(0);
    expect((JSON.parse(text(get.stdout)) as { project?: { slug: string } }).project?.slug).toBe("surface-app");
  });

  test("guarded-read returns a bounded exact-id revision envelope and rejects non-id targets", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-guarded-read-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const targetPath = join(root, "guarded-read-app");

    try {
      const create = runProjects([
        "create",
        "--name",
        "Guarded Read App",
        "--slug",
        "guarded-read-app",
        "--path",
        targetPath,
        "--json",
      ], env);
      expect(create.exitCode).toBe(0);
      const created = JSON.parse(text(create.stdout)) as {
        project: { id: string; updated_at: string };
      };

      const exact = runProjects([
        "guarded-read",
        created.project.id,
        "--response-byte-limit",
        "16384",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(exact.exitCode).toBe(0);
      const payload = JSON.parse(text(exact.stdout)) as {
        ok: boolean;
        project_id: string;
        current_revision: string;
        response_control: {
          response_byte_limit: number;
          time_budget_ms: number;
          response_bytes: number;
          complete: boolean;
          truncated: boolean;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.project_id).toBe(created.project.id);
      expect(payload.current_revision).toBe(created.project.updated_at);
      expect(payload.response_control.response_byte_limit).toBe(16384);
      expect(payload.response_control.time_budget_ms).toBe(5000);
      expect(payload.response_control.response_bytes).toBeGreaterThan(0);
      expect(Buffer.byteLength(text(exact.stdout), "utf8")).toBe(payload.response_control.response_bytes);
      expect(payload.response_control.complete).toBe(true);
      expect(payload.response_control.truncated).toBe(false);

      for (const refusedTarget of ["guarded-read-app", created.project.id.slice(0, -1)]) {
        const refused = runProjects([
          "guarded-read",
          refusedTarget,
          "--response-byte-limit",
          "16384",
          "--time-budget-ms",
          "5000",
          "--json",
        ], env);
        expect(refused.exitCode).toBe(1);
        expect(text(refused.stderr)).toContain("complete stable project id");
      }

      const byteLimited = runProjects([
        "guarded-read",
        created.project.id,
        "--response-byte-limit",
        "1",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(byteLimited.exitCode).toBe(1);
      expect(text(byteLimited.stderr)).toContain("response byte budget exceeded");
      expect(runProjects(["show", created.project.id, "--json"], env).exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("typed resource links add, retry, reconcile, read back, and roll back through the CLI", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-resource-links-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const channelLink = {
      authority: "conversations",
      service_instance: "urn:hasna:conversations:test",
      source_package: "@hasna/conversations",
      target_kind: "channel",
      locator: {
        kind: "conversations_channel_id",
        value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      },
      scope: "resource",
      labels: { channel_name: "typed-links" },
    };
    const todosCollectionLink = {
      authority: "todos",
      service_instance: "urn:hasna:todos:test",
      source_package: "@hasna/todos",
      target_kind: "task_list",
      locator: {
        kind: "canonical_uri",
        value: "urn:hasna:todos:task-list:typed-links",
      },
      scope: "collection",
      labels: { name: "Typed Links Tasks", tags: ["project"] },
    };
    const contactLink = {
      authority: "contacts",
      service_instance: "urn:hasna:contacts:test",
      source_package: "@hasna/contacts",
      target_kind: "contact",
      locator: {
        kind: "external_uuid",
        value: "6b68e131-abe5-43b7-92cd-9930b04611df",
      },
      scope: "resource",
      labels: { name: "Bianca" },
    };
    const todosTaskLink = {
      authority: "todos",
      service_instance: "urn:hasna:todos:test",
      source_package: "@hasna/todos",
      target_kind: "task",
      locator: {
        kind: "external_uuid",
        value: "e2f791bd-f26b-4fac-a762-2cba96202aa5",
      },
      scope: "resource",
      labels: { name: "Anchor Dubai fraud project" },
    };

    try {
      const create = runProjects([
        "create",
        "--name",
        "Typed Links",
        "--slug",
        "typed-links",
        "--json",
      ], env);
      expect(create.exitCode).toBe(0);
      const created = JSON.parse(text(create.stdout)) as {
        project: { id: string; updated_at: string };
      };

      for (const [suffix, invalidLink, message] of [
        [
          "partial-task-id",
          { ...todosTaskLink, locator: { kind: "external_uuid", value: "e2f791bd" } },
          "complete UUID",
        ],
        [
          "cross-authority-task",
          { ...todosTaskLink, authority: "knowledge", source_package: "@hasna/knowledge" },
          "target_kind",
        ],
      ] as const) {
        const rejected = runProjects([
          "resource-links-add",
          created.project.id,
          "--links-json",
          JSON.stringify([invalidLink]),
          "--expected-revision",
          created.project.updated_at,
          "--operation-id",
          `cli-resource-links-${suffix}`,
          "--step-id",
          "reject-invalid-task-link",
          "--response-byte-limit",
          "100000",
          "--time-budget-ms",
          "5000",
          "--json",
        ], env);
        expect(rejected.exitCode).toBe(1);
        expect(text(rejected.stderr)).toContain(message);
      }

      const addArgs = [
        "resource-links-add",
        created.project.id,
        "--links-json",
        JSON.stringify([channelLink, todosCollectionLink, contactLink, todosTaskLink]),
        "--expected-revision",
        created.project.updated_at,
        "--operation-id",
        "cli-resource-links-add",
        "--step-id",
        "add-links",
        "--response-byte-limit",
        "100000",
        "--time-budget-ms",
        "5000",
        "--json",
      ];
      const add = runProjects(addArgs, env);
      expect(add.exitCode).toBe(0);
      const added = JSON.parse(text(add.stdout)) as {
        outcome: string;
        after: {
          project: { updated_at: string; integrations: Record<string, string> };
          links: Array<{ target_kind: string; scope: string; labels: Record<string, unknown> }>;
        };
        receipt: { receipt_id: string };
      };
      expect(added.outcome).toBe("accepted");
      expect(added.after.links).toHaveLength(4);
      expect(added.after.links.some((link) => link.scope === "collection")).toBe(true);
      expect(added.after.links.some((link) => link.target_kind === "task")).toBe(true);
      expect(added.after.project.integrations).toEqual({
        conversations_channel: "typed-links",
        todos_task_list_id: "urn:hasna:todos:task-list:typed-links",
      });

      const duplicate = runProjects(addArgs, env);
      expect(duplicate.exitCode).toBe(0);
      expect((JSON.parse(text(duplicate.stdout)) as { outcome: string }).outcome).toBe("duplicate_of_accepted");

      const read = runProjects([
        "resource-links-read",
        created.project.id,
        "--max-items",
        "10",
        "--response-byte-limit",
        "100000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(read.exitCode).toBe(0);
      expect(JSON.parse(text(read.stdout)) as {
        link_count: number;
        complete: boolean;
        truncated: boolean;
      }).toMatchObject({ link_count: 4, complete: true, truncated: false });

      const reconciledChannel = {
        ...channelLink,
        labels: { channel_name: "typed-links-renamed" },
      };
      const reconcile = runProjects([
        "resource-links-reconcile",
        created.project.id,
        "--links-json",
        JSON.stringify([reconciledChannel]),
        "--expected-revision",
        added.after.project.updated_at,
        "--operation-id",
        "cli-resource-links-reconcile",
        "--step-id",
        "reconcile-links",
        "--response-byte-limit",
        "100000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(reconcile.exitCode).toBe(0);
      const reconciled = JSON.parse(text(reconcile.stdout)) as {
        outcome: string;
        after: {
          project: { updated_at: string; integrations: Record<string, string> };
          links: Array<{ labels: { channel_name?: string } }>;
        };
        receipt: { receipt_id: string };
      };
      expect(reconciled.outcome).toBe("accepted");
      expect(reconciled.after.links).toEqual([
        expect.objectContaining({ labels: { channel_name: "typed-links-renamed" } }),
      ]);
      expect(reconciled.after.project.integrations).toEqual({
        conversations_channel: "typed-links-renamed",
      });

      const rollback = runProjects([
        "resource-links-rollback",
        created.project.id,
        "--accepted-receipt-id",
        reconciled.receipt.receipt_id,
        "--expected-current-revision",
        reconciled.after.project.updated_at,
        "--operation-id",
        "cli-resource-links-rollback",
        "--step-id",
        "rollback-reconcile",
        "--response-byte-limit",
        "100000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(rollback.exitCode).toBe(0);
      const rolledBack = JSON.parse(text(rollback.stdout)) as {
        outcome: string;
        after: {
          project: { integrations: Record<string, string> };
          links: unknown[];
        };
      };
      expect(rolledBack.outcome).toBe("accepted");
      expect(rolledBack.after.links).toHaveLength(4);
      expect(rolledBack.after.project.integrations).toEqual({
        conversations_channel: "typed-links",
        todos_task_list_id: "urn:hasna:todos:task-list:typed-links",
      });

      const guarded = runProjects([
        "guarded-read",
        created.project.id,
        "--resource-link-max-items",
        "10",
        "--response-byte-limit",
        "100000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(guarded.exitCode).toBe(0);
      expect(JSON.parse(text(guarded.stdout)) as {
        resource_link_count: number;
        resource_links: unknown[];
      }).toMatchObject({ resource_link_count: 4 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("contacts commands run attach, exact retry, list, detach, and reattach through the HTTP authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-contacts-authority-"));
    const contactId = "6b68e131-abe5-43b7-92cd-9930b04611df";
    let linked = false;
    let membershipVersion = 1;
    const receipts = new Map<string, Record<string, unknown>>();
    const requests: Array<{
      method: string;
      path: string;
      authorization: string | null;
      body: Record<string, unknown> | null;
    }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = req.method === "POST"
          ? await req.json() as Record<string, unknown>
          : null;
        requests.push({
          method: req.method,
          path: url.pathname,
          authorization: req.headers.get("authorization"),
          body,
        });
        const match = url.pathname.match(
          /^\/v1\/projects\/([^/]+)\/contact-memberships(?:\/([^/]+)(?:\/(attach|detach))?)?$/,
        );
        if (!match) return Response.json({ error: "Not found" }, { status: 404 });
        const projectId = decodeURIComponent(match[1]!);
        const requestedContactId = match[2] ? decodeURIComponent(match[2]) : undefined;
        const direction = match[3] as "attach" | "detach" | undefined;
        const snapshot = () => ({
          project_id: projectId,
          contact_id: contactId,
          linked,
          version: `membership-v${membershipVersion}`,
        });

        if (req.method === "GET" && requestedContactId) return Response.json(snapshot());
        if (req.method === "GET") {
          return Response.json({
            project_id: projectId,
            contact_ids: linked ? [contactId] : [],
            complete: true,
            membership_revision: `membership-v${membershipVersion}`,
          });
        }
        if (!body || !direction || requestedContactId !== contactId) {
          return Response.json({ error: "Invalid membership mutation" }, { status: 400 });
        }
        const receiptKey = `${direction}:${String(body.operation_id)}:${String(body.step_id)}`;
        const existing = receipts.get(receiptKey);
        if (existing) return Response.json({ ...existing, outcome: "duplicate_of_accepted" });
        if (body.expected_version !== `membership-v${membershipVersion}`) {
          return Response.json({ error: "expected_version conflict" }, { status: 409 });
        }
        const before = snapshot();
        linked = direction === "attach";
        membershipVersion += 1;
        const result = {
          outcome: "accepted",
          operation_id: body.operation_id,
          step_id: body.step_id,
          before,
          after: snapshot(),
          receipt_id: `cmr_${receipts.size + 1}`,
        };
        receipts.set(receiptKey, result);
        return Response.json(result);
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_CONTACTS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_CONTACTS_API_KEY: "test-contact-key",
      HASNA_CONTACTS_SERVICE_INSTANCE: "urn:hasna:contacts:test",
    };

    try {
      const create = runProjects([
        "create",
        "--name",
        "Contacts Authority",
        "--slug",
        "contacts-authority",
        "--json",
      ], env);
      expect(create.exitCode).toBe(0);
      const projectId = (JSON.parse(text(create.stdout)) as { project: { id: string } }).project.id;
      const attachArgs = [
        "contacts",
        "attach",
        projectId,
        contactId,
        "--operation-id",
        "cli-contacts-attach",
        "--json",
      ];

      const attach = await runProjectsAsync(attachArgs, env);
      expect(attach.exitCode).toBe(0);
      expect(JSON.parse(text(attach.stdout))).toMatchObject({
        outcome: "accepted",
        contact_id: contactId,
        membership: { linked: true },
        project_link: { locator: { value: contactId } },
      });

      const retry = await runProjectsAsync(attachArgs, env);
      expect(retry.exitCode).toBe(0);
      expect(JSON.parse(text(retry.stdout))).toMatchObject({
        outcome: "duplicate_of_accepted",
        contact_id: contactId,
        membership: { linked: true },
        evidence: [],
      });

      const list = await runProjectsAsync(["contacts", "list", projectId, "--json"], env);
      expect(list.exitCode).toBe(0);
      expect(JSON.parse(text(list.stdout))).toMatchObject({
        contact_ids: [contactId],
        synchronized_contact_ids: [contactId],
        missing_project_link_contact_ids: [],
        stale_project_link_contact_ids: [],
      });

      const detach = await runProjectsAsync([
        "contacts",
        "detach",
        projectId,
        contactId,
        "--operation-id",
        "cli-contacts-detach",
        "--json",
      ], env);
      expect(detach.exitCode).toBe(0);
      expect(JSON.parse(text(detach.stdout))).toMatchObject({
        outcome: "accepted",
        membership: { linked: false },
        project_link: null,
      });

      const empty = await runProjectsAsync(["contacts", "list", projectId, "--json"], env);
      expect(empty.exitCode).toBe(0);
      expect(JSON.parse(text(empty.stdout))).toMatchObject({
        contact_ids: [],
        synchronized_contact_ids: [],
        project_links: [],
      });

      const reattach = await runProjectsAsync([
        "contacts",
        "attach",
        projectId,
        contactId,
        "--operation-id",
        "cli-contacts-reattach",
        "--json",
      ], env);
      expect(reattach.exitCode).toBe(0);
      expect(JSON.parse(text(reattach.stdout))).toMatchObject({
        outcome: "accepted",
        membership: { linked: true },
      });

      expect(requests.filter((request) => request.method === "POST").map((request) => request.path))
        .toEqual([
          `/v1/projects/${projectId}/contact-memberships/${contactId}/attach`,
          `/v1/projects/${projectId}/contact-memberships/${contactId}/detach`,
          `/v1/projects/${projectId}/contact-memberships/${contactId}/attach`,
        ]);
      expect(requests.every((request) => request.authorization === "Bearer test-contact-key")).toBe(true);
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  test("guarded-update rejects independent writes to typed resource-link compatibility scalars", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-guarded-integrations-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    try {
      const create = runProjects([
        "create",
        "--name",
        "Guarded Integrations",
        "--slug",
        "guarded-integrations",
        "--integrations-json",
        JSON.stringify({ todos_project_id: "todo_before" }),
        "--json",
      ], env);
      expect(create.exitCode).toBe(0);
      const created = JSON.parse(text(create.stdout)) as { project: { id: string; updated_at: string; integrations: Record<string, string> } };
      const update = runProjects([
        "guarded-update",
        created.project.id,
        "--expected-revision",
        created.project.updated_at,
        "--operation-id",
        "guarded-integrations-operation",
        "--step-id",
        "integrations",
        "--integrations-json",
        JSON.stringify({
          todos_project_id: "todo_after",
          conversations_channel: "package-arrivals",
        }),
        "--response-byte-limit",
        "20000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(update.exitCode).toBe(1);
      expect(text(update.stderr)).toContain("must be changed through resource-links");
      const shown = runProjects(["show", created.project.id, "--json"], env);
      expect(shown.exitCode).toBe(0);
      expect((JSON.parse(text(shown.stdout)) as { project: { integrations: Record<string, string> } })
        .project.integrations).toEqual({
          conversations_channel: "guarded-integrations",
          todos_project_id: "todo_before",
        });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const { pathFlag, label } of [
    { pathFlag: "--path", label: "path" },
    { pathFlag: "--primary-path", label: "primary-path" },
  ] as const) {
    test(`guarded-update accepts ${pathFlag} with kind and git remote`, () => {
      const root = mkdtempSync(join(tmpdir(), `projects-cli-guarded-${label}-`));
      const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
      const originalPath = join(root, "before");
      const forwardPath = join(root, "after");
      const forwardRemote = `https://example.invalid/hasna/guarded-${label}.git`;
      try {
        const create = runProjects([
          "create",
          "--name",
          `Guarded ${label}`,
          "--path",
          originalPath,
          "--json",
        ], env);
        expect(create.exitCode).toBe(0);
        const created = JSON.parse(text(create.stdout)) as {
          project: { id: string; updated_at: string };
        };

        const update = runProjects([
          "guarded-update",
          created.project.id,
          "--expected-revision",
          created.project.updated_at,
          "--operation-id",
          `guarded-${label}-operation`,
          "--step-id",
          "identity",
          "--kind",
          "open-source",
          pathFlag,
          forwardPath,
          "--git-remote",
          forwardRemote,
          "--response-byte-limit",
          "40000",
          "--time-budget-ms",
          "5000",
          "--json",
        ], env);
        expect(update.exitCode).toBe(0);
        const payload = JSON.parse(text(update.stdout)) as {
          outcome: string;
          after: { kind: string; primary_path: string; git_remote: string; updated_at: string };
          receipt: { post_revision: string };
        };
        expect(payload.outcome).toBe("accepted");
        expect(payload.after).toMatchObject({
          kind: "open-source",
          primary_path: forwardPath,
          git_remote: forwardRemote,
        });
        expect(payload.receipt.post_revision).toBe(payload.after.updated_at);

        const read = runProjects([
          "guarded-read",
          created.project.id,
          "--response-byte-limit",
          "40000",
          "--time-budget-ms",
          "5000",
          "--json",
        ], env);
        expect(read.exitCode).toBe(0);
        expect((JSON.parse(text(read.stdout)) as { project: Record<string, unknown> }).project).toMatchObject({
          kind: "open-source",
          primary_path: forwardPath,
          git_remote: forwardRemote,
          updated_at: payload.after.updated_at,
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  for (const { firstFlag, secondFlag } of [
    { firstFlag: "--path", secondFlag: "--primary-path" },
    { firstFlag: "--primary-path", secondFlag: "--path" },
  ] as const) {
    test(`guarded-update rejects conflicting ${firstFlag} and ${secondFlag} aliases`, () => {
      const root = mkdtempSync(join(tmpdir(), "projects-cli-guarded-path-conflict-"));
      const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
      try {
        const create = runProjects(["create", "--name", "Guarded Conflict", "--json"], env);
        expect(create.exitCode).toBe(0);
        const created = JSON.parse(text(create.stdout)) as {
          project: { id: string; updated_at: string };
        };
        const conflict = runProjects([
          "guarded-update",
          created.project.id,
          "--expected-revision",
          created.project.updated_at,
          "--operation-id",
          `guarded-conflict-${firstFlag}`,
          "--step-id",
          "identity",
          firstFlag,
          join(root, "one"),
          secondFlag,
          join(root, "two"),
          "--response-byte-limit",
          "40000",
          "--time-budget-ms",
          "5000",
          "--json",
        ], env);
        expect(conflict.exitCode).toBe(1);
        expect(text(conflict.stderr)).toContain("--path and --primary-path must resolve to the same path when both are provided");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test("guarded rollback restores a remote-only project and leaves its forward path non-primary", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-guarded-remote-only-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const forwardPath = join(root, "forward");
    try {
      const create = runProjects([
        "create",
        "--name",
        "Guarded Remote Only",
        "--kind",
        "remote-only",
        "--git-remote",
        "https://example.invalid/hasna/guarded-remote-only.git",
        "--json",
      ], env);
      expect(create.exitCode).toBe(0);
      const created = JSON.parse(text(create.stdout)) as {
        project: { id: string; primary_path: string | null; updated_at: string };
      };
      expect(created.project.primary_path).toBeNull();

      const beforeLocations = runProjects(["locations", "list", created.project.id, "--json"], env);
      expect(beforeLocations.exitCode).toBe(0);
      expect((JSON.parse(text(beforeLocations.stdout)) as { locations: unknown[] }).locations).toEqual([]);

      const update = runProjects([
        "guarded-update",
        created.project.id,
        "--expected-revision",
        created.project.updated_at,
        "--operation-id",
        "guarded-remote-only-forward",
        "--step-id",
        "set-primary-path",
        "--path",
        forwardPath,
        "--response-byte-limit",
        "40000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(update.exitCode).toBe(0);
      const accepted = JSON.parse(text(update.stdout)) as {
        outcome: string;
        after: { primary_path: string; updated_at: string };
        receipt: { receipt_id: string; post_revision: string };
      };
      expect(accepted.outcome).toBe("accepted");
      expect(accepted.after.primary_path).toBe(forwardPath);
      expect(accepted.receipt.post_revision).toBe(accepted.after.updated_at);

      const forwardLocations = runProjects(["locations", "list", created.project.id, "--json"], env);
      expect(forwardLocations.exitCode).toBe(0);
      expect((JSON.parse(text(forwardLocations.stdout)) as {
        locations: Array<{ path: string; is_primary: boolean }>;
      }).locations).toEqual([expect.objectContaining({ path: forwardPath, is_primary: true })]);

      const rollback = runProjects([
        "guarded-rollback",
        created.project.id,
        "--accepted-receipt-id",
        accepted.receipt.receipt_id,
        "--expected-current-revision",
        accepted.receipt.post_revision,
        "--operation-id",
        "guarded-remote-only-rollback",
        "--step-id",
        "clear-primary-path",
        "--response-byte-limit",
        "40000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(rollback.exitCode).toBe(0);
      const rolledBack = JSON.parse(text(rollback.stdout)) as {
        outcome: string;
        after: { primary_path: string | null; updated_at: string };
        receipt: { post_revision: string };
      };
      expect(rolledBack.outcome).toBe("accepted");
      expect(rolledBack.after.primary_path).toBeNull();
      expect(rolledBack.receipt.post_revision).toBe(rolledBack.after.updated_at);

      const read = runProjects([
        "guarded-read",
        created.project.id,
        "--response-byte-limit",
        "40000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(read.exitCode).toBe(0);
      const readBack = JSON.parse(text(read.stdout)) as {
        current_revision: string;
        project: { primary_path: string | null; updated_at: string };
      };
      expect(readBack.project.primary_path).toBeNull();
      expect(readBack.current_revision).toBe(rolledBack.receipt.post_revision);
      expect(readBack.project.updated_at).toBe(rolledBack.receipt.post_revision);

      const rollbackLocations = runProjects(["locations", "list", created.project.id, "--json"], env);
      expect(rollbackLocations.exitCode).toBe(0);
      expect((JSON.parse(text(rollbackLocations.stdout)) as {
        locations: Array<{ path: string; is_primary: boolean }>;
      }).locations).toEqual([expect.objectContaining({ path: forwardPath, is_primary: false })]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("workspace store, app store, loops, and labels use temp home", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-store-"));
    const env = {
      HASNA_PROJECTS_HOME: join(root, "home"),
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
    };

    const create = runProjects([
      "create",
      "--name",
      "Store Work",
      "--kind",
      "project",
      "--mkdir",
      "--marker",
      "--json",
    ], env);
    expect(create.exitCode).toBe(0);
    const created = JSON.parse(text(create.stdout)) as { project: { id: string; slug: string; primary_path: string } };
    expect(created.project.primary_path).toBe(join(env.HASNA_PROJECTS_HOME, "workspaces", created.project.id));

    const inspect = runProjects(["store", "inspect", "store-work", "--json"], env);
    expect(inspect.exitCode).toBe(0);
    const inspected = JSON.parse(text(inspect.stdout)) as {
      primary_is_canonical: boolean;
      paths: { data_path: string };
      app_store: { paths: { db_path: string }; counts: { data_models: number; data_records: number; loop_links: number } };
    };
    expect(inspected.primary_is_canonical).toBe(true);
    expect(inspected.paths.data_path).toBe(join(env.HASNA_PROJECTS_HOME, "data", created.project.id));
    expect(inspected.app_store.paths.db_path).toBe(join(env.HASNA_PROJECTS_HOME, "data", created.project.id, "project.db"));
    expect(inspected.app_store.counts).toMatchObject({ data_models: 0, data_records: 0, loop_links: 0 });

    const migratePlan = runProjects(["store", "migrate", "store-work", "--json"], env);
    expect(migratePlan.exitCode).toBe(0);
    const planned = JSON.parse(text(migratePlan.stdout)) as { dry_run: boolean; no_op: boolean; target_path: string };
    expect(planned.dry_run).toBe(true);
    expect(planned.no_op).toBe(true);
    expect(planned.target_path).toBe(created.project.primary_path);

    const link = runProjects(["loops", "link", "store-work", "loop_123", "--name", "Daily Check", "--json"], env);
    expect(link.exitCode).toBe(0);
    expect((JSON.parse(text(link.stdout)) as { link: { loop_id: string } }).link.loop_id).toBe("loop_123");

    const loops = runProjects(["loops", "list", "store-work", "--json"], env);
    expect(loops.exitCode).toBe(0);
    // The linked loop_123 does not exist in any real loops store. Depending on
    // whether the @hasna/loops SDK is resolvable in this environment, the status
    // is "unavailable" (SDK absent) or "missing" (SDK present, loop not found) —
    // both mean the linked loop is not resolvable here.
    expect(["unavailable", "missing"]).toContain(
      (JSON.parse(text(loops.stdout)) as { loops: Array<{ status: string }> }).loops[0]?.status,
    );

    const labelsAdd = runProjects(["labels", "add", "store-work", "org:hasnaxyz", "kind:work-project", "client:foo", "--json"], env);
    expect(labelsAdd.exitCode).toBe(0);
    const labelsPayload = JSON.parse(text(labelsAdd.stdout)) as { labels: string[] };
    expect(labelsPayload.labels).toContain("kind:work-project");

    const filtered = runProjects(["list", "--label", "kind:work-project", "--json"], env);
    expect(filtered.exitCode).toBe(0);
    expect((JSON.parse(text(filtered.stdout)) as Array<{ slug: string }>).map((project) => project.slug)).toEqual(["store-work"]);

    const started = runProjects(["start", "--label", "kind:work-project", "--dry-run", "--json"], env);
    expect(started.exitCode).toBe(0);
    const startPayload = JSON.parse(text(started.stdout)) as { project: { slug: string; primary_path: string }; tmux: { windows: Array<{ metadata?: { path?: string } }> } };
    expect(startPayload.project.slug).toBe("store-work");
    expect(startPayload.project.primary_path).toBe(created.project.primary_path);
    expect(startPayload.tmux.windows[0]?.metadata?.path).toBe(created.project.primary_path);

    rmSync(root, { recursive: true, force: true });
  }, 60000);

  test("top-level list hides eval fixtures by default and cleanup-evals removes them", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-eval-cleanup-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    expect(runProjects(["create", "--name", "Normal Project", "--slug", "normal-project", "--path", join(root, "normal"), "--json"], env).exitCode).toBe(0);
    expect(runProjects(["create", "--name", "Eval Hidden", "--slug", "eval-hidden", "--path", join(root, "eval-hidden"), "--json"], env).exitCode).toBe(0);

    const visible = runProjects(["list", "--json"], env);
    expect(visible.exitCode).toBe(0);
    expect((JSON.parse(text(visible.stdout)) as Array<{ slug: string }>).map((item) => item.slug)).toEqual(["normal-project"]);

    const all = runProjects(["list", "--include-evals", "--json"], env);
    expect(all.exitCode).toBe(0);
    expect((JSON.parse(text(all.stdout)) as Array<{ slug: string }>).map((item) => item.slug).sort()).toEqual(["eval-hidden", "normal-project"]);

    const preview = runProjects(["cleanup-evals", "--dry-run", "--json"], env);
    expect(preview.exitCode).toBe(0);
    expect((JSON.parse(text(preview.stdout)) as { dry_run: boolean; projects: Array<{ slug: string }> }).projects.map((item) => item.slug)).toEqual(["eval-hidden"]);

    const cleanup = runProjects(["cleanup-evals", "--apply", "--json"], env);
    expect(cleanup.exitCode).toBe(0);
    expect((JSON.parse(text(cleanup.stdout)) as { deleted: { projects: number } }).deleted.projects).toBe(1);

    const after = runProjects(["list", "--include-evals", "--json"], env);
    expect((JSON.parse(text(after.stdout)) as Array<{ slug: string }>).map((item) => item.slug)).toEqual(["normal-project"]);
  });

  test("top-level list is compact by default and JSON remains detailed", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-compact-list-"));
    const dbPath = join(root, "projects.db");
    const env = { HASNA_PROJECTS_DB_PATH: dbPath };
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);

    for (let i = 0; i < 30; i += 1) {
      const suffix = String(i).padStart(2, "0");
      createWorkspace({
        name: `Compact ${suffix}`,
        slug: `compact-${suffix}`,
        kind: "project",
        primary_path: join(root, `compact-${suffix}`),
        metadata: { notes: "x".repeat(500) },
      }, db);
    }
    db.close();

    const compact = runProjects(["list"], env);
    expect(compact.exitCode).toBe(0);
    const compactText = text(compact.stdout);
    expect(compactText).toContain("compact-00");
    expect(compactText).toContain("Showing 25 of more than 25 matching projects");
    expect(compactText).toContain("Use --limit <n>, --verbose, --json, or 'projects show <slug>' for details.");
    expect(compactText).not.toContain("compact-29");
    expect(compactText).not.toContain("x".repeat(120));

    const expanded = runProjects(["list", "--limit", "30"], env);
    expect(expanded.exitCode).toBe(0);
    expect(text(expanded.stdout)).toContain("compact-29");

    const json = runProjects(["list", "--json"], env);
    expect(json.exitCode).toBe(0);
    const rows = JSON.parse(text(json.stdout)) as Array<{ slug: string; metadata: Record<string, string> }>;
    expect(rows).toHaveLength(30);
    expect(rows.find((row) => row.slug === "compact-29")?.metadata.notes).toHaveLength(500);
  }, 60000);

  test("top-level list JSON output is not truncated above 64 KiB", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-large-list-json-"));
    const dbPath = join(root, "projects.db");
    const env = { HASNA_PROJECTS_DB_PATH: dbPath };
    const db = new Database(dbPath);
    let dbClosed = false;
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);

    try {
      db.transaction(() => {
        for (let i = 0; i < 120; i += 1) {
          const suffix = String(i).padStart(3, "0");
          createWorkspace({
            name: `Large List ${suffix}`,
            slug: `large-list-${suffix}`,
            kind: "project",
            primary_path: join(root, `large-list-${suffix}`),
            metadata: { notes: `large-json-output-${suffix}-${"x".repeat(1_000)}` },
          }, db);
        }
      })();
      db.close();
      dbClosed = true;

      const result = await runWorkspaceCommandInProcess(["list", "--limit", "120", "--json"], env);
      const stdout = text(result.stdout);
      expect(result.exitCode).toBe(0);
      expect(Buffer.byteLength(stdout)).toBeGreaterThan(65_536);
      const rows = JSON.parse(stdout) as Array<{ slug: string; metadata: Record<string, string> }>;
      expect(rows).toHaveLength(120);
      expect(rows.find((row) => row.slug === "large-list-119")?.metadata.notes).toContain("large-json-output-119");
    } finally {
      if (!dbClosed) db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);

  test("top-level create, list, show, and update expose project management fields", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-management-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const targetPath = join(root, "managed-app");
    const briefPath = join(root, "brief.md");
    writeFileSync(briefPath, "# Managed App Brief\n");

    const create = runProjects([
      "create",
      "--name",
      "Managed App",
      "--path",
      targetPath,
      "--stage",
      "active",
      "--priority",
      "high",
      "--owner",
      "hasna",
      "--launch-profile",
      "dev",
      "--start-agent",
      "claude",
      "--start-command",
      "claude --resume",
      "--start-session-policy",
      "error-if-running",
      "--start-windows-json",
      "[{\"name\":\"notes\",\"command\":\"vim NOTES.md\"}]",
      "--todos-project-id",
      "todo_123",
      "--todos-task-list-id",
      "list_456",
      "--brief-id",
      "brief_123",
      "--brief-path",
      briefPath,
      "--json",
    ], env);
    expect(create.exitCode).toBe(0);
    const created = JSON.parse(text(create.stdout)) as {
      project?: {
        metadata: Record<string, unknown>;
        integrations: Record<string, string>;
      };
    };
    expect(created.project?.metadata.stage).toBe("active");
    expect(created.project?.metadata.priority).toBe("high");
    expect(created.project?.metadata.owner).toBe("hasna");
    expect(created.project?.metadata.launch_profile).toBe("dev");
    expect(created.project?.metadata.start_agent).toBe("claude");
    expect(created.project?.metadata.start_command).toBe("claude --resume");
    expect(created.project?.metadata.start_session_policy).toBe("error-if-running");
    expect(created.project?.metadata.start_windows).toEqual([{ name: "notes", command: "vim NOTES.md" }]);
    expect(created.project?.integrations.todos_project_id).toBe("todo_123");
    expect(created.project?.integrations.todos_task_list_id).toBe("list_456");
    expect(created.project?.integrations.brief_id).toBe("brief_123");
    expect(created.project?.integrations.brief_path).toBe(briefPath);

    const list = runProjects(["list", "--verbose"], env);
    expect(list.exitCode).toBe(0);
    const listText = text(list.stdout);
    expect(listText).toContain("managed-app");
    expect(listText).toContain("active");
    expect(listText).toContain("high");
    expect(listText).toContain("hasna");
    expect(listText).toContain("missing");
    expect(listText).toContain("todo_123");
    expect(listText).toContain("brief_123");

    const show = runProjects(["show", "managed-app", "--json"], env);
    expect(show.exitCode).toBe(0);
    const shown = JSON.parse(text(show.stdout)) as {
      management?: {
        stage: string | null;
        priority: string | null;
        owner: string | null;
        launch_profile: string | null;
        start_agent: string | null;
        start_command: string | null;
        start_session_policy: string | null;
        start_windows: Array<{ name: string; command?: string }>;
        todos_project_id: string | null;
        todos_task_list_id: string | null;
        brief_id: string | null;
        brief_path: string | null;
      };
      external_links?: {
        todos: { linked: boolean; status: string; project_id: string | null; task_list_id: string | null };
        brief: { linked: boolean; status: string; id: string | null; path: string | null; path_exists: boolean | null };
      };
      dashboard?: { path_health?: { status: string; path: string | null; exists: boolean | null }; launch?: { default_session_policy: string | null } };
      project?: { management?: { priority: string | null }; external_links?: unknown };
    };
    expect(shown.management?.stage).toBe("active");
    expect(shown.management?.priority).toBe("high");
    expect(shown.management?.owner).toBe("hasna");
    expect(shown.management?.launch_profile).toBe("dev");
    expect(shown.management?.start_agent).toBe("claude");
    expect(shown.management?.start_command).toBe("claude --resume");
    expect(shown.management?.start_session_policy).toBe("error-if-running");
    expect(shown.management?.start_windows).toEqual([{ name: "notes", command: "vim NOTES.md" }]);
    expect(shown.management?.todos_project_id).toBe("todo_123");
    expect(shown.management?.todos_task_list_id).toBe("list_456");
    expect(shown.management?.brief_id).toBe("brief_123");
    expect(shown.management?.brief_path).toBe(briefPath);
    expect(shown.external_links?.todos).toEqual({ linked: true, status: "linked", project_id: "todo_123", task_list_id: "list_456" });
    expect(shown.external_links?.brief).toEqual({ linked: true, status: "linked", id: "brief_123", path: briefPath, path_exists: true });
    expect(shown.dashboard?.path_health).toEqual({ status: "missing", path: targetPath, exists: false });
    expect(shown.dashboard?.launch?.default_session_policy).toBe("error-if-running");
    expect(shown.project?.management?.priority).toBe("high");
    expect(shown.project?.external_links).toEqual(shown.external_links);

    const humanShow = runProjects(["show", "managed-app"], env);
    expect(humanShow.exitCode).toBe(0);
    const humanShowText = text(humanShow.stdout);
    expect(humanShowText).toContain("path health: missing");
    expect(humanShowText).toContain("recent events:");

    const update = runProjects([
      "update",
      "managed-app",
      "--priority",
      "critical",
      "--clear-owner",
      "--clear-start-command",
      "--clear-start-session-policy",
      "--clear-start-windows",
      "--brief-path",
      briefPath,
      "--json",
    ], env);
    expect(update.exitCode).toBe(0);
    const updated = JSON.parse(text(update.stdout)) as {
      metadata: Record<string, unknown>;
      integrations: Record<string, string>;
    };
    expect(updated.metadata.priority).toBe("critical");
    expect(updated.metadata.owner).toBeUndefined();
    expect(updated.metadata.start_command).toBeUndefined();
    expect(updated.metadata.start_session_policy).toBeUndefined();
    expect(updated.metadata.start_windows).toBeUndefined();
    expect(updated.integrations.brief_path).toBe(briefPath);

    const tagged = runProjects(["tag", "managed-app", "security,cameras", "family", "--json"], env);
    expect(tagged.exitCode).toBe(0);
    expect((JSON.parse(text(tagged.stdout)) as { tags: string[] }).tags).toEqual(["security", "cameras", "family"]);

    const untagged = runProjects(["untag", "managed-app", "cameras", "--json"], env);
    expect(untagged.exitCode).toBe(0);
    expect((JSON.parse(text(untagged.stdout)) as { tags: string[] }).tags).toEqual(["security", "family"]);

    const linked = runProjects([
      "link",
      "managed-app",
      "--brief-id",
      "brief_456",
      "--json",
    ], env);
    expect(linked.exitCode).toBe(0);
    expect((JSON.parse(text(linked.stdout)) as { integrations: Record<string, string> }).integrations.brief_id).toBe("brief_456");

    const rejectedTodoLink = runProjects([
      "link",
      "managed-app",
      "--todos-task-list-id",
      "list_789",
      "--json",
    ], env);
    expect(rejectedTodoLink.exitCode).toBe(1);
    expect(text(rejectedTodoLink.stderr)).toContain("must be changed through resource-links");

    const unlinked = runProjects(["unlink", "managed-app", "--brief", "--json"], env);
    expect(unlinked.exitCode).toBe(0);
    const unlinkedPayload = JSON.parse(text(unlinked.stdout)) as {
      project: {
        integrations: Record<string, string | undefined>;
        external_links: {
          todos: { linked: boolean };
          brief: { linked: boolean };
        };
      };
      unlinked: string[];
    };
    expect(unlinkedPayload.unlinked).toEqual(["brief_id", "brief_path"]);
    expect(unlinkedPayload.project.integrations.todos_project_id).toBe("todo_123");
    expect(unlinkedPayload.project.integrations.todos_task_list_id).toBe("list_456");
    const rejectedTodoUnlink = runProjects(["unlink", "managed-app", "--todos", "--json"], env);
    expect(rejectedTodoUnlink.exitCode).toBe(1);
    expect(text(rejectedTodoUnlink.stderr)).toContain("must be changed through resource-links");
    expect(unlinkedPayload.project.integrations.brief_id).toBeUndefined();
    expect(unlinkedPayload.project.integrations.brief_path).toBeUndefined();
    expect(unlinkedPayload.project.external_links.todos.linked).toBe(true);
    expect(unlinkedPayload.project.external_links.brief.linked).toBe(false);
  });

  test("top-level events list and record expose project audit events", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-events-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const targetPath = join(root, "evented-app");

    expect(runProjects(["create", "--name", "Evented App", "--path", targetPath, "--json"], env).exitCode).toBe(0);

    const record = runProjects([
      "events",
      "record",
      "evented-app",
      "security_reviewed",
      "--metadata-json",
      "{\"area\":\"home-security\"}",
      "--json",
    ], env);
    expect(record.exitCode).toBe(0);
    const recorded = JSON.parse(text(record.stdout)) as {
      project?: { slug: string };
      event?: { event_type: string; metadata: Record<string, string> };
      workspace?: unknown;
    };
    expect(recorded.project?.slug).toBe("evented-app");
    expect(recorded.event?.event_type).toBe("security_reviewed");
    expect(recorded.event?.metadata.area).toBe("home-security");
    expect(recorded.workspace).toBeUndefined();

    const list = runProjects(["events", "list", "evented-app", "--json"], env);
    expect(list.exitCode).toBe(0);
    const listed = JSON.parse(text(list.stdout)) as {
      project?: { slug: string };
      events: Array<{ event_type: string }>;
      workspace?: unknown;
    };
    expect(listed.project?.slug).toBe("evented-app");
    expect(listed.events.map((event) => event.event_type)).toContain("security_reviewed");
    expect(listed.workspace).toBeUndefined();

    const compact = runProjects(["events", "list", "evented-app", "--limit", "1"], env);
    expect(compact.exitCode).toBe(0);
    const compactText = text(compact.stdout);
    expect(compactText).toContain("security_reviewed");
    expect(compactText).toContain("Showing latest 1 of ");
    expect(compactText).toContain("older hidden. Use --limit <n>, --verbose, or --json for details.");
  });

  test("events record gates cleanly as local-only in api/cloud mode instead of leaking a raw 404", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-events-cloud-"));
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      // Force the cloud/self-hosted backend to resolve; the /v1 API exposes no
      // POST /projects/:id/events route, so recording must fail fast with a
      // clear local-only message rather than POSTing and leaking a raw 404.
      HASNA_PROJECTS_STORAGE_MODE: "self_hosted",
      HASNA_PROJECTS_API_URL: "https://projects.invalid.hasna.test",
      HASNA_PROJECTS_API_KEY: "test-key",
    };

    const record = runProjects([
      "events",
      "record",
      "some-project",
      "custom_event",
      "--prompt",
      "x",
      "--json",
    ], env);

    expect(record.exitCode).toBe(1);
    const stderr = text(record.stderr);
    expect(stderr).toContain("local-only operation and is not available in api/cloud mode");
    // Must not leak the raw upstream transport error or hit the network.
    expect(stderr).not.toContain("Hasna request failed");
    expect(stderr).not.toContain("404");
  });

  test("project agents can be assigned and shown as project metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-agents-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    expect(runProjects([
      "create",
      "--name",
      "Agent Managed",
      "--slug",
      "agent-managed",
      "--path",
      join(root, "agent-managed"),
      "--json",
    ], env).exitCode).toBe(0);
    expect(runProjects([
      "agents",
      "add",
      "--name",
      "Security Owner",
      "--slug",
      "security-owner",
      "--kind",
      "human",
      "--json",
    ], env).exitCode).toBe(0);

    const assigned = runProjects([
      "agents",
      "assign",
      "agent-managed",
      "security-owner",
      "--role",
      "owner",
      "--metadata-json",
      "{\"scope\":\"security\"}",
      "--json",
    ], env);
    expect(assigned.exitCode).toBe(0);
    const assignment = JSON.parse(text(assigned.stdout)) as { role: string; agent?: { slug: string }; metadata: Record<string, string> };
    expect(assignment.role).toBe("owner");
    expect(assignment.agent?.slug).toBe("security-owner");
    expect(assignment.metadata.scope).toBe("security");

    const projectAgents = runProjects(["agents", "list", "--project", "agent-managed", "--json"], env);
    expect(projectAgents.exitCode).toBe(0);
    const assignments = JSON.parse(text(projectAgents.stdout)) as Array<{ role: string; agent?: { slug: string } }>;
    expect(assignments.some((item) => item.role === "owner" && item.agent?.slug === "security-owner")).toBe(true);

    const show = runProjects(["show", "agent-managed", "--json"], env);
    expect(show.exitCode).toBe(0);
    const shown = JSON.parse(text(show.stdout)) as {
      agents: Array<{ role: string; agent?: { slug: string } }>;
      events: Array<{ event_type: string; agent_id: string | null }>;
    };
    expect(shown.agents.some((item) => item.role === "owner" && item.agent?.slug === "security-owner")).toBe(true);
    expect(shown.events.some((event) => event.event_type === "agent_assigned")).toBe(true);
  });

  test("update --canonical-machine replaces metadata ownership and round-trips through show", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-canonical-machine-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    const created = runProjects([
      "create",
      "--name",
      "Machine Owned",
      "--slug",
      "machine-owned",
      "--path",
      join(root, "machine-owned"),
      "--metadata-json",
      JSON.stringify({ canonical_machine: "spark01", retained: true }),
      "--json",
    ], env);
    expect(created.exitCode).toBe(0);

    const updated = runProjects([
      "update",
      "machine-owned",
      "--canonical-machine",
      "spark02",
      "--json",
    ], env);
    expect(updated.exitCode).toBe(0);
    const updatedProject = JSON.parse(text(updated.stdout)) as {
      canonical_machine: string | null;
      metadata: Record<string, unknown>;
    };
    expect(updatedProject.canonical_machine).toBe("spark02");
    expect(updatedProject.metadata).toEqual({ retained: true });

    const replaced = runProjects([
      "update",
      "machine-owned",
      "--canonical-machine",
      "apple01",
      "--json",
    ], env);
    expect(replaced.exitCode).toBe(0);
    expect((JSON.parse(text(replaced.stdout)) as { canonical_machine: string }).canonical_machine).toBe("apple01");

    const shown = runProjects(["show", "machine-owned", "--json"], env);
    expect(shown.exitCode).toBe(0);
    const payload = JSON.parse(text(shown.stdout)) as {
      project: { canonical_machine: string | null; metadata: Record<string, unknown> };
    };
    expect(payload.project.canonical_machine).toBe("apple01");
    expect(payload.project.metadata["canonical_machine"]).toBeUndefined();
  });

  test("project locations can be registered and used as start targets", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-locations-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db"), HOSTNAME: "spark01" };
    const primaryPath = join(root, "primary");
    const secondaryPath = join(root, "secondary");
    mkdirSync(secondaryPath);

    expect(runProjects([
      "create",
      "--name",
      "Located Project",
      "--slug",
      "located-project",
      "--path",
      primaryPath,
      "--mkdir",
      "--json",
    ], env).exitCode).toBe(0);
    expect(runProjects(["create", "--name", "Other Project", "--slug", "other-project", "--path", join(root, "other"), "--mkdir", "--json"], env).exitCode).toBe(0);

    const added = runProjects([
      "locations",
      "add",
      "located-project",
      secondaryPath,
      "--machine",
      "machine007",
      "--label",
      "docs",
      "--metadata-json",
      "{\"purpose\":\"docs\"}",
      "--json",
    ], env);
    expect(added.exitCode).toBe(0);
    const addPayload = JSON.parse(text(added.stdout)) as {
      project: { slug: string };
      location: { path: string; label: string; machine_id: string; exists_at_create: boolean; metadata: Record<string, string> };
    };
    expect(addPayload.project.slug).toBe("located-project");
    expect(addPayload.location.path).toBe(secondaryPath);
    expect(addPayload.location.label).toBe("docs");
    expect(addPayload.location.machine_id).toBe("machine007");
    expect(addPayload.location.exists_at_create).toBe(false);
    expect(addPayload.location.metadata.purpose).toBe("docs");

    const listed = runProjects(["locations", "list", "located-project", "--json"], env);
    expect(listed.exitCode).toBe(0);
    const listPayload = JSON.parse(text(listed.stdout)) as {
      locations: Array<{ path: string; label: string }>;
    };
    expect(listPayload.locations.map((location) => location.path).sort()).toEqual([primaryPath, secondaryPath].sort());

    const shownByPath = runProjects(["show", secondaryPath, "--json"], env);
    expect(shownByPath.exitCode).toBe(0);
    expect((JSON.parse(text(shownByPath.stdout)) as { project: { slug: string } }).project.slug).toBe("located-project");

    const updatedByName = runProjects(["update", "Located Project", "--priority", "medium", "--json"], env);
    expect(updatedByName.exitCode).toBe(0);
    expect((JSON.parse(text(updatedByName.stdout)) as { metadata: Record<string, string> }).metadata.priority).toBe("medium");

    const listedByPath = runProjects(["locations", "list", secondaryPath, "--json"], env);
    expect(listedByPath.exitCode).toBe(0);
    expect((JSON.parse(text(listedByPath.stdout)) as { project: { slug: string } }).project.slug).toBe("located-project");

    const started = runProjects(["start", secondaryPath, "--dry-run", "--json"], env);
    expect(started.exitCode).toBe(0);
    const startPayload = JSON.parse(text(started.stdout)) as {
      project: { slug: string };
      resolution: { source: string; registered: boolean };
    };
    expect(startPayload.project.slug).toBe("located-project");
    expect(startPayload.resolution.source).toBe("path");
    expect(startPayload.resolution.registered).toBe(true);
  });

  test("top-level start can plan unknown-folder registration with tags and metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-start-import-metadata-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const target = join(root, "family-security");
    mkdirSync(target);

    const started = runProjects([
      "start",
      target,
      "--dry-run",
      "--tags",
      "family,security",
      "--metadata-json",
      "{\"domain\":\"home-security\"}",
      "--json",
    ], env);

    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(text(started.stdout)) as {
      project: { id: string; tags: string[]; metadata: Record<string, unknown> };
      resolution: { source: string; registered: boolean; preview?: { tags: string[]; metadata: Record<string, unknown> } };
    };
    expect(payload.project.id).toBe("planned");
    expect(payload.project.tags).toEqual(["family", "security"]);
    expect(payload.project.metadata.domain).toBe("home-security");
    expect(payload.resolution.source).toBe("planned-import");
    expect(payload.resolution.registered).toBe(false);
    expect(payload.resolution.preview?.tags).toEqual(["family", "security"]);
    expect(payload.resolution.preview?.metadata.domain).toBe("home-security");
  });

  test("top-level start supports bulk dry-run JSON summaries", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-bulk-start-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const onePath = join(root, "bulk-one");
    const twoPath = join(root, "bulk-two");

    expect(runProjects(["create", "--name", "Bulk One", "--path", onePath, "--json"], env).exitCode).toBe(0);
    expect(runProjects(["create", "--name", "Bulk Two", "--path", twoPath, "--json"], env).exitCode).toBe(0);

    const started = runProjects([
      "start",
      "--bulk",
      "--dry-run",
      "--json",
      "--agent",
      "claude",
      "bulk-one",
      "bulk-two",
    ], env);

    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(text(started.stdout)) as {
      bulk: true;
      total: number;
      started: Array<{
        project?: { slug: string };
        workspace?: unknown;
        agent_tool: string;
        tool_command: string;
        tmux: { dry_run: boolean; session_action: string };
      }>;
      failed: unknown[];
      summary: {
        succeeded: number;
        failed: number;
        planned_sessions: number;
      };
    };

    expect(payload.bulk).toBe(true);
    expect(payload.total).toBe(2);
    expect(payload.failed).toEqual([]);
    expect(payload.summary.succeeded).toBe(2);
    expect(payload.summary.failed).toBe(0);
    expect(payload.summary.planned_sessions).toBe(2);
    expect(payload.started.map((item) => item.project?.slug).sort()).toEqual(["bulk-one", "bulk-two"]);
    expect(payload.started.every((item) => item.workspace === undefined)).toBe(true);
    expect(payload.started.every((item) => item.agent_tool === "claude")).toBe(true);
    expect(payload.started.every((item) => item.tool_command.startsWith("claude --name "))).toBe(true);
    expect(payload.started.every((item) => item.tmux.dry_run)).toBe(true);
    expect(payload.started.every((item) => item.tmux.session_action === "planned")).toBe(true);
  });

  test("top-level start reads bulk targets from JSON files", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-bulk-file-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const targetFile = join(root, "targets.json");

    expect(runProjects(["create", "--name", "File One", "--path", join(root, "file-one"), "--json"], env).exitCode).toBe(0);
    expect(runProjects(["create", "--name", "File Two", "--path", join(root, "file-two"), "--json"], env).exitCode).toBe(0);
    writeFileSync(targetFile, JSON.stringify(["file-one", "file-two"]), "utf-8");

    const started = runProjects(["start", "--bulk-file", targetFile, "--dry-run", "--json"], env);
    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(text(started.stdout)) as {
      bulk: true;
      total: number;
      started: Array<{ project?: { slug: string } }>;
      summary: { succeeded: number; planned_sessions: number };
    };

    expect(payload.bulk).toBe(true);
    expect(payload.total).toBe(2);
    expect(payload.summary.succeeded).toBe(2);
    expect(payload.summary.planned_sessions).toBe(2);
    expect(payload.started.map((item) => item.project?.slug).sort()).toEqual(["file-one", "file-two"]);
  });

  test("top-level start applies saved tmux profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-start-profile-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    expect(runProjects(["create", "--name", "Profile App", "--path", join(root, "profile-app"), "--json"], env).exitCode).toBe(0);
    const profile = runProjects([
      "tmux-profiles",
      "add",
      "--name",
      "Dev",
      "--slug",
      "dev",
      "--session-template",
      "{slug}-dev",
      "--windows-json",
      "[{\"name\":\"server\",\"path_template\":\"{path}\",\"command\":\"bun run dev\"}]",
      "--json",
    ], env);
    expect(profile.exitCode).toBe(0);

    const started = runProjects([
      "start",
      "profile-app",
      "--profile",
      "dev",
      "--agent",
      "claude",
      "--dry-run",
      "--json",
    ], env);

    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(text(started.stdout)) as {
      project?: { slug: string };
      schema_version?: number;
      kind?: string;
      render?: unknown;
      rename_report?: Array<{ status: string }>;
      tmux_profile?: { slug: string };
      tmux: {
        session_name: string;
        windows: Array<{ target: string; metadata?: { command?: string } }>;
      };
    };
    expect(payload.project?.slug).toBe("profile-app");
    expect(payload.tmux_profile?.slug).toBe("dev");
    expect(payload.tmux.session_name).toBe("profile-app-dev");
    expect(payload.tmux.windows.map((window) => window.target)).toEqual([
      "profile-app-dev:01",
      "profile-app-dev:02",
      "profile-app-dev:server",
    ]);
    expect(payload.tmux.windows[0]?.metadata?.command).toBe("claude --name 'Profile App'");
    expect(payload.tmux.windows[2]?.metadata?.command).toBe("bun run dev");
    expect(payload.schema_version).toBe(1);
    expect(payload.kind).toBe("projects.start");
    expect(payload.render).toBeTruthy();
    expect(payload.rename_report?.[0]?.status).toBe("configured");
  });

  test("top-level start and status use saved project launch defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-start-defaults-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    expect(runProjects([
      "tmux-profiles",
      "add",
      "--name",
      "Dev",
      "--slug",
      "dev",
      "--session-template",
      "{slug}-dev",
      "--windows-json",
      "[{\"name\":\"server\",\"command\":\"bun run dev\"}]",
      "--json",
    ], env).exitCode).toBe(0);

    expect(runProjects([
      "create",
      "--name",
      "Default Launch",
      "--slug",
      "default-launch",
      "--path",
      join(root, "default-launch"),
      "--launch-profile",
      "dev",
      "--start-agent",
      "claude",
      "--start-command",
      "claude --resume",
      "--start-session-policy",
      "error-if-running",
      "--start-windows-json",
      "[{\"name\":\"notes\",\"command\":\"vim NOTES.md\"}]",
      "--json",
    ], env).exitCode).toBe(0);

    const started = runProjects(["start", "default-launch", "--dry-run", "--json"], env);
    expect(started.exitCode).toBe(0);
    const startPayload = JSON.parse(text(started.stdout)) as {
      agent_tool: string;
      tool_command: string;
      session_policy: string;
      tmux_profile?: { slug: string };
      launch_defaults: {
        used_agent_tool: boolean;
        used_tool_command: boolean;
        used_tmux_profile: boolean;
        used_session_policy: boolean;
        session_policy: string | null;
        used_windows: boolean;
      };
      tmux: {
        session_name: string;
        windows: Array<{ target: string; metadata?: { command?: string } }>;
      };
    };
    expect(startPayload.agent_tool).toBe("claude");
    expect(startPayload.tool_command).toBe("claude --name 'Default Launch' --resume");
    expect(startPayload.session_policy).toBe("error-if-running");
    expect(startPayload.tmux_profile?.slug).toBe("dev");
    expect(startPayload.launch_defaults.used_agent_tool).toBe(true);
    expect(startPayload.launch_defaults.used_tool_command).toBe(true);
    expect(startPayload.launch_defaults.used_tmux_profile).toBe(true);
    expect(startPayload.launch_defaults.used_session_policy).toBe(true);
    expect(startPayload.launch_defaults.session_policy).toBe("error-if-running");
    expect(startPayload.launch_defaults.used_windows).toBe(true);
    expect(startPayload.tmux.session_name).toBe("default-launch-dev");
    expect(startPayload.tmux.windows.map((window) => window.target)).toEqual([
      "default-launch-dev:01",
      "default-launch-dev:02",
      "default-launch-dev:server",
      "default-launch-dev:notes",
    ]);
    expect(startPayload.tmux.windows[0]?.metadata?.command).toBe("claude --name 'Default Launch' --resume");

    const status = runProjects(["status", "default-launch", "--json"], env);
    expect(status.exitCode).toBe(0);
    const statusPayload = JSON.parse(text(status.stdout)) as {
      expected: { session_name: string; profile?: { slug: string }; windows: Array<{ name: string; command?: string }> };
      launch_defaults: { used_agent_tool: boolean; used_tmux_profile: boolean; used_session_policy: boolean; session_policy: string | null };
    };
    expect(statusPayload.expected.session_name).toBe("default-launch-dev");
    expect(statusPayload.expected.profile?.slug).toBe("dev");
    expect(statusPayload.expected.windows.map((window) => window.name)).toEqual(["01", "02", "server", "notes"]);
    expect(statusPayload.expected.windows[0]?.command).toBe("claude --name 'Default Launch' --resume");
    expect(statusPayload.launch_defaults.used_agent_tool).toBe(true);
    expect(statusPayload.launch_defaults.used_tmux_profile).toBe(true);
    expect(statusPayload.launch_defaults.used_session_policy).toBe(true);
    expect(statusPayload.launch_defaults.session_policy).toBe("error-if-running");
  });

  test("top-level start records when the project was last opened", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-start-last-opened-"));
    const binDir = join(root, "bin");
    const projectPath = join(root, "opened-project");
    const fakeTmux = join(binDir, "tmux");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(fakeTmux, "#!/usr/bin/env bun\n", "utf-8");
    chmodSync(fakeTmux, 0o755);
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    };

    try {
      expect(runProjects([
        "create",
        "--name",
        "Opened Project",
        "--slug",
        "opened-project",
        "--path",
        projectPath,
        "--json",
      ], env).exitCode).toBe(0);

      const started = runProjects(["start", "opened-project", "--agent", "none", "--json"], env);
      expect(started.exitCode).toBe(0);

      const shown = runProjects(["show", "opened-project", "--json"], env);
      expect(shown.exitCode).toBe(0);
      const payload = JSON.parse(text(shown.stdout)) as { project: { last_opened_at: string | null } };
      expect(payload.project.last_opened_at).not.toBeNull();
      expect(Number.isNaN(Date.parse(payload.project.last_opened_at!))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("top-level start accepts exact requested tmux windows as JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-start-windows-json-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    expect(runProjects([
      "tmux-profiles",
      "add",
      "--name",
      "Dev",
      "--slug",
      "dev",
      "--session-template",
      "{slug}-dev",
      "--windows-json",
      "[{\"name\":\"server\",\"command\":\"bun run dev\"}]",
      "--json",
    ], env).exitCode).toBe(0);

    expect(runProjects([
      "create",
      "--name",
      "Requested Windows",
      "--slug",
      "requested-windows",
      "--path",
      join(root, "requested-windows"),
      "--launch-profile",
      "dev",
      "--start-agent",
      "claude",
      "--start-windows-json",
      "[{\"name\":\"notes\",\"command\":\"vim NOTES.md\"}]",
      "--json",
    ], env).exitCode).toBe(0);

    const started = runProjects([
      "start",
      "requested-windows",
      "--windows-json",
      "[{\"name\":\"editor\",\"command\":\"code .\"},{\"name\":\"logs\",\"command\":\"tail -f app.log\"}]",
      "--dry-run",
      "--json",
    ], env);

    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(text(started.stdout)) as {
      launch_defaults: { used_windows: boolean };
      tmux: {
        session_name: string;
        windows: Array<{ target: string; metadata?: { command?: string } }>;
      };
    };
    expect(payload.tmux.session_name).toBe("requested-windows-dev");
    expect(payload.launch_defaults.used_windows).toBe(false);
    expect((payload as { rename_report?: Array<{ status: string }> }).rename_report?.[0]?.status).toBe("skipped");
    expect(payload.tmux.windows.map((window) => window.target)).toEqual([
      "requested-windows-dev:editor",
      "requested-windows-dev:logs",
    ]);
    expect(payload.tmux.windows.map((window) => window.metadata?.command)).toEqual([
      "code .",
      "tail -f app.log",
    ]);
  });

  test("top-level status reports expected project tmux session", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-status-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    expect(runProjects(["create", "--name", "Status App", "--path", join(root, "status-app"), "--json"], env).exitCode).toBe(0);
    expect(runProjects([
      "tmux-profiles",
      "add",
      "--name",
      "Dev",
      "--slug",
      "dev",
      "--session-template",
      "{slug}-dev",
      "--windows-json",
      "[{\"name\":\"server\",\"command\":\"bun run dev\"}]",
      "--json",
    ], env).exitCode).toBe(0);

    const status = runProjects(["status", "status-app", "--profile", "dev", "--json"], env);

    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(text(status.stdout)) as {
      project: { slug: string };
      expected: {
        session_name: string;
        profile?: { slug: string };
        windows: Array<{ name: string; command?: string }>;
      };
      exists: boolean;
      windows: unknown[];
    };
    expect(payload.project.slug).toBe("status-app");
    expect(payload.expected.session_name).toBe("status-app-dev");
    expect(payload.expected.profile?.slug).toBe("dev");
    expect(payload.expected.windows.map((window) => window.name)).toEqual(["01", "02", "server"]);
    expect(typeof payload.exists).toBe("boolean");
    expect(Array.isArray(payload.windows)).toBe(true);
  });

  test("top-level start auto-detects the current registered project path", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-start-cwd-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const projectPath = join(root, "cwd-app");
    mkdirSync(projectPath);

    expect(runProjects(["create", "--name", "Cwd App", "--path", projectPath, "--json"], env).exitCode).toBe(0);

    const started = runProjects(["start", "--dry-run", "--json"], env, projectPath);

    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(text(started.stdout)) as {
      project: { slug: string };
      resolution: { source: string; registered: boolean };
      tmux: { windows: Array<{ target: string }> };
    };
    expect(payload.project.slug).toBe("cwd-app");
    expect(payload.resolution.source).toBe("path");
    expect(payload.resolution.registered).toBe(true);
    expect(payload.tmux.windows.map((window) => window.target)).toEqual(["cwd-app:01", "cwd-app:02"]);
  });

  test("top-level sessions reports an empty rename surface without tmux", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-sessions-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    expect(runProjects(["create", "--name", "Session App", "--path", join(root, "session-app"), "--json"], env).exitCode).toBe(0);

    const sessions = runProjects(["sessions", "session-app", "--json"], env);

    expect(sessions.exitCode).toBe(0);
    const payload = JSON.parse(text(sessions.stdout)) as {
      schema_version: number;
      kind: string;
      total: number;
      sessions: unknown[];
      render?: unknown;
    };
    expect(payload.schema_version).toBe(1);
    expect(payload.kind).toBe("projects.sessions");
    expect(payload.total).toBe(0);
    expect(payload.sessions).toEqual([]);
    expect(payload.render).toBeTruthy();
  });

  test("top-level sessions with no target reports recent sessions instead of failing", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-sessions-no-target-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    expect(runProjects(["create", "--name", "Alpha App", "--path", join(root, "alpha-app"), "--json"], env).exitCode).toBe(0);
    expect(runProjects(["create", "--name", "Beta App", "--path", join(root, "beta-app"), "--json"], env).exitCode).toBe(0);

    const sessions = runProjects(["sessions", "--json"], env, root);

    expect(sessions.exitCode).toBe(0);
    expect(text(sessions.stderr)).not.toContain("Project not found");
    const payload = JSON.parse(text(sessions.stdout)) as {
      schema_version: number;
      kind: string;
      project: unknown;
      total: number;
      sessions: unknown[];
      render?: unknown;
    };
    expect(payload.schema_version).toBe(1);
    expect(payload.kind).toBe("projects.sessions");
    expect(payload.project).toBeNull();
    expect(typeof payload.total).toBe("number");
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(payload.render).toBeTruthy();
    rmSync(root, { recursive: true, force: true });
  });

  test("top-level start rejects attach for bulk starts", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-bulk-guard-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    const result = runProjects(["start", "--bulk", "--attach", "one", "two"], env);

    expect(result.exitCode).toBe(1);
    expect(text(result.stderr)).toContain("--attach is only supported for a single project start");
  });
  test("bulk start render-spec reports failure exit status", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-bulk-render-fail-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };

    const started = runProjects(["start", "--bulk", "missing-one", "missing-two", "--dry-run", "--render-spec"], env);
    expect(started.exitCode).toBe(1);
    const payload = JSON.parse(text(started.stdout)) as {
      root?: string;
      elements?: Record<string, { type?: string; props?: { title?: string; rows?: Array<Record<string, unknown>> } }>;
      metadata?: { kind?: string };
    };
    expect(payload.root).toBe("root");
    expect(payload.metadata?.kind).toBe("projects.start_bulk");
    const tables = Object.values(payload.elements ?? {}).filter((element) => element.type === "Table");
    const summary = tables.find((element) => element.props?.title === "summary")?.props?.rows?.[0] as { failed?: number } | undefined;
    const failures = tables.find((element) => element.props?.title === "failures")?.props?.rows ?? [];
    expect(summary?.failed).toBe(2);
    expect(failures).toHaveLength(2);
    expect(failures.map((failure) => failure.target).sort()).toEqual(["missing-one", "missing-two"]);
    rmSync(root, { recursive: true, force: true });
  });


  test("required commands emit JSON Render specs with --render-spec", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-render-spec-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    expect(runProjects(["roots", "add", "--name", "Render Root", "--slug", "render-root", "--path", join(root, "root"), "--kind", "project", "--github-org", "hasnaxyz", "--path-template", "{slug}", "--json"], env).exitCode).toBe(0);
    expect(runProjects(["recipes", "seed-defaults", "--json"], env).exitCode).toBe(0);
    expect(runProjects(["create", "--name", "Render Spec App", "--path", join(root, "root", "render-spec-app"), "--json"], env).exitCode).toBe(0);

    const commands = [
      ["list", "--render-spec"],
      ["show", "render-spec-app", "--render-spec"],
      ["status", "render-spec-app", "--render-spec"],
      ["start", "render-spec-app", "--dry-run", "--render-spec"],
      ["sessions", "render-spec-app", "--render-spec"],
      ["roots", "list", "--render-spec"],
      ["recipes", "list", "--render-spec"],
    ];
    for (const command of commands) {
      const result = runProjects(command, env);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(text(result.stdout)) as { root?: string; elements?: Record<string, unknown>; metadata?: { kind?: string } };
      expect(payload.root).toBe("root");
      expect(payload.elements?.root).toBeTruthy();
      expect(payload.metadata?.kind).toStartWith("projects.");
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("sync-roots CLI mutates by default and scan-roots stays dry-run on empty GitHub roots", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-sync-roots-empty-"));
    const env = { HASNA_PROJECTS_DB_PATH: join(root, "projects.db") };
    const scan = runProjects(["scan-roots", "--json"], env);
    expect(scan.exitCode).toBe(0);
    expect((JSON.parse(text(scan.stdout)) as { dry_run: boolean }).dry_run).toBe(true);

    const sync = runProjects(["sync-roots", "--json"], env);
    expect(sync.exitCode).toBe(0);
    expect((JSON.parse(text(sync.stdout)) as { dry_run: boolean }).dry_run).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("sync-roots exits nonzero on partial failures unless explicitly allowed", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-sync-roots-partial-"));
    const dbPath = join(root, "projects.db");
    const rootPath = join(root, "github-root");
    const fakeBin = join(root, "bin");
    mkdirSync(rootPath);
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "gh"), "#!/usr/bin/env bash\nif [[ \"$1 $2 $3\" == \"repo list hasnaxyz\" ]]; then echo project-locked; exit 0; fi\nexit 1\n");
    chmodSync(join(fakeBin, "gh"), 0o755);

    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);
    createRoot({
      name: "GitHub Root",
      slug: "github-root",
      base_path: rootPath,
      default_kind: "project",
      github_org: "hasnaxyz",
      path_template: "{slug}",
    }, db);
    acquireWorkspaceLock({
      lock_key: "workspace-slug:project-locked",
      reason: "test partial failure",
      ttl_seconds: 600,
    }, db);
    db.close();

    const env = {
      HASNA_PROJECTS_DB_PATH: dbPath,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    };
    const failed = runProjects(["sync-roots", "--root", "github-root", "--repo-prefix", "project-", "--no-clone", "--json"], env);
    expect(failed.exitCode).toBe(1);
    expect((JSON.parse(text(failed.stdout)) as { errors: unknown[] }).errors).toHaveLength(1);

    const allowed = runProjects(["sync-roots", "--root", "github-root", "--repo-prefix", "project-", "--no-clone", "--allow-partial", "--json"], env);
    expect(allowed.exitCode).toBe(0);
    expect((JSON.parse(text(allowed.stdout)) as { errors: unknown[] }).errors).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  test("create --dry-run previews only and never persists in cloud (self_hosted) mode", async () => {
    // Regression: `projects create --dry-run` in cloud mode used to route
    // straight to the cloud backend and POST a new project row, persisting a
    // project despite --dry-run promising a preview-only, no-write run.
    const root = mkdtempSync(join(tmpdir(), "projects-cloud-dryrun-"));
    const port = reserveFreePort();
    const requests: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req) {
        const url = new URL(req.url);
        requests.push({ method: req.method, path: url.pathname });
        if (req.method === "POST" && url.pathname === "/v1/projects") {
          // A real cloud create would persist and return the new row.
          return Response.json({
            id: "wks_cloudpersisted000000",
            slug: "cloud-dryrun-probe",
            name: "Cloud Dryrun Probe",
            kind: "generic",
            status: "active",
            primary_path: null,
          });
        }
        if (url.pathname === "/v1/projects") return Response.json({ workspaces: [] });
        return Response.json({});
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_HOME: join(root, "home"),
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_PROJECTS_API_KEY: "test-key",
    };
    try {
      const proc = Bun.spawn({
        cmd: [
          "bun",
          "run",
          CLI_PATH,
          "create",
          "--name",
          "Cloud Dryrun Probe",
          "--path",
          join(root, "cloud-dryrun-probe"),
          "--kind",
          "generic",
          "--dry-run",
          "--json",
        ],
        stdout: "pipe",
        stderr: "pipe",
        env: testSpawnEnv(env),
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      expect(proc.exitCode).toBe(0);
      // The dry-run must not have issued any create write to the cloud backend.
      const creates = requests.filter((r) => r.method === "POST" && r.path === "/v1/projects");
      expect(creates).toHaveLength(0);
      // And it must report a dry-run preview rather than a persisted project.
      const payload = JSON.parse(stdout) as { dry_run?: boolean; project?: unknown };
      expect(payload.dry_run).toBe(true);
      expect(payload.project).toBeNull();
      expect(stderr).toBe("");
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  test("store ensure provisions an exact API-backed project locally, stays idempotent, and fails closed on invalid targets", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-api-store-ensure-"));
    const projectsHome = join(root, "home");
    const projectId = "wks_apistoreensure0001";
    const project = {
      id: projectId,
      slug: "api-store-ensure",
      name: "API Store Ensure",
      description: null,
      kind: "generic",
      status: "active",
      root_id: null,
      recipe_id: null,
      canonical_machine: null,
      primary_path: join(projectsHome, "workspaces", projectId),
      git_remote: null,
      s3_bucket: null,
      s3_prefix: null,
      tags: [],
      integrations: {},
      metadata: {},
      last_opened_at: null,
      created_at: "2026-08-07 00:00:00",
      updated_at: "2026-08-07 00:00:01",
      synced_at: null,
    };
    const requests: Array<{ method: string; path: string }> = [];
    const port = reserveFreePort();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req) {
        const url = new URL(req.url);
        requests.push({ method: req.method, path: url.pathname });
        if (req.method === "GET" && url.pathname === `/v1/projects/${projectId}/guarded-metadata`) {
          return Response.json({
            ok: true,
            project_id: projectId,
            project,
            current_revision: project.updated_at,
            response_control: {
              response_byte_limit: Number(url.searchParams.get("response_byte_limit")),
              time_budget_ms: Number(url.searchParams.get("time_budget_ms")),
              response_bytes: 1024,
              elapsed_ms: 1,
              complete: true,
              truncated: false,
            },
          });
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_HOME: projectsHome,
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_PROJECTS_API_KEY: "test-key",
    };
    const runEnsure = async (target: string, extraArgs: string[] = []) => {
      const proc = Bun.spawn({
        cmd: ["bun", "run", CLI_PATH, "store", "ensure", target, ...extraArgs, "--json"],
        stdout: "pipe",
        stderr: "pipe",
        env: testSpawnEnv(env),
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      return { exitCode: proc.exitCode, stdout, stderr };
    };

    try {
      const dryRun = await runEnsure(projectId, ["--dry-run"]);
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.stderr).toBe("");
      const planned = JSON.parse(dryRun.stdout) as { dry_run: boolean; project: { id: string }; created: string[] };
      expect(planned.dry_run).toBe(true);
      expect(planned.project.id).toBe(projectId);
      expect(planned.created).toContain(join(projectsHome, "data", projectId));
      expect(existsSync(join(projectsHome, "data", projectId, "project.db"))).toBe(false);

      const applied = await runEnsure(projectId);
      expect(applied.exitCode).toBe(0);
      expect(applied.stderr).toBe("");
      const created = JSON.parse(applied.stdout) as { dry_run: boolean; project: { id: string }; created: string[]; app_store: { exists: boolean; project_id: string } };
      expect(created.dry_run).toBe(false);
      expect(created.project.id).toBe(projectId);
      expect(created.app_store).toMatchObject({ exists: true, project_id: projectId });
      expect(existsSync(join(projectsHome, "data", projectId, "project.db"))).toBe(true);

      const repeated = await runEnsure(projectId);
      expect(repeated.exitCode).toBe(0);
      const noOp = JSON.parse(repeated.stdout) as { created: string[]; app_store: { exists: boolean } };
      expect(noOp.created).toEqual([]);
      expect(noOp.app_store.exists).toBe(true);

      const requestCount = requests.length;
      const slugRefused = await runEnsure(project.slug, ["--dry-run"]);
      expect(slugRefused.exitCode).toBe(1);
      expect(slugRefused.stderr).toContain("complete stable project id");
      expect(requests).toHaveLength(requestCount);

      const missing = await runEnsure("wks_apistoremissing0001", ["--dry-run"]);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("404");
      expect(existsSync(join(projectsHome, "data", "wks_apistoremissing0001"))).toBe(false);

      const collisionId = "wks_apistorecollision01";
      const collisionPath = join(projectsHome, "workspaces", collisionId);
      mkdirSync(collisionPath, { recursive: true });
      writeFileSync(join(collisionPath, ".project.json"), JSON.stringify({ id: "wks_someotherproject0001" }));
      const collisionProject = { ...project, id: collisionId, primary_path: collisionPath };
      server.reload({
        fetch(req) {
          const url = new URL(req.url);
          requests.push({ method: req.method, path: url.pathname });
          if (req.method === "GET" && url.pathname === `/v1/projects/${collisionId}/guarded-metadata`) {
            return Response.json({
              ok: true,
              project_id: collisionId,
              project: collisionProject,
              current_revision: collisionProject.updated_at,
              response_control: { response_byte_limit: 65_536, time_budget_ms: 10_000, response_bytes: 1024, elapsed_ms: 1, complete: true, truncated: false },
            });
          }
          return Response.json({ error: "Not found" }, { status: 404 });
        },
      });
      const collision = await runEnsure(collisionId, ["--dry-run"]);
      expect(collision.exitCode).toBe(1);
      expect(collision.stderr).toContain("belongs to project wks_someotherproject0001");
      expect(existsSync(join(projectsHome, "data", collisionId, "project.db"))).toBe(false);
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("doctor --fix --dry-run does not promise a local location write for an API-backed exact target", async () => {
    const fixture = cloudDoctorFixture();
    try {
      const result = await fixture.runDoctor(["--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const rows = JSON.parse(result.stdout) as Array<{
        checks: Array<{ code: string; fixable?: boolean; message: string }>;
        fixes: Array<{ code: string; dryRun: boolean }>;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.fixes).toContainEqual(expect.objectContaining({ code: "FIX_WORKSPACE_MARKER", dryRun: true }));
      expect(rows[0]!.fixes.some((fix) => fix.code === "FIX_WORKSPACE_LOCATION")).toBe(false);
      expect(rows[0]!.checks).toContainEqual(expect.objectContaining({
        code: "WORKSPACE_LOCATIONS_LOCAL_ONLY",
        fixable: false,
        message: expect.stringContaining("API-backed projects do not own the machine-local location registry"),
      }));
      expect(JSON.parse(readFileSync(join(fixture.projectPath, ".project.json"), "utf-8")).slug).toBe("monthly-accounting");
      expect(fixture.requests).toEqual([{ method: "GET", path: `/v1/projects/${fixture.projectId}` }]);
    } finally {
      fixture.close();
    }
  }, 30_000);

  test("doctor --fix returns JSON after regenerating an API-backed marker without touching local location or event tables", async () => {
    const fixture = cloudDoctorFixture();
    try {
      const result = await fixture.runDoctor([]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const rows = JSON.parse(result.stdout) as Array<{
        fixes: Array<{ code: string; changed: boolean }>;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.fixes).toContainEqual(expect.objectContaining({ code: "FIX_WORKSPACE_MARKER", changed: true }));
      expect(rows[0]!.fixes.some((fix) => fix.code === "FIX_WORKSPACE_LOCATION")).toBe(false);
      const marker = JSON.parse(readFileSync(join(fixture.projectPath, ".project.json"), "utf-8")) as { id: string; slug: string; name: string };
      expect(marker).toMatchObject({ id: fixture.projectId, slug: "monthly-filing", name: "Monthly Filing" });

      const db = new Database(fixture.dbPath);
      expect(db.query("SELECT COUNT(*) AS count FROM workspace_locations").get()).toEqual({ count: 0 });
      expect(db.query("SELECT COUNT(*) AS count FROM workspace_events").get()).toEqual({ count: 0 });
      db.close();
      expect(fixture.requests).toEqual([{ method: "GET", path: `/v1/projects/${fixture.projectId}` }]);
    } finally {
      fixture.close();
    }
  }, 30_000);

  test("channel --ensure succeeds in api mode even when the events route 404s, and is idempotent", async () => {
    // Regression (issue #28): `projects channel <p> --ensure` created the
    // conversations channel and persisted `integrations.conversations_channel`,
    // then exited 1 with a raw
    // `Hasna request failed: POST /projects/<id>/events -> 404` because the
    // audit-event POST is not served by the cloud API. Agents therefore treated
    // a fully linked channel as missing and retried into drift.
    const root = mkdtempSync(join(tmpdir(), "projects-channel-ensure-cloud-"));
    const port = reserveFreePort();
    const conversationsBin = join(root, "conversations");
    const conversationsLog = join(root, "conversations-args.log");
    // Stub conversations CLI: first `channel create` succeeds, later ones report
    // the channel already exists (the real create-first existence probe).
    writeFileSync(
      conversationsBin,
      [
        "#!/usr/bin/env bash",
        `LOG=${JSON.stringify(conversationsLog)}`,
        'printf "%s\n" "$*" >> "$LOG"',
        'if [ "$(grep -c . "$LOG")" -gt 1 ]; then',
        '  echo "Error: Channel already exists." >&2',
        "  exit 1",
        "fi",
        `echo '{"channel":{"name":"probe"}}'`,
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    chmodSync(conversationsBin, 0o755);

    const projectId = "wks_channelensure00000001";
    const project: Record<string, unknown> = {
      id: projectId,
      slug: "channel-ensure-probe",
      name: "Channel Ensure Probe",
      kind: "internal-app",
      status: "active",
      integrations: {},
      tags: [],
      metadata: {},
    };
    const requests: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(req) {
        const url = new URL(req.url);
        requests.push({ method: req.method, path: url.pathname });
        if (url.pathname === `/v1/projects/${projectId}`) {
          if (req.method === "GET") return Response.json(project);
          if (req.method === "PATCH" || req.method === "PUT") {
            const body = (await req.json()) as { integrations?: Record<string, string> };
            project["integrations"] = { ...(project["integrations"] as object), ...(body.integrations ?? {}) };
            return Response.json(project);
          }
        }
        // The cloud API serves GET but not POST for project events.
        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_HOME: join(root, "home"),
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_PROJECTS_API_KEY: "test-key",
      PROJECTS_CONVERSATIONS_BIN: conversationsBin,
    };
    const runEnsure = async () => {
      const proc = Bun.spawn({
        cmd: ["bun", "run", CLI_PATH, "channel", projectId, "--ensure", "--from", "agent-test", "--json"],
        stdout: "pipe",
        stderr: "pipe",
        env: testSpawnEnv(env),
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      return { exitCode: proc.exitCode, stdout, stderr };
    };

    try {
      const first = await runEnsure();

      // Command exit status: a completed ensure must not report failure.
      expect(first.exitCode).toBe(0);
      expect(first.stderr).not.toContain("Hasna request failed");
      const created = JSON.parse(first.stdout) as {
        status: string;
        channel: string;
        channel_class: string;
        linked: boolean;
        warnings: string[];
        side_effects: Record<string, boolean>;
        project: { integrations: Record<string, string> };
      };
      expect(created.status).toBe("created");
      expect(created.channel).toBe("channel-ensure-probe");
      expect(created.channel_class).toBe("product");
      // Ensure creates the channel but never writes the project record: a
      // derived name pinned as an explicit link would outrank derivation
      // forever and survive a revert.
      expect(created.linked).toBe(false);
      expect(created.project.integrations["conversations_channel"]).toBeUndefined();
      expect(requests.some((r) => r.method === "PATCH" && r.path === `/v1/projects/${projectId}`)).toBe(false);
      // The unsupported audit-event POST is reported as a non-fatal warning.
      expect(created.side_effects["channel_created"]).toBe(true);
      expect(created.side_effects["integration_linked"]).toBe(false);
      expect(created.side_effects["event_recorded"]).toBe(false);
      expect(created.warnings.join(" ")).toContain("audit event was not recorded");
      // Class metadata is forwarded to conversations.
      const conversationsArgs = readFileSync(conversationsLog, "utf-8");
      expect(conversationsArgs).toContain("--class product");

      // Existing-channel retry stays successful and still writes nothing.
      const retry = await runEnsure();
      expect(retry.exitCode).toBe(0);
      const existing = JSON.parse(retry.stdout) as { status: string; linked: boolean };
      expect(existing.status).toBe("exists");
      expect(existing.linked).toBe(false);
      expect(requests.filter((r) => r.method === "PATCH").length).toBe(0);
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  test("create in cloud mode honors registry flags and refuses machine-local runtime flags before creating a row", async () => {
    // Regression (issue #27): the api/cloud branch of `projects create` passed
    // only a handful of registry fields, so `--path`, `--git-remote` and the
    // management/integration flags were silently dropped, while machine-local
    // runtime flags (`--mkdir`/`--git-init`/`--marker`/`--tmux-*`) were dropped
    // *after* the remote row had already been created, leaving a partial
    // row-only project behind.
    const root = mkdtempSync(join(tmpdir(), "projects-cloud-create-flags-"));
    const port = reserveFreePort();
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(req) {
        const url = new URL(req.url);
        let body: Record<string, unknown> | null = null;
        try { body = (await req.json()) as Record<string, unknown>; } catch { body = null; }
        requests.push({ method: req.method, path: url.pathname, body });
        if (req.method === "POST" && url.pathname === "/v1/projects") {
          return Response.json({
            id: "wks_cloudcreateflags0001",
            slug: "cloud-flag-probe",
            name: "Cloud Flag Probe",
            kind: "generic",
            status: "active",
            primary_path: (body?.primary_path as string | undefined) ?? null,
          });
        }
        if (url.pathname === "/v1/projects") return Response.json({ workspaces: [] });
        return Response.json({});
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_HOME: join(root, "home"),
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_PROJECTS_API_KEY: "test-key",
    };
    const targetPath = join(root, "cloud-flag-probe");
    const runCreate = async (args: string[]) => {
      const proc = Bun.spawn({
        cmd: ["bun", "run", CLI_PATH, "create", "--name", "Cloud Flag Probe", ...args],
        stdout: "pipe",
        stderr: "pipe",
        env: testSpawnEnv(env),
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      return { exitCode: proc.exitCode, stdout, stderr };
    };
    try {
      // 1. Machine-local runtime flags must fail atomically, before any create.
      const refused = await runCreate([
        "--path", targetPath,
        "--mkdir",
        "--marker",
        "--tmux-session", "cloud-flag-probe",
        "--json",
      ]);
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("local-only operation and is not available in api/cloud mode");
      expect(refused.stderr).toContain("--mkdir");
      expect(refused.stderr).toContain("--marker");
      expect(refused.stderr).toContain("--tmux-session");
      expect(requests.filter((r) => r.method === "POST" && r.path === "/v1/projects")).toHaveLength(0);
      expect(existsSync(targetPath)).toBe(false);

      // 2. Registry-level flags must be forwarded to the cloud create, not dropped.
      const created = await runCreate([
        "--path", targetPath,
        "--git-remote", "https://github.com/hasna/cloud-flag-probe.git",
        "--description", "probe",
        "--stage", "active",
        "--priority", "high",
        "--owner", "andrei",
        "--todos-project-id", "prj_probe",
        "--tags", "probe,cloud",
        "--json",
      ]);
      expect(created.exitCode).toBe(0);
      const creates = requests.filter((r) => r.method === "POST" && r.path === "/v1/projects");
      expect(creates).toHaveLength(1);
      const body = creates[0]!.body as {
        primary_path?: string;
        git_remote?: string;
        description?: string;
        tags?: string[];
        metadata?: Record<string, unknown>;
        integrations?: Record<string, unknown>;
      };
      expect(body.primary_path).toBe(targetPath);
      expect(body.git_remote).toBe("https://github.com/hasna/cloud-flag-probe.git");
      expect(body.description).toBe("probe");
      expect(body.tags).toEqual(["probe", "cloud"]);
      expect(body.metadata?.stage).toBe("active");
      expect(body.metadata?.priority).toBe("high");
      expect(body.metadata?.owner).toBe("andrei");
      expect(body.integrations?.todos_project_id).toBe("prj_probe");
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  test("create in cloud mode derives the same primary_path and channel the dry-run plan promises", async () => {
    // Regression: `projects create --dry-run` reported a canonical
    // `primary_path` and a derived `integrations.conversations_channel`, and the
    // identical real create in api/cloud mode produced `primary_path: null` and
    // `integrations: {}` — so the plan promised a project the create did not
    // build, and `projects store inspect` then read primary_is_canonical=false /
    // exists.workspace=false. Five projects were created that way.
    //
    // Both derivations live in the shared registry helper. The client supplies
    // an id-derived no-root path, while the server derives slug-dependent
    // fields only after allocating the exact persisted slug.
    //
    // The property under test is TRANSPORT PARITY: the same flags must produce
    // the same registry row whether the store is local or api. The existing
    // cloud-create test above always passes `--path`, so it could never observe
    // this — the divergence only appears on the defaulting path.
    const root = mkdtempSync(join(tmpdir(), "projects-cloud-derive-"));
    const home = join(root, "home");
    const rootedBase = join(root, "rooted");
    const port = reserveFreePort();
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    const persistedSlugs = new Set<string>();
    const rooted: Root = {
      id: "root_cloud_derive",
      slug: "cloud-derive-root",
      name: "Cloud Derive Root",
      base_path: rootedBase,
      tags: [],
      default_kind: "project",
      default_recipe_id: null,
      default_tmux_profile_id: null,
      github_org: null,
      repo_visibility: null,
      path_template: "{slug}",
      name_template: null,
      allowed_recipes: [],
      allowed_agents: [],
      metadata: {},
      created_at: "2026-08-03 00:00:00",
      updated_at: "2026-08-03 00:00:00",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(req) {
        const url = new URL(req.url);
        let body: Record<string, unknown> | null = null;
        try { body = (await req.json()) as Record<string, unknown>; } catch { body = null; }
        requests.push({ method: req.method, path: url.pathname, body });
        if (req.method === "GET" && url.pathname === `/v1/roots/${rooted.slug}`) {
          return Response.json(rooted);
        }
        if (req.method === "POST" && url.pathname === "/v1/projects") {
          const id = (body?.id as string | undefined) ?? "wks_serverassigned0001";
          const baseSlug = (body?.slug as string | undefined) ?? "cloud-derive-probe";
          let slug = baseSlug;
          let suffix = 1;
          while (persistedSlugs.has(slug)) {
            suffix++;
            slug = `${baseSlug}-${suffix}`;
          }
          persistedSlugs.add(slug);
          const projectRoot = body?.root_id === rooted.id ? rooted : null;
          const kind = ((body?.kind as WorkspaceKind | undefined) ?? projectRoot?.default_kind ?? "generic") as WorkspaceKind;
          const derived = deriveWorkspaceRegistryFields({
            name: (body?.name as string | undefined) ?? "Cloud Derive Probe",
            primary_path: body?.primary_path as string | undefined,
            integrations: body?.integrations as Record<string, string> | undefined,
          }, { root: projectRoot, slug, id, kind });
          return Response.json({
            id,
            slug,
            name: (body?.name as string | undefined) ?? "Cloud Derive Probe",
            kind,
            status: "active",
            root_id: projectRoot?.id ?? null,
            primary_path: derived.primary_path,
            integrations: derived.integrations,
          });
        }
        if (url.pathname === "/v1/projects") return Response.json({ workspaces: [] });
        return Response.json({});
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_HOME: home,
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_PROJECTS_API_KEY: "test-key",
    };
    const runCreate = async (args: string[]) => {
      const proc = Bun.spawn({
        cmd: ["bun", "run", CLI_PATH, "create", ...args],
        stdout: "pipe",
        stderr: "pipe",
        env: testSpawnEnv(env),
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      return { exitCode: proc.exitCode, stdout, stderr };
    };
    const postBodies = () => requests
      .filter((r) => r.method === "POST" && r.path === "/v1/projects")
      .map((r) => r.body as {
        id?: string;
        slug?: string;
        primary_path?: string | null;
        integrations?: Record<string, unknown>;
      });

    try {
      // The plan the operator is shown before committing.
      const planned = await runCreate([
        "--name", "Cloud Derive Probe",
        "--slug", "cloud-derive-probe",
        "--dry-run",
        "--json",
      ]);
      expect(planned.exitCode).toBe(0);
      // Negative control on the dry run itself: previewing must not create.
      expect(postBodies()).toHaveLength(0);
      const plan = JSON.parse(planned.stdout) as {
        plan: { project: { primary_path: string | null; integrations: Record<string, unknown> } };
      };
      const plannedPath = plan.plan.project.primary_path;
      const plannedChannel = plan.plan.project.integrations?.["conversations_channel"];
      // The plan is only a meaningful oracle if it actually promises something.
      expect(plannedPath).toBe(join(home, "workspaces", plannedPath!.split("/").pop()!));
      expect(plannedChannel).toBe("cloud-derive-probe");

      // The real create, same flags, no --path.
      const created = await runCreate([
        "--name", "Cloud Derive Probe",
        "--slug", "cloud-derive-probe",
        "--json",
      ]);
      expect(created.exitCode).toBe(0);
      const bodies = postBodies();
      expect(bodies).toHaveLength(1);
      const body = bodies[0]!;

      // The create must honour what the plan promised.
      expect(body.primary_path).not.toBeNull();
      expect(body.primary_path).toBeDefined();
      // Tie the path to the id actually sent, so a path for some *other*
      // project's id cannot pass: the canonical location is derived from the id.
      expect(body.id).toMatch(/^wks_[A-Za-z0-9_-]+$/);
      expect(body.primary_path).toBe(join(home, "workspaces", body.id!));
      // The channel is deliberately absent from the request. The server must
      // derive it after slug allocation instead of mistaking a client guess for
      // an explicit integration link.
      expect(body.integrations?.["conversations_channel"]).toBeUndefined();
      const createdProject = (JSON.parse(created.stdout) as {
        project: { primary_path: string; integrations: Record<string, unknown> };
      }).project;
      expect(createdProject.primary_path).toBe(body.primary_path!);
      expect(createdProject.integrations["conversations_channel"]).toBe(plannedChannel);

      // Negative control 1: an explicit --path must still win, so the fix is
      // "derive a default", not "overwrite whatever the operator asked for".
      const explicitPath = join(root, "explicit-elsewhere");
      const explicit = await runCreate([
        "--name", "Cloud Derive Explicit",
        "--slug", "cloud-derive-explicit",
        "--path", explicitPath,
        "--json",
      ]);
      expect(explicit.exitCode).toBe(0);
      const explicitBody = postBodies()[1]!;
      expect(explicitBody.primary_path).toBe(explicitPath);

      // Negative control 2: an explicitly linked channel must still win over the
      // slug-derived default.
      const pinned = await runCreate([
        "--name", "Cloud Derive Pinned",
        "--slug", "cloud-derive-pinned",
        "--integrations-json", JSON.stringify({ conversations_channel: "pinned-elsewhere" }),
        "--json",
      ]);
      expect(pinned.exitCode).toBe(0);
      const pinnedBody = postBodies()[2]!;
      expect(pinnedBody.integrations?.["conversations_channel"]).toBe("pinned-elsewhere");

      // Real duplicate-slug API path: the client cannot know the suffix before
      // the server checks the registry. A rooted {slug} path and the derived
      // channel must therefore follow the exact returned/persisted slug.
      const duplicateArgs = [
        "--name", "Rooted Duplicate",
        "--slug", "rooted-duplicate",
        "--root", rooted.slug,
        "--json",
      ];
      const firstDuplicate = await runCreate(duplicateArgs);
      const secondDuplicate = await runCreate(duplicateArgs);
      expect(firstDuplicate.exitCode).toBe(0);
      expect(secondDuplicate.exitCode).toBe(0);
      const secondProject = (JSON.parse(secondDuplicate.stdout) as {
        project: { slug: string; primary_path: string; integrations: Record<string, unknown> };
      }).project;
      expect(secondProject.slug).toBe("rooted-duplicate-2");
      expect(secondProject.primary_path).toBe(join(rootedBase, secondProject.slug));
      expect(secondProject.integrations["conversations_channel"]).toBe(secondProject.slug);

      const secondDuplicateBody = postBodies()[4]!;
      expect(secondDuplicateBody.primary_path).toBeUndefined();
      expect(secondDuplicateBody.integrations?.["conversations_channel"]).toBeUndefined();
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

});
