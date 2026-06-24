// Execute tools: execute, execute_smart, execute_diff, expand, browse, explain_error

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { compress, stripAnsi } from "../../compression.js";
import { estimateTokens } from "../../tokens.js";
import { processOutput } from "../../output-processor.js";
import { storeOutput, expandOutput } from "../../expand-store.js";
import { shouldBeLazy, toLazy } from "../../lazy-executor.js";
import { diffOutput } from "../../diff-cache.js";
import { recordSaving } from "../../economy.js";
import { shellPathArg } from "../../shell-quote.js";
import { compactLines, compactPath, truncateText } from "../../compact-output.js";

export function buildBrowseCommand(options: {
  target: string;
  recursive: boolean;
  depth: number;
  includeHidden: boolean;
}): string {
  const target = shellPathArg(options.target);
  if (options.recursive) {
    let command = `find ${target} -maxdepth ${options.depth} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*'`;
    if (!options.includeHidden) command += " -not -name '.*'";
    return command;
  }

  return options.includeHidden ? `ls -la ${target}` : `ls -l ${target}`;
}

export function registerExecuteTools(server: McpServer, h: ToolHelpers): void {

  // ── execute: run a command, return structured result ──────────────────────

  server.tool(
    "execute",
    "Run a shell command. Format guide: no format/raw for git commit/push (<50 tokens). format=compressed for long build output (CPU-only, no AI). format=json or format=summary for AI-summarized output (234ms, saves 80% tokens). Prefer execute_smart for most tasks.",
    {
      command: z.string().describe("Shell command to execute"),
      cwd: z.string().optional().describe("Working directory (default: server cwd)"),
      timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
      format: z.enum(["raw", "json", "compressed", "summary"]).optional().describe("Output format"),
      maxTokens: z.number().optional().describe("Token budget for compressed/summary format"),
    },
    async ({ command, cwd, timeout, format, maxTokens }) => {
      const start = Date.now();
      const result = await h.exec(command, cwd, timeout ?? 30000);
      const output = (result.stdout + result.stderr).trim();

      // Raw mode — with lazy execution for large results
      if (!format || format === "raw") {
        const clean = stripAnsi(output);
        if (shouldBeLazy(clean, command)) {
          const lazy = toLazy(clean, command);
          const detailKey = storeOutput(command, clean);
          h.logCall("execute", { command, outputTokens: estimateTokens(clean), tokensSaved: 0, durationMs: Date.now() - start, exitCode: result.exitCode });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              exitCode: result.exitCode, ...lazy, detailKey, duration: result.duration,
              ...(result.rewritten ? { rewrittenFrom: command } : {}),
            }) }],
          };
        }
        h.logCall("execute", { command, outputTokens: estimateTokens(clean), tokensSaved: 0, durationMs: Date.now() - start, exitCode: result.exitCode });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            exitCode: result.exitCode, output: clean, duration: result.duration, tokens: estimateTokens(clean),
            ...(result.rewritten ? { rewrittenFrom: command } : {}),
          }) }],
        };
      }

      // JSON and Summary modes — both go through AI processing
      if (format === "json" || format === "summary") {
        try {
          const processed = await processOutput(command, output);
          const detailKey = output.split("\n").length > 15 ? storeOutput(command, output) : undefined;
          h.logCall("execute", { command, outputTokens: estimateTokens(output), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode, aiProcessed: processed.aiProcessed });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              exitCode: result.exitCode,
              summary: processed.summary,
              structured: processed.structured,
              duration: result.duration,
              tokensSaved: processed.tokensSaved,
              aiProcessed: processed.aiProcessed,
              ...(detailKey ? { detailKey, expandable: true } : {}),
            }) }],
          };
        } catch {
          const compressed = compress(command, output, { maxTokens });
          h.logCall("execute", { command, outputTokens: estimateTokens(output), tokensSaved: compressed.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              exitCode: result.exitCode, output: compressed.content, duration: result.duration,
              tokensSaved: compressed.tokensSaved,
            }) }],
          };
        }
      }

      // Compressed mode — fast non-AI: strip + dedup + truncate
      if (format === "compressed") {
        const compressed = compress(command, output, { maxTokens });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            exitCode: result.exitCode, output: compressed.content, duration: result.duration,
            ...(compressed.tokensSaved > 0 ? { tokensSaved: compressed.tokensSaved, savingsPercent: compressed.savingsPercent } : {}),
          }) }],
        };
      }

      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  // ── execute_smart: AI-powered output processing ────────────────────────────

  server.tool(
    "execute_smart",
    "Run a command and get AI-summarized output (80-95% token savings). Use this for: test runs, builds, git operations, process management, system info. Do NOT use for file read/write — use your native Read/Write/Edit tools instead (they're faster, no shell overhead).",
    {
      command: z.string().describe("Shell command to execute"),
      cwd: z.string().optional().describe("Working directory"),
      timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
      verbosity: z.enum(["minimal", "normal", "detailed"]).optional().describe("Summary detail level (default: normal)"),
    },
    async ({ command, cwd, timeout, verbosity }) => {
      const start = Date.now();
      const result = await h.exec(command, cwd, timeout ?? 30000, true);
      const output = (result.stdout + result.stderr).trim();
      const processed = await processOutput(command, output, undefined, verbosity);

      const detailKey = output.split("\n").length > 15 ? storeOutput(command, output) : undefined;
      h.logCall("execute_smart", { command, outputTokens: estimateTokens(output), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode, aiProcessed: processed.aiProcessed });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          exitCode: result.exitCode,
          summary: processed.summary,
          structured: processed.structured,
          duration: result.duration,
          totalLines: output.split("\n").length,
          tokensSaved: processed.tokensSaved,
          aiProcessed: processed.aiProcessed,
          ...(detailKey ? { detailKey, expandable: true } : {}),
        }) }],
      };
    }
  );

  // ── execute_diff: run command with diff from last run ───────────────────────

  server.tool(
    "execute_diff",
    "Run a command and return diff from its last execution. Ideal for edit→test loops — only shows what changed.",
    {
      command: z.string().describe("Shell command to execute"),
      cwd: z.string().optional().describe("Working directory"),
      timeout: z.number().optional().describe("Timeout in ms"),
    },
    async ({ command, cwd, timeout }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const result = await h.exec(command, workDir, timeout ?? 30000);
      const output = (result.stdout + result.stderr).trim();
      const diff = diffOutput(command, workDir, output);

      if (diff.tokensSaved > 0) {
        recordSaving("diff", diff.tokensSaved);
      }
      h.logCall("execute_diff", { command, outputTokens: estimateTokens(output), tokensSaved: diff.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode });

      if (diff.unchanged) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          exitCode: result.exitCode, unchanged: true, diffSummary: diff.diffSummary,
          duration: result.duration, tokensSaved: diff.tokensSaved,
        }) }] };
      }

      if (diff.hasPrevious) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          exitCode: result.exitCode, diffSummary: diff.diffSummary,
          added: diff.added.slice(0, 50), removed: diff.removed.slice(0, 50),
          duration: result.duration, tokensSaved: diff.tokensSaved,
        }) }] };
      }

      // First run — return a bounded preview and keep full output expandable.
      const clean = stripAnsi(output);
      const preview = compactLines(clean, 80, 6000);
      const detailKey = preview.truncated ? storeOutput(command, clean) : undefined;
      return { content: [{ type: "text" as const, text: JSON.stringify({
        exitCode: result.exitCode,
        output: preview.content,
        lines: preview.lineCount,
        truncated: preview.truncated,
        ...(detailKey ? { detailKey, expandable: true, hint: "Use expand({key: detailKey}) for full first-run output." } : {}),
        diffSummary: "first run", duration: result.duration,
      }) }] };
    }
  );

  // ── expand: retrieve full output on demand ────────────────────────────────

  server.tool(
    "expand",
    "Retrieve full output from a previous execute_smart call. Only call this when you need details (e.g., to see failing test errors). Use the detailKey from execute_smart response.",
    {
      key: z.string().describe("The detailKey from a previous execute_smart response"),
      grep: z.string().optional().describe("Filter output lines by pattern (e.g., 'FAIL', 'error')"),
      offset: z.number().optional().describe("Start line offset after filtering (default: 0)"),
      limit: z.number().optional().describe("Maximum lines to return after filtering"),
      context: z.number().optional().describe("Context lines around grep matches"),
    },
    async ({ key, grep, offset, limit, context }) => {
      const result = expandOutput(key, { grep, offset, limit, context });
      if (!result.found) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Output expired or not found" }) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  // ── browse: list files/dirs as structured JSON ────────────────────────────

  server.tool(
    "browse",
    "List files and directories as structured JSON. Auto-filters node_modules, .git, dist by default.",
    {
      path: z.string().optional().describe("Directory path (default: cwd)"),
      recursive: z.boolean().optional().describe("List recursively (default: false)"),
      maxDepth: z.number().optional().describe("Max depth for recursive listing (default: 2)"),
      includeHidden: z.boolean().optional().describe("Include hidden files (default: false)"),
      limit: z.number().optional().describe("Max entries to return (default: 50, max: 200)"),
      full: z.boolean().optional().describe("Return all entries. Default is compact and capped."),
    },
    async ({ path, recursive, maxDepth, includeHidden, limit, full }) => {
      const target = path ?? process.cwd();
      const depth = Math.min(maxDepth ?? 2, 5);
      const pageSize = Math.min(limit ?? 50, 200);
      const command = buildBrowseCommand({
        target,
        recursive: !!recursive,
        depth,
        includeHidden: !!includeHidden,
      });

      const result = await h.exec(command);
      const files = result.stdout.split("\n").filter(l => l.trim());
      const visible = full ? files : files.slice(0, pageSize);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        cwd: compactPath(target, 4),
        files: visible.map((file) => truncateText(file, 220)),
        count: files.length,
        returned: visible.length,
        truncated: !full && files.length > visible.length,
        hint: !full && files.length > visible.length ? "Use limit, recursive/maxDepth, or full=true for more entries." : undefined,
      }) }] };
    }
  );

  // ── explain_error: structured error diagnosis ─────────────────────────────

  server.tool(
    "explain_error",
    "Parse error output and return structured diagnosis with root cause and fix suggestion.",
    {
      error: z.string().describe("Error output text"),
      command: z.string().optional().describe("The command that produced the error"),
    },
    async ({ error, command }) => {
      // AI processes the error — no regex guessing
      const processed = await processOutput(command ?? "unknown", error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          summary: processed.summary,
          structured: processed.structured,
          aiProcessed: processed.aiProcessed,
        }) }],
      };
    }
  );
}
