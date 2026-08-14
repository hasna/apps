import { Command } from "commander";
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "fs";
import type { EvalCase } from "../../types/index.js";

const GENERATE_SYSTEM = `You are an AI eval case generator. Given a description and optional seed examples, generate diverse eval test cases in JSONL format.

Each case must be a valid JSON object on a single line with these fields:
- id: unique string (e.g. "gen-001")
- input: the user input to test
- expected: natural language description of expected behavior
- judge: { rubric: "..." } — plain English grading criteria
- tags: array of relevant tag strings

Generate varied cases that cover edge cases, typical usage, and boundary conditions.
Output ONLY valid JSONL — one JSON object per line, no markdown, no explanation.`;

export function generateCommand(): Command {
  return new Command("generate")
    .description("Generate eval cases from a description using Claude")
    .requiredOption("--description <text>", "What behavior to test (e.g. 'refund policy responses')")
    .option("--seeds <path>", "Path to JSONL file with seed examples")
    .option("--count <n>", "Number of cases to generate", "10")
    .option("--output <path>", "Output JSONL file path", "generated.jsonl")
    .option("--model <model>", "Model to use for generation", "claude-sonnet-4-6")
    .option("-j, --json", "Output JSON summary")
    .action(async (opts: Record<string, string>) => {
      const client = new Anthropic();
      const count = parseInt(opts["count"] ?? "10");

      let seedText = "";
      if (opts["seeds"]) {
        seedText = `\n\nSeed examples:\n${await Bun.file(opts["seeds"]).text()}`;
      }

      const prompt = `Generate ${count} eval cases for: ${opts["description"]}${seedText}\n\nOutput ${count} JSONL lines starting with {"id":"gen-001",...}`;

      console.log(`Generating ${count} eval cases...`);
      const response = await client.messages.create({
        model: opts["model"] ?? "claude-sonnet-4-6",
        max_tokens: 4096,
        temperature: 1, // some creativity for diversity
        system: GENERATE_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const lines = text.split("\n").filter((l) => l.trim().startsWith("{"));
      const valid: EvalCase[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as EvalCase;
          if (parsed.id && (parsed.input || parsed.turns)) valid.push(parsed);
        } catch { /* skip malformed */ }
      }

      const outputPath = opts["output"] ?? "generated.jsonl";
      const output = valid.map((c) => JSON.stringify(c)).join("\n");
      writeFileSync(outputPath, output + "\n");

      if ((opts as unknown as Record<string, unknown>)["json"]) {
        console.log(JSON.stringify({
          generated: valid.length,
          requested: count,
          output: outputPath,
          model: opts["model"] ?? "claude-sonnet-4-6",
          description: opts["description"] ?? "",
        }, null, 2));
        return;
      }

      console.log(`\x1b[32m✓ Generated ${valid.length} cases → ${outputPath}\x1b[0m`);
    });
}
