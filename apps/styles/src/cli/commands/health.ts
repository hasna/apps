import chalk from "chalk";
import { resolve } from "path";
import type { Command } from "commander";
import { formatTable, jsonOut, parsePositiveInt, severityColor, statusColor, truncateText, error } from "../../lib/format.js";
import { runHealthCheck, checkFile, getDefaultRules } from "../../lib/health.js";
import { getHealthDiff } from "../../lib/healthdiff.js";
import { createTasksFromViolations } from "../../lib/taskgen.js";
import { detectProjectPath } from "../../lib/detect.js";
import { getActiveProfile } from "../../lib/profiles.js";
import { getFixSuggestions, applyFixes } from "../../lib/fixer.js";
import { getDb } from "../../lib/db.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);
type HealthResult = Awaited<ReturnType<typeof runHealthCheck>>;
type FileViolation = HealthResult["violations"][number];

export function registerHealthCommand(program: Command) {
  program
    .command("health")
    .description("Run a health check on the project")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .option("--ai", "Use Cerebras AI for deeper analysis")
    .option("--watch", "Re-run on file changes")
    .option("--create-tasks", "Auto-create todos tasks for violations")
    .option("--since-last", "Only scan files modified since the last health check run")
    .option("--no-cache", "Skip file cache and force full rescan")
    .option("--limit <n>", "Max violations to show in compact output")
    .option("-v, --verbose", "Show more violations in compact output")
    .option("--json", "Output full JSON")
    .action(async (opts: { project?: string; ai?: boolean; watch?: boolean; createTasks?: boolean; sinceLast?: boolean; noCache?: boolean; limit?: string; verbose?: boolean; json?: boolean }) => {
      const projectPath = resolve(opts.project ?? detectProjectPath());

      async function doCheck() {
        const result = await runHealthCheck(projectPath, { sinceLast: opts.sinceLast ?? false, noCache: opts.noCache ?? false });

        if (opts.ai) {
          const { isCerebrasAvailable, inspectProject } = await import("../../lib/inspector.js");
          if (isCerebrasAvailable()) {
            if (isTTY) console.log(chalk.dim("Running AI inspection..."));
            const aiResults = await inspectProject(projectPath);
            for (const r of aiResults) {
              for (const v of r.violations) {
                result.violations.push({
                  filePath: r.filePath,
                  rule: v.rule,
                  message: v.message,
                  severity: v.severity,
                  line: v.line,
                });
              }
            }
          } else if (isTTY) {
            console.log(chalk.yellow("CEREBRAS_API_KEY not set — skipping AI inspection"));
          }
        }

        if (opts.createTasks) {
          const tasks = await createTasksFromViolations(result.violations, projectPath);
          if (isTTY && tasks.length > 0) {
            console.log(chalk.dim(`\nCreated ${tasks.length} task(s) for violations`));
          }
        }

        if (opts.json) {
          jsonOut(result);
          return;
        }

        if (!isTTY) {
          writeHealthSummary(result, projectPath, opts);
          return;
        }

        console.log();
        console.log(
          `${chalk.bold("Health Check")}  ${statusColor(result.status)}  Score: ${chalk.bold(String(result.score))}/100`
        );
        console.log(chalk.dim(`Files scanned: ${result.filesScanned}`));
        console.log(chalk.dim(`Violations: ${result.violations.length}`));
        console.log();

        if (result.violations.length === 0) {
          console.log(chalk.green("✔ No violations found!"));
          return;
        }

        const bySeverity = new Map<string, typeof result.violations>();
        for (const v of result.violations) {
          const existing = bySeverity.get(v.severity) ?? [];
          existing.push(v);
          bySeverity.set(v.severity, existing);
        }

        for (const severity of ["critical", "warning", "info"]) {
          const viols = bySeverity.get(severity);
          if (!viols?.length) continue;
          console.log(`${severityColor(severity).toUpperCase()} (${viols.length}):`);
          for (const v of viols.slice(0, 10)) {
            const relPath = v.filePath.replace(projectPath + "/", "");
            console.log(`  ${chalk.dim(relPath)} — ${chalk.dim(v.rule)}`);
            console.log(`    ${v.message}`);
          }
          if (viols.length > 10) {
            console.log(chalk.dim(`  ... and ${viols.length - 10} more`));
          }
          console.log();
        }
      }

      await doCheck();

      if (opts.watch) {
        if (isTTY) console.log(chalk.dim("\nWatching for changes... (Ctrl-C to stop)"));
        setInterval(async () => {
          if (isTTY) console.log(chalk.dim("\n--- Re-running health check ---"));
          await doCheck();
        }, 10_000);
      }
    });

  program
    .command("check-file <file>")
    .description("Check a single file for style violations")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .option("-q, --quiet", "Only exit code (0=pass, 1=violations)")
    .option("--limit <n>", "Max violations to show in compact output")
    .option("--json", "Output full JSON")
    .action(async (file: string, opts: { project?: string; quiet?: boolean; limit?: string; json?: boolean }) => {
      const projectPath = resolve(opts.project ?? process.cwd());
      const filePath = resolve(file);

      const profile = getActiveProfile(projectPath);
      const rules = getDefaultRules(profile);
      const violations = checkFile(filePath, rules);

      if (opts.quiet) {
        process.exit(violations.length > 0 ? 1 : 0);
      }

      if (opts.json) {
        jsonOut({ filePath, violations });
        return;
      }

      if (violations.length === 0) {
        console.log(chalk.green(`✔ ${file}: No violations`));
        return;
      }

      writeFileViolations(filePath, violations, opts.limit);
      process.exit(1);
    });

  program
    .command("score")
    .description("Show the latest health check score for a project")
    .option("-p, --project <path>", "Project path (default: auto-detect)")
    .option("--json", "Output JSON")
    .action((opts: { project?: string; json?: boolean }) => {
      const projectPath = resolve(opts.project ?? detectProjectPath());
      const db = getDb();

      const lastCheck = db
        .prepare(
          `SELECT score, status, run_at, json_array_length(violations) as violation_count
           FROM health_checks
           WHERE project_path = ?
           ORDER BY run_at DESC
           LIMIT 1`
        )
        .get(projectPath) as {
        score: number;
        status: string;
        run_at: number;
        violation_count: number;
      } | null;

      if (!lastCheck) {
        const msg = { score: null, status: "unknown", message: "No health check run yet. Run: styles health" };
        if (opts.json) { jsonOut(msg); return; }
        console.log(chalk.dim("No health check run yet."));
        console.log(chalk.dim("Run: styles health"));
        return;
      }

      const result = {
        score: lastCheck.score,
        status: lastCheck.status,
        violations: lastCheck.violation_count,
        lastRun: require("../../lib/format.js").formatAgo(lastCheck.run_at),
        projectPath,
      };

      if (opts.json) { jsonOut(result); return; }
      console.log();
      console.log(`Score: ${chalk.bold(String(lastCheck.score))}/100  ${statusColor(lastCheck.status)}`);
      console.log(chalk.dim(`Violations: ${lastCheck.violation_count}`));
      console.log(chalk.dim(`Last run: ${result.lastRun}`));
      console.log(chalk.dim(`Project: ${projectPath}`));
      console.log();
    });

  program
    .command("diff")
    .description("Show health score diff between the last two health check runs")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .option("--json", "Output full JSON")
    .action((opts: { project?: string; json?: boolean }) => {
      const projectPath = resolve(opts.project ?? detectProjectPath());
      const diff = getHealthDiff(projectPath);

      if (opts.json) { jsonOut(diff); return; }

      if (diff.trend === "no-data") {
        console.log(chalk.dim("No health check history found. Run `styles health` at least twice."));
        return;
      }

      const prev = diff.previous!;
      const curr = diff.current!;
      const delta = diff.delta!;

      const trendColor =
        diff.trend === "improving" ? chalk.green
          : diff.trend === "worsening" ? chalk.red
          : chalk.dim;

      console.log();
      console.log(chalk.bold("Health Diff") + "  " + trendColor(diff.trend.toUpperCase()));
      console.log();
      console.log(chalk.dim("Previous:") + " score " + chalk.bold(String(prev.score)) + "/100, " + prev.violations + " violation(s)" + chalk.dim(" (" + (require("../../lib/format.js").formatAgo(prev.runAt) ?? "") + ")"));
      console.log(chalk.dim("Current: ") + " score " + chalk.bold(String(curr.score)) + "/100, " + curr.violations + " violation(s)" + chalk.dim(" (" + (require("../../lib/format.js").formatAgo(curr.runAt) ?? "") + ")"));
      console.log();

      const scoreSign = delta.score > 0 ? "+" : "";
      const violSign = delta.violations > 0 ? "+" : "";
      console.log(chalk.dim("Score delta:     ") + trendColor(scoreSign + String(delta.score)));
      console.log(chalk.dim("Violations delta:") + " " + (delta.violations <= 0 ? chalk.green(violSign + String(delta.violations)) : chalk.red(violSign + String(delta.violations))));

      if (diff.resolved.length > 0) {
        console.log();
        console.log(chalk.green("Resolved (" + diff.resolved.length + "):"));
        for (const msg of diff.resolved.slice(0, 5)) console.log(chalk.green("  + ") + chalk.dim(msg));
        if (diff.resolved.length > 5) console.log(chalk.dim("  ... and " + (diff.resolved.length - 5) + " more"));
      }

      if (diff.introduced.length > 0) {
        console.log();
        console.log(chalk.red("Introduced (" + diff.introduced.length + "):"));
        for (const msg of diff.introduced.slice(0, 5)) console.log(chalk.red("  - ") + chalk.dim(msg));
        if (diff.introduced.length > 5) console.log(chalk.dim("  ... and " + (diff.introduced.length - 5) + " more"));
      }
      console.log();
    });

  program
    .command("fix <file>")
    .description("Show fix suggestions for style violations in a file")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .option("--apply", "Auto-apply fixable suggestions to the file")
    .option("--limit <n>", "Max fix suggestions to show")
    .option("--json", "Output full JSON")
    .action(async (file: string, opts: { project?: string; apply?: boolean; limit?: string; json?: boolean }) => {
      const projectPath = resolve(opts.project ?? process.cwd());
      const filePath = resolve(file);

      const profile = getActiveProfile(projectPath);
      const rules = getDefaultRules(profile);
      const violations = checkFile(filePath, rules);
      const fixes = getFixSuggestions(filePath, violations);
      let applied = 0;

      if (opts.apply) {
        const autoFixable = fixes.filter((f) => f.autoFixable);
        applied = applyFixes(filePath, autoFixable);
      }

      const result = { filePath, fixes, applied };

      if (opts.json) { jsonOut(result); return; }

      if (fixes.length === 0) {
        console.log(chalk.green(`✔ ${file}: No violations to fix`));
        return;
      }

      writeFixSummary(file, fixes, applied, opts.limit);
    });
}

