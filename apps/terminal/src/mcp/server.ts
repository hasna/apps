// MCP Server for terminal — exposes terminal capabilities to AI agents

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import { compress, stripAnsi } from "../compression.js";
import { stripNoise } from "../noise-filter.js";
import { estimateTokens } from "../tokens.js";
import { processOutput } from "../output-processor.js";
import { getOutputProvider } from "../providers/index.js";
import { searchFiles, searchContent, semanticSearch } from "../search/index.js";
import { listRecipes, listCollections, getRecipe, createRecipe } from "../recipes/storage.js";
import { substituteVariables } from "../recipes/model.js";
import { bgStart, bgStatus, bgStop, bgLogs, bgWaitPort } from "../supervisor.js";
import { diffOutput } from "../diff-cache.js";
import { createSession, logInteraction, listSessions, getSessionInteractions, getSessionStats, getSessionEconomy } from "../sessions-db.js";
import { cachedRead, cacheStats } from "../file-cache.js";
import { getBootContext, invalidateBootCache } from "../session-boot.js";
import { storeOutput, expandOutput } from "../expand-store.js";
import { rewriteCommand } from "../command-rewriter.js";
import { shouldBeLazy, toLazy } from "../lazy-executor.js";
import { getEconomyStats, recordSaving } from "../economy.js";
import { captureSnapshot } from "../snapshots.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function exec(command: string, cwd?: string, timeout?: number, allowRewrite: boolean = false): Promise<{ exitCode: number; stdout: string; stderr: string; duration: number; rewritten?: string }> {
  // Only rewrite when explicitly allowed (execute_smart, not raw execute)
  const rw = allowRewrite ? rewriteCommand(command) : { changed: false, rewritten: command };
  const actualCommand = rw.changed ? rw.rewritten : command;
  return new Promise((resolve) => {
    const start = Date.now();
    const proc = spawn("/bin/zsh", ["-c", actualCommand], {
      cwd: cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = timeout ? setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeout) : null;

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      // Strip noise before returning (npm fund, progress bars, etc.)
      const cleanStdout = stripNoise(stdout).cleaned;
      const cleanStderr = stripNoise(stderr).cleaned;
      // Invalidate boot cache after state-changing git commands
      if (/\bgit\s+(commit|checkout|branch|merge|reset|push|pull|rebase|stash)\b/.test(actualCommand)) {
        invalidateBootCache();
      }
      resolve({ exitCode: code ?? 0, stdout: cleanStdout, stderr: cleanStderr, duration: Date.now() - start, rewritten: rw.changed ? rw.rewritten : undefined });
    });
  });
}

/** Resolve a path — supports relative paths against cwd, just like a shell */
function resolvePath(p: string, cwd?: string): string {
  if (!p) return cwd ?? process.cwd();
  if (p.startsWith("/") || p.startsWith("~")) return p;
  const { join } = require("path");
  return join(cwd ?? process.cwd(), p);
}

// ── server ───────────────────────────────────────────────────────────────────

