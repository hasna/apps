import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { FeedbackItem, FeedbackTaskRef } from "./types.js";

/**
 * Task sink: the wire that turns a piece of feedback into a task an executor
 * can actually pick up.
 *
 * This lives in the create path rather than in an out-of-process event channel
 * on purpose. Channel config is machine-local state that a fresh install does
 * not inherit, and feedback event emission is deliberately best-effort — so a
 * channel-based wire is invisible when it is missing and silent when it fails.
 * A sink compiled into `createFeedback` is present wherever the package is,
 * and its failures are recorded on the feedback item (see `taskError`) instead
 * of being swallowed.
 */

export type FeedbackTaskSinkKind = "todos" | "command" | "none" | "invalid";
export type FeedbackTaskSinkRequest = "auto" | FeedbackTaskSinkKind;

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { input?: string; timeoutMs?: number },
) => Promise<CommandResult>;

/** Upper bound on how long task creation may block the capture path. */
export const DEFAULT_TASK_TIMEOUT_MS = 15_000;

export interface FeedbackTaskDraft {
  title: string;
  description: string;
  priority: string;
  tags: string[];
  project?: string;
}

export interface FeedbackTaskSink {
  readonly provider: string;
  createTask(item: FeedbackItem): Promise<FeedbackTaskRef>;
}

export interface FeedbackTaskSinkConfig {
  /** What the operator asked for (`auto` unless FEEDBACK_TASK_SINK is set). */
  requested: FeedbackTaskSinkRequest;
  /** What will actually run. */
  kind: FeedbackTaskSinkKind;
  binary: string | null;
  command: string[] | null;
  tags: string[];
  priorityMap: Record<string, string>;
  timeoutMs: number;
  blockers: string[];
  projectFor(appId: string): string | undefined;
}

export interface FeedbackTaskSinkRuntime {
  requested: FeedbackTaskSinkRequest;
  kind: FeedbackTaskSinkKind;
  provider: string | null;
  enabled: boolean;
  ok: boolean;
  binary: string | null;
  blockers: string[];
}

export const FEEDBACK_TASK_TAG = "feedback";

const DEFAULT_TODOS_BINARY = "todos";

/** Severity → task priority. Overridable via FEEDBACK_TASK_PRIORITY_MAP. */
const DEFAULT_PRIORITY_MAP: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "critical",
};

/**
 * A report with no severity still has to land somewhere sensible: a bug is
 * assumed to matter, anything else is assumed not to until a human says so.
 */
const PRIORITY_WITHOUT_SEVERITY: Record<string, string> = {
  bug: "medium",
};
const FALLBACK_PRIORITY = "low";

export function findBinaryOnPath(command: string, pathValue = process.env["PATH"]): string | null {
  if (command.includes("/")) return existsSync(command) ? command : null;
  for (const dir of (pathValue ?? "").split(delimiter).filter(Boolean)) {
    const filePath = join(dir, command);
    if (!existsSync(filePath)) continue;
    try {
      statSync(filePath);
      return filePath;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

function parseJsonEnv(
  raw: string | undefined,
  name: string,
  blockers: string[],
): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      blockers.push(`${name} must be a JSON object.`);
      return {};
    }
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
  } catch {
    blockers.push(`${name} is not valid JSON.`);
    return {};
  }
}

function parseCommandEnv(raw: string | undefined, blockers: string[]): string[] | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== "string")) {
        blockers.push("FEEDBACK_TASK_COMMAND JSON must be a non-empty array of strings.");
        return null;
      }
      return parsed as string[];
    } catch {
      blockers.push("FEEDBACK_TASK_COMMAND is not valid JSON.");
      return null;
    }
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.length ? parts : null;
}

function parseTimeoutEnv(raw: string | undefined, blockers: string[]): number {
  if (!raw?.trim()) return DEFAULT_TASK_TIMEOUT_MS;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    blockers.push("FEEDBACK_TASK_TIMEOUT_MS must be a positive integer number of milliseconds.");
    return DEFAULT_TASK_TIMEOUT_MS;
  }
  return parsed;
}

function parseListEnv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function requestedKind(raw: string | undefined): FeedbackTaskSinkRequest | null {
  const value = (raw ?? "auto").trim().toLowerCase();
  if (!value || value === "auto") return "auto";
  if (value === "todos") return "todos";
  if (value === "command") return "command";
  if (value === "none" || value === "off" || value === "disabled") return "none";
  return null;
}

export interface ResolveTaskSinkOptions {
  env?: Record<string, string | undefined>;
  findBinary?: (command: string) => string | null;
}

