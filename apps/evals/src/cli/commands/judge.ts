import { Command } from "commander";
import { judgeOnce } from "../../core/judge.js";

export function judgeCommand(): Command {
  return new Command("judge")
    .description("Ad-hoc: judge a single input/output pair against a rubric")
    .requiredOption("--input <text>", "The input that was given to the AI")
    .requiredOption("--output <text>", "The AI's response")
    .requiredOption("--rubric <text>", "Plain-English grading criteria")
    .option("--expected <text>", "Expected behavior description")
    .option("--model <model>", "Judge model", "claude-sonnet-4-6")
    .option("--provider <provider>", "Judge provider: anthropic|openai", "anthropic")
    .option("--json", "Output JSON")
    .action(async (opts: Record<string, string>) => {
      const result = await judgeOnce({
        input: opts["input"] ?? "",
        output: opts["output"] ?? "",
        rubric: opts["rubric"] ?? "",
        expected: opts["expected"],
        model: opts["model"],
        provider: opts["provider"] as "anthropic" | "openai",
      });

      if (opts["json"]) {
        console.log(JSON.stringify(result));
      } else {
        const icon = result.verdict === "PASS" ? "\x1b[32m✓\x1b[0m" : result.verdict === "FAIL" ? "\x1b[31m✗\x1b[0m" : "\x1b[33m?\x1b[0m";
        console.log(`\n${icon} ${result.verdict}\n`);
        console.log(`Reasoning: ${result.reasoning}\n`);
        console.log(`Duration: ${result.durationMs}ms  Cost: $${(result.costUsd ?? 0).toFixed(4)}`);
      }

      process.exit(result.verdict === "FAIL" ? 1 : 0);
    });
}
