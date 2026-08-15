import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerProjectBootstrapTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("discover_workspace")) {
    server.tool(
      "discover_workspace",
      "Discover local git root, project name, and todos paths for the current workspace.",
      { cwd: z.string().optional() },
      async ({ cwd }) => {
        try {
          const { discoverWorkspace } = await import("../../lib/project-bootstrap.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(discoverWorkspace(cwd), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("bootstrap_workspace")) {
    server.tool(
      "bootstrap_workspace",
      "Bootstrap local todos project: register identity, default task list, todos.md, manifest.",
      {
        cwd: z.string().optional(),
        project_name: z.string().optional(),
        init_todos_md: z.boolean().optional(),
        task_list_slug: z.string().optional(),
      },
      async (params) => {
        try {
          const { bootstrapWorkspace, discoverWorkspace, formatBootstrapReport } = await import("../../lib/project-bootstrap.js");
          const result = bootstrapWorkspace(params);
          const discovery = discoverWorkspace(params.cwd);
          return { content: [{ type: "text" as const, text: formatBootstrapReport(result, discovery) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_bootstrap_status")) {
    server.tool(
      "get_bootstrap_status",
      "Check whether the current workspace has been bootstrapped.",
      { cwd: z.string().optional() },
      async ({ cwd }) => {
        try {
          const { getBootstrapStatus } = await import("../../lib/project-bootstrap.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(getBootstrapStatus(cwd), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
