import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult } from "../compact.js";

/**
 * The four fleet-standard MCP tools. register_agent only NAMES a caller — it
 * does not authenticate it (auth is the transport-level bearer gate, §5.1a).
 */

interface AgentState {
  name: string;
  focus?: string;
  last_heartbeat?: string;
}
const agents = new Map<string, AgentState>();

export function registerStandardTools(server: McpServer): void {
  server.tool(
    "register_agent",
    "Register/identify the calling agent (names, does not authenticate).",
    { name: z.string(), role: z.string().optional() },
    async (args: { name: string; role?: string }) => {
      agents.set(args.name, { name: args.name });
      return toToolResult({ ok: true, registered: args.name, role: args.role ?? null }) as never;
    },
  );

  server.tool(
    "heartbeat",
    "Record a liveness heartbeat for the calling agent.",
    { name: z.string() },
    async (args: { name: string }) => {
      const state = agents.get(args.name) ?? { name: args.name };
      state.last_heartbeat = new Date().toISOString();
      agents.set(args.name, state);
      return toToolResult({ ok: true, name: args.name, last_heartbeat: state.last_heartbeat }) as never;
    },
  );

  server.tool(
    "set_focus",
    "Set the calling agent's current focus (e.g. an entity id).",
    { name: z.string(), focus: z.string() },
    async (args: { name: string; focus: string }) => {
      const state = agents.get(args.name) ?? { name: args.name };
      state.focus = args.focus;
      agents.set(args.name, state);
      return toToolResult({ ok: true, name: args.name, focus: args.focus }) as never;
    },
  );

  server.tool(
    "send_feedback",
    "Send freeform feedback about the access app to its maintainers.",
    { name: z.string().optional(), message: z.string() },
    async (args: { name?: string; message: string }) => {
      return toToolResult({ ok: true, received: true, from: args.name ?? "anonymous", chars: args.message.length }) as never;
    },
  );
}
