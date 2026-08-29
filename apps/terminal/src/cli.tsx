#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { runEventsCli } from "@hasna/events/cli";
import {
  compactInteraction,
  compactSession,
  formatCollectionList,
  formatRecipeList,
  formatSnapshot,
  hasFlag,
  parseLimit,
  truncateText,
} from "./compact-output.js";

const args = process.argv.slice(2);

// `events`, `channels` and the legacy `webhooks` alias all delegate to the
// @hasna/events CLI. The events CLI renamed its webhook-subscription group to
// `channels` (webhooks is gone there — "Unknown command group: webhooks");
// keep `webhooks` working here as an alias for callers of the old name, and
// advertise `channels` (O15-04797).
if (args[0] === "events" || args[0] === "channels" || args[0] === "webhooks") {
  const eventArgs = args[0] === "webhooks" ? ["channels", ...args.slice(1)] : args;
  await runEventsCli(eventArgs, { source: "terminal", programName: "terminal" });
  process.exit(0);
}

// ── Help / Version ───────────────────────────────────────────────────────────

if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  console.log(`terminal — Natural language shell for AI agents and humans

USAGE:
  terminal "your request"      NL → AI picks command → runs → smart output
  terminal                     Launch interactive NL terminal (TUI)

EXAMPLES:
  terminal "list all typescript files"
  terminal "run tests"
  terminal "what changed in git"
  terminal "show me the auth functions"
  terminal "kill port 3000"
  terminal "how many lines of code"

SETUP:
  install                      Set up MCP server for all AI agents (Claude, Codex, Gemini)
  install --claude             Set up for Claude Code only
  install --codex              Set up for Codex only
  install --gemini             Set up for Gemini CLI only
  uninstall                    Remove from all agents

SUBCOMMANDS:
  repo                         Git repo state (branch + status + log)
  symbols <file>               File outline (functions, classes, exports)
  overview                     Project overview (deps, scripts, structure)
  stats                        Token economy dashboard
  sessions [stats|<id>]        Session history and analytics
  recipe add|list|show|run|delete Reusable command recipes
  collection create|list       Recipe collections
  mcp serve                    Start MCP server (called by agents, not you)
  discover [--days=N] [--json]  Scan Claude sessions, show token savings potential
  snapshot [--json|--verbose]  Compact terminal state; --json returns full data
  events                       Emit, list, and replay Hasna events
  channels                     Manage Hasna event channel (webhook) subscriptions
  --help                       Show this help
  --version                    Show version

MCP TOOLS (20+):
  execute, execute_smart, execute_diff, expand, browse,
  search_files, search_content, search_semantic, read_file,
  read_symbol, symbols, repo_state, explain_error, status,
  bg_start, bg_stop, bg_status, bg_logs, bg_wait_port,
  list_recipes, run_recipe, save_recipe, list_collections,
  snapshot, token_stats, session_history

ENVIRONMENT:
  XAI_API_KEY                  xAI API key (Grok, code-optimized — default)
  CEREBRAS_API_KEY             Cerebras API key (free, open-source)
  GROQ_API_KEY                 Groq API key (free, ultra-fast inference)
  ANTHROPIC_API_KEY            Anthropic API key (Claude models)

GRADUAL DISCLOSURE:
  List and status commands are compact by default. Use --limit=N, --verbose,
  --json, or show/inspect subcommands when you need full details.
`);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
  const { readFileSync } = await import("fs");
  const { join, dirname } = await import("path");
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), "..", "package.json"), "utf8"));
    console.log(pkg.version);
  } catch { console.log("1.0.0"); }
  process.exit(0);
}

// ── Install / Uninstall ──────────────────────────────────────────────────────

if (args[0] === "install") {
  const { handleInstall } = await import("./mcp/install.js");
  handleInstall(args.slice(1));
  process.exit(0);
}

if (args[0] === "uninstall") {
  const { handleInstall } = await import("./mcp/install.js");
  handleInstall(["uninstall"]);
  process.exit(0);
}

// ── Prune ────────────────────────────────────────────────────────────────────

if (args[0] === "prune") {
  const days = parseInt(args.find(a => a.startsWith("--older-than="))?.split("=")[1] ?? "90");
  const { pruneSessions } = await import("./sessions-db.js");
  const result = pruneSessions(days);
  console.log(`  Pruned ${result.sessionsDeleted} sessions, ${result.interactionsDeleted} interactions older than ${days}d`);
  process.exit(0);
}

// ── MCP commands ─────────────────────────────────────────────────────────────

