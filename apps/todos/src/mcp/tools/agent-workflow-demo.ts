import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerAgentWorkflowDemoTools(
  server: McpServer,
  { shouldRegisterTool, formatError }: Helpers,
): void {
  if (shouldRegisterTool("run_agent_workflow_demo")) {
    server.tool(
      "run_agent_workflow_demo",
      "Run a scripted local agent workflow demo (agents, projects, tasks, runs) using an ephemeral database.",
      {
        agent_name: z.string().optional().describe("Demo agent name (default: demoagent)"),
        project_name: z.string().optional().describe("Demo project name"),
        persist: z.boolean().optional().describe("Use temp file DB instead of in-memory"),
        format: z.enum(["json", "text"]).optional().describe("Output format (default: text)"),
      },
      async (params) => {
        try {
          const {
            runAgentWorkflowDemo,
            formatAgentWorkflowDemoReport,
          } = await import("../../lib/agent-workflow-demo.js");
          const result = runAgentWorkflowDemo({
            agent_name: params.agent_name,
            project_name: params.project_name,
            persist: params.persist,
          });
          const text = params.format === "json"
            ? JSON.stringify(result, null, 2)
            : formatAgentWorkflowDemoReport(result);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_agent_workflow_demo_docs")) {
    server.tool(
      "get_agent_workflow_demo_docs",
      "Quickstart docs for the one-command local agent workflow demo.",
      {},
      async () => {
        try {
          const { getAgentWorkflowDemoDocs } = await import("../../lib/agent-workflow-demo.js");
          return { content: [{ type: "text" as const, text: getAgentWorkflowDemoDocs() }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
