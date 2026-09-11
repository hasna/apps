import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HostedLibrary } from "../hosted/library.js";
import { HostedPasteHistory } from "../hosted/paste-history.js";
import { hostedFailure } from "../hosted/process-options.js";
import type { HostedRecordingsClient } from "../hosted/index.js";
import { VERSION } from "../version.js";

export function buildHostedServer(client: HostedRecordingsClient): McpServer {
  const library = new HostedLibrary(client);
  const server = new McpServer({ name: "recordings-hosted", version: VERSION });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const execute = async (operation: () => Promise<object>) => {
    try {
      const result = await operation();
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: { ...result } };
    } catch (error) {
      const result = hostedFailure(error);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result, isError: true };
    }
  };
  server.registerTool("recordings_hosted_providers", {
    description: "Read server-configured transcription providers, models and optional defaults. Availability is reported by the server; no provider request is made.",
    inputSchema: z.object({}).strict(), annotations,
  }, () => execute(() => client.providers()));
  server.registerTool("recordings_hosted_list", {
    description: "Read one hosted Library page. Private transcripts require includeText. A cursor permits another request, without an inferred total.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional(), before: z.string().optional(),
      beforeId: z.string().optional(), includeText: z.boolean().optional() }, annotations,
  }, options => execute(() => library.list(options)));
  server.registerTool("recordings_hosted_get", {
    description: "Read one hosted recording. Private transcript text is omitted unless includeText is true.",
    inputSchema: { id: z.string(), includeText: z.boolean().optional() }, annotations,
  }, ({ id, includeText }) => execute(() => library.get(id, { includeText })));
  const history = new HostedPasteHistory(client);
  server.registerTool("recordings_hosted_paste_history", {
    description: "Read one hosted paste-history page with destination and client-reported delivery evidence. Private pasted text requires includeText. A confirmed report does not mean the server observed delivery.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional(), before: z.string().optional(),
      beforeId: z.string().optional(), includeText: z.boolean().optional() }, annotations,
  }, options => execute(() => history.list(options)));
  return server;
}
