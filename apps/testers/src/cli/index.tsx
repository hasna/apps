#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import pkg from "../../package.json";
import { render, Box, Text, useInput, useApp } from "ink";
import React, { useState } from "react";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

import { createScenario, getScenario, getScenarioByShortId, listScenarios, updateScenario, deleteScenario } from "../db/scenarios.js";
import { getRun, listRuns } from "../db/runs.js";
import { getResultsByRun } from "../db/results.js";
import { listScreenshots } from "../db/screenshots.js";
import { runByFilter, startRunAsync, onRunEvent } from "../lib/runner.js";
import { formatTerminal, formatJSON, getExitCode, formatRunList, formatScenarioList } from "../lib/reporter.js";
import { loadConfig } from "../lib/config.js";
import { importFromTodos } from "../lib/todos-connector.js";
import { installBrowser } from "../lib/browser.js";
import { initProject } from "../lib/init.js";
import { runSmoke, formatSmokeReport } from "../lib/smoke.js";
import { diffRuns, formatDiffTerminal, formatDiffJSON } from "../lib/diff.js";
import { setBaseline, getBaseline, compareRunScreenshots, formatVisualDiffTerminal } from "../lib/visual-diff.js";
import { generateHtmlReport, generateLatestReport } from "../lib/report.js";
import { getCostSummary, formatCostsTerminal, formatCostsJSON, formatCostsCsv, checkBudget, getCostsByScenario, formatCostsByScenarioTerminal } from "../lib/costs.js";

import { createProject, getProject, listProjects, ensureProject } from "../db/projects.js";
import { createSchedule, getSchedule, listSchedules, updateSchedule, deleteSchedule } from "../db/schedules.js";
import { getTemplate, listTemplateNames } from "../lib/templates.js";
import { createAuthPreset, listAuthPresets, deleteAuthPreset } from "../db/auth-presets.js";
import { addDependency, removeDependency, getDependencies, getDependents, createFlow, getFlow, listFlows, deleteFlow } from "../db/flows.js";
import { createEnvironment, getEnvironment, listEnvironments, deleteEnvironment, setDefaultEnvironment, getDefaultEnvironment } from "../db/environments.js";
import { generateGitHubActionsWorkflow } from "../lib/ci.js";
import type { ScenarioPriority } from "../types/index.js";
import { parseAssertionString } from "../lib/assertions.js";
import { existsSync, mkdirSync } from "node:fs";

// ─── Interactive Add Prompt (Ink) ────────────────────────────────────────────

type AddFormState = {
  name: string;
  url: string;
  description: string;
  priority: string;
  tags: string;
  field: "name" | "url" | "description" | "priority" | "tags" | "confirm";
  buffer: string;
};

const PRIORITIES = ["low", "medium", "high", "critical"];

function AddForm({ onComplete }: { onComplete: (data: AddFormState | null) => void }) {
  const { exit } = useApp();
  const [state, setState] = useState<AddFormState>({
    name: "",
    url: "",
    description: "",
    priority: "medium",
    tags: "",
    field: "name",
    buffer: "",
  });

  useInput((input, key) => {
    if (key.escape) {
      onComplete(null);
      exit();
      return;
    }

    if (key.return) {
      if (state.field === "name") {
        const val = state.buffer.trim();
        if (!val) return;
        setState((s) => ({ ...s, name: val, buffer: "", field: "url" }));
      } else if (state.field === "url") {
        setState((s) => ({ ...s, url: s.buffer.trim(), buffer: "", field: "description" }));
      } else if (state.field === "description") {
        setState((s) => ({ ...s, description: s.buffer.trim(), buffer: "", field: "priority" }));
      } else if (state.field === "priority") {
        setState((s) => ({ ...s, buffer: "", field: "tags" }));
      } else if (state.field === "tags") {
        setState((s) => ({ ...s, tags: s.buffer.trim(), buffer: "", field: "confirm" }));
      } else if (state.field === "confirm") {
        onComplete(state);
        exit();
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (state.field === "priority") return; // priority uses left/right
      setState((s) => ({ ...s, buffer: s.buffer.slice(0, -1) }));
      return;
    }

    if (state.field === "priority") {
      if (key.leftArrow || key.rightArrow) {
        const idx = PRIORITIES.indexOf(state.priority);
        const next = key.rightArrow
          ? PRIORITIES[(idx + 1) % PRIORITIES.length]!
          : PRIORITIES[(idx - 1 + PRIORITIES.length) % PRIORITIES.length]!;
        setState((s) => ({ ...s, priority: next }));
      }
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setState((s) => ({ ...s, buffer: s.buffer + input }));
    }
  });

  const fieldLabel = (label: string, field: AddFormState["field"], value: string, hint?: string) => {
    const active = state.field === field;
    const displayValue = active ? state.buffer + (active ? "█" : "") : value;
    return (
      <Box key={field} flexDirection="row" gap={1}>
        <Text color={active ? "cyan" : "gray"}>{active ? "→" : " "}</Text>
        <Text color={active ? "white" : "gray"} bold={active}>{label}:</Text>
        <Text color={active ? "white" : "gray"}>{displayValue || (hint ? hint : "")}</Text>
        {!displayValue && hint && <Text color="gray"> </Text>}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" gap={0} paddingY={1}>
      <Text bold color="cyan"> New Test Scenario</Text>
      <Text color="gray"> ─────────────────────────────</Text>
      {fieldLabel("  Name       ", "name", state.name)}
      {fieldLabel("  URL        ", "url", state.url, "(optional)")}
      {fieldLabel("  Description", "description", state.description, "(optional)")}
      <Box flexDirection="row" gap={1}>
        <Text color={state.field === "priority" ? "cyan" : "gray"}>{state.field === "priority" ? "→" : " "}</Text>
        <Text color={state.field === "priority" ? "white" : "gray"} bold={state.field === "priority"}>  Priority   :</Text>
        {PRIORITIES.map((p) => (
          <Text key={p} color={p === state.priority ? "cyan" : "gray"} bold={p === state.priority}>{p === state.priority ? `[${p}]` : ` ${p} `}</Text>
        ))}
        {state.field === "priority" && <Text color="gray"> ← →</Text>}
      </Box>
      {fieldLabel("  Tags       ", "tags", state.tags, "comma-separated, optional")}

      {state.field === "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray"> ─────────────────────────────</Text>
          <Text bold color="white"> Preview:</Text>
          <Text color="gray">   name:        <Text color="white">{state.name}</Text></Text>
          {state.url && <Text color="gray">   url:         <Text color="white">{state.url}</Text></Text>}
          {state.description && <Text color="gray">   description: <Text color="white">{state.description}</Text></Text>}
          <Text color="gray">   priority:    <Text color="cyan">{state.priority}</Text></Text>
          {state.tags && <Text color="gray">   tags:        <Text color="white">{state.tags}</Text></Text>}
          <Text> </Text>
          <Text color="green"> Press Enter to save, Escape to cancel</Text>
        </Box>
      )}

      {state.field !== "confirm" && (
        <Text color="gray" dimColor> Tab/Enter to advance · Escape to cancel</Text>
      )}
    </Box>
  );
}

async function runInteractiveAdd(projectId: string | undefined): Promise<void> {
  let savedResult: AddFormState | null = null;

  const { waitUntilExit } = render(
    React.createElement(AddForm, {
      onComplete: (data) => {
        savedResult = data;
      },
    })
  );

  await waitUntilExit();

  if (savedResult) {
    const result = savedResult as AddFormState;
    const tags = result.tags ? result.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const scenario = createScenario({
      name: result.name,
      description: result.description || result.name,
      steps: [],
      tags,
      priority: result.priority as ScenarioPriority,
      projectId,
    });
    log(chalk.green(`\nCreated scenario ${chalk.bold(scenario.shortId)}: ${scenario.name}`));
  } else {
    log(chalk.dim("\nCancelled."));
  }
}

function formatToolInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    const truncated = str.length > 60 ? str.slice(0, 60) + "..." : str;
    parts.push(`${key}="${truncated}"`);
  }
  return parts.join(" ");
}

const program = new Command();

// ─── Global flags ────────────────────────────────────────────────────────────

let QUIET = false;
let NO_COLOR = false;

