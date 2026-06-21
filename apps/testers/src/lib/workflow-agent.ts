import { getTestingWorkflow } from "../db/workflows.js";
import { getResultsByRun } from "../db/results.js";
import { getScenario, listScenarios } from "../db/scenarios.js";
import { listPersonas } from "../db/personas.js";
import {
  reportTesterIssueReportsToTodos,
  TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
} from "./todos-connector.js";
import { runByFilter } from "./runner.js";
import { loadAiSdkToolLoopHelpers, runAiSdkToolLoop } from "./ai-sdk-runtime.js";
import type { Result, Run, TestingWorkflow } from "../types/index.js";

export interface WorkflowGoalAction {
  type: "todo" | "note";
  title: string;
  description: string;
  todoTaskId?: string;
  skippedReason?: string;
}

export interface WorkflowGoalLoopResult {
  workflow: TestingWorkflow;
  status: "passed" | "failed";
  iterations: number;
  runs: Run[];
  actions: WorkflowGoalAction[];
  reasoning: string;
}

export interface WorkflowGoalLoopOptions {
  url: string;
  model?: string;
  parallel?: number;
  headed?: boolean;
  dryRun?: boolean;
  aiGenerate?: typeof generateWorkflowActionsWithAi;
}

export async function runWorkflowGoalLoop(
  workflowId: string,
  options: WorkflowGoalLoopOptions,
): Promise<WorkflowGoalLoopResult> {
  const workflow = getTestingWorkflow(workflowId);
  if (!workflow) throw new Error(`Testing workflow not found: ${workflowId}`);
  if (!workflow.goal) throw new Error(`Testing workflow has no goal: ${workflow.name}`);

  const maxIterations = workflow.goal.maxIterations;
  const runs: Run[] = [];
  const actions: WorkflowGoalAction[] = [];
  let lastResults: Result[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const { run, results } = options.dryRun
      ? await createDryRun(workflow, options.url)
      : await runByFilter({
          url: options.url,
          projectId: workflow.projectId ?? undefined,
          scenarioIds: workflow.scenarioFilter.scenarioIds,
          tags: workflow.scenarioFilter.tags,
          priority: workflow.scenarioFilter.priority,
          personaIds: workflow.personaIds.length > 0 ? workflow.personaIds : undefined,
          parallel: options.parallel,
          headed: options.headed,
          model: options.model,
        });

    runs.push(run);
    lastResults = results.length > 0 ? results : getResultsByRun(run.id);
    if (run.status === "passed") {
      return {
        workflow,
        status: "passed",
        iterations: iteration,
        runs,
        actions,
        reasoning: `Workflow goal passed after ${iteration} iteration${iteration === 1 ? "" : "s"}.`,
      };
    }

    const generate = options.aiGenerate ?? (options.dryRun ? generateDryRunActions : generateWorkflowActionsWithAi);
    const planned = await generate({
      workflow,
      run,
      results: lastResults,
      model: options.model,
    });
    actions.push(...planned);

    if (options.dryRun) break;
  }

  return {
    workflow,
    status: "failed",
    iterations: runs.length,
    runs,
    actions,
    reasoning: summarizeFailure(workflow, lastResults),
  };
}

async function generateDryRunActions(input: {
  workflow: TestingWorkflow;
  run: Run;
  results: Result[];
  model?: string;
}): Promise<WorkflowGoalAction[]> {
  return [{
    type: "note",
    title: "Dry-run workflow goal plan",
    description: `Would ask the AI SDK planner to inspect run ${input.run.id} for workflow "${input.workflow.name}" and create open-todos next actions.`,
  }];
}

