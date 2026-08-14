#!/usr/bin/env bun
// Eval harness — run NL→bash benchmark against any OpenAI-compatible provider

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { score } from "./scoring.ts";

interface TestPair {
  nl: string;
  expected: string;
  alt: string;
  difficulty: number;
}

interface EvalResult {
  nl: string;
  expected: string;
  alt: string;
  predicted: string;
  exact: boolean;
  fuzzy: boolean;
  semantic: boolean;
  score: number;
  latencyMs: number;
  difficulty: number;
  error?: string;
}

interface EvalSummary {
  provider: string;
  model: string;
  totalPairs: number;
  exactMatch: number;
  exactMatchPct: number;
  fuzzyMatch: number;
  fuzzyMatchPct: number;
  semanticMatch: number;
  semanticMatchPct: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgScore: number;
  byDifficulty: Record<number, { total: number; exact: number; fuzzy: number; semantic: number; exactPct: number; fuzzyPct: number; semanticPct: number }>;
  errors: number;
  timestamp: string;
}

import { PROMPTS } from "./prompts.ts";

// Select prompt based on --prompt flag
let SYSTEM_PROMPT = PROMPTS.minimal;

async function callModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  nl: string,
): Promise<{ text: string; latencyMs: number }> {
  const start = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      temperature: 0,
      stop: ["\n"],
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: nl },
      ],
    }),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as any;
  let text = (json.choices?.[0]?.message?.content ?? "").trim();
  // Strip markdown code blocks if model ignores instructions
  text = text.replace(/```(?:bash|sh|shell)?\n?/g, "").replace(/```/g, "").trim();
  // Try to extract from JSON format (for json_extract prompt)
  try {
    const parsed = JSON.parse(text);
    if (parsed.cmd) text = parsed.cmd;
  } catch {}
  // Take first line only
  text = text.split("\n")[0]?.trim() ?? text;

  return { text, latencyMs };
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runEval(config: {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  limit: number;
  delayMs: number;
}): Promise<{ results: EvalResult[]; summary: EvalSummary }> {
  const dataPath = join(import.meta.dir, "data", "nl2sh-alfa-test.json");
  const pairs: TestPair[] = JSON.parse(readFileSync(dataPath, "utf8"));
  const subset = pairs.slice(0, config.limit);

  console.log(`\n🔬 Eval: ${config.provider}/${config.model} (${subset.length} pairs)\n`);

  const results: EvalResult[] = [];

  for (let i = 0; i < subset.length; i++) {
    const pair = subset[i];
    process.stdout.write(`  [${i + 1}/${subset.length}] `);

    try {
      const { text, latencyMs } = await callModel(config.baseUrl, config.apiKey, config.model, pair.nl);
      const s = score(text, pair.expected, pair.alt || undefined);

      results.push({
        nl: pair.nl,
        expected: pair.expected,
        alt: pair.alt,
        predicted: text,
        exact: s.exact,
        fuzzy: s.fuzzy,
        semantic: s.semantic,
        score: s.score,
        latencyMs,
        difficulty: pair.difficulty,
      });

      const icon = s.exact ? "✓" : s.fuzzy ? "~" : s.semantic ? "≈" : "✗";
      console.log(`${icon} ${latencyMs}ms | "${pair.nl}" → "${text}"`);
    } catch (err: any) {
      results.push({
        nl: pair.nl,
        expected: pair.expected,
        alt: pair.alt,
        predicted: "",
        exact: false,
        fuzzy: false,
        semantic: false,
        score: 0,
        latencyMs: 0,
        difficulty: pair.difficulty,
        error: err.message,
      });
      console.log(`✗ ERROR: ${err.message.slice(0, 100)}`);
    }

    // Rate limit delay
    if (config.delayMs > 0 && i < subset.length - 1) {
      await new Promise(r => setTimeout(r, config.delayMs));
    }
  }

  // Compute summary
  const latencies = results.filter(r => !r.error).map(r => r.latencyMs);
  const exactCount = results.filter(r => r.exact).length;
  const fuzzyCount = results.filter(r => r.fuzzy).length;
  const semanticCount = results.filter(r => r.semantic).length;

  const byDifficulty: EvalSummary["byDifficulty"] = {};
  for (const d of [0, 1, 2]) {
    const dResults = results.filter(r => r.difficulty === d);
    if (dResults.length === 0) continue;
    byDifficulty[d] = {
      total: dResults.length,
      exact: dResults.filter(r => r.exact).length,
      fuzzy: dResults.filter(r => r.fuzzy).length,
      semantic: dResults.filter(r => r.semantic).length,
      exactPct: Math.round((dResults.filter(r => r.exact).length / dResults.length) * 100),
      fuzzyPct: Math.round((dResults.filter(r => r.fuzzy).length / dResults.length) * 100),
      semanticPct: Math.round((dResults.filter(r => r.semantic).length / dResults.length) * 100),
    };
  }

  const summary: EvalSummary = {
    provider: config.provider,
    model: config.model,
    totalPairs: results.length,
    exactMatch: exactCount,
    exactMatchPct: Math.round((exactCount / results.length) * 100),
    fuzzyMatch: fuzzyCount,
    fuzzyMatchPct: Math.round((fuzzyCount / results.length) * 100),
    semanticMatch: semanticCount,
    semanticMatchPct: Math.round((semanticCount / results.length) * 100),
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    avgScore: Math.round((results.reduce((a, r) => a + r.score, 0) / results.length) * 100) / 100,
    byDifficulty,
    errors: results.filter(r => r.error).length,
    timestamp: new Date().toISOString(),
  };

  return { results, summary };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const PROVIDERS: Record<string, { baseUrl: string; envVar: string; models: string[] }> = {
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    envVar: "CEREBRAS_API_KEY",
    models: ["qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"],
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    envVar: "GROQ_API_KEY",
    models: ["openai/gpt-oss-20b", "qwen/qwen3-32b", "llama-3.1-8b-instant"],
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano"],
  },
};

