import { Server } from "@modelcontextprotocol/sdk/server";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parseFromFile, parseFromString, validate, compile, run } from "../lib/pipeline.js";
import { getPackageVersion } from "../lib/package-version.js";
import { saveFeedback, storagePull, storagePush, storageStatus, storageSync } from "../storage.js";
import { validateAndLint } from "../validator/validate.js";

export { getPackageVersion };

const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>();

export function buildServer(version: string = getPackageVersion()): Server {
  const server = new Server(
    { name: "markdown", version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "markdown_validate",
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
        name: "markdown_inspect",
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
        name: "markdown_compile",
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
        name: "markdown_lint",
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
        name: "markdown_run",
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
      {
        name: "register_agent",
        description: "Register an agent session (idempotent). Auto-updates last_seen_at on re-register.",
        inputSchema: { type: "object" as const, properties: { name: { type: "string" }, session_id: { type: "string" } }, required: ["name"] },
      },
      {
        name: "heartbeat",
        description: "Update last_seen_at to signal agent is active.",
        inputSchema: { type: "object" as const, properties: { agent_id: { type: "string" } }, required: ["agent_id"] },
      },
      {
        name: "set_focus",
        description: "Set active project context for this agent session.",
        inputSchema: { type: "object" as const, properties: { agent_id: { type: "string" }, project_id: { type: "string" } }, required: ["agent_id"] },
      },
      {
        name: "list_agents",
        description: "List all registered agents.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "send_feedback",
        description: "Send feedback about this service",
        inputSchema: { type: "object" as const, properties: { message: { type: "string" }, email: { type: "string" }, category: { type: "string", enum: ["bug", "feature", "general"] } }, required: ["message"] },
      },
      {
        name: "storage_status",
        description: "Show markdown-owned local storage status and optional remote mirror configuration.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "storage_push",
        description: "Push local feedback rows to the optional Postgres mirror.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "storage_pull",
        description: "Pull feedback rows from the optional Postgres mirror.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "storage_sync",
        description: "Push local feedback rows, then pull remote feedback rows.",
        inputSchema: { type: "object" as const, properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "register_agent": {
          const a = args as { name: string; session_id?: string };
          const existing = [..._agentReg.values()].find((x) => x.name === a.name);
          if (existing) {
            existing.last_seen_at = new Date().toISOString();
            return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] };
          }
          const id = Math.random().toString(36).slice(2, 10);
          const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
          _agentReg.set(id, ag);
          return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
        }
        case "heartbeat": {
          const a = args as { agent_id: string };
          const ag = _agentReg.get(a.agent_id);
          if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
          ag.last_seen_at = new Date().toISOString();
          return { content: [{ type: "text" as const, text: JSON.stringify({ id: ag.id, name: ag.name, last_seen_at: ag.last_seen_at }) }] };
        }
        case "set_focus": {
          const a = args as { agent_id: string; project_id?: string };
          const ag = _agentReg.get(a.agent_id);
          if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
          ag.project_id = a.project_id ?? undefined;
          return { content: [{ type: "text" as const, text: a.project_id ? `Focus: ${a.project_id}` : "Focus cleared" }] };
        }
        case "list_agents": {
          const agents = [..._agentReg.values()];
          return { content: [{ type: "text" as const, text: agents.length === 0 ? "No agents registered." : JSON.stringify(agents, null, 2) }] };
        }
        case "send_feedback": {
          const p = args as { message: string; email?: string; category?: string };
          const record = saveFeedback({ message: p.message, email: p.email, category: p.category, version });
          return { content: [{ type: "text" as const, text: JSON.stringify({ id: record.id, machine_id: record.machine_id, created_at: record.created_at }) }] };
        }
        case "storage_status": {
          return { content: [{ type: "text" as const, text: JSON.stringify(storageStatus(), null, 2) }] };
        }
        case "storage_push": {
          const result = await storagePush();
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.errors.length > 0 };
        }
        case "storage_pull": {
          const result = await storagePull();
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.errors.length > 0 };
        }
        case "storage_sync": {
          const result = await storageSync();
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.errors.length > 0 };
        }
        case "markdown_validate": {
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
        case "markdown_inspect": {
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
        case "markdown_compile": {
          const doc = args?.file
            ? parseFromFile(args.file as string)
            : parseFromString((args?.content as string) ?? "");
          const plan = compile(doc);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
          };
        }
        case "markdown_lint": {
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
        case "markdown_run": {
          const file = args?.file as string;
          if (!file) throw new Error("file is required");
          const result = await run(file, {
            outputDir: (args?.output_dir as string) ?? ".",
            dryRun: (args?.dry_run as boolean) ?? true,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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

  return server;
}