export async function generateWorkflowActionsWithAi(input: {
  workflow: TestingWorkflow;
  run: Run;
  results: Result[];
  model?: string;
}): Promise<WorkflowGoalAction[]> {
  const { jsonSchema, tool } = await loadAiSdkToolLoopHelpers();
  const actions: WorkflowGoalAction[] = [];
  const scenarios = listScenarios({ projectId: input.workflow.projectId ?? undefined });
  const personas = listPersonas({ projectId: input.workflow.projectId ?? undefined });
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

  const tools = {
    create_todo_task: tool({
      description: "Create an open-todos task for a concrete product or test fix needed to satisfy the workflow goal.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "description"],
        additionalProperties: false,
      }),
      execute: async (args) => {
        const inputArgs = args as { title: string; description: string; priority?: string; tags?: string[] };
        const title = String(inputArgs.title);
        const description = String(inputArgs.description);
        const reported = reportTesterIssueReportsToTodos({
          reports: [{
            schema_version: TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
            title,
            summary: description,
            kind: "unknown",
            severity: typeof inputArgs.priority === "string" ? inputArgs.priority : "high",
            source: {
              tool: "testers",
              run_id: input.run.id,
              project_id: input.workflow.projectId ?? undefined,
              url: input.run.url,
            },
            target: { url: input.run.url },
            failure: { reasoning: description },
            labels: Array.isArray(inputArgs.tags) ? inputArgs.tags.map(String) : ["testers", "workflow"],
            metadata: {
              workflow_id: input.workflow.id,
              workflow_name: input.workflow.name,
              workflow_goal: input.workflow.goal?.prompt,
            },
          }],
          defaultPriority: "high",
          apply: true,
        });
        actions.push({
          type: "todo",
          title,
          description,
          todoTaskId: reported.taskIds[0],
          skippedReason: reported.error,
        });
        return reported;
      },
    }),
    finish_workflow_review: tool({
      description: "Finish the workflow review when all useful todos or notes have been produced.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          reasoning: { type: "string" },
        },
        required: ["reasoning"],
        additionalProperties: false,
      }),
      execute: async (args) => {
        const inputArgs = args as { reasoning: string };
        actions.push({
          type: "note",
          title: "Workflow review",
          description: String(inputArgs.reasoning),
        });
        return { ok: true };
      },
    }),
  };

  const failed = input.results.filter((result) => result.status === "failed" || result.status === "error" || result.status === "flaky");
  const prompt = [
    `Workflow: ${input.workflow.name}`,
    `Goal: ${input.workflow.goal?.prompt ?? "(none)"}`,
    `Success criteria: ${(input.workflow.goal?.successCriteria ?? []).join("; ") || "(none)"}`,
    `Target URL: ${input.run.url}`,
    `Run status: ${input.run.status} (${input.run.passed}/${input.run.total} passed)`,
    ``,
    `Personas: ${personas.map((persona) => `${persona.shortId}:${persona.name}(${persona.role})`).join(", ") || "(none)"}`,
    ``,
    `Failures:`,
    ...failed.map((result) => {
      const scenario = scenarioById.get(result.scenarioId) ?? getScenario(result.scenarioId);
      return [
        `- ${scenario?.shortId ?? result.scenarioId}: ${scenario?.name ?? result.scenarioId}`,
        `  status: ${result.status}`,
        result.error ? `  error: ${result.error}` : null,
        result.reasoning ? `  reasoning: ${result.reasoning}` : null,
      ].filter(Boolean).join("\n");
    }),
    ``,
    `Create todos only for concrete next actions that would help satisfy the workflow goal. Finish with finish_workflow_review.`,
  ].join("\n");

  await runAiSdkToolLoop({
    model: input.model,
    tools,
    finishToolName: "finish_workflow_review",
    prompt,
    maxRetries: 1,
  });

  return actions;
}

function summarizeFailure(workflow: TestingWorkflow, results: Result[]): string {
  const failed = results.filter((result) => result.status === "failed" || result.status === "error" || result.status === "flaky");
  return `Workflow goal did not pass within ${workflow.goal?.maxIterations ?? 0} iteration(s). ${failed.length} result(s) still need attention.`;
}

async function createDryRun(workflow: TestingWorkflow, url: string): Promise<{ run: Run; results: Result[] }> {
  const now = new Date().toISOString();
  return {
    run: {
      id: "dry-run",
      projectId: workflow.projectId,
      status: "failed",
      url,
      model: "dry-run",
      headed: false,
      parallel: 1,
      total: workflow.scenarioFilter.scenarioIds?.length ?? 0,
      passed: 0,
      failed: workflow.scenarioFilter.scenarioIds?.length ?? 0,
      startedAt: now,
      finishedAt: now,
      metadata: { dryRun: true },
      isBaseline: false,
      samples: 1,
      flakinessThreshold: 0.95,
      prNumber: null,
      prTitle: null,
      prBranch: null,
      prBaseBranch: null,
      prCommitSha: null,
      prUrl: null,
      ghAppInstallationId: null,
    },
    results: [],
  };
}
