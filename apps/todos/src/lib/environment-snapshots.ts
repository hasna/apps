import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { hostname, platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { addTaskRunArtifact, getTaskRun, resolveTaskRunId } from "../db/task-runs.js";
import { addTaskVerification } from "../db/task-commits.js";
import { getDatabase, getDatabasePath, resolvePartialId } from "../db/database.js";
import { getTask } from "../db/tasks.js";
import { redactEvidenceText, redactValue } from "./redaction.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./sync-utils.js";

export interface EnvironmentSnapshotFile {
  path: string;
  sha256: string;
  size_bytes: number;
}

export interface EnvironmentSnapshotManifest extends EnvironmentSnapshotFile {
  redacted: Record<string, unknown>;
}

export interface EnvironmentSnapshot {
  schema_version: 1;
  id: string;
  captured_at: string;
  root: string;
  machine: {
    hostname: string;
    platform: string;
    arch: string;
  };
  target: {
    task_id: string | null;
    run_id: string | null;
    agent_id: string | null;
  };
  runtime: {
    bun: string | null;
    node: string;
    executable: string;
  };
  package_manager: {
    manager: "bun" | "npm" | "unknown";
    user_agent: string | null;
    manifests: EnvironmentSnapshotManifest[];
    lockfiles: EnvironmentSnapshotFile[];
  };
  git: {
    present: boolean;
    branch: string | null;
    commit: string | null;
    is_dirty: boolean;
    status_porcelain: string[];
    status_summary: {
      added: number;
      modified: number;
      deleted: number;
      renamed: number;
      untracked: number;
    };
  };
  config_hashes: EnvironmentSnapshotFile[];
  command_env: {
    command: string | null;
    env_keys: string[];
    env: Record<string, string> | null;
    redacted_keys: string[];
  };
  warnings: string[];
}

export interface CaptureEnvironmentSnapshotInput {
  root?: string;
  task_id?: string;
  run_id?: string;
  agent_id?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  include_env_values?: boolean;
  now?: string | Date;
}

export interface RecordEnvironmentSnapshotInput extends CaptureEnvironmentSnapshotInput {
  output_path?: string;
  store_content?: boolean;
}

export interface RecordedEnvironmentSnapshot {
  snapshot: EnvironmentSnapshot;
  output_path: string;
  task_verification_id: string | null;
  run_artifact_id: string | null;
}

export interface EnvironmentSnapshotComparison {
  schema_version: 1;
  left_id: string;
  right_id: string;
  same_root: boolean;
  same_machine: boolean;
  same_runtime: boolean;
  same_git_commit: boolean;
  dirty_state_changed: boolean;
  changed_config_hashes: Array<{ path: string; left_sha256: string | null; right_sha256: string | null }>;
  changed_lockfiles: Array<{ path: string; left_sha256: string | null; right_sha256: string | null }>;
  changed_manifests: Array<{ path: string; left_sha256: string | null; right_sha256: string | null }>;
  warnings: string[];
}

const MANIFEST_FILES = ["package.json", "dashboard/package.json", "sdk/package.json"];
const LOCKFILES = ["bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json"];
const CONFIG_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "SECURITY.md",
  "bunfig.toml",
  "tsconfig.json",
  "components.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.ts",
  "dashboard/vite.config.ts",
];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fileRecord(root: string, relativePath: string): EnvironmentSnapshotFile | null {
  const path = join(root, relativePath);
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  if (!stat.isFile()) return null;
  const content = readFileSync(path);
  return { path: relativePath, sha256: sha256(content), size_bytes: content.length };
}

function manifestRecord(root: string, relativePath: string): EnvironmentSnapshotManifest | null {
  const base = fileRecord(root, relativePath);
  if (!base) return null;
  const parsed = readJsonFile<Record<string, unknown>>(join(root, relativePath));
  if (!parsed) return { ...base, redacted: {} };
  const redacted = redactValue({
    name: parsed["name"] ?? null,
    version: parsed["version"] ?? null,
    packageManager: parsed["packageManager"] ?? null,
    scripts: parsed["scripts"] ?? {},
    dependencies: parsed["dependencies"] ?? {},
    devDependencies: parsed["devDependencies"] ?? {},
    peerDependencies: parsed["peerDependencies"] ?? {},
    optionalDependencies: parsed["optionalDependencies"] ?? {},
  }) as Record<string, unknown>;
  return { ...base, redacted };
}

function runLocalCommand(root: string, args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: args,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env["PATH"] || "" },
  });
  return {
    exitCode: result.exitCode,
    stdout: redactEvidenceText(result.stdout.toString("utf8").trim()),
    stderr: redactEvidenceText(result.stderr.toString("utf8").trim()),
  };
}

function summarizeGitStatus(lines: string[]): EnvironmentSnapshot["git"]["status_summary"] {
  const summary = { added: 0, modified: 0, deleted: 0, renamed: 0, untracked: 0 };
  for (const line of lines) {
    if (line.startsWith("??")) summary.untracked += 1;
    else if (line.includes("R")) summary.renamed += 1;
    else if (line.includes("D")) summary.deleted += 1;
    else if (line.includes("A")) summary.added += 1;
    else if (line.includes("M")) summary.modified += 1;
  }
  return summary;
}

