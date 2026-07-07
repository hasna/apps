// Search tools: search_content, search_files, search_semantic, lookup

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { searchFiles, searchContent, semanticSearch } from "../../search/index.js";
import { compactSearchResult, truncateText } from "../../compact-output.js";

export function registerSearchTools(server: McpServer, h: ToolHelpers): void {

  // ── search_files ──────────────────────────────────────────────────────────

  server.tool(
    "search_files",
    "Search for files by name pattern. Auto-filters node_modules, .git, dist. Returns categorized results (source, config, other) with token savings.",
    {
      pattern: z.string().describe("Glob pattern (e.g., '*hooks*', '*.test.ts')"),
      path: z.string().optional().describe("Search root (default: cwd)"),
      includeNodeModules: z.boolean().optional().describe("Include node_modules (default: false)"),
      maxResults: z.number().optional().describe("Max results per category (default: 20, max: 100)"),
    },
    async ({ pattern, path, includeNodeModules, maxResults }) => {
      const start = Date.now();
      const limit = Math.min(maxResults ?? 20, 100);
      const result = await searchFiles(pattern, path ?? process.cwd(), { includeNodeModules, maxResults: limit });
      h.logCall("search_files", { command: `search_files ${pattern}`, tokensSaved: (result as any).tokensSaved ?? 0, durationMs: Date.now() - start });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  // ── search_content ────────────────────────────────────────────────────────

  server.tool(
    "search_content",
    "Search file contents by regex pattern. Groups matches by file, sorted by relevance. Use offset for pagination when results are truncated.",
    {
      pattern: z.string().describe("Search pattern (regex)"),
      path: z.string().optional().describe("Search root (default: cwd)"),
      fileType: z.string().optional().describe("File type filter (e.g., 'ts', 'py')"),
      maxResults: z.number().optional().describe("Max files to return (default: 15, max: 100)"),
      offset: z.number().optional().describe("Skip first N files (for pagination, default: 0)"),
      contextLines: z.number().optional().describe("Context lines around matches (default: 0)"),
    },
    async ({ pattern, path, fileType, maxResults, offset, contextLines }) => {
      const start = Date.now();
      // Fetch more than needed to support offset
      const limit = Math.min(maxResults ?? 15, 100);
      const fetchLimit = limit + (offset ?? 0);
      const result = await searchContent(pattern, path ?? process.cwd(), { fileType, maxResults: fetchLimit, contextLines });
      // Apply offset
      if (offset && offset > 0 && result.files) {
        result.files = result.files.slice(offset);
      }
      h.logCall("search_content", { command: `grep ${pattern}`, tokensSaved: result.tokensSaved ?? 0, durationMs: Date.now() - start });
      return { content: [{ type: "text" as const, text: JSON.stringify(compactSearchResult(result, limit)) }] };
    }
  );

  // ── search_semantic ───────────────────────────────────────────────────────

  server.tool(
    "search_semantic",
    "Find functions, classes, components, hooks, types by NAME or SIGNATURE. Searches symbol declarations, NOT code behavior or content. Use search_content (grep) instead for pattern matching inside code (e.g., security audits, string searches, imports).",
    {
      query: z.string().describe("Symbol name to search for (e.g., 'auth', 'login', 'UserService'). Matches function/class/type names, not code content."),
      path: z.string().optional().describe("Search root (default: cwd)"),
      kinds: z.array(z.enum(["function", "class", "interface", "type", "variable", "export", "import", "component", "hook"])).optional().describe("Filter by symbol kind"),
      exportedOnly: z.boolean().optional().describe("Only show exported symbols (default: false)"),
      maxResults: z.number().optional().describe("Max results (default: 20, max: 100)"),
    },
    async ({ query, path, kinds, exportedOnly, maxResults }) => {
      const limit = Math.min(maxResults ?? 20, 100);
      const result = await semanticSearch(query, path ?? process.cwd(), {
        kinds: kinds as any,
        exportedOnly,
        maxResults: limit,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(compactSearchResult(result, limit)) }] };
    }
  );

  // ── lookup ────────────────────────────────────────────────────────────────

  server.tool(
    "lookup",
    "Search for specific items in a file by name or pattern. Agent says what to find, not how to grep. Saves ~300 tokens vs constructing grep pipelines.",
    {
      file: z.string().describe("File path to search in"),
      items: z.array(z.string()).describe("Names or patterns to look up"),
      context: z.number().optional().describe("Lines of context around each match (default: 3)"),
      limit: z.number().optional().describe("Max matches per item (default: 10, max: 100)"),
    },
    async ({ file: rawFile, items, context, limit }) => {
      const start = Date.now();
      const file = h.resolvePath(rawFile);
      const { readFileSync } = await import("fs");
      try {
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");
        const ctx = Math.min(context ?? 2, 10);
        const maxMatches = Math.min(limit ?? 10, 100);
        const results: Record<string, { line: number; text: string; context: string[] }[]> = {};
        const totals: Record<string, number> = {};

        for (const item of items) {
          results[item] = [];
          const pattern = new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              totals[item] = (totals[item] ?? 0) + 1;
              if (results[item].length >= maxMatches) continue;
              results[item].push({
                line: i + 1,
                text: truncateText(lines[i].trim(), 180),
                context: lines.slice(Math.max(0, i - ctx), i + ctx + 1).map(l => truncateText(l.trimEnd(), 180)),
              });
            }
          }
        }

        h.logCall("lookup", { command: `lookup ${file} [${items.join(",")}]`, durationMs: Date.now() - start });
        return { content: [{ type: "text" as const, text: JSON.stringify({
          results,
          totals,
          limit: maxMatches,
          hint: "Use limit or narrower item names for more matches.",
        }) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: e.message }) }] };
      }
    }
  );
}
