/**
 * MCP tool registry for @hasna/workflows — the agent interface layer over
 * WorkflowsService. Ships identity/health tools plus the graph language,
 * store, and lane tools.
 */
import { validateGraph, type WorkflowGraph } from "./graph.js";
import { runGraphToCompletion } from "./daemon.js";
import { laneInventory } from "./lanes/index.js";
import { openStore } from "./store.js";
import { SessionWAL } from "./wal.js";
import type { WorkflowsService } from "./service.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
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
    {
      name: "workflows_validate",
      description: "Validate a workflow graph (JSON object with name, version, nodes).",
      inputSchema: {
        type: "object",
        properties: { graph: { type: "object", description: "the workflow graph" } },
        required: ["graph"],
      },
    },
    {
      name: "workflows_run",
      description:
        "Run a workflow graph to a terminal state (bounded cycles; command steps execute; lane steps need the lane substrate).",
      inputSchema: {
        type: "object",
        properties: {
          graph: { type: "object", description: "the workflow graph" },
          context: { type: "object", description: "optional run context" },
        },
        required: ["graph"],
      },
    },
    {
      name: "workflows_runs_list",
      description: "List recent runs from the local store.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "optional status filter" },
          limit: { type: "number", description: "max rows (default 100)" },
        },
      },
    },
    {
      name: "workflows_lanes_list",
      description: "List the four lane adapters with their wired-vs-not-ready-with-reason registry shape.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

export async function callWorkflowTool(service: WorkflowsService, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  switch (name) {
    case "workflows_version":
      return textResult({ service: service.name, version: service.version });
    case "workflows_health":
      return textResult(service.health());
    case "workflows_ready":
      return textResult(service.ready());
    case "workflows_validate": {
      const graph = args.graph as WorkflowGraph;
      const result = validateGraph(graph);
      return textResult(result);
    }
    case "workflows_run": {
      const graph = args.graph as WorkflowGraph;
      const store = openStore(service.config.dataDir);
      const wal = SessionWAL.open(service.config.dataDir);
      try {
        const final = await runGraphToCompletion(store, wal, graph, args.context ?? {});
        return textResult({
          runId: final.id,
          status: final.status,
          error: final.error ?? null,
          result: final.resultJson ? JSON.parse(final.resultJson) : null,
        });
      } finally {
        store.close();
      }
    }
    case "workflows_runs_list": {
      const store = openStore(service.config.dataDir);
      try {
        const status = typeof args.status === "string" ? (args.status as never) : undefined;
        const limit = typeof args.limit === "number" ? args.limit : 100;
        return textResult(store.listRuns({ status, limit }));
      } finally {
        store.close();
      }
    }
    case "workflows_lanes_list":
      return textResult(await laneInventory());
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