export function resolveTaskSinkConfig(options: ResolveTaskSinkOptions = {}): FeedbackTaskSinkConfig {
  const env = options.env ?? process.env;
  const findBinary = options.findBinary ?? ((command: string) => findBinaryOnPath(command, env["PATH"]));
  const blockers: string[] = [];

  const rawRequest = env["FEEDBACK_TASK_SINK"];
  const request = requestedKind(rawRequest);
  const priorityMap = { ...DEFAULT_PRIORITY_MAP, ...parseJsonEnv(env["FEEDBACK_TASK_PRIORITY_MAP"], "FEEDBACK_TASK_PRIORITY_MAP", blockers) };
  const projectMap = parseJsonEnv(env["FEEDBACK_TASK_PROJECT_MAP"], "FEEDBACK_TASK_PROJECT_MAP", blockers);
  const defaultProject = env["FEEDBACK_TASK_PROJECT"]?.trim() || undefined;
  const tags = parseListEnv(env["FEEDBACK_TASK_TAGS"]);
  const command = parseCommandEnv(env["FEEDBACK_TASK_COMMAND"], blockers);
  const binaryName = env["FEEDBACK_TASK_BIN"]?.trim() || DEFAULT_TODOS_BINARY;
  const timeoutMs = parseTimeoutEnv(env["FEEDBACK_TASK_TIMEOUT_MS"], blockers);

  const projectFor = (appId: string): string | undefined => projectMap[appId] ?? defaultProject;

  if (request === null) {
    // Deliberately does not echo the configured value: doctor output is
    // pasted into tasks and channels, and env values can carry credentials.
    blockers.push('Unsupported FEEDBACK_TASK_SINK value. Use "auto", "todos", "command", or "none".');
    return { requested: "auto", kind: "invalid", binary: null, command, tags, priorityMap, timeoutMs, blockers, projectFor };
  }

  if (request === "none") {
    return { requested: request, kind: "none", binary: null, command, tags, priorityMap, timeoutMs, blockers, projectFor };
  }

  if (request === "command") {
    if (!command) blockers.push("FEEDBACK_TASK_SINK=command requires FEEDBACK_TASK_COMMAND.");
    return { requested: request, kind: "command", binary: null, command, tags, priorityMap, timeoutMs, blockers, projectFor };
  }

  const binary = findBinary(binaryName);

  if (request === "todos") {
    if (!binary) {
      blockers.push(
        `FEEDBACK_TASK_SINK=todos but the ${JSON.stringify(binaryName)} binary was not found on PATH.`,
      );
    }
    return { requested: request, kind: "todos", binary, command, tags, priorityMap, timeoutMs, blockers, projectFor };
  }

  // auto: use todos when it is genuinely available, otherwise stay out of the
  // way. An OSS install without the todos CLI must not fail every submit.
  return {
    requested: "auto",
    kind: binary ? "todos" : "none",
    binary,
    command,
    tags,
    priorityMap,
    timeoutMs,
    blockers,
    projectFor,
  };
}

