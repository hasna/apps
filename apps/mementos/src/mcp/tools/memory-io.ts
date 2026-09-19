import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMemory, listMemoriesBounded } from "../../db/memories.js";
import { formatError } from "./memory-utils.js";
import { redactMemoryForOutput } from "../../lib/redact.js";
import { boundedMcpOutput, mcpMaxBytes } from "./bounded-output.js";
import type { CreateMemoryInput } from "../../types/index.js";

export function registerMemoryIoTools(server: McpServer): void {
  server.tool(
    "memory_export",
    "Export one truthful byte-bounded page. format='json' returns full memory objects; format='v1' returns portable entries with entity links. Continue with next_offset.",
    {
      scope: z.enum(["global", "shared", "private", "working"]).optional(),
      category: z.enum(["preference", "fact", "knowledge", "history", "procedural", "resource"]).optional(),
      agent_id: z.string().optional(),
      project_id: z.string().optional(),
      format: z.enum(["json", "v1"]).optional().describe("Export page format: json (default) or portable v1 entries"),
      limit: z.coerce.number().int().min(1).max(1000).optional().describe("Page size (default: 20, maximum: 1000)"),
      offset: z.coerce.number().int().min(0).optional().describe("Continuation offset"),
      max_bytes: z.coerce.number().int().min(1024).max(1024 * 1024).optional().describe("Response ceiling (default: 65536, maximum: 1048576)"),
    },
    async (args) => {
      try {
        const { format, limit: requestedLimit, offset: requestedOffset, max_bytes, ...filter } = args;
        const limit = requestedLimit ?? 20;
        const offset = requestedOffset ?? 0;
        const page = listMemoriesBounded({ ...filter, offset }, limit);
        const memories = page.rows.map(redactMemoryForOutput);
        const portable = format === "v1";
        const items: unknown[] = portable
          ? (await import("../../lib/export-v1.js")).exportV1Entries(memories)
          : memories;
        const output = boundedMcpOutput({
          collection: portable ? "entries" : "memories",
          receipt: portable ? "mementos.export.v1.page.v1" : "mementos.export.page.v1",
          items,
          offset,
          limit,
          sourceHasMore: page.has_more,
          detail: "full",
          maxBytes: mcpMaxBytes(max_bytes, "full"),
          metadata: { format: portable ? "v1" : "json" },
          nextArguments: { format: portable ? "v1" : "json", ...filter },
          includeDetailInNextArguments: false,
        });
        return { content: [{ type: "text" as const, text: output.text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "memory_import",
    "Import memories from JSON array",
    {
      memories: z.array(z.object({
        key: z.string(),
        value: z.string(),
        scope: z.enum(["global", "shared", "private", "working"]).optional(),
        category: z.enum(["preference", "fact", "knowledge", "history", "procedural", "resource"]).optional(),
        importance: z.coerce.number().optional(),
        tags: z.array(z.string()).optional(),
        summary: z.string().optional(),
        source: z.enum(["user", "agent", "system", "auto", "imported"]).optional(),
        agent_id: z.string().optional(),
        project_id: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      })),
      overwrite: z.boolean().optional(),
    },
    async (args) => {
      try {
        let imported = 0;
        const dedupeMode = args.overwrite === false ? "create" as const : "merge" as const;
        for (const mem of args.memories) {
          createMemory({ ...mem, source: mem.source || "imported" } as CreateMemoryInput, dedupeMode);
          imported++;
        }
        return { content: [{ type: "text" as const, text: `Imported ${imported} memor${imported === 1 ? "y" : "ies"}.` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );
}
