/**
 * Code tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";

interface CodeToolsContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
  formatTask: (task: Task) => string;
}

export function registerCodeTools(server: McpServer, ctx: CodeToolsContext) {
  const { shouldRegisterTool, resolveId, formatError, formatTask } = ctx;

  // === EXTRACT TODOS FROM CODE COMMENTS ===

  if (shouldRegisterTool("extract_todos")) {
    server.tool(
      "extract_todos",
      "Scan source files for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create tasks from them. Deduplicates on re-runs.",
      {
        path: z.string().describe("Directory or file path to scan"),
        project_id: z.string().optional().describe("Project to assign tasks to"),
        task_list_id: z.string().optional().describe("Task list to add tasks to"),
        patterns: z.array(z.enum(["TODO", "FIXME", "HACK", "XXX", "BUG", "NOTE"])).optional().describe("Tags to search for (default: all)"),
        tags: z.array(z.string()).optional().describe("Extra tags to add to created tasks"),
        assigned_to: z.string().optional().describe("Agent to assign tasks to"),
        agent_id: z.string().optional().describe("Agent performing the extraction"),
        dry_run: z.boolean().optional().describe("If true, return found comments without creating tasks"),
        extensions: z.array(z.string()).optional().describe("File extensions to scan (e.g. ['ts', 'py'])"),
      },
      async (params) => {
        try {
          const { extractTodos } = require("../../lib/extract.js") as typeof import("../../lib/extract.js");
          const resolved: Record<string, unknown> = { ...params };
          if (resolved["project_id"]) resolved["project_id"] = resolveId(resolved["project_id"] as string, "projects");
          if (resolved["task_list_id"]) resolved["task_list_id"] = resolveId(resolved["task_list_id"] as string, "task_lists");

          const result = extractTodos(resolved as unknown as Parameters<typeof extractTodos>[0]);

          if (params.dry_run) {
            const lines = result.comments.map((c: any) => `[${c.tag}] ${c.message} — ${c.file}:${c.line}`);
            return { content: [{ type: "text" as const, text: `Found ${result.comments.length} comment(s):\n${lines.join("\n")}` }] };
          }

          const summary = [
            `Created ${result.tasks.length} task(s)`,
            result.skipped > 0 ? `Skipped ${result.skipped} duplicate(s)` : null,
            `Total comments found: ${result.comments.length}`,
          ].filter(Boolean).join("\n");

          const taskLines = result.tasks.map(formatTask);
          return { content: [{ type: "text" as const, text: `${summary}\n\n${taskLines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === PG MIGRATIONS ===

  if (shouldRegisterTool("migrate_pg")) {
    server.tool(
      "migrate_pg",
      "Apply PostgreSQL schema migrations to the configured RDS instance",
      {
        connection_string: z.string().optional().describe("PostgreSQL connection string (overrides cloud config)"),
      },
      async ({ connection_string }) => {
        try {
          let connStr: string;
          if (connection_string) {
            connStr = connection_string;
          } else {
            const { getConnectionString } = await import("@hasna/cloud");
            connStr = getConnectionString("todos");
          }

          const { applyPgMigrations } = await import("../db/pg-migrate.js");
          const result = await applyPgMigrations(connStr);

          const lines: string[] = [];
          if (result.applied.length > 0) {
            lines.push(`Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`);
          }
          if (result.alreadyApplied.length > 0) {
            lines.push(`Already applied: ${result.alreadyApplied.length} migration(s)`);
          }
          if (result.errors.length > 0) {
            lines.push(`Errors:\n${result.errors.join("\n")}`);
          }
          if (result.applied.length === 0 && result.errors.length === 0) {
            lines.push("Schema is up to date.");
          }
          lines.push(`Total migrations: ${result.totalMigrations}`);

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            isError: result.errors.length > 0,
          };
        } catch (e: any) {
          return {
            content: [{ type: "text" as const, text: `Migration failed: ${e?.message ?? String(e)}` }],
            isError: true,
          };
        }
      },
    );
  }
}
