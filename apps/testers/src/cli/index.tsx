#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createScenario, getScenario, getScenarioByShortId, listScenarios, updateScenario, deleteScenario } from "../db/scenarios.js";
import { getRun, listRuns } from "../db/runs.js";
import { getResultsByRun } from "../db/results.js";
import { listScreenshots } from "../db/screenshots.js";
import { runByFilter } from "../lib/runner.js";
import { formatTerminal, formatJSON, getExitCode, formatRunList, formatScenarioList } from "../lib/reporter.js";
import { loadConfig } from "../lib/config.js";
import { importFromTodos } from "../lib/todos-connector.js";
import { installBrowser } from "../lib/browser.js";

import type { ScenarioPriority } from "../types/index.js";

const program = new Command();

program
  .name("testers")
  .version("0.0.1")
  .description("AI-powered browser testing CLI");

// ─── testers add <name> ─────────────────────────────────────────────────────

program
  .command("add <name>")
  .description("Create a new test scenario")
  .option("-d, --description <text>", "Scenario description", "")
  .option("-s, --steps <step>", "Test step (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("-t, --tag <tag>", "Tag (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("-p, --priority <level>", "Priority level", "medium")
  .option("-m, --model <model>", "AI model to use")
  .option("--path <path>", "Target path on the URL")
  .option("--auth", "Requires authentication", false)
  .option("--timeout <ms>", "Timeout in milliseconds")
  .action((name: string, opts) => {
    try {
      const scenario = createScenario({
        name,
        description: opts.description || name,
        steps: opts.steps,
        tags: opts.tag,
        priority: opts.priority as ScenarioPriority,
        model: opts.model,
        targetPath: opts.path,
        requiresAuth: opts.auth,
        timeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
      });
      console.log(chalk.green(`Created scenario ${chalk.bold(scenario.shortId)}: ${scenario.name}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers list ───────────────────────────────────────────────────────────

program
  .command("list")
  .description("List test scenarios")
  .option("-t, --tag <tag>", "Filter by tag")
  .option("-p, --priority <level>", "Filter by priority")
  .option("--project <id>", "Filter by project ID")
  .option("-l, --limit <n>", "Limit results", "50")
  .action((opts) => {
    try {
      const scenarios = listScenarios({
        tags: opts.tag ? [opts.tag] : undefined,
        priority: opts.priority as ScenarioPriority | undefined,
        projectId: opts.project,
        limit: parseInt(opts.limit, 10),
      });
      console.log(formatScenarioList(scenarios));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers show <id> ─────────────────────────────────────────────────────

program
  .command("show <id>")
  .description("Show scenario details")
  .action((id: string) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) {
        console.error(chalk.red(`Scenario not found: ${id}`));
        process.exit(1);
      }

      console.log("");
      console.log(chalk.bold(`  Scenario ${scenario.shortId}`));
      console.log(`  Name:        ${scenario.name}`);
      console.log(`  ID:          ${chalk.dim(scenario.id)}`);
      console.log(`  Description: ${scenario.description}`);
      console.log(`  Priority:    ${scenario.priority}`);
      console.log(`  Model:       ${scenario.model ?? chalk.dim("default")}`);
      console.log(`  Tags:        ${scenario.tags.length > 0 ? scenario.tags.join(", ") : chalk.dim("none")}`);
      console.log(`  Path:        ${scenario.targetPath ?? chalk.dim("none")}`);
      console.log(`  Auth:        ${scenario.requiresAuth ? "yes" : "no"}`);
      console.log(`  Timeout:     ${scenario.timeoutMs ? `${scenario.timeoutMs}ms` : chalk.dim("default")}`);
      console.log(`  Version:     ${scenario.version}`);
      console.log(`  Created:     ${scenario.createdAt}`);
      console.log(`  Updated:     ${scenario.updatedAt}`);

      if (scenario.steps.length > 0) {
        console.log("");
        console.log(chalk.bold("  Steps:"));
        for (let i = 0; i < scenario.steps.length; i++) {
          console.log(`    ${i + 1}. ${scenario.steps[i]}`);
        }
      }

      console.log("");
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers update <id> ───────────────────────────────────────────────────

program
  .command("update <id>")
  .description("Update a scenario")
  .option("-n, --name <name>", "New name")
  .option("-d, --description <text>", "New description")
  .option("-s, --steps <step>", "Replace steps (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("-t, --tag <tag>", "Replace tags (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("-p, --priority <level>", "New priority")
  .option("-m, --model <model>", "New model")
  .action((id: string, opts) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) {
        console.error(chalk.red(`Scenario not found: ${id}`));
        process.exit(1);
      }

      const updated = updateScenario(
        scenario.id,
        {
          name: opts.name,
          description: opts.description,
          steps: opts.steps.length > 0 ? opts.steps : undefined,
          tags: opts.tag.length > 0 ? opts.tag : undefined,
          priority: opts.priority as ScenarioPriority | undefined,
          model: opts.model,
        },
        scenario.version,
      );

      console.log(chalk.green(`Updated scenario ${chalk.bold(updated.shortId)}: ${updated.name}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers delete <id> ───────────────────────────────────────────────────

program
  .command("delete <id>")
  .description("Delete a scenario")
  .action((id: string) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) {
        console.error(chalk.red(`Scenario not found: ${id}`));
        process.exit(1);
      }

      const deleted = deleteScenario(scenario.id);
      if (deleted) {
        console.log(chalk.green(`Deleted scenario ${scenario.shortId}: ${scenario.name}`));
      } else {
        console.error(chalk.red(`Failed to delete scenario: ${id}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers run <url> [description] ───────────────────────────────────────

program
  .command("run <url> [description]")
  .description("Run test scenarios against a URL")
  .option("-t, --tag <tag>", "Filter by tag (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("-s, --scenario <id>", "Run specific scenario ID")
  .option("-p, --priority <level>", "Filter by priority")
  .option("--headed", "Run browser in headed mode", false)
  .option("-m, --model <model>", "AI model to use")
  .option("--parallel <n>", "Number of parallel browsers", "1")
  .option("--json", "Output results as JSON", false)
  .option("-o, --output <filepath>", "Write JSON results to file")
  .option("--timeout <ms>", "Timeout in milliseconds")
  .option("--from-todos", "Import scenarios from todos before running", false)
  .option("--project <id>", "Project ID")
  .action(async (url: string, description: string | undefined, opts) => {
    try {
      // If description provided, create an ad-hoc scenario and run it
      if (description) {
        const scenario = createScenario({
          name: description,
          description,
          tags: ["ad-hoc"],
          projectId: opts.project,
        });
        const { run, results } = await runByFilter({
          url,
          scenarioIds: [scenario.id],
          model: opts.model,
          headed: opts.headed,
          parallel: parseInt(opts.parallel, 10),
          timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
          projectId: opts.project,
        });

        if (opts.json || opts.output) {
          const jsonOutput = formatJSON(run, results);
          if (opts.output) {
            writeFileSync(opts.output, jsonOutput, "utf-8");
            console.log(chalk.green(`Results written to ${opts.output}`));
          }
          if (opts.json) {
            console.log(jsonOutput);
          }
        } else {
          console.log(formatTerminal(run, results));
        }

        process.exit(getExitCode(run));
      }

      // If --from-todos, import scenarios first
      if (opts.fromTodos) {
        const result = importFromTodos({ projectId: opts.project });
        console.log(chalk.blue(`Imported ${result.imported} scenarios from todos (${result.skipped} skipped)`));
      }

      // Run by filter
      const { run, results } = await runByFilter({
        url,
        tags: opts.tag.length > 0 ? opts.tag : undefined,
        scenarioIds: opts.scenario ? [opts.scenario] : undefined,
        priority: opts.priority,
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
        timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
        projectId: opts.project,
      });

      if (opts.json || opts.output) {
        const jsonOutput = formatJSON(run, results);
        if (opts.output) {
          writeFileSync(opts.output, jsonOutput, "utf-8");
          console.log(chalk.green(`Results written to ${opts.output}`));
        }
        if (opts.json) {
          console.log(jsonOutput);
        }
      } else {
        console.log(formatTerminal(run, results));
      }

      process.exit(getExitCode(run));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers runs ───────────────────────────────────────────────────────────

program
  .command("runs")
  .description("List past test runs")
  .option("--status <status>", "Filter by status")
  .option("-l, --limit <n>", "Limit results", "20")
  .action((opts) => {
    try {
      const runs = listRuns({
        status: opts.status as "pending" | "running" | "passed" | "failed" | "cancelled" | undefined,
        limit: parseInt(opts.limit, 10),
      });
      console.log(formatRunList(runs));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers results <run-id> ───────────────────────────────────────────────

program
  .command("results <run-id>")
  .description("Show results for a test run")
  .action((runId: string) => {
    try {
      const run = getRun(runId);
      if (!run) {
        console.error(chalk.red(`Run not found: ${runId}`));
        process.exit(1);
      }

      const results = getResultsByRun(run.id);
      console.log(formatTerminal(run, results));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers screenshots <id> ──────────────────────────────────────────────

program
  .command("screenshots <id>")
  .description("List screenshots for a run or result")
  .action((id: string) => {
    try {
      // Try as run-id first: get all results, then all screenshots
      const run = getRun(id);
      if (run) {
        const results = getResultsByRun(run.id);
        let total = 0;
        console.log("");
        console.log(chalk.bold(`  Screenshots for run ${run.id.slice(0, 8)}`));
        console.log("");

        for (const result of results) {
          const screenshots = listScreenshots(result.id);
          if (screenshots.length > 0) {
            const scenario = getScenario(result.scenarioId);
            const label = scenario ? `${scenario.shortId}: ${scenario.name}` : result.scenarioId.slice(0, 8);
            console.log(chalk.bold(`  ${label}`));
            for (const ss of screenshots) {
              console.log(`    ${chalk.dim(String(ss.stepNumber).padStart(3, "0"))} ${ss.action} — ${chalk.dim(ss.filePath)}`);
              total++;
            }
            console.log("");
          }
        }

        if (total === 0) {
          console.log(chalk.dim("  No screenshots found."));
          console.log("");
        }
        return;
      }

      // Try as result-id
      const screenshots = listScreenshots(id);
      if (screenshots.length > 0) {
        console.log("");
        console.log(chalk.bold(`  Screenshots for result ${id.slice(0, 8)}`));
        console.log("");
        for (const ss of screenshots) {
          console.log(`  ${chalk.dim(String(ss.stepNumber).padStart(3, "0"))} ${ss.action} — ${chalk.dim(ss.filePath)}`);
        }
        console.log("");
        return;
      }

      console.error(chalk.red(`No screenshots found for: ${id}`));
      process.exit(1);
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers import <dir> ──────────────────────────────────────────────────

program
  .command("import <dir>")
  .description("Import markdown test files as scenarios")
  .action((dir: string) => {
    try {
      const absDir = resolve(dir);
      const files = readdirSync(absDir).filter((f) => f.endsWith(".md"));

      if (files.length === 0) {
        console.log(chalk.dim("No .md files found in directory."));
        return;
      }

      let imported = 0;
      for (const file of files) {
        const content = readFileSync(join(absDir, file), "utf-8");
        const lines = content.split("\n");

        // Parse name from first # heading
        let name = file.replace(/\.md$/, "");
        const headingLine = lines.find((l) => l.startsWith("# "));
        if (headingLine) {
          name = headingLine.replace(/^#\s+/, "").trim();
        }

        // Parse description from body (non-heading, non-numbered lines)
        const descriptionLines: string[] = [];
        const steps: string[] = [];

        for (const line of lines) {
          if (line.startsWith("# ")) continue;
          const stepMatch = line.match(/^\s*\d+[\.\)]\s*(.+)/);
          if (stepMatch?.[1]) {
            steps.push(stepMatch[1].trim());
          } else if (line.trim()) {
            descriptionLines.push(line.trim());
          }
        }

        const scenario = createScenario({
          name,
          description: descriptionLines.join(" ") || name,
          steps,
        });

        console.log(chalk.green(`  Imported ${chalk.bold(scenario.shortId)}: ${scenario.name}`));
        imported++;
      }

      console.log("");
      console.log(chalk.green(`Imported ${imported} scenario(s) from ${absDir}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers config ─────────────────────────────────────────────────────────

program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    try {
      const config = loadConfig();
      console.log(JSON.stringify(config, null, 2));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers status ─────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show database and auth status")
  .action(() => {
    try {
      const config = loadConfig();
      const hasApiKey = !!config.anthropicApiKey || !!process.env["ANTHROPIC_API_KEY"];
      const dbPath = join(process.env["HOME"] ?? "~", ".testers", "testers.db");

      console.log("");
      console.log(chalk.bold("  Open Testers Status"));
      console.log("");
      console.log(`  ANTHROPIC_API_KEY: ${hasApiKey ? chalk.green("set") : chalk.red("not set")}`);
      console.log(`  Database:          ${dbPath}`);
      console.log(`  Default model:     ${config.defaultModel}`);
      console.log(`  Screenshots dir:   ${config.screenshots.dir}`);
      console.log("");
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers install-browser ────────────────────────────────────────────────

program
  .command("install-browser")
  .description("Install Playwright Chromium browser")
  .action(async () => {
    try {
      console.log(chalk.blue("Installing Playwright Chromium..."));
      await installBrowser();
      console.log(chalk.green("Browser installed successfully."));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program.parse();
