#!/usr/bin/env bun
import React from "react";
import { render } from "ink";

const args = process.argv.slice(2);

// ── Help / Version ───────────────────────────────────────────────────────────

if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  console.log(`open-terminal v0.6.1 — Smart terminal for AI agents and humans

USAGE:
  terminal                     Launch interactive NL terminal (TUI)
  terminal <subcommand>        Run a specific command

SUBCOMMANDS:
  mcp serve                    Start MCP server (stdio transport)
  mcp install --claude|--codex|--gemini|--all
                               Install as MCP server for AI agents
  hook install --claude        Install Claude Code PostToolUse hook
  hook uninstall               Remove hooks
  recipe add <name> <cmd>      Save a reusable command recipe
  recipe list                  List saved recipes
  recipe run <name> [--var=X]  Run a recipe with variable substitution
  recipe delete <name>         Delete a recipe
  collection create <name>     Create a recipe collection
  collection list              List collections
  project init                 Initialize project-scoped recipes
  repo                         Show git repo state (branch + status + log)
  symbols <file>               Show file outline (functions, classes, exports)
  stats                        Show token economy dashboard
  sessions                     List recent terminal sessions
  sessions stats               Show session analytics
  sessions <id>                Show session details
  snapshot                     Capture terminal state as JSON
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
  CEREBRAS_API_KEY             Cerebras API key (free, open-source default)
  ANTHROPIC_API_KEY            Anthropic API key (Claude models)
`);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log("0.6.1");
  process.exit(0);
}

// ── Exec command — smart execution for agents ────────────────────────────────

if (args[0] === "exec") {
  // Parse flags: --json, --offset=N, --limit=N, --raw
  const flags: Record<string, string> = {};
  const cmdParts: string[] = [];
  for (const arg of args.slice(1)) {
    const flagMatch = arg.match(/^--(\w+)(?:=(.+))?$/);
    if (flagMatch) { flags[flagMatch[1]] = flagMatch[2] ?? "true"; }
    else { cmdParts.push(arg); }
  }
  const command = cmdParts.join(" ");
  const jsonMode = flags.json === "true";
  const rawMode = flags.raw === "true";
  const offset = flags.offset ? parseInt(flags.offset) : undefined;
  const limit = flags.limit ? parseInt(flags.limit) : undefined;

  if (!command) {
    console.error("Usage: terminal exec <command> [--json] [--raw] [--offset=N] [--limit=N]");
    process.exit(1);
  }

  const { execSync } = await import("child_process");
  const { compress, stripAnsi } = await import("./compression.js");
  const { stripNoise } = await import("./noise-filter.js");
  const { processOutput, shouldProcess } = await import("./output-processor.js");
  const { rewriteCommand } = await import("./command-rewriter.js");
  const { shouldBeLazy, toLazy, getSlice } = await import("./lazy-executor.js");
  const { parseOutput, estimateTokens } = await import("./parsers/index.js");
  const { recordSaving, recordUsage } = await import("./economy.js");

  // Rewrite command if possible
  const rw = rewriteCommand(command);
  const actualCmd = rw.changed ? rw.rewritten : command;
  if (rw.changed) console.error(`[open-terminal] rewritten: ${actualCmd} (${rw.reason})`);

  try {
    const start = Date.now();
    const raw = execSync(actualCmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, cwd: process.cwd() });
    const duration = Date.now() - start;
    const clean = stripNoise(stripAnsi(raw)).cleaned;
    const rawTokens = estimateTokens(raw);

    // Track usage
    recordUsage(rawTokens);

    // --raw flag: skip all processing
    if (rawMode) { console.log(clean); process.exit(0); }

    // --json flag: always return structured JSON
    if (jsonMode) {
      const parsed = parseOutput(actualCmd, clean);
      if (parsed) {
        const saved = rawTokens - estimateTokens(JSON.stringify(parsed.data));
        if (saved > 0) recordSaving("structured", saved);
        console.log(JSON.stringify({ exitCode: 0, parser: parsed.parser, data: parsed.data, duration, tokensSaved: Math.max(0, saved) }));
      } else {
        const compressed = compress(actualCmd, clean, { format: "json" });
        console.log(JSON.stringify({ exitCode: 0, output: compressed.content, duration, tokensSaved: compressed.tokensSaved }));
      }
      process.exit(0);
    }

    // Pagination: --offset + --limit on a previous large result
    if (offset !== undefined || limit !== undefined) {
      const slice = getSlice(clean, offset ?? 0, limit ?? 50);
      console.log(slice.lines.join("\n"));
      if (slice.hasMore) console.error(`[open-terminal] showing ${slice.lines.length}/${slice.total}, ${slice.total - (offset ?? 0) - slice.lines.length} remaining`);
      process.exit(0);
    }

    // Lazy mode for huge output (threshold 200, skip cat/summary commands)
    if (shouldBeLazy(clean, actualCmd)) {
      const lazy = toLazy(clean, actualCmd);
      const savedTokens = rawTokens - estimateTokens(JSON.stringify(lazy));
      if (savedTokens > 0) recordSaving("compressed", savedTokens);
      console.log(JSON.stringify({ ...lazy, duration, tokensSaved: savedTokens }));
      process.exit(0);
    }

    // AI summary for medium-large output (>15 lines)
    if (shouldProcess(clean)) {
      const processed = await processOutput(actualCmd, clean);
      if (processed.aiProcessed && processed.tokensSaved > 30) {
        recordSaving("compressed", processed.tokensSaved);
        console.log(processed.summary);
        console.error(`[open-terminal] ${rawTokens} → ${rawTokens - processed.tokensSaved} tokens (saved ${processed.tokensSaved}, ${Math.round(processed.tokensSaved/rawTokens*100)}%)`);
        process.exit(0);
      }
    }

    // Small/medium output — just noise-strip and return
    console.log(clean);
    const savedTokens = rawTokens - estimateTokens(clean);
    if (savedTokens > 10) {
      recordSaving("compressed", savedTokens);
      console.error(`[open-terminal] saved ${savedTokens} tokens (noise filter)`);
    }
  } catch (e: any) {
    // Command failed — show error output
    const stderr = e.stderr?.toString() ?? "";
    const stdout = e.stdout?.toString() ?? "";
    console.log(stripNoise(stripAnsi(stdout + stderr)).cleaned);
    process.exit(e.status ?? 1);
  }
  process.exit(0);
}

