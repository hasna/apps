import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix as pathPosix } from "node:path";
import { getDatabase } from "../db/database.js";
import { getTestingWorkflow } from "../db/workflows.js";
import { getPersona } from "../db/personas.js";
import { runByFilter, type RunOptions } from "./runner.js";
import { parseCredentialEnvReference, resolveCredential } from "./secrets-resolver.js";
import { buildSandboxAppUploadExcludes } from "./sandbox-app.js";
import type {
  Result,
  Run,
  TestingWorkflow,
  WorkflowExecutionConfig,
  WorkflowSandboxCleanup,
  WorkflowSandboxSyncStrategy,
} from "../types/index.js";

export interface WorkflowRunOptions {
  url: string;
  model?: string;
  headed?: boolean;
  parallel?: number;
  timeout?: number;
  dryRun?: boolean;
}

export interface WorkflowSandboxPlan {
  provider?: string;
  image?: string;
  name: string;
  remoteDir: string;
  stateRemoteDir: string;
  appSourceDir?: string;
  appRemoteDir?: string;
  appStartCommand?: string;
  appUrl?: string;
  appWaitUrl?: string;
  appWaitTimeoutMs?: number;
  command: string;
  cleanup: WorkflowSandboxCleanup;
  syncStrategy: WorkflowSandboxSyncStrategy;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface WorkflowRunPlan {
  workflow: TestingWorkflow;
  runOptions: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] };
  sandbox: WorkflowSandboxPlan | null;
}

export interface WorkflowDatabaseBundle {
  localDir: string;
  remoteDir: string;
  cleanup?: () => void;
}

export interface WorkflowSandboxExecutionResult {
  sandboxId: string;
  sessionId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  cleanup: string;
}

interface SandboxCommandResult {
  sandbox: { id: string };
  session: { id: string };
  result: {
    exit_code?: number;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  };
  cleanup: string;
}

export interface WorkflowSandboxesRuntime {
  runCommandInSandbox(input: {
    command: string;
    provider?: string;
    name?: string;
    image?: string;
    sandboxTimeout?: number;
    commandTimeoutMs?: number;
    projectId?: string;
    config?: Record<string, unknown>;
    sandboxEnvVars?: Record<string, string>;
    cwd?: string;
    upload: {
      localDir: string;
      remoteDir: string;
      syncStrategy?: WorkflowSandboxSyncStrategy;
    };
    cleanup?: WorkflowSandboxCleanup;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  }): Promise<SandboxCommandResult>;
}

export interface WorkflowRunnerDependencies {
  runByFilter?: typeof runByFilter;
  sandboxes?: WorkflowSandboxesRuntime;
  createSandboxesSDK?: () => WorkflowSandboxesRuntime | Promise<WorkflowSandboxesRuntime>;
  createDatabaseBundle?: (workflow: TestingWorkflow, plan: WorkflowRunPlan) => WorkflowDatabaseBundle;
}

const MAX_CAPTURED_SANDBOX_OUTPUT = 120_000;

export function buildWorkflowRunPlan(workflow: TestingWorkflow, options: WorkflowRunOptions): WorkflowRunPlan {
  const runOptions = {
    url: options.url,
    model: options.model,
    headed: options.headed,
    parallel: options.parallel,
    timeout: options.timeout ?? workflow.execution.timeoutMs,
    projectId: workflow.projectId ?? undefined,
    scenarioIds: workflow.scenarioFilter.scenarioIds,
    tags: workflow.scenarioFilter.tags,
    priority: workflow.scenarioFilter.priority,
    personaIds: workflow.personaIds.length > 0 ? workflow.personaIds : undefined,
  };

  return {
    workflow,
    runOptions,
    sandbox: workflow.execution.target === "sandbox"
      ? buildSandboxPlan(workflow, workflow.execution, runOptions)
      : null,
  };
}

export async function runTestingWorkflow(
  workflowId: string,
  options: WorkflowRunOptions,
  dependencies: WorkflowRunnerDependencies = {},
): Promise<{
  run: Run | null;
  results: Result[];
  plan: WorkflowRunPlan;
  sandboxResult?: WorkflowSandboxExecutionResult;
}> {
  const workflow = getTestingWorkflow(workflowId);
  if (!workflow) throw new Error(`Testing workflow not found: ${workflowId}`);
  if (!workflow.enabled) throw new Error(`Testing workflow is disabled: ${workflow.name}`);

  validatePersonaIds(workflow);
  const plan = buildWorkflowRunPlan(workflow, options);
  if (options.dryRun) return { run: null, results: [], plan };

  if (workflow.execution.target === "sandbox") {
    const sandboxResult = await runViaSandbox(plan, dependencies);
    return { run: null, results: [], plan, sandboxResult };
  }

  const runLocal = dependencies.runByFilter ?? runByFilter;
  const { run, results } = await runLocal(plan.runOptions);
  return { run, results, plan };
}

