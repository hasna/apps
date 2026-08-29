// File tools: read_file, read_files, symbols, symbols_dir, read_symbol, edit, review

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { stripAnsi } from "../../compression.js";
import { estimateTokens } from "../../tokens.js";
import { getOutputProvider } from "../../providers/index.js";
import { cachedRead } from "../../file-cache.js";
import { shellPathArg } from "../../shell-quote.js";
import { compactLines, truncateText } from "../../compact-output.js";

export function buildSymbolsDirCommand(dir: string, maxFiles: number): string {
  return `find ${shellPathArg(dir)} -maxdepth 3 -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.rb" -o -name "*.php" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name "*.test.*" -not -name "*.spec.*" | head -${maxFiles}`;
}

export function registerFileTools(server: McpServer, h: ToolHelpers): void {

  // ── read_file ─────────────────────────────────────────────────────────────

  server.tool(
    "read_file",
    "Read a file with summarize=true for AI outline (~90% fewer tokens). For full file reads without summarization, prefer your native Read tool (faster, no MCP overhead). Use this when you want cached reads or AI summaries.",
    {
      path: z.string().describe("File path"),
      offset: z.number().optional().describe("Start line (0-indexed)"),
      limit: z.number().optional().describe("Max lines to return"),
      summarize: z.boolean().optional().describe("Return AI summary instead of full content (saves ~90% tokens)"),
      focus: z.string().optional().describe("Focus hint for summary (e.g., 'public API', 'error handling', 'auth logic')"),
      full: z.boolean().optional().describe("Return full file content. Default is a compact preview unless limit or summarize is set."),
    },
    async ({ path: rawPath, offset, limit, summarize, focus, full }) => {
      const start = Date.now();
      const path = h.resolvePath(rawPath);
      const result = cachedRead(path, { offset, limit });

      if (summarize && result.content.length > 500) {
        const provider = getOutputProvider();
        const content = result.content.length > 8000 ? result.content.slice(0, 8000) : result.content;
        const focusInstruction = focus
          ? `Focus specifically on: ${focus}. Describe only aspects related to "${focus}".`
          : `Describe what this source file does in 2-4 lines. Include: main class/module name, key methods/functions, what it exports, and its purpose.`;
        const summary = await provider.complete(
          `File: ${path}\n\n${content}`,
          {
            system: `${focusInstruction} Be specific — name the actual functions and what they do. Never just say "N lines of code."`,
            maxTokens: 300,
            temperature: 0.2,
          }
        );
        const outputTokens = estimateTokens(result.content);
        const summaryTokens = estimateTokens(summary);
        const saved = Math.max(0, outputTokens - summaryTokens);
        h.logCall("read_file", { command: path, outputTokens, tokensSaved: saved, durationMs: Date.now() - start, aiProcessed: true });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            summary,
            lines: result.content.split("\n").length,
            tokensSaved: saved,
            cached: result.cached,
          }) }],
        };
      }

      const compact = !full && limit === undefined ? compactLines(result.content) : null;
      h.logCall("read_file", { command: path, outputTokens: estimateTokens(result.content), tokensSaved: 0, durationMs: Date.now() - start });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          content: compact ? compact.content : result.content,
          lines: compact?.lineCount ?? result.content.split("\n").length,
          truncated: compact?.truncated ?? false,
          cached: result.cached,
          readCount: result.readCount,
          hint: compact?.truncated ? "Use full=true, summarize=true, or limit/offset for more detail." : undefined,
          ...(result.cached ? { note: `Served from cache (read #${result.readCount})` } : {}),
        }) }],
      };
    }
  );

  // ── read_files ────────────────────────────────────────────────────────────

  server.tool(
    "read_files",
    "Read multiple files in one call. Use summarize=true for AI outlines (~90% fewer tokens per file). Saves N-1 round trips vs separate read_file calls.",
    {
      files: z.array(z.string()).describe("File paths (relative or absolute)"),
      summarize: z.boolean().optional().describe("AI summary instead of full content"),
      full: z.boolean().optional().describe("Return full file contents. Default is compact previews."),
      limit: z.number().optional().describe("Max preview lines per file (default: 80)"),
    },
    async ({ files, summarize, full, limit }) => {
      const start = Date.now();
      const results: Record<string, any> = {};
      const selectedFiles = files.slice(0, 10);
      const perFileLines = limit ?? 40;
      const perFileChars = Math.max(800, Math.floor(12000 / Math.max(1, selectedFiles.length)));

      for (const f of selectedFiles) { // max 10 files per call
        const filePath = h.resolvePath(f);
        const result = cachedRead(filePath, {});

        if (summarize && result.content.length > 500) {
          const provider = getOutputProvider();
          const content = result.content.length > 8000 ? result.content.slice(0, 8000) : result.content;
          const summary = await provider.complete(`File: ${filePath}\n\n${content}`, {
            system: `Describe what this source file does in 2-4 lines. Include: main class/module name, key methods/functions, what it exports, and its purpose. Be specific.`,
            maxTokens: 300, temperature: 0.2,
          });
          results[f] = { summary, lines: result.content.split("\n").length };
        } else {
          const compact = full ? null : compactLines(result.content, perFileLines, perFileChars);
          results[f] = {
            content: compact ? compact.content : result.content,
            lines: compact?.lineCount ?? result.content.split("\n").length,
            truncated: compact?.truncated ?? false,
            hint: compact?.truncated ? "Use full=true, summarize=true, or a dedicated read_file call with limit/offset for more detail." : undefined,
          };
        }
      }
      results.__meta = {
        requested: files.length,
        returned: selectedFiles.length,
        truncated: files.length > selectedFiles.length || Object.entries(results).some(([key, value]) => key !== "__meta" && value?.truncated),
        hint: "Default multi-file reads are aggregate-budgeted. Use full=true or summarize=true deliberately for larger output.",
      };

      h.logCall("read_files", { command: `${files.length} files`, durationMs: Date.now() - start, aiProcessed: !!summarize });
      return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
    }
  );

  // ── symbols ───────────────────────────────────────────────────────────────

  server.tool(
    "symbols",
    "Get a structured outline of any source file — functions, classes, methods, interfaces, exports with line numbers. Works for ALL languages (TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP, etc.). AI-powered, not regex.",
    {
      path: z.string().describe("File path to extract symbols from"),
    },
    async ({ path: rawPath }) => {
      const start = Date.now();
      const filePath = h.resolvePath(rawPath);
      const result = cachedRead(filePath, {});
      if (!result.content || result.content.startsWith("Error:")) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot read ${filePath}` }) }] };
      }

      // AI extracts symbols — works for ANY language
      let symbols: any[] = [];
      try {
        const provider = getOutputProvider();
        const content = result.content.length > 8000 ? result.content.slice(0, 8000) : result.content;
        const summary = await provider.complete(
          `File: ${filePath}\n\n${content}`,
          {
            system: `Extract all symbols from this source file. Return ONLY a JSON array, no explanation.

Each symbol: {"name": "symbolName", "kind": "function|class|method|interface|type|variable|export", "line": lineNumber, "signature": "brief signature"}

For class methods, use "ClassName.methodName" as name with kind "method".
Include: functions, classes, methods, interfaces, types, exported constants.
Exclude: imports, local variables, comments.
Line numbers must be accurate (count from 1).`,
            maxTokens: 2000,
            temperature: 0,
          }
        );

        const jsonMatch = summary.match(/\[[\s\S]*\]/);
        if (jsonMatch) symbols = JSON.parse(jsonMatch[0]);
      } catch (err: any) {
        // Surface the error instead of silently returning []
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `AI symbol extraction failed: ${err.message?.slice(0, 200)}`, file: filePath }) }] };
      }

      const outputTokens = estimateTokens(result.content);
      const symbolTokens = estimateTokens(JSON.stringify(symbols));
      h.logCall("symbols", { command: filePath, outputTokens, tokensSaved: Math.max(0, outputTokens - symbolTokens), durationMs: Date.now() - start, aiProcessed: true });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          symbols: symbols.slice(0, 100).map((symbol) => ({
            ...symbol,
            signature: symbol.signature ? truncateText(symbol.signature, 180) : undefined,
          })),
          total: symbols.length,
          hint: symbols.length > 100 ? "Showing 100 symbols. Use read_symbol for exact code blocks." : undefined,
        }) }],
      };
    }
  );

  // ── symbols_dir ───────────────────────────────────────────────────────────

  server.tool(
    "symbols_dir",
    "Get symbols for all source files in a directory. AI-powered, works for any language. One call replaces N separate symbols calls.",
    {
      path: z.string().optional().describe("Directory (default: src/)"),
      maxFiles: z.number().optional().describe("Max files to scan (default: 10)"),
    },
    async ({ path: dirPath, maxFiles }) => {
      const start = Date.now();
      const dir = h.resolvePath(dirPath ?? "src/");
      const limit = maxFiles ?? 10;

      // Find source files
      const findResult = await h.exec(buildSymbolsDirCommand(dir, limit), process.cwd(), 5000);
      const files = findResult.stdout.split("\n").filter(l => l.trim());

      const allSymbols: Record<string, any[]> = {};
      const provider = getOutputProvider();

      for (const file of files) {
        const result = cachedRead(file, {});
        if (!result.content || result.content.startsWith("Error:")) continue;
        try {
          const content = result.content.length > 6000 ? result.content.slice(0, 6000) : result.content;
          const summary = await provider.complete(`File: ${file}\n\n${content}`, {
            system: `Extract all symbols. Return ONLY a JSON array. Each: {"name":"x","kind":"function|class|method|interface|type","line":N,"signature":"brief"}. For class methods use "Class.method". Exclude imports.`,
            maxTokens: 1500, temperature: 0,
          });
          const jsonMatch = summary.match(/\[[\s\S]*\]/);
          if (jsonMatch) allSymbols[file] = JSON.parse(jsonMatch[0]);
        } catch {}
      }

      h.logCall("symbols_dir", { command: `${files.length} files in ${dir}`, durationMs: Date.now() - start, aiProcessed: true });
      return { content: [{ type: "text" as const, text: JSON.stringify({
        directory: dir,
        files: files.length,
        symbols: Object.fromEntries(Object.entries(allSymbols).map(([file, symbols]) => [
          file,
          symbols.slice(0, 50).map((symbol) => ({
            ...symbol,
            signature: symbol.signature ? truncateText(symbol.signature, 160) : undefined,
          })),
        ])),
        hint: "Use symbols({path}) or read_symbol({path,name}) for detail.",
      }) }] };
    }
  );

  // ── read_symbol ───────────────────────────────────────────────────────────

  server.tool(
    "read_symbol",
    "Read a specific function, class, or interface by name from a source file. Returns only the code block — not the entire file. Saves 70-85% tokens vs reading the whole file.",
    {
      path: z.string().describe("Source file path"),
      name: z.string().describe("Symbol name (function, class, interface)"),
    },
    async ({ path: rawPath, name }) => {
      const start = Date.now();
      const filePath = h.resolvePath(rawPath);
      const result = cachedRead(filePath, {});
      if (!result.content || result.content.startsWith("Error:")) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot read ${filePath}` }) }] };
      }

      // AI extracts the specific symbol — works for ANY language
      const provider = getOutputProvider();
      const summary = await provider.complete(
        `File: ${filePath}\nSymbol to extract: ${name}\n\n${result.content.slice(0, 8000)}`,
        {
          system: `Extract the complete code block for the symbol "${name}" from this file. Return ONLY a JSON object:
{"name": "${name}", "code": "the complete code block", "startLine": N, "endLine": N}

If the symbol is not found, return: {"error": "not found", "available": ["list", "of", "symbol", "names"]}

Match by function name, class name, method name (including ClassName.method), interface, type, or variable name.`,
          maxTokens: 2000,
          temperature: 0,
        }
      );

      let parsed: any = {};
      try {
        const jsonMatch = summary.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {}

      h.logCall("read_symbol", { command: `${filePath}:${name}`, outputTokens: estimateTokens(result.content), tokensSaved: Math.max(0, estimateTokens(result.content) - estimateTokens(JSON.stringify(parsed))), durationMs: Date.now() - start, aiProcessed: true });

      return { content: [{ type: "text" as const, text: JSON.stringify(parsed) }] };
    }
  );

  // ── edit ───────────────────────────────────────────────────────────────────

  server.tool(
    "edit",
    "Find and replace in a file. For simple edits, prefer your native Edit tool (faster). Use this for batch replacements (all=true) or when you don't have a native Edit tool available.",
    {
      file: z.string().describe("File path"),
      find: z.string().describe("Text to find (exact match)"),
      replace: z.string().describe("Replacement text"),
      all: z.boolean().optional().describe("Replace all occurrences (default: first only)"),
    },
    async ({ file: rawFile, find, replace, all }) => {
      const start = Date.now();
      const file = h.resolvePath(rawFile);
      const { readFileSync, writeFileSync } = await import("fs");
      try {
        let content = readFileSync(file, "utf8");
        const count = (content.match(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
        if (count === 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Text not found", file }) }] };
        }
        if (all) {
          content = content.split(find).join(replace);
        } else {
          content = content.replace(find, replace);
        }
        writeFileSync(file, content);
        h.logCall("edit", { command: `edit ${file}`, durationMs: Date.now() - start });
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, file, replacements: all ? count : 1, diff: { removed: find.slice(0, 100), added: replace.slice(0, 100) } }) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: e.message }) }] };
      }
    }
  );

  // ── review ────────────────────────────────────────────────────────────────

  server.tool(
    "review",
    "AI code review of recent changes or specific files. Returns: bugs, security issues, suggestions. One call replaces git diff + manual reading.",
    {
      since: z.string().optional().describe("Git ref to diff against (e.g., 'HEAD~3', 'main')"),
      files: z.array(z.string()).optional().describe("Specific files to review"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ since, files, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();

      let content: string;
      if (files && files.length > 0) {
        const fileContents = files.map(f => {
          const result = cachedRead(h.resolvePath(f, workDir), {});
          return `=== ${f} ===\n${result.content.slice(0, 4000)}`;
        });
        content = fileContents.join("\n\n");
      } else {
        const ref = since ?? "HEAD~1";
        const diff = await h.exec(`git diff ${ref} --no-color`, workDir, 15000);
        content = diff.stdout.slice(0, 12000);
      }

      const provider = getOutputProvider();
      const review = await provider.complete(`Review this code:\n\n${content}`, {
        system: `You are a senior code reviewer. Review concisely:
- Bugs or logic errors
- Security issues (injection, auth, secrets)
- Missing error handling
- Performance concerns
- Style/naming issues (only if significant)

Format: list issues as "- [severity] file:line description". If clean, say "No issues found."
Be specific, not generic. Only flag real problems.`,
        maxTokens: 800, temperature: 0.2,
      });

      h.logCall("review", { command: `review ${since ?? files?.join(",") ?? "HEAD~1"}`, durationMs: Date.now() - start, aiProcessed: true });
      return { content: [{ type: "text" as const, text: JSON.stringify({ review, scope: since ?? files }) }] };
    }
  );

  // ── write_files ─────────────────────────────────────────────────────────

  server.tool(
    "write_files",
    "Write multiple files in one call. Auto-creates parent directories. Saves N-1 round trips vs separate writes.",
    {
      files: z.array(z.object({
        path: z.string().describe("File path (relative or absolute)"),
        content: z.string().describe("File content"),
      })).describe("Files to write"),
    },
    async ({ files }) => {
      const { writeFileSync, mkdirSync, existsSync } = await import("fs");
      const { dirname } = await import("path");
      const results: { path: string; ok: boolean; bytes?: number; error?: string }[] = [];
      for (const f of files.slice(0, 20)) {
        try {
          const filePath = h.resolvePath(f.path);
          const dir = dirname(filePath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(filePath, f.content);
          results.push({ path: f.path, ok: true, bytes: f.content.length });
        } catch (e: any) {
          results.push({ path: f.path, ok: false, error: e.message?.slice(0, 100) });
        }
      }
      h.logCall("write_files", { command: `${files.length} files` });
      return { content: [{ type: "text" as const, text: JSON.stringify({ written: results.filter(r => r.ok).length, total: results.length, results }) }] };
    }
  );
}