if (args[0] === "mcp") {
  if (args[1] === "serve" || args.length === 1 || (args[1]?.startsWith("--"))) {
    const mcpArgs = args.slice(1);
    const { isStdioMode, resolveMcpHttpPort, startMcpHttpServer } = await import("./mcp/http.js");
    if (isStdioMode(mcpArgs)) {
      const { startMcpServer } = await import("./mcp/server.js");
      startMcpServer().catch((err) => {
        console.error("MCP server error:", err);
        process.exit(1);
      });
    } else {
      // Default: shared Streamable HTTP server (one process per MCP, many agents).
      const { createServer } = await import("./mcp/server.js");
      startMcpHttpServer({
        name: "terminal",
        port: resolveMcpHttpPort(mcpArgs),
        buildServer: createServer,
      });
    }
  } else if (args[1] === "install") {
    // Legacy: `terminal mcp install` still works
    const { handleInstall } = await import("./mcp/install.js");
    handleInstall(args.slice(2));
  } else {
    console.log("Usage: terminal mcp serve");
  }
}

// ── Hook commands ────────────────────────────────────────────────────────────

else if (args[0] === "hook") {
  const { existsSync, mkdirSync, writeFileSync, readFileSync } = await import("fs");
  const { join, dirname } = await import("path");
  const { execSync } = await import("child_process");

  const sub = args[1];
  const target = args[2]; // --claude, --codex

  if (sub === "install" && (target === "--claude" || target === "claude")) {
    // Find the hook script
    const hookSrc = join(dirname(new URL(import.meta.url).pathname), "hooks", "claude-hook.sh");
    const hookDest = join(process.env.HOME ?? "~", ".claude", "hooks", "PostToolUse-open-terminal.sh");

    // Copy hook script
    const destDir = dirname(hookDest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    // Generate hook with stable paths (resolve npm global root, not fnm temp shell)
    const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    const distPath = join(npmRoot, "@hasna/terminal/dist");
    const hookScript = `#!/usr/bin/env bash
# terminal PostToolUse hook — compresses Bash output
# Installed by: t hook install --claude
# Docs: https://github.com/hasna/terminal

if [ "$TOOL_NAME" != "Bash" ]; then exit 0; fi
OUTPUT=$(cat)
if [ \${#OUTPUT} -lt 500 ]; then echo "$OUTPUT"; exit 0; fi

LINE_COUNT=$(echo "$OUTPUT" | wc -l | tr -d ' ')
if [ "$LINE_COUNT" -gt 15 ]; then
  # Find the dist path (stable, not fnm temp shell)
  DIST="${distPath}"
  if [ ! -d "$DIST" ]; then
    DIST="$(npm root -g 2>/dev/null)/@hasna/terminal/dist"
  fi
  COMPRESSED=$(echo "$OUTPUT" | bun -e "
    import{compress,stripAnsi}from'$DIST/compression.js';
    import{stripNoise}from'$DIST/noise-filter.js';
    let i='';process.stdin.on('data',d=>i+=d);process.stdin.on('end',()=>{
      const c=stripNoise(stripAnsi(i)).cleaned;
      const r=compress('bash',c,{maxTokens:500});
      console.log(r.tokensSaved>50?r.content:c);
    });
  " 2>/dev/null)
  if [ $? -eq 0 ] && [ -n "$COMPRESSED" ]; then echo "$COMPRESSED"; exit 0; fi
fi
echo "$OUTPUT"
`;

    writeFileSync(hookDest, hookScript, { mode: 0o755 });

    // Register in Claude settings
    const settingsPath = join(process.env.HOME ?? "~", ".claude", "settings.json");
    let settings: any = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch {}
    }
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

    const hookEntry = { command: hookDest, event: "PostToolUse", tools: ["Bash"] };
    const exists = settings.hooks.PostToolUse.some((h: any) => h.command?.includes("open-terminal"));
    if (!exists) {
      settings.hooks.PostToolUse.push(hookEntry);
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    console.log("✓ Installed open-terminal PostToolUse hook for Claude Code");
    console.log("  Hook: " + hookDest);
    console.log("  Bash output >15 lines will be auto-compressed");
  } else if (sub === "uninstall") {
    const settingsPath = join(process.env.HOME ?? "~", ".claude", "settings.json");
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
        if (settings.hooks?.PostToolUse) {
          settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter((h: any) => !h.command?.includes("open-terminal"));
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        }
      } catch {}
    }
    console.log("✓ Uninstalled open-terminal hook");
  } else {
    console.log("Usage: t hook install --claude");
    console.log("       t hook uninstall");
  }
}

// ── Recipe commands ──────────────────────────────────────────────────────────

