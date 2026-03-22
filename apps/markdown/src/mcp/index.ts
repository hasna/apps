#!/usr/bin/env bun
// OMP MCP Server — expose OMP tools to AI agents

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parseFromFile, parseFromString, validate, compile, run } from "../lib/pipeline.js";
import { validateAndLint } from "../validator/validate.js";

const server = new Server(
  { name: "omp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── List Tools ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "omp_validate",
      description: "Validate an OMP document against the spec. Pass either file path or raw content.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "Path to .omp.md file" },
          content: { type: "string", description: "Raw OMP document content (alternative to file)" },
        },
      },
    },
    {
      name: "omp_inspect",
      description: "Parse an OMP document and return its structure: cards, types, dependencies, execution plan.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "Path to .omp.md file" },
          content: { type: "string", description: "Raw OMP document content" },
        },
      },
    },
    {
      name: "omp_compile",
      description: "Parse an OMP document and return the execution plan as JSON (DAG with parallel groups).",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "Path to .omp.md file" },
          content: { type: "string", description: "Raw OMP document content" },
        },
      },
    },
    {
      name: "omp_lint",
      description: "Validate + lint an OMP document for errors and best practice warnings.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "Path to .omp.md file" },
          content: { type: "string", description: "Raw OMP document content" },
        },
      },
    },
    {
      name: "omp_run",
      description: "Execute an OMP document through the full pipeline. Use dry_run=true to preview without executing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "Path to .omp.md file" },
          output_dir: { type: "string", description: "Output directory (default: .)" },
          dry_run: { type: "boolean", description: "Preview without executing (default: true)" },
        },
        required: ["file"],
      },
    },
  ],
}));

// ─── Call Tool ───────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "omp_validate": {
        const doc = args?.file
          ? parseFromFile(args.file as string)
          : parseFromString((args?.content as string) ?? "");
        const errors = validate(doc);
        const errorCount = errors.filter((e) => e.level === "error").length;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              valid: errorCount === 0,
              cards: doc.cards.length,
              errors: errors.filter((e) => e.level === "error"),
              warnings: errors.filter((e) => e.level === "warning"),
            }, null, 2),
          }],
        };
      }

      case "omp_inspect": {
        const doc = args?.file
          ? parseFromFile(args.file as string)
          : parseFromString((args?.content as string) ?? "");
        const plan = compile(doc);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              title: doc.title,
              cards: doc.cards.map((c) => ({
                type: c.type,
                id: c.id,
                depends: c.depends,
                accepts: c.accepts,
                headerKeys: Object.keys(c.headers),
                inlineDirectives: c.body.inlineDirectives.length,
                tables: c.body.tables.length,
              })),
              patterns: doc.patterns.length,
              executionPlan: plan,
            }, null, 2),
          }],
        };
      }

      case "omp_compile": {
        const doc = args?.file
          ? parseFromFile(args.file as string)
          : parseFromString((args?.content as string) ?? "");
        const plan = compile(doc);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(plan, null, 2),
          }],
        };
      }

      case "omp_lint": {
        const doc = args?.file
          ? parseFromFile(args.file as string)
          : parseFromString((args?.content as string) ?? "");
        const issues = validateAndLint(doc);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              cards: doc.cards.length,
              errors: issues.filter((e) => e.level === "error"),
              warnings: issues.filter((e) => e.level === "warning"),
              info: issues.filter((e) => e.level === "info"),
            }, null, 2),
          }],
        };
      }

      case "omp_run": {
        const file = args?.file as string;
        if (!file) throw new Error("file is required");
        const result = await run(file, {
          outputDir: (args?.output_dir as string) ?? ".",
          dryRun: (args?.dry_run as boolean) ?? true,
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{
        type: "text" as const,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }],
      isError: true,
    };
  }
});

// ─── Start ───────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