// ── MCP commands ─────────────────────────────────────────────────────────────

if (args[0] === "mcp") {
  if (args[1] === "serve" || args.length === 1) {
    const { startMcpServer } = await import("./mcp/server.js");
    startMcpServer().catch((err) => {
      console.error("MCP server error:", err);
      process.exit(1);
    });
  } else if (args[1] === "install") {
    const { handleMcpInstall } = await import("./mcp/install.js");
    handleMcpInstall(args.slice(2));
  } else {
    console.log("Usage: t mcp [serve|install]");
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
# open-terminal PostToolUse hook — compresses Bash output
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
    let recipes = listRecipes(process.cwd());
    if (collection) recipes = recipes.filter(r => r.collection === collection);
    if (recipes.length === 0) { console.log("No recipes found."); }
    else {
      for (const r of recipes) {
        const scope = r.project ? "(project)" : "(global)";
        const col = r.collection ? ` [${r.collection}]` : "";
        console.log(`  ${r.name}${col} ${scope} → ${r.command}`);
      }
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
    console.log("  t recipe list [--collection=X]");
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
    else for (const c of cols) console.log(`  ${c.name}${c.description ? ` — ${c.description}` : ""}`);
  } else {
    console.log("Usage: t collection [create|list]");
  }
}

// ── Stats command ────────────────────────────────────────────────────────────

else if (args[0] === "stats") {
  const { getEconomyStats, formatTokens } = await import("./economy.js");
  const s = getEconomyStats();
  console.log("Token Economy:");
  console.log(`  Total saved:  ${formatTokens(s.totalTokensSaved)}`);
  console.log(`  Total used:   ${formatTokens(s.totalTokensUsed)}`);
  console.log(`  By feature:`);
  console.log(`    Structured: ${formatTokens(s.savingsByFeature.structured)}`);
  console.log(`    Compressed: ${formatTokens(s.savingsByFeature.compressed)}`);
  console.log(`    Diff cache: ${formatTokens(s.savingsByFeature.diff)}`);
  console.log(`    NL cache:   ${formatTokens(s.savingsByFeature.cache)}`);
  console.log(`    Search:     ${formatTokens(s.savingsByFeature.search)}`);
}

// ── Sessions command ─────────────────────────────────────────────────────────

else if (args[0] === "sessions") {
  const { listSessions, getSession, getSessionInteractions, getSessionStats } = await import("./sessions-db.js");

  if (args[1] === "stats") {
    const stats = getSessionStats();
    console.log("Session Stats:");
    console.log(`  Total sessions:     ${stats.totalSessions}`);
    console.log(`  Total interactions:  ${stats.totalInteractions}`);
    console.log(`  Tokens saved:        ${stats.totalTokensSaved}`);
    console.log(`  Tokens used:         ${stats.totalTokensUsed}`);
    console.log(`  Cache hit rate:      ${(stats.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`  Avg per session:     ${stats.avgInteractionsPerSession.toFixed(1)}`);
    console.log(`  Error rate:          ${(stats.errorRate * 100).toFixed(1)}%`);
  } else if (args[1]) {
    // Show specific session
    const session = getSession(args[1]);
    if (!session) { console.error(`Session '${args[1]}' not found.`); process.exit(1); }
    console.log(`Session: ${session.id}`);
    console.log(`  Started: ${new Date(session.started_at).toLocaleString()}`);
    console.log(`  CWD:     ${session.cwd}`);
    console.log(`  Provider: ${session.provider ?? "auto"}`);
    console.log("");
    const interactions = getSessionInteractions(session.id);
    for (const i of interactions) {
      const status = i.exit_code === 0 ? "✓" : i.exit_code ? "✗" : "·";
      console.log(`  ${status} ${i.nl}`);
      if (i.command) console.log(`    $ ${i.command}`);
    }
    console.log(`\n  ${interactions.length} interactions`);
  } else {
    // List recent sessions
    const sessions = listSessions(20);
    if (sessions.length === 0) { console.log("No sessions yet."); }
    else {
      for (const s of sessions) {
        const date = new Date(s.started_at).toLocaleString();
        const dir = s.cwd.split("/").pop() || s.cwd;
        console.log(`  ${s.id.slice(0, 8)}  ${date}  ${dir}  ${s.provider ?? "auto"}`);
      }
    }
  }
}

// ── Repo command ─────────────────────────────────────────────────────────────

else if (args[0] === "repo") {
  const { execSync } = await import("child_process");
  const run = (cmd: string) => { try { return execSync(cmd, { encoding: "utf8", cwd: process.cwd() }).trim(); } catch { return ""; } };
  const branch = run("git branch --show-current");
  const status = run("git status --short");
  const log = run("git log --oneline -8 --decorate");
  console.log(`Branch: ${branch}`);
  if (status) { console.log(`\nChanges:\n${status}`); }
  else { console.log("\nClean working tree"); }
  console.log(`\nRecent:\n${log}`);
}

// ── Symbols command ──────────────────────────────────────────────────────────

else if (args[0] === "symbols" && args[1]) {
  const { extractSymbolsFromFile } = await import("./search/semantic.js");
  const { resolve } = await import("path");
  const filePath = resolve(args[1]);
  const symbols = extractSymbolsFromFile(filePath);
  if (symbols.length === 0) { console.log("No symbols found."); }
  else {
    for (const s of symbols) {
      const exp = s.exported ? "⬡" : "·";
      console.log(`  ${exp} ${s.kind.padEnd(10)} L${String(s.line).padStart(4)}  ${s.name}`);
    }
  }
}

// ── Snapshot command ─────────────────────────────────────────────────────────

else if (args[0] === "snapshot") {
  const { captureSnapshot } = await import("./snapshots.js");
  console.log(JSON.stringify(captureSnapshot(), null, 2));
}

// ── Project init ─────────────────────────────────────────────────────────────

else if (args[0] === "project" && args[1] === "init") {
  const { initProject } = await import("./recipes/storage.js");
  initProject(process.cwd());
  console.log("✓ Initialized .terminal/recipes.json");
}

// ── TUI mode (default) ──────────────────────────────────────────────────────

else {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CEREBRAS_API_KEY) {
    console.error("terminal: No API key found.");
    console.error("Set one of:");
    console.error("  export CEREBRAS_API_KEY=your_key  (free, open-source)");
    console.error("  export ANTHROPIC_API_KEY=your_key  (Claude)");
    process.exit(1);
  }

  const App = (await import("./App.js")).default;
  render(<App />);
}
