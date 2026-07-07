import type { Command } from "commander";
import chalk from "chalk";
import {
  evaluateOssSecretPolicy,
  type OssSecretPolicyRepo,
} from "../../lib/oss-secret-policy.js";

type OutputFormat = "terminal" | "json";

function parseOutputFormat(value: string): OutputFormat {
  const normalized = value.toLowerCase();
  if (normalized === "terminal" || normalized === "json") return normalized;
  throw new Error(`Invalid --format '${value}'. Allowed values: terminal, json`);
}

function printRepo(repo: OssSecretPolicyRepo): void {
  const status = repo.violations.length === 0 ? chalk.green("ok") : chalk.red("needs work");
  console.log(`\n  ${chalk.bold(repo.package_name)} ${chalk.gray(`(${repo.relative_path})`)} ${status}`);
  console.log(chalk.gray(`    canonical: ${repo.canonical ? "yes" : "no"} - ${repo.canonical_reason}`));
  console.log(chalk.gray(`    check:secrets: ${repo.gate.has_check_secrets ? "yes" : "no"}`));
  console.log(chalk.gray(`    prepublish: ${repo.gate.prepublish_runs_secrets ? "yes" : "no"}; release: ${repo.gate.release_runs_secrets ? "yes" : "no"}; ci: ${repo.gate.ci_runs_secrets ? "yes" : "no"}`));

  if (repo.counts.vendored_or_upstream_findings > 0) {
    console.log(chalk.gray(`    vendored/upstream fixture findings: ${repo.counts.vendored_or_upstream_findings}`));
  }
  if (repo.counts.allowed_fixture_findings > 0) {
    console.log(chalk.gray(`    allowlisted fixture findings: ${repo.counts.allowed_fixture_findings}`));
  }
  for (const violation of repo.violations) {
    console.log(chalk.red(`    - ${violation}`));
  }
  if (repo.files.unsuppressed_secret_findings.length > 0) {
    console.log(chalk.yellow(`    unsuppressed files: ${repo.files.unsuppressed_secret_findings.join(", ")}`));
  }
  if (repo.files.private_path_or_hostname.length > 0) {
    console.log(chalk.yellow(`    private path/hostname files: ${repo.files.private_path_or_hostname.join(", ")}`));
  }
}

export function registerOssSecretPolicyCommand(program: Command): void {
  program
    .command("oss-secrets-policy")
    .description("Evaluate publishable OSS repos for secret-scan gates, fixture policy, and private path hygiene")
    .argument("[roots...]", "Repo or workspace roots to inspect", ["."])
    .option("--format <format>", "Output format (terminal/json)", "terminal")
    .option("-j, --json", "Shortcut for --format json")
    .option("--strict", "Exit non-zero when any policy violation is found")
    .option("--include-noncanonical", "Include stale, duplicate, and task worktree checkouts in the inventory")
    .option("--max-file-bytes <bytes>", "Maximum text file size to scan", "524288")
    .action((roots: string[], options) => {
      try {
        const format = options.json ? "json" : parseOutputFormat(options.format);
        const result = evaluateOssSecretPolicy({
          roots,
          includeNoncanonical: Boolean(options.includeNoncanonical),
          maxFileBytes: Number.parseInt(options.maxFileBytes, 10),
        });

        if (format === "json") {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.bold("\n  Publishable OSS Secret-Scan Policy\n"));
          console.log(chalk.gray(`  Repos: ${result.summary.publishable_repos} canonical=${result.summary.canonical_repos} noncanonical=${result.summary.noncanonical_repos}`));
          console.log(chalk.gray(`  Violations: ${result.summary.violations}`));
          console.log(chalk.gray(`  Missing check:secrets: ${result.summary.missing_check_secrets}`));
          console.log(chalk.gray(`  Missing CI/release gate: ${result.summary.missing_ci_or_release_gate}`));
          console.log(chalk.gray(`  Unsuppressed secret-shaped repos: ${result.summary.unsuppressed_secret_repos}`));
          console.log(chalk.gray(`  Private path/hostname repos: ${result.summary.private_path_or_hostname_repos}`));

          for (const repo of result.repos) {
            if (repo.violations.length > 0 || repo.counts.vendored_or_upstream_findings > 0 || repo.counts.allowed_fixture_findings > 0) {
              printRepo(repo);
            }
          }
          console.log();
        }

        if (options.strict && result.summary.violations > 0) {
          process.exit(1);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n  OSS secret policy check failed: ${errMsg}\n`));
        process.exit(1);
      }
    });
}
