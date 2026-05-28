import { getTestingWorkflow } from "../db/workflows.js";
import { getPersona } from "../db/personas.js";
import { runByFilter, type RunOptions } from "./runner.js";
import type { Result, Run, TestingWorkflow, WorkflowExecutionConfig } from "../types/index.js";

export interface WorkflowRunOptions {
  url: string;
  model?: string;
  headed?: boolean;
  parallel?: number;
  timeout?: number;
  dryRun?: boolean;
}

export interface WorkflowRunPlan {
  workflow: TestingWorkflow;
  runOptions: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] };
  connectorCommand: string[] | null;
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
    connectorCommand: workflow.execution.target === "connector:e2b"
      ? buildConnectorCommand(workflow.execution, runOptions)
      : null,
  };
}

export async function runTestingWorkflow(
  workflowId: string,
  options: WorkflowRunOptions,
): Promise<{ run: Run | null; results: Result[]; plan: WorkflowRunPlan; connectorResult?: string }> {
  const workflow = getTestingWorkflow(workflowId);
  if (!workflow) throw new Error(`Testing workflow not found: ${workflowId}`);
  if (!workflow.enabled) throw new Error(`Testing workflow is disabled: ${workflow.name}`);

  validatePersonaIds(workflow);
  const plan = buildWorkflowRunPlan(workflow, options);
  if (options.dryRun) return { run: null, results: [], plan };

  if (workflow.execution.target === "connector:e2b") {
    const connectorResult = await runViaConnector(plan);
    return { run: null, results: [], plan, connectorResult };
  }

  const { run, results } = await runByFilter(plan.runOptions);
  return { run, results, plan };
}

function validatePersonaIds(workflow: TestingWorkflow): void {
  for (const personaId of workflow.personaIds) {
    if (!getPersona(personaId)) {
      throw new Error(`Persona not found for workflow ${workflow.name}: ${personaId}`);
    }
  }
}

function buildConnectorCommand(
  execution: WorkflowExecutionConfig,
  runOptions: RunOptions & { tags?: string[]; priority?: string; scenarioIds?: string[] },
): string[] {
  const connector = execution.connector ?? "e2b";
  const operation = execution.operation ?? "run";
  const payload = JSON.stringify({
    operation,
    template: execution.sandboxTemplate,
    timeoutMs: execution.timeoutMs,
    env: execution.env ?? {},
    command: [
      "bunx",
      "@hasna/testers",
      "run",
      runOptions.url,
      ...(runOptions.scenarioIds?.length ? ["--scenario", runOptions.scenarioIds.join(",")] : []),
      ...(runOptions.tags?.length ? runOptions.tags.flatMap((tag) => ["--tag", tag]) : []),
      ...(runOptions.priority ? ["--priority", runOptions.priority] : []),
      ...(runOptions.projectId ? ["--project", runOptions.projectId] : []),
      ...(runOptions.model ? ["--model", runOptions.model] : []),
      "--json",
    ],
  });
  return ["connectors", "run", connector, operation, payload];
}

async function runViaConnector(plan: WorkflowRunPlan): Promise<string> {
  if (!plan.connectorCommand) throw new Error("Workflow does not have a connector command");

  const proc = Bun.spawn(plan.connectorCommand, {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Connector execution failed (${exitCode}): ${stderr || stdout}`);
  }
  return stdout.trim();
}