export function createWorkflowDatabaseBundle(
  workflow: TestingWorkflow,
  plan: WorkflowRunPlan,
): WorkflowDatabaseBundle {
  if (!plan.sandbox) throw new Error(`Workflow is not configured for sandbox execution: ${workflow.name}`);
  const localDir = mkdtempSync(join(tmpdir(), `testers-workflow-${workflow.id.slice(0, 8)}-`));
  const stateDir = join(localDir, ".testers-state");
  mkdirSync(stateDir, { recursive: true });
  writeDatabaseSnapshot(join(stateDir, "testers.db"));

  if (plan.sandbox.appSourceDir && plan.sandbox.appRemoteDir) {
    const relativeAppDir = relativeRemotePath(plan.sandbox.remoteDir, plan.sandbox.appRemoteDir);
    copyAppSource(plan.sandbox.appSourceDir, join(localDir, relativeAppDir));
  }

  return {
    localDir,
    remoteDir: plan.sandbox.remoteDir,
    cleanup: () => rmSync(localDir, { recursive: true, force: true }),
  };
}

function validatePersonaIds(workflow: TestingWorkflow): void {
  for (const personaId of workflow.personaIds) {
    if (!getPersona(personaId)) {
      throw new Error(`Persona not found for workflow ${workflow.name}: ${personaId}`);
    }
  }
}

function relativeRemotePath(remoteDir: string, remoteChildDir: string): string {
  if (!remoteChildDir.startsWith("/")) {
    const relative = remoteChildDir.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!relative || relative === ".") {
      throw new Error("Sandbox app remote directory must be a child directory, not the workflow root");
    }
    return relative;
  }

  const base = remoteDir.replace(/\/+$/, "") || "/";
  const child = remoteChildDir.replace(/\/+$/, "") || "/";
  const relative = pathPosix.relative(base, child);
  if (!relative || relative === "." || relative.startsWith("..") || pathPosix.isAbsolute(relative)) {
    throw new Error(
      `Sandbox app remote directory must be inside the workflow remote directory (${remoteDir}): ${remoteChildDir}`
    );
  }
  return relative;
}

function copyAppSource(sourceDir: string, targetDir: string): void {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`Sandbox app source directory does not exist or is not a directory: ${sourceDir}`);
  }
  mkdirSync(targetDir, { recursive: true });
  const excludes = buildSandboxAppUploadExcludes();
  const result = spawnSync("rsync", [
    "-a",
    "--delete",
    ...excludes.flatMap((item) => ["--exclude", item]),
    `${sourceDir.replace(/\/+$/, "")}/`,
    `${targetDir.replace(/\/+$/, "")}/`,
  ], { encoding: "utf8" });

  if (result.error) {
    throw new Error(`Failed to rsync sandbox app source: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to rsync sandbox app source (${result.status}): ${result.stderr.trim()}`);
  }
}

function writeDatabaseSnapshot(targetPath: string): void {
  getDatabase().query("VACUUM INTO ?").run(targetPath);
}

function buildSandboxPlan(
  workflow: TestingWorkflow,
  execution: WorkflowExecutionConfig,
  runOptions: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] },
): WorkflowSandboxPlan {
  const remoteDir = execution.sandboxRemoteDir ?? defaultWorkflowSandboxRemoteDir(workflow);
  const stateRemoteDir = `${remoteDir.replace(/\/+$/, "")}/.testers-state`;
  const appRemoteDir = execution.appSourceDir
    ? execution.appRemoteDir ?? `${remoteDir.replace(/\/+$/, "")}/app`
    : execution.appRemoteDir;
  return {
    provider: execution.provider,
    image: execution.sandboxImage,
    name: `testers-${workflow.id.slice(0, 8)}`,
    remoteDir,
    stateRemoteDir,
    ...(execution.appSourceDir ? { appSourceDir: execution.appSourceDir } : {}),
    ...(appRemoteDir ? { appRemoteDir } : {}),
    ...(execution.appStartCommand ? { appStartCommand: execution.appStartCommand } : {}),
    ...(execution.appUrl ? { appUrl: execution.appUrl } : {}),
    ...(execution.appWaitUrl ? { appWaitUrl: execution.appWaitUrl } : {}),
    ...(execution.appWaitTimeoutMs !== undefined ? { appWaitTimeoutMs: execution.appWaitTimeoutMs } : {}),
    cleanup: execution.sandboxCleanup ?? "delete",
    syncStrategy: execution.sandboxSyncStrategy ?? "rsync",
    timeoutMs: execution.timeoutMs,
    env: execution.env,
    command: buildSandboxCommand({
      runOptions,
      remoteDir,
      stateRemoteDir,
      appRemoteDir,
      appStartCommand: execution.appStartCommand,
      appUrl: execution.appUrl,
      appWaitUrl: execution.appWaitUrl,
      appWaitTimeoutMs: execution.appWaitTimeoutMs,
      dbPath: `${stateRemoteDir}/testers.db`,
      setupCommand: execution.setupCommand,
      packageSpec: execution.packageSpec ?? "@hasna/testers",
    }),
  };
}

