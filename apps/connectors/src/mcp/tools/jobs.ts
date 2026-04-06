import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../../db/database.js";
import { listJobs, getJobByName, getLatestRun } from "../../db/jobs.js";
import { listWorkflows, getWorkflowByName } from "../../db/workflows.js";
import { runWorkflow } from "../../lib/workflow-runner.js";
import { triggerJob } from "../../lib/scheduler.js";

export function registerJobsTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: list_jobs ---
  server.registerTool(
    "list_jobs",
    {
      title: "List Jobs",
      description: "List scheduled connector jobs.",
      inputSchema: {},
    },
    async () => {
      const db = getDatabase();
      const jobs = listJobs(db);
      return stripped(JSON.stringify(jobs, null, 2));
    }
  );

  // --- Tool: get_latest_job_run ---
  server.registerTool(
    "get_latest_job_run",
    {
      title: "Get Latest Job Run",
      description: "Get the most recent run output for a job.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Job "${name}" not found` }) }], isError: true };
      const run = getLatestRun(job.id, db);
      return stripped(JSON.stringify(run ?? { message: "No runs yet" }, null, 2));
    }
  );

  // --- Tool: run_job ---
  server.registerTool(
    "run_job",
    {
      title: "Run Job",
      description: "Manually trigger a scheduled job.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Job "${name}" not found` }) }], isError: true };
      const result = await triggerJob(job, db);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: list_workflows ---
  server.registerTool(
    "list_workflows",
    {
      title: "List Workflows",
      description: "List connector workflows.",
      inputSchema: {},
    },
    async () => {
      const db = getDatabase();
      const workflows = listWorkflows(db);
      return stripped(JSON.stringify(workflows, null, 2));
    }
  );

  // --- Tool: run_workflow ---
  server.registerTool(
    "run_workflow",
    {
      title: "Run Workflow",
      description: "Execute a connector workflow pipeline.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const db = getDatabase();
      const wf = getWorkflowByName(name, db);
      if (!wf) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Workflow "${name}" not found` }) }], isError: true };
      const result = await runWorkflow(wf);
      return stripped(JSON.stringify(result, null, 2));
    }
  );
}
