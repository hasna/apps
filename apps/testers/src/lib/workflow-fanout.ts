import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { getTestingWorkflow, listTestingWorkflows } from "../db/workflows.js";
import { runTestingWorkflow, type WorkflowRunOptions, type WorkflowRunnerDependencies } from "./workflow-runner.js";
import { resolveCredential } from "./secrets-resolver.js";
import type { TestingWorkflow } from "../types/index.js";

export interface WorkflowFanoutOptions extends WorkflowRunOptions {
  workflowIds?: string[];
  projectId?: string;
  tags?: string[];
  includeDisabled?: boolean;
  workers?: number;
  batchSize?: number;
  batch?: number;
  offset?: number;
}

export interface WorkflowFanoutItem {
  workflowId: string;
  workflowName: string;
  status: "dry-run" | "passed" | "failed";
  sandboxId?: string;
  sessionId?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  plan?: Awaited<ReturnType<typeof runTestingWorkflow>>["plan"];
}

export interface WorkflowFanoutResult {
  status: "passed" | "failed" | "dry-run";
  workers: number;
  selection: WorkflowFanoutSelection;
  total: number;
  passed: number;
  failed: number;
  items: WorkflowFanoutItem[];
  preflight?: WorkflowFanoutPreflightResult;
}

export interface WorkflowFanoutDependencies extends WorkflowRunnerDependencies {
  runTestingWorkflow?: typeof runTestingWorkflow;
  preflight?: (workflows: TestingWorkflow[]) => WorkflowFanoutPreflightResult | Promise<WorkflowFanoutPreflightResult>;
  providerApiKeyResolver?: (provider: string, env: Record<string, string | undefined>) => string | undefined | Promise<string | undefined>;
  commandExists?: (command: string) => boolean;
  credentialResolver?: (value: string) => string | null;
  env?: Record<string, string | undefined>;
}

export interface WorkflowFanoutPreflightCheck {
  name: string;
  ok: boolean;
  required: boolean;
  message: string;
  workflows?: string[];
  details?: Record<string, unknown>;
}

export interface WorkflowFanoutPreflightResult {
  ok: boolean;
  checks: WorkflowFanoutPreflightCheck[];
}

export interface WorkflowFanoutSelection {
  matched: number;
  offset: number;
  limit?: number;
  batch?: number;
  batchSize?: number;
  totalBatches?: number;
}

interface WorkflowFanoutPreflightDependencies {
  providerApiKeyResolver?: WorkflowFanoutDependencies["providerApiKeyResolver"];
  commandExists?: WorkflowFanoutDependencies["commandExists"];
  credentialResolver?: WorkflowFanoutDependencies["credentialResolver"];
  env?: Record<string, string | undefined>;
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  e2b: "E2B_API_KEY",
  daytona: "DAYTONA_API_KEY",
  modal: "MODAL_TOKEN_ID",
};

