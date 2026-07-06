import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { heartbeat, registerAgent, sendFeedback, setFocus } from "../../services/standard-tools.js";
import { toolError, toolText } from "../compact.js";

// The four fleet-standard tools, identical in semantics across every app. These
// NAME/identify a caller for coordination; they do NOT authenticate it (auth is
// the bearer token on the transport — see http.ts).
export function registerStandardTools(server: McpServer): void {
  server.tool(
    "register_agent",
    "Register/identify the calling agent (naming only — not authentication).",
    { name: z.string().describe("Agent name") },
    async ({ name }) => {
      try {
        return toolText(registerAgent(name));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.tool(
    "heartbeat",
    "Record a liveness heartbeat for an agent.",
    { name: z.string().describe("Agent name") },
    async ({ name }) => {
      try {
        return toolText(heartbeat(name));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.tool(
    "set_focus",
    "Set the calling agent's current focus (e.g. a run id or period).",
    { name: z.string().describe("Agent name"), focus: z.string().describe("Focus value") },
    async ({ name, focus }) => {
      try {
        return toolText(setFocus(name, focus));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.tool(
    "send_feedback",
    "Send freeform feedback from the calling agent.",
    {
      name: z.string().describe("Agent name"),
      message: z.string().describe("Feedback message"),
      sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
    },
    async ({ name, message, sentiment }) => {
      try {
        return toolText(sendFeedback(name, message, sentiment));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
