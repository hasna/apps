import { Command } from "commander";
import { loadDataset } from "../../datasets/loader.js";

const COST_PER_1K_INPUT: Record<string, number> = {
  "claude-sonnet-4-6": 0.003,
  "claude-opus-4-6": 0.015,
  "claude-haiku-4-5": 0.00025,
  "gpt-4o": 0.0025,
  "gpt-4o-mini": 0.00015,
};

const AVG_JUDGE_TOKENS = 800; // average tokens per judge call

export function estimateCommand(): Command {
  return new Command("estimate")
    .description("Estimate cost before running evals (no API calls made)")
    .argument("<dataset>", "Path to JSONL/JSON dataset")
    .option("--model <model>", "Judge model", "claude-sonnet-4-6")
    .option("--no-judge", "Assume no judge calls")
    .option("-j, --json", "Output JSON")
    .action(async (dataset: string, opts: Record<string, string>) => {
      const { cases, warnings } = await loadDataset(dataset);
      if (warnings.length > 0) for (const w of warnings) console.warn(`⚠ ${w}`);

      const model = opts["model"] ?? "claude-sonnet-4-6";
      const skipJudge = opts["noJudge"] === "true";
      const costPer1kInput = COST_PER_1K_INPUT[model] ?? 0.003;

      // Count cases that would need judge (those with judge config)
      const judgeCount = skipJudge ? 0 : cases.filter((c) => c.judge).length;
      const assertionOnlyCount = cases.length - judgeCount;
      const estimatedJudgeTokens = judgeCount * AVG_JUDGE_TOKENS;
      const estimatedCostUsd = (estimatedJudgeTokens / 1000) * costPer1kInput;

      const result = {
        totalCases: cases.length,
        assertionOnly: assertionOnlyCount,
        judgeRequired: judgeCount,
        model,
        estimatedTokens: estimatedJudgeTokens,
        estimatedCostUsd: parseFloat(estimatedCostUsd.toFixed(4)),
        note: "Actual cost may be lower if assertions short-circuit before judge runs",
      };

      if (opts["json"]) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n\x1b[1mCost estimate for ${dataset}\x1b[0m`);
        console.log(`  Total cases:       ${result.totalCases}`);
        console.log(`  Assertion-only:    ${result.assertionOnly}`);
        console.log(`  Judge required:    ${result.judgeRequired}  (model: ${model})`);
        console.log(`  Est. tokens:       ${result.estimatedTokens.toLocaleString()}`);
        console.log(`  Est. cost:         \x1b[33m$${result.estimatedCostUsd}\x1b[0m`);
        console.log(`  Note: ${result.note}\n`);
      }
    });
}