function splitWorkflowIds(ids: string[] | undefined): string[] {
  return (ids ?? [])
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeFanoutWorkerCount(value: number | undefined): number {
  const workers = Math.floor(value ?? 6);
  if (!Number.isFinite(workers) || workers < 1 || workers > 12) {
    throw new Error("workflow fanout workers must be between 1 and 12");
  }
  return workers;
}

export function resolveWorkflowFanoutBatch(
  workflows: TestingWorkflow[],
  options: Pick<WorkflowFanoutOptions, "batchSize" | "batch" | "offset"> = {},
): { workflows: TestingWorkflow[]; selection: WorkflowFanoutSelection } {
  const batchSize = normalizeOptionalPositiveInteger(options.batchSize, "workflow fanout batch size");
  const batch = normalizeOptionalPositiveInteger(options.batch, "workflow fanout batch");
  const offset = normalizeOptionalNonNegativeInteger(options.offset, "workflow fanout offset");

  if (batch !== undefined && offset !== undefined) {
    throw new Error("workflow fanout batch and offset cannot both be set");
  }
  if (batch !== undefined && batchSize === undefined) {
    throw new Error("workflow fanout batch requires batch size");
  }

  const resolvedOffset = batch !== undefined && batchSize !== undefined
    ? (batch - 1) * batchSize
    : offset ?? 0;
  const limit = batchSize;
  const selected = workflows.slice(resolvedOffset, limit === undefined ? undefined : resolvedOffset + limit);

  if (selected.length === 0) {
    throw new Error(`No testing workflows matched the fanout batch selection (matched ${workflows.length}, offset ${resolvedOffset})`);
  }

  return {
    workflows: selected,
    selection: {
      matched: workflows.length,
      offset: resolvedOffset,
      ...(limit !== undefined ? { limit } : {}),
      ...(batch !== undefined ? { batch } : {}),
      ...(batchSize !== undefined ? { batchSize, totalBatches: Math.ceil(workflows.length / batchSize) } : {}),
    },
  };
}

export function resolveWorkflowFanoutSelection(options: Pick<WorkflowFanoutOptions, "workflowIds" | "projectId" | "tags" | "includeDisabled">): TestingWorkflow[] {
  const ids = splitWorkflowIds(options.workflowIds);
  const workflows = ids.length > 0
    ? ids.map((id) => {
        const workflow = getTestingWorkflow(id);
        if (!workflow) throw new Error(`Testing workflow not found: ${id}`);
        return workflow;
      })
    : listTestingWorkflows({
        projectId: options.projectId,
        enabled: options.includeDisabled ? undefined : true,
      });

  const tagSet = new Set(options.tags ?? []);
  const filtered = tagSet.size === 0
    ? workflows
    : workflows.filter((workflow) => workflow.scenarioFilter.tags?.some((tag) => tagSet.has(tag)));

  if (filtered.length === 0) {
    throw new Error("No testing workflows matched the fanout selection");
  }

  const nonSandbox = filtered.filter((workflow) => workflow.execution.target !== "sandbox");
  if (nonSandbox.length > 0) {
    throw new Error(
      `workflow fanout requires sandbox workflows. Recreate or update these with --target sandbox: ${nonSandbox.map((workflow) => workflow.name).join(", ")}`
    );
  }

  return filtered;
}

export async function checkWorkflowFanoutReadiness(
  workflows: TestingWorkflow[],
  dependencies: WorkflowFanoutPreflightDependencies = {},
): Promise<WorkflowFanoutPreflightResult> {
  const checks: WorkflowFanoutPreflightCheck[] = [];
  const env = dependencies.env ?? process.env;

  for (const [provider, providerWorkflows] of groupWorkflowsByProvider(workflows)) {
    const envKey = PROVIDER_ENV_KEYS[provider];
    if (!envKey) {
      checks.push({
        name: `provider:${provider}`,
        ok: true,
        required: false,
        message: `No built-in credential preflight for sandbox provider "${provider}"`,
        workflows: providerWorkflows.map((workflow) => workflow.name),
      });
      continue;
    }

    const apiKey = await resolveProviderApiKey(provider, env, dependencies.providerApiKeyResolver);
    checks.push({
      name: `provider:${provider}`,
      ok: Boolean(apiKey),
      required: true,
      message: apiKey
        ? `Sandbox provider "${provider}" credential is available`
        : `Missing sandbox provider credential for "${provider}". Set ${envKey} or configure providers.${provider}.api_key with sandboxes config`,
      workflows: providerWorkflows.map((workflow) => workflow.name),
      details: { provider, envKey },
    });
  }

  const needsRsync = workflows.filter((workflow) =>
    (workflow.execution.sandboxSyncStrategy ?? "rsync") === "rsync" ||
    Boolean(workflow.execution.appSourceDir)
  );
  if (needsRsync.length > 0) {
    const commandExists = dependencies.commandExists ?? defaultCommandExists;
    const rsyncOk = commandExists("rsync");
    checks.push({
      name: "tool:rsync",
      ok: rsyncOk,
      required: true,
      message: rsyncOk
        ? "rsync is available for sandbox uploads and app source bundling"
        : "Missing rsync. Install rsync or use --sandbox-sync archive for workflows without app source bundling",
      workflows: needsRsync.map((workflow) => workflow.name),
    });
  }

  const missingAppSources = workflows
    .filter((workflow) => workflow.execution.appSourceDir)
    .filter((workflow) => {
      const sourceDir = workflow.execution.appSourceDir!;
      return !existsSync(sourceDir) || !statSync(sourceDir).isDirectory();
    });
  if (missingAppSources.length > 0) {
    checks.push({
      name: "app-source",
      ok: false,
      required: true,
      message: "One or more workflow app source directories are missing or are not directories",
      workflows: missingAppSources.map((workflow) => workflow.name),
      details: {
        sources: missingAppSources.map((workflow) => ({
          workflowId: workflow.id,
          workflowName: workflow.name,
          appSourceDir: workflow.execution.appSourceDir,
        })),
      },
    });
  }

  const { requiredMissing, optionalMissing } = collectMissingSandboxEnvRefs(workflows, env, dependencies.credentialResolver);
  if (requiredMissing.length > 0) {
    checks.push({
      name: "env:required",
      ok: false,
      required: true,
      message: "One or more required sandbox environment references could not be resolved",
      workflows: [...new Set(requiredMissing.map((item) => item.workflowName))],
      details: { missing: requiredMissing },
    });
  }
  if (optionalMissing.length > 0) {
    checks.push({
      name: "env:optional",
      ok: false,
      required: false,
      message: "One or more optional sandbox environment references are not set and will be omitted",
      workflows: [...new Set(optionalMissing.map((item) => item.workflowName))],
      details: { missing: optionalMissing },
    });
  }

  return {
    ok: checks.every((check) => check.ok || !check.required),
    checks,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      output[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  );
  return output;
}

export async function runWorkflowFanout(
  options: WorkflowFanoutOptions,
  dependencies: WorkflowFanoutDependencies = {},
): Promise<WorkflowFanoutResult> {
  const workers = normalizeFanoutWorkerCount(options.workers);
  const matchedWorkflows = resolveWorkflowFanoutSelection(options);
  const { workflows, selection } = resolveWorkflowFanoutBatch(matchedWorkflows, options);
  const {
    runTestingWorkflow: runOne = runTestingWorkflow,
    preflight: preflightOverride,
    providerApiKeyResolver,
    commandExists,
    credentialResolver,
    env,
    ...workflowDependencies
  } = dependencies;
  const preflight = preflightOverride
    ? await preflightOverride(workflows)
    : await checkWorkflowFanoutReadiness(workflows, {
        providerApiKeyResolver,
        commandExists,
        credentialResolver,
        env,
      });

  if (!options.dryRun && !preflight.ok) {
    const error = `Preflight failed: ${summarizePreflightFailures(preflight)}`;
    return {
      status: "failed",
      workers,
      selection,
      total: workflows.length,
      passed: 0,
      failed: workflows.length,
      preflight,
      items: workflows.map((workflow) => ({
        workflowId: workflow.id,
        workflowName: workflow.name,
        status: "failed",
        error,
      })),
    };
  }

  const items = await mapWithConcurrency(workflows, workers, async (workflow): Promise<WorkflowFanoutItem> => {
    try {
      const output = await runOne(workflow.id, {
        url: options.url,
        model: options.model,
        headed: options.headed,
        parallel: options.parallel,
        timeout: options.timeout,
        dryRun: options.dryRun,
      }, workflowDependencies);

      if (options.dryRun) {
        return {
          workflowId: workflow.id,
          workflowName: workflow.name,
          status: "dry-run",
          plan: output.plan,
        };
      }

      return {
        workflowId: workflow.id,
        workflowName: workflow.name,
        status: "passed",
        sandboxId: output.sandboxResult?.sandboxId,
        sessionId: output.sandboxResult?.sessionId,
        exitCode: output.sandboxResult?.exitCode,
        stdout: output.sandboxResult?.stdout,
        stderr: output.sandboxResult?.stderr,
      };
    } catch (error) {
      return {
        workflowId: workflow.id,
        workflowName: workflow.name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const failed = items.filter((item) => item.status === "failed").length;
  const passed = items.filter((item) => item.status === "passed").length;
  const dryRun = options.dryRun === true;

  return {
    status: dryRun ? "dry-run" : failed > 0 ? "failed" : "passed",
    workers,
    selection,
    total: items.length,
    passed,
    failed,
    items,
    preflight,
  };
}

function groupWorkflowsByProvider(workflows: TestingWorkflow[]): Map<string, TestingWorkflow[]> {
  const byProvider = new Map<string, TestingWorkflow[]>();
  for (const workflow of workflows) {
    const provider = workflow.execution.provider ?? "e2b";
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), workflow]);
  }
  return byProvider;
}

async function resolveProviderApiKey(
  provider: string,
  env: Record<string, string | undefined>,
  resolver: WorkflowFanoutPreflightDependencies["providerApiKeyResolver"],
): Promise<string | undefined> {
  if (resolver) return resolver(provider, env);

  const envKey = PROVIDER_ENV_KEYS[provider];
  if (envKey && env[envKey]) return env[envKey];

  try {
    const mod = await import("@hasna/sandboxes") as unknown as {
      getProviderApiKey?: (provider: "e2b" | "daytona" | "modal") => string | undefined;
    };
    if (provider === "e2b" || provider === "daytona" || provider === "modal") {
      return mod.getProviderApiKey?.(provider);
    }
  } catch {
    // The sandbox SDK may be externalized in builds or unavailable in focused tests.
  }

  return undefined;
}

function defaultCommandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function normalizeOptionalPositiveInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeOptionalNonNegativeInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return normalized;
}

function collectMissingSandboxEnvRefs(
  workflows: TestingWorkflow[],
  env: Record<string, string | undefined>,
  credentialResolver: WorkflowFanoutPreflightDependencies["credentialResolver"],
): {
  requiredMissing: Array<{ workflowId: string; workflowName: string; key: string; reference: string }>;
  optionalMissing: Array<{ workflowId: string; workflowName: string; key: string; reference: string }>;
} {
  const requiredMissing: Array<{ workflowId: string; workflowName: string; key: string; reference: string }> = [];
  const optionalMissing: Array<{ workflowId: string; workflowName: string; key: string; reference: string }> = [];

  for (const workflow of workflows) {
    for (const [key, value] of Object.entries(workflow.execution.env ?? {})) {
      if (value.startsWith("$?")) {
        const name = value.slice(2).trim();
        if (name && env[name] === undefined) {
          optionalMissing.push({ workflowId: workflow.id, workflowName: workflow.name, key, reference: value });
        }
        continue;
      }

      if (!isResolvableEnvReference(value)) continue;
      if (resolveSandboxEnvReference(value, env, credentialResolver) === null) {
        requiredMissing.push({ workflowId: workflow.id, workflowName: workflow.name, key, reference: value });
      }
    }
  }

  return { requiredMissing, optionalMissing };
}

function isResolvableEnvReference(value: string): boolean {
  return value.startsWith("$") || value.startsWith("@secrets:");
}

function resolveSandboxEnvReference(
  value: string,
  env: Record<string, string | undefined>,
  credentialResolver: WorkflowFanoutPreflightDependencies["credentialResolver"],
): string | null {
  if (value.startsWith("$")) {
    const varName = value.slice(1).trim();
    return varName ? env[varName] ?? null : null;
  }

  return (credentialResolver ?? resolveCredential)(value);
}

function summarizePreflightFailures(preflight: WorkflowFanoutPreflightResult): string {
  const requiredFailures = preflight.checks.filter((check) => !check.ok && check.required);
  return requiredFailures.length > 0
    ? requiredFailures.map((check) => check.message).join("; ")
    : "required checks did not pass";
}
