import chalk from "chalk";
import { resolve } from "path";
import type { Command } from "commander";
import { jsonOut, severityColor, statusColor, error } from "../../lib/format.js";
import { runHealthCheck, checkFile, getDefaultRules } from "../../lib/health.js";
import { getHealthDiff } from "../../lib/healthdiff.js";
import { createTasksFromViolations } from "../../lib/taskgen.js";
import { detectProjectPath } from "../../lib/detect.js";
import { getActiveProfile } from "../../lib/profiles.js";
import { getFixSuggestions, applyFixes } from "../../lib/fixer.js";
import { getDb } from "../../lib/db.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

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
    .action(async (opts: { project?: string; ai?: boolean; watch?: boolean; createTasks?: boolean; sinceLast?: boolean; noCache?: boolean }) => {
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

        if (!isTTY) {
          jsonOut(result);
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
    .action(async (file: string, opts: { project?: string; quiet?: boolean }) => {
      const projectPath = resolve(opts.project ?? process.cwd());
      const filePath = resolve(file);

      const profile = getActiveProfile(projectPath);
      const rules = getDefaultRules(profile);
      const violations = checkFile(filePath, rules);

      if (opts.quiet) {
        process.exit(violations.length > 0 ? 1 : 0);
      }

      if (!isTTY) {
        jsonOut({ filePath, violations });
        return;
      }

      if (violations.length === 0) {
        console.log(chalk.green(`✔ ${file}: No violations`));
        return;
      }

      console.log(chalk.yellow(`${file}: ${violations.length} violation(s)`));
      for (const v of violations) {
        console.log(`  [${severityColor(v.severity)}] ${chalk.dim(v.rule)}: ${v.message}`);
      }
      process.exit(1);
    });

  program
    .command("score")
    .description("Show the latest health check score for a project")
    .option("-p, --project <path>", "Project path (default: auto-detect)")
    .action((opts: { project?: string }) => {
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
        if (!isTTY) { jsonOut(msg); return; }
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

      if (!isTTY) { jsonOut(result); return; }
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
    .action((opts: { project?: string }) => {
      const projectPath = resolve(opts.project ?? detectProjectPath());
      const diff = getHealthDiff(projectPath);

      if (!isTTY) { jsonOut(diff); return; }

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
    .action(async (file: string, opts: { project?: string; apply?: boolean }) => {
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

      if (!isTTY) { jsonOut(result); return; }

      if (fixes.length === 0) {
        console.log(chalk.green(`✔ ${file}: No violations to fix`));
        return;
      }

      console.log(chalk.bold(`\n${file}: ${fixes.length} fix suggestion(s)\n`));
      for (const fix of fixes) {
        const fixable = fix.autoFixable ? chalk.green("[auto-fixable]") : chalk.dim("[manual]");
        console.log(`  Line ${chalk.bold(String(fix.line))} ${fixable} ${chalk.dim(fix.rule)}`);
        console.log(`    ${chalk.dim("Current:")}    ${fix.current.trim()}`);
        console.log(`    ${chalk.dim("Suggestion:")} ${fix.suggestion}`);
        if (fix.autoFixable && fix.fixedLine) {
          console.log(`    ${chalk.dim("Fixed line:")} ${fix.fixedLine.trim()}`);
        }
        console.log();
      }

      if (opts.apply) {
        if (applied > 0) console.log(chalk.green(`✔ Applied ${applied} auto-fix(es) to ${file}`));
        else console.log(chalk.dim("No auto-fixable issues found to apply."));
      } else {
        const autoCount = fixes.filter((f) => f.autoFixable).length;
        if (autoCount > 0) console.log(chalk.dim(`Tip: Run with --apply to auto-fix ${autoCount} fixable issue(s).`));
      }
    });
}

export { registerHealthCommand as registerCheckFileCommand };
