import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ApiPrincipal } from "../../server/auth.js";
import { ok } from "../compact.js";

// The four fleet-standard MCP tools, identical semantics across all 9 apps.
// register_agent NAMES a caller — it does NOT authenticate (naming != auth);
// the /mcp transport bearer token is the authentication boundary (§5.1a/§5.4).

interface AgentRecord {
  name: string;
  role?: string;
  focus_entity_id?: string;
  last_heartbeat?: string;
}

const agents = new Map<string, AgentRecord>();

function readArgs(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

export function registerStandardTools(server: McpServer, principal: ApiPrincipal): void {
  server.tool(
    "register_agent",
    "Register/identify the calling agent (names only; does not authenticate).",
    { name: z.string(), role: z.string().optional() } as unknown as ZodRawShapeCompat,
    async (input: unknown) => {
      const { name, role } = readArgs(input) as { name: string; role?: string };
      agents.set(name, { name, ...(role ? { role } : {}) });
      return ok({ registered: true, name, role: role ?? null, credential_id: principal.credential_id });
    },
  );

  server.tool(
    "heartbeat",
    "Record a liveness heartbeat for an agent.",
    { name: z.string() } as unknown as ZodRawShapeCompat,
    async (input: unknown) => {
      const { name } = readArgs(input) as { name: string };
      const rec = agents.get(name) ?? { name };
      rec.last_heartbeat = new Date().toISOString();
      agents.set(name, rec);
      return ok({ ok: true, name, last_heartbeat: rec.last_heartbeat });
    },
  );

  server.tool(
    "set_focus",
    "Set an agent's focus entity for subsequent context.",
    { name: z.string(), entity_id: z.string() } as unknown as ZodRawShapeCompat,
    async (input: unknown) => {
      const { name, entity_id } = readArgs(input) as { name: string; entity_id: string };
      const rec = agents.get(name) ?? { name };
      rec.focus_entity_id = entity_id;
      agents.set(name, rec);
      return ok({ ok: true, name, focus_entity_id: entity_id });
    },
  );

  server.tool(
    "send_feedback",
    "Send a freeform feedback note from the calling agent.",
    { message: z.string(), agent: z.string().optional() } as unknown as ZodRawShapeCompat,
    async (input: unknown) => {
      const { message, agent } = readArgs(input) as { message: string; agent?: string };
      return ok({ received: true, message, agent: agent ?? principal.actor_id, at: new Date().toISOString() });
    },
  );
}
