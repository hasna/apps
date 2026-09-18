import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compactText, formatError, resolveId } from "./memory-utils.js";

const auditLimit = z.number().int().min(1).max(50).optional().describe("Entries per page (default 10, maximum 50)");
const auditCursor = z.string().min(1).max(4096).optional().describe("Opaque next_cursor from the previous page");
const auditFormat = z.enum(["compact", "json"]).optional().describe("Compact text by default; json returns the complete versioned page receipt");

function pageText(page: import("../../audit-contract.js").AuditPage, verbose = false): string {
  const lines = page.entries.map((entry, index) =>
    `${index + 1}. [${entry.created_at}] ${entry.operation} memory=${entry.memory_id} ` +
    `by=${entry.agent_id ?? "system"} changes=${compactText(JSON.stringify(entry.changes), verbose ? 240 : 120)}`
  );
  const header = `${page.count} of ${page.total} audit entries (consumed ${page.consumed}; complete=${page.complete})`;
  const continuation = page.has_more
    ? `\nNext: call again with cursor=${JSON.stringify(page.next_cursor)}`
    : "";
  return `${header}${lines.length ? `:\n${lines.join("\n")}` : "."}${continuation}`;
}

function exportPageAtLegacyOffset(
  read: typeof import("../../db/audit.js").exportAuditLogPage,
  input: import("../../db/audit.js").AuditExportOptions,
  offset: number,
): import("../../audit-contract.js").AuditPage {
  let cursor: string | undefined;
  let remaining = offset;
  while (remaining > 0) {
    const skip = Math.min(remaining, 50);
    const page = read({ ...input, limit: skip, cursor });
    if (page.count !== skip || !page.next_cursor) {
      throw new Error(`legacy offset ${offset} exceeds the ${page.total}-entry audit snapshot`);
    }
    remaining -= page.count;
    cursor = page.next_cursor;
  }
  return read({ ...input, cursor });
}

export function registerMemoryAuditTools(server: McpServer): void {
  server.tool(
    "memory_audit_trail",
    "Read one memory's immutable audit history as a bounded, versioned page ordered by created_at then id.",
    {
      memory_id: z.string().min(1).max(512).describe("Exact memory ID"),
      limit: auditLimit,
      cursor: auditCursor,
      format: auditFormat,
      verbose: z.boolean().optional().describe("Include wider change snippets in compact output"),
    },
    async (args) => {
      try {
        const { getMemoryAuditTrailPage } = await import("../../db/audit.js");
        const page = getMemoryAuditTrailPage(resolveId(args.memory_id), {
          limit: args.limit ?? 10,
          cursor: args.cursor,
        });
        return {
          content: [{
            type: "text" as const,
            text: args.format === "json" ? JSON.stringify(page) : pageText(page, args.verbose),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool(
    "memory_audit_export",
    "Read a filtered immutable audit-log page. Use next_cursor until has_more=false; complete is true only when one response covers the whole query.",
    {
      since: z.string().optional().describe("Canonical UTC lower bound: YYYY-MM-DDTHH:mm:ss.sssZ"),
      until: z.string().optional().describe("Canonical UTC upper bound: YYYY-MM-DDTHH:mm:ss.sssZ"),
      operation: z.enum(["create", "update", "delete", "archive", "restore", "read"]).optional(),
      agent_id: z.string().min(1).max(512).optional(),
      limit: auditLimit,
      cursor: auditCursor,
      offset: z.number().int().min(0).max(10000).optional().describe("Deprecated numeric offset compatibility; prefer cursor"),
      format: auditFormat,
      full: z.boolean().optional().describe("Compatibility alias for format=json"),
      verbose: z.boolean().optional().describe("Include wider change snippets in compact output"),
    },
    async (args) => {
      try {
        const { exportAuditLogPage } = await import("../../db/audit.js");
        if (args.cursor && args.offset !== undefined) {
          throw new Error("cursor and deprecated offset cannot be combined");
        }
        const input = {
          since: args.since,
          until: args.until,
          operation: args.operation,
          agent_id: args.agent_id,
          limit: args.limit ?? 10,
          cursor: args.cursor,
        };
        const page = args.offset && args.offset > 0
          ? exportPageAtLegacyOffset(exportAuditLogPage, input, args.offset)
          : exportAuditLogPage(input);
        return {
          content: [{
            type: "text" as const,
            text: args.full || args.format === "json" ? JSON.stringify(page) : pageText(page, args.verbose),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatError(error) }], isError: true };
      }
    },
  );

  server.tool(
    "memory_audit_stats",
    "Read snapshot-consistent immutable audit totals by operation and for the most recent 24 hours.",
    {},
    async () => {
      try {
        const { getAuditStats } = await import("../../db/audit.js");
        return { content: [{ type: "text" as const, text: JSON.stringify(getAuditStats()) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatError(error) }], isError: true };
      }
    },
  );
}
