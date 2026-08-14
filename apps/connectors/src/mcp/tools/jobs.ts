import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../../db/database.js";
import { listJobs, getJobByName, getLatestRun } from "../../db/jobs.js";
import { listWorkflows, getWorkflowByName } from "../../db/workflows.js";
import { runWorkflow, type WorkflowResult } from "../../lib/workflow-runner.js";
import { triggerJob } from "../../lib/scheduler.js";
import {
  DEFAULT_MCP_LIMIT,
  maybeTruncateOutput,
  normalizeLimit,
  pageItems,
  parseCursor,
  truncateText,
} from "../../lib/compact-output.js";

const DEFAULT_EXECUTION_OUTPUT_CHARS = 2000;
const MAX_EXECUTION_OUTPUT_CHARS = 50_000;

type JobExecutionResult = Awaited<ReturnType<typeof triggerJob>>;
type ExecutionCompactOptions = {
  verbose?: boolean;
  maxOutputChars?: number;
};

function normalizeOutputChars(value: number | undefined): number {
  return normalizeLimit(
    value,
    DEFAULT_EXECUTION_OUTPUT_CHARS,
    MAX_EXECUTION_OUTPUT_CHARS
  );
}

function compactExecutionText(
  text: string,
  options: ExecutionCompactOptions,
  label: string
) {
  return maybeTruncateOutput(text, {
    enabled: !options.verbose,
    maxChars: normalizeOutputChars(options.maxOutputChars),
    hint: `Set verbose=true or maxOutputChars higher for full ${label} output.`,
  });
}

export function compactJobExecutionResult(
  result: JobExecutionResult,
  options: ExecutionCompactOptions = {}
) {
  const output = compactExecutionText(result.output, options, "job");
  return {
    ...result,
    output: output.text,
    outputTruncated: output.truncated,
    hint: options.verbose
      ? undefined
      : "MCP job output is compact by default. Set verbose=true or maxOutputChars for more output.",
  };
}

export function compactWorkflowExecutionResult(
  result: WorkflowResult,
  options: ExecutionCompactOptions = {}
) {
  let truncatedOutputs = 0;
  const steps = result.steps.map((step) => {
    const output = compactExecutionText(step.output, options, "workflow step");
    if (output.truncated) truncatedOutputs++;
    return {
      ...step,
      output: output.text,
      outputTruncated: output.truncated,
    };
  });
  const finalOutput = compactExecutionText(result.final_output, options, "workflow final");
  if (finalOutput.truncated) truncatedOutputs++;

  return {
    ...result,
    steps,
    final_output: finalOutput.text,
    finalOutputTruncated: finalOutput.truncated,
    truncatedOutputs,
    hint: options.verbose
      ? undefined
      : "MCP workflow output is compact by default. Set verbose=true or maxOutputChars for more output.",
  };
}