function summarize(message: string, max = 120): string {
  const line = message.split("\n", 1)[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function detailLines(item: FeedbackItem): string[] {
  const lines: string[] = [];
  const push = (label: string, value: unknown): void => {
    if (value === undefined || value === null || value === "") return;
    lines.push(`- ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  };
  push("feedback id", item.id);
  push("app", item.appId);
  push("kind", item.kind);
  push("severity", item.severity);
  push("status", item.status);
  push("source", item.source);
  push("reported at", item.createdAt);
  push("rating", item.rating);
  push("url", item.url);
  push("user", item.userId);
  push("email", item.email);
  if (item.tags.length) push("tags", item.tags.join(", "));
  if (item.context && Object.keys(item.context).length) push("context", item.context);
  if (item.metadata && Object.keys(item.metadata).length) push("metadata", item.metadata);
  return lines;
}

export function buildTaskDraft(item: FeedbackItem, config: FeedbackTaskSinkConfig): FeedbackTaskDraft {
  const priority = item.severity
    ? config.priorityMap[item.severity] ?? FALLBACK_PRIORITY
    : PRIORITY_WITHOUT_SEVERITY[item.kind] ?? FALLBACK_PRIORITY;

  const description = [
    item.message,
    "",
    "---",
    ...detailLines(item),
    "",
    `Retrieve the original report with: feedback show ${item.id}`,
    `Close the loop when it ships with: feedback shipped ${item.id} --changelog-ref <ref>`,
  ].join("\n");

  return {
    title: `[${FEEDBACK_TASK_TAG}:${item.appId}] ${summarize(item.message)}`,
    description,
    priority,
    tags: [...new Set([FEEDBACK_TASK_TAG, `app:${item.appId}`, ...item.tags, ...config.tags])],
    project: config.projectFor(item.appId),
  };
}

export const defaultCommandRunner: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    // `detached` puts the child in its own process group so a timeout can kill
    // the WHOLE tree. Killing only the direct child leaves grandchildren alive
    // holding the inherited stdio pipes, which keeps our own event loop open —
    // measured: the timeout fired at 1s but the process still exited at 61s.
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const killTree = (): void => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      // Release the pipes so nothing an orphan still holds keeps us alive.
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      child.unref();
    };

    // Capturing feedback must never be held hostage by a task tracker that
    // hangs. Without this the subprocess can block `submit` — and, because the
    // same path runs inside the HTTP handler, a hosted request — forever.
    const timeoutMs = options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => finish(() => resolve({ code: code ?? 0, stdout, stderr })));

    // Always close stdin: a child that prompts gets EOF instead of blocking.
    if (options.input !== undefined) child.stdin.write(options.input);
    child.stdin.end();
  });

/**
 * Read the created task id out of a command's stdout. A zero exit with output
 * we cannot understand is treated as a failure: reporting a task that may not
 * exist is worse than reporting the failure.
 */
function parseTaskId(stdout: string, provider: string): { taskId: string; shortId?: string } {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`${provider} produced no JSON task object (stdout: ${summarize(stdout, 200) || "<empty>"})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    throw new Error(`${provider} produced unparseable JSON (stdout: ${summarize(stdout, 200)})`);
  }
  const record = parsed as Record<string, unknown> | null;
  const taskId = record && typeof record["id"] === "string" ? record["id"] : undefined;
  if (!taskId) throw new Error(`${provider} returned no task id (stdout: ${summarize(stdout, 200)})`);
  const shortId = record && typeof record["short_id"] === "string" ? record["short_id"] : undefined;
  return shortId ? { taskId, shortId } : { taskId };
}

function todosArgs(draft: FeedbackTaskDraft): string[] {
  // `-j` is a global flag on the todos CLI and must precede the subcommand.
  const args = ["-j", "add", draft.title, "--description", draft.description, "--priority", draft.priority];
  if (draft.tags.length) args.push("--tags", draft.tags.join(","));
  if (draft.project) args.push("--project", draft.project);
  return args;
}

export interface CreateTaskSinkOptions {
  config?: FeedbackTaskSinkConfig;
  run?: CommandRunner;
  env?: Record<string, string | undefined>;
}

export function createTaskSink(options: CreateTaskSinkOptions = {}): FeedbackTaskSink | null {
  const config = options.config ?? resolveTaskSinkConfig({ env: options.env });
  const run = options.run ?? defaultCommandRunner;

  if (config.kind === "none") return null;
  if (config.kind === "invalid" || config.blockers.length) {
    const message = config.blockers.join(" ") || "Task sink is misconfigured.";
    return {
      provider: config.kind,
      createTask: () => Promise.reject(new Error(message)),
    };
  }

  if (config.kind === "command") {
    const [command, ...args] = config.command!;
    return {
      provider: command!,
      createTask: async (item) => {
        const draft = buildTaskDraft(item, config);
        const result = await run(command!, args, {
          input: JSON.stringify({ feedback: item, task: draft }),
          timeoutMs: config.timeoutMs,
        });
        if (result.code !== 0) {
          throw new Error(`${command} exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
        }
        const { taskId, shortId } = parseTaskId(result.stdout, command!);
        return {
          provider: command!,
          taskId,
          ...(shortId ? { shortId } : {}),
          ...(draft.project ? { project: draft.project } : {}),
          createdAt: new Date().toISOString(),
        };
      },
    };
  }

  return {
    provider: "todos",
    createTask: async (item) => {
      const draft = buildTaskDraft(item, config);
      const result = await run(config.binary!, todosArgs(draft), { timeoutMs: config.timeoutMs });
      if (result.code !== 0) {
        throw new Error(`todos exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
      }
      const { taskId, shortId } = parseTaskId(result.stdout, "todos");
      return {
        provider: "todos",
        taskId,
        ...(shortId ? { shortId } : {}),
        ...(draft.project ? { project: draft.project } : {}),
        createdAt: new Date().toISOString(),
      };
    },
  };
}

export function describeTaskSinkRuntime(options: ResolveTaskSinkOptions = {}): FeedbackTaskSinkRuntime {
  const config = resolveTaskSinkConfig(options);
  const enabled = config.kind !== "none";
  return {
    requested: config.requested,
    kind: config.kind,
    provider: config.kind === "command" ? config.command?.[0] ?? null : config.kind === "todos" ? "todos" : null,
    enabled,
    ok: config.blockers.length === 0 && config.kind !== "invalid",
    binary: config.binary,
    blockers: config.blockers,
  };
}