function defaultWorkflowSandboxRemoteDir(workflow: TestingWorkflow): string {
  return `/tmp/testers-workflow-${workflow.id.slice(0, 8)}-${randomBytes(4).toString("hex")}`;
}

function buildSandboxCommand(input: {
  runOptions: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] };
  remoteDir: string;
  stateRemoteDir: string;
  appRemoteDir?: string;
  appStartCommand?: string;
  appUrl?: string;
  appWaitUrl?: string;
  appWaitTimeoutMs?: number;
  dbPath: string;
  setupCommand?: string;
  packageSpec: string;
}): string {
  const targetUrl = input.appUrl ?? input.runOptions.url;
  const args = [
    "bunx",
    input.packageSpec,
    "run",
    targetUrl,
    ...(input.runOptions.scenarioIds?.length ? ["--scenario", input.runOptions.scenarioIds.join(",")] : []),
    ...(input.runOptions.tags?.length ? input.runOptions.tags.flatMap((tag) => ["--tag", tag]) : []),
    ...(input.runOptions.priority ? ["--priority", input.runOptions.priority] : []),
    ...(input.runOptions.projectId ? ["--project", input.runOptions.projectId] : []),
    ...(input.runOptions.model ? ["--model", input.runOptions.model] : []),
    ...(input.runOptions.headed ? ["--headed"] : []),
    ...(input.runOptions.parallel ? ["--parallel", String(input.runOptions.parallel)] : []),
    ...(input.runOptions.timeout ? ["--timeout", String(input.runOptions.timeout)] : []),
    ...(input.runOptions.personaIds?.length ? ["--persona", input.runOptions.personaIds.join(",")] : []),
    "--no-auto-generate",
    "--json",
  ];
  const installBrowserArgs = [
    "bunx",
    input.packageSpec,
    "install-browser",
    "--engine",
    "playwright",
    "--with-deps",
  ];

  return [
    "set -euo pipefail",
    buildBunBootstrapCommand(),
    `mkdir -p ${shellQuote(input.remoteDir)}`,
    `mkdir -p ${shellQuote(input.stateRemoteDir)}`,
    input.appRemoteDir ? `mkdir -p ${shellQuote(input.appRemoteDir)}` : undefined,
    `cd ${shellQuote(input.appRemoteDir ?? input.remoteDir)}`,
    input.setupCommand,
    buildAppStartCommand(input),
    buildSandboxBrowserInstallCommand(installBrowserArgs),
    `HASNA_TESTERS_DB_PATH=${shellQuote(input.dbPath)} ${args.map(shellQuote).join(" ")}`,
  ].filter(Boolean).join("\n");
}

function buildBunBootstrapCommand(): string {
  return [
    'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"',
    'export PATH="$BUN_INSTALL/bin:$PATH"',
    "if ! command -v bun >/dev/null 2>&1; then",
    "  curl -fsSL https://bun.sh/install | bash",
    "fi",
    "command -v bun >/dev/null 2>&1",
  ].join("\n");
}

function buildSandboxBrowserInstallCommand(args: string[]): string {
  return [
    'if [ "${TESTERS_SANDBOX_SKIP_BROWSER_INSTALL:-}" != "1" ]; then',
    `  ${args.map(shellQuote).join(" ")}`,
    "fi",
  ].join("\n");
}

function buildAppStartCommand(input: {
  appStartCommand?: string;
  appUrl?: string;
  appWaitUrl?: string;
  appWaitTimeoutMs?: number;
  runOptions: RunOptions;
  stateRemoteDir: string;
}): string | undefined {
  if (!input.appStartCommand) return undefined;
  const waitUrl = input.appWaitUrl ?? input.appUrl ?? input.runOptions.url;
  const waitTimeoutMs = input.appWaitTimeoutMs ?? 120000;
  return [
    `( ${input.appStartCommand} ) > ${shellQuote(`${input.stateRemoteDir}/app.log`)} 2>&1 &`,
    "APP_PID=$!",
    `echo "$APP_PID" > ${shellQuote(`${input.stateRemoteDir}/app.pid`)}`,
    "trap 'kill \"$APP_PID\" 2>/dev/null || true' EXIT",
    waitUrl ? buildWaitForUrlCommand(waitUrl, waitTimeoutMs) : undefined,
  ].filter(Boolean).join("\n");
}

