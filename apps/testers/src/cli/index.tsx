#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createScenario, getScenario, getScenarioByShortId, listScenarios, updateScenario, deleteScenario } from "../db/scenarios.js";
import { getRun, listRuns } from "../db/runs.js";
import { getResultsByRun } from "../db/results.js";
import { listScreenshots } from "../db/screenshots.js";
import { runByFilter, startRunAsync } from "../lib/runner.js";
import { formatTerminal, formatJSON, getExitCode, formatRunList, formatScenarioList } from "../lib/reporter.js";
import { loadConfig } from "../lib/config.js";
import { importFromTodos } from "../lib/todos-connector.js";
import { installBrowser } from "../lib/browser.js";
import { initProject } from "../lib/init.js";
import { runSmoke, formatSmokeReport } from "../lib/smoke.js";
import { diffRuns, formatDiffTerminal, formatDiffJSON } from "../lib/diff.js";
import { generateHtmlReport, generateLatestReport } from "../lib/report.js";
import { getCostSummary, formatCostsTerminal, formatCostsJSON } from "../lib/costs.js";

import { createProject, getProject, listProjects, ensureProject } from "../db/projects.js";
import { createSchedule, getSchedule, listSchedules, updateSchedule, deleteSchedule } from "../db/schedules.js";
import { getTemplate, listTemplateNames } from "../lib/templates.js";
import { createAuthPreset, listAuthPresets, deleteAuthPreset } from "../db/auth-presets.js";
import type { ScenarioPriority } from "../types/index.js";
import { existsSync, mkdirSync } from "node:fs";

const program = new Command();

program
  .name("testers")
  .version("0.0.1")
  .description("AI-powered browser testing CLI");

// ─── Helper: active project ─────────────────────────────────────────────────