export function registerJobsTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: list_jobs ---
  server.registerTool(
    "list_jobs",
    {
      title: "List Jobs",
      description: "List scheduled connector jobs with compact, paged defaults.",
      inputSchema: {
        limit: z.number().optional(),
        cursor: z.string().optional(),
        verbose: z.boolean().optional(),
      },
    },
    async ({ limit, cursor, verbose }) => {
      const parsedCursor = parseCursor(cursor);
      if (parsedCursor.error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: parsedCursor.error }) }], isError: true };
      }
      const db = getDatabase();
      const jobs = listJobs(db);
      const page = pageItems(jobs, {
        offset: parsedCursor.value ?? 0,
        limit: normalizeLimit(limit, DEFAULT_MCP_LIMIT),
      });
      const data = verbose
        ? page.items
        : page.items.map((job) => ({
            name: job.name,
            connector: job.connector,
            command: `${job.command}${job.args.length ? ` ${job.args.join(" ")}` : ""}`,
            cron: job.cron,
            enabled: job.enabled,
            strip: job.strip,
            lastRunAt: job.last_run_at,
          }));
      return stripped(JSON.stringify({
        jobs: data,
        total: jobs.length,
        count: data.length,
        nextCursor: page.nextOffset === null ? null : String(page.nextOffset),
        hint: "Use verbose=true for full job records, get_latest_job_run for run output, or connectors jobs show <name>.",
      }, null, 2));
    }
  );

  // --- Tool: get_latest_job_run ---
  server.registerTool(
    "get_latest_job_run",
    {
      title: "Get Latest Job Run",
      description: "Get the most recent run output for a job. Output is truncated unless verbose=true.",
      inputSchema: {
        name: z.string(),
        verbose: z.boolean().optional(),
        maxOutputChars: z.number().optional(),
      },
    },
    async ({ name, verbose, maxOutputChars }) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Job "${name}" not found` }) }], isError: true };
      const run = getLatestRun(job.id, db);
      if (!run) return stripped(JSON.stringify({ message: "No runs yet" }, null, 2));
      const outputLimit = normalizeLimit(maxOutputChars, 2000, 50_000);
      return stripped(JSON.stringify({
        ...run,
        raw_output: run.raw_output && !verbose ? truncateText(run.raw_output, outputLimit) : run.raw_output,
        stripped_output: run.stripped_output && !verbose ? truncateText(run.stripped_output, outputLimit) : run.stripped_output,
        hint: verbose ? undefined : "Long run output is truncated in MCP. Use verbose=true or maxOutputChars for more output.",
      }, null, 2));
    }
  );

  // --- Tool: run_job ---
  server.registerTool(
    "run_job",
    {
      title: "Run Job",
      description: "Manually trigger a scheduled job.",
      inputSchema: {
        name: z.string(),
        verbose: z.boolean().optional().describe("Return full job output without truncation."),
        maxOutputChars: z.number().optional().describe("Maximum output characters when verbose is false (default: 2000)."),
      },
    },
    async ({ name, verbose, maxOutputChars }) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Job "${name}" not found` }) }], isError: true };
      const result = await triggerJob(job, db);
      return stripped(JSON.stringify(compactJobExecutionResult(result, { verbose, maxOutputChars }), null, 2));
    }
  );

  // --- Tool: list_workflows ---
  server.registerTool(
    "list_workflows",
    {
      title: "List Workflows",
      description: "List connector workflows with compact, paged defaults.",
      inputSchema: {
        limit: z.number().optional(),
        cursor: z.string().optional(),
        verbose: z.boolean().optional(),
      },
    },
    async ({ limit, cursor, verbose }) => {
      const parsedCursor = parseCursor(cursor);
      if (parsedCursor.error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: parsedCursor.error }) }], isError: true };
      }
      const db = getDatabase();
      const workflows = listWorkflows(db);
      const page = pageItems(workflows, {
        offset: parsedCursor.value ?? 0,
        limit: normalizeLimit(limit, DEFAULT_MCP_LIMIT),
      });
      const data = verbose
        ? page.items
        : page.items.map((workflow) => ({
            name: workflow.name,
            enabled: workflow.enabled,
            stepCount: workflow.steps.length,
            steps: workflow.steps.slice(0, 5).map((step) => ({
              connector: step.connector,
              command: step.command,
            })),
          }));
      return stripped(JSON.stringify({
        workflows: data,
        total: workflows.length,
        count: data.length,
        nextCursor: page.nextOffset === null ? null : String(page.nextOffset),
        hint: "Use verbose=true for full workflow records, or connectors workflows show <name>.",
      }, null, 2));
    }
  );

  // --- Tool: run_workflow ---
  server.registerTool(
    "run_workflow",
    {
      title: "Run Workflow",
      description: "Execute a connector workflow pipeline.",
      inputSchema: {
        name: z.string(),
        verbose: z.boolean().optional().describe("Return full workflow step output without truncation."),
        maxOutputChars: z.number().optional().describe("Maximum output characters per output field when verbose is false (default: 2000)."),
      },
    },
    async ({ name, verbose, maxOutputChars }) => {
      const db = getDatabase();
      const wf = getWorkflowByName(name, db);
      if (!wf) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Workflow "${name}" not found` }) }], isError: true };
      const result = await runWorkflow(wf);
      return stripped(JSON.stringify(compactWorkflowExecutionResult(result, { verbose, maxOutputChars }), null, 2));
    }
  );
}
