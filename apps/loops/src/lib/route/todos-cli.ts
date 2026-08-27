import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { redact } from "../format.js";
import { dataDir } from "../paths.js";

/** Local `todos` CLI transport used by route drains and route-tasks commands. */

export function defaultLoopsProject(): string {
  return process.env.LOOPS_TASK_PROJECT || dataDir();
}

export function defaultTodosProject(): string | undefined {
  return process.env.LOOPS_TASK_PROJECT?.trim() || undefined;
}

export function todosCliArgs(project: string | undefined, args: string[]): string[] {
  const value = project?.trim();
  return value ? ["--project", value, ...args] : args;
}

export interface LocalCommandResult {
  ok: boolean;
  /**
   * `undefined` is reachable and is NOT the same as `null`. Measured on bun 1.3.14:
   * `spawnSync` reports a missing binary (ENOENT) and a non-executable file
   * (EACCES) as `status: undefined`, while a timeout kill (ETIMEDOUT), a maxBuffer
   * overflow (ENOBUFS) and a signal kill report `status: null`. Declaring only
   * `number | null` let TypeScript narrow `typeof status !== "number"` down to
   * `null`, which tells a reader the ENOENT branch is dead code and invites
   * "simplifying" it to `=== null` — reintroducing a silent drop for the most
   * likely misconfiguration. Callers must treat any non-number as "no answer".
   */
  status: number | null | undefined;
  stdout: string;
  stderr: string;
  error: string;
}

export function runLocalCommand(command: string, args: string[], opts: { input?: string; timeoutMs?: number; maxBuffer?: number } = {}): LocalCommandResult {
  const result = spawnSync(command, args, {
    input: opts.input,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 30_000,
    maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error.message || result.error) : "",
  };
}

export function runLocalCommandWithStdoutFile(
  command: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number; maxBuffer?: number } = {},
): LocalCommandResult {
  const tempDir = mkdtempSync(join(tmpdir(), "loops-command-output-"));
  const stdoutPath = join(tempDir, "stdout");
  const stdoutFd = openSync(stdoutPath, "w");
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(command, args, {
      input: opts.input,
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
      env: process.env,
      stdio: ["pipe", stdoutFd, "pipe"],
    });
  } finally {
    closeSync(stdoutFd);
  }
  try {
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: typeof result.stderr === "string" ? result.stderr : result.stderr?.toString() || "",
      error: result.error ? String(result.error.message || result.error) : "",
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function ensureTodosTaskList(project: string, slug: string, name: string, description: string): string {
  // Create-if-absent: a blind `task-lists --add` on every call minted one
  // duplicate list per firing (247 'Loop Error Self Heal' lists in the fleet
  // store, 2026-06-26..2026-07-07). Resolve the existing list by slug first and
  // only issue --add when it is genuinely absent.
  const list = runLocalCommand("todos", ["--project", project, "--json", "task-lists"]);
  if (!list.ok) throw new Error(list.stderr || list.error || "failed to list todos task lists");
  const values = JSON.parse(list.stdout || "[]") as Array<{ id: string; slug: string }>;
  const existing = values.find((entry) => entry.slug === slug);
  if (existing) return existing.id;
  runLocalCommand("todos", ["--project", project, "task-lists", "--add", name, "--slug", slug, "-d", description]);
  const refreshed = runLocalCommand("todos", ["--project", project, "--json", "task-lists"]);
  if (!refreshed.ok) throw new Error(refreshed.stderr || refreshed.error || "failed to list todos task lists");
  const refreshedValues = JSON.parse(refreshed.stdout || "[]") as Array<{ id: string; slug: string }>;
  const found = refreshedValues.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`todos task list not found after ensure: ${slug}`);
  return found.id;
}

export function todosMutationSummary(result: LocalCommandResult): Record<string, unknown> {
  return {
    ok: result.ok,
    status: result.status,
    error: result.ok ? undefined : redact(result.stderr || result.error || "todos mutation failed", 320),
  };
}
