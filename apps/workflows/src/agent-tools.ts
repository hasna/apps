/**
 * MCP tool registry for @hasna/workflows — the agent interface layer over
 * WorkflowsService. Slice 1 ships identity/health tools; the graph language,
 * store, and daemon slices add their tools here.
 */
import type { WorkflowsService } from "./service.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown> };
}

export interface ToolCallResult {
  content: { type: "text"; text: string }[];
  isError: boolean;
}

function textResult(payload: unknown): ToolCallResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false };
}

export function workflowsTools(_service: WorkflowsService): McpTool[] {
  return [
    {
      name: "workflows_version",
      description: "Report the installed @hasna/workflows version.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "workflows_health",
      description: "Report the workflows service health (service, version, pid, uptime).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "workflows_ready",
      description: "Report the workflows service readiness (version check).",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

export function callWorkflowTool(service: WorkflowsService, name: string, _args: Record<string, unknown>): ToolCallResult {
  switch (name) {
    case "workflows_version":
      return textResult({ service: service.name, version: service.version });
    case "workflows_health":
      return textResult(service.health());
    case "workflows_ready":
      return textResult(service.ready());
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
