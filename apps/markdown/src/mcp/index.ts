#!/usr/bin/env bun
// OMP MCP Server — expose OMP tools to AI agents

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parseFromFile, parseFromString, validate, compile, run } from "../lib/pipeline.js";
import { validateAndLint } from "../validator/validate.js";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { createRequire } from "module";

const VERSION = "0.1.3";
const require = createRequire(import.meta.url);

const server = new Server(
  { name: "markdown", version: VERSION },
  { capabilities: { tools: {} } }
);

export function getMcpHelpText(): string {
  return [
    "Usage: omp-mcp [options]",
    "",
    "OMP MCP Server — stdio transport for OMP tools",
    "",
    "Options:",
    "  -v, --version       Output version",
    "  -h, --help          Display help",
  ].join("\n");
}

export function handleMcpCliArgs(args: string[], log: (msg: string) => void = console.log): boolean {
  if (args.includes("-h") || args.includes("--help")) {
    log(getMcpHelpText());
    return true;
  }

  if (args.includes("-v") || args.includes("--version")) {
    log(VERSION);
    return true;
  }

  return false;
}

// ─── Agent registry (in-memory) ─────────────────────────────

const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>();

// ─── List Tools ──────────────────────────────────────────────

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
    // Agent tools
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
  ],
}));

// ─── Feedback DB helper ─────────────────────────────────────

function getFeedbackDb() {
  const home = homedir();
  const dbPath = join(home, ".hasna", "markdown", "markdown.db");
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { Database } = require("bun:sqlite");
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), message TEXT NOT NULL, email TEXT, category TEXT DEFAULT 'general', version TEXT, machine_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  return db;
}

// ─── Call Tool ───────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Agent tools
      case "register_agent": {
        const a = args as { name: string; session_id?: string };
        const existing = [..._agentReg.values()].find(x => x.name === a.name);
        if (existing) { existing.last_seen_at = new Date().toISOString(); return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] }; }
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
        const db = getFeedbackDb();
        db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(p.message, p.email || null, p.category || "general", VERSION);
        db.close();
        return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
      }

      // OMP tools
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
          content: [{
            type: "text" as const,
            text: JSON.stringify(plan, null, 2),
          }],
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

export async function main(args: string[] = process.argv.slice(2)) {
  if (handleMcpCliArgs(args)) return;

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch(console.error);
}
