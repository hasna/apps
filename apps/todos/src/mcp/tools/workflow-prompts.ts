import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listWorkflowPrompts,
  renderWorkflowPrompt,
} from "../../lib/workflow-prompts.js";

export function registerWorkflowPrompts(server: McpServer): void {
  server.resource(
    "workflow-prompts",
    "todos://workflow-prompts",
    { description: "Local workflow prompt catalog", mimeType: "application/json" },
    async () => ({
      contents: [{
        uri: "todos://workflow-prompts",
        mimeType: "application/json",
        text: JSON.stringify(listWorkflowPrompts(), null, 2),
      }],
    }),
  );

  const argsSchema = {
    objective: z.string().optional(),
    task_id: z.string().optional(),
    agent_id: z.string().optional(),
    context: z.string().optional(),
  };

  for (const prompt of listWorkflowPrompts()) {
    server.prompt(
      prompt.id,
      prompt.description,
      argsSchema,
      (args) => ({
        description: prompt.description,
        messages: renderWorkflowPrompt(prompt.id, args).messages,
      }),
    );
  }
}
