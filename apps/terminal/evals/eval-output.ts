#!/usr/bin/env bun
// Eval for output processing quality — tests processOutput() on real terminal outputs
// Measures: token savings, information preservation, latency

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

interface OutputSample {
  command: string;
  output: string;
  output_lines: number;
}

interface OutputEvalResult {
  command: string;
  outputLines: number;
  outputTokens: number;
  summaryTokens: number;
  tokensSaved: number;
  savingsPct: number;
  latencyMs: number;
  aiProcessed: boolean;
  summary: string;
  // Quality checks
  hasErrors: boolean;       // output contained errors
  summaryMentionsError: boolean;  // summary preserved error info
  hasNumbers: boolean;      // output contained numeric results
  summaryHasNumbers: boolean;     // summary preserved numbers
}

// Rough token estimate
function estimateTokens(text: string): number {
  const structural = (text.match(/[{}[\]();:=<>,"'`|&\\/@#$%^*+~!?]/g) || []).length;
  const ratio = structural / Math.max(text.length, 1);
  const charsPerToken = ratio > 0.08 ? 3.3 : 4.2;
  return Math.ceil(text.length / charsPerToken);
}

// Call processOutput via the AI provider directly
async function summarizeViaAI(
  command: string,
  output: string,
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<{ summary: string; latencyMs: number }> {
  const systemPrompt = `You are an intelligent terminal assistant. Given a command and its output, provide a concise summary.

RULES:
- If the output contains errors, ALWAYS include the error message
- If the output has counts/numbers, include the key numbers
- If the output shows file lists, summarize count + key files
- Use symbols: ✓ for success, ✗ for failure, ⚠ for warnings
- Maximum 8 lines
- Keep errors/failures verbatim
- For test output: show pass/fail counts
- For build output: success or error details
- For search results: match count + top matches
- Be direct and concise`;

  const start = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Command: ${command}\nOutput (${output.split("\n").length} lines):\n${output.slice(0, 6000)}` },
      ],
    }),
  });

  const latencyMs = Date.now() - start;
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = (await res.json()) as any;
  const summary = (json.choices?.[0]?.message?.content ?? "").trim();
  return { summary, latencyMs };
}

async function main() {
  const args = process.argv.slice(2);
  const provider = args.find(a => a.startsWith("--provider="))?.split("=")[1] ?? "cerebras";
  const model = args.find(a => a.startsWith("--model="))?.split("=")[1] ?? "qwen-3-235b-a22b-instruct-2507";
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "50");

  const PROVIDERS: Record<string, { baseUrl: string; envVar: string }> = {
    cerebras: { baseUrl: "https://api.cerebras.ai/v1", envVar: "CEREBRAS_API_KEY" },
    groq: { baseUrl: "https://api.groq.com/openai/v1", envVar: "GROQ_API_KEY" },
    openai: { baseUrl: "https://api.openai.com/v1", envVar: "OPENAI_API_KEY" },
  };

  const providerCfg = PROVIDERS[provider];
  if (!providerCfg) { console.error(`Unknown provider: ${provider}`); process.exit(1); }
  const apiKey = process.env[providerCfg.envVar];
  if (!apiKey) { console.error(`${providerCfg.envVar} not set`); process.exit(1); }

  const samples: OutputSample[] = JSON.parse(
    readFileSync(join(import.meta.dir, "data", "real-outputs.json"), "utf8")
  ).slice(0, limit);

  console.log(`\n🔬 Output Processing Eval: ${provider}/${model} (${samples.length} samples)\n`);

  const results: OutputEvalResult[] = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    process.stdout.write(`  [${i + 1}/${samples.length}] ${s.command.slice(0, 40).padEnd(40)} `);

    try {
      const { summary, latencyMs } = await summarizeViaAI(
        s.command, s.output, providerCfg.baseUrl, apiKey, model
      );

      const outputTokens = estimateTokens(s.output);
      const summaryTokens = estimateTokens(summary);
      const saved = Math.max(0, outputTokens - summaryTokens);

      // Quality checks
      const hasErrors = /error|Error|ERROR|fail|FAIL|exception|panic|fatal/i.test(s.output);
      const summaryMentionsError = hasErrors ? /error|fail|✗|⚠|exception|panic|fatal/i.test(summary) : true;
      const numberPattern = /\b\d{2,}\b/g;
      const hasNumbers = numberPattern.test(s.output);
      const summaryHasNumbers = hasNumbers ? /\b\d+\b/.test(summary) : true;

      results.push({
        command: s.command,
        outputLines: s.output_lines,
        outputTokens,
        summaryTokens,
        tokensSaved: saved,
        savingsPct: outputTokens > 0 ? Math.round((saved / outputTokens) * 100) : 0,
        latencyMs,
        aiProcessed: true,
        summary,
        hasErrors,
        summaryMentionsError,
        hasNumbers,
        summaryHasNumbers,
      });

      console.log(`${saved > 0 ? "✓" : "–"} ${latencyMs}ms | ${outputTokens}→${summaryTokens} tokens (${Math.round((saved / Math.max(outputTokens, 1)) * 100)}% saved)`);
    } catch (err: any) {
      console.log(`✗ ERROR: ${err.message.slice(0, 80)}`);
      results.push({
        command: s.command, outputLines: s.output_lines, outputTokens: 0, summaryTokens: 0,
        tokensSaved: 0, savingsPct: 0, latencyMs: 0, aiProcessed: false, summary: "",
        hasErrors: false, summaryMentionsError: true, hasNumbers: false, summaryHasNumbers: true,
      });
    }

    if (i < samples.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  // Summary
  const processed = results.filter(r => r.aiProcessed);
  const totalOutputTokens = processed.reduce((a, r) => a + r.outputTokens, 0);
  const totalSummaryTokens = processed.reduce((a, r) => a + r.summaryTokens, 0);
  const totalSaved = totalOutputTokens - totalSummaryTokens;
  const avgSavingsPct = Math.round((totalSaved / Math.max(totalOutputTokens, 1)) * 100);
  const avgLatency = Math.round(processed.reduce((a, r) => a + r.latencyMs, 0) / processed.length);
  const errorPreservation = processed.filter(r => r.summaryMentionsError).length / processed.length;
  const numberPreservation = processed.filter(r => r.summaryHasNumbers).length / processed.length;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 Output Processing: ${provider}/${model}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Samples:            ${processed.length}`);
  console.log(`  Token savings:      ${totalSaved} / ${totalOutputTokens} (${avgSavingsPct}%)`);
  console.log(`  Avg compression:    ${totalOutputTokens / processed.length | 0} → ${totalSummaryTokens / processed.length | 0} tokens`);
  console.log(`  Avg latency:        ${avgLatency}ms`);
  console.log(`  Error preservation: ${Math.round(errorPreservation * 100)}%`);
  console.log(`  Number preservation: ${Math.round(numberPreservation * 100)}%`);
  console.log(`  Quality score:      ${Math.round(((errorPreservation + numberPreservation) / 2) * 100)}%`);

  // Save
  const resultsDir = join(import.meta.dir, "results");
  mkdirSync(resultsDir, { recursive: true });
  const filename = `output-${provider}-${model.replace(/\//g, "-")}.json`;
  writeFileSync(join(resultsDir, filename), JSON.stringify({
    summary: { provider, model, samples: processed.length, avgSavingsPct, avgLatency, errorPreservation, numberPreservation },
    results,
  }, null, 2));
  console.log(`  Saved to: evals/results/${filename}`);
}

main().catch(console.error);
