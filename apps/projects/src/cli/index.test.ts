import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Command } from "commander";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { acquireWorkspaceLock, completeAgentRun, createRoot, createWorkspace, startAgentRun } from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import { closeDatabase } from "../db/database.js";
import { deriveWorkspaceRegistryFields } from "../lib/workspace-plan.js";
import { PROJECT_REGISTRATION_DEPENDENCY_TASKS } from "../lib/project-registration.js";
import { registerWorkspaceCommands } from "./commands/workspaces.js";
import { HOSTED_API_ENV_KEYS, testSpawnEnv } from "../testing/spawn-env.js";
import { PROJECTS_LOCAL_REGISTRY_ENV, __resetProjectStore } from "../store/project-store.js";
import type { Root, WorkspaceKind } from "../types/workspace.js";

setDefaultTimeout(15_000);

const CLI_PATH = join(process.cwd(), "src/cli/index.ts");
const CLI_PROCESS_TEST_TIMEOUT_MS = 30_000;

function cliProcessTest(name: string, fn: () => void | Promise<void>): void {
  test(name, fn, CLI_PROCESS_TEST_TIMEOUT_MS);
}

function runProjects(args: string[], env: Record<string, string> = {}, cwd = process.cwd()) {
  return Bun.spawnSync({
    cmd: ["bun", "run", CLI_PATH, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: testSpawnEnv(env),
    cwd,
  });
}

function runProjectsWithoutStdin(args: string[], env: Record<string, string> = {}, cwd = process.cwd()) {
  return Bun.spawnSync({
    cmd: ["bun", "run", CLI_PATH, ...args],
    stdin: "ignore",
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
  // Same reasoning as testSpawnEnv(): an operator shell that exports the hosted backend
  // selectors would otherwise silently turn these in-process local-store runs
  // into hosted-backend runs against the real backend. Blank, not delete: the
  // shared @hasna/contracts seam reads fleet app-config files on disk when the
  // environment is silent, and an explicitly DEFINED-but-blank URL is its
  // "select the local store" escape hatch that beats any disk pointer.
  for (const key of HOSTED_API_ENV_KEYS) {
    if (key in env) continue;
    previousEnv.set(key, process.env[key]);
    process.env[key] = "";
  }
  // Store resolution fails closed without the hosted API env (no silent local
  // fallback). These in-process runs exercise the on-box SQLite registry, so
  // they explicitly opt in to it.
  if (!(PROJECTS_LOCAL_REGISTRY_ENV in env)) {
    previousEnv.set(PROJECTS_LOCAL_REGISTRY_ENV, process.env[PROJECTS_LOCAL_REGISTRY_ENV]);
    process.env[PROJECTS_LOCAL_REGISTRY_ENV] = "1";
  }
  for (const [key, value] of Object.entries(env)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
  // resolveProjectStore() memoises the store it built from process.env, and the
  // module registry is shared across test files in one `bun test` run. Clearing
  // the API env vars is therefore not enough: a store another file already
  // resolved in the hosted backend survives, and these local-store runs then read and
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
    // Deliberate loopback credential via the shared contracts seam's override
    // tier: a plain HASNA_PROJECTS_API_KEY in the spawned env is read as the
    // legacy tier, which warns on stderr (DEPRECATED) whenever the disk tier
    // holds no key — CI has none — breaking every stderr-clean assertion.
    HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
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
      worklog_markdown: "# Worklog\n\n- Registration requested.\n",
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

  test("register-full consumes a caller-owned mode-0600 input file through the same transaction path", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-input-file-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const inputPath = join(root, "register-full.json");
    const privatePayloadMarker = "private-input-file-marker-must-not-be-echoed";
    const payload = JSON.stringify({
      operation_id: "op-cli-register-full-input-file",
      project: {
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
        metadata: { private_payload_marker: privatePayloadMarker },
      },
      target_path: targetPath,
      goals_markdown: "# Goals\n\n- Register safely from one file.\n",
      worklog_markdown: "# Worklog\n\n- Registration requested from one file.\n",
      response_byte_limit: 512_000,
      time_budget_ms: 10_000,
    });
    writeFileSync(inputPath, payload, { mode: 0o600 });
    chmodSync(inputPath, 0o600);
    try {
      const result = runProjectsWithoutStdin(
        ["register-full", "--input", inputPath, "--json"],
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
      expect(text(result.stdout)).not.toContain(privatePayloadMarker);
      expect(text(result.stderr)).not.toContain(privatePayloadMarker);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full rejects simultaneous stdin and --input without echoing either payload", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-dual-input-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const inputPath = join(root, "register-full.json");
    const filePayloadMarker = "private-file-payload-must-not-be-echoed";
    const stdinPayloadMarker = "private-stdin-payload-must-not-be-echoed";
    const makePayload = (operationId: string, marker: string) => JSON.stringify({
      operation_id: operationId,
      project: {
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
        metadata: { private_payload_marker: marker },
      },
      target_path: targetPath,
      goals_markdown: "# Goals\n\n- Refuse ambiguous input.\n",
      worklog_markdown: "# Worklog\n\n- Registration requested.\n",
    });
    writeFileSync(inputPath, makePayload("op-cli-register-full-file", filePayloadMarker), { mode: 0o600 });
    chmodSync(inputPath, 0o600);
    try {
      const result = await runProjectsWithStdin(
        ["register-full", "--input", inputPath, "--json"],
        makePayload("op-cli-register-full-stdin", stdinPayloadMarker),
        { HASNA_PROJECTS_DB_PATH: dbPath },
      );
      expect(result.exitCode).toBe(1);
      expect(text(result.stderr)).toBe("");
      expect(JSON.parse(text(result.stdout))).toMatchObject({
        ok: false,
        outcome: "no_go",
        reason_code: "invalid_bounded_stdin_request",
        error: "register-full accepts exactly one input source: stdin or --input",
      });
      expect(text(result.stdout)).not.toContain(filePayloadMarker);
      expect(text(result.stdout)).not.toContain(stdinPayloadMarker);
      expect(text(result.stderr)).not.toContain(filePayloadMarker);
      expect(text(result.stderr)).not.toContain(stdinPayloadMarker);
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full rejects non-regular and non-0600 input files before reading payload bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-file-guards-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const insecurePath = join(root, "insecure.json");
    const missingPath = join(root, "missing.json");
    const directoryPath = join(root, "directory-input");
    const secureTargetPath = join(root, "secure-target.json");
    const symlinkPath = join(root, "symlink-input.json");
    const privatePayloadMarker = "guarded-file-payload-must-not-be-echoed";
    writeFileSync(insecurePath, JSON.stringify({
      operation_id: privatePayloadMarker,
      target_path: targetPath,
    }), { mode: 0o644 });
    chmodSync(insecurePath, 0o644);
    mkdirSync(directoryPath);
    chmodSync(directoryPath, 0o600);
    writeFileSync(secureTargetPath, JSON.stringify({ operation_id: privatePayloadMarker }), { mode: 0o600 });
    chmodSync(secureTargetPath, 0o600);
    symlinkSync(secureTargetPath, symlinkPath);
    try {
      for (const [inputPath, expectedError] of [
        [missingPath, "register-full --input must reference a regular file"],
        [insecurePath, "register-full --input file mode must be 0600"],
        [directoryPath, "register-full --input must reference a regular file"],
        [symlinkPath, "register-full --input must reference a regular file"],
      ] as const) {
        const result = runProjectsWithoutStdin(
          ["register-full", "--input", inputPath, "--json"],
          { HASNA_PROJECTS_DB_PATH: dbPath },
        );
        expect(result.exitCode).toBe(1);
        expect(text(result.stderr)).toBe("");
        expect(JSON.parse(text(result.stdout))).toMatchObject({
          ok: false,
          outcome: "no_go",
          reason_code: "invalid_bounded_stdin_request",
          error: expectedError,
        });
        expect(text(result.stdout)).not.toContain(privatePayloadMarker);
        expect(text(result.stderr)).not.toContain(privatePayloadMarker);
      }
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full rejects a mode-0600 FIFO without waiting for a writer", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-fifo-guard-"));
    const dbPath = join(root, "projects.db");
    const fifoPath = join(root, "register-full.fifo");
    const created = Bun.spawnSync({
      cmd: ["mkfifo", "--", fifoPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(created.exitCode).toBe(0);
    chmodSync(fifoPath, 0o600);
    const proc = Bun.spawn({
      cmd: ["bun", "run", CLI_PATH, "register-full", "--input", fifoPath, "--json"],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: testSpawnEnv({ HASNA_PROJECTS_DB_PATH: dbPath }),
    });
    try {
      const terminal = await Promise.race([
        proc.exited.then((exitCode) => ({ state: "exited" as const, exitCode })),
        Bun.sleep(750).then(() => ({ state: "blocked" as const, exitCode: null })),
      ]);
      if (terminal.state === "blocked") proc.kill();
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(terminal).toEqual({ state: "exited", exitCode: 1 });
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        ok: false,
        outcome: "no_go",
        reason_code: "invalid_bounded_stdin_request",
        error: "register-full --input must reference a regular file",
      });
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      if (proc.exitCode === null) proc.kill();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full sanitizes malformed input-file JSON errors", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-malformed-file-"));
    const dbPath = join(root, "projects.db");
    const inputPath = join(root, "register-full.json");
    const privatePayloadMarker = "malformed-private-payload-must-not-be-echoed";
    writeFileSync(inputPath, `{"operation_id":"${privatePayloadMarker}",`, { mode: 0o600 });
    chmodSync(inputPath, 0o600);
    try {
      const result = runProjectsWithoutStdin(
        ["register-full", "--input", inputPath, "--json"],
        { HASNA_PROJECTS_DB_PATH: dbPath },
      );
      expect(result.exitCode).toBe(1);
      expect(text(result.stderr)).toBe("");
      expect(JSON.parse(text(result.stdout))).toMatchObject({
        ok: false,
        outcome: "no_go",
        reason_code: "invalid_bounded_stdin_request",
        error: "register-full --input file must contain valid JSON",
      });
      expect(text(result.stdout)).not.toContain(privatePayloadMarker);
      expect(text(result.stderr)).not.toContain(privatePayloadMarker);
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full accepts the closed orphan-authority reconciliation schema without serializing either path", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-authority-reconcile-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const sourceTargetPath = join(root, "deleted-source", "fleet-resources");
    const payload = JSON.stringify({
      operation_id: "op-cli-register-full-authority-recovery",
      project: {
        id: "wks_005285827590a93b70e5",
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
      },
      target_path: targetPath,
      goals_markdown: "# Goals\n\n- Reconcile every authority safely.\n",
      worklog_markdown: "# Worklog\n\n- Registration requested.\n",
      reconcile_existing: {
        conversations_channel: {
          source_operation_id: "op-cli-register-full",
          source_authority_identity: {
            route: "/v1/project-registration/channels",
            package_version: "0.5.36",
            authority_id: "conversations",
            corpus_id: "cor_historical",
          },
          target_id: "2bc0bf57-c08c-4c97-8d7b-631baf54c30a",
        },
        todos_project: {
          source_operation_id: "op-cli-register-full",
          source_authority_identity: {
            route: "/v1/project-registration/todos",
            package_version: "1.0.0-rc.3",
            authority_id: "todos",
            corpus_id: "cor_todos_historical",
          },
          target_id: "d736e48e-8267-4d91-b76d-9ab1d4015db8",
        },
        todos_task_list: {
          source_operation_id: "op-cli-register-full",
          source_authority_identity: {
            route: "/v1/project-registration/todos",
            package_version: "1.0.0-rc.3",
            authority_id: "todos",
            corpus_id: "cor_todos_historical",
          },
          target_id: "98a4f2df-1f4f-45d7-a85e-8c670f70daac",
        },
        mementos_project: {
          source_operation_id: "op-cli-register-full",
          source_authority_identity: {
            route: "/v1/project-registration/mementos",
            package_version: "0.14.79",
            authority_id: "mementos",
            corpus_id: "cor_mementos_historical",
          },
          target_id: "mm_project_f75606ef14e51fb577a15882ba0ab8ed333b2c29",
          source_target_path: sourceTargetPath,
        },
      },
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
      expect(text(result.stdout)).not.toContain(sourceTargetPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full rejects malformed orphan-channel reconciliation before authority preflight", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-reconcile-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const payload = JSON.stringify({
      operation_id: "op-cli-register-full-reconcile",
      project: {
        id: "wks_005285827590a93b70e5",
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
      },
      target_path: targetPath,
      goals_markdown: "# Goals\n\n- Reconcile safely.\n",
      worklog_markdown: "# Worklog\n\n- Registration requested.\n",
      reconcile_existing: {
        conversations_channel: {
          source_operation_id: "op-cli-register-full",
          target_id: 1012,
        },
      },
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
      expect(JSON.parse(text(result.stdout))).toMatchObject({
        ok: false,
        outcome: "no_go",
        reason_code: "invalid_bounded_stdin_request",
        error: "register-full reconcile_existing.conversations_channel.target_id must be a string",
      });
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full accepts the exact pre-bound channel adoption shape before authority preflight", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-prebound-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const projectId = "wks_preboundchannel0001";
    const zeroDigest = "0".repeat(64);
    const payload = JSON.stringify({
      operation_id: "op-cli-register-full-prebound",
      project: {
        id: projectId,
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
      },
      target_path: targetPath,
      goals_markdown: "# Goals\n\n- Reconcile safely.\n",
      worklog_markdown: "# Worklog\n\n- Registration requested.\n",
      reconcile_existing: {
        conversations_channel: {
          target_id: "chn_1012ddb87c8f033cb40fdead018cdfc8",
          expected_project_id: projectId,
          expected_revision: "rev_prebound_channel_001",
          expected_digest: zeroDigest,
          expected_message_ownership: {
            message_count: 0,
            first_message_id: null,
            last_message_id: null,
            message_ids_digest: zeroDigest,
            message_project_digest: zeroDigest,
            digest: zeroDigest,
            preserved_digest: zeroDigest,
          },
        },
      },
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
        reason_code?: string;
        dependencies: Array<{ dependency_task_id: string }>;
      };
      expect(body.ok).toBe(false);
      expect(body.outcome).toBe("no_go");
      expect(body.reason_code).not.toBe("invalid_bounded_stdin_request");
      expect(body.dependencies.map((item) => item.dependency_task_id).sort()).toEqual(
        Object.values(PROJECT_REGISTRATION_DEPENDENCY_TASKS).sort(),
      );
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full refuses a caller-supplied tenant in historical authority identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-historical-tenant-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const payload = JSON.stringify({
      operation_id: "op-cli-register-full-historical-tenant",
      project: {
        id: "wks_005285827590a93b70e5",
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
      },
      target_path: targetPath,
      goals_markdown: "# Goals\n\n- Reconcile safely.\n",
      worklog_markdown: "# Worklog\n\n- Registration requested.\n",
      reconcile_existing: {
        conversations_channel: {
          source_operation_id: "op-cli-register-full",
          source_authority_identity: {
            route: "/v1/project-registration/channels",
            package_version: "0.5.36",
            authority_id: "conversations",
            tenant_id: "tenant-other",
            corpus_id: "cor_historical",
          },
          target_id: "2bc0bf57-c08c-4c97-8d7b-631baf54c30a",
        },
      },
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
      expect(JSON.parse(text(result.stdout))).toMatchObject({
        ok: false,
        outcome: "no_go",
        reason_code: "invalid_bounded_stdin_request",
        error: "register-full reconcile_existing.conversations_channel.source_authority_identity requires only route, package_version, authority_id, and corpus_id",
      });
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("register-full passes both historical Todos identities to the shared-tuple validator", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-register-full-historical-todos-pair-"));
    const dbPath = join(root, "projects.db");
    const targetPath = join(root, "fleet-resources");
    const payload = JSON.stringify({
      operation_id: "op-cli-register-full-historical-todos-pair",
      project: {
        id: "wks_historicaltodospair01",
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
      },
      target_path: targetPath,
      goals_markdown: "# Goals\n\n- Reconcile safely.\n",
      worklog_markdown: "# Worklog\n\n- Registration requested.\n",
      reconcile_existing: {
        todos_project: {
          source_operation_id: "op-cli-register-full-source",
          source_authority_identity: {
            route: "/v1/project-registration/todos",
            package_version: "1.0.0-rc.3",
            authority_id: "todos",
            corpus_id: "cor_todos_historical",
          },
          target_id: "d736e48e-8267-4d91-b76d-9ab1d4015db8",
        },
        todos_task_list: {
          source_operation_id: "op-cli-register-full-source",
          source_authority_identity: {
            route: "/v1/project-registration/todos",
            package_version: "1.0.0-rc.4",
            authority_id: "todos",
            corpus_id: "cor_todos_historical",
          },
          target_id: "98a4f2df-1f4f-45d7-a85e-8c670f70daac",
        },
      },
    });
    try {
      const result = await runProjectsWithStdin(
        ["register-full", "--json"],
        payload,
        { HASNA_PROJECTS_DB_PATH: dbPath },
      );
      expect(result.exitCode).toBe(1);
      expect(text(result.stderr)).toBe("");
      expect(JSON.parse(text(result.stdout))).toMatchObject({
        ok: false,
        outcome: "no_go",
        reason_code: "invalid_bounded_stdin_request",
        error: "project registration reconcile_existing Todos entries must share one source_authority_identity",
      });
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(targetPath)).toBe(false);
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

  test("resource-link migration CLI preserves producer proof and event bounds in the hosted backend", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-resource-link-migration-"));
    const port = reserveFreePort();
    const projectId = "wks_climigrationproof01";
    const manifestId = `prlm_${"c".repeat(36)}`;
    const requests: Array<{
      method: string;
      path: string;
      query: string;
      body: Record<string, unknown> | null;
    }> = [];
    let state = "planned";
    let transitionVersion = 1;
    const response = () => ({
      ok: true,
      outcome: "accepted",
      manifest: {
        schema: "projects.project_resource_link_migration_manifest.v1",
        manifest_id: manifestId,
        project_id: projectId,
        operation_id: "cli-migration",
        step_id: "links",
        state,
        expected_project_revision: "revision-1",
        desired_collection_digest: "d".repeat(64),
        links: [],
        projects_forward_receipt_id: null,
        projects_inverse_receipt_id: null,
        projects_reference_proof: null,
        last_verified_projects_revision: null,
        last_verified_projects_digest: null,
        transition_version: transitionVersion,
        created_at: "2026-08-08T00:00:00.000Z",
        updated_at: "2026-08-08T00:00:00.000Z",
      },
      events: [],
      response_control: {
        response_byte_limit: 100_000,
        time_budget_ms: 5_000,
        response_bytes: 1,
        elapsed_ms: 0,
        complete: true,
        truncated: false,
      },
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(req) {
        const url = new URL(req.url);
        let body: Record<string, unknown> | null = null;
        try { body = (await req.json()) as Record<string, unknown>; } catch { body = null; }
        requests.push({
          method: req.method,
          path: url.pathname,
          query: url.search,
          body,
        });
        if (req.method === "POST" && url.pathname.endsWith("/advance")) {
          state = String(body?.next_state);
          transitionVersion = Number(body?.expected_transition_version) + 1;
          return Response.json(response());
        }
        if (req.method === "POST" && url.pathname.endsWith("/rollback")) {
          state = body?.producer_outcome === "complete" ? "rolled_back" : "rollback_in_progress";
          transitionVersion = Number(body?.expected_transition_version) + 1;
          return Response.json(response());
        }
        if (req.method === "GET") return Response.json(response());
        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_HOME: join(root, "home"),
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
    };
    const forwardProof = [{
      created_by_operation: true,
      forward_receipt_id: "producer-forward-receipt",
      child_link_receipt_ids: [],
      target_revision: "producer-revision-2",
      target_digest: "producer-digest-2",
      inverse_verified: null,
      inverse_outcome: null,
    }];
    const inverseProof = [{
      ...forwardProof[0]!,
      target_revision: "producer-revision-3",
      target_digest: "producer-digest-3",
      inverse_verified: true,
      inverse_outcome: "complete",
    }];
    try {
      const advance = await runProjectsAsync([
        "resource-link-migration-advance",
        projectId,
        "--manifest-id", manifestId,
        "--expected-transition-version", "1",
        "--next-state", "producer_applied",
        "--producer-evidence-json", JSON.stringify(forwardProof),
        "--evidence-json", JSON.stringify({ producer: "readback" }),
        "--max-items", "7",
        "--response-byte-limit", "100000",
        "--time-budget-ms", "5000",
        "--json",
      ], env);
      expect(advance.exitCode).toBe(0);

      const rollback = await runProjectsAsync([
        "resource-link-migration-rollback",
        projectId,
        "--manifest-id", manifestId,
        "--expected-transition-version", "2",
        "--producer-outcome", "complete",
        "--producer-evidence-json", JSON.stringify(inverseProof),
        "--evidence-json", JSON.stringify({ producer_inverse: "verified" }),
        "--max-items", "5",
        "--response-byte-limit", "100000",
        "--time-budget-ms", "5000",
        "--json",
      ], env);
      expect(rollback.exitCode).toBe(0);

      const writes = requests.filter((request) => request.method === "POST");
      expect(writes).toHaveLength(2);
      expect(writes[0]?.body).toMatchObject({
        project_id: projectId,
        manifest_id: manifestId,
        max_items: 7,
        producer_evidence: forwardProof,
      });
      expect(writes[1]?.body).toMatchObject({
        project_id: projectId,
        manifest_id: manifestId,
        max_items: 5,
        producer_evidence: inverseProof,
      });
      const reads = requests.filter((request) => request.method === "GET");
      expect(reads.map((request) => request.query)).toEqual([
        "?max_items=7&response_byte_limit=100000&time_budget_ms=5000",
        "?max_items=5&response_byte_limit=100000&time_budget_ms=5000",
      ]);
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  cliProcessTest("prompt flags cannot hijack delete dispatch and delete requires a target", () => {
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
  cliProcessTest("reports serve defaults to loopback and keeps existing project registry semantics", async () => {
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

  cliProcessTest("agent-assist CLI commands emit JSON, agent text, and run detail by default", () => {
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

  test("where reports the canonical machine/path and every registered mirror", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-where-"));
    const dbPath = join(root, "projects.db");
    const projectPath = join(root, "hasna-mailery-2");
    const mirrorPath = join(root, "mirror", "hasna-mailery-2");
    const env = { HASNA_PROJECTS_DB_PATH: dbPath };
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);
    const project = createWorkspace({
      name: "Hasna Mailery 2",
      slug: "hasna-mailery-2",
      primary_path: projectPath,
    }, db);
    db.run("UPDATE workspaces SET canonical_machine = ? WHERE id = ?", ["spark02", project.id]);
    db.run("DELETE FROM workspace_locations WHERE workspace_id = ?", [project.id]);
    db.run(
      `INSERT INTO workspace_locations
        (id, workspace_id, path, machine_id, label, kind, is_primary, exists_at_create, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, 'local', 1, 1, '{}', datetime('now')),
              (?, ?, ?, ?, ?, 'local', 0, 1, '{}', datetime('now'))`,
      [
        "loc_where_canonical", project.id, projectPath, "spark02", "main",
        "loc_where_mirror", project.id, mirrorPath, "spark01", "mirror",
      ],
    );
    db.close();

    try {
      const jsonResult = runProjects(["where", "hasna-mailery-2", "--json"], env);
      expect(jsonResult.exitCode).toBe(0);
      const payload = JSON.parse(text(jsonResult.stdout)) as {
        canonical_machine: string;
        canonical_path: string;
        mirrors: Array<{ machine: string; path: string; label: string }>;
        locations: Array<{ machine: string; path: string; label: string; role: string }>;
      };
      expect(payload.canonical_machine).toBe("spark02");
      expect(payload.canonical_path).toBe(projectPath);
      expect(payload.mirrors).toEqual([{ machine: "spark01", path: mirrorPath, label: "mirror" }]);
      expect(payload.locations).toEqual([
        { machine: "spark02", path: projectPath, label: "canonical", role: "canonical" },
        { machine: "spark01", path: mirrorPath, label: "mirror", role: "mirror" },
      ]);

      const human = runProjects(["where", "hasna-mailery-2"], env);
      expect(human.exitCode).toBe(0);
      expect(text(human.stdout)).toContain(`canonical\tspark02\t${projectPath}`);
      expect(text(human.stdout)).toContain(`mirror\tspark01\t${mirrorPath}\tmirror`);

      const agent = runProjects(["where", "hasna-mailery-2", "--for-agent"], env);
      expect(agent.exitCode).toBe(0);
      expect(text(agent.stdout)).toContain("canonical_machine: spark02");
      expect(text(agent.stdout)).toContain(`machine=spark01 path=${mirrorPath} label=mirror`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("assign-machines balances active projects, uses activity, and preserves pins", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-assign-machines-"));
    const dbPath = join(root, "projects.db");
    const env = { HASNA_PROJECTS_DB_PATH: dbPath };
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);
    const projects = Array.from({ length: 9 }, (_, index) => createWorkspace({
      name: `Machine Fixture ${index}`,
      slug: `machine-fixture-${index}`,
      primary_path: join(root, `project-${index}`),
    }, db));
    db.run("UPDATE workspaces SET canonical_machine = 'machine001' WHERE id = ?", [projects[0]!.id]);
    db.run("UPDATE workspaces SET canonical_machine = 'spark02' WHERE id = ?", [projects[1]!.id]);
    db.run("UPDATE workspaces SET last_opened_at = '2026-07-29 12:00:00' WHERE id = ?", [projects[8]!.id]);
    db.run(
      `INSERT INTO agent_runs
        (id, workspace_id, prompt, status, tool_calls_json, metadata, started_at)
       VALUES ('run_machine_fixture', ?, 'fixture', 'completed', '[]', '{}', '2026-07-29 12:01:00')`,
      [projects[8]!.id],
    );
    db.close();

    try {
      const dryRun = runProjects(["assign-machines", "--pool", "machine001,machine002,machine003", "--dry-run", "--json"], env);
      expect(dryRun.exitCode).toBe(0);
      const plan = JSON.parse(text(dryRun.stdout)) as {
        dry_run: boolean;
        pool_counts: Record<string, number>;
        assignments: Array<{
          slug: string;
          previous_machine: string | null;
          canonical_machine: string;
          pinned: boolean;
          activity: { run_count: number; last_opened_at: string | null };
        }>;
      };
      expect(plan.dry_run).toBe(true);
      expect(plan.assignments.find((item) => item.slug === "machine-fixture-0")).toMatchObject({
        previous_machine: "machine001",
        canonical_machine: "machine001",
        pinned: true,
      });
      expect(plan.assignments.find((item) => item.slug === "machine-fixture-1")).toMatchObject({
        previous_machine: "spark02",
        pinned: false,
        changed: true,
      });
      const fixture1 = plan.assignments.find((item) => item.slug === "machine-fixture-1");
      expect(fixture1).toBeDefined();
      expect(["machine001", "machine002", "machine003"]).toContain(fixture1!.canonical_machine);
      expect(plan.assignments.find((item) => item.slug === "machine-fixture-8")?.activity).toMatchObject({
        run_count: 1,
        last_opened_at: "2026-07-29 12:00:00",
      });
      const plannedCounts = Object.values(plan.pool_counts);
      expect(Math.max(...plannedCounts) - Math.min(...plannedCounts)).toBeLessThanOrEqual(1);

      const afterDryRun = new Database(dbPath);
      expect((afterDryRun.query("SELECT canonical_machine FROM workspaces WHERE id = ?").get(projects[8]!.id) as { canonical_machine: string | null }).canonical_machine).toBeNull();
      afterDryRun.close();

      const apply = runProjects(["assign-machines", "--pool", "machine001,machine002,machine003", "--json"], env);
      expect(apply.exitCode).toBe(0);
      expect((JSON.parse(text(apply.stdout)) as { dry_run: boolean }).dry_run).toBe(false);

      const afterApply = new Database(dbPath);
      const rows = afterApply.query("SELECT slug, canonical_machine FROM workspaces ORDER BY slug").all() as Array<{ slug: string; canonical_machine: string | null }>;
      afterApply.close();
      expect(rows.find((row) => row.slug === "machine-fixture-0")?.canonical_machine).toBe("machine001");
      expect(rows.find((row) => row.slug === "machine-fixture-1")?.canonical_machine).not.toBe("spark02");
      expect(rows.every((row) => ["machine001", "machine002", "machine003"].includes(row.canonical_machine ?? ""))).toBe(true);
      const appliedCounts = ["machine001", "machine002", "machine003"].map((machine) => rows.filter((row) => row.canonical_machine === machine).length);
      expect(Math.max(...appliedCounts) - Math.min(...appliedCounts)).toBeLessThanOrEqual(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("assign-machines rejects unknown pool machines before any write path", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-assign-machines-unknown-"));
    const dbPath = join(root, "projects.db");
    const env = { HASNA_PROJECTS_DB_PATH: dbPath };
    const db = new Database(dbPath);
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);
    const project = createWorkspace({
      name: "Machine Fixture Unknown",
      slug: "machine-fixture-unknown",
      primary_path: join(root, "project-unknown"),
    }, db);
    db.close();

    try {
      const dryRun = runProjects(["assign-machines", "--pool", "machine001,ghost,machine002", "--dry-run", "--json"], env);
      expect(dryRun.exitCode).toBe(1);
      expect(text(dryRun.stderr)).toContain("Unknown machine");
      expect(text(dryRun.stderr)).toContain("ghost");

      const apply = runProjects(["assign-machines", "--pool", "machine001,ghost,machine002", "--json"], env);
      expect(apply.exitCode).toBe(1);
      expect(text(apply.stderr)).toContain("Unknown machine");

      const after = new Database(dbPath);
      const row = after.query("SELECT canonical_machine FROM workspaces WHERE id = ?").get(project.id) as { canonical_machine: string | null };
      after.close();
      expect(row.canonical_machine).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  cliProcessTest("top-level create, list, and show use project-first JSON", () => {
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

  cliProcessTest("guarded-read returns a bounded exact-id revision envelope and rejects non-id targets", () => {
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

  cliProcessTest("typed resource links and duplicate quarantine execute and roll back through the CLI", async () => {
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
      const create = await runWorkspaceCommandInProcess([
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
      const add = await runWorkspaceCommandInProcess(addArgs, env);
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

      const duplicate = await runWorkspaceCommandInProcess(addArgs, env);
      expect(duplicate.exitCode).toBe(0);
      expect((JSON.parse(text(duplicate.stdout)) as { outcome: string }).outcome).toBe("duplicate_of_accepted");

      const read = await runWorkspaceCommandInProcess([
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
      const reconcile = await runWorkspaceCommandInProcess([
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

      const rollback = await runWorkspaceCommandInProcess([
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

      const guarded = await runWorkspaceCommandInProcess([
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

      const quarantineRead = await runWorkspaceCommandInProcess([
        "duplicate-quarantine-read",
        created.project.id,
        "--resource-link-max-items",
        "10",
        "--workspace-location-max-items",
        "10",
        "--response-byte-limit",
        "100000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(quarantineRead.exitCode).toBe(0);
      const preimage = JSON.parse(text(quarantineRead.stdout)) as {
        current_revision: string;
        resource_link_count: number;
        workspace_location_count: number;
        snapshot: {
          project_digest: string;
          resource_link_collection_digest: string;
          resource_links: Array<{ id: string }>;
          workspace_location_collection_digest: string;
          workspace_locations: Array<{ id: string }>;
        };
      };
      expect(preimage).toMatchObject({
        resource_link_count: 4,
        workspace_location_count: 1,
      });

      const quarantineArgs = (
        operationId: string,
        expectedRevision: string,
        extra: string[] = [],
      ) => [
        "duplicate-quarantine",
        created.project.id,
        "--operation-id",
        operationId,
        "--step-id",
        "retire-duplicate",
        "--expected-revision",
        expectedRevision,
        "--expected-project-digest",
        preimage.snapshot.project_digest,
        "--expected-resource-link-collection-digest",
        preimage.snapshot.resource_link_collection_digest,
        "--expected-resource-link-ids-json",
        JSON.stringify(preimage.snapshot.resource_links.map((link) => link.id)),
        "--resource-link-max-items",
        "10",
        "--expected-workspace-location-collection-digest",
        preimage.snapshot.workspace_location_collection_digest,
        "--expected-workspace-location-ids-json",
        JSON.stringify(preimage.snapshot.workspace_locations.map((location) => location.id)),
        "--workspace-location-max-items",
        "10",
        "--quarantine-name",
        "Typed Links duplicate provenance",
        "--quarantine-slug",
        "typed-links-duplicate-provenance",
        "--response-byte-limit",
        "100000",
        "--time-budget-ms",
        "5000",
        "--json",
        ...extra,
      ];
      const staleDryRunArgs = quarantineArgs(
        "cli-duplicate-quarantine-stale-dry-run",
        "2026-01-01 00:00:00",
        ["--dry-run"],
      );
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const staleDryRun = await runWorkspaceCommandInProcess(staleDryRunArgs, env);
        expect(staleDryRun.exitCode).toBe(0);
        expect(JSON.parse(text(staleDryRun.stdout))).toMatchObject({
          ok: false,
          dry_run: true,
          outcome: "terminal_nonacceptance",
          receipt: null,
          rollback: null,
        });
      }
      const staleApplied = await runWorkspaceCommandInProcess(
        quarantineArgs(
          "cli-duplicate-quarantine-stale-dry-run",
          "2026-01-01 00:00:00",
        ),
        env,
      );
      expect(staleApplied.exitCode).toBe(0);
      expect(JSON.parse(text(staleApplied.stdout))).toMatchObject({
        ok: false,
        dry_run: false,
        outcome: "terminal_nonacceptance",
        receipt: {
          operation_id: "cli-duplicate-quarantine-stale-dry-run",
          reason: "stale_revision",
        },
        rollback: null,
      });

      const quarantine = await runWorkspaceCommandInProcess(
        quarantineArgs("cli-duplicate-quarantine", preimage.current_revision),
        env,
      );
      expect(quarantine.exitCode).toBe(0);
      const quarantined = JSON.parse(text(quarantine.stdout)) as {
        outcome: string;
        after: { project: { status: string; integrations: Record<string, string> }; resource_links: unknown[]; workspace_locations: unknown[] };
        receipt: { receipt_id: string };
        rollback: { expected_current_revision: string };
      };
      expect(quarantined).toMatchObject({
        outcome: "accepted",
        after: {
          project: { status: "archived", integrations: {} },
          resource_links: [],
          workspace_locations: [],
        },
      });

      const quarantineRollback = await runWorkspaceCommandInProcess([
        "duplicate-quarantine-rollback",
        created.project.id,
        "--operation-id",
        "cli-duplicate-quarantine-rollback",
        "--step-id",
        "restore-duplicate",
        "--accepted-receipt-id",
        quarantined.receipt.receipt_id,
        "--expected-current-revision",
        quarantined.rollback.expected_current_revision,
        "--resource-link-max-items",
        "10",
        "--workspace-location-max-items",
        "10",
        "--response-byte-limit",
        "100000",
        "--time-budget-ms",
        "5000",
        "--json",
      ], env);
      expect(quarantineRollback.exitCode).toBe(0);
      expect(JSON.parse(text(quarantineRollback.stdout))).toMatchObject({
        outcome: "accepted",
        after: {
          project: { status: "active" },
          resource_links: expect.arrayContaining([expect.objectContaining({ authority: "conversations" })]),
          workspace_locations: expect.arrayContaining([expect.objectContaining({ is_primary: true })]),
        },
      });
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
      // The contacts key resolves through the shared @hasna/contracts seam,
      // whose deliberate-override tier outranks the fleet app-config file on
      // disk. The plain HASNA_CONTACTS_API_KEY legacy tier would lose to that
      // disk credential on machines that have one, sending the real key to
      // this test server instead of the test key.
      HASNA_CONTACTS_API_KEY_OVERRIDE: "test-contact-key",
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

  cliProcessTest("guarded rollback restores a remote-only project and leaves its forward path non-primary", () => {
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

  cliProcessTest("top-level list hides eval fixtures by default and cleanup-evals removes them", () => {
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

  cliProcessTest("top-level create, list, show, and update expose project management fields", () => {
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

  cliProcessTest("top-level events list and record expose project audit events", () => {
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

  test("events record POSTs the event to the hosted /v1 API in the hosted backend", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-events-cloud-"));
    const requests: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        requests.push({ method: req.method, path: url.pathname });
        if (req.method === "POST" && url.pathname === "/v1/projects/wks_evt1/events") {
          return Response.json({ event: { id: "evt_c1", workspace_id: "wks_evt1", event_type: "custom_event", source: "cli", prompt: null, command: null, before_json: null, after_json: null, metadata: {}, created_at: "2026-08-01 00:00:00" } }, { status: 201 });
        }
        if (req.method === "GET" && url.pathname === "/v1/projects/wks_evt1") {
          return Response.json({ id: "wks_evt1", slug: "evented-app", name: "Evented App", kind: "generic", status: "active", primary_path: null, tags: [], integrations: {}, metadata: {} });
        }
        return Response.json({}, { status: 404 });
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
    };
    try {
      const record = await runProjectsAsync([
        "events",
        "record",
        "wks_evt1",
        "custom_event",
        "--prompt",
        "x",
        "--json",
      ], env);

      expect(record.exitCode).toBe(0);
      const stdout = text(record.stdout);
      expect(stdout).toContain("custom_event");
      expect(requests).toEqual([
        { method: "GET", path: "/v1/projects/wks_evt1" },
        { method: "POST", path: "/v1/projects/wks_evt1/events" },
      ]);
    } finally {
      server.stop();
    }
  });

  cliProcessTest("project agents can be assigned and shown as project metadata", () => {
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

  cliProcessTest("update --canonical-machine replaces metadata ownership and round-trips through show", () => {
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

  cliProcessTest("project locations can be registered and used as start targets", () => {
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

  cliProcessTest("top-level start supports bulk dry-run JSON summaries", () => {
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

  cliProcessTest("top-level start reads bulk targets from JSON files", () => {
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

  cliProcessTest("top-level start and status use saved project launch defaults", () => {
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

  cliProcessTest("top-level start records when the project was last opened", () => {
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

  cliProcessTest("top-level start accepts exact requested tmux windows as JSON", () => {
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

  cliProcessTest("top-level status reports expected project tmux session", () => {
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

  cliProcessTest("top-level sessions with no target reports recent sessions instead of failing", () => {
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


  cliProcessTest("required commands emit JSON Render specs with --render-spec", () => {
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

  test("create --dry-run previews only and never persists in the hosted backend", async () => {
    // Regression: `projects create --dry-run` in the hosted backend used to route
    // straight to the hosted backend and POST a new project row, persisting a
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
          // A real hosted create would persist and return the new row.
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
      HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
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
      // The dry-run must not have issued any create write to the hosted backend.
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

  test("why reports verified API path diagnostics and keeps an absent path unresolved", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-api-why-path-"));
    const projectsHome = join(root, "home");
    const projectId = "wks_apiwhypath000001";
    const projectPath = join(projectsHome, "workspaces", projectId);
    const absentPath = join(projectsHome, "workspaces", "wks_apiwhyabsent001");
    mkdirSync(projectPath, { recursive: true });
    const project = {
      id: projectId,
      slug: "api-why-path",
      name: "API Why Path",
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
      created_at: "2026-08-10 00:00:00",
      updated_at: "2026-08-10 00:00:01",
      synced_at: null,
    };
    const port = reserveFreePort();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === `/v1/projects/${projectId}`) {
          return Response.json(project);
        }
        if (req.method === "GET" && url.pathname === "/v1/projects") {
          return Response.json({ workspaces: [] });
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    const env = {
      HASNA_PROJECTS_DB_PATH: join(root, "projects.db"),
      HASNA_PROJECTS_HOME: projectsHome,
      HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
      HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
    };
    const runWhy = async (target: string) => {
      const proc = Bun.spawn({
        cmd: ["bun", "run", CLI_PATH, "why", target, "--json"],
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

    try {
      const present = await runWhy(projectPath);
      expect(present.exitCode).toBe(0);
      expect(present.stderr).toBe("");
      const presentPayload = JSON.parse(present.stdout) as {
        resolved: boolean;
        resolution?: { source: string };
        steps: Array<{ source: string; tried: boolean; matched: boolean; detail: string }>;
      };
      expect(presentPayload.resolved).toBe(true);
      expect(presentPayload.resolution?.source).toBe("path");
      const presentPathStep = presentPayload.steps.find((step) => step.source === "path");
      expect(presentPathStep).toMatchObject({
        tried: true,
        matched: true,
      });
      expect(presentPathStep?.detail).toContain(`matched ${project.slug} (${project.id}) by verified canonical path ${projectPath}`);

      const absent = await runWhy(absentPath);
      expect(absent.exitCode).toBe(0);
      expect(absent.stderr).toBe("");
      const absentPayload = JSON.parse(absent.stdout) as {
        resolved: boolean;
        resolution?: unknown;
        steps: Array<{ source: string; tried: boolean; matched: boolean; detail: string }>;
      };
      expect(absentPayload.resolved).toBe(false);
      expect(absentPayload.resolution).toBeUndefined();
      const absentPathStep = absentPayload.steps.find((step) => step.source === "path");
      expect(absentPathStep).toMatchObject({
        tried: true,
        matched: false,
      });
      expect(absentPathStep?.detail).toBe("no verified canonical workspace path match in the hosted backend");
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
      HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
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

  test("channel --ensure succeeds in the hosted backend even when the events route 404s, and is idempotent", async () => {
    // Regression (issue #28): `projects channel <p> --ensure` created the
    // conversations channel and persisted `integrations.conversations_channel`,
    // then exited 1 with a raw
    // `Hasna request failed: POST /projects/<id>/events -> 404` because the
    // audit-event POST is not served by the hosted backend API. Agents therefore treated
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
      HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
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

  test("create in the hosted backend honors registry flags and refuses machine-local runtime flags before creating a row", async () => {
    // Regression (issue #27): the hosted backend branch of `projects create` passed
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
      HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
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
      // 1. Machine-local runtime flags must be honored in the hosted backend: the
      //    hosted row is created through the Store and the runtime half (mkdir,
      //    marker, tmux) is applied on the invoking machine, with one
      //    creation_executed event recorded on the hosted project.
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "tmux"), "#!/usr/bin/env bun\n", "utf-8");
      chmodSync(join(binDir, "tmux"), 0o755);
      const runtimeEnv = {
        ...env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      };
      const runRuntimeCreate = async (args: string[]) => {
        const proc = Bun.spawn({
          cmd: ["bun", "run", CLI_PATH, "create", "--name", "Cloud Flag Probe", ...args],
          stdout: "pipe",
          stderr: "pipe",
          env: testSpawnEnv(runtimeEnv),
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;
        return { exitCode: proc.exitCode, stdout, stderr };
      };
      const applied = await runRuntimeCreate([
        "--path", targetPath,
        "--mkdir",
        "--marker",
        "--tmux-session", "cloud-flag-probe",
        "--json",
      ]);
      expect(applied.exitCode).toBe(0);
      expect(requests.filter((r) => r.method === "POST" && r.path === "/v1/projects")).toHaveLength(1);
      expect(existsSync(join(targetPath, ".project.json"))).toBe(true);
      expect(requests.some((r) => r.method === "POST" && r.path === "/v1/projects/wks_cloudcreateflags0001/events")).toBe(true);
      expect(applied.stdout).toContain("cloud-flag-probe");

      // 2. Registry-level flags must be forwarded to the hosted create, not dropped.
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
      // One create from the runtime-flags run above, one from this run.
      expect(creates).toHaveLength(2);
      const body = creates.at(-1)!.body as {
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

  test("create in the hosted backend derives the same primary_path and channel the dry-run plan promises", async () => {
    // Regression: `projects create --dry-run` reported a canonical
    // `primary_path` and a derived `integrations.conversations_channel`, and the
    // identical real create in the hosted backend produced `primary_path: null` and
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
      HASNA_PROJECTS_API_KEY_OVERRIDE: "test-key",
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

describe("projects store resolution fails closed without hosted API env", () => {
  test("a registry command without the hosted API env exits non-zero, names the required env, and creates no local db", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-fail-closed-"));
    const dbPath = join(root, "never-created.db");
    // Explicitly decline the test harness's local-registry opt-in: this run
    // must NOT fall back to the on-box SQLite registry.
    const env = {
      HASNA_PROJECTS_DB_PATH: dbPath,
      HASNA_PROJECTS_HOME: join(root, "home"),
      [PROJECTS_LOCAL_REGISTRY_ENV]: "",
    };

    const result = runProjects(["roots", "list", "--json"], env);

    expect(result.exitCode).not.toBe(0);
    const stderr = text(result.stderr);
    expect(stderr).toContain("HASNA_PROJECTS_API_URL");
    expect(stderr).toContain("HASNA_PROJECTS_API_KEY");
    expect(stderr).toContain("no silent local fallback");
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(join(root, "home"))).toBe(false);
  });

  test("the same registry command works when the local registry is explicitly opted into", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-cli-local-opt-in-"));
    const dbPath = join(root, "opted.db");
    const env = { HASNA_PROJECTS_DB_PATH: dbPath, [PROJECTS_LOCAL_REGISTRY_ENV]: "1" };

    const result = runProjects(["roots", "list", "--json"], env);

    expect(result.exitCode).toBe(0);
    expect(existsSync(dbPath)).toBe(true);
  });
});
