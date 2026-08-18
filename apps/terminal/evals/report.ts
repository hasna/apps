#!/usr/bin/env bun
// Generate comparison report from all eval results

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface Summary {
  provider: string;
  model: string;
  totalPairs: number;
  exactMatch: number;
  exactMatchPct: number;
  fuzzyMatch: number;
  fuzzyMatchPct: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgScore: number;
  errors: number;
  byDifficulty: Record<number, { total: number; exact: number; fuzzy: number; exactPct: number; fuzzyPct: number }>;
}

// Provider pricing per million tokens (input)
const PRICING: Record<string, number> = {
  cerebras: 0.60,
  groq: 0.15,
};

// Estimated tokens per call (system prompt + NL input + output)
const EST_TOKENS_PER_CALL = 350; // ~250 input + ~50 output + overhead

function main() {
  const resultsDir = join(import.meta.dir, "results");
  const files = readdirSync(resultsDir).filter(f => f.endsWith(".json"));

  const summaries: (Summary & { costPer1000Calls: number; costPerCorrectAnswer: number })[] = [];

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(resultsDir, file), "utf8"));
    const s: Summary = data.summary;

    const pricePerM = PRICING[s.provider] ?? 0.60;
    const costPer1000Calls = (EST_TOKENS_PER_CALL * 1000 * pricePerM) / 1_000_000;
    const correctRate = s.fuzzyMatchPct / 100;
    const costPerCorrectAnswer = correctRate > 0 ? (costPer1000Calls / 1000) / correctRate : Infinity;

    summaries.push({ ...s, costPer1000Calls, costPerCorrectAnswer });
  }

  // Sort by fuzzy match descending
  summaries.sort((a, b) => b.fuzzyMatchPct - a.fuzzyMatchPct);

  // Markdown report
  const lines: string[] = [];
  lines.push("# NL→Bash Model Evaluation Report");
  lines.push(`\nBenchmark: NL2SH-ALFA (100 pairs, difficulty 0 / easy)`);
  lines.push(`Date: ${new Date().toISOString().split("T")[0]}`);
  lines.push(`System prompt: minimal (1 sentence, command-only instruction)`);
  lines.push(`Temperature: 0, Stop: [\\n]`);
  lines.push("");

  // Main comparison table
  lines.push("## Results");
  lines.push("");
  lines.push("| Provider | Model | Exact % | Fuzzy % | Avg Latency | P50 | P95 | Cost/1K calls | Cost/correct |");
  lines.push("|----------|-------|---------|---------|-------------|-----|-----|---------------|-------------|");

  for (const s of summaries) {
    const model = s.model.length > 25 ? s.model.slice(0, 25) + "…" : s.model;
    lines.push(
      `| ${s.provider} | ${model} | **${s.exactMatchPct}%** | **${s.fuzzyMatchPct}%** | ${s.avgLatencyMs}ms | ${s.p50LatencyMs}ms | ${s.p95LatencyMs}ms | $${s.costPer1000Calls.toFixed(4)} | $${s.costPerCorrectAnswer < 1 ? s.costPerCorrectAnswer.toFixed(6) : "∞"} |`
    );
  }

  lines.push("");
  lines.push("## Analysis");
  lines.push("");

  // Best accuracy
  const bestAccuracy = summaries[0];
  lines.push(`### Best accuracy: ${bestAccuracy.provider}/${bestAccuracy.model}`);
  lines.push(`- ${bestAccuracy.exactMatchPct}% exact match, ${bestAccuracy.fuzzyMatchPct}% fuzzy`);
  lines.push(`- Avg latency: ${bestAccuracy.avgLatencyMs}ms`);
  lines.push("");

  // Best latency (excluding 0% models)
  const viable = summaries.filter(s => s.fuzzyMatchPct > 0);
  const bestLatency = viable.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];
  if (bestLatency) {
    lines.push(`### Fastest (viable): ${bestLatency.provider}/${bestLatency.model}`);
    lines.push(`- ${bestLatency.avgLatencyMs}ms avg, ${bestLatency.exactMatchPct}% exact`);
    lines.push("");
  }

  // Best cost efficiency
  const bestCost = viable.sort((a, b) => a.costPerCorrectAnswer - b.costPerCorrectAnswer)[0];
  if (bestCost) {
    lines.push(`### Most cost-efficient: ${bestCost.provider}/${bestCost.model}`);
    lines.push(`- $${bestCost.costPerCorrectAnswer.toFixed(6)}/correct answer`);
    lines.push(`- $${bestCost.costPer1000Calls.toFixed(4)}/1000 calls`);
    lines.push("");
  }

  // Notes
  lines.push("## Notes");
  lines.push("");
  lines.push("- **qwen3-32b (Groq)**: 0% — outputs `<think>` reasoning tags, stop:[\\n] cuts before command. Needs `thinking_mode=disabled` or different prompting.");
  lines.push("- **gpt-oss-20b (Groq)**: Many empty responses — model sometimes returns nothing with stop:[\\n].");
  lines.push("- **Exact match** = normalized string equality. **Fuzzy match** = same binary + args + flags (order-independent).");
  lines.push("- All tests used difficulty=0 (easy) pairs. Medium and hard pairs would show larger gaps.");
  lines.push("- Cost assumes ~350 tokens/call. Actual cost depends on system prompt size (terminal sends ~1200 tokens).");

  // Recommendation
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push("| Use Case | Best Model | Why |");
  lines.push("|----------|-----------|-----|");
  lines.push("| **Best accuracy** | Cerebras qwen-3-235b | 66% exact, free tier |");
  lines.push("| **Best speed** | Groq llama-3.1-8b-instant | 92ms avg, 52% exact |");
  lines.push("| **Best balance** | Cerebras qwen-3-235b | Highest accuracy at acceptable latency |");
  lines.push("| **Cheapest per correct** | Groq llama-3.1-8b-instant | $0.15/M tokens × good accuracy |");

  const markdown = lines.join("\n");

  // Write files
  writeFileSync(join(import.meta.dir, "REPORT.md"), markdown);
  writeFileSync(join(import.meta.dir, "results", "comparison.json"), JSON.stringify(summaries, null, 2));

  console.log(markdown);
  console.log("\n\nSaved to: evals/REPORT.md + evals/results/comparison.json");
}

main();
