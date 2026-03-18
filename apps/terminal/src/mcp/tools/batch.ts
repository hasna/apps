// Batch tools: batch

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { stripAnsi } from "../../compression.js";
import { processOutput } from "../../output-processor.js";
import { getOutputProvider } from "../../providers/index.js";
import { searchContent } from "../../search/index.js";
import { cachedRead } from "../../file-cache.js";

export function registerBatchTools(server: McpServer, h: ToolHelpers): void {

  server.tool(
    "batch",
    "Run multiple operations in ONE call. Saves N-1 round trips. Each op can be: execute (run command), read (file read/summarize), search (grep pattern), or symbols (file outline).",
    {
      ops: z.array(z.object({
        type: z.enum(["execute", "read", "write", "search", "symbols"]).describe("Operation type"),
        command: z.string().optional().describe("Shell command (for execute)"),
        path: z.string().optional().describe("File path (for read/write/symbols)"),
        content: z.string().optional().describe("File content (for write)"),
        pattern: z.string().optional().describe("Search pattern (for search)"),
        summarize: z.boolean().optional().describe("AI summarize (for read)"),
        format: z.enum(["raw", "summary"]).optional().describe("Output format (for execute)"),
      })).describe("Array of operations to run"),
      cwd: z.string().optional().describe("Working directory for all ops"),
    },
    async ({ ops, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const results: Record<string, any>[] = [];

      for (let i = 0; i < ops.slice(0, 10).length; i++) {
        const op = ops[i];
        try {
          if (op.type === "execute" && op.command) {
            const result = await h.exec(op.command, workDir, 30000);
            const output = (result.stdout + result.stderr).trim();
            if (op.format === "summary" && output.split("\n").length > 15) {
              const processed = await processOutput(op.command, output);
              results.push({ op: i, type: "execute", summary: processed.summary, exitCode: result.exitCode, tokensSaved: processed.tokensSaved });
            } else {
              results.push({ op: i, type: "execute", output: stripAnsi(output).slice(0, 2000), exitCode: result.exitCode });
            }
          } else if (op.type === "read" && op.path) {
            const filePath = h.resolvePath(op.path, workDir);
            const result = cachedRead(filePath, {});
            if (op.summarize && result.content.length > 500) {
              const provider = getOutputProvider();
              const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
              const content = result.content.length > 8000 ? result.content.slice(0, 8000) : result.content;
              const summary = await provider.complete(`File: ${filePath}\n\n${content}`, {
                model: outputModel,
                system: `Describe what this source file does in 2-4 lines. Include: main class/module name, key methods/functions, what it exports, and its purpose. Be specific.`,
                maxTokens: 300, temperature: 0.2,
              });
              results.push({ op: i, type: "read", path: op.path, summary, lines: result.content.split("\n").length });
            } else {
              results.push({ op: i, type: "read", path: op.path, content: result.content, lines: result.content.split("\n").length });
            }
          } else if (op.type === "write" && op.path && op.content !== undefined) {
            const filePath = h.resolvePath(op.path, workDir);
            const { writeFileSync, mkdirSync, existsSync } = await import("fs");
            const { dirname } = await import("path");
            const dir = dirname(filePath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(filePath, op.content);
            results.push({ op: i, type: "write", path: op.path, ok: true, bytes: op.content.length });
          } else if (op.type === "search" && op.pattern) {
            // Search accepts both files and directories — resolve to parent dir if file
            let searchPath = op.path ? h.resolvePath(op.path, workDir) : workDir;
            try {
              const { statSync } = await import("fs");
              if (statSync(searchPath).isFile()) searchPath = searchPath.replace(/\/[^/]+$/, "");
            } catch {}
            const result = await searchContent(op.pattern, searchPath, {});
            results.push({ op: i, type: "search", pattern: op.pattern, totalMatches: result.totalMatches, files: result.files.slice(0, 10) });
          } else if (op.type === "symbols" && op.path) {
            const filePath = h.resolvePath(op.path, workDir);
            const result = cachedRead(filePath, {});
            if (result.content && !result.content.startsWith("Error:")) {
              const provider = getOutputProvider();
              const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
              const content = result.content.length > 8000 ? result.content.slice(0, 8000) : result.content;
              const summary = await provider.complete(`File: ${filePath}\n\n${content}`, {
                model: outputModel,
                system: `Extract all symbols. Return ONLY a JSON array. Each: {"name":"x","kind":"function|class|method|interface|type","line":N,"signature":"brief"}. For class methods use "Class.method". Exclude imports.`,
                maxTokens: 2000, temperature: 0,
              });
              let symbols: any[] = [];
              try { const m = summary.match(/\[[\s\S]*\]/); if (m) symbols = JSON.parse(m[0]); } catch {}
              results.push({ op: i, type: "symbols", path: op.path, symbols });
            } else {
              results.push({ op: i, type: "symbols", path: op.path, error: "Cannot read file" });
            }
          }
        } catch (err: any) {
          results.push({ op: i, type: op.type, error: err.message?.slice(0, 200) });
        }
      }

      h.logCall("batch", { command: `${ops.length} ops`, durationMs: Date.now() - start, aiProcessed: true });
      return { content: [{ type: "text" as const, text: JSON.stringify({ results, total: results.length, durationMs: Date.now() - start }) }] };
    }
  );
}
