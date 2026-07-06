import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpText } from "../compact.js";

// The four fleet-standard MCP tools, identical semantics across the cohort (§5.4).
// register_agent NAMES a caller — it does not authenticate it (auth is the bearer
// token on the transport, §5.1a).

interface AgentState {
  agent: string;
  focus?: string;
  last_heartbeat?: string;
}

const agents = new Map<string, AgentState>();

export function registerStandardTools(server: McpServer): void {
  server.tool(
    "register_agent",
    "Register/identify the calling agent by name (naming only — not authentication).",
    { name: z.string().describe("Agent name"), role: z.string().optional() },
    async ({ name, role }) => {
      agents.set(name, { agent: name });
      return mcpText({ ok: true, agent: name, role: role ?? null, note: "Naming only; auth is the bearer token." });
    },
  );

  server.tool(
    "heartbeat",
    "Report agent liveness.",
    { name: z.string().optional() },
    async ({ name }) => {
      const ts = new Date().toISOString();
      if (name) {
        const state = agents.get(name) ?? { agent: name };
        state.last_heartbeat = ts;
        agents.set(name, state);
      }
      return mcpText({ ok: true, at: ts });
    },
  );

  server.tool(
    "set_focus",
    "Set the calling agent's current focus context.",
    { name: z.string(), focus: z.string().describe("Focus, e.g. an entity_id or asset_id") },
    async ({ name, focus }) => {
      const state = agents.get(name) ?? { agent: name };
      state.focus = focus;
      agents.set(name, state);
      return mcpText({ ok: true, agent: name, focus });
    },
  );

  server.tool(
    "send_feedback",
    "Send freeform feedback to the app operators.",
    { message: z.string(), severity: z.enum(["info", "warning", "critical"]).optional() },
    async ({ message, severity }) => {
      return mcpText({ ok: true, received: true, severity: severity ?? "info", message_length: message.length });
    },
  );
}
