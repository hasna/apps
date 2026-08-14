// Meta tools: token_stats, session_history, snapshot, watch, list_recipes, run_recipe, save_recipe, list_collections

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { stripAnsi } from "../../compression.js";
import { estimateTokens } from "../../tokens.js";
import { processOutput } from "../../output-processor.js";
import { listRecipes, listCollections, getRecipe, createRecipe } from "../../recipes/storage.js";
import { substituteVariables } from "../../recipes/model.js";
import { listSessions, getSessionInteractions, getSessionStats, getSessionEconomy } from "../../sessions-db.js";
import { getEconomyStats } from "../../economy.js";
import { captureSnapshot } from "../../snapshots.js";
import { storeOutput } from "../../expand-store.js";
import {
  compactCollection,
  compactInteraction,
  compactRecipe,
  compactSession,
  compactSnapshot,
  truncateText,
} from "../../compact-output.js";

export function registerMetaTools(server: McpServer, h: ToolHelpers): void {

  // ── token_stats ───────────────────────────────────────────────────────────

  server.tool(
    "token_stats",
    "Get full token economy — savings, costs, ROI. Includes round-trip multiplier (saved tokens repeated across ~5 turns).",
    async () => {
      const stats = getEconomyStats();
      const { estimateSavingsUsd } = await import("../../economy.js");
      const opus = estimateSavingsUsd(stats.totalTokensSaved, "anthropic-opus");
      const sonnet = estimateSavingsUsd(stats.totalTokensSaved, "anthropic-sonnet");
      const haiku = estimateSavingsUsd(stats.totalTokensSaved, "anthropic");
      return { content: [{ type: "text" as const, text: JSON.stringify({
        ...stats,
        roundTrip: {
          multiplier: 5,
          billableTokensSaved: stats.totalTokensSaved * 5,
          savingsUsd: { opus: opus.savingsUsd, sonnet: sonnet.savingsUsd, haiku: haiku.savingsUsd },
        },
        ratio: stats.totalTokensUsed > 0 ? Math.round((stats.totalTokensSaved / stats.totalTokensUsed) * 10) / 10 : 0,
      }) }] };
    }
  );

  // ── session_history ───────────────────────────────────────────────────────

  server.tool(
    "session_history",
    "Query terminal session history — recent sessions, specific session details, or aggregate stats.",
    {
      action: z.enum(["list", "detail", "stats"]).describe("list=recent sessions, detail=specific session, stats=aggregates"),
      sessionId: z.string().optional().describe("Session ID (for detail action)"),
      limit: z.number().optional().describe("Max sessions to return (for list, default: 20)"),
      offset: z.number().optional().describe("Skip N rows for pagination"),
      verbose: z.boolean().optional().describe("Return full detail arrays instead of compact summaries"),
    },
    async ({ action, sessionId, limit, offset, verbose }) => {
      if (action === "stats") {
        return { content: [{ type: "text" as const, text: JSON.stringify(getSessionStats()) }] };
      }
      if (action === "detail" && sessionId) {
        const interactions = getSessionInteractions(sessionId);
        const economy = getSessionEconomy(sessionId);
        const pageSize = Math.min(limit ?? 20, 100);
        const start = offset ?? 0;
        const page = interactions.slice(start, start + pageSize);
        return { content: [{ type: "text" as const, text: JSON.stringify({
          interactions: verbose ? page : page.map((item) => compactInteraction(item)),
          economy,
          totalInteractions: interactions.length,
          limit: pageSize,
          offset: start,
          nextOffset: start + page.length < interactions.length ? start + page.length : null,
          hint: "Use verbose=true for full prompts/commands or action='stats' for aggregates.",
        }) }] };
      }
      const pageSize = Math.min(limit ?? 20, 100);
      const sessions = listSessions(pageSize + (offset ?? 0)).slice(offset ?? 0);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        sessions: verbose ? sessions : sessions.map((session) => compactSession(session)),
        returned: sessions.length,
        limit: pageSize,
        offset: offset ?? 0,
        hint: "Use action='detail' with sessionId for interactions, verbose=true for full rows.",
      }) }] };
    }
  );

  // ── snapshot ──────────────────────────────────────────────────────────────

  server.tool(
    "snapshot",
    "Capture a compact snapshot of terminal state (cwd, env, running processes, recent commands, recipes). Useful for agent context handoff.",
    {
      verbose: z.boolean().optional().describe("Return more env/process/recipe/command detail"),
      full: z.boolean().optional().describe("Return the full legacy snapshot. Default is compact."),
    },
    async ({ verbose, full }) => {
      const snap = captureSnapshot();
      return { content: [{ type: "text" as const, text: JSON.stringify(full ? snap : {
        ...compactSnapshot(snap, Boolean(verbose)),
        hint: "Use full=true for the full legacy snapshot payload.",
      }) }] };
    }
  );

  // ── watch ─────────────────────────────────────────────────────────────────

  server.tool(
    "watch",
    "Run a task (test/build/lint/typecheck) on file change. Returns diff from last run. Agent stops polling — we push on change. Call watch_stop to end.",
    {
      task: z.enum(["test", "build", "lint", "typecheck"]).describe("Task to run on change"),
      path: z.string().optional().describe("File or directory to watch (default: src/)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ task, path: watchPath, cwd }) => {
      const workDir = cwd ?? process.cwd();
      const target = h.resolvePath(watchPath ?? "src/", workDir);
      const watchId = `${task}:${target}`;

      // Run once immediately
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      let runner = "npm run";
      if (existsSync(join(workDir, "bun.lockb")) || existsSync(join(workDir, "bun.lock"))) runner = "bun run";
      else if (existsSync(join(workDir, "Cargo.toml"))) runner = "cargo";

      const cmd = runner === "cargo" ? `cargo ${task}` : `${runner} ${task}`;
      const result = await h.exec(cmd, workDir, 60000);
      const output = (result.stdout + result.stderr).trim();
      const processed = await processOutput(cmd, output);

      // Store initial result for diffing
      const detailKey = storeOutput(`watch:${task}`, output);

      h.logCall("watch", { command: `watch ${task} ${target}`, exitCode: result.exitCode, durationMs: 0, aiProcessed: processed.aiProcessed });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        watchId,
        task,
        watching: target,
        initialRun: { exitCode: result.exitCode, summary: processed.summary, tokensSaved: processed.tokensSaved },
        hint: "File watching active. Call execute_diff with the same command to get changes on next run.",
      }) }] };
    }
  );

  // ── list_recipes ──────────────────────────────────────────────────────────

  server.tool(
    "list_recipes",
    "List saved command recipes. Optionally filter by collection or project.",
    {
      collection: z.string().optional().describe("Filter by collection name"),
      project: z.string().optional().describe("Project path for project-scoped recipes"),
      limit: z.number().optional().describe("Max recipes to return (default: 20)"),
      verbose: z.boolean().optional().describe("Return full recipe objects"),
    },
    async ({ collection, project, limit, verbose }) => {
      let recipes = listRecipes(project);
      if (collection) recipes = recipes.filter(r => r.collection === collection);
      const pageSize = Math.min(limit ?? 20, 100);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        recipes: verbose ? recipes.slice(0, pageSize) : recipes.slice(0, pageSize).map((recipe) => compactRecipe(recipe)),
        total: recipes.length,
        returned: Math.min(recipes.length, pageSize),
        hint: "Use verbose=true for full command metadata or run_recipe for execution.",
      }) }] };
    }
  );

  // ── run_recipe ────────────────────────────────────────────────────────────

  server.tool(
    "run_recipe",
    "Run a saved recipe by name with optional variable substitution.",
    {
      name: z.string().describe("Recipe name"),
      variables: z.record(z.string(), z.string()).optional().describe("Variable values: {port: '3000'}"),
      cwd: z.string().optional().describe("Working directory"),
      format: z.enum(["raw", "json", "compressed"]).optional().describe("raw returns full output; default/json/compressed return compact output"),
    },
    async ({ name, variables, cwd, format }) => {
      const recipe = getRecipe(name, cwd);
      if (!recipe) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Recipe '${name}' not found` }) }] };
      }

      const command = variables ? substituteVariables(recipe.command, variables) : recipe.command;
      const result = await h.exec(command, cwd, 30000);
      const output = (result.stdout + result.stderr).trim();

      if (format === "raw") {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          recipe: name, exitCode: result.exitCode, output: stripAnsi(output), duration: result.duration,
          hint: "raw output requested explicitly; omit format or use compressed to reduce tokens.",
        }) }] };
      }

      const processed = await processOutput(command, output);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        recipe: name, exitCode: result.exitCode, summary: processed.summary,
        structured: processed.structured, duration: result.duration,
        tokensSaved: processed.tokensSaved, aiProcessed: processed.aiProcessed,
        outputPreview: output.split("\n").length <= 5 ? truncateText(stripAnsi(output), 500) : undefined,
        hint: "Use format='raw' only when full stdout/stderr is required.",
      }) }] };
    }
  );

  // ── save_recipe ───────────────────────────────────────────────────────────

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

  // ── list_collections ──────────────────────────────────────────────────────

  server.tool(
    "list_collections",
    "List recipe collections.",
    {
      project: z.string().optional().describe("Project path"),
      limit: z.number().optional().describe("Max collections to return (default: 20)"),
      verbose: z.boolean().optional().describe("Return full collection objects"),
    },
    async ({ project, limit, verbose }) => {
      const collections = listCollections(project);
      const pageSize = Math.min(limit ?? 20, 100);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        collections: verbose ? collections.slice(0, pageSize) : collections.slice(0, pageSize).map((collection) => compactCollection(collection)),
        total: collections.length,
        returned: Math.min(collections.length, pageSize),
      }) }] };
    }
  );
}
