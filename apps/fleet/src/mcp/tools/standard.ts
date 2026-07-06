import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiPrincipal } from "../../server/auth.js";
import { mcpText } from "../compact.js";

// The four fleet-standard MCP tools, identical in semantics across all 9 apps.
// register_agent NAMES a caller — it does NOT authenticate it (auth is the bearer
// token on the transport, §5.1a). These are always registered regardless of
// profile and require no domain write scope.

interface AgentIdentity {
  name: string;
  focus?: string;
  last_heartbeat?: string;
}

const agents = new Map<string, AgentIdentity>();

export function registerStandardTools(server: McpServer, principal: ApiPrincipal): void {
  server.tool(
    "register_agent",
    "Register/identify the calling agent by name. Naming only — does not authenticate (the bearer token does).",
    { name: z.string().min(1).describe("Human-readable agent name") },
    async (args: { name: string }) => {
      agents.set(args.name, { name: args.name });
      return mcpText({ registered: true, name: args.name, credential_id: principal.credential_id });
    },
  );

  server.tool(
    "heartbeat",
    "Record a liveness heartbeat for the calling agent.",
    { name: z.string().optional().describe("Agent name (defaults to the credential actor)") },
    async (args: { name?: string }) => {
      const name = args.name ?? principal.actor_id;
      const at = new Date().toISOString();
      const existing = agents.get(name) ?? { name };
      agents.set(name, { ...existing, last_heartbeat: at });
      return mcpText({ ok: true, name, at });
    },
  );

  server.tool(
    "set_focus",
    "Set the calling agent's current focus (a free-form context label).",
    { name: z.string().optional(), focus: z.string().min(1).describe("Focus label") },
    async (args: { name?: string; focus: string }) => {
      const name = args.name ?? principal.actor_id;
      const existing = agents.get(name) ?? { name };
      agents.set(name, { ...existing, focus: args.focus });
      return mcpText({ ok: true, name, focus: args.focus });
    },
  );

  server.tool(
    "send_feedback",
    "Send a free-form feedback note about fleet to the operators.",
    { message: z.string().min(1).describe("Feedback message"), severity: z.enum(["info", "warning", "critical"]).optional() },
    async (args: { message: string; severity?: string }) => {
      return mcpText({ received: true, severity: args.severity ?? "info", actor: principal.actor_id });
    },
  );
}
