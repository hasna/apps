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

      // Check example dataset
      try {
        const { loadDataset } = await import("../../datasets/loader.js");
        const examplesPath = new URL("../../../datasets/examples/smoke.jsonl", import.meta.url).pathname;
        const { cases } = await loadDataset(examplesPath);
        checks.push({ name: `Example dataset (${cases.length} cases)`, ok: cases.length > 0, hint: "datasets/examples/smoke.jsonl missing" });
      } catch {
        checks.push({ name: "Example dataset", ok: false, hint: "Run from the open-evals project directory" });
      }

      console.log("\n\x1b[1mevals doctor\x1b[0m\n");
      for (const c of checks) {
        const icon = c.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
        console.log(`  ${icon} ${c.name}${!c.ok && c.hint ? `\n      hint: ${c.hint}` : ""}`);
      }

      const allOk = checks.every((c) => c.ok || c.name.includes("optional"));
      console.log(allOk ? "\n\x1b[32m  All checks passed.\x1b[0m\n" : "\n\x1b[31m  Some checks failed — see hints above.\x1b[0m\n");
      process.exit(allOk ? 0 : 1);
    });
}
