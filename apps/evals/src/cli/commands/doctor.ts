import { Command } from "commander";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Health check — verify API keys, DB, and config")
    .action(async () => {
      const checks: Array<{ name: string; ok: boolean; hint?: string }> = [];

      // Check Anthropic API key
      checks.push({
        name: "ANTHROPIC_API_KEY",
        ok: !!process.env["ANTHROPIC_API_KEY"],
        hint: "export ANTHROPIC_API_KEY=<your-key>",
      });

      // Check OpenAI API key (optional)
      checks.push({
        name: "OPENAI_API_KEY (optional)",
        ok: !!process.env["OPENAI_API_KEY"],
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

      console.log("\n\x1b[1mevals doctor\x1b[0m\n");
      for (const c of checks) {
        const icon = c.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
        console.log(`  ${icon} ${c.name}${!c.ok && c.hint ? `\n      hint: ${c.hint}` : ""}`);
      }

      const allOk = checks.every((c) => c.ok || c.name.toLowerCase().includes("optional"));
      console.log(allOk ? "\n\x1b[32m  All checks passed.\x1b[0m\n" : "\n\x1b[31m  Some checks failed — see hints above.\x1b[0m\n");
      process.exit(allOk ? 0 : 1);
    });
}