const CONFIG_DIR = join(process.env["HOME"] ?? "~", ".testers");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function getActiveProject(): string | undefined {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      return raw.activeProject ?? undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function resolveProject(optProject?: string): string | undefined {
  return optProject ?? getActiveProject();
}

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
  .option("--project <id>", "Project ID")
  .option("--template <name>", "Seed scenarios from a template (auth, crud, forms, nav, a11y)")
  .action((name: string, opts) => {
    try {
      if (opts.template) {
        const template = getTemplate(opts.template);
        if (!template) {
          console.error(chalk.red(`Unknown template: ${opts.template}. Available: ${listTemplateNames().join(", ")}`));
          process.exit(1);
        }
        const projectId = resolveProject(opts.project);
        for (const input of template) {
          const s = createScenario({ ...input, projectId });
          console.log(chalk.green(`  Created ${s.shortId}: ${s.name}`));
        }
        return;
      }

      const projectId = resolveProject(opts.project);
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
        projectId,
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
  .option("-b, --background", "Start run in background and return immediately", false)
  .action(async (url: string, description: string | undefined, opts) => {
    try {
      const projectId = resolveProject(opts.project);

      // If --from-todos, import scenarios first
      if (opts.fromTodos) {
        const result = importFromTodos({ projectId });
        console.log(chalk.blue(`Imported ${result.imported} scenarios from todos (${result.skipped} skipped)`));
      }

      // Background mode — start async and return immediately
      if (opts.background) {
        if (description) {
          createScenario({ name: description, description, tags: ["ad-hoc"], projectId });
        }
        const { runId, scenarioCount } = startRunAsync({
          url,
          tags: opts.tag.length > 0 ? opts.tag : undefined,
          scenarioIds: opts.scenario ? [opts.scenario] : undefined,
          priority: opts.priority,
          model: opts.model,
          headed: opts.headed,
          parallel: parseInt(opts.parallel, 10),
          timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
          projectId,
        });
        console.log(chalk.green(`Run started in background: ${chalk.bold(runId.slice(0, 8))}`));
        console.log(chalk.dim(`  Scenarios: ${scenarioCount}`));
        console.log(chalk.dim(`  URL: ${url}`));
        console.log(chalk.dim(`  Check progress: testers results ${runId.slice(0, 8)}`));
        process.exit(0);
      }

      // If description provided, create an ad-hoc scenario and run it
      if (description) {
        const scenario = createScenario({
          name: description,
          description,
          tags: ["ad-hoc"],
          projectId,
        });
        const { run, results } = await runByFilter({
          url,
          scenarioIds: [scenario.id],
          model: opts.model,
          headed: opts.headed,
          parallel: parseInt(opts.parallel, 10),
          timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
          projectId,
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
        projectId,
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

// ─── testers project ──────────────────────────────────────────────────────

const projectCmd = program.command("project").description("Manage test projects");

projectCmd
  .command("create <name>")
  .description("Create a new project")
  .option("--path <path>", "Project path")
  .option("-d, --description <text>", "Project description")
  .option("--prefix <prefix>", "Scenario prefix", "TST")
  .action((name: string, opts) => {
    try {
      const project = createProject({
        name,
        path: opts.path,
        description: opts.description,
      });
      console.log(chalk.green(`Created project ${chalk.bold(project.name)} (${project.id})`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

projectCmd
  .command("list")
  .description("List all projects")
  .action(() => {
    try {
      const projects = listProjects();
      if (projects.length === 0) {
        console.log(chalk.dim("No projects found."));
        return;
      }
      console.log("");
      console.log(chalk.bold("  Projects"));
      console.log("");
      console.log(`  ${"ID".padEnd(38)} ${"Name".padEnd(24)} ${"Path".padEnd(30)} Created`);
      console.log(`  ${"─".repeat(38)} ${"─".repeat(24)} ${"─".repeat(30)} ${"─".repeat(20)}`);
      for (const p of projects) {
        console.log(`  ${p.id.padEnd(38)} ${p.name.padEnd(24)} ${(p.path ?? chalk.dim("—")).toString().padEnd(30)} ${p.createdAt}`);
      }
      console.log("");
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

projectCmd
  .command("show <id>")
  .description("Show project details")
  .action((id: string) => {
    try {
      const project = getProject(id);
      if (!project) {
        console.error(chalk.red(`Project not found: ${id}`));
        process.exit(1);
      }
      console.log("");
      console.log(chalk.bold(`  Project: ${project.name}`));
      console.log(`  ID:          ${project.id}`);
      console.log(`  Path:        ${project.path ?? chalk.dim("none")}`);
      console.log(`  Description: ${project.description ?? chalk.dim("none")}`);
      console.log(`  Created:     ${project.createdAt}`);
      console.log(`  Updated:     ${project.updatedAt}`);
      console.log("");
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

projectCmd
  .command("use <name>")
  .description("Set active project (find or create)")
  .action((name: string) => {
    try {
      const project = ensureProject(name, process.cwd());
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      let config: Record<string, unknown> = {};
      if (existsSync(CONFIG_PATH)) {
        try {
          config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        } catch {
          // ignore parse errors, overwrite
        }
      }
      config.activeProject = project.id;
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
      console.log(chalk.green(`Active project set to ${chalk.bold(project.name)} (${project.id})`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers schedule ─────────────────────────────────────────────────────

const scheduleCmd = program.command("schedule").description("Manage recurring test schedules");

scheduleCmd
  .command("create <name>")
  .description("Create a new schedule")
  .requiredOption("--cron <expression>", "Cron expression")
  .requiredOption("--url <url>", "Target URL")
  .option("-t, --tag <tag>", "Tag filter (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("-p, --priority <level>", "Priority filter")
  .option("-m, --model <model>", "AI model to use")
  .option("--parallel <n>", "Parallel browsers", "1")
  .option("--headed", "Run in headed mode", false)
  .option("--timeout <ms>", "Timeout in milliseconds")
  .option("--project <id>", "Project ID")
  .action((name: string, opts) => {
    try {
      const projectId = resolveProject(opts.project);
      const schedule = createSchedule({
        name,
        cronExpression: opts.cron,
        url: opts.url,
        scenarioFilter: {
          tags: opts.tag.length > 0 ? opts.tag : undefined,
          priority: opts.priority as ScenarioPriority | undefined,
        },
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
        timeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
        projectId,
      });
      console.log(chalk.green(`Created schedule ${chalk.bold(schedule.name)} (${schedule.id})`));
      if (schedule.nextRunAt) {
        console.log(chalk.dim(`  Next run at: ${schedule.nextRunAt}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("list")
  .description("List schedules")
  .option("--project <id>", "Filter by project ID")
  .option("--enabled", "Show only enabled schedules")
  .action((opts) => {
    try {
      const projectId = resolveProject(opts.project);
      const schedules = listSchedules({
        projectId,
        enabled: opts.enabled ? true : undefined,
      });
      if (schedules.length === 0) {
        console.log(chalk.dim("No schedules found."));
        return;
      }
      console.log("");
      console.log(chalk.bold("  Schedules"));
      console.log("");
      console.log(`  ${"Name".padEnd(20)} ${"Cron".padEnd(18)} ${"URL".padEnd(30)} ${"Enabled".padEnd(9)} ${"Next Run".padEnd(22)} Last Run`);
      console.log(`  ${"─".repeat(20)} ${"─".repeat(18)} ${"─".repeat(30)} ${"─".repeat(9)} ${"─".repeat(22)} ${"─".repeat(22)}`);
      for (const s of schedules) {
        const enabled = s.enabled ? chalk.green("yes") : chalk.red("no");
        const nextRun = s.nextRunAt ?? chalk.dim("—");
        const lastRun = s.lastRunAt ?? chalk.dim("—");
        console.log(`  ${s.name.padEnd(20)} ${s.cronExpression.padEnd(18)} ${s.url.padEnd(30)} ${enabled.toString().padEnd(9)} ${nextRun.toString().padEnd(22)} ${lastRun}`);
      }
      console.log("");
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("show <id>")
  .description("Show schedule details")
  .action((id: string) => {
    try {
      const schedule = getSchedule(id);
      if (!schedule) {
        console.error(chalk.red(`Schedule not found: ${id}`));
        process.exit(1);
      }
      console.log("");
      console.log(chalk.bold(`  Schedule: ${schedule.name}`));
      console.log(`  ID:          ${schedule.id}`);
      console.log(`  Cron:        ${schedule.cronExpression}`);
      console.log(`  URL:         ${schedule.url}`);
      console.log(`  Enabled:     ${schedule.enabled ? chalk.green("yes") : chalk.red("no")}`);
      console.log(`  Model:       ${schedule.model ?? chalk.dim("default")}`);
      console.log(`  Headed:      ${schedule.headed ? "yes" : "no"}`);
      console.log(`  Parallel:    ${schedule.parallel}`);
      console.log(`  Timeout:     ${schedule.timeoutMs ? `${schedule.timeoutMs}ms` : chalk.dim("default")}`);
      console.log(`  Project:     ${schedule.projectId ?? chalk.dim("none")}`);
      console.log(`  Filter:      ${JSON.stringify(schedule.scenarioFilter)}`);
      console.log(`  Next run:    ${schedule.nextRunAt ?? chalk.dim("not scheduled")}`);
      console.log(`  Last run:    ${schedule.lastRunAt ?? chalk.dim("never")}`);
      console.log(`  Last run ID: ${schedule.lastRunId ?? chalk.dim("none")}`);
      console.log(`  Created:     ${schedule.createdAt}`);
      console.log(`  Updated:     ${schedule.updatedAt}`);
      console.log("");
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("enable <id>")
  .description("Enable a schedule")
  .action((id: string) => {
    try {
      const schedule = updateSchedule(id, { enabled: true });
      console.log(chalk.green(`Enabled schedule ${chalk.bold(schedule.name)}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("disable <id>")
  .description("Disable a schedule")
  .action((id: string) => {
    try {
      const schedule = updateSchedule(id, { enabled: false });
      console.log(chalk.green(`Disabled schedule ${chalk.bold(schedule.name)}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("delete <id>")
  .description("Delete a schedule")
  .action((id: string) => {
    try {
      const deleted = deleteSchedule(id);
      if (deleted) {
        console.log(chalk.green(`Deleted schedule: ${id}`));
      } else {
        console.error(chalk.red(`Schedule not found: ${id}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("run <id>")
  .description("Manually trigger a schedule")
  .option("--json", "Output results as JSON", false)
  .action(async (id: string, opts) => {
    try {
      const schedule = getSchedule(id);
      if (!schedule) {
        console.error(chalk.red(`Schedule not found: ${id}`));
        process.exit(1);
        return;
      }

      console.log(chalk.blue(`Running schedule ${chalk.bold(schedule.name)} against ${schedule.url}...`));

      const { run, results } = await runByFilter({
        url: schedule.url,
        tags: schedule.scenarioFilter.tags,
        priority: schedule.scenarioFilter.priority,
        scenarioIds: schedule.scenarioFilter.scenarioIds,
        model: schedule.model ?? undefined,
        headed: schedule.headed,
        parallel: schedule.parallel,
        timeout: schedule.timeoutMs ?? undefined,
        projectId: schedule.projectId ?? undefined,
      });

      if (opts.json) {
        console.log(formatJSON(run, results));
      } else {
        console.log(formatTerminal(run, results));
      }

      process.exit(getExitCode(run));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers daemon ───────────────────────────────────────────────────────

program
  .command("daemon")
  .description("Start the scheduler daemon")
  .option("--interval <seconds>", "Check interval in seconds", "60")
  .action(async (opts) => {
    try {
      const intervalMs = parseInt(opts.interval, 10) * 1000;

      console.log(chalk.blue("Scheduler daemon started. Press Ctrl+C to stop."));
      console.log(chalk.dim(`  Check interval: ${opts.interval}s`));

      let running = true;

      const checkAndRun = async () => {
        while (running) {
          try {
            const schedules = listSchedules({ enabled: true });
            const now = new Date().toISOString();

            for (const schedule of schedules) {
              if (schedule.nextRunAt && schedule.nextRunAt <= now) {
                console.log(chalk.blue(`[${new Date().toISOString()}] Triggering schedule: ${schedule.name}`));
                try {
                  const { run } = await runByFilter({
                    url: schedule.url,
                    tags: schedule.scenarioFilter.tags,
                    priority: schedule.scenarioFilter.priority,
                    scenarioIds: schedule.scenarioFilter.scenarioIds,
                    model: schedule.model ?? undefined,
                    headed: schedule.headed,
                    parallel: schedule.parallel,
                    timeout: schedule.timeoutMs ?? undefined,
                    projectId: schedule.projectId ?? undefined,
                  });

                  const statusColor = run.status === "passed" ? chalk.green : chalk.red;
                  console.log(`  ${statusColor(run.status)} — ${run.passed}/${run.total} passed`);

                  // Update schedule with last run info
                  updateSchedule(schedule.id, {});
                } catch (err) {
                  console.error(chalk.red(`  Error running schedule ${schedule.name}: ${err instanceof Error ? err.message : String(err)}`));
                }
              }
            }
          } catch (err) {
            console.error(chalk.red(`Daemon error: ${err instanceof Error ? err.message : String(err)}`));
          }

          // Wait for next check
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      };

      process.on("SIGINT", () => {
        console.log(chalk.yellow("\nShutting down scheduler daemon..."));
        running = false;
        process.exit(0);
      });

      process.on("SIGTERM", () => {
        console.log(chalk.yellow("\nShutting down scheduler daemon..."));
        running = false;
        process.exit(0);
      });

      await checkAndRun();
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers init ──────────────────────────────────────────────────────────

program
  .command("init")
  .description("Initialize a new testing project")
  .option("-n, --name <name>", "Project name")
  .option("-u, --url <url>", "Base URL")
  .option("-p, --path <path>", "Project path")
  .action((opts) => {
    try {
      const { project, scenarios, framework } = initProject({
        name: opts.name,
        url: opts.url,
        path: opts.path,
      });

      console.log("");
      console.log(chalk.bold("  Project initialized!"));
      console.log("");

      if (framework) {
        console.log(`  Framework:  ${chalk.cyan(framework.name)}`);
        if (framework.features.length > 0) {
          console.log(`  Features:   ${chalk.dim(framework.features.join(", "))}`);
        }
      } else {
        console.log(`  Framework:  ${chalk.dim("not detected")}`);
      }

      console.log(`  Project:    ${chalk.green(project.name)} ${chalk.dim(`(${project.id})`)}`);
      console.log(`  Scenarios:  ${chalk.green(String(scenarios.length))} starter scenarios created`);
      console.log("");

      for (const s of scenarios) {
        console.log(`    ${chalk.dim(s.shortId)} ${s.name} ${chalk.dim(`[${s.tags.join(", ")}]`)}`);
      }

      console.log("");
      console.log(chalk.bold("  Next steps:"));
      console.log(`    1. Start your dev server`);
      console.log(`    2. Run ${chalk.cyan("testers run <url>")} to execute tests`);
      console.log(`    3. Add more scenarios with ${chalk.cyan("testers add <name>")}`);
      console.log("");
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers replay <run-id> ──────────────────────────────────────────────

program
  .command("replay <run-id>")
  .description("Re-run all scenarios from a previous run")
  .option("-u, --url <url>", "Override URL")
  .option("-m, --model <model>", "Override model")
  .option("--headed", "Run headed", false)
  .option("--json", "JSON output", false)
  .option("--parallel <n>", "Parallel count", "1")
  .action(async (runId: string, opts) => {
    try {
      const originalRun = getRun(runId);
      if (!originalRun) {
        console.error(chalk.red(`Run not found: ${runId}`));
        process.exit(1);
      }

      const originalResults = getResultsByRun(originalRun.id);
      const scenarioIds = originalResults.map(r => r.scenarioId);

      if (scenarioIds.length === 0) {
        console.log(chalk.dim("No scenarios to replay."));
        return;
      }

      console.log(chalk.blue(`Replaying ${scenarioIds.length} scenarios from run ${originalRun.id.slice(0, 8)}...`));

      const { run, results } = await runByFilter({
        url: opts.url ?? originalRun.url,
        scenarioIds,
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
      });

      if (opts.json) {
        console.log(formatJSON(run, results));
      } else {
        console.log(formatTerminal(run, results));
      }
      process.exit(getExitCode(run));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers retry <run-id> ───────────────────────────────────────────────

program
  .command("retry <run-id>")
  .description("Re-run only failed scenarios from a previous run")
  .option("-u, --url <url>", "Override URL")
  .option("-m, --model <model>", "Override model")
  .option("--headed", "Run headed", false)
  .option("--json", "JSON output", false)
  .option("--parallel <n>", "Parallel count", "1")
  .action(async (runId: string, opts) => {
    try {
      const originalRun = getRun(runId);
      if (!originalRun) {
        console.error(chalk.red(`Run not found: ${runId}`));
        process.exit(1);
      }

      const originalResults = getResultsByRun(originalRun.id);
      const failedScenarioIds = originalResults
        .filter(r => r.status === "failed" || r.status === "error")
        .map(r => r.scenarioId);

      if (failedScenarioIds.length === 0) {
        console.log(chalk.green("No failed scenarios to retry. All passed!"));
        return;
      }

      console.log(chalk.blue(`Retrying ${failedScenarioIds.length} failed scenarios from run ${originalRun.id.slice(0, 8)}...`));

      const { run, results } = await runByFilter({
        url: opts.url ?? originalRun.url,
        scenarioIds: failedScenarioIds,
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
      });

      // Show comparison
      if (!opts.json) {
        console.log("");
        console.log(chalk.bold("  Comparison with original run:"));
        for (const result of results) {
          const original = originalResults.find(r => r.scenarioId === result.scenarioId);
          if (original) {
            const changed = original.status !== result.status;
            const arrow = changed
              ? chalk.yellow(`${original.status} → ${result.status}`)
              : chalk.dim(`${result.status} (unchanged)`);
            const icon = result.status === "passed" ? chalk.green("✓") : chalk.red("✗");
            // Get scenario name from the getScenario import
            console.log(`  ${icon} ${result.scenarioId.slice(0, 8)}: ${arrow}`);
          }
        }
        console.log("");
      }

      if (opts.json) {
        console.log(formatJSON(run, results));
      } else {
        console.log(formatTerminal(run, results));
      }
      process.exit(getExitCode(run));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers smoke <url> ─────────────────────────────────────────────────────

program
  .command("smoke <url>")
  .description("Run autonomous smoke test")
  .option("-m, --model <model>", "AI model")
  .option("--headed", "Watch browser", false)
  .option("--timeout <ms>", "Timeout in milliseconds")
  .option("--json", "JSON output", false)
  .option("--project <id>", "Project ID")
  .action(async (url: string, opts) => {
    try {
      const projectId = resolveProject(opts.project);

      console.log(chalk.blue(`Running smoke test against ${chalk.bold(url)}...`));
      console.log("");

      const smokeResult = await runSmoke({
        url,
        model: opts.model,
        headed: opts.headed,
        timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
        projectId,
      });

      if (opts.json) {
        console.log(JSON.stringify({
          run: smokeResult.run,
          result: smokeResult.result,
          pagesVisited: smokeResult.pagesVisited,
          issues: smokeResult.issuesFound,
        }, null, 2));
      } else {
        console.log(formatSmokeReport(smokeResult));
      }

      // Exit with non-zero if critical/high issues found
      const hasCritical = smokeResult.issuesFound.some(
        (i) => i.severity === "critical" || i.severity === "high"
      );
      process.exit(hasCritical ? 1 : 0);
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers diff <run1> <run2> ──────────────────────────────────────────────

program
  .command("diff <run1> <run2>")
  .description("Compare two test runs")
  .option("--json", "JSON output", false)
  .action((run1: string, run2: string, opts) => {
    try {
      const diff = diffRuns(run1, run2);
      if (opts.json) {
        console.log(formatDiffJSON(diff));
      } else {
        console.log(formatDiffTerminal(diff));
      }
      // Exit 1 if regressions found
      process.exit(diff.regressions.length > 0 ? 1 : 0);
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers report [run-id] ─────────────────────────────────────────────────

program
  .command("report [run-id]")
  .description("Generate HTML test report")
  .option("--latest", "Use most recent run", false)
  .option("-o, --output <file>", "Output file path", "report.html")
  .action((runId: string | undefined, opts) => {
    try {
      let html: string;
      if (opts.latest || !runId) {
        html = generateLatestReport();
      } else {
        html = generateHtmlReport(runId);
      }
      writeFileSync(opts.output, html, "utf-8");
      console.log(chalk.green(`Report generated: ${opts.output}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers auth ──────────────────────────────────────────────────────────

const authCmd = program.command("auth").description("Manage auth presets");

authCmd
  .command("add <name>")
  .description("Create an auth preset")
  .requiredOption("--email <email>", "Login email")
  .requiredOption("--password <password>", "Login password")
  .option("--login-path <path>", "Login page path", "/login")
  .action((name: string, opts) => {
    try {
      const preset = createAuthPreset({
        name,
        email: opts.email,
        password: opts.password,
        loginPath: opts.loginPath,
      });
      console.log(chalk.green(`Created auth preset ${chalk.bold(preset.name)} (${preset.email})`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

authCmd
  .command("list")
  .description("List auth presets")
  .action(() => {
    try {
      const presets = listAuthPresets();
      if (presets.length === 0) {
        console.log(chalk.dim("No auth presets found."));
        return;
      }
      console.log("");
      console.log(chalk.bold("  Auth Presets"));
      console.log("");
      console.log(`  ${"Name".padEnd(20)} ${"Email".padEnd(30)} ${"Login Path".padEnd(15)} Created`);
      console.log(`  ${"─".repeat(20)} ${"─".repeat(30)} ${"─".repeat(15)} ${"─".repeat(22)}`);
      for (const p of presets) {
        console.log(`  ${p.name.padEnd(20)} ${p.email.padEnd(30)} ${p.loginPath.padEnd(15)} ${p.createdAt}`);
      }
      console.log("");
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

authCmd
  .command("delete <name>")
  .description("Delete an auth preset")
  .action((name: string) => {
    try {
      const deleted = deleteAuthPreset(name);
      if (deleted) {
        console.log(chalk.green(`Deleted auth preset: ${name}`));
      } else {
        console.error(chalk.red(`Auth preset not found: ${name}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers costs ──────────────────────────────────────────────────────────

program
  .command("costs")
  .description("Show cost tracking and budget status")
  .option("--project <id>", "Project ID")
  .option("--period <period>", "Time period", "month")
  .option("--json", "JSON output", false)
  .action((opts) => {
    try {
      const summary = getCostSummary({ projectId: resolveProject(opts.project), period: opts.period });
      if (opts.json) {
        console.log(formatCostsJSON(summary));
      } else {
        console.log(formatCostsTerminal(summary));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program.parse();
