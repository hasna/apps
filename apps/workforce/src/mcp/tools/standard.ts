import { z } from "zod";
import { jsonResult } from "../compact.js";
import type { ToolContext, ToolRegistrar } from "../index.js";

// The four fleet-standard MCP tools, identical semantics across apps.
// register_agent only NAMES a caller — it does not authenticate it (§5.4).

interface AgentRecord {
  name: string;
  role?: string;
  registered_at: string;
}

const agents = new Map<string, AgentRecord>();
const feedback: Array<{ agent?: string; message: string; at: string }> = [];

export function registerStandardTools(
  server: ToolRegistrar,
  _ctx: ToolContext,
  focus: { setFocus: (agent: string, entityId: string) => void; getFocusEntity: (agent?: string) => string | undefined },
): void {
  server.tool(
    "register_agent",
    "Register/identify the calling agent by name (names, does not authenticate).",
    { name: z.string(), role: z.string().optional() },
    async (args) => {
      const name = String(args["name"]);
      const record: AgentRecord = { name, registered_at: new Date().toISOString() };
      if (args["role"]) record.role = String(args["role"]);
      agents.set(name, record);
      return jsonResult({ ok: true, agent: record, note: "register_agent names the caller; authentication is via the bearer token." });
    },
  );

  server.tool(
    "heartbeat",
    "Report liveness for the calling agent.",
    { name: z.string().optional() },
    async (args) => jsonResult({ ok: true, name: args["name"] ?? null, at: new Date().toISOString() }),
  );

  server.tool(
    "set_focus",
    "Set the calling agent's default entity focus.",
    { name: z.string(), entity_id: z.string() },
    async (args) => {
      focus.setFocus(String(args["name"]), String(args["entity_id"]));
      return jsonResult({ ok: true, name: args["name"], entity_id: args["entity_id"] });
    },
  );

  server.tool(
    "send_feedback",
    "Record freeform feedback from the calling agent.",
    { message: z.string(), name: z.string().optional() },
    async (args) => {
      const entry = { ...(args["name"] ? { agent: String(args["name"]) } : {}), message: String(args["message"]), at: new Date().toISOString() };
      feedback.push(entry);
      return jsonResult({ ok: true, recorded: entry });
    },
  );
}
