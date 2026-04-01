import type { Command } from "commander";
import { execSync } from "child_process";
import chalk from "chalk";
import { ScannerType, ReportFormat, type Finding } from "../../types/index.js";
import { runScanner } from "../../scanners/index.js";
import { getReporter } from "../../reporters/index.js";
import { loadConfig } from "../../lib/index.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description("Security review staged git changes")
    .action(async () => {
      let diff: string;
      try {
        diff = execSync("git diff --staged", { encoding: "utf-8" });
      } catch {
        console.error(chalk.red("\n  Failed to get staged diff. Are you in a git repo?\n"));
        process.exit(1);
        return;
      }

      if (!diff.trim()) {
        console.log(chalk.yellow("\n  No staged changes to review.\n"));
        return;
      }

      console.log(chalk.bold("\n  Reviewing staged changes...\n"));

      const changedFiles = diff
        .split("\n")
        .filter((line) => line.startsWith("+++ b/"))
        .map((line) => line.replace("+++ b/", ""));

      if (changedFiles.length === 0) {
        console.log(chalk.green("  No files in staged diff to review.\n"));
        return;
      }

      console.log(chalk.gray(`  Checking ${changedFiles.length} changed file(s)...`));

      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const findingInputs: any[] = [];

      for (const scannerType of [ScannerType.Secrets, ScannerType.Code]) {
        try {
          const results = await runScanner(scannerType, cwd, {
            ignore_patterns: config.ignore_patterns,
          });
          const filtered = results.filter((f) =>
            changedFiles.some((cf) => f.file.endsWith(cf) || f.file === cf),
          );
          findingInputs.push(...filtered);
        } catch {}
      }

      if (findingInputs.length === 0) {
        console.log(chalk.green("\n  No security issues found in staged changes.\n"));
        return;
      }

      const tempFindings: Finding[] = findingInputs.map((input, i) => ({
        id: `review-${i}`,
        scan_id: "review",
        rule_id: input.rule_id,
        scanner_type: input.scanner_type,
        severity: input.severity,
        file: input.file,
        line: input.line,
        column: input.column ?? null,
        end_line: input.end_line ?? null,
        message: input.message,
        code_snippet: input.code_snippet ?? null,
        fingerprint: `review-${i}`,
        suppressed: false,
        suppressed_reason: null,
        llm_explanation: null,
        llm_fix: null,
        llm_exploitability: null,
        created_at: new Date().toISOString(),
      }));

      const reporter = getReporter(ReportFormat.Terminal);
      reporter.report(tempFindings);
    });
}