function buildWaitForUrlCommand(url: string, timeoutMs: number): string {
  const script = `
const url = ${JSON.stringify(url)};
const timeoutMs = ${JSON.stringify(timeoutMs)};
const deadline = Date.now() + timeoutMs;
while (Date.now() <= deadline) {
  try {
    const response = await fetch(url);
    if (response.status >= 200 && response.status < 500) process.exit(0);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error(\`Timed out waiting for \${url} after \${timeoutMs}ms\`);
process.exit(1);
`.trim();
  return `bun -e ${shellQuote(script)}`;
}

async function runViaSandbox(
  plan: WorkflowRunPlan,
  dependencies: WorkflowRunnerDependencies,
): Promise<WorkflowSandboxExecutionResult> {
  if (!plan.sandbox) throw new Error("Workflow does not have a sandbox plan");
  const sandboxes = await resolveSandboxesRuntime(dependencies);
  const createBundle = dependencies.createDatabaseBundle ?? createWorkflowDatabaseBundle;
  const bundle = createBundle(plan.workflow, plan);
  const sandboxTimeoutSeconds = plan.sandbox.timeoutMs === undefined
    ? undefined
    : Math.ceil(plan.sandbox.timeoutMs / 1000);
  let capturedStdout = "";
  let capturedStderr = "";

  try {
    const raw = await sandboxes.runCommandInSandbox({
      command: plan.sandbox.command,
      provider: plan.sandbox.provider,
      name: plan.sandbox.name,
      image: plan.sandbox.image,
      sandboxTimeout: sandboxTimeoutSeconds,
      commandTimeoutMs: sandboxTimeoutSeconds,
      config: {
        source: "testers",
        testersProjectId: plan.workflow.projectId ?? undefined,
        workflowId: plan.workflow.id,
        workflowName: plan.workflow.name,
      },
      sandboxEnvVars: resolveSandboxEnv(plan.sandbox.env),
      cleanup: plan.sandbox.cleanup,
      upload: {
        localDir: bundle.localDir,
        remoteDir: bundle.remoteDir,
        syncStrategy: plan.sandbox.syncStrategy,
      },
      onStdout: (data) => {
        capturedStdout = appendCapturedSandboxOutput(capturedStdout, data);
      },
      onStderr: (data) => {
        capturedStderr = appendCapturedSandboxOutput(capturedStderr, data);
      },
    });
    const exitCode = raw.result.exit_code ?? raw.result.exitCode ?? 0;
    const stdout = raw.result.stdout ?? "";
    const stderr = raw.result.stderr ?? "";
    if (exitCode !== 0) {
      throw new Error(`Sandbox workflow execution failed (${exitCode}): ${stderr || stdout}`);
    }
    return {
      sandboxId: raw.sandbox.id,
      sessionId: raw.session.id,
      exitCode,
      stdout,
      stderr,
      cleanup: raw.cleanup,
    };
  } catch (error) {
    if (capturedStdout || capturedStderr) {
      throw buildSandboxStreamError(error, capturedStdout, capturedStderr);
    }
    throw error;
  } finally {
    bundle.cleanup?.();
  }
}

function appendCapturedSandboxOutput(current: string, data: string): string {
  const next = current + data;
  if (next.length <= MAX_CAPTURED_SANDBOX_OUTPUT) return next;
  return next.slice(next.length - MAX_CAPTURED_SANDBOX_OUTPUT);
}

function buildSandboxStreamError(error: unknown, stdout: string, stderr: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const parts = [`Sandbox workflow execution failed: ${message}`];
  if (stdout.trim()) parts.push(`stdout:\n${stdout.trimEnd()}`);
  if (stderr.trim()) parts.push(`stderr:\n${stderr.trimEnd()}`);
  return new Error(parts.join("\n"));
}

function resolveSandboxEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env || Object.keys(env).length === 0) return undefined;

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const envReference = parseCredentialEnvReference(value, { allowOptional: true });
    if (envReference?.optional) {
      const optionalValue = envReference.name ? process.env[envReference.name] : undefined;
      if (optionalValue !== undefined) resolved[key] = optionalValue;
      continue;
    }
    const resolvedValue = resolveCredential(value);
    if (resolvedValue === null) {
      throw new Error(`Missing sandbox env value for ${key}`);
    }
    resolved[key] = resolvedValue;
  }
  return resolved;
}

async function resolveSandboxesRuntime(
  dependencies: WorkflowRunnerDependencies,
): Promise<WorkflowSandboxesRuntime> {
  if (dependencies.sandboxes) return dependencies.sandboxes;
  if (dependencies.createSandboxesSDK) return dependencies.createSandboxesSDK();

  const mod = await import("@hasna/sandboxes") as unknown as {
    createSandboxesSDK: () => WorkflowSandboxesRuntime;
  };
  return mod.createSandboxesSDK();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