function captureGit(root: string, warnings: string[]): EnvironmentSnapshot["git"] {
  const inside = runLocalCommand(root, ["git", "rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0 || inside.stdout !== "true") {
    return { present: false, branch: null, commit: null, is_dirty: false, status_porcelain: [], status_summary: summarizeGitStatus([]) };
  }
  const branch = runLocalCommand(root, ["git", "branch", "--show-current"]);
  const commit = runLocalCommand(root, ["git", "rev-parse", "HEAD"]);
  const status = runLocalCommand(root, ["git", "status", "--porcelain=v1"]);
  if (commit.exitCode !== 0) warnings.push(`git commit unavailable: ${commit.stderr || commit.stdout || "unknown error"}`);
  if (status.exitCode !== 0) warnings.push(`git status unavailable: ${status.stderr || status.stdout || "unknown error"}`);
  const lines = status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean) : [];
  return {
    present: true,
    branch: branch.stdout || null,
    commit: commit.stdout || null,
    is_dirty: lines.length > 0,
    status_porcelain: lines,
    status_summary: summarizeGitStatus(lines),
  };
}

function packageManager(env: NodeJS.ProcessEnv, lockfiles: EnvironmentSnapshotFile[]): EnvironmentSnapshot["package_manager"]["manager"] {
  const userAgent = (env["npm_config_user_agent"] || "").toLowerCase();
  if (userAgent.includes("bun")) return "bun";
  if (lockfiles.some((file) => file.path.startsWith("bun.lock"))) return "bun";
  if (userAgent.includes("npm") || lockfiles.some((file) => file.path.includes("package-lock"))) return "npm";
  return "unknown";
}

function isSecretEnvKey(key: string): boolean {
  return /api[_-]?key|token|secret|password|credential|private|session|cookie/i.test(key);
}

function commandEnv(env: NodeJS.ProcessEnv, includeValues: boolean): EnvironmentSnapshot["command_env"] {
  const keys = Object.keys(env).sort();
  const interesting = keys.filter((key) => (
    isSecretEnvKey(key)
    || ["CI", "NODE_ENV", "BUN_ENV", "SHELL", "TERM", "PATH", "PWD", "USER", "npm_config_user_agent"].includes(key)
    || key.startsWith("TODOS_")
    || key.startsWith("BUN_")
  ));
  const redactedKeys = interesting.filter(isSecretEnvKey);
  const values = includeValues
    ? Object.fromEntries(interesting.map((key) => [key, isSecretEnvKey(key) ? "[REDACTED]" : redactEvidenceText(String(env[key] ?? ""))]))
    : null;
  return {
    command: null,
    env_keys: interesting,
    env: values,
    redacted_keys: redactedKeys,
  };
}

function defaultSnapshotDir(): string {
  const dbPath = getDatabasePath();
  if (dbPath === ":memory:" || dbPath.startsWith("file::memory:")) return join(tmpdir(), "hasna-todos", "environment-snapshots");
  return join(dirname(resolve(dbPath)), "environment-snapshots");
}

function snapshotWithId(snapshot: Omit<EnvironmentSnapshot, "id">): EnvironmentSnapshot {
  const digest = sha256(JSON.stringify(snapshot)).slice(0, 24);
  return { id: `env_${digest}`, ...snapshot };
}

export function captureEnvironmentSnapshot(input: CaptureEnvironmentSnapshotInput = {}): EnvironmentSnapshot {
  const root = resolve(input.root || process.cwd());
  const env = input.env || process.env;
  const warnings: string[] = [];
  const manifests = MANIFEST_FILES.map((file) => manifestRecord(root, file)).filter((file): file is EnvironmentSnapshotManifest => Boolean(file));
  const lockfiles = LOCKFILES.map((file) => fileRecord(root, file)).filter((file): file is EnvironmentSnapshotFile => Boolean(file));
  const configHashes = CONFIG_FILES.map((file) => fileRecord(root, file)).filter((file): file is EnvironmentSnapshotFile => Boolean(file));
  const commandMetadata = commandEnv(env, Boolean(input.include_env_values));
  commandMetadata.command = input.command ? redactEvidenceText(input.command) : null;

  if (manifests.length === 0) warnings.push("no package manifest found");
  if (lockfiles.length === 0) warnings.push("no package lockfile found");

  return snapshotWithId({
    schema_version: 1,
    captured_at: input.now ? new Date(input.now).toISOString() : new Date().toISOString(),
    root,
    machine: { hostname: hostname(), platform: platform(), arch: arch() },
    target: {
      task_id: input.task_id ?? null,
      run_id: input.run_id ?? null,
      agent_id: input.agent_id ?? null,
    },
    runtime: {
      bun: Bun.version || null,
      node: process.version,
      executable: process.execPath,
    },
    package_manager: {
      manager: packageManager(env, lockfiles),
      user_agent: env["npm_config_user_agent"] ? redactEvidenceText(env["npm_config_user_agent"]!) : null,
      manifests,
      lockfiles,
    },
    git: captureGit(root, warnings),
    config_hashes: configHashes,
    command_env: commandMetadata,
    warnings,
  });
}

