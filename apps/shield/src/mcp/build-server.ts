import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "fs";
import { z } from "zod";
import { registerCloudTools } from "@hasna/cloud";

import { getDb } from "../db/database.js";
import { seedBuiltinRules } from "../db/index.js";
import { seedAdvisories } from "../data/advisories.js";
import { PACKAGE_VERSION } from "../lib/version.js";

import { registerScanTools } from "./tools/scan.js";
import { registerFindingTools } from "./tools/findings.js";
import { registerRulesPoliciesTools } from "./tools/rules-policies.js";
import { registerAdvisoryTools } from "./tools/advisories.js";

let seeded = false;
let serverInstance: McpServer | null = null;

const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>();

function ensureSeeded(): void {
  if (seeded) return;
  seedBuiltinRules();
  try {
    seedAdvisories();
  } catch {}
  seeded = true;
}

function jsonResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function getCodeContext(filePath: string, line: number, contextLines = 10): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, line - contextLines - 1);
    const end = Math.min(lines.length, line + contextLines);
    return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");
  } catch {
    return "";
  }
}

export function createMcpServer(): McpServer {
  ensureSeeded();

  const server = new McpServer({ name: "shield", version: PACKAGE_VERSION });

  registerScanTools(server, jsonResult, getCodeContext);
  registerFindingTools(server, jsonResult, getCodeContext);
  registerRulesPoliciesTools(server, jsonResult);
  registerAdvisoryTools(server, jsonResult);

  server.tool(
    "register_agent",
    "Register an agent session (idempotent). Auto-updates last_seen_at on re-register.",
    { name: z.string(), session_id: z.string().optional() },
    async (a: { name: string; session_id?: string }) => {
      const existing = [..._agentReg.values()].find((x) => x.name === a.name);
      if (existing) {
        existing.last_seen_at = new Date().toISOString();
        return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] };
      }
      const id = Math.random().toString(36).slice(2, 10);
      const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
      _agentReg.set(id, ag);
      return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
    },
  );

  server.tool(
    "heartbeat",
    "Update last_seen_at to signal agent is active.",
    { agent_id: z.string() },
    async (a: { agent_id: string }) => {
      const ag = _agentReg.get(a.agent_id);
      if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
      ag.last_seen_at = new Date().toISOString();
      return { content: [{ type: "text" as const, text: JSON.stringify({ id: ag.id, name: ag.name, last_seen_at: ag.last_seen_at }) }] };
    },
  );

  server.tool(
    "set_focus",
    "Set active project context for this agent session.",
    { agent_id: z.string(), project_id: z.string().nullable().optional() },
    async (a: { agent_id: string; project_id?: string | null }) => {
      const ag = _agentReg.get(a.agent_id);
      if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
      (ag as { project_id?: string }).project_id = a.project_id ?? undefined;
      return { content: [{ type: "text" as const, text: a.project_id ? `Focus: ${a.project_id}` : "Focus cleared" }] };
    },
  );

  server.tool(
    "list_agents",
    "List all registered agents.",
    {},
    async () => {
      const agents = [..._agentReg.values()];
      if (agents.length === 0) return { content: [{ type: "text" as const, text: "No agents registered." }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(agents, null, 2) }] };
    },
  );

  server.tool(
    "send_feedback",
    "Send feedback about this service",
    { message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional() },
    async (params: { message: string; email?: string; category?: string }) => {
      try {
        const db = getDb();
        db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(
          params.message, params.email || null, params.category || "general", PACKAGE_VERSION,
        );
        return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: String(e) }], isError: true };
      }
    },
  );

  registerCloudTools(server, "shield");

  return server;
}

export function buildServer(): McpServer {
  if (!serverInstance) serverInstance = createMcpServer();
  return serverInstance;
}

/** @internal test helper */
export function resetServerForTests(): void {
  serverInstance = null;
  seeded = false;
  _agentReg.clear();
}
