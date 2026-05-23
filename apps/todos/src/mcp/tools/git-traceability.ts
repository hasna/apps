import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerGitTraceabilityTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("link_task_git_trace")) {
    server.tool(
      "link_task_git_trace",
      "Link a task to local git context: commit, branch, changed files, optional PR and CI snapshot.",
      {
        task_id: z.string(),
        sha: z.string().optional(),
        branch: z.string().optional(),
        pr_url: z.string().optional(),
        pr_number: z.number().optional(),
        pr_state: z.string().optional(),
        release_tag: z.string().optional(),
        ci_snapshot_path: z.string().optional(),
        cwd: z.string().optional(),
      },
      async (params) => {
        try {
          const { linkTaskGitTrace } = await import("../../lib/git-traceability.js");
          const taskId = resolveId(params.task_id, "tasks") ?? params.task_id;
          const commit = linkTaskGitTrace({ ...params, task_id: taskId });
          return { content: [{ type: "text" as const, text: JSON.stringify(commit, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_traceability")) {
    server.tool(
      "get_task_traceability",
      "Get aggregated git traceability report for a task (commits, branches, PRs, CI, releases).",
      {
        task_id: z.string(),
        format: z.enum(["json", "text"]).optional(),
      },
      async ({ task_id, format }) => {
        try {
          const { getTaskTraceability, formatTraceabilityReport } = await import("../../lib/git-traceability.js");
          const resolvedId = resolveId(task_id, "tasks") ?? task_id;
          const report = getTaskTraceability(resolvedId);
          const text = format === "text"
            ? formatTraceabilityReport(report)
            : JSON.stringify(report, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("inspect_git_commit")) {
    server.tool(
      "inspect_git_commit",
      "Inspect a local git commit (message, author, files, branch).",
      {
        sha: z.string(),
        cwd: z.string().optional(),
      },
      async ({ sha, cwd }) => {
        try {
          const { inspectGitCommit } = await import("../../lib/git-traceability.js");
          const info = inspectGitCommit(sha, cwd);
          if (!info) return { content: [{ type: "text" as const, text: `Commit not found: ${sha}` }] };
          return { content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
