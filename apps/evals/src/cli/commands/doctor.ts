import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * Try to resolve an API key from process.env first, then from the
 * ~/.secrets/hasnaxyz/<service>/live.env file as a fallback.
 * This handles cases where the CLI is invoked outside a shell session
 * that sources the secrets (e.g. cron, agent spawns, MCP calls).
 */
function resolveApiKey(envVar: string, secretsPath: string, secretsKey: string): string | undefined {
  // 1. Direct env var
  if (process.env[envVar]) return process.env[envVar];

  // 2. ~/.secrets fallback
  const fullPath = join(homedir(), ".secrets", secretsPath);
  if (existsSync(fullPath)) {
    try {
      const content = readFileSync(fullPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith(secretsKey + "=")) {
          const value = trimmed.slice(secretsKey.length + 1).replace(/^["']|["']$/g, "");
          if (value) {
            // Auto-inject for this process so downstream calls work too
            process.env[envVar] = value;
            return value;
          }
        }
      }
    } catch { /* ignore read errors */ }
  }

  return undefined;
}

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Health check — verify API keys, DB, and config")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const checks: Array<{ name: string; ok: boolean; hint?: string }> = [];

      // Check Anthropic API key — env var or ~/.secrets fallback
      const anthropicKey = resolveApiKey(
        "ANTHROPIC_API_KEY",
        "hasnaxyz/anthropic/live.env",
        "HASNAXYZ_ANTHROPIC_LIVE_API_KEY"
      );
      checks.push({
        name: "ANTHROPIC_API_KEY",
        ok: !!anthropicKey,
        hint: "export ANTHROPIC_API_KEY=<your-key>  (or add to ~/.secrets/hasnaxyz/anthropic/live.env)",
      });

      // Check OpenAI API key (optional) — env var or ~/.secrets fallback
      const openaiKey = resolveApiKey(
        "OPENAI_API_KEY",
        "hasnaxyz/openai/live.env",
        "HASNAXYZ_OPENAI_LIVE_API_KEY"
      );
      checks.push({
        name: "OPENAI_API_KEY (optional)",
        ok: !!openaiKey,
        hint: "export OPENAI_API_KEY=<your-key>  (only needed for OpenAI adapter/judge)",
      });

      // Check DB writable
      try {
        process.env["EVALS_DB_PATH"] = ":memory:";
        const { getDatabase, closeDatabase } = await import("../../db/store.js");
        getDatabase();
        closeDatabase();
        delete process.env["EVALS_DB_PATH"];
        checks.push({ name: "SQLite DB", ok: true });
      } catch (err) {
        checks.push({ name: "SQLite DB", ok: false, hint: String(err) });
      }

      // Check example dataset — try multiple candidate paths
      try {
        const { loadDataset } = await import("../../datasets/loader.js");
        const { existsSync } = await import("fs");
        const { join } = await import("path");
        const { homedir } = await import("os");

        // Candidates: relative to this file (dev), relative to dist/cli (installed), package root
        const candidates = [
          new URL("../../../datasets/examples/smoke.jsonl", import.meta.url).pathname,
          join(import.meta.dir, "../../../datasets/examples/smoke.jsonl"),
          join(import.meta.dir, "../../datasets/examples/smoke.jsonl"),
          join(import.meta.dir, "../datasets/examples/smoke.jsonl"),
          join(homedir(), ".hasna", "evals", "examples", "smoke.jsonl"),
        ];

        const found = candidates.find(p => existsSync(p));
        if (!found) throw new Error("not found");
        const { cases } = await loadDataset(found);
        checks.push({ name: `Example dataset (${cases.length} cases)`, ok: cases.length > 0 });
      } catch {
        checks.push({ name: "Example dataset (optional)", ok: false, hint: "datasets/examples/smoke.jsonl not found — install @hasna/evals globally to include examples" });
      }

      const allOk = checks.every((c) => c.ok || c.name.toLowerCase().includes("optional"));
      if (opts.json) {
        console.log(JSON.stringify({
          ok: allOk,
          checks,
          summary: allOk ? "All checks passed." : "Some checks failed — see hints above.",
        }, null, 2));
        process.exit(allOk ? 0 : 1);
      }

      console.log("\n\x1b[1mevals doctor\x1b[0m\n");
      for (const c of checks) {
        const icon = c.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
        console.log(`  ${icon} ${c.name}${!c.ok && c.hint ? `\n      hint: ${c.hint}` : ""}`);
      }
      console.log(allOk ? "\n\x1b[32m  All checks passed.\x1b[0m\n" : "\n\x1b[31m  Some checks failed — see hints above.\x1b[0m\n");
      process.exit(allOk ? 0 : 1);
    });
}
