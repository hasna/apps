import type { Command } from "commander";
import chalk from "chalk";
import { getDb, getFinding } from "../../db/index.js";
import {
  isLLMAvailable,
  explainFinding as llmExplainFinding,
  suggestFix as llmSuggestFix,
} from "../../llm/index.js";
import { getCodeContext } from "../helpers.js";

export function registerLLMCommands(program: Command): void {
  // explain <id>
  program
    .command("explain")
    .description("Get AI explanation for a finding")
    .argument("<id>", "Finding ID")
    .action(async (id: string) => {
      if (!isLLMAvailable()) {
        console.error(chalk.red("\n  CEREBRAS_API_KEY is not set. LLM features are unavailable.\n"));
        process.exit(1);
      }

      getDb();
      const finding = getFinding(id);
      if (!finding) {
        console.error(chalk.red(`\n  Finding not found: ${id}\n`));
        process.exit(1);
      }

      if (finding.llm_explanation) {
        console.log(chalk.bold("\n  Explanation (cached):\n"));
        console.log(`  ${finding.llm_explanation}\n`);
        return;
      }

      const codeContext = getCodeContext(finding.file, finding.line);
      console.log(chalk.gray("\n  Analyzing finding with LLM...\n"));
      const explanation = await llmExplainFinding(finding, codeContext);

      if (!explanation) {
        console.error(chalk.red("  Failed to get explanation from LLM.\n"));
        process.exit(1);
      }

      console.log(chalk.bold("\n  Explanation:\n"));
      console.log(`  ${explanation}\n`);
    });

  // fix <id>
  program
    .command("fix")
    .description("Get AI-suggested fix for a finding")
    .argument("<id>", "Finding ID")
    .action(async (id: string) => {
      if (!isLLMAvailable()) {
        console.error(chalk.red("\n  CEREBRAS_API_KEY is not set. LLM features are unavailable.\n"));
        process.exit(1);
      }

      getDb();
      const finding = getFinding(id);
      if (!finding) {
        console.error(chalk.red(`\n  Finding not found: ${id}\n`));
        process.exit(1);
      }

      if (finding.llm_fix) {
        console.log(chalk.bold("\n  Suggested Fix (cached):\n"));
        console.log(finding.llm_fix);
        console.log();
        return;
      }

      const codeContext = getCodeContext(finding.file, finding.line);
      console.log(chalk.gray("\n  Generating fix with LLM...\n"));
      const fix = await llmSuggestFix(finding, codeContext);

      if (!fix) {
        console.error(chalk.red("  Failed to get fix suggestion from LLM.\n"));
        process.exit(1);
      }

      console.log(chalk.bold("\n  Suggested Fix:\n"));
      console.log(fix);
      console.log();
    });
}
