import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../../../package.json" with { type: "json" };

export function registerFeedbackTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: send_feedback ---
  server.registerTool(
    "send_feedback",
    {
      title: "Send Feedback",
      description: "Send feedback about this service",
      inputSchema: {
        message: z.string(),
        email: z.string().optional(),
        category: z.enum(["bug", "feature", "general"]).optional(),
      },
    },
    async ({ message, email, category }) => {
      try {
        const { getDatabase } = await import("../../db/database.js");
        const db = getDatabase();
        db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(message, email || null, category || "general", pkg.version);
        return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: String(e) }], isError: true };
      }
    }
  );
}