export function createServer(): McpServer {
  const server = new McpServer({
    name: "terminal",
    version: "3.4.0",
  });

  // Create a session for this MCP server instance
  const sessionId = createSession(process.cwd(), "mcp");

  /** Log a tool call to sessions.db for economy tracking */
  function logCall(tool: string, data: {
    command?: string;
    outputTokens?: number;
    tokensSaved?: number;
    durationMs?: number;
    exitCode?: number;
    aiProcessed?: boolean;
    model?: string;
  }) {
    try {
      logInteraction(sessionId, {
        nl: `[mcp:${tool}]${data.command ? ` ${data.command.slice(0, 200)}` : ""}`,
        command: data.command?.slice(0, 500),
        exitCode: data.exitCode,
        tokensUsed: data.aiProcessed ? (data.outputTokens ?? 0) : 0,
        tokensSaved: data.tokensSaved ?? 0,
        durationMs: data.durationMs,
        model: data.model,
        cached: false,
      });
    } catch {} // never let logging break tool execution
  }

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
      const result = await exec(command, cwd, timeout ?? 30000);
      const output = (result.stdout + result.stderr).trim();

      // Raw mode — with lazy execution for large results
      if (!format || format === "raw") {
        const clean = stripAnsi(output);
        if (shouldBeLazy(clean, command)) {
          const lazy = toLazy(clean, command);
          const detailKey = storeOutput(command, clean);
          logCall("execute", { command, outputTokens: estimateTokens(clean), tokensSaved: 0, durationMs: Date.now() - start, exitCode: result.exitCode });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              exitCode: result.exitCode, ...lazy, detailKey, duration: result.duration,
              ...(result.rewritten ? { rewrittenFrom: command } : {}),
            }) }],
          };
        }
        logCall("execute", { command, outputTokens: estimateTokens(clean), tokensSaved: 0, durationMs: Date.now() - start, exitCode: result.exitCode });
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
          logCall("execute", { command, outputTokens: estimateTokens(output), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode, aiProcessed: processed.aiProcessed });
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
          logCall("execute", { command, outputTokens: estimateTokens(output), tokensSaved: compressed.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode });
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
    },
    async ({ command, cwd, timeout }) => {
      const start = Date.now();
      const result = await exec(command, cwd, timeout ?? 30000, true);
      const output = (result.stdout + result.stderr).trim();
      const processed = await processOutput(command, output);

      const detailKey = output.split("\n").length > 15 ? storeOutput(command, output) : undefined;
      logCall("execute_smart", { command, outputTokens: estimateTokens(output), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode, aiProcessed: processed.aiProcessed });

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

  // ── expand: retrieve full output on demand ────────────────────────────────

  server.tool(
    "expand",
    "Retrieve full output from a previous execute_smart call. Only call this when you need details (e.g., to see failing test errors). Use the detailKey from execute_smart response.",
    {
      key: z.string().describe("The detailKey from a previous execute_smart response"),
      grep: z.string().optional().describe("Filter output lines by pattern (e.g., 'FAIL', 'error')"),
    },
    async ({ key, grep }) => {
      const result = expandOutput(key, grep);
      if (!result.found) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Output expired or not found" }) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify({ output: result.output, lines: result.lines }) }] };
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
    },
    async ({ path, recursive, maxDepth, includeHidden }) => {
      const target = path ?? process.cwd();
      const depth = maxDepth ?? 2;

      let command: string;
      if (recursive) {
        command = `find "${target}" -maxdepth ${depth} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*'`;
        if (!includeHidden) command += " -not -name '.*'";
      } else {
        command = includeHidden ? `ls -la "${target}"` : `ls -l "${target}"`;
      }

      const result = await exec(command);
      const files = result.stdout.split("\n").filter(l => l.trim());
      return { content: [{ type: "text" as const, text: JSON.stringify({ cwd: target, files, count: files.length }) }] };
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

  // ── status: show server info ──────────────────────────────────────────────

  server.tool(
    "status",
    "Get terminal server status, capabilities, and available parsers.",
    async () => {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          name: "terminal", version: "3.3.0", cwd: process.cwd(),
          features: ["ai-output-processing", "token-compression", "noise-filtering", "diff-caching", "lazy-execution", "progressive-disclosure"],
        }) }],
      };
    }
  );

  // ── search_files: smart file search with auto-filtering ────────────────────

  server.tool(
    "search_files",
    "Search for files by name pattern. Auto-filters node_modules, .git, dist. Returns categorized results (source, config, other) with token savings.",
    {
      pattern: z.string().describe("Glob pattern (e.g., '*hooks*', '*.test.ts')"),
      path: z.string().optional().describe("Search root (default: cwd)"),
      includeNodeModules: z.boolean().optional().describe("Include node_modules (default: false)"),
      maxResults: z.number().optional().describe("Max results per category (default: 50)"),
    },
    async ({ pattern, path, includeNodeModules, maxResults }) => {
      const start = Date.now();
      const result = await searchFiles(pattern, path ?? process.cwd(), { includeNodeModules, maxResults });
      logCall("search_files", { command: `search_files ${pattern}`, tokensSaved: (result as any).tokensSaved ?? 0, durationMs: Date.now() - start });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  // ── search_content: smart grep with grouping ──────────────────────────────

  server.tool(
    "search_content",
    "Search file contents by regex pattern. Groups matches by file, sorted by relevance. Auto-filters excluded directories.",
    {
      pattern: z.string().describe("Search pattern (regex)"),
      path: z.string().optional().describe("Search root (default: cwd)"),
      fileType: z.string().optional().describe("File type filter (e.g., 'ts', 'py')"),
      maxResults: z.number().optional().describe("Max files to return (default: 30)"),
      contextLines: z.number().optional().describe("Context lines around matches (default: 0)"),
    },
    async ({ pattern, path, fileType, maxResults, contextLines }) => {
      const start = Date.now();
      const result = await searchContent(pattern, path ?? process.cwd(), { fileType, maxResults, contextLines });
      logCall("search_content", { command: `grep ${pattern}`, tokensSaved: result.tokensSaved ?? 0, durationMs: Date.now() - start });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  // ── search_semantic: AST-powered code search ───────────────────────────────

  server.tool(
    "search_semantic",
    "Find functions, classes, components, hooks, types by NAME or SIGNATURE. Searches symbol declarations, NOT code behavior or content. Use search_content (grep) instead for pattern matching inside code (e.g., security audits, string searches, imports).",
    {
      query: z.string().describe("Symbol name to search for (e.g., 'auth', 'login', 'UserService'). Matches function/class/type names, not code content."),
      path: z.string().optional().describe("Search root (default: cwd)"),
      kinds: z.array(z.enum(["function", "class", "interface", "type", "variable", "export", "import", "component", "hook"])).optional().describe("Filter by symbol kind"),
      exportedOnly: z.boolean().optional().describe("Only show exported symbols (default: false)"),
      maxResults: z.number().optional().describe("Max results (default: 30)"),
    },
    async ({ query, path, kinds, exportedOnly, maxResults }) => {
      const result = await semanticSearch(query, path ?? process.cwd(), {
        kinds: kinds as any,
        exportedOnly,
        maxResults,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  // ── list_recipes: list saved command recipes ──────────────────────────────

  server.tool(
    "list_recipes",
    "List saved command recipes. Optionally filter by collection or project.",
    {
      collection: z.string().optional().describe("Filter by collection name"),
      project: z.string().optional().describe("Project path for project-scoped recipes"),
    },
    async ({ collection, project }) => {
      let recipes = listRecipes(project);
      if (collection) recipes = recipes.filter(r => r.collection === collection);
      return { content: [{ type: "text" as const, text: JSON.stringify(recipes) }] };
    }
  );

  // ── run_recipe: execute a saved recipe ────────────────────────────────────

  server.tool(
    "run_recipe",
    "Run a saved recipe by name with optional variable substitution.",
    {
      name: z.string().describe("Recipe name"),
      variables: z.record(z.string(), z.string()).optional().describe("Variable values: {port: '3000'}"),
      cwd: z.string().optional().describe("Working directory"),
      format: z.enum(["raw", "json", "compressed"]).optional().describe("Output format"),
    },
    async ({ name, variables, cwd, format }) => {
      const recipe = getRecipe(name, cwd);
      if (!recipe) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Recipe '${name}' not found` }) }] };
      }

      const command = variables ? substituteVariables(recipe.command, variables) : recipe.command;
      const result = await exec(command, cwd, 30000);
      const output = (result.stdout + result.stderr).trim();

      if (format === "json" || format === "compressed") {
        const processed = await processOutput(command, output);
        return { content: [{ type: "text" as const, text: JSON.stringify({
          recipe: name, exitCode: result.exitCode, summary: processed.summary,
          structured: processed.structured, duration: result.duration,
          tokensSaved: processed.tokensSaved, aiProcessed: processed.aiProcessed,
        }) }] };
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({
        recipe: name, exitCode: result.exitCode, output: stripAnsi(output), duration: result.duration,
      }) }] };
    }
  );

  // ── save_recipe: save a new recipe ────────────────────────────────────────

  server.tool(
    "save_recipe",
    "Save a reusable command recipe. Variables in commands use {name} syntax.",
    {
      name: z.string().describe("Recipe name"),
      command: z.string().describe("Shell command (use {var} for variables)"),
      description: z.string().optional().describe("Description"),
      collection: z.string().optional().describe("Collection to add to"),
      project: z.string().optional().describe("Project path (for project-scoped recipe)"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ name, command, description, collection, project, tags }) => {
      const recipe = createRecipe({ name, command, description, collection, project, tags });
      return { content: [{ type: "text" as const, text: JSON.stringify(recipe) }] };
    }
  );

  // ── list_collections: list recipe collections ─────────────────────────────

  server.tool(
    "list_collections",
    "List recipe collections.",
    {
      project: z.string().optional().describe("Project path"),
    },
    async ({ project }) => {
      const collections = listCollections(project);
      return { content: [{ type: "text" as const, text: JSON.stringify(collections) }] };
    }
  );

  // ── bg_start: start a background process ───────────────────────────────────

  server.tool(
    "bg_start",
    "Start a background process (e.g., dev server). Auto-detects port from command.",
    {
      command: z.string().describe("Command to run in background"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ command, cwd }) => {
      const result = bgStart(command, cwd);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  // ── bg_status: list background processes ──────────────────────────────────

  server.tool(
    "bg_status",
    "List all managed background processes with status, ports, and recent output.",
    async () => {
      return { content: [{ type: "text" as const, text: JSON.stringify(bgStatus()) }] };
    }
  );

  // ── bg_stop: stop a background process ────────────────────────────────────

  server.tool(
    "bg_stop",
    "Stop a managed background process by PID.",
    { pid: z.number().describe("Process ID to stop") },
    async ({ pid }) => {
      const ok = bgStop(pid);
      return { content: [{ type: "text" as const, text: JSON.stringify({ stopped: ok, pid }) }] };
    }
  );

  // ── bg_logs: get process output ───────────────────────────────────────────

  server.tool(
    "bg_logs",
    "Get recent output lines from a background process.",
    {
      pid: z.number().describe("Process ID"),
      tail: z.number().optional().describe("Number of lines (default: 20)"),
    },
    async ({ pid, tail }) => {
      const lines = bgLogs(pid, tail);
      return { content: [{ type: "text" as const, text: JSON.stringify({ pid, lines }) }] };
    }
  );

  // ── bg_wait_port: wait for port to be ready ───────────────────────────────

  server.tool(
    "bg_wait_port",
    "Wait for a port to start accepting connections. Useful after starting a dev server.",
    {
      port: z.number().describe("Port number to wait for"),
      timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
    },
    async ({ port, timeout }) => {
      const ready = await bgWaitPort(port, timeout);
      return { content: [{ type: "text" as const, text: JSON.stringify({ port, ready }) }] };
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
      const result = await exec(command, workDir, timeout ?? 30000);
      const output = (result.stdout + result.stderr).trim();
      const diff = diffOutput(command, workDir, output);

      if (diff.tokensSaved > 0) {
        recordSaving("diff", diff.tokensSaved);
      }
      logCall("execute_diff", { command, outputTokens: estimateTokens(output), tokensSaved: diff.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode });

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

      // First run — return full output (ANSI stripped)
      const clean = stripAnsi(output);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        exitCode: result.exitCode, output: clean,
        diffSummary: "first run", duration: result.duration,
      }) }] };
    }
  );

  // ── token_stats: economy dashboard ────────────────────────────────────────

  server.tool(
    "token_stats",
    "Get token economy stats — how many tokens have been saved by structured output, compression, diffing, and caching.",
    async () => {
      const stats = getEconomyStats();
      return { content: [{ type: "text" as const, text: JSON.stringify(stats) }] };
    }
  );

  // ── snapshot: capture terminal state ──────────────────────────────────────

  server.tool(
    "snapshot",
    "Capture a compact snapshot of terminal state (cwd, env, running processes, recent commands, recipes). Useful for agent context handoff.",
    async () => {
      const snap = captureSnapshot();
      return { content: [{ type: "text" as const, text: JSON.stringify(snap) }] };
    }
  );

  // ── session_history: query session data ────────────────────────────────────

  server.tool(
    "session_history",
    "Query terminal session history — recent sessions, specific session details, or aggregate stats.",
    {
      action: z.enum(["list", "detail", "stats"]).describe("list=recent sessions, detail=specific session, stats=aggregates"),
      sessionId: z.string().optional().describe("Session ID (for detail action)"),
      limit: z.number().optional().describe("Max sessions to return (for list, default: 20)"),
    },
    async ({ action, sessionId, limit }) => {
      if (action === "stats") {
        return { content: [{ type: "text" as const, text: JSON.stringify(getSessionStats()) }] };
      }
      if (action === "detail" && sessionId) {
        const interactions = getSessionInteractions(sessionId);
        const economy = getSessionEconomy(sessionId);
        return { content: [{ type: "text" as const, text: JSON.stringify({ interactions, economy }) }] };
      }
      const sessions = listSessions(limit ?? 20);
      return { content: [{ type: "text" as const, text: JSON.stringify(sessions) }] };
    }
  );

  // ── boot: session start context (replaces first 5 agent commands) ──────────

  server.tool(
    "boot",
    "Get everything an agent needs on session start in ONE call — git state, project info, source structure. Replaces: git status + git log + cat package.json + ls src/. Cached for the session.",
    async () => {
      const ctx = await getBootContext(process.cwd());
      return { content: [{ type: "text" as const, text: JSON.stringify({
        ...ctx,
        hints: {
          cwd: process.cwd(),
          tip: "All terminal tools support relative paths. Use 'src/foo.ts' not the full absolute path. Use commit({message, push:true}) instead of raw git commands. Use run({task:'test'}) instead of bun/npm test. Use lookup({file, items}) instead of grep pipelines.",
        },
      }) }] };
    }
  );

  // ── project_overview: orient agent in one call ─────────────────────────────

  server.tool(
    "project_overview",
    "Get project overview in one call — package.json info, source structure, config files. Replaces: cat package.json + ls src/ + cat tsconfig.json.",
    {
      path: z.string().optional().describe("Project root (default: cwd)"),
    },
    async ({ path }) => {
      const cwd = path ?? process.cwd();
      const [pkgResult, srcResult, configResult] = await Promise.all([
        exec("cat package.json 2>/dev/null", cwd),
        exec("ls -1 src/ 2>/dev/null || ls -1 lib/ 2>/dev/null || ls -1 app/ 2>/dev/null", cwd),
        exec("ls -1 *.json *.config.* .env* tsconfig* 2>/dev/null", cwd),
      ]);

      let pkg: any = null;
      try { pkg = JSON.parse(pkgResult.stdout); } catch {}

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          name: pkg?.name,
          version: pkg?.version,
          scripts: pkg?.scripts,
          dependencies: pkg?.dependencies ? Object.keys(pkg.dependencies) : [],
          devDependencies: pkg?.devDependencies ? Object.keys(pkg.devDependencies) : [],
          sourceFiles: srcResult.stdout.split("\n").filter(l => l.trim()),
          configFiles: configResult.stdout.split("\n").filter(l => l.trim()),
        }) }],
      };
    }
  );

  // ── last_commit: what just happened ───────────────────────────────────────

  server.tool(
    "last_commit",
    "Get details of the last commit — hash, message, files changed, diff stats. Replaces: git log -1 + git show --stat + git diff HEAD~1.",
    {
      path: z.string().optional().describe("Repo path (default: cwd)"),
    },
    async ({ path }) => {
      const cwd = path ?? process.cwd();
      const [logResult, statResult] = await Promise.all([
        exec("git log -1 --format='%H%n%s%n%an%n%ai'", cwd),
        exec("git show --stat --format='' HEAD", cwd),
      ]);

      const [hash, message, author, date] = logResult.stdout.split("\n");
      const filesChanged = statResult.stdout.split("\n").filter(l => l.trim() && !l.includes("changed"));

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          hash: hash?.trim(),
          message: message?.trim(),
          author: author?.trim(),
          date: date?.trim(),
          filesChanged,
        }) }],
      };
    }
  );

  // ── read_file: cached file reading ─────────────────────────────────────────

  server.tool(
    "read_file",
    "Read a file with summarize=true for AI outline (~90% fewer tokens). For full file reads without summarization, prefer your native Read tool (faster, no MCP overhead). Use this when you want cached reads or AI summaries.",
    {
      path: z.string().describe("File path"),
      offset: z.number().optional().describe("Start line (0-indexed)"),
      limit: z.number().optional().describe("Max lines to return"),
      summarize: z.boolean().optional().describe("Return AI summary instead of full content (saves ~90% tokens)"),
    },
    async ({ path: rawPath, offset, limit, summarize }) => {
      const start = Date.now();
      const path = resolvePath(rawPath);
      const result = cachedRead(path, { offset, limit });

      if (summarize && result.content.length > 500) {
        // AI-native file summary — ask directly what the file does
        const provider = getOutputProvider();
        const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
        const content = result.content.length > 8000 ? result.content.slice(0, 8000) : result.content;
        const summary = await provider.complete(
          `File: ${path}\n\n${content}`,
          {
            model: outputModel,
            system: `Describe what this source file does in 2-4 lines. Include: main class/module name, key methods/functions, what it exports, and its purpose. Be specific — name the actual functions and what they do. Never just say "N lines of code."`,
            maxTokens: 300,
            temperature: 0.2,
          }
        );
        const outputTokens = estimateTokens(result.content);
        const summaryTokens = estimateTokens(summary);
        const saved = Math.max(0, outputTokens - summaryTokens);
        logCall("read_file", { command: path, outputTokens, tokensSaved: saved, durationMs: Date.now() - start, aiProcessed: true });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            summary,
            lines: result.content.split("\n").length,
            tokensSaved: saved,
            cached: result.cached,
          }) }],
        };
      }

      logCall("read_file", { command: path, outputTokens: estimateTokens(result.content), tokensSaved: 0, durationMs: Date.now() - start });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          content: result.content,
          cached: result.cached,
          readCount: result.readCount,
          ...(result.cached ? { note: `Served from cache (read #${result.readCount})` } : {}),
        }) }],
      };
    }
  );

  // ── repo_state: git status + diff + log in one call ───────────────────────

  server.tool(
    "repo_state",
    "Get full repository state in one call — branch, status, staged/unstaged files, recent commits. Replaces the common 3-command pattern: git status + git diff --stat + git log.",
    {
      path: z.string().optional().describe("Repo path (default: cwd)"),
    },
    async ({ path }) => {
      const cwd = path ?? process.cwd();
      const [statusResult, diffResult, logResult] = await Promise.all([
        exec("git status --porcelain", cwd),
        exec("git diff --stat", cwd),
        exec("git log --oneline -12 --decorate", cwd),
      ]);

      const branchResult = await exec("git branch --show-current", cwd);

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];
      for (const line of statusResult.stdout.split("\n").filter(l => l.trim())) {
        const x = line[0], y = line[1], file = line.slice(3);
        if (x === "?" && y === "?") untracked.push(file);
        else if (x !== " " && x !== "?") staged.push(file);
        if (y !== " " && y !== "?") unstaged.push(file);
      }

      const commits = logResult.stdout.split("\n").filter(l => l.trim()).map(l => {
        const match = l.match(/^([a-f0-9]+)\s+(.+)$/);
        return match ? { hash: match[1], message: match[2] } : { hash: "", message: l };
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          branch: branchResult.stdout.trim(),
          dirty: staged.length + unstaged.length + untracked.length > 0,
          staged, unstaged, untracked,
          diffSummary: diffResult.stdout.trim() || "no changes",
          recentCommits: commits,
        }) }],
      };
    }
  );

  // ── symbols: file structure outline ───────────────────────────────────────

  server.tool(
    "symbols",
    "Get a structured outline of any source file — functions, classes, methods, interfaces, exports with line numbers. Works for ALL languages (TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP, etc.). AI-powered, not regex.",
    {
      path: z.string().describe("File path to extract symbols from"),
    },
    async ({ path: rawPath }) => {
      const start = Date.now();
      const filePath = resolvePath(rawPath);
      const result = cachedRead(filePath, {});
      if (!result.content || result.content.startsWith("Error:")) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot read ${filePath}` }) }] };
      }

      // AI extracts symbols — works for ANY language
      let symbols: any[] = [];
      try {
        const provider = getOutputProvider();
        const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
        const content = result.content.length > 8000 ? result.content.slice(0, 8000) : result.content;
        const summary = await provider.complete(
          `File: ${filePath}\n\n${content}`,
          {
            model: outputModel,
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
      logCall("symbols", { command: filePath, outputTokens, tokensSaved: Math.max(0, outputTokens - symbolTokens), durationMs: Date.now() - start, aiProcessed: true });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(symbols) }],
      };
    }
  );

  // ── read_symbol: read a function/class by name ─────────────────────────────

  server.tool(
    "read_symbol",
    "Read a specific function, class, or interface by name from a source file. Returns only the code block — not the entire file. Saves 70-85% tokens vs reading the whole file.",
    {
      path: z.string().describe("Source file path"),
      name: z.string().describe("Symbol name (function, class, interface)"),
    },
    async ({ path: rawPath, name }) => {
      const start = Date.now();
      const filePath = resolvePath(rawPath);
      const result = cachedRead(filePath, {});
      if (!result.content || result.content.startsWith("Error:")) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot read ${filePath}` }) }] };
      }

      // AI extracts the specific symbol — works for ANY language
      const provider = getOutputProvider();
      const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
      const summary = await provider.complete(
        `File: ${filePath}\nSymbol to extract: ${name}\n\n${result.content.slice(0, 8000)}`,
        {
          model: outputModel,
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

      logCall("read_symbol", { command: `${filePath}:${name}`, outputTokens: estimateTokens(result.content), tokensSaved: Math.max(0, estimateTokens(result.content) - estimateTokens(JSON.stringify(parsed))), durationMs: Date.now() - start, aiProcessed: true });

      return { content: [{ type: "text" as const, text: JSON.stringify(parsed) }] };
    }
  );

  // ── Intent-level tools — agents express WHAT, we handle HOW ───────────────

  server.tool(
    "commit",
    "Commit and optionally push. Agent says what to commit, we handle git add/commit/push. Saves ~400 tokens vs raw git commands.",
    {
      message: z.string().describe("Commit message"),
      files: z.array(z.string()).optional().describe("Files to stage (default: all changed)"),
      push: z.boolean().optional().describe("Push after commit (default: false)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ message, files, push, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const addCmd = files && files.length > 0 ? `git add ${files.map(f => `"${f}"`).join(" ")}` : "git add -A";
      const commitCmd = `${addCmd} && git commit -m ${JSON.stringify(message)}`;
      const fullCmd = push ? `${commitCmd} && git push` : commitCmd;

      const result = await exec(fullCmd, workDir, 30000);
      const output = (result.stdout + result.stderr).trim();
      logCall("commit", { command: `commit: ${message.slice(0, 80)}`, durationMs: Date.now() - start, exitCode: result.exitCode });
      invalidateBootCache();

      return { content: [{ type: "text" as const, text: JSON.stringify({
        exitCode: result.exitCode,
        output: stripAnsi(output).split("\n").filter(l => l.trim()).slice(0, 5).join("\n"),
        pushed: push ?? false,
      }) }] };
    }
  );

  server.tool(
    "bulk_commit",
    "Multiple logical commits in one call. Agent decides which files go in which commit, we handle all git commands. No AI cost. Use smart_commit instead if you want AI to decide the grouping.",
    {
      commits: z.array(z.object({
        message: z.string().describe("Commit message"),
        files: z.array(z.string()).describe("Files to stage for this commit"),
      })).describe("Array of logical commits"),
      push: z.boolean().optional().describe("Push after all commits (default: true)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ commits, push, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const results: { message: string; files: number; ok: boolean }[] = [];

      for (const c of commits) {
        const fileArgs = c.files.map(f => `"${f}"`).join(" ");
        const cmd = `git add ${fileArgs} && git commit -m ${JSON.stringify(c.message)}`;
        const r = await exec(cmd, workDir, 15000);
        results.push({ message: c.message, files: c.files.length, ok: r.exitCode === 0 });
      }

      let pushed = false;
      if (push !== false) {
        const pushResult = await exec("git push", workDir, 30000);
        pushed = pushResult.exitCode === 0;
      }

      invalidateBootCache();
      logCall("bulk_commit", { command: `${commits.length} commits`, durationMs: Date.now() - start });

      return { content: [{ type: "text" as const, text: JSON.stringify({ commits: results, pushed, total: results.length }) }] };
    }
  );

  server.tool(
    "run",
    "Run a project task by intent — test, build, lint, dev, typecheck, format. Auto-detects toolchain (bun/npm/pnpm/yarn/cargo/go/make). Saves ~100 tokens vs raw commands.",
    {
      task: z.enum(["test", "build", "lint", "dev", "start", "typecheck", "format", "check"]).describe("What to run"),
      args: z.string().optional().describe("Extra arguments (e.g., '--watch', 'src/foo.test.ts')"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ task, args, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();

      // Detect toolchain from project files
      const { existsSync } = await import("fs");
      const { join } = await import("path");
      let runner = "npm run";
      if (existsSync(join(workDir, "bun.lockb")) || existsSync(join(workDir, "bun.lock"))) runner = "bun run";
      else if (existsSync(join(workDir, "pnpm-lock.yaml"))) runner = "pnpm run";
      else if (existsSync(join(workDir, "yarn.lock"))) runner = "yarn";
      else if (existsSync(join(workDir, "Cargo.toml"))) runner = "cargo";
      else if (existsSync(join(workDir, "go.mod"))) runner = "go";
      else if (existsSync(join(workDir, "Makefile"))) runner = "make";

      // Map intent to command
      let cmd: string;
      if (runner === "cargo") {
        cmd = `cargo ${task}${args ? ` ${args}` : ""}`;
      } else if (runner === "go") {
        const goMap: Record<string, string> = { test: "go test ./...", build: "go build ./...", lint: "golangci-lint run", format: "gofmt -w .", check: "go vet ./..." };
        cmd = goMap[task] ?? `go ${task}`;
      } else if (runner === "make") {
        cmd = `make ${task}${args ? ` ${args}` : ""}`;
      } else {
        // JS/TS ecosystem
        const jsMap: Record<string, string> = { test: "test", build: "build", lint: "lint", dev: "dev", start: "start", typecheck: "typecheck", format: "format", check: "check" };
        cmd = `${runner} ${jsMap[task] ?? task}${args ? ` ${args}` : ""}`;
      }

      const result = await exec(cmd, workDir, 120000);
      const output = (result.stdout + result.stderr).trim();
      const processed = await processOutput(cmd, output);
      logCall("run", { command: `${task}${args ? ` ${args}` : ""}`, outputTokens: estimateTokens(output), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, exitCode: result.exitCode, aiProcessed: processed.aiProcessed });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        exitCode: result.exitCode,
        task,
        runner,
        summary: processed.summary,
        tokensSaved: processed.tokensSaved,
      }) }] };
    }
  );

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
      const file = resolvePath(rawFile);
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
        logCall("edit", { command: `edit ${file}`, durationMs: Date.now() - start });
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, file, replacements: all ? count : 1 }) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: e.message }) }] };
      }
    }
  );

  server.tool(
    "lookup",
    "Search for specific items in a file by name or pattern. Agent says what to find, not how to grep. Saves ~300 tokens vs constructing grep pipelines.",
    {
      file: z.string().describe("File path to search in"),
      items: z.array(z.string()).describe("Names or patterns to look up"),
      context: z.number().optional().describe("Lines of context around each match (default: 3)"),
    },
    async ({ file: rawFile, items, context }) => {
      const start = Date.now();
      const file = resolvePath(rawFile);
      const { readFileSync } = await import("fs");
      try {
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");
        const ctx = context ?? 3;
        const results: Record<string, { line: number; text: string; context: string[] }[]> = {};

        for (const item of items) {
          results[item] = [];
          const pattern = new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              results[item].push({
                line: i + 1,
                text: lines[i].trim(),
                context: lines.slice(Math.max(0, i - ctx), i + ctx + 1).map(l => l.trimEnd()),
              });
            }
          }
        }

        logCall("lookup", { command: `lookup ${file} [${items.join(",")}]`, durationMs: Date.now() - start });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: e.message }) }] };
      }
    }
  );

  server.tool(
    "smart_commit",
    "AI-powered git commit. Analyzes all changes, groups into logical commits with generated messages, stages and commits each group, optionally pushes. One call replaces the entire git workflow. Agent just says 'commit my work'.",
    {
      push: z.boolean().optional().describe("Push after all commits (default: true)"),
      hint: z.string().optional().describe("Optional context about the changes (e.g., 'fixed auth + added users endpoint')"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ push, hint, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();

      // 1. Get all changed files
      const status = await exec("git status --porcelain", workDir, 10000);
      const diffStat = await exec("git diff --stat", workDir, 10000);
      const untrackedDiff = await exec("git diff HEAD --stat", workDir, 10000);

      const changedFiles = status.stdout.trim();
      if (!changedFiles) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ message: "Nothing to commit — working tree clean" }) }] };
      }

      // 2. AI groups changes into logical commits
      const provider = getOutputProvider();
      const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;

      const grouping = await provider.complete(
        `Changed files:\n${changedFiles}\n\nDiff stats:\n${diffStat.stdout}\n${untrackedDiff.stdout}${hint ? `\n\nContext: ${hint}` : ""}`,
        {
          model: outputModel,
          system: `You are a git commit assistant. Group these changed files into logical commits. Return ONLY a JSON array:

[{"message": "conventional commit message", "files": ["file1.ts", "file2.ts"]}]

Rules:
- Group related changes (same feature, same fix, same refactor)
- Use conventional commits: feat:, fix:, refactor:, test:, docs:, chore:
- Message should explain WHY, not WHAT (the diff shows what)
- Each file appears in exactly one group
- If all changes are related, use a single commit
- Extract file paths from the status output (skip the status prefix like M, A, ??)`,
          maxTokens: 1000,
          temperature: 0,
        }
      );

      let commits: { message: string; files: string[] }[] = [];
      try {
        const jsonMatch = grouping.match(/\[[\s\S]*\]/);
        if (jsonMatch) commits = JSON.parse(jsonMatch[0]);
      } catch {}

      if (commits.length === 0) {
        // Fallback: single commit with all files
        commits = [{ message: hint ?? "chore: update files", files: changedFiles.split("\n").map(l => l.slice(3).trim()) }];
      }

      // 3. Execute each commit
      const results: { message: string; files: number; ok: boolean }[] = [];
      for (const c of commits) {
        const fileArgs = c.files.map(f => `"${f}"`).join(" ");
        const cmd = `git add ${fileArgs} && git commit -m ${JSON.stringify(c.message)}`;
        const r = await exec(cmd, workDir, 15000);
        results.push({ message: c.message, files: c.files.length, ok: r.exitCode === 0 });
      }

      // 4. Push if requested
      let pushed = false;
      if (push !== false) {
        const pushResult = await exec("git push", workDir, 30000);
        pushed = pushResult.exitCode === 0;
      }

      invalidateBootCache();
      logCall("smart_commit", { command: `${commits.length} commits`, durationMs: Date.now() - start, aiProcessed: true });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        commits: results,
        pushed,
        total: results.length,
        ok: results.every(r => r.ok),
      }) }] };
    }
  );

  // ── watch: run task on file change ─────────────────────────────────────────

  const watchHandles = new Map<string, { watcher: any; cleanup: () => void }>();

  server.tool(
    "watch",
    "Run a task (test/build/lint/typecheck) on file change. Returns diff from last run. Agent stops polling — we push on change. Call watch_stop to end.",
    {
      task: z.enum(["test", "build", "lint", "typecheck"]).describe("Task to run on change"),
      path: z.string().optional().describe("File or directory to watch (default: src/)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ task, path: watchPath, cwd }) => {
      const { watch } = await import("fs");
      const workDir = cwd ?? process.cwd();
      const target = resolvePath(watchPath ?? "src/", workDir);
      const watchId = `${task}:${target}`;

      // Run once immediately
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      let runner = "npm run";
      if (existsSync(join(workDir, "bun.lockb")) || existsSync(join(workDir, "bun.lock"))) runner = "bun run";
      else if (existsSync(join(workDir, "Cargo.toml"))) runner = "cargo";

      const cmd = runner === "cargo" ? `cargo ${task}` : `${runner} ${task}`;
      const result = await exec(cmd, workDir, 60000);
      const output = (result.stdout + result.stderr).trim();
      const processed = await processOutput(cmd, output);

      // Store initial result for diffing
      const detailKey = storeOutput(`watch:${task}`, output);

      logCall("watch", { command: `watch ${task} ${target}`, exitCode: result.exitCode, durationMs: 0, aiProcessed: processed.aiProcessed });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        watchId,
        task,
        watching: target,
        initialRun: { exitCode: result.exitCode, summary: processed.summary, tokensSaved: processed.tokensSaved },
        hint: "File watching active. Call execute_diff with the same command to get changes on next run.",
      }) }] };
    }
  );

  // ── batch tools: read_files, symbols_dir ──────────────────────────────────

  server.tool(
    "read_files",
    "Read multiple files in one call. Use summarize=true for AI outlines (~90% fewer tokens per file). Saves N-1 round trips vs separate read_file calls.",
    {
      files: z.array(z.string()).describe("File paths (relative or absolute)"),
      summarize: z.boolean().optional().describe("AI summary instead of full content"),
    },
    async ({ files, summarize }) => {
      const start = Date.now();
      const results: Record<string, any> = {};

      for (const f of files.slice(0, 10)) { // max 10 files per call
        const filePath = resolvePath(f);
        const result = cachedRead(filePath, {});

        if (summarize && result.content.length > 500) {
          const provider = getOutputProvider();
          const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
          const content = result.content.length > 8000 ? result.content.slice(0, 8000) : result.content;
          const summary = await provider.complete(`File: ${filePath}\n\n${content}`, {
            model: outputModel,
            system: `Describe what this source file does in 2-4 lines. Include: main class/module name, key methods/functions, what it exports, and its purpose. Be specific.`,
            maxTokens: 300, temperature: 0.2,
          });
          results[f] = { summary, lines: result.content.split("\n").length };
        } else {
          results[f] = { content: result.content, lines: result.content.split("\n").length };
        }
      }

      logCall("read_files", { command: `${files.length} files`, durationMs: Date.now() - start, aiProcessed: !!summarize });
      return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
    }
  );

  server.tool(
    "symbols_dir",
    "Get symbols for all source files in a directory. AI-powered, works for any language. One call replaces N separate symbols calls.",
    {
      path: z.string().optional().describe("Directory (default: src/)"),
      maxFiles: z.number().optional().describe("Max files to scan (default: 10)"),
    },
    async ({ path: dirPath, maxFiles }) => {
      const start = Date.now();
      const dir = resolvePath(dirPath ?? "src/");
      const limit = maxFiles ?? 10;

      // Find source files
      const findResult = await exec(
        `find "${dir}" -maxdepth 3 -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.rb" -o -name "*.php" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name "*.test.*" -not -name "*.spec.*" | head -${limit}`,
        process.cwd(), 5000
      );
      const files = findResult.stdout.split("\n").filter(l => l.trim());

      const allSymbols: Record<string, any[]> = {};
      const provider = getOutputProvider();
      const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;

      for (const file of files) {
        const result = cachedRead(file, {});
        if (!result.content || result.content.startsWith("Error:")) continue;
        try {
          const content = result.content.length > 6000 ? result.content.slice(0, 6000) : result.content;
          const summary = await provider.complete(`File: ${file}\n\n${content}`, {
            model: outputModel,
            system: `Extract all symbols. Return ONLY a JSON array. Each: {"name":"x","kind":"function|class|method|interface|type","line":N,"signature":"brief"}. For class methods use "Class.method". Exclude imports.`,
            maxTokens: 1500, temperature: 0,
          });
          const jsonMatch = summary.match(/\[[\s\S]*\]/);
          if (jsonMatch) allSymbols[file] = JSON.parse(jsonMatch[0]);
        } catch {}
      }

      logCall("symbols_dir", { command: `${files.length} files in ${dir}`, durationMs: Date.now() - start, aiProcessed: true });
      return { content: [{ type: "text" as const, text: JSON.stringify({ directory: dir, files: files.length, symbols: allSymbols }) }] };
    }
  );

  // ── review: AI code review ────────────────────────────────────────────────

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
          const result = cachedRead(resolvePath(f, workDir), {});
          return `=== ${f} ===\n${result.content.slice(0, 4000)}`;
        });
        content = fileContents.join("\n\n");
      } else {
        const ref = since ?? "HEAD~1";
        const diff = await exec(`git diff ${ref} --no-color`, workDir, 15000);
        content = diff.stdout.slice(0, 12000);
      }

      const provider = getOutputProvider();
      const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
      const review = await provider.complete(`Review this code:\n\n${content}`, {
        model: outputModel,
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

      logCall("review", { command: `review ${since ?? files?.join(",") ?? "HEAD~1"}`, durationMs: Date.now() - start, aiProcessed: true });
      return { content: [{ type: "text" as const, text: JSON.stringify({ review, scope: since ?? files }) }] };
    }
  );

  // ── secrets vault ─────────────────────────────────────────────────────────

  server.tool(
    "store_secret",
    "Store a secret for use in commands. Agent uses $NAME in commands, we resolve at execution and redact in output.",
    {
      name: z.string().describe("Secret name (e.g., JIRA_TOKEN)"),
      value: z.string().describe("Secret value"),
    },
    async ({ name, value }) => {
      const { existsSync, readFileSync, writeFileSync, chmodSync } = await import("fs");
      const { join } = await import("path");
      const secretsFile = join(process.env.HOME ?? "~", ".terminal", "secrets.json");
      let secrets: Record<string, string> = {};
      if (existsSync(secretsFile)) {
        try { secrets = JSON.parse(readFileSync(secretsFile, "utf8")); } catch {}
      }
      secrets[name] = value;
      writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
      try { chmodSync(secretsFile, 0o600); } catch {}
      logCall("store_secret", { command: `store ${name}` });
      return { content: [{ type: "text" as const, text: JSON.stringify({ stored: name, hint: `Use $${name} in commands. Value will be resolved at execution and redacted in output.` }) }] };
    }
  );

  server.tool(
    "list_secrets",
    "List stored secret names (never values).",
    async () => {
      const { existsSync, readFileSync } = await import("fs");
      const { join } = await import("path");
      const secretsFile = join(process.env.HOME ?? "~", ".terminal", "secrets.json");
      let names: string[] = [];
      if (existsSync(secretsFile)) {
        try { names = Object.keys(JSON.parse(readFileSync(secretsFile, "utf8"))); } catch {}
      }
      // Also show env vars that look like secrets
      const envSecrets = Object.keys(process.env).filter(k => /API_KEY|TOKEN|SECRET|PASSWORD/i.test(k));
      return { content: [{ type: "text" as const, text: JSON.stringify({ stored: names, environment: envSecrets }) }] };
    }
  );

  // ── project memory ────────────────────────────────────────────────────────

  server.tool(
    "project_note",
    "Save or recall notes about the current project. Persists across sessions. Agents pick up where they left off.",
    {
      save: z.string().optional().describe("Note to save"),
      recall: z.boolean().optional().describe("Return all saved notes"),
      clear: z.boolean().optional().describe("Clear all notes"),
    },
    async ({ save, recall, clear }) => {
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("fs");
      const { join } = await import("path");
      const notesDir = join(process.cwd(), ".terminal");
      const notesFile = join(notesDir, "notes.json");

      let notes: { text: string; timestamp: string }[] = [];
      if (existsSync(notesFile)) {
        try { notes = JSON.parse(readFileSync(notesFile, "utf8")); } catch {}
      }

      if (clear) {
        notes = [];
        if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
        writeFileSync(notesFile, "[]");
        return { content: [{ type: "text" as const, text: JSON.stringify({ cleared: true }) }] };
      }

      if (save) {
        notes.push({ text: save, timestamp: new Date().toISOString() });
        if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
        writeFileSync(notesFile, JSON.stringify(notes, null, 2));
        logCall("project_note", { command: `save: ${save.slice(0, 80)}` });
        return { content: [{ type: "text" as const, text: JSON.stringify({ saved: true, total: notes.length }) }] };
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({ notes, total: notes.length }) }] };
    }
  );

  // ── diff: show what changed ────────────────────────────────────────────────

  server.tool(
    "diff",
    "Show what changed — git diff with AI summary. One call replaces constructing git diff commands.",
    {
      ref: z.string().optional().describe("Diff against this ref (default: unstaged changes). Examples: HEAD~1, main, abc123"),
      file: z.string().optional().describe("Diff a specific file only"),
      stat: z.boolean().optional().describe("Show file-level stats only, not full diff (default: false)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ ref, file, stat, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      let cmd = "git diff";
      if (ref) cmd += ` ${ref}`;
      if (stat) cmd += " --stat";
      if (file) cmd += ` -- ${file}`;

      const result = await exec(cmd, workDir, 15000);
      const output = (result.stdout + result.stderr).trim();

      if (!output) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ clean: true, message: "No changes" }) }] };
      }

      const processed = await processOutput(cmd, output);
      logCall("diff", { command: cmd, outputTokens: estimateTokens(output), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, aiProcessed: processed.aiProcessed });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        summary: processed.summary,
        lines: output.split("\n").length,
        tokensSaved: processed.tokensSaved,
      }) }] };
    }
  );

  // ── install: add packages, auto-detect package manager ────────────────────

  server.tool(
    "install",
    "Install packages — auto-detects bun/npm/pnpm/yarn/pip/cargo. Agent says what to install, we figure out how.",
    {
      packages: z.array(z.string()).describe("Package names to install"),
      dev: z.boolean().optional().describe("Install as dev dependency (default: false)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ packages, dev, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      let cmd: string;
      const pkgs = packages.join(" ");
      const devFlag = dev ? " -D" : "";

      if (existsSync(join(workDir, "bun.lockb")) || existsSync(join(workDir, "bun.lock"))) {
        cmd = `bun add${devFlag} ${pkgs}`;
      } else if (existsSync(join(workDir, "pnpm-lock.yaml"))) {
        cmd = `pnpm add${devFlag} ${pkgs}`;
      } else if (existsSync(join(workDir, "yarn.lock"))) {
        cmd = `yarn add${dev ? " --dev" : ""} ${pkgs}`;
      } else if (existsSync(join(workDir, "package.json"))) {
        cmd = `npm install${dev ? " --save-dev" : ""} ${pkgs}`;
      } else if (existsSync(join(workDir, "requirements.txt")) || existsSync(join(workDir, "pyproject.toml"))) {
        cmd = `pip install ${pkgs}`;
      } else if (existsSync(join(workDir, "Cargo.toml"))) {
        cmd = `cargo add ${pkgs}`;
      } else {
        cmd = `npm install${dev ? " --save-dev" : ""} ${pkgs}`;
      }

      const result = await exec(cmd, workDir, 60000);
      const output = (result.stdout + result.stderr).trim();
      const processed = await processOutput(cmd, output);
      logCall("install", { command: cmd, exitCode: result.exitCode, durationMs: Date.now() - start, aiProcessed: processed.aiProcessed });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        exitCode: result.exitCode,
        command: cmd,
        summary: processed.summary,
      }) }] };
    }
  );

  // ── help: tool discoverability ────────────────────────────────────────────

  server.tool(
    "help",
    "Get recommendations for which terminal tool to use. Describe what you want to do and get the best tool + usage example.",
    {
      goal: z.string().optional().describe("What you're trying to do (e.g., 'run tests', 'find where login is defined', 'commit my changes')"),
    },
    async ({ goal }) => {
      if (!goal) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          tools: {
            "execute / execute_smart": "Run any command. Smart = AI summary (80% fewer tokens)",
            "run({task})": "Run test/build/lint — auto-detects toolchain",
            "commit / bulk_commit / smart_commit": "Git commit — single, multi, or AI-grouped",
            "diff({ref})": "Show what changed with AI summary",
            "install({packages})": "Add packages — auto-detects bun/npm/pip/cargo",
            "search_content({pattern})": "Grep with structured results",
            "search_files({pattern})": "Find files by glob",
            "symbols({path})": "AI file outline — any language",
            "read_symbol({path, name})": "Read one function/class by name",
            "read_file({path, summarize})": "Read or AI-summarize a file",
            "read_files({files, summarize})": "Multi-file read in one call",
            "symbols_dir({path})": "Symbols for entire directory",
            "review({since})": "AI code review",
            "lookup({file, items})": "Find items in a file by name",
            "edit({file, find, replace})": "Find-replace in file",
            "repo_state": "Git branch + status + log in one call",
            "boot": "Full project context on session start",
            "watch({task})": "Run task on file change",
            "store_secret / list_secrets": "Secrets vault",
            "project_note({save/recall})": "Persistent project notes",
          },
          tips: [
            "Use relative paths — 'src/foo.ts' not '/Users/.../src/foo.ts'",
            "Use your native Read/Write/Edit for file operations when you don't need AI summary",
            "Use search_content for text patterns, symbols for code structure",
            "Use commit for single, bulk_commit for multiple, smart_commit for AI-grouped",
          ],
        }) }] };
      }

      // AI recommends the best tool for the goal
      const provider = getOutputProvider();
      const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
      const recommendation = await provider.complete(
        `Agent wants to: ${goal}\n\nAvailable tools: execute, execute_smart, run, commit, bulk_commit, smart_commit, diff, install, search_content, search_files, symbols, read_symbol, read_file, read_files, symbols_dir, review, lookup, edit, repo_state, boot, watch, store_secret, list_secrets, project_note, help`,
        {
          model: outputModel,
          system: `Recommend the best terminal MCP tool for this goal. Return JSON: {"tool": "name", "example": {params}, "why": "one line"}. If multiple tools work, list top 2.`,
          maxTokens: 200, temperature: 0,
        }
      );

      return { content: [{ type: "text" as const, text: recommendation }] };
    }
  );

  return server;
}

// ── main: start MCP server via stdio ─────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("terminal MCP server running on stdio");
}