else if (args[0] === "recipe") {
  const { listRecipes, getRecipe, createRecipe, deleteRecipe, listCollections, createCollection } = await import("./recipes/storage.js");
  const { substituteVariables } = await import("./recipes/model.js");
  const sub = args[1];

  if (sub === "list") {
    const collection = args.find(a => a.startsWith("--collection="))?.split("=")[1];
    const limit = parseLimit(args, 20);
    const verbose = hasFlag(args, "--verbose");
    const json = hasFlag(args, "--json");
    let recipes = listRecipes(process.cwd());
    if (collection) recipes = recipes.filter(r => r.collection === collection);
    if (recipes.length === 0) { console.log("No recipes found."); }
    else if (json) {
      console.log(JSON.stringify(recipes, null, 2));
    }
    else {
      console.log(formatRecipeList(recipes.slice(0, limit), recipes.length, verbose));
    }
  } else if ((sub === "show" || sub === "inspect") && args[2]) {
    const recipe = getRecipe(args[2], process.cwd());
    if (!recipe) { console.error(`Recipe '${args[2]}' not found.`); process.exit(1); }
    if (hasFlag(args, "--json")) {
      console.log(JSON.stringify(recipe, null, 2));
    } else {
      console.log(`Recipe: ${recipe.name}`);
      console.log(`  Collection: ${recipe.collection ?? "none"}`);
      console.log(`  Scope: ${recipe.project ? "project" : recipe.id.startsWith("sys-") ? "system" : "global"}`);
      if (recipe.description) console.log(`  Description: ${recipe.description}`);
      if (recipe.variables.length > 0) console.log(`  Variables: ${recipe.variables.map(v => v.name).join(", ")}`);
      console.log(`\n  ${recipe.command}`);
    }
  } else if (sub === "add" && args[2] && args[3]) {
    const name = args[2];
    const command = args[3];
    const collection = args.find(a => a.startsWith("--collection="))?.split("=")[1];
    const project = args.includes("--project") ? process.cwd() : undefined;
    const recipe = createRecipe({ name, command, collection, project });
    console.log(`✓ Saved recipe '${recipe.name}' → ${recipe.command}`);
  } else if (sub === "run" && args[2]) {
    const recipe = getRecipe(args[2], process.cwd());
    if (!recipe) { console.error(`Recipe '${args[2]}' not found.`); process.exit(1); }
    // Parse --var=value arguments
    const vars: Record<string, string> = {};
    for (const arg of args.slice(3)) {
      const match = arg.match(/^--(\w+)=(.+)$/);
      if (match) vars[match[1]] = match[2];
    }
    const cmd = substituteVariables(recipe.command, vars);
    console.log(`$ ${cmd}`);
    const { execSync } = await import("child_process");
    try { execSync(cmd, { stdio: "inherit", cwd: process.cwd() }); }
    catch (e: any) { process.exit(e.status ?? 1); }
  } else if (sub === "delete" && args[2]) {
    const ok = deleteRecipe(args[2], process.cwd());
    console.log(ok ? `✓ Deleted recipe '${args[2]}'` : `Recipe '${args[2]}' not found.`);
  } else {
    console.log("Usage: t recipe [add|list|run|delete]");
    console.log("  t recipe add <name> <command> [--collection=X] [--project]");
    console.log("  t recipe list [--collection=X] [--limit=N] [--verbose] [--json]");
    console.log("  t recipe show <name> [--json]");
    console.log("  t recipe run <name> [--var=value]");
    console.log("  t recipe delete <name>");
  }
}

// ── Collection commands ──────────────────────────────────────────────────────

else if (args[0] === "collection") {
  const { listCollections, createCollection } = await import("./recipes/storage.js");
  const sub = args[1];

  if (sub === "create" && args[2]) {
    const col = createCollection({ name: args[2], description: args[3], project: args.includes("--project") ? process.cwd() : undefined });
    console.log(`✓ Created collection '${col.name}'`);
  } else if (sub === "list") {
    const cols = listCollections(process.cwd());
    if (cols.length === 0) console.log("No collections.");
    else if (hasFlag(args, "--json")) console.log(JSON.stringify(cols, null, 2));
    else console.log(formatCollectionList(cols.slice(0, parseLimit(args, 20)), cols.length));
  } else {
    console.log("Usage: t collection [create|list] [--limit=N] [--json]");
  }
}

// ── Stats command ────────────────────────────────────────────────────────────

else if (args[0] === "stats") {
  const { formatEconomicsSummary } = await import("./economy.js");
  console.log(formatEconomicsSummary());
}

// ── Sessions command ─────────────────────────────────────────────────────────

