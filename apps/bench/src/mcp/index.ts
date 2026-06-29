#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createBenchSDK, type BenchSDK } from "../sdk/index.js";
import { VERSION } from "../lib/version.js";

const suiteIdArgsSchema = z.object({ id: z.string().min(1) }).strict();
const manifestValidateArgsSchema = z.object({
  manifest: z.unknown()
}).strict();
const planArgsSchema = z.object({
  benchmarkId: z.string().min(1),
  modelId: z.string().min(1),
  provider: z.string().min(1),
  route: z.string().min(1).optional()
}).strict();
const runIdArgsSchema = z.object({ runId: z.string().min(1) }).strict();
const compareArgsSchema = z.object({
  leftRunId: z.string().min(1),
  rightRunId: z.string().min(1),
  metricId: z.string().min(1).optional()
}).strict();

const toolSchemas = {
  bench_suites_list: z.object({}).strict(),
  bench_suites_show: suiteIdArgsSchema,
  bench_manifest_validate: manifestValidateArgsSchema,
  bench_plan: planArgsSchema,
  bench_results_list: z.object({}).strict(),
  bench_results_show: runIdArgsSchema,
  bench_compare: compareArgsSchema,
  bench_report: z.object({}).strict(),
  bench_doctor: z.object({}).strict()
} as const;

export type BenchMcpToolName = keyof typeof toolSchemas;

const tools = [
  {
    name: "bench_suites_list",
    description: "List built-in benchmark suite manifests",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "bench_suites_show",
    description: "Show one built-in benchmark suite manifest",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "bench_manifest_validate",
    description: "Validate a benchmark manifest from a JSON object supplied in the MCP request",
    inputSchema: {
      type: "object",
      properties: {
        manifest: {}
      },
      required: ["manifest"],
      additionalProperties: false
    }
  },
  {
    name: "bench_plan",
    description: "Create a dry-run benchmark execution plan without running a benchmark",
    inputSchema: {
      type: "object",
      properties: {
        benchmarkId: { type: "string" },
        modelId: { type: "string" },
        provider: { type: "string" },
        route: { type: "string" }
      },
      required: ["benchmarkId", "modelId", "provider"],
      additionalProperties: false
    }
  },
  {
    name: "bench_results_list",
    description: "List local benchmark result summaries",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "bench_results_show",
    description: "Show one local benchmark result",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" } },
      required: ["runId"],
      additionalProperties: false
    }
  },
  {
    name: "bench_compare",
    description: "Compare metric values between two local benchmark results",
    inputSchema: {
      type: "object",
      properties: {
        leftRunId: { type: "string" },
        rightRunId: { type: "string" },
        metricId: { type: "string" }
      },
      required: ["leftRunId", "rightRunId"],
      additionalProperties: false
    }
  },
  {
    name: "bench_report",
    description: "Summarize local benchmark storage",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "bench_doctor",
    description: "Check local open-bench storage and configuration",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
] as const;

export function buildServer(sdk: BenchSDK = createBenchSDK()): Server {
  const server = new Server(
    { name: "bench", version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name as BenchMcpToolName;
    const result = await callBenchTool(sdk, name, request.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

export async function callBenchTool(sdk: BenchSDK, name: BenchMcpToolName, args: unknown): Promise<unknown> {
  try {
    const schema = toolSchemas[name];
    if (!schema) throw new Error(`Unknown tool: ${name}`);
    const parsed = schema.parse(args);

    switch (name) {
      case "bench_suites_list":
        return { ok: true, suites: sdk.listSuites() };
      case "bench_suites_show":
        return { ok: true, suite: sdk.showSuite((parsed as z.infer<typeof suiteIdArgsSchema>).id) };
      case "bench_manifest_validate": {
        const input = parsed as z.infer<typeof manifestValidateArgsSchema>;
        return { ok: true, manifest: sdk.validateManifest(input.manifest) };
      }
      case "bench_plan":
        return sdk.plan(parsed as z.infer<typeof planArgsSchema>);
      case "bench_results_list":
        return { ok: true, results: await sdk.listResults() };
      case "bench_results_show":
        return { ok: true, result: await sdk.showResult((parsed as z.infer<typeof runIdArgsSchema>).runId) };
      case "bench_compare": {
        const input = parsed as z.infer<typeof compareArgsSchema>;
        return sdk.compareResults(input.leftRunId, input.rightRunId, input.metricId);
      }
      case "bench_report":
        return sdk.report();
      case "bench_doctor":
        return sdk.doctor();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function listBenchTools(): typeof tools {
  return tools;
}

function printHelp(): void {
  console.log(`Usage: bench-mcp [options]

Runs the @hasna/bench MCP server over stdio.

Options:
  -V, --version      output the version number
  -h, --help         display help for command`);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
