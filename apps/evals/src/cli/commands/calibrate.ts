import { Command } from "commander";
import { loadDataset } from "../../datasets/loader.js";
import { runJudge } from "../../core/judge.js";
import type { Verdict } from "../../types/index.js";

export function calibrateCommand(): Command {
  return new Command("calibrate")
    .description("Check judge agreement against a gold-labeled dataset")
    .argument("<gold>", "Path to gold-labeled JSONL (each case needs metadata.gold_verdict)")
    .option("--model <model>", "Judge model to calibrate", "claude-sonnet-4-6")
    .option("--provider <p>", "Provider: anthropic|openai", "anthropic")
    .option("--json", "Output JSON")
    .action(async (gold: string, opts: Record<string, string>) => {
      const { cases } = await loadDataset(gold);
      const goldCases = cases.filter((c) => c.metadata?.["gold_verdict"]);

      if (goldCases.length === 0) {
        console.error('No cases with metadata.gold_verdict found. Add "metadata": {"gold_verdict": "PASS"} to your gold set.');
        process.exit(1);
      }

      console.log(`Calibrating ${opts["model"]} on ${goldCases.length} gold cases...`);
      let agreements = 0;
      const results: Array<{ id: string; gold: Verdict; predicted: Verdict; match: boolean }> = [];

      for (const c of goldCases) {
        const goldVerdict = c.metadata?.["gold_verdict"] as Verdict;
        const judgeResult = await runJudge(
          c.input ?? "",
          c.expected ?? "",
          { rubric: c.judge?.rubric ?? "Does the response meet quality standards?", model: opts["model"], provider: opts["provider"] as "anthropic" | "openai" }
        );
        const match = judgeResult.verdict === goldVerdict;
        if (match) agreements++;
        results.push({ id: c.id, gold: goldVerdict, predicted: judgeResult.verdict, match });
      }

      const kappa = cohenKappa(results.map(r => r.gold), results.map(r => r.predicted));
      const agreement = agreements / goldCases.length;

      if (opts["json"]) {
        console.log(JSON.stringify({ agreement, kappa, results }, null, 2));
      } else {
        console.log(`\n\x1b[1mCalibration results for ${opts["model"]}\x1b[0m`);
        console.log(`  Agreement:     ${(agreement * 100).toFixed(1)}% (${agreements}/${goldCases.length})`);
        console.log(`  Cohen's Kappa: ${kappa.toFixed(3)} ${kappaLabel(kappa)}`);
        for (const r of results.filter(r => !r.match)) {
          console.log(`  \x1b[31m✗ ${r.id}: expected ${r.gold}, got ${r.predicted}\x1b[0m`);
        }
        console.log();
      }
    });
}

function cohenKappa(gold: Verdict[], predicted: Verdict[]): number {
  const n = gold.length;
  if (n === 0) return 0;
  const observed = gold.filter((g, i) => g === predicted[i]).length / n;
  const verdicts: Verdict[] = ["PASS", "FAIL", "UNKNOWN"];
  let expected = 0;
  for (const v of verdicts) {
    const pg = gold.filter(g => g === v).length / n;
    const pp = predicted.filter(p => p === v).length / n;
    expected += pg * pp;
  }
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

function kappaLabel(k: number): string {
  if (k >= 0.8) return "\x1b[32m(almost perfect)\x1b[0m";
  if (k >= 0.6) return "\x1b[32m(substantial)\x1b[0m";
  if (k >= 0.4) return "\x1b[33m(moderate)\x1b[0m";
  if (k >= 0.2) return "\x1b[33m(fair)\x1b[0m";
  return "\x1b[31m(slight — judge may not be reliable)\x1b[0m";
}