async function main() {
  const args = process.argv.slice(2);
  const provider = args.find(a => a.startsWith("--provider="))?.split("=")[1];
  const model = args.find(a => a.startsWith("--model="))?.split("=")[1];
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "100");
  const delayMs = parseInt(args.find(a => a.startsWith("--delay="))?.split("=")[1] ?? "200");
  const promptMode = args.find(a => a.startsWith("--prompt="))?.split("=")[1] ?? "minimal";

  if (PROMPTS[promptMode]) {
    SYSTEM_PROMPT = PROMPTS[promptMode];
    console.log(`Using prompt: ${promptMode} (${SYSTEM_PROMPT.length} chars)`);
  } else {
    console.error(`Unknown prompt: ${promptMode}. Available: ${Object.keys(PROMPTS).join(", ")}`);
    process.exit(1);
  }

  if (!provider || !model) {
    console.log("Usage: bun evals/run-eval.ts --provider=cerebras --model=llama3.1-8b [--limit=100] [--delay=200] [--prompt=full|minimal]");
    console.log("\nAvailable:");
    for (const [p, cfg] of Object.entries(PROVIDERS)) {
      for (const m of cfg.models) {
        console.log(`  --provider=${p} --model=${m}`);
      }
    }
    process.exit(1);
  }

  const providerCfg = PROVIDERS[provider];
  if (!providerCfg) {
    console.error(`Unknown provider: ${provider}`);
    process.exit(1);
  }

  const apiKey = process.env[providerCfg.envVar];
  if (!apiKey) {
    console.error(`${providerCfg.envVar} not set. Source ~/.secrets first.`);
    process.exit(1);
  }

  const { results, summary } = await runEval({
    provider,
    baseUrl: providerCfg.baseUrl,
    apiKey,
    model,
    limit,
    delayMs,
  });

  // Save results
  const resultsDir = join(import.meta.dir, "results");
  mkdirSync(resultsDir, { recursive: true });
  const filename = `${provider}-${model.replace(/\//g, "-")}${promptMode === "full" ? "-full" : ""}.json`;
  writeFileSync(join(resultsDir, filename), JSON.stringify({ summary, results }, null, 2));

  // Print summary
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 ${provider}/${model}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Total:       ${summary.totalPairs} pairs`);
  console.log(`  Exact match:    ${summary.exactMatch} (${summary.exactMatchPct}%)`);
  console.log(`  Fuzzy match:    ${summary.fuzzyMatch} (${summary.fuzzyMatchPct}%)`);
  console.log(`  Semantic match: ${summary.semanticMatch} (${summary.semanticMatchPct}%)`);
  console.log(`  Avg score:      ${summary.avgScore}`);
  console.log(`  Latency:        avg ${summary.avgLatencyMs}ms | p50 ${summary.p50LatencyMs}ms | p95 ${summary.p95LatencyMs}ms`);
  console.log(`  Errors:         ${summary.errors}`);
  console.log(`\n  By difficulty:`);
  for (const [d, stats] of Object.entries(summary.byDifficulty)) {
    const label = d === "0" ? "Easy" : d === "1" ? "Medium" : "Hard";
    console.log(`    ${label.padEnd(8)} exact ${stats.exactPct}% | fuzzy ${stats.fuzzyPct}% | semantic ${stats.semanticPct}% (${stats.total} pairs)`);
  }
  console.log(`\n  Saved to: evals/results/${filename}`);
}

main().catch(console.error);
