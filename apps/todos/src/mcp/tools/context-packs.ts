import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerContextPackTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("build_context_pack")) {
    server.tool(
      "build_context_pack",
      "Generate local agent context pack (JSON + Markdown prompt bundle) for a task, project, or plan.",
      {
        task_id: z.string().optional(),
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        format: z.enum(["json", "markdown", "both"]).optional(),
        redact: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { buildContextPack, formatContextPackJson, formatContextPackMarkdown } = await import("../../lib/context-packs.js");
          const taskId = params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined;
          const projectId = params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined;
          const pack = buildContextPack({ ...params, task_id: taskId, project_id: projectId });
          const fmt = params.format ?? "both";
          if (fmt === "markdown") return { content: [{ type: "text" as const, text: formatContextPackMarkdown(pack) }] };
          if (fmt === "json") return { content: [{ type: "text" as const, text: formatContextPackJson(pack) }] };
          return { content: [{ type: "text" as const, text: `${formatContextPackMarkdown(pack)}\n\n---\n\n${formatContextPackJson(pack)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  server.resource(
    "todos://context-pack-template",
    "Markdown template describing agent context pack sections",
    async () => ({
      contents: [{
        uri: "todos://context-pack-template",
        mimeType: "text/markdown",
        text: "# Context Pack Sections\n\n- Task state\n- Plan\n- Acceptance criteria\n- Dependencies / blockers\n- Subtasks\n- Files\n- Comments\n- Verification history\n",
      }],
    }),
  );
}
