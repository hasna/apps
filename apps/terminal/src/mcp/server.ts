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
    "Run a command and get AI-summarized output. The AI decides what's important — errors, failures, key results are kept; verbose logs, progress bars, passing tests are dropped. Saves 80-95% tokens vs raw output. Best tool for agents.",
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
      return { content: [{ type: "text" as const, text: JSON.stringify(ctx) }] };
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
    "Read a file with session caching. Use summarize=true to get an AI-generated outline (~90% fewer tokens) instead of full content — ideal when you just want to understand what a file does without reading every line.",
    {
      path: z.string().describe("File path"),
      offset: z.number().optional().describe("Start line (0-indexed)"),
      limit: z.number().optional().describe("Max lines to return"),
      summarize: z.boolean().optional().describe("Return AI summary instead of full content (saves ~90% tokens)"),
    },
    async ({ path, offset, limit, summarize }) => {
      const start = Date.now();
      const result = cachedRead(path, { offset, limit });

      if (summarize && result.content.length > 500) {
        const processed = await processOutput(`cat ${path}`, result.content);
        logCall("read_file", { command: path, outputTokens: estimateTokens(result.content), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, aiProcessed: true });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            summary: processed.summary,
            lines: result.content.split("\n").length,
            tokensSaved: processed.tokensSaved,
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
    async ({ path: filePath }) => {
      const start = Date.now();
      const result = cachedRead(filePath, {});
      if (!result.content || result.content.startsWith("Error:")) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot read ${filePath}` }) }] };
      }

      // AI extracts symbols — works for ANY language
      const provider = getOutputProvider();
      const outputModel = provider.name === "groq" ? "llama-3.1-8b-instant" : undefined;
      const content = result.content.length > 6000 ? result.content.slice(0, 6000) : result.content;
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
          maxTokens: 1000,
          temperature: 0,
        }
      );

      // Parse AI response
      let symbols: any[] = [];
      try {
        const jsonMatch = summary.match(/\[[\s\S]*\]/);
        if (jsonMatch) symbols = JSON.parse(jsonMatch[0]);
      } catch {}

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
    async ({ path: filePath, name }) => {
      const start = Date.now();
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

  return server;
}

// ── main: start MCP server via stdio ─────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("terminal MCP server running on stdio");
}