function log(...args: unknown[]) {
  if (QUIET) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

function logError(...args: unknown[]) {
  if (QUIET) return;
  // eslint-disable-next-line no-console
  console.error(...args);
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}


program
  .name("testers")
  .version(pkg.version)
  .description("AI-powered browser testing CLI")
  .option("-q, --quiet", "Suppress all output", false)
  .option("--no-color", "Disable color output");

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
  .command("add [name]")
  .alias("create")
  .description("Create a new test scenario (interactive if no name/flags given)")
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
  .option("--assert <assertion>", "Structured assertion (repeatable). Formats: selector:<sel> visible, text:<sel> contains:<text>, no-console-errors, url:contains:<path>, title:contains:<text>, count:<sel> eq:<n>", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .action(async (name: string | undefined, opts) => {
    try {
      // Interactive mode: no name and no meaningful flags provided
      const hasFlags = opts.description || opts.steps?.length || opts.tag?.length || opts.model || opts.path || opts.auth || opts.timeout || opts.template || opts.assert?.length;
      if (!name && !hasFlags) {
        const projectId = resolveProject(opts.project);
        await runInteractiveAdd(projectId);
        return;
      }

      if (!name) {
        logError(chalk.red("Error: scenario name is required"));
        process.exit(1);
      }

      if (opts.template) {
        const template = getTemplate(opts.template);
        if (!template) {
          logError(chalk.red(`Unknown template: ${opts.template}. Available: ${listTemplateNames().join(", ")}`));
          process.exit(1);
        }
        const projectId = resolveProject(opts.project);
        for (const input of template) {
          const s = createScenario({ ...input, projectId });
          log(chalk.green(`  Created ${s.shortId}: ${s.name}`));
        }
        return;
      }

      const assertions = (opts.assert as string[]).map(parseAssertionString);
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
        assertions: assertions.length > 0 ? assertions : undefined,
        projectId,
      });
      log(chalk.green(`Created scenario ${chalk.bold(scenario.shortId)}: ${scenario.name}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers list ───────────────────────────────────────────────────────────

program
  .command("list")
  .alias("ls")
  .description("List test scenarios")
  .option("-t, --tag <tag>", "Filter by tag")
  .option("-p, --priority <level>", "Filter by priority")
  .option("--project <id>", "Filter by project ID")
  .option("--search <text>", "Filter by name or description (case-insensitive substring match)")
  .option("--sort <field>", "Sort field: date, priority, name (default: date)")
  .option("--asc", "Sort ascending instead of descending", false)
  .option("-l, --limit <n>", "Limit results", "50")
  .option("--offset <n>", "Skip first N results", "0")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const scenarios = listScenarios({
        tags: opts.tag ? [opts.tag] : undefined,
        priority: opts.priority as ScenarioPriority | undefined,
        projectId: opts.project,
        search: opts.search,
        sort: opts.sort as "date" | "priority" | "name" | undefined,
        desc: !opts.asc,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10) || undefined,
      });
      if (opts.json) {
        log(JSON.stringify(scenarios, null, 2));
      } else {
        log(formatScenarioList(scenarios));
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers show <id> ─────────────────────────────────────────────────────

program
  .command("show <id>")
  .description("Show scenario details")
  .option("--json", "Output as JSON", false)
  .action((id: string, opts) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) {
        logError(chalk.red(`Scenario not found: ${id}`));
        process.exit(1);
      }

      if (opts.json) {
        log(JSON.stringify(scenario, null, 2));
        return;
      }

      log("");
      log(chalk.bold(`  Scenario ${scenario.shortId}`));
      log(`  Name:        ${scenario.name}`);
      log(`  ID:          ${chalk.dim(scenario.id)}`);
      log(`  Description: ${scenario.description}`);
      log(`  Priority:    ${scenario.priority}`);
      log(`  Model:       ${scenario.model ?? chalk.dim("default")}`);
      log(`  Tags:        ${scenario.tags.length > 0 ? scenario.tags.join(", ") : chalk.dim("none")}`);
      log(`  Path:        ${scenario.targetPath ?? chalk.dim("none")}`);
      log(`  Auth:        ${scenario.requiresAuth ? "yes" : "no"}`);
      log(`  Timeout:     ${scenario.timeoutMs ? `${scenario.timeoutMs}ms` : chalk.dim("default")}`);
      log(`  Version:     ${scenario.version}`);
      log(`  Created:     ${scenario.createdAt}`);
      log(`  Updated:     ${scenario.updatedAt}`);

      if (scenario.steps.length > 0) {
        log("");
        log(chalk.bold("  Steps:"));
        for (let i = 0; i < scenario.steps.length; i++) {
          log(`    ${i + 1}. ${scenario.steps[i]}`);
        }
      }

      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
  .option("-t, --tag <tag>", "Replace all tags (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("--tag-add <tag>", "Add a tag to existing tags (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("--tag-remove <tag>", "Remove a tag from existing tags (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("-p, --priority <level>", "New priority")
  .option("-m, --model <model>", "New model")
  .action((id: string, opts) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) {
        logError(chalk.red(`Scenario not found: ${id}`));
        process.exit(1);
      }

      // Compute new tags: --tag replaces all; --tag-add/--tag-remove mutate existing
      let newTags: string[] | undefined;
      if (opts.tag.length > 0) {
        // Full replacement
        newTags = opts.tag;
      } else if (opts.tagAdd.length > 0 || opts.tagRemove.length > 0) {
        const existing = new Set(scenario.tags);
        for (const t of opts.tagAdd) existing.add(t);
        for (const t of opts.tagRemove) existing.delete(t);
        newTags = [...existing];
      }

      const updated = updateScenario(
        scenario.id,
        {
          name: opts.name,
          description: opts.description,
          steps: opts.steps.length > 0 ? opts.steps : undefined,
          tags: newTags,
          priority: opts.priority as ScenarioPriority | undefined,
          model: opts.model,
        },
        scenario.version,
      );

      log(chalk.green(`Updated scenario ${chalk.bold(updated.shortId)}: ${updated.name}`));
      if (newTags !== undefined) {
        log(chalk.dim(`  Tags: [${updated.tags.join(", ")}]`));
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers delete <id> ───────────────────────────────────────────────────

program
  .command("delete <id>")
  .description("Delete a scenario")
  .option("-y, --yes", "Skip confirmation prompt", false)
  .action(async (id: string, opts) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) {
        logError(chalk.red(`Scenario not found: ${id}`));
        process.exit(1);
      }

      if (!opts.yes) {
        // Prompt for confirmation
        process.stdout.write(chalk.yellow(`Delete scenario ${scenario.shortId} "${scenario.name}"? [y/N] `));
        const answer = await new Promise<string>((resolve) => {
          let buf = "";
          process.stdin.setRawMode?.(true);
          process.stdin.resume();
          process.stdin.once("data", (chunk) => {
            buf = chunk.toString().trim().toLowerCase();
            process.stdin.setRawMode?.(false);
            process.stdin.pause();
            process.stdout.write("\n");
            resolve(buf);
          });
        });
        if (answer !== "y" && answer !== "yes") {
          log(chalk.dim("Cancelled."));
          return;
        }
      }

      const deleted = deleteScenario(scenario.id);
      if (deleted) {
        log(chalk.green(`Deleted scenario ${scenario.shortId}: ${scenario.name}`));
      } else {
        logError(chalk.red(`Failed to delete scenario: ${id}`));
        process.exit(1);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers remove <id>  (alias for delete) ────────────────────────────────

program
  .command("remove <id>")
  .alias("uninstall")
  .description("Remove a scenario (alias for delete)")
  .option("-y, --yes", "Skip confirmation prompt", false)
  .action(async (id: string, opts) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) {
        logError(chalk.red(`Scenario not found: ${id}`));
        process.exit(1);
      }

      if (!opts.yes) {
        process.stdout.write(chalk.yellow(`Remove scenario ${scenario.shortId} "${scenario.name}"? [y/N] `));
        const answer = await new Promise<string>((resolve) => {
          let buf = "";
          process.stdin.setRawMode?.(true);
          process.stdin.resume();
          process.stdin.once("data", (chunk) => {
            buf = chunk.toString().trim().toLowerCase();
            process.stdin.setRawMode?.(false);
            process.stdin.pause();
            process.stdout.write("\n");
            resolve(buf);
          });
        });
        if (answer !== "y" && answer !== "yes") {
          log(chalk.dim("Cancelled."));
          return;
        }
      }

      const deleted = deleteScenario(scenario.id);
      if (deleted) {
        log(chalk.green(`Removed scenario ${scenario.shortId}: ${scenario.name}`));
      } else {
        logError(chalk.red(`Failed to remove scenario: ${id}`));
        process.exit(1);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers run <url> [description] ───────────────────────────────────────

program
  .command("run [url] [description]")
  .alias("test")
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
  .option("--browser <engine>", "Browser engine: playwright or lightpanda", "playwright")
  .option("--env <name>", "Use a named environment for the URL")
  .option("--dry-run", "Print what would run without launching browser", false)
  .option("--retry <n>", "Retry failed scenarios up to n times", "0")
  .option("--verbose", "Show per-step timing and full tool results", false)
  .option("--watch-results", "When used with --background, poll and display live results table until run completes", false)
  .option("--failed-only", "Only show failed/error scenarios in output (passed count shown as summary)", false)
  .option("--smoke", "Run only smoke-tagged scenarios (fast validation suite, <2 min)", false)
  .action(async (urlArg: string | undefined, description: string | undefined, opts) => {
    try {
      const projectId = resolveProject(opts.project);

      // Resolve URL: explicit arg > --env > default environment
      let url = urlArg;
      if (!url && opts.env) {
        const env = getEnvironment(opts.env);
        if (!env) {
          logError(chalk.red(`Environment not found: ${opts.env}`));
          process.exit(1);
        }
        url = env.url;
      }
      if (!url) {
        const defaultEnv = getDefaultEnvironment();
        if (defaultEnv) {
          url = defaultEnv.url;
          log(chalk.dim(`Using default environment: ${defaultEnv.name} (${defaultEnv.url})`));
        }
      }
      if (!url) {
        logError(chalk.red("No URL provided. Pass a URL argument, use --env <name>, or set a default environment with 'testers env use <name>'."));
        process.exit(1);
      }


      // Budget warning check (OPE9-00080)
      if (!opts.dryRun && !opts.background) {
        const budgetResult = checkBudget(0); // 0 = just check daily threshold
        if (budgetResult.warning) {
          log(chalk.yellow(`  ⚠️  Budget warning: ${budgetResult.warning}`));
          if (!budgetResult.allowed) {
            if (!opts.yes) {
              log(chalk.yellow("  Use --yes to run anyway, or check your budget config."));
              process.exit(1);
            }
            log(chalk.yellow("  --yes passed, proceeding despite budget limit."));
          }
        }
      }

      // --smoke is shorthand for --tag smoke
      if (opts.smoke && !opts.tag.includes("smoke")) {
        opts.tag.push("smoke");
        log(chalk.dim("  Running smoke suite (scenarios tagged 'smoke')..."));
      }

      // If --from-todos, import scenarios first
      if (opts.fromTodos) {
        const result = importFromTodos({ projectId });
        log(chalk.blue(`Imported ${result.imported} scenarios from todos (${result.skipped} skipped)`));
      }

      // Dry-run mode — validate and print what would run, no browser
      if (opts.dryRun) {
        const dryScenarios = listScenarios({
          tags: opts.tag.length > 0 ? opts.tag : undefined,
          projectId,
        }).filter((s) => {
          if (opts.scenario && s.id !== opts.scenario && s.shortId !== opts.scenario) return false;
          if (opts.priority && s.priority !== opts.priority) return false;
          return true;
        });

        log("");
        log(chalk.bold("  Dry Run — scenarios that would execute:"));
        log("");
        if (dryScenarios.length === 0) {
          log(chalk.yellow("  No matching scenarios found."));
        } else {
          for (const s of dryScenarios) {
            // Validate assertion syntax
            const assertionErrors: string[] = [];
            for (const a of (s.assertions ?? [])) {
              try { parseAssertionString(a); } catch { assertionErrors.push(a); }
            }
            // Check auth preset exists if required
            let authOk = true;
            if (s.authPreset) {
              const presets = listAuthPresets();
              authOk = presets.some((p) => p.name === s.authPreset);
            }
            const statusIcon = (assertionErrors.length === 0 && authOk) ? chalk.green("✓") : chalk.red("✗");
            log(`  ${statusIcon} ${chalk.cyan(s.shortId)} ${s.name} ${chalk.dim(`[${s.tags.join(", ")}]`)}`);
            if (assertionErrors.length > 0) {
              log(chalk.red(`      Invalid assertions: ${assertionErrors.join(", ")}`));
            }
            if (!authOk) {
              log(chalk.red(`      Auth preset not found: ${s.authPreset}`));
            }
          }
        }
        log("");
        log(chalk.dim(`  URL: ${url}`));
        log(chalk.dim(`  Total: ${dryScenarios.length} scenarios`));
        log("");
        process.exit(0);
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
          engine: opts.browser,
        });
        log(chalk.green(`Run started in background: ${chalk.bold(runId.slice(0, 8))}`));
        log(chalk.dim(`  Scenarios: ${scenarioCount}`));
        log(chalk.dim(`  URL: ${url}`));

        if (opts.watchResults) {
          // Poll every 3 seconds and render a live table until the run completes
          log(chalk.dim(`  Watching results (polling every 3s)...`));
          log("");
          const POLL_INTERVAL = 3000;
          const DONE_STATUSES = new Set(["passed", "failed", "cancelled"]);

          const renderTable = () => {
            const run = getRun(runId);
            if (!run) return;
            const results = getResultsByRun(runId);

            // Clear previous table by moving cursor up (rough approach: reprint header)
            const statusIcon = run.status === "passed"
              ? chalk.green("PASS")
              : run.status === "failed"
                ? chalk.red("FAIL")
                : chalk.blue("RUN ");

            process.stdout.write(`\r  ${statusIcon}  ${run.passed} passed  ${run.failed} failed  ${run.total - run.passed - run.failed} running  (${results.length}/${run.total})\n`);

            for (const r of results) {
              const scenario = getScenario(r.scenarioId);
              const name = scenario ? scenario.name : r.scenarioId.slice(0, 8);
              const icon = r.status === "passed"
                ? chalk.green("✓")
                : r.status === "failed"
                  ? chalk.red("✗")
                  : r.status === "error"
                    ? chalk.yellow("!")
                    : chalk.blue("…");
              const dur = r.durationMs > 0 ? chalk.dim(` ${(r.durationMs / 1000).toFixed(1)}s`) : "";
              process.stdout.write(`    ${icon} ${name}${dur}\n`);
            }
          };

          await new Promise<void>((resolve) => {
            const poll = setInterval(() => {
              const run = getRun(runId);
              if (!run) return;
              renderTable();
              if (DONE_STATUSES.has(run.status)) {
                clearInterval(poll);
                resolve();
              }
            }, POLL_INTERVAL);
          });

          const finalRun = getRun(runId);
          if (finalRun) {
            log("");
            const results = getResultsByRun(runId);
            log(formatTerminal(finalRun, results));
          }
          process.exit(finalRun ? getExitCode(finalRun) : 0);
        }

        log(chalk.dim(`  Check progress: testers results ${runId.slice(0, 8)}`));
        process.exit(0);
      }

      // Register live progress handler for foreground runs
      if (!opts.json && !opts.output) {
        const verbose = !!opts.verbose;
        onRunEvent((event) => {
          switch (event.type) {
            case "scenario:start":
              if (event.retryAttempt) {
                log(chalk.yellow(`  [retry] Retrying scenario ${event.scenarioName ?? event.scenarioId} (attempt ${event.retryAttempt}/${event.maxRetries})...`));
              } else {
                log(chalk.blue(`  [start] ${event.scenarioName ?? event.scenarioId}`));
              }
              break;
            case "scenario:timeout_warning": {
              const elapsedS = ((event.elapsedMs ?? 0) / 1000).toFixed(0);
              const totalS = ((event.timeoutMs ?? 0) / 1000).toFixed(0);
              log(chalk.yellow(`  ⚠️  Scenario '${event.scenarioName}' at 80% timeout (${elapsedS}s/${totalS}s) — still running`));
              break;
            }
            case "step:thinking":
              if (event.thinking) {
                const preview = event.thinking.length > 120 ? event.thinking.slice(0, 120) + "..." : event.thinking;
                log(chalk.dim(`    [think] ${preview}`));
              }
              break;
            case "step:tool_call":
              log(chalk.cyan(`    [step ${event.stepNumber}] ${event.toolName}${event.toolInput ? ` ${formatToolInput(event.toolInput)}` : ""}`));
              break;
            case "step:tool_result":
              if (event.toolName === "report_result") {
                log(chalk.bold(`    [result] ${event.toolResult}`));
              } else {
                const durationStr = verbose && event.stepDurationMs !== undefined
                  ? chalk.dim(`[${(event.stepDurationMs / 1000).toFixed(1)}s] `)
                  : "";
                const resultPreview = (event.toolResult ?? "").length > 100 ? (event.toolResult ?? "").slice(0, 100) + "..." : (event.toolResult ?? "");
                log(chalk.dim(`    [done]  ${durationStr}${resultPreview}`));
              }
              break;
            case "screenshot:captured":
              log(chalk.dim(`    [screenshot] ${event.screenshotPath}`));
              break;
            case "scenario:pass":
              log(chalk.green(`  [PASS] ${event.scenarioName}`));
              break;
            case "scenario:fail":
              log(chalk.red(`  [FAIL] ${event.scenarioName}`));
              break;
            case "scenario:error":
              log(chalk.yellow(`  [ERR]  ${event.scenarioName}: ${event.error}`));
              break;
          }
        });
        log("");
        log(chalk.bold(`  Running tests against ${url}`));
        log("");
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
          retry: parseInt(opts.retry ?? "0", 10),
          projectId,
          engine: opts.browser,
        });

        if (opts.json || opts.output) {
          const jsonOutput = formatJSON(run, results);
          if (opts.output) {
            writeFileSync(opts.output, jsonOutput, "utf-8");
            log(chalk.green(`Results written to ${opts.output}`));
          }
          if (opts.json) {
            log(jsonOutput);
          }
        } else {
          log(formatTerminal(run, results, { failedOnly: opts.failedOnly }));
        }

        process.exit(getExitCode(run));
      }

      // If no filters provided, run all active scenarios
      const noFilters = !opts.scenario && opts.tag.length === 0 && !opts.priority;
      if (noFilters && !opts.json && !opts.output) {
        const allScenarios = listScenarios({ projectId });
        log(chalk.bold(`  Running all ${allScenarios.length} scenarios...`));
        log("");
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
        retry: parseInt(opts.retry ?? "0", 10),
        projectId,
        engine: opts.browser,
      });

      if (opts.json || opts.output) {
        const jsonOutput = formatJSON(run, results);
        if (opts.output) {
          writeFileSync(opts.output, jsonOutput, "utf-8");
          log(chalk.green(`Results written to ${opts.output}`));
        }
        if (opts.json) {
          log(jsonOutput);
        }
      } else {
        log(formatTerminal(run, results, { failedOnly: opts.failedOnly }));
      }

      process.exit(getExitCode(run));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers runs ───────────────────────────────────────────────────────────

program
  .command("runs")
  .description("List past test runs")
  .option("--status <status>", "Filter by status")
  .option("--sort <field>", "Sort field: date, duration, cost (default: date)")
  .option("--asc", "Sort ascending instead of descending", false)
  .option("-l, --limit <n>", "Limit results", "20")
  .option("--offset <n>", "Skip first N results", "0")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const runs = listRuns({
        status: opts.status as "pending" | "running" | "passed" | "failed" | "cancelled" | undefined,
        sort: opts.sort as "date" | "duration" | "cost" | undefined,
        desc: !opts.asc,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10) || undefined,
      });
      if (opts.json) {
        log(JSON.stringify(runs, null, 2));
      } else {
        log(formatRunList(runs));
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers results <run-id> ───────────────────────────────────────────────

program
  .command("results <run-id>")
  .description("Show results for a test run")
  .option("--json", "Output as JSON", false)
  .action((runId: string, opts) => {
    try {
      const run = getRun(runId);
      if (!run) {
        logError(chalk.red(`Run not found: ${runId}`));
        process.exit(1);
      }

      const results = getResultsByRun(run.id);
      if (opts.json) {
        log(formatJSON(run, results));
      } else {
        log(formatTerminal(run, results));
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        log("");
        log(chalk.bold(`  Screenshots for run ${run.id.slice(0, 8)}`));
        log("");

        for (const result of results) {
          const screenshots = listScreenshots(result.id);
          if (screenshots.length > 0) {
            const scenario = getScenario(result.scenarioId);
            const label = scenario ? `${scenario.shortId}: ${scenario.name}` : result.scenarioId.slice(0, 8);
            log(chalk.bold(`  ${label}`));
            for (const ss of screenshots) {
              log(`    ${chalk.dim(String(ss.stepNumber).padStart(3, "0"))} ${ss.action} — ${chalk.dim(ss.filePath)}`);
              total++;
            }
            log("");
          }
        }

        if (total === 0) {
          log(chalk.dim("  No screenshots found."));
          log("");
        }
        return;
      }

      // Try as result-id
      const screenshots = listScreenshots(id);
      if (screenshots.length > 0) {
        log("");
        log(chalk.bold(`  Screenshots for result ${id.slice(0, 8)}`));
        log("");
        for (const ss of screenshots) {
          log(`  ${chalk.dim(String(ss.stepNumber).padStart(3, "0"))} ${ss.action} — ${chalk.dim(ss.filePath)}`);
        }
        log("");
        return;
      }

      logError(chalk.red(`No screenshots found for: ${id}`));
      process.exit(1);
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        log(chalk.dim("No .md files found in directory."));
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

        log(chalk.green(`  Imported ${chalk.bold(scenario.shortId)}: ${scenario.name}`));
        imported++;
      }

      log("");
      log(chalk.green(`Imported ${imported} scenario(s) from ${absDir}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers export [format] ────────────────────────────────────────────────

program
  .command("export [format]")
  .description("Export scenarios as JSON (default) or markdown files")
  .option("-o, --output <path>", "Output file (JSON) or directory (markdown)")
  .option("-t, --tag <tag>", "Filter by tag")
  .option("-p, --priority <level>", "Filter by priority")
  .option("--project <id>", "Filter by project ID")
  .action((format: string | undefined, opts) => {
    try {
      const fmt = (format ?? "json").toLowerCase();
      if (fmt !== "json" && fmt !== "markdown") {
        logError(chalk.red(`Unknown format: ${fmt}. Supported: json, markdown`));
        process.exit(1);
      }

      const projectId = resolveProject(opts.project);
      const scenarios = listScenarios({
        tags: opts.tag ? [opts.tag] : undefined,
        priority: opts.priority as ScenarioPriority | undefined,
        projectId,
      });

      if (scenarios.length === 0) {
        log(chalk.dim("No scenarios found to export."));
        return;
      }

      if (fmt === "json") {
        const outputPath = opts.output ?? "testers-export.json";
        const data = JSON.stringify(scenarios, null, 2);
        writeFileSync(outputPath, data, "utf-8");
        log(chalk.green(`Exported ${scenarios.length} scenario(s) to ${resolve(outputPath)}`));
        return;
      }

      // Markdown: one .md file per scenario
      const outputDir = opts.output ?? ".";
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      for (const s of scenarios) {
        const lines: string[] = [];
        lines.push(`# ${s.name}`);
        lines.push("");
        if (s.description && s.description !== s.name) {
          lines.push(s.description);
          lines.push("");
        }
        if (s.tags.length > 0) {
          lines.push(`**Tags:** ${s.tags.join(", ")}`);
        }
        lines.push(`**Priority:** ${s.priority}`);
        if (s.targetPath) {
          lines.push(`**Path:** ${s.targetPath}`);
        }
        lines.push("");
        if (s.steps.length > 0) {
          lines.push("## Steps");
          lines.push("");
          for (const step of s.steps) {
            lines.push(`- [ ] ${step}`);
          }
          lines.push("");
        }

        const safeFilename = s.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80);
        const filePath = join(outputDir, `${s.shortId}-${safeFilename}.md`);
        writeFileSync(filePath, lines.join("\n"), "utf-8");
        log(chalk.dim(`  ${s.shortId}: ${s.name} → ${filePath}`));
      }

      log(chalk.green(`\nExported ${scenarios.length} scenario(s) as markdown to ${resolve(outputDir)}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
      log(JSON.stringify(config, null, 2));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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

      log("");
      log(chalk.bold("  Open Testers Status"));
      log("");
      log(`  ANTHROPIC_API_KEY: ${hasApiKey ? chalk.green("set") : chalk.red("not set")}`);
      log(`  Database:          ${dbPath}`);
      log(`  Default model:     ${config.defaultModel}`);
      log(`  Screenshots dir:   ${config.screenshots.dir}`);
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers install-browser ────────────────────────────────────────────────

program
  .command("install-browser")
  .description("Install browser engine")
  .option("--engine <engine>", "Engine to install: playwright, lightpanda, or all", "playwright")
  .action(async (opts) => {
    try {
      if (opts.engine === "all" || opts.engine === "playwright") {
        log(chalk.blue("Installing Playwright Chromium..."));
        await installBrowser("playwright");
        log(chalk.green("Playwright Chromium installed."));
      }
      if (opts.engine === "all" || opts.engine === "lightpanda") {
        log(chalk.blue("Installing Lightpanda..."));
        await installBrowser("lightpanda");
        log(chalk.green("Lightpanda installed."));
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
      log(chalk.green(`Created project ${chalk.bold(project.name)} (${project.id})`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        log(chalk.dim("No projects found."));
        return;
      }
      log("");
      log(chalk.bold("  Projects"));
      log("");
      log(`  ${"ID".padEnd(38)} ${"Name".padEnd(24)} ${"Path".padEnd(30)} Created`);
      log(`  ${"─".repeat(38)} ${"─".repeat(24)} ${"─".repeat(30)} ${"─".repeat(20)}`);
      for (const p of projects) {
        log(`  ${p.id.padEnd(38)} ${p.name.padEnd(24)} ${(p.path ?? chalk.dim("—")).toString().padEnd(30)} ${p.createdAt}`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        logError(chalk.red(`Project not found: ${id}`));
        process.exit(1);
      }
      log("");
      log(chalk.bold(`  Project: ${project.name}`));
      log(`  ID:          ${project.id}`);
      log(`  Path:        ${project.path ?? chalk.dim("none")}`);
      log(`  Description: ${project.description ?? chalk.dim("none")}`);
      log(`  Created:     ${project.createdAt}`);
      log(`  Updated:     ${project.updatedAt}`);
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
      log(chalk.green(`Active project set to ${chalk.bold(project.name)} (${project.id})`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
      log(chalk.green(`Created schedule ${chalk.bold(schedule.name)} (${schedule.id})`));
      if (schedule.nextRunAt) {
        log(chalk.dim(`  Next run at: ${schedule.nextRunAt}`));
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("list")
  .description("List schedules")
  .option("--project <id>", "Filter by project ID")
  .option("--enabled", "Show only enabled schedules")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const projectId = resolveProject(opts.project);
      const schedules = listSchedules({
        projectId,
        enabled: opts.enabled ? true : undefined,
      });
      if (opts.json) {
        log(JSON.stringify(schedules, null, 2));
        return;
      }
      if (schedules.length === 0) {
        log(chalk.dim("No schedules found."));
        return;
      }
      log("");
      log(chalk.bold("  Schedules"));
      log("");
      log(`  ${"Name".padEnd(20)} ${"Cron".padEnd(18)} ${"URL".padEnd(30)} ${"Enabled".padEnd(9)} ${"Next Run".padEnd(22)} Last Run`);
      log(`  ${"─".repeat(20)} ${"─".repeat(18)} ${"─".repeat(30)} ${"─".repeat(9)} ${"─".repeat(22)} ${"─".repeat(22)}`);
      for (const s of schedules) {
        const enabled = s.enabled ? chalk.green("yes") : chalk.red("no");
        const nextRun = s.nextRunAt ?? chalk.dim("—");
        const lastRun = s.lastRunAt ?? chalk.dim("—");
        log(`  ${s.name.padEnd(20)} ${s.cronExpression.padEnd(18)} ${s.url.padEnd(30)} ${enabled.toString().padEnd(9)} ${nextRun.toString().padEnd(22)} ${lastRun}`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        logError(chalk.red(`Schedule not found: ${id}`));
        process.exit(1);
      }
      log("");
      log(chalk.bold(`  Schedule: ${schedule.name}`));
      log(`  ID:          ${schedule.id}`);
      log(`  Cron:        ${schedule.cronExpression}`);
      log(`  URL:         ${schedule.url}`);
      log(`  Enabled:     ${schedule.enabled ? chalk.green("yes") : chalk.red("no")}`);
      log(`  Model:       ${schedule.model ?? chalk.dim("default")}`);
      log(`  Headed:      ${schedule.headed ? "yes" : "no"}`);
      log(`  Parallel:    ${schedule.parallel}`);
      log(`  Timeout:     ${schedule.timeoutMs ? `${schedule.timeoutMs}ms` : chalk.dim("default")}`);
      log(`  Project:     ${schedule.projectId ?? chalk.dim("none")}`);
      log(`  Filter:      ${JSON.stringify(schedule.scenarioFilter)}`);
      log(`  Next run:    ${schedule.nextRunAt ?? chalk.dim("not scheduled")}`);
      log(`  Last run:    ${schedule.lastRunAt ?? chalk.dim("never")}`);
      log(`  Last run ID: ${schedule.lastRunId ?? chalk.dim("none")}`);
      log(`  Created:     ${schedule.createdAt}`);
      log(`  Updated:     ${schedule.updatedAt}`);
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("enable <id>")
  .description("Enable a schedule")
  .action((id: string) => {
    try {
      const schedule = updateSchedule(id, { enabled: true });
      log(chalk.green(`Enabled schedule ${chalk.bold(schedule.name)}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

scheduleCmd
  .command("disable <id>")
  .description("Disable a schedule")
  .action((id: string) => {
    try {
      const schedule = updateSchedule(id, { enabled: false });
      log(chalk.green(`Disabled schedule ${chalk.bold(schedule.name)}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        log(chalk.green(`Deleted schedule: ${id}`));
      } else {
        logError(chalk.red(`Schedule not found: ${id}`));
        process.exit(1);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        logError(chalk.red(`Schedule not found: ${id}`));
        process.exit(1);
        return;
      }

      log(chalk.blue(`Running schedule ${chalk.bold(schedule.name)} against ${schedule.url}...`));

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
        log(formatJSON(run, results));
      } else {
        log(formatTerminal(run, results));
      }

      process.exit(getExitCode(run));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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

      log(chalk.blue("Scheduler daemon started. Press Ctrl+C to stop."));
      log(chalk.dim(`  Check interval: ${opts.interval}s`));

      let running = true;

      const checkAndRun = async () => {
        while (running) {
          try {
            const schedules = listSchedules({ enabled: true });
            const now = new Date().toISOString();

            for (const schedule of schedules) {
              if (schedule.nextRunAt && schedule.nextRunAt <= now) {
                log(chalk.blue(`[${new Date().toISOString()}] Triggering schedule: ${schedule.name}`));
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
                  log(`  ${statusColor(run.status)} — ${run.passed}/${run.total} passed`);

                  // Update schedule with last run info
                  updateSchedule(schedule.id, {});
                } catch (err) {
                  logError(chalk.red(`  Error running schedule ${schedule.name}: ${err instanceof Error ? err.message : String(err)}`));
                }
              }
            }
          } catch (err) {
            logError(chalk.red(`Daemon error: ${err instanceof Error ? err.message : String(err)}`));
          }

          // Wait for next check
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      };

      process.on("SIGINT", () => {
        log(chalk.yellow("\nShutting down scheduler daemon..."));
        running = false;
        process.exit(0);
      });

      process.on("SIGTERM", () => {
        log(chalk.yellow("\nShutting down scheduler daemon..."));
        running = false;
        process.exit(0);
      });

      await checkAndRun();
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
  .option("--ci <provider>", "Generate CI workflow (github)")
  .action(async (opts) => {
    try {
      const { project, scenarios, framework, url } = initProject({
        name: opts.name,
        url: opts.url,
        path: opts.path,
      });

      log("");
      log(chalk.bold("  Project initialized!"));
      log("");

      if (framework) {
        log(`  Framework:  ${chalk.cyan(framework.name)}`);
        if (framework.features.length > 0) {
          log(`  Features:   ${chalk.dim(framework.features.join(", "))}`);
        }
      } else {
        log(`  Framework:  ${chalk.dim("not detected")}`);
      }

      log(`  Project:    ${chalk.green(project.name)} ${chalk.dim(`(${project.id})`)}`);
      log(`  Scenarios:  ${chalk.green(String(scenarios.length))} starter scenarios created`);
      log("");

      for (const s of scenarios) {
        log(`    ${chalk.dim(s.shortId)} ${s.name} ${chalk.dim(`[${s.tags.join(", ")}]`)}`);
      }

      // Generate CI workflow if requested
      if (opts.ci === "github") {
        const workflowDir = join(process.cwd(), ".github", "workflows");
        if (!existsSync(workflowDir)) {
          mkdirSync(workflowDir, { recursive: true });
        }
        const workflowPath = join(workflowDir, "testers.yml");
        writeFileSync(workflowPath, generateGitHubActionsWorkflow(), "utf-8");
        log(`  CI:         ${chalk.green("GitHub Actions workflow written to .github/workflows/testers.yml")}`);
      } else if (opts.ci) {
        log(chalk.yellow(`  Unknown CI provider: ${opts.ci}. Supported: github`));
      }

      log("");

      // ── Interactive post-init wizard ───────────────────────────────────
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

      try {
        // Step: configure environments
        const envAnswer = await ask("  Would you like to configure environments? [y/N] ");
        if (envAnswer.trim().toLowerCase() === "y") {
          const envName = await ask("  Environment name (default: staging): ");
          const envUrl = await ask(`  Base URL (default: ${url}): `);
          const resolvedEnvName = envName.trim() || "staging";
          const resolvedEnvUrl = envUrl.trim() || url;
          createEnvironment({ name: resolvedEnvName, url: resolvedEnvUrl, projectId: project.id, isDefault: true });
          log(chalk.green(`  ✓ Environment '${resolvedEnvName}' created (${resolvedEnvUrl})`));
          log("");
        }

        // Step: create first scenario
        const scenarioAnswer = await ask("  Would you like to create your first test scenario? [y/N] ");
        if (scenarioAnswer.trim().toLowerCase() === "y") {
          const scenarioName = await ask("  Scenario name: ");
          const scenarioUrl = await ask(`  URL to test (default: ${url}): `);
          const resolvedScenarioName = scenarioName.trim() || "My first scenario";
          const resolvedScenarioUrl = scenarioUrl.trim() || url;
          const newScenario = createScenario({
            name: resolvedScenarioName,
            description: `Navigate to ${resolvedScenarioUrl} and verify it loads correctly.`,
            projectId: project.id,
            targetPath: resolvedScenarioUrl,
            tags: ["smoke"],
            priority: "high",
          });
          log(chalk.green(`  ✓ Scenario '${newScenario.name}' created ${chalk.dim(`(${newScenario.shortId})`)}`));
          log("");
        }
      } finally {
        rl.close();
      }

      log(chalk.bold("  Next steps:"));
      log(`    1. Start your dev server`);
      log(`    2. Run ${chalk.cyan("testers run <url>")} to execute tests`);
      log(`    3. Add more scenarios with ${chalk.cyan("testers add <name>")}`);
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        logError(chalk.red(`Run not found: ${runId}`));
        process.exit(1);
      }

      const originalResults = getResultsByRun(originalRun.id);
      const scenarioIds = originalResults.map(r => r.scenarioId);

      if (scenarioIds.length === 0) {
        log(chalk.dim("No scenarios to replay."));
        return;
      }

      log(chalk.blue(`Replaying ${scenarioIds.length} scenarios from run ${originalRun.id.slice(0, 8)}...`));

      const { run, results } = await runByFilter({
        url: opts.url ?? originalRun.url,
        scenarioIds,
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
      });

      if (opts.json) {
        log(formatJSON(run, results));
      } else {
        log(formatTerminal(run, results));
      }
      process.exit(getExitCode(run));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        logError(chalk.red(`Run not found: ${runId}`));
        process.exit(1);
      }

      const originalResults = getResultsByRun(originalRun.id);
      const failedScenarioIds = originalResults
        .filter(r => r.status === "failed" || r.status === "error")
        .map(r => r.scenarioId);

      if (failedScenarioIds.length === 0) {
        log(chalk.green("No failed scenarios to retry. All passed!"));
        return;
      }

      log(chalk.blue(`Retrying ${failedScenarioIds.length} failed scenarios from run ${originalRun.id.slice(0, 8)}...`));

      const { run, results } = await runByFilter({
        url: opts.url ?? originalRun.url,
        scenarioIds: failedScenarioIds,
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
      });

      // Show comparison
      if (!opts.json) {
        log("");
        log(chalk.bold("  Comparison with original run:"));
        for (const result of results) {
          const original = originalResults.find(r => r.scenarioId === result.scenarioId);
          if (original) {
            const changed = original.status !== result.status;
            const arrow = changed
              ? chalk.yellow(`${original.status} → ${result.status}`)
              : chalk.dim(`${result.status} (unchanged)`);
            const icon = result.status === "passed" ? chalk.green("✓") : chalk.red("✗");
            // Get scenario name from the getScenario import
            log(`  ${icon} ${result.scenarioId.slice(0, 8)}: ${arrow}`);
          }
        }
        log("");
      }

      if (opts.json) {
        log(formatJSON(run, results));
      } else {
        log(formatTerminal(run, results));
      }
      process.exit(getExitCode(run));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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

      log(chalk.blue(`Running smoke test against ${chalk.bold(url)}...`));
      log("");

      const smokeResult = await runSmoke({
        url,
        model: opts.model,
        headed: opts.headed,
        timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
        projectId,
      });

      if (opts.json) {
        log(JSON.stringify({
          run: smokeResult.run,
          result: smokeResult.result,
          pagesVisited: smokeResult.pagesVisited,
          issues: smokeResult.issuesFound,
        }, null, 2));
      } else {
        log(formatSmokeReport(smokeResult));
      }

      // Exit with non-zero if critical/high issues found
      const hasCritical = smokeResult.issuesFound.some(
        (i) => i.severity === "critical" || i.severity === "high"
      );
      process.exit(hasCritical ? 1 : 0);
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers diff <run1> <run2> ──────────────────────────────────────────────

program
  .command("diff <run1> <run2>")
  .description("Compare two test runs")
  .option("--json", "JSON output", false)
  .option("--threshold <percent>", "Visual diff threshold percentage", "0.1")
  .action((run1: string, run2: string, opts) => {
    try {
      const diff = diffRuns(run1, run2);
      if (opts.json) {
        log(formatDiffJSON(diff));
      } else {
        log(formatDiffTerminal(diff));
      }

      // Visual screenshot diff
      const threshold = parseFloat(opts.threshold);
      const visualResults = compareRunScreenshots(run2, run1, threshold);
      if (visualResults.length > 0) {
        if (opts.json) {
          log(JSON.stringify({ visualDiff: visualResults }, null, 2));
        } else {
          log(formatVisualDiffTerminal(visualResults, threshold));
        }
      }

      // Exit 1 if status regressions or visual regressions found
      const hasVisualRegressions = visualResults.some((r) => r.isRegression);
      process.exit(diff.regressions.length > 0 || hasVisualRegressions ? 1 : 0);
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers report [run-id] ─────────────────────────────────────────────────

program
  .command("report [run-id]")
  .description("Generate HTML test report")
  .option("--latest", "Use most recent run", false)
  .option("-o, --output <file>", "Output file path", "report.html")
  .option("--open", "Open the report in the browser after generating", false)
  .action((runId: string | undefined, opts) => {
    try {
      let html: string;
      if (opts.latest || !runId) {
        html = generateLatestReport();
      } else {
        html = generateHtmlReport(runId);
      }
      writeFileSync(opts.output, html, "utf-8");
      const absPath = resolve(opts.output);
      log(chalk.green(`Report generated: ${absPath}`));
      if (opts.open) {
        const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
        Bun.spawn([openCmd, absPath]);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
      log(chalk.green(`Created auth preset ${chalk.bold(preset.name)} (${preset.email})`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        log(chalk.dim("No auth presets found."));
        return;
      }
      log("");
      log(chalk.bold("  Auth Presets"));
      log("");
      log(`  ${"Name".padEnd(20)} ${"Email".padEnd(30)} ${"Login Path".padEnd(15)} Created`);
      log(`  ${"─".repeat(20)} ${"─".repeat(30)} ${"─".repeat(15)} ${"─".repeat(22)}`);
      for (const p of presets) {
        log(`  ${p.name.padEnd(20)} ${p.email.padEnd(30)} ${p.loginPath.padEnd(15)} ${p.createdAt}`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
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
        log(chalk.green(`Deleted auth preset: ${name}`));
      } else {
        logError(chalk.red(`Auth preset not found: ${name}`));
        process.exit(1);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers costs ──────────────────────────────────────────────────────────

program
  .command("costs")
  .description("Show cost tracking and budget status")
  .option("--project <id>", "Project ID")
  .option("--period <period>", "Time period: day, week, month, all (default: month)", "month")
  .option("--by-scenario", "Group cost breakdown by scenario, sorted by total cost", false)
  .option("--json", "JSON output", false)
  .option("--csv", "CSV output", false)
  .action((opts) => {
    try {
      const projectId = resolveProject(opts.project);
      const period = opts.period as "day" | "week" | "month" | "all";

      if (opts.byScenario) {
        const rows = getCostsByScenario({ projectId, period });
        if (opts.json) {
          log(JSON.stringify(rows, null, 2));
        } else {
          log(formatCostsByScenarioTerminal(rows, period));
        }
        return;
      }

      const summary = getCostSummary({ projectId, period });
      if (opts.csv) {
        log(formatCostsCsv(summary));
      } else if (opts.json) {
        log(formatCostsJSON(summary));
      } else {
        log(formatCostsTerminal(summary));
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// --- Chain / Unchain / Deps commands ---

program
  .command("chain <scenario-id>")
  .description("Add a dependency to a scenario")
  .requiredOption("--depends-on <id>", "Scenario ID that must run first")
  .action((scenarioId: string, opts) => {
    try {
      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) { logError(chalk.red(`Scenario not found: ${scenarioId}`)); process.exit(1); }

      const dep = getScenario(opts.dependsOn) ?? getScenarioByShortId(opts.dependsOn);
      if (!dep) { logError(chalk.red(`Dependency scenario not found: ${opts.dependsOn}`)); process.exit(1); }

      addDependency(scenario.id, dep.id);
      log(chalk.green(`${scenario.shortId} now depends on ${dep.shortId}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("unchain <scenario-id>")
  .description("Remove a dependency from a scenario")
  .requiredOption("--from <id>", "Dependency to remove")
  .action((scenarioId: string, opts) => {
    try {
      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) { logError(chalk.red(`Scenario not found: ${scenarioId}`)); process.exit(1); }

      const dep = getScenario(opts.from) ?? getScenarioByShortId(opts.from);
      if (!dep) { logError(chalk.red(`Dependency not found: ${opts.from}`)); process.exit(1); }

      removeDependency(scenario.id, dep.id);
      log(chalk.green(`Removed dependency: ${scenario.shortId} no longer depends on ${dep.shortId}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("deps <scenario-id>")
  .description("Show dependencies for a scenario")
  .action((scenarioId: string) => {
    try {
      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) { logError(chalk.red(`Scenario not found: ${scenarioId}`)); process.exit(1); }

      const deps = getDependencies(scenario.id);
      const dependents = getDependents(scenario.id);

      log("");
      log(chalk.bold(`  Dependencies for ${scenario.shortId}: ${scenario.name}`));
      log("");

      if (deps.length > 0) {
        log(chalk.dim("  Depends on:"));
        for (const depId of deps) {
          const s = getScenario(depId);
          log(`    → ${s ? `${s.shortId}: ${s.name}` : depId.slice(0, 8)}`);
        }
      } else {
        log(chalk.dim("  No dependencies"));
      }

      if (dependents.length > 0) {
        log("");
        log(chalk.dim("  Required by:"));
        for (const depId of dependents) {
          const s = getScenario(depId);
          log(`    ← ${s ? `${s.shortId}: ${s.name}` : depId.slice(0, 8)}`);
        }
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// --- Flow subcommands ---

const flowCmd = program.command("flow").description("Manage test flows (ordered scenario chains)");

flowCmd
  .command("create <name>")
  .description("Create a flow from scenario IDs")
  .requiredOption("--chain <ids>", "Comma-separated scenario IDs in order")
  .option("--project <id>", "Project ID")
  .action((name: string, opts) => {
    try {
      const ids = opts.chain.split(",").map((id: string) => {
        const s = getScenario(id.trim()) ?? getScenarioByShortId(id.trim());
        if (!s) { logError(chalk.red(`Scenario not found: ${id.trim()}`)); process.exit(1); }
        return s.id;
      });

      // Auto-create dependencies: each scenario depends on the previous
      for (let i = 1; i < ids.length; i++) {
        try { addDependency(ids[i], ids[i - 1]); } catch { /* already exists */ }
      }

      const flow = createFlow({ name, scenarioIds: ids, projectId: resolveProject(opts.project) });
      log(chalk.green(`Flow created: ${flow.id.slice(0, 8)} — ${flow.name} (${ids.length} scenarios)`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

flowCmd
  .command("list")
  .description("List all flows")
  .option("--project <id>", "Project ID")
  .action((opts) => {
    const flows = listFlows(resolveProject(opts.project) ?? undefined);
    if (flows.length === 0) {
      log(chalk.dim("\n  No flows found.\n"));
      return;
    }
    log("");
    log(chalk.bold("  Flows"));
    log("");
    for (const f of flows) {
      log(`  ${chalk.dim(f.id.slice(0, 8))}  ${f.name}  ${chalk.dim(`(${f.scenarioIds.length} scenarios)`)}`);
    }
    log("");
  });

flowCmd
  .command("show <id>")
  .description("Show flow details")
  .action((id: string) => {
    const flow = getFlow(id);
    if (!flow) { logError(chalk.red(`Flow not found: ${id}`)); process.exit(1); }
    log("");
    log(chalk.bold(`  Flow: ${flow.name}`));
    log(`  ID: ${chalk.dim(flow.id)}`);
    log(`  Scenarios (in order):`);
    for (let i = 0; i < flow.scenarioIds.length; i++) {
      const s = getScenario(flow.scenarioIds[i]);
      log(`    ${i + 1}. ${s ? `${s.shortId}: ${s.name}` : flow.scenarioIds[i].slice(0, 8)}`);
    }
    log("");
  });

flowCmd
  .command("delete <id>")
  .description("Delete a flow")
  .action((id: string) => {
    if (deleteFlow(id)) log(chalk.green("Flow deleted."));
    else { logError(chalk.red("Flow not found.")); process.exit(1); }
  });

flowCmd
  .command("run <id>")
  .description("Run a flow (scenarios in dependency order)")
  .option("-u, --url <url>", "Target URL (required)")
  .option("-m, --model <model>", "AI model")
  .option("--headed", "Run headed", false)
  .option("--json", "JSON output", false)
  .action(async (id: string, opts) => {
    try {
      const flow = getFlow(id);
      if (!flow) { logError(chalk.red(`Flow not found: ${id}`)); process.exit(1); }
      if (!opts.url) { logError(chalk.red("--url is required for flow run")); process.exit(1); }

      log(chalk.blue(`Running flow: ${flow.name} (${flow.scenarioIds.length} scenarios)`));

      const { run, results } = await runByFilter({
        url: opts.url,
        scenarioIds: flow.scenarioIds,
        model: opts.model,
        headed: opts.headed,
        parallel: 1, // flows run sequentially by design
      });

      if (opts.json) log(formatJSON(run, results));
      else log(formatTerminal(run, results));
      process.exit(getExitCode(run));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers env ─────────────────────────────────────────────────────────────

const envCmd = program
  .command("env")
  .description("Manage environments");

envCmd
  .command("add <name>")
  .description("Add a named environment")
  .requiredOption("--url <url>", "Environment URL")
  .option("--auth <preset>", "Auth preset name")
  .option("--project <id>", "Project ID")
  .option("--default", "Set as default environment", false)
  .action((name: string, opts) => {
    try {
      const env = createEnvironment({
        name,
        url: opts.url,
        authPresetName: opts.auth,
        projectId: opts.project,
        isDefault: opts.default,
      });
      log(chalk.green(`Environment added: ${env.name} → ${env.url}${env.isDefault ? " (default)" : ""}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

envCmd
  .command("list")
  .description("List all environments")
  .option("--project <id>", "Filter by project ID")
  .action((opts) => {
    try {
      const envs = listEnvironments(opts.project);
      if (envs.length === 0) {
        log(chalk.dim("No environments configured. Add one with: testers env add <name> --url <url>"));
        return;
      }
      for (const env of envs) {
        const marker = env.isDefault ? chalk.green(" ★ default") : "";
        const auth = env.authPresetName ? chalk.dim(` (auth: ${env.authPresetName})`) : "";
        log(`  ${chalk.bold(env.name)}  ${env.url}${auth}${marker}`);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

envCmd
  .command("use <name>")
  .description("Set an environment as the default")
  .action((name: string) => {
    try {
      setDefaultEnvironment(name);
      const env = getEnvironment(name)!;
      log(chalk.green(`Default environment set: ${env.name} → ${env.url}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

envCmd
  .command("delete <name>")
  .description("Delete an environment")
  .action((name: string) => {
    try {
      const deleted = deleteEnvironment(name);
      if (deleted) {
        log(chalk.green(`Environment deleted: ${name}`));
      } else {
        logError(chalk.red(`Environment not found: ${name}`));
        process.exit(1);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers baseline <run-id> ───────────────────────────────────────────────

program
  .command("baseline <run-id>")
  .description("Set a run as the visual baseline")
  .action((runId: string) => {
    try {
      setBaseline(runId);
      const run = getRun(runId);
      log(chalk.green(`Baseline set: ${chalk.bold(runId.slice(0, 8))}${run ? ` (${run.status}, ${run.total} scenarios)` : ""}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers import-api <spec> ─────────────────────────────────────────────

program
  .command("import-api <spec>")
  .description("Import test scenarios from an OpenAPI/Swagger spec file")
  .option("--project <id>", "Project ID")
  .action(async (spec: string, opts) => {
    try {
      const { importFromOpenAPI } = await import("../lib/openapi-import.js");
      const { imported, scenarios } = importFromOpenAPI(spec, resolveProject(opts.project) ?? undefined);
      log(chalk.green(`\nImported ${imported} scenarios from API spec:`));
      for (const s of scenarios) {
        log(`  ${chalk.cyan(s.shortId)} ${s.name} ${chalk.dim(`[${s.tags.join(", ")}]`)}`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers record <url> ──────────────────────────────────────────────────

program
  .command("record <url>")
  .description("Record a browser session and generate a test scenario")
  .option("-n, --name <name>", "Scenario name", "Recorded session")
  .option("--project <id>", "Project ID")
  .action(async (url: string, opts) => {
    try {
      const { recordAndSave } = await import("../lib/recorder.js");
      log(chalk.blue("Opening browser for recording..."));
      const { recording, scenario } = await recordAndSave(url, opts.name, resolveProject(opts.project) ?? undefined);
      log("");
      log(chalk.green(`Recording saved as scenario ${chalk.bold(scenario.shortId)}: ${scenario.name}`));
      log(chalk.dim(`  ${recording.actions.length} actions recorded in ${(recording.duration / 1000).toFixed(0)}s`));
      log(chalk.dim(`  ${scenario.steps.length} steps generated`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers run-affected <url> ─────────────────────────────────────────────

program
  .command("run-affected <url>")
  .description("Run only scenarios relevant to changed files (diff-aware testing)")
  .option("-f, --file <path>", "Changed file path (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
  .option("--map <glob:tags>", "Glob→tag mapping, e.g. 'src/chat*:chat,messaging' (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
  .option("--project <id>", "Project ID")
  .option("-m, --model <model>", "AI model to use")
  .option("--headed", "Run browser in headed mode", false)
  .option("--parallel <n>", "Number of parallel browsers", "1")
  .option("--json", "Output results as JSON", false)
  .action(async (url: string, opts) => {
    try {
      const { matchFilesToScenarios } = await import("../lib/affected.js");
      const { runBatch } = await import("../lib/runner.js");

      const projectId = resolveProject(opts.project);

      // Parse --map glob:tags options
      const mappings = (opts.map as string[]).map((m) => {
        const sep = m.lastIndexOf(":");
        if (sep < 1) return null;
        return { glob: m.slice(0, sep), tags: m.slice(sep + 1).split(",").map((t: string) => t.trim()) };
      }).filter(Boolean) as { glob: string; tags: string[] }[];

      const allScenarios = listScenarios({ projectId });
      const matched = matchFilesToScenarios(opts.file as string[], allScenarios, mappings);

      if (matched.length === 0) {
        log(chalk.yellow("  No scenarios matched the provided file paths."));
        log(chalk.dim("  Tip: use --map 'src/chat*:chat' to add explicit mappings."));
        process.exit(0);
      }

      log(chalk.blue(`  Running ${matched.length} affected scenario(s) against ${url}...`));
      log(chalk.dim(`  Files: ${(opts.file as string[]).slice(0, 5).join(", ")}${(opts.file as string[]).length > 5 ? "…" : ""}`));
      log("");

      const { run, results } = await runBatch(matched, {
        url,
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
        projectId,
      });

      if (opts.json) {
        log(JSON.stringify({ run, results }, null, 2));
      } else {
        const { formatTerminal } = await import("../lib/reporter.js");
        log(formatTerminal(run, results));
      }

      const { getExitCode } = await import("../lib/reporter.js");
      process.exit(getExitCode(run));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers git-watch <url> ────────────────────────────────────────────────

program
  .command("git-watch <url>")
  .description("Watch for git commits and auto-run affected scenarios")
  .option("--dir <path>", "Git repository directory to watch", process.cwd())
  .option("--poll <ms>", "Poll interval in milliseconds", "10000")
  .option("--map <glob:tags>", "Glob→tag mapping (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
  .option("--project <id>", "Project ID")
  .option("-m, --model <model>", "AI model to use")
  .option("--headed", "Run browser in headed mode", false)
  .option("--parallel <n>", "Number of parallel browsers", "1")
  .action(async (url: string, opts) => {
    try {
      const { startGitWatcher } = await import("../lib/git-watch.js");
      const mappings = (opts.map as string[]).map((m) => {
        const sep = m.lastIndexOf(":");
        if (sep < 1) return null;
        return { glob: m.slice(0, sep), tags: m.slice(sep + 1).split(",").map((t: string) => t.trim()) };
      }).filter(Boolean) as { glob: string; tags: string[] }[];

      await startGitWatcher({
        url,
        dir: opts.dir,
        pollIntervalMs: parseInt(opts.poll, 10),
        mappings,
        projectId: resolveProject(opts.project),
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
      });
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers agent ──────────────────────────────────────────────────────────

const agentCmd = program.command("agent").description("Manage registered agents");

agentCmd
  .command("register <name>")
  .description("Register an agent (idempotent)")
  .option("-d, --description <text>", "Agent description")
  .option("-r, --role <role>", "Agent role")
  .action((name: string, opts) => {
    try {
      const { registerAgent } = require("../db/agents.js");
      const agent = registerAgent({ name, description: opts.description, role: opts.role });
      log(chalk.green(`Registered agent: ${agent.name} (${agent.id.slice(0, 8)})`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

agentCmd
  .command("heartbeat <id>")
  .description("Update agent last_seen_at timestamp")
  .action((id: string) => {
    try {
      const { heartbeatAgent } = require("../db/agents.js");
      const agent = heartbeatAgent(id);
      if (!agent) { logError(chalk.red(`Agent not found: ${id}`)); process.exit(1); }
      log(chalk.green(`Heartbeat sent for ${agent.name} — ${agent.lastSeenAt}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

agentCmd
  .command("focus <agent-id> [scenario-id]")
  .description("Set (or clear) an agent's current focus scenario")
  .action((agentId: string, scenarioId: string | undefined) => {
    try {
      const { setAgentFocus } = require("../db/agents.js");
      const agent = setAgentFocus(agentId, scenarioId ?? null);
      if (!agent) { logError(chalk.red(`Agent not found: ${agentId}`)); process.exit(1); }
      const focus = (agent.metadata as Record<string, unknown> | null)?.focus ?? null;
      log(focus ? chalk.green(`Agent ${agent.name} focus set to: ${focus}`) : chalk.dim(`Agent ${agent.name} focus cleared`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

agentCmd
  .command("list")
  .description("List all registered agents")
  .action(() => {
    try {
      const { listAgents } = require("../db/agents.js");
      const agents = listAgents();
      if (agents.length === 0) {
        log(chalk.dim("No agents registered."));
        return;
      }
      for (const a of agents) {
        const focus = (a.metadata as Record<string, unknown> | null)?.focus;
        log(`  ${chalk.cyan(a.id.slice(0, 8))}  ${chalk.bold(a.name)}${a.role ? chalk.dim(` [${a.role}]`) : ""}${focus ? chalk.yellow(` → ${focus}`) : ""}  ${chalk.dim(a.lastSeenAt)}`);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers doctor ─────────────────────────────────────────────────────────

program
  .command("doctor")
  .description("Check system setup and configuration")
  .action(async () => {
    let allPassed = true;

    // 1. Check ANTHROPIC_API_KEY
    const hasApiKey = Boolean(process.env["ANTHROPIC_API_KEY"]);
    if (hasApiKey) {
      log(chalk.green("✓") + " ANTHROPIC_API_KEY is set");
    } else {
      log(chalk.red("✗") + " ANTHROPIC_API_KEY is not set (required for AI-powered tests)");
      allPassed = false;
    }

    // 2. Check DB is accessible
    const dbPath = join(process.env["HOME"] ?? "~", ".testers", "testers.db");
    try {
      const { Database } = await import("bun:sqlite");
      const db = new Database(dbPath, { create: true });
      db.close();
      log(chalk.green("✓") + ` Database accessible: ${dbPath}`);
    } catch (err) {
      log(chalk.red("✗") + ` Database not accessible at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }

    // 3. Check Playwright/chromium is installed
    try {
      const { chromium } = await import("playwright");
      const execPath = chromium.executablePath();
      const { existsSync: fsExists } = await import("node:fs");
      if (fsExists(execPath)) {
        log(chalk.green("✓") + " Playwright chromium is installed");
      } else {
        log(chalk.red("✗") + ` Playwright chromium executable not found at ${execPath}. Run: testers install`);
        allPassed = false;
      }
    } catch {
      log(chalk.red("✗") + " Playwright is not installed. Run: testers install");
      allPassed = false;
    }

    if (!allPassed) {
      process.exit(1);
    }
  });

// ─── testers serve ──────────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the Open Testers web dashboard")
  .option("--no-open", "Do not open the browser after starting", false)
  .option("--port <port>", "Port to listen on", "19450")
  .action(async (opts) => {
    try {
      const port = parseInt(opts.port, 10);
      const url = `http://localhost:${port}`;

      // Spawn the server process
      const serverBin = join(resolve(process.execPath, ".."), "..", "dist", "server", "index.js");
      // Fallback: try to run directly via bun
      const { join: pathJoin, resolve: pathResolve, dirname } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const serverPath = pathJoin(dirname(fileURLToPath(import.meta.url)), "..", "server", "index.js");

      const proc = Bun.spawn(["bun", "run", serverPath], {
        env: { ...process.env, TESTERS_PORT: String(port) },
        stdout: "inherit",
        stderr: "inherit",
      });

      log(chalk.green(`Open Testers dashboard starting at ${url}`));

      // Wait briefly then open browser
      if (opts.open !== false) {
        await new Promise((r) => setTimeout(r, 1500));
        const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
        Bun.spawn([openCmd, url]);
      }

      // Keep process alive until child exits
      await proc.exited;
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// Apply global flags before any action runs
program.hook("preAction", () => {
  const opts = program.opts();
  QUIET = opts.quiet === true;
  NO_COLOR = opts.color === false || process.env["FORCE_COLOR"] === "0";
  if (NO_COLOR) {
    // Disable chalk colors globally
    process.env["FORCE_COLOR"] = "0";
  }
});

program.parse();
