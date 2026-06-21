import { Command } from "commander";
import { loadDataset } from "../../datasets/loader.js";
import { runEvals } from "../../core/runner.js";
import { printTerminalReport, toJson, toMarkdown } from "../../core/reporter.js";
import { saveRun } from "../../db/store.js";
import { parseAdapterConfig } from "../adapter-parser.js";

export function runCommand(): Command {
  return new Command("run")
    .description("Run an eval dataset against your app")
    .argument("<dataset>", "Path to JSONL/JSON dataset or glob pattern")
    .option("--adapter <type>", "Adapter type: http|anthropic|openai|mcp|function|cli", "http")
    .option("--url <url>", "App URL (for http) or OpenAI-compatible base URL")
    .option("--method <method>", "HTTP method: GET|POST|PUT|PATCH")
    .option("--headers <json>", "HTTP headers as a JSON object")
    .option("--response-mode <mode>", "HTTP response parser: json|text")
    .option("--input-path <path>", "HTTP request path for input, e.g. data.query")
    .option("--output-path <path>", "HTTP response path for output, e.g. result.text")
    .option("--timeout-ms <n>", "Adapter timeout in milliseconds")
    .option("--model <model>", "Model name (for anthropic/openai adapter)")
    .option("--max-tokens <n>", "Max output tokens for model adapters")
    .option("--api-key <key>", "Provider API key override")
    .option("--base-url <url>", "OpenAI-compatible base URL")
    .option("--system <prompt>", "System prompt (for anthropic/openai adapter)")
    .option("--api-key-env <name>", "Env var containing provider API key")
    .option("--module <path>", "Module path (for function adapter)")
    .option("--export <name>", "Export name (for function adapter, default: default)")
    .option("--command <cmd>", "Shell command (for cli adapter, use {{input}} placeholder)")
    .option("--mcp-command <cmd>", "MCP server command (for mcp adapter)")
    .option("--tool <name>", "MCP tool name (for mcp adapter)")
    .option("--concurrency <n>", "Parallel execution limit", "5")
    .option("--repeat <n>", "Run each case N times (Pass^k metric)", "1")
    .option("--tags <tags>", "Comma-separated tags to filter cases")
    .option("--no-judge", "Skip LLM judge, run assertions only")
    .option("--output <format>", "Output format: terminal|json|markdown", "terminal")
    .option("--save", "Save run to database")
    .option("-j, --json", "Alias for --output json")
    .action(async (dataset: string, opts: Record<string, string>) => {
      const { cases, warnings } = await loadDataset(dataset, {
        tags: opts["tags"] ? opts["tags"].split(",") : undefined,
      });

      if (warnings.length > 0) {
        for (const w of warnings) console.warn(`⚠ ${w}`);
      }

      if (cases.length === 0) {
        console.error("No eval cases loaded.");
        process.exit(1);
      }

      const adapter = parseAdapterConfig(opts);
      const run = await runEvals(cases, {
        dataset,
        adapter,
        concurrency: parseInt(opts["concurrency"] ?? "5"),
        repeat: parseInt(opts["repeat"] ?? "1"),
        tags: opts["tags"] ? opts["tags"].split(",") : undefined,
        skipJudge: (opts as unknown as Record<string, unknown>)["judge"] === false || (opts as unknown as Record<string, unknown>)["noJudge"] === true,
      });

      if (opts["save"]) saveRun(run);

      const format = opts["json"] ? "json" : (opts["output"] ?? "terminal");
      if (format === "json") {
        console.log(toJson(run));
      } else if (format === "markdown") {
        console.log(toMarkdown(run));
      } else {
        printTerminalReport(run);
      }

      process.exit(run.stats.failed > 0 || run.stats.errors > 0 ? 1 : 0);
    });
}
