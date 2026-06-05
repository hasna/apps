import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../db/database.js";
import { getTestingWorkflow } from "../db/workflows.js";
import { getPersona } from "../db/personas.js";
import { runByFilter, type RunOptions } from "./runner.js";
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
  writeFileSync(join(localDir, "testers.db"), getDatabase().serialize());
  return {
    localDir,
    remoteDir: plan.sandbox.stateRemoteDir,
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

function buildSandboxPlan(
  workflow: TestingWorkflow,
  execution: WorkflowExecutionConfig,
  runOptions: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] },
): WorkflowSandboxPlan {
  const remoteDir = execution.sandboxRemoteDir ?? `/tmp/testers-workflow-${workflow.id.slice(0, 8)}`;
  const stateRemoteDir = `${remoteDir.replace(/\/+$/, "")}/.testers-state`;
  return {
    provider: execution.provider,
    image: execution.sandboxImage,
    name: `testers-${workflow.id.slice(0, 8)}`,
    remoteDir,
    stateRemoteDir,
    cleanup: execution.sandboxCleanup ?? "delete",
    syncStrategy: execution.sandboxSyncStrategy ?? "rsync",
    timeoutMs: execution.timeoutMs,
    env: execution.env,
    command: buildSandboxCommand({
      runOptions,
      remoteDir,
      dbPath: `${stateRemoteDir}/testers.db`,
      setupCommand: execution.setupCommand,
      packageSpec: execution.packageSpec ?? "@hasna/testers",
    }),
  };
}

function buildSandboxCommand(input: {
  runOptions: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] };
  remoteDir: string;
  dbPath: string;
  setupCommand?: string;
  packageSpec: string;
}): string {
  const args = [
    "bunx",
    input.packageSpec,
    "run",
    input.runOptions.url,
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

  return [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(input.remoteDir)}`,
    `cd ${shellQuote(input.remoteDir)}`,
    input.setupCommand,
    `HASNA_TESTERS_DB_PATH=${shellQuote(input.dbPath)} ${args.map(shellQuote).join(" ")}`,
  ].filter(Boolean).join("\n");
}

async function runViaSandbox(
  plan: WorkflowRunPlan,
  dependencies: WorkflowRunnerDependencies,
): Promise<WorkflowSandboxExecutionResult> {
  if (!plan.sandbox) throw new Error("Workflow does not have a sandbox plan");
  const sandboxes = await resolveSandboxesRuntime(dependencies);
  const createBundle = dependencies.createDatabaseBundle ?? createWorkflowDatabaseBundle;
  const bundle = createBundle(plan.workflow, plan);

  try {
    const raw = await sandboxes.runCommandInSandbox({
      command: plan.sandbox.command,
      provider: plan.sandbox.provider,
      name: plan.sandbox.name,
      image: plan.sandbox.image,
      sandboxTimeout: plan.sandbox.timeoutMs,
      commandTimeoutMs: plan.sandbox.timeoutMs,
      projectId: plan.workflow.projectId ?? undefined,
      config: {
        source: "testers",
        workflowId: plan.workflow.id,
        workflowName: plan.workflow.name,
      },
      sandboxEnvVars: plan.sandbox.env,
      cleanup: plan.sandbox.cleanup,
      upload: {
        localDir: bundle.localDir,
        remoteDir: bundle.remoteDir,
        syncStrategy: plan.sandbox.syncStrategy,
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
  } finally {
    bundle.cleanup?.();
  }
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
