import { getTestingWorkflow, listTestingWorkflows } from "../db/workflows.js";
import { runTestingWorkflow, type WorkflowRunOptions, type WorkflowRunnerDependencies } from "./workflow-runner.js";
import type { TestingWorkflow } from "../types/index.js";

export interface WorkflowFanoutOptions extends WorkflowRunOptions {
  workflowIds?: string[];
  projectId?: string;
  tags?: string[];
  includeDisabled?: boolean;
  workers?: number;
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
  total: number;
  passed: number;
  failed: number;
  items: WorkflowFanoutItem[];
}

export interface WorkflowFanoutDependencies extends WorkflowRunnerDependencies {
  runTestingWorkflow?: typeof runTestingWorkflow;
}

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
  const workflows = resolveWorkflowFanoutSelection(options);
  const { runTestingWorkflow: runOne = runTestingWorkflow, ...workflowDependencies } = dependencies;

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
    total: items.length,
    passed,
    failed,
    items,
  };
}