export { registerHealthCommand as registerCheckFileCommand };

function writeHealthSummary(
  result: HealthResult,
  projectPath: string,
  opts: { limit?: string; verbose?: boolean },
): void {
  const limit = parsePositiveInt(opts.limit, opts.verbose ? 50 : 10, 100);
  process.stdout.write(`Health Check: ${result.status}  Score: ${result.score}/100\n`);
  process.stdout.write(`Project: ${projectPath}\n`);
  process.stdout.write(`Files scanned: ${result.filesScanned}\n`);
  process.stdout.write(`Violations: ${result.violations.length}\n`);

  const shown = result.violations.slice(0, limit);
  if (shown.length > 0) {
    process.stdout.write("\nTop violations\n");
    process.stdout.write(formatTable(shown, [
      { header: "Severity", value: (v) => v.severity, maxWidth: 10 },
      { header: "File", value: (v) => v.filePath.replace(projectPath + "/", ""), maxWidth: 42 },
      { header: "Rule", value: (v) => v.rule, maxWidth: 24 },
      { header: "Message", value: (v) => v.message, maxWidth: opts.verbose ? 96 : 56 },
    ]) + "\n");
    if (result.violations.length > shown.length) {
      process.stdout.write(`... and ${result.violations.length - shown.length} more. Use --limit <n>, --verbose, or --json.\n`);
    }
  }
  process.stdout.write("Use --json for full violation objects.\n");
}

