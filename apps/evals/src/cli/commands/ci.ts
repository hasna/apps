import { Command } from "commander";
import { loadDataset } from "../../datasets/loader.js";
import { runEvals } from "../../core/runner.js";
import { compareRuns, printDiffReport, printTerminalReport, toMarkdown } from "../../core/reporter.js";
import { saveRun, getBaseline, setBaseline } from "../../db/store.js";
import { parseAdapterConfig } from "../adapter-parser.js";

export function ciCommand(): Command {
  const cmd = new Command("ci")
    .description("Run evals in CI mode — exit non-zero on regression");

  cmd
    .command("run <dataset>")
    .description("Run and compare to baseline")
    .option("--adapter <type>", "Adapter type: http|anthropic|openai|mcp|function|cli", "http")
    .option("--url <url>", "App URL (for http adapter)")
    .option("--model <model>", "Model name (for anthropic/openai adapter)")
    .option("--system <prompt>", "System prompt (for anthropic/openai adapter)")
    .option("--module <path>", "Module path (for function adapter)")
    .option("--export <name>", "Export name (for function adapter)")
    .option("--command <cmd>", "Shell command (for cli adapter)")
    .option("--mcp-command <cmd>", "MCP server command (for mcp adapter)")
    .option("--tool <name>", "MCP tool name (for mcp adapter)")
    .option("--no-judge", "Skip LLM judge, assertions only")
    .option("--baseline <name>", "Baseline name to compare against", "main")
    .option("--fail-if-regression <pct>", "Fail if score drops by more than N%", "0")
    .option("--output <format>", "Output format: terminal|markdown", "terminal")
    .option("--json", "Output JSON")
    .action(async (dataset: string, opts: Record<string, string>) => {
      const { cases } = await loadDataset(dataset);
      const adapter = parseAdapterConfig(opts);
      const run = await runEvals(cases, { dataset, adapter, skipJudge: (opts as unknown as Record<string, unknown>)["judge"] === false || (opts as unknown as Record<string, unknown>)["noJudge"] === true });
      saveRun(run);

      const baselineName = opts["baseline"] ?? "main";
      const baseline = getBaseline(baselineName);

      if (opts["json"]) { console.log(JSON.stringify(run)); }
      else if (opts["output"] === "markdown") { console.log(toMarkdown(run)); }
      else { printTerminalReport(run); }

      if (baseline) {
        const diff = compareRuns(baseline, run);
        console.log(`\nCompared to baseline "${baselineName}":`);
        printDiffReport(diff);

        const threshold = parseFloat(opts["failIfRegression"] ?? "0");
        const dropPct = -diff.passRateDelta * 100;
        if (dropPct > threshold) {
          console.error(`\n\x1b[31m✗ Score dropped ${dropPct.toFixed(1)}% (threshold: ${threshold}%)\x1b[0m`);
          process.exit(1);
        }
      } else {
        console.log(`\nNo baseline "${baselineName}" found — use "evals ci set-baseline" to create one.`);
      }

      if (run.stats.failed > 0) process.exit(1);
    });

  cmd
    .command("set-baseline <name>")
    .description("Save the most recent run as a named baseline")
    .option("--run-id <id>", "Specific run ID (defaults to most recent)")
    .action(async (name: string, opts: Record<string, string>) => {
      const { listRuns } = await import("../../db/store.js");
      const runId = opts["runId"] ?? listRuns(1)[0]?.id;
      if (!runId) { console.error("No runs found. Run evals first."); process.exit(1); }
      setBaseline(name, runId);
      console.log(`\x1b[32m✓ Baseline "${name}" set to run ${runId.slice(0, 8)}\x1b[0m`);
    });

  return cmd;
}