else if (args[0] === "sessions") {
  const { listSessions, getSession, getSessionInteractions, getSessionStats } = await import("./sessions-db.js");
  const json = hasFlag(args, "--json");
  const verbose = hasFlag(args, "--verbose");
  const limit = parseLimit(args, 10);

  if (args[1] === "stats") {
    const stats = getSessionStats();
    if (json) {
      console.log(JSON.stringify(stats, null, 2));
      process.exit(0);
    }
    console.log("Session Stats:");
    console.log(`  Total sessions:     ${stats.totalSessions}`);
    console.log(`  Total interactions:  ${stats.totalInteractions}`);
    console.log(`  Tokens saved:        ${stats.totalTokensSaved}`);
    console.log(`  Tokens used:         ${stats.totalTokensUsed}`);
    console.log(`  Cache hit rate:      ${(stats.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`  Avg per session:     ${stats.avgInteractionsPerSession.toFixed(1)}`);
    console.log(`  Error rate:          ${(stats.errorRate * 100).toFixed(1)}%`);
  } else if (args[1] && args[1] !== "list" && !args[1].startsWith("--")) {
    // Show specific session
    const sessionId = (args[1] === "show" || args[1] === "inspect") ? args[2] : args[1];
    const session = sessionId ? getSession(sessionId) : null;
    if (!session) { console.error(`Session '${sessionId ?? ""}' not found.`); process.exit(1); }
    const interactions = getSessionInteractions(session.id);
    if (json) {
      console.log(JSON.stringify({ session, interactions }, null, 2));
      process.exit(0);
    }
    console.log(`Session: ${session.id}`);
    console.log(`  Started: ${new Date(session.started_at).toLocaleString()}`);
    console.log(`  CWD:     ${session.cwd}`);
    console.log(`  Provider: ${session.provider ?? "auto"}`);
    console.log("");
    for (const i of interactions.slice(0, verbose ? interactions.length : limit)) {
      const item = compactInteraction(i, verbose);
      const status = item.status === "ok" ? "✓" : item.status === "error" ? "✗" : "·";
      console.log(`  ${status} ${item.prompt}`);
      if (item.command) console.log(`    $ ${item.command}`);
    }
    console.log(`\n  ${interactions.length} interactions`);
    if (!verbose && interactions.length > limit) console.log(`  Showing ${limit}. Use --verbose or --limit=N for more.`);
  } else {
    // List recent sessions
    const sessions = listSessions(limit);
    if (sessions.length === 0) { console.log("No sessions yet.\nUse sessions show <id> for details, --limit=N for more, or --json for machine-readable output."); }
    else if (json) {
      console.log(JSON.stringify(sessions, null, 2));
    }
    else {
      for (const s of sessions) {
        const item = compactSession(s);
        const date = new Date(s.started_at).toLocaleString();
        console.log(`  ${String(item.id).slice(0, 8)}  ${date}  ${item.cwd}  ${item.provider}`);
      }
      console.log("\nUse sessions show <id> for details, --limit=N for more, or --json for machine-readable output.");
    }
  }
}

// ── Overview command ─────────────────────────────────────────────────────────

else if (args[0] === "overview") {
  const { readFileSync } = await import("fs");
  const { execSync } = await import("child_process");
  const { formatProjectOverview } = await import("./terminal-summaries.js");
  const run = (cmd: string) => { try { return execSync(cmd, { encoding: "utf8", cwd: process.cwd() }).trim(); } catch { return ""; } };

  let pkg: any = null;
  try { pkg = JSON.parse(readFileSync("package.json", "utf8")); } catch {}

  const src = run("ls -1 src/ 2>/dev/null || ls -1 lib/ 2>/dev/null");
  console.log(formatProjectOverview(pkg, src ? src.split("\n").filter(Boolean) : []));
}

// ── Repo command ─────────────────────────────────────────────────────────────

else if (args[0] === "repo") {
  const { execSync } = await import("child_process");
  const { summarizeGitShortStatus } = await import("./terminal-summaries.js");
  const run = (cmd: string) => { try { return execSync(cmd, { encoding: "utf8", cwd: process.cwd() }).trim(); } catch { return ""; } };
  const status = run("git status --short --branch");
  const summary = summarizeGitShortStatus(status);
  console.log(summary ?? status);
  if (args.includes("--recent")) {
    const log = run("git log --oneline -5 --decorate");
    if (log) console.log(`\nRecent:\n${log}`);
  }
}

// ── Symbols command ──────────────────────────────────────────────────────────

else if (args[0] === "symbols" && args[1]) {
  const { extractSymbolsFromFile } = await import("./search/semantic.js");
  const { resolve } = await import("path");
  const { statSync, readdirSync } = await import("fs");
  const target = resolve(args[1]);
  const filter = args[2]?.startsWith("--") ? undefined : args[2]; // optional: grep-like filter on symbol name
  const limit = parseLimit(args, 50);
  const verbose = hasFlag(args, "--verbose");

  // Support directories — recurse and extract symbols from all source files
  const files: string[] = [];
  try {
    if (statSync(target).isDirectory()) {
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
          const full = resolve(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(ts|tsx|py|go|rs)$/.test(entry.name) && !/\.(test|spec)\.\w+$/.test(entry.name)) files.push(full);
        }
      };
      walk(target);
    } else {
      files.push(target);
    }
  } catch { files.push(target); }

  let shownSymbols = 0;
  let matchedSymbols = 0;
  let filesWithMatches = 0;
  let scannedFiles = 0;
  let truncated = false;
  for (const file of files) {
    if (!verbose && shownSymbols >= limit) {
      truncated = true;
      break;
    }
    scannedFiles++;
    const symbols = extractSymbolsFromFile(file);
    const filteredAll = filter ? symbols.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || s.kind.toLowerCase().includes(filter.toLowerCase())) : symbols;
    if (filteredAll.length === 0) continue;
    matchedSymbols += filteredAll.length;
    filesWithMatches++;
    const remaining = verbose ? filteredAll.length : Math.max(0, limit - shownSymbols);
    const filtered = verbose ? filteredAll : filteredAll.slice(0, remaining);
    if (filtered.length === 0) continue;
    const relPath = file.replace(process.cwd() + "/", "");
    if (files.length > 1) console.log(`\n${relPath}:`);
    for (const s of filtered) {
      const exp = s.exported ? "⬡" : "·";
      console.log(`  ${exp} ${s.kind.padEnd(10)} L${String(s.line).padStart(4)}  ${s.name}`);
    }
    shownSymbols += filtered.length;
    if (!verbose && filteredAll.length > filtered.length) {
      truncated = true;
      console.log("  ... more; use --verbose, --limit=N, or a narrower filter");
    }
  }
  if (shownSymbols === 0) console.log("No symbols found.");
  else if (files.length > 1) {
    console.log(`\n${shownSymbols} symbols shown from ${filesWithMatches} matching files (${scannedFiles}/${files.length} files scanned).`);
    if (truncated) console.log(`Showing at most ${limit} symbols. Use --limit=N, --verbose, or a filter for more detail.`);
    else if (matchedSymbols > shownSymbols) console.log(`Use --verbose to show all ${matchedSymbols} matched symbols.`);
  }
}

// ── History command ──────────────────────────────────────────────────────────

else if (args[0] === "history") {
  const { loadContext } = await import("./session-context.js");
  const entries = loadContext();
  const limit = parseLimit(args, 5);
  const verbose = hasFlag(args, "--verbose");
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(entries, null, 2));
    process.exit(0);
  }
  if (entries.length === 0) { console.log("No recent history."); }
  else {
    for (const e of entries.slice(-limit)) {
      const time = new Date(e.timestamp).toLocaleTimeString();
      console.log(`  ${time}  ${verbose ? e.prompt : truncateText(e.prompt, 100)}`);
      console.log(`    $ ${verbose ? e.command : truncateText(e.command, 120)}`);
    }
    if (entries.length > limit) console.log(`\nShowing ${limit} of ${entries.length}. Use --limit=N, --verbose, or --json for details.`);
  }
}

// ── Explain command ─────────────────────────────────────────────────────────

else if (args[0] === "explain" && args[1]) {
  const command = args.slice(1).join(" ");
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CEREBRAS_API_KEY && !process.env.GROQ_API_KEY && !process.env.XAI_API_KEY) {
    console.error("explain requires an API key"); process.exit(1);
  }
  const { explainCommand } = await import("./ai.js");
  const explanation = await explainCommand(command);
  console.log(explanation);
}

// ── Discover command ─────────────────────────────────────────────────────────

else if (args[0] === "discover") {
  const { discover, formatDiscoverReport } = await import("./discover.js");
  const days = parseInt(args.find(a => a.startsWith("--days="))?.split("=")[1] ?? "30");
  const json = args.includes("--json");
  const report = discover({ maxAgeDays: days });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDiscoverReport(report));
  }
}

// ── Snapshot command ─────────────────────────────────────────────────────────

else if (args[0] === "snapshot") {
  const { captureSnapshot } = await import("./snapshots.js");
  const snapshot = captureSnapshot();
  if (hasFlag(args, "--json")) console.log(JSON.stringify(snapshot, null, 2));
  else console.log(formatSnapshot(snapshot, hasFlag(args, "--verbose")));
}

// ── Project init ─────────────────────────────────────────────────────────────

else if (args[0] === "project" && args[1] === "init") {
  const { initProject } = await import("./recipes/storage.js");
  initProject(process.cwd());
  console.log("✓ Initialized .terminal/recipes.json");
}

// ── NL mode: terminal "natural language prompt" ─────────────────────────────

else if (args.length > 0) {
  // Everything that doesn't match a subcommand is treated as natural language
  const prompt = args.join(" ");

  const offlineMode = !process.env.ANTHROPIC_API_KEY && !process.env.CEREBRAS_API_KEY && !process.env.GROQ_API_KEY && !process.env.XAI_API_KEY;

  const { translateToCommand, checkPermissions, isIrreversible } = await import("./ai.js");
  const { execSync } = await import("child_process");
  const { compress, stripAnsi } = await import("./compression.js");
  const { stripNoise } = await import("./noise-filter.js");
  const { processOutput, shouldProcess } = await import("./output-processor.js");
  const { rewriteCommand } = await import("./command-rewriter.js");
  const { shouldBeLazy, toLazy } = await import("./lazy-executor.js");
  const { saveOutput, formatOutputHint, saveOutputManifest, formatManifestHint } = await import("./output-store.js");
  const { estimateTokens } = await import("./tokens.js");
  const { recordSaving, recordUsage } = await import("./economy.js");
  const { isTestOutput, trackTests, formatWatchResult } = await import("./test-watchlist.js");
  const { detectLoop } = await import("./loop-detector.js");
  const { loadConfig } = await import("./history.js");
  const { loadContext, saveContext, formatContext } = await import("./session-context.js");
  const { getLearned, recordMapping } = await import("./usage-cache.js");
  const { recordCorrection, findSimilarCorrections, recordOutput } = await import("./sessions-db.js");
  const { getPromptShortcut } = await import("./prompt-shortcuts.js");

  const config = loadConfig();
  const perms = config.permissions;
  const sessionCtx = formatContext();

  // ── Direct command detection ──
  // If input looks like a shell command (starts with known binary), skip AI translation entirely.
  // This saves one AI call ($0.0008) per invocation for agents that already know the command.
  const KNOWN_BINARIES = /^(ls|cd|cat|head|tail|grep|rg|find|wc|du|df|git|bun|npm|pnpm|yarn|node|python3?|pip|curl|wget|ssh|scp|chmod|chown|chgrp|mkdir|rmdir|rm|cp|mv|touch|ln|tar|gzip|gunzip|zip|unzip|sed|awk|sort|uniq|cut|tr|tee|xargs|echo|printf|env|export|source|which|whereis|whatis|man|date|cal|uptime|whoami|hostname|uname|ps|top|htop|kill|killall|lsof|netstat|ss|ifconfig|ip|ping|dig|nslookup|docker|kubectl|make|cmake|cargo|go|rustc|gcc|g\+\+|clang|java|javac|mvn|gradle|npx|bunx|tsx|deno|tree|file|stat|readlink|realpath|basename|dirname|pwd|test|true|false|sleep|timeout|time|watch|diff|patch|rsync|lsblk|mount|umount|fdisk|free|vmstat|iostat|sar|strace|ltrace|gdb|lldb|sqlite3|psql|mysql|redis-cli|mongosh|jq|yq|bat|fd|exa|fzf|gh|hub|terraform|ansible|helm|k9s|lazygit|tmux|screen|nc|nmap|openssl|base64|md5|shasum|xxd|od|hexdump|strings|nm|objdump|readelf|ldd|ldconfig|pkg-config|brew|apt|yum|dnf|pacman|snap|flatpak|systemctl|service|journalctl|dmesg|crontab|at|nohup|bg|fg|jobs|disown|wait|nice|renice|ionice|chrt|taskset|ulimit|sysctl|getconf|locale|iconv|perl|ruby|php|lua|R|julia|swift|kotlin|scala|elixir|mix|rebar3|tsc|eslint|prettier|biome|ruff|black|isort|mypy|pyright|pylint|flake8|pytest|vitest|jest|mocha|ava|tap|phpunit|rspec|minitest|unittest2|nose2|coverage|nyc|c8|v8-profiler)(\s|$)/;

  const isDirectCommand = KNOWN_BINARIES.test(prompt.trim()) || /^[.\/~]/.test(prompt.trim()) || /\|/.test(prompt);

  // Check usage learning cache first (zero AI cost for repeated queries)
  const shortcut = getPromptShortcut(prompt);
  const learned = getLearned(prompt);
  if (learned && !offlineMode) {
    console.error(`[terminal] cached: $ ${learned}`);
  }

  // Step 1: Determine command — either direct passthrough or AI translation
  let command: string;

  if (shortcut) {
    command = shortcut.command;
  } else if (isDirectCommand) {
    // Direct command — skip AI translation entirely (saves 1 AI call)
    command = prompt;
  } else if (offlineMode) {
    // Offline: treat prompt as literal command
    console.error("[terminal] offline mode (no API key) — running as literal command");
    command = prompt;
  } else if (learned) {
    command = learned;
  } else {
    try {
      command = await translateToCommand(sessionCtx ? `${prompt}\n${sessionCtx}` : prompt, perms, []);
  } catch (e: any) {
    // If BLOCKED, try README fallback ONLY for conceptual questions (not file access)
    if (e.message?.startsWith("BLOCKED:")) {
      const isConceptual = /\b(explain|why|what does|how does|describe|architecture|overview|summary)\b/i.test(prompt);
      const isFileAccess = /\b(cat|show|read|find|ls|list)\b.*\b(\.\w+\/|src\/|packages\/)/i.test(prompt);
      if (isConceptual && !isFileAccess) {
        try {
          const { existsSync, readFileSync } = await import("fs");
          if (existsSync("README.md")) {
            const readme = readFileSync("README.md", "utf8").slice(0, 3000);
            const processed = await processOutput("cat README.md", readme, prompt);
            if (processed.aiProcessed) {
              console.log(processed.summary);
              process.exit(0);
            }
          }
        } catch {}
      }
    }
    // Show the block reason clearly
    if (e.message?.startsWith("BLOCKED:")) {
      console.log(`⚠ ${e.message}`);
      console.log(`  This is a READ-ONLY terminal. Run directly in your shell if you're sure.`);
    } else {
      console.error(e.message);
    }
    process.exit(1);
  }
  } // close the else (learned/offline) block

  // Record the mapping for usage learning
  if (!offlineMode && !learned && !shortcut) recordMapping(prompt, command);

  // Check permissions
  const blocked = checkPermissions(command, perms);
  if (blocked) { console.error(`blocked: ${blocked}`); process.exit(1); }

  // Safety: when command is irreversible, try a safer read-only alternative
  if (isIrreversible(command)) {
    // Try to generate a safe alternative via AI
    try {
      const safeCommand = await translateToCommand(
        `${prompt} (IMPORTANT: use ONLY read-only commands like grep, find, cat, wc, ls. Do NOT use npx, install, kill, push, sed, or any modifying command.)`,
        perms, []
      );
      if (!isIrreversible(safeCommand) && !checkPermissions(safeCommand, perms)) {
        console.error(`$ ${safeCommand} (safe alternative)`);
        command = safeCommand;
        // Continue to execution below
      } else {
        console.error(`⚠ BLOCKED: $ ${command}`);
        console.error(`  Run directly in your shell if you're sure.`);
        process.exit(1);
      }
    } catch {
      console.error(`⚠ BLOCKED: $ ${command}`);
      console.error(`  Run directly in your shell if you're sure.`);
      process.exit(1);
    }
  }

  // Step 2: Validate command before executing
  const { validateCommand } = await import("./command-validator.js");
  const validation = validateCommand(command, process.cwd());
  if (!validation.valid) {
    // Auto-retry: re-translate with simpler constraints
    console.error(`[terminal] invalid command detected: ${validation.issues.join(", ")}`);
    try {
      const retryCommand = await translateToCommand(
        `${prompt} (Previous command had issues: ${validation.issues.join(", ")}. Fix those specific issues. Keep the approach but correct the errors.)`,
        perms, []
      );
      if (retryCommand && retryCommand !== command) {
        const retryValidation = validateCommand(retryCommand, process.cwd());
        if (retryValidation.valid || retryValidation.issues.length < validation.issues.length) {
          command = retryCommand;
          console.error(`[terminal] retried: $ ${command}`);
        } else {
          // Retry also invalid — use the simpler of the two
          const retryPipes = (retryCommand.match(/\|/g) || []).length;
          const origPipes = (command.match(/\|/g) || []).length;
          if (retryPipes < origPipes) {
            command = retryCommand;
            console.error(`[terminal] retried (simpler): $ ${command}`);
          }
        }
      }
    } catch {}
  }

  // Show translated commands unless a deterministic local shortcut already names the intent.
  if (!shortcut || process.env.TERMINAL_SHOW_COMMAND === "1") {
    console.error(`$ ${shortcut?.displayCommand ?? command}`);
  }

  // Step 3: Rewrite for optimization
  const rw = rewriteCommand(command);
  const actualCmd = rw.changed ? rw.rewritten : command;
  if (rw.changed) console.error(`[terminal] optimized: ${actualCmd}`);

  // Loop detection
  const loop = detectLoop(actualCmd);
  if (loop.detected) console.error(`[terminal] loop #${loop.iteration}${loop.suggestedNarrow ? ` — try: ${loop.suggestedNarrow}` : ""}`);

  // Step 3: Execute
  try {
    const start = Date.now();
    const raw = execSync(actualCmd + " 2>&1", { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, cwd: process.cwd() });
    const duration = Date.now() - start;
    const clean = stripNoise(stripAnsi(raw)).cleaned;
    const rawTokens = estimateTokens(raw);
    recordUsage(rawTokens);
    saveContext(prompt, actualCmd, clean.slice(0, 500));

    // Test output detection
    // Test output: skip watchlist, let AI framing handle it
    // The AI reads "42 pass, 0 fail" better than regex parsing bun's mixed output

    // Frame-first pipeline: AI answers the question, lazy is fallback
    // For question-type prompts, answer framing runs BEFORE lazy mode
    const isQuestion = /^(what|which|how|is|are|does|do|can|should|where|who|why|am|was|were|has|have|will)\b/i.test(prompt) || prompt.includes("?");

    if (clean.length > 10) {
      // Try AI answer framing first (especially for questions)
      const processed = await processOutput(actualCmd, clean, prompt);
      if (processed.aiProcessed || processed.tokensSaved > 0 || processed.summary !== clean) {
        if (processed.tokensSaved > 0) recordSaving("compressed", processed.tokensSaved);
        // Save full output for lazy recovery — agents can read the file
        if (rawTokens > 500 && processed.tokensSaved > 50) {
          const outputPath = saveOutput(actualCmd, clean);
          console.log(processed.summary);
          const manifestPath = saveOutputManifest(actualCmd, clean);
          if (manifestPath) console.log(formatManifestHint(manifestPath));
          console.log(formatOutputHint(outputPath));
        } else {
          console.log(processed.summary);
          const manifestPath = saveOutputManifest(actualCmd, clean);
          if (manifestPath) console.log(formatManifestHint(manifestPath));
        }
        if (process.env.TERMINAL_SHOW_SAVINGS === "1" && processed.tokensSaved > 10) {
          console.error(`[terminal] ${rawTokens} -> ${rawTokens - processed.tokensSaved} tokens (saved ${processed.tokensSaved})`);
        }
        process.exit(0);
      }
    }

    // Lazy mode — fallback when AI framing didn't run or failed
    if (shouldBeLazy(clean, actualCmd)) {
      const lazy = toLazy(clean, actualCmd);
      const saved = rawTokens - estimateTokens(JSON.stringify(lazy));
      if (saved > 0) recordSaving("compressed", saved);
      console.log(JSON.stringify(lazy, null, 2));
      process.exit(0);
    }

    // Fallback: AI unavailable — pass through clean
    console.log(clean);
    const saved = rawTokens - estimateTokens(clean);
    if (saved > 10) {
      recordSaving("compressed", saved);
      if (process.env.TERMINAL_SHOW_SAVINGS === "1") console.error(`[terminal] saved ${saved} tokens`);
    }
  } catch (e: any) {
    // Empty result (grep exit 1 = no matches) — not a real error
    const errStdout = e.stdout?.toString() ?? "";
    let errStderr = e.stderr?.toString() ?? "";
    if (e.status === 1 && !errStdout.trim() && !errStderr.trim()) {
      // Empty result — retry with broader scope before giving up
      if (!actualCmd.includes("#(broadened)")) {
        try {
          const broaderCmd = await translateToCommand(
            `${prompt} (Previous command found NOTHING. Try searching a BROADER scope: use . or packages/ instead of src/. Use simpler grep pattern.)`,
            perms, []
          );
          if (broaderCmd && !isIrreversible(broaderCmd) && !checkPermissions(broaderCmd, perms)) {
            console.error(`[terminal] broadening search...`);
            const broaderResult = execSync(broaderCmd + " #(broadened)", { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, cwd: process.cwd() });
            const broaderClean = stripNoise(stripAnsi(broaderResult)).cleaned;
            if (broaderClean.trim()) {
              const processed = await processOutput(broaderCmd, broaderClean, prompt);
              console.log(processed.aiProcessed || processed.tokensSaved > 0 || processed.summary !== broaderClean ? processed.summary : broaderClean);
              process.exit(0);
            }
          }
        } catch { /* broader also failed */ }
      }
      console.log(`No results found for: ${prompt}`);
      process.exit(0);
    }

    // 3-retry learning loop: each attempt learns from the previous failure
    if (e.status >= 2) {
      const retryStrategies = [
        // Attempt 2: inject error context
        `${prompt} (Command "${actualCmd}" failed with: ${errStderr.slice(0, 300)}. Fix this specific error. Keep the approach but correct the issue.)`,
        // Attempt 3: inject corrections + force simplicity
        `${prompt} (TWO commands already failed for this query. Use the ABSOLUTE SIMPLEST approach: basic grep -rn, find, wc -l, cat. No awk, no xargs, no subshells. Must work on macOS BSD.)`,
      ];

      for (let attempt = 0; attempt < retryStrategies.length; attempt++) {
        try {
          const retryCmd = await translateToCommand(retryStrategies[attempt], perms, []);
          if (!retryCmd || retryCmd === actualCmd || isIrreversible(retryCmd) || checkPermissions(retryCmd, perms)) continue;

          console.error(`[terminal] retry ${attempt + 2}/3: $ ${retryCmd}`);
          const retryResult = execSync(retryCmd + ` #(retry${attempt + 2})`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, cwd: process.cwd() });
          const retryClean = stripNoise(stripAnsi(retryResult)).cleaned;
          if (retryClean.length > 5) {
            // Record correction — AI learns for next time
            recordCorrection(prompt, actualCmd, errStderr.slice(0, 500), retryCmd, true);
            const processed = await processOutput(retryCmd, retryClean, prompt);
            console.log(processed.aiProcessed || processed.tokensSaved > 0 || processed.summary !== retryClean ? processed.summary : retryClean);
            process.exit(0);
          }
        } catch (retryErr: any) {
          // This attempt also failed — record it and try next strategy
          const retryStderr = retryErr.stderr?.toString() ?? "";
          errStderr = retryStderr; // update for next attempt's context
          continue;
        }
      }
    }

    // Combine stdout+stderr and try AI answer framing (for audit/lint/test commands)
    const combined = errStderr && errStdout.includes(errStderr.trim()) ? errStdout : errStdout + errStderr;
    const errorClean = stripNoise(stripAnsi(combined)).cleaned;
    if (errorClean.length > 20) {
      try {
        const processed = await processOutput(actualCmd, errorClean, prompt);
        if (processed.aiProcessed || processed.tokensSaved > 0 || processed.summary !== errorClean) {
          console.log(processed.summary);
          process.exit(e.status ?? 1);
        }
      } catch {}
    }
    console.log(errorClean);
    process.exit(e.status ?? 1);
  }
}

// ── TUI mode (no args) ──────────────────────────────────────────────────────

else {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CEREBRAS_API_KEY && !process.env.GROQ_API_KEY && !process.env.XAI_API_KEY) {
    console.error("terminal: No API key found.");
    console.error("Set one of:");
    console.error("  export XAI_API_KEY=<your-key>        (Grok, code-optimized — default)");
    console.error("  export CEREBRAS_API_KEY=<your-key>   (free, open-source)");
    console.error("  export GROQ_API_KEY=<your-key>       (free, ultra-fast)");
    console.error("  export ANTHROPIC_API_KEY=<your-key>   (Claude)");
    process.exit(1);
  }

  const App = (await import("./App.js")).default;
  render(<App />);
}