function writeFileViolations(filePath: string, violations: FileViolation[], limitValue?: string): void {
  const limit = parsePositiveInt(limitValue, 10, 100);
  process.stdout.write(`${filePath}: ${violations.length} violation(s)\n`);
  const shown = violations.slice(0, limit);
  if (shown.length > 0) {
    process.stdout.write(formatTable(shown, [
      { header: "Severity", value: (v) => v.severity, maxWidth: 10 },
      { header: "Rule", value: (v) => v.rule, maxWidth: 24 },
      { header: "Message", value: (v) => v.message, maxWidth: 72 },
    ]) + "\n");
  }
  if (violations.length > shown.length) process.stdout.write(`... and ${violations.length - shown.length} more. Use --limit <n> or --json.\n`);
  process.stdout.write("Use --json for full violation objects.\n");
}

function writeFixSummary(file: string, fixes: ReturnType<typeof getFixSuggestions>, applied: number, limitValue?: string): void {
  const limit = parsePositiveInt(limitValue, 10, 100);
  process.stdout.write(`${file}: ${fixes.length} fix suggestion(s)\n`);
  if (applied > 0) process.stdout.write(`Applied: ${applied}\n`);
  const shown = fixes.slice(0, limit);
  if (shown.length > 0) {
    process.stdout.write(formatTable(shown, [
      { header: "Line", value: (f) => f.line, maxWidth: 8 },
      { header: "Rule", value: (f) => f.rule, maxWidth: 24 },
      { header: "Mode", value: (f) => f.autoFixable ? "auto" : "manual", maxWidth: 8 },
      { header: "Suggestion", value: (f) => truncateText(f.suggestion, 72), maxWidth: 72 },
    ]) + "\n");
  }
  if (fixes.length > shown.length) process.stdout.write(`... and ${fixes.length - shown.length} more. Use --limit <n> or --json.\n`);
  process.stdout.write("Use --json for full fix objects.\n");
}