export function writeEnvironmentSnapshot(snapshot: EnvironmentSnapshot, outputPath?: string): string {
  const path = outputPath ? resolve(outputPath) : join(defaultSnapshotDir(), `${snapshot.id}.json`);
  ensureDir(dirname(path));
  writeJsonFile(path, snapshot);
  return path;
}

export function readEnvironmentSnapshot(path: string): EnvironmentSnapshot {
  const snapshot = readJsonFile<EnvironmentSnapshot>(resolve(path));
  if (!snapshot || snapshot.schema_version !== 1 || typeof snapshot.id !== "string") {
    throw new Error(`Invalid environment snapshot: ${path}`);
  }
  return snapshot;
}

export function recordEnvironmentSnapshot(input: RecordEnvironmentSnapshotInput = {}, db?: Database): RecordedEnvironmentSnapshot {
  let taskId = input.task_id;
  let runId = input.run_id;
  const needsDatabase = Boolean(taskId || runId);
  const d = needsDatabase ? (db || getDatabase()) : null;
  if (runId) {
    runId = resolveTaskRunId(runId, d!);
    const run = getTaskRun(runId, d!);
    if (!run) throw new Error(`Run not found: ${input.run_id}`);
    taskId = taskId || run.task_id;
  }
  if (taskId && d) {
    taskId = resolvePartialId(d, "tasks", taskId) || taskId;
    if (!getTask(taskId, d)) throw new Error(`Task not found: ${taskId}`);
  }

  const snapshot = captureEnvironmentSnapshot({ ...input, task_id: taskId, run_id: runId });
  const outputPath = writeEnvironmentSnapshot(snapshot, input.output_path);
  let taskVerificationId: string | null = null;
  let runArtifactId: string | null = null;

  if (runId) {
    const artifact = addTaskRunArtifact({
      run_id: runId,
      path: outputPath,
      artifact_type: "environment_snapshot",
      description: "Reproducible local environment snapshot",
      metadata: { environment_snapshot_id: snapshot.id, schema_version: snapshot.schema_version },
      store_content: input.store_content ?? true,
      agent_id: input.agent_id,
    }, d!);
    runArtifactId = artifact.id;
  } else if (taskId) {
    const verification = addTaskVerification({
      task_id: taskId,
      command: input.command || "capture environment snapshot",
      status: "unknown",
      output_summary: `environment snapshot ${snapshot.id}`,
      artifact_path: outputPath,
      agent_id: input.agent_id,
      run_at: snapshot.captured_at,
    }, d!);
    taskVerificationId = verification.id;
  }

  return { snapshot, output_path: outputPath, task_verification_id: taskVerificationId, run_artifact_id: runArtifactId };
}

function keyed(files: EnvironmentSnapshotFile[]): Map<string, EnvironmentSnapshotFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function diffFiles(left: EnvironmentSnapshotFile[], right: EnvironmentSnapshotFile[]): Array<{ path: string; left_sha256: string | null; right_sha256: string | null }> {
  const leftMap = keyed(left);
  const rightMap = keyed(right);
  const paths = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort((a, b) => a.localeCompare(b));
  return paths
    .map((path) => ({ path, left_sha256: leftMap.get(path)?.sha256 ?? null, right_sha256: rightMap.get(path)?.sha256 ?? null }))
    .filter((entry) => entry.left_sha256 !== entry.right_sha256);
}

export function compareEnvironmentSnapshots(left: EnvironmentSnapshot, right: EnvironmentSnapshot): EnvironmentSnapshotComparison {
  const warnings: string[] = [];
  if (left.schema_version !== right.schema_version) warnings.push("snapshot schema versions differ");
  return {
    schema_version: 1,
    left_id: left.id,
    right_id: right.id,
    same_root: left.root === right.root,
    same_machine: left.machine.hostname === right.machine.hostname && left.machine.platform === right.machine.platform && left.machine.arch === right.machine.arch,
    same_runtime: left.runtime.bun === right.runtime.bun && left.runtime.node === right.runtime.node,
    same_git_commit: left.git.commit === right.git.commit,
    dirty_state_changed: left.git.is_dirty !== right.git.is_dirty,
    changed_config_hashes: diffFiles(left.config_hashes, right.config_hashes),
    changed_lockfiles: diffFiles(left.package_manager.lockfiles, right.package_manager.lockfiles),
    changed_manifests: diffFiles(left.package_manager.manifests, right.package_manager.manifests),
    warnings,
  };
}

export function compareEnvironmentSnapshotFiles(leftPath: string, rightPath: string): EnvironmentSnapshotComparison {
  return compareEnvironmentSnapshots(readEnvironmentSnapshot(leftPath), readEnvironmentSnapshot(rightPath));
}
