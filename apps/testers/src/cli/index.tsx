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
import { createPersona, getPersona, listPersonas, deletePersona } from "../db/personas.js";
import { createApiCheck, getApiCheck, listApiChecks, deleteApiCheck } from "../db/api-checks.js";
import { runApiCheck, runApiChecksByFilter } from "../lib/api-runner.js";
import { createSchedule, getSchedule, listSchedules, updateSchedule, deleteSchedule } from "../db/schedules.js";
import { getTemplate, listTemplateNames } from "../lib/templates.js";
import { createAuthPreset, listAuthPresets, deleteAuthPreset } from "../db/auth-presets.js";
import { addDependency, removeDependency, getDependencies, getDependents, createFlow, getFlow, listFlows, deleteFlow } from "../db/flows.js";
import { createEnvironment, getEnvironment, listEnvironments, deleteEnvironment, setDefaultEnvironment, getDefaultEnvironment } from "../db/environments.js";
import { generateGitHubActionsWorkflow } from "../lib/ci.js";
import type { ScenarioPriority } from "../types/index.js";
import { parseAssertionString } from "../lib/assertions.js";
import { existsSync, mkdirSync } from "node:fs";
import { getTestersDir } from "../lib/paths.js";

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

const CONFIG_DIR = getTestersDir();
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
  .option("--group", "Group scenarios by first tag", false)
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
      } else if (opts.group) {
        // Group by first tag
        const groups = new Map<string, typeof scenarios>();
        for (const s of scenarios) {
          const g = s.tags[0] ?? "Ungrouped";
          groups.set(g, [...(groups.get(g) ?? []), s]);
        }
        for (const [groupName, items] of groups.entries()) {
          log("");
          log(chalk.bold(`  ${groupName}`) + chalk.dim(` (${items.length})`));
          log(chalk.dim("  " + "─".repeat(40)));
          log(formatScenarioList(items));
        }
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
  .option("--browser <engine>", "Browser engine: playwright (default), lightpanda (9x faster, no screenshots), or bun (native WKWebView, 11x faster, Bun canary required)", "playwright")
  .option("--env <name>", "Use a named environment for the URL")
  .option("--dry-run", "Print what would run without launching browser", false)
  .option("--retry <n>", "Retry failed scenarios up to n times", "0")
  .option("--samples <n>", "Run each scenario N times and report flakiness (pass rate)", "1")
  .option("--flakiness-threshold <n>", "Pass rate threshold below which a scenario is marked flaky (0-1)", "0.95")
  .option("--a11y [level]", "Run axe-core WCAG accessibility scan after each navigation (level: A, AA, AAA — default AA)")
  .option("--self-heal", "Enable AI-powered selector repair when elements can't be found (requires judgeModel or ANTHROPIC_API_KEY)", false)
  .option("--verbose", "Show per-step timing and full tool results", false)
  .option("--watch-results", "When used with --background, poll and display live results table until run completes", false)
  .option("--failed-only", "Only show failed/error scenarios in output (passed count shown as summary)", false)
  .option("--smoke", "Run only smoke-tagged scenarios (fast validation suite, <2 min)", false)
  .option("--minimal", "Fastest possible run: cheapest model, max parallelism, min turns (ideal for CI)", false)
  .option("--github-comment", "Post pass/fail summary as a GitHub PR comment (requires GITHUB_TOKEN env var)", false)
  .option("--pr <number>", "GitHub PR number (auto-detected from GITHUB_REF if not provided)")
  .option("--persona <id>", "Override persona for this run (comma-separated IDs for divergence testing)")
  .option("--max-cost <dollars>", "Hard budget cap in dollars — abort if estimated cost exceeds this (e.g. 0.50 for 50 cents)")
  .option("--cache-max-age <seconds>", "Skip scenarios that passed at the same URL within this many seconds (0 = disabled)", "0")
  .option("--diff", "Auto-detect changed files from git diff and run only relevant scenarios", false)
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
          samples: parseInt(opts.samples ?? "1", 10),
          flakinessThreshold: parseFloat(opts.flakinessThreshold ?? "0.95"),
          a11y: opts.a11y ? (typeof opts.a11y === "string" ? { level: opts.a11y as "A" | "AA" | "AAA" } : true) : undefined,
          selfHeal: opts.selfHeal || undefined,
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

        // Post GitHub PR comment if requested
        if (opts.githubComment) {
          const { postGitHubComment } = await import("../lib/ci.js");
          const prNumber = opts.pr ? parseInt(opts.pr, 10) : undefined;
          const posted = await postGitHubComment(run, results, { prNumber });
          if (posted) {
            log(chalk.green("  GitHub PR comment posted."));
          } else if (!process.env["GITHUB_TOKEN"]) {
            log(chalk.yellow("  --github-comment: GITHUB_TOKEN not set, skipping PR comment."));
          }
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

      // --diff mode: detect changed files from git and filter to relevant scenarios
      let diffScenarioIds: string[] | undefined;
      if (opts.diff) {
        try {
          const { execSync } = await import("child_process");
          const staged = execSync("git diff --cached --name-only", { cwd: process.cwd(), encoding: "utf-8" }).trim();
          const unstaged = execSync("git diff --name-only HEAD", { cwd: process.cwd(), encoding: "utf-8" }).trim();
          const diffOutput = [staged, unstaged].filter(Boolean).join("\n");
          if (!diffOutput.trim()) {
            log(chalk.yellow("  --diff: No changed files detected. Running all scenarios."));
          } else {
            const filePaths = [...new Set(diffOutput.split("\n").filter(Boolean))];
            const { matchFilesToScenarios } = await import("../lib/affected.js");
            const allScenarios = listScenarios({ projectId });
            const matched = matchFilesToScenarios(filePaths, allScenarios, []);
            if (matched.length === 0) {
              log(chalk.yellow(`  --diff: No scenarios match changed files (${filePaths.length} files changed). Exiting.`));
              process.exit(0);
            }
            diffScenarioIds = matched.map((s) => s.id);
            log(chalk.dim(`  --diff: ${filePaths.length} files changed → ${matched.length} matching scenario(s)`));
          }
        } catch {
          log(chalk.yellow("  --diff: git diff failed. Running all scenarios."));
        }
      }

      // Run by filter
      // Parse persona IDs: support comma-separated list for divergence testing
      const personaIdList: string[] | undefined = opts.persona
        ? opts.persona.split(",").map((s: string) => s.trim()).filter(Boolean)
        : undefined;
      const { run, results } = await runByFilter({
        url,
        tags: opts.tag.length > 0 ? opts.tag : undefined,
        scenarioIds: diffScenarioIds ?? (opts.scenario ? [opts.scenario] : undefined),
        priority: opts.priority,
        model: opts.model,
        headed: opts.headed,
        parallel: parseInt(opts.parallel, 10),
        timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
        retry: parseInt(opts.retry ?? "0", 10),
        projectId,
        engine: opts.browser,
        samples: parseInt(opts.samples ?? "1", 10),
        flakinessThreshold: parseFloat(opts.flakinessThreshold ?? "0.95"),
        a11y: opts.a11y ? (typeof opts.a11y === "string" ? { level: opts.a11y as "A" | "AA" | "AAA" } : true) : undefined,
        selfHeal: opts.selfHeal || undefined,
        personaId: personaIdList?.[0],
        personaIds: personaIdList && personaIdList.length > 1 ? personaIdList : undefined,
        maxCostCents: opts.maxCost ? Math.round(parseFloat(opts.maxCost) * 100) : undefined,
        cacheMaxAgeMs: opts.cacheMaxAge ? parseInt(opts.cacheMaxAge, 10) * 1000 : undefined,
        minimal: opts.minimal || undefined,
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
  .option("--json", "Output as JSON", false)
  .option("-l, --limit <n>", "Limit results", "200")
  .option("--offset <n>", "Skip first N results", "0")
  .action((id: string, opts) => {
    try {
      const limit = Math.max(1, parseInt(opts.limit, 10) || 200);
      const offset = Math.max(0, parseInt(opts.offset, 10) || 0);

      // Try as run-id first: get all results, then all screenshots
      const run = getRun(id);
      if (run) {
        const results = getResultsByRun(run.id);
        const flattened: Array<{
          screenshotId: string;
          resultId: string;
          scenarioId: string;
          scenarioShortId: string | null;
          scenarioName: string | null;
          stepNumber: number;
          action: string;
          filePath: string;
          timestamp: string;
          width: number;
          height: number;
        }> = [];

        for (const result of results) {
          const screenshots = listScreenshots(result.id);
          const scenario = getScenario(result.scenarioId);
          for (const ss of screenshots) {
            flattened.push({
              screenshotId: ss.id,
              resultId: result.id,
              scenarioId: result.scenarioId,
              scenarioShortId: scenario?.shortId ?? null,
              scenarioName: scenario?.name ?? null,
              stepNumber: ss.stepNumber,
              action: ss.action,
              filePath: ss.filePath,
              timestamp: ss.timestamp,
              width: ss.width,
              height: ss.height,
            });
          }
        }

        const paged = flattened.slice(offset, offset + limit);
        if (opts.json) {
          log(JSON.stringify({
            input: id,
            type: "run",
            runId: run.id,
            total: flattened.length,
            limit,
            offset,
            items: paged,
          }, null, 2));
          return;
        }

        let seen = 0;
        let shown = 0;
        log("");
        log(chalk.bold(`  Screenshots for run ${run.id.slice(0, 8)}`));
        log("");

        for (const result of results) {
          const screenshots = listScreenshots(result.id);
          if (screenshots.length > 0) {
            const scenario = getScenario(result.scenarioId);
            const label = scenario ? `${scenario.shortId}: ${scenario.name}` : result.scenarioId.slice(0, 8);
            let sectionPrinted = false;
            for (const ss of screenshots) {
              if (seen < offset) {
                seen++;
                continue;
              }
              if (shown >= limit) break;
              if (!sectionPrinted) {
                log(chalk.bold(`  ${label}`));
                sectionPrinted = true;
              }
              log(`    ${chalk.dim(String(ss.stepNumber).padStart(3, "0"))} ${ss.action} — ${chalk.dim(ss.filePath)}`);
              seen++;
              shown++;
            }
            if (sectionPrinted) log("");
            if (shown >= limit) break;
          }
        }

        if (flattened.length === 0 || shown === 0) {
          log(chalk.dim("  No screenshots found."));
          log("");
        } else if (offset + shown < flattened.length) {
          log(chalk.dim(`  Showing ${shown} of ${flattened.length} screenshots (use --limit/--offset to paginate)`));
          log("");
        }
        return;
      }

      // Try as result-id
      const screenshots = listScreenshots(id);
      const paged = screenshots.slice(offset, offset + limit);
      if (opts.json) {
        log(JSON.stringify({
          input: id,
          type: "result",
          resultId: id,
          total: screenshots.length,
          limit,
          offset,
          items: paged.map((ss) => ({
            screenshotId: ss.id,
            stepNumber: ss.stepNumber,
            action: ss.action,
            filePath: ss.filePath,
            timestamp: ss.timestamp,
            width: ss.width,
            height: ss.height,
          })),
        }, null, 2));
        return;
      }

      if (screenshots.length > 0) {
        log("");
        log(chalk.bold(`  Screenshots for result ${id.slice(0, 8)}`));
        log("");
        for (const ss of paged) {
          log(`  ${chalk.dim(String(ss.stepNumber).padStart(3, "0"))} ${ss.action} — ${chalk.dim(ss.filePath)}`);
        }
        if (paged.length < screenshots.length) {
          log("");
          log(chalk.dim(`  Showing ${paged.length} of ${screenshots.length} screenshots (use --limit/--offset to paginate)`));
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
      const dbPath = join(getTestersDir(), "testers.db");

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
  .option("--json", "Output as JSON", false)
  .option("--search <text>", "Filter by project name/path (case-insensitive substring)")
  .option("-l, --limit <n>", "Limit results", "100")
  .option("--offset <n>", "Skip first N results", "0")
  .action((opts) => {
    try {
      const limit = Math.max(1, parseInt(opts.limit, 10) || 100);
      const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
      const search = typeof opts.search === "string" && opts.search.trim().length > 0 ? opts.search.trim().toLowerCase() : null;

      const allProjects = listProjects();
      const filtered = search
        ? allProjects.filter((p) => {
            const name = p.name.toLowerCase();
            const path = (p.path ?? "").toLowerCase();
            return name.includes(search) || path.includes(search);
          })
        : allProjects;

      const paged = filtered.slice(offset, offset + limit);

      if (opts.json) {
        log(JSON.stringify({
          total: filtered.length,
          limit,
          offset,
          items: paged,
        }, null, 2));
        return;
      }

      if (filtered.length === 0) {
        log(chalk.dim("No projects found."));
        return;
      }

      log("");
      log(chalk.bold("  Projects"));
      log("");
      log(`  ${"ID".padEnd(38)} ${"Name".padEnd(24)} ${"Path".padEnd(30)} Created`);
      log(`  ${"─".repeat(38)} ${"─".repeat(24)} ${"─".repeat(30)} ${"─".repeat(20)}`);
      for (const p of paged) {
        log(`  ${p.id.padEnd(38)} ${p.name.padEnd(24)} ${(p.path ?? chalk.dim("—")).toString().padEnd(30)} ${p.createdAt}`);
      }
      if (offset + paged.length < filtered.length) {
        log("");
        log(chalk.dim(`  Showing ${paged.length} of ${filtered.length} projects (use --limit/--offset to paginate)`));
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
  .option("--json", "Output as JSON", false)
  .action((id: string, opts) => {
    try {
      // Try full UUID, then partial prefix match, then name
      let project = getProject(id);
      if (!project) {
        const all = listProjects();
        project = all.find((p) => p.id.startsWith(id) || p.name === id) ?? null;
      }
      if (!project) {
        logError(chalk.red(`Project not found: ${id}`));
        process.exit(1);
      }

      if (opts.json) {
        log(JSON.stringify(project, null, 2));
        return;
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
  .option("--json", "Output as JSON", false)
  .action((name: string, opts) => {
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

      if (opts.json) {
        log(JSON.stringify({ activeProject: project.id, project }, null, 2));
        return;
      }

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
  .option("-y, --yes", "Skip interactive prompts (non-interactive mode)", false)
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
      if (opts.yes) return; // skip wizard in non-interactive mode

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
  .description("Generate HTML test report or compliance snapshot")
  .option("--latest", "Use most recent run", false)
  .option("-o, --output <file>", "Output file path", "report.html")
  .option("--open", "Open the report in the browser after generating", false)
  .option("--compliance", "Generate a compliance snapshot (EU AI Act / SOC2 style)", false)
  .option("--days <n>", "Days to cover in compliance report", "30")
  .option("--project <id>", "Project ID for compliance report")
  .option("--format <fmt>", "Compliance report format: json or markdown", "markdown")
  .action(async (runId: string | undefined, opts) => {
    try {
      // Compliance report mode
      if (opts.compliance) {
        const { generateComplianceReport } = await import("../lib/compliance-report.js");
        const projectId = resolveProject(opts.project);
        const format = (opts.format === "json" ? "json" : "markdown") as "json" | "markdown";
        const content = await generateComplianceReport({
          projectId,
          days: parseInt(opts.days, 10),
          format,
        });

        if (opts.output && opts.output !== "report.html") {
          writeFileSync(opts.output, content, "utf-8");
          const absPath = resolve(opts.output);
          log(chalk.green(`Compliance report written to ${absPath}`));
        } else {
          log(content);
        }
        return;
      }

      // HTML report mode
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
  .requiredOption("--depends-on <id>", "Dependency to remove (alias: --from)")
  .option("--from <id>", "Dependency to remove (alias for --depends-on)")
  .action((scenarioId: string, opts) => {
    try {
      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) { logError(chalk.red(`Scenario not found: ${scenarioId}`)); process.exit(1); }

      const depId = opts.dependsOn ?? opts.from;
      if (!depId) { logError(chalk.red("Specify the dependency to remove with --depends-on <id>")); process.exit(1); }
      const dep = getScenario(depId) ?? getScenarioByShortId(depId);
      if (!dep) { logError(chalk.red(`Dependency not found: ${depId}`)); process.exit(1); }

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
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const flows = listFlows(resolveProject(opts.project) ?? undefined);
    if (opts.json) { log(JSON.stringify(flows, null, 2)); return; }
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
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const envs = listEnvironments(opts.project);
      if (opts.json) {
        log(JSON.stringify({ total: envs.length, items: envs }, null, 2));
        return;
      }
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

// ─── testers generate <url> ─────────────────────────────────────────────────

program
  .command("generate <url>")
  .description("Crawl app and synthesize test scenarios using AI (any provider)")
  .option("--max <n>", "Max scenarios to generate", "10")
  .option("--max-pages <n>", "Max pages to crawl", "10")
  .option("--focus <topic>", "Focus on specific area e.g. 'auth flows', 'checkout'")
  .option("--persona <desc>", "Persona perspective e.g. 'first-time user'")
  .option("--model <model>", "AI model (claude-haiku, gpt-4o-mini, gemini-2.0-flash, etc.)")
  .option("--save", "Persist generated scenarios to DB", false)
  .option("--project <id>", "Project ID")
  .option("--headed", "Run browser in headed mode", false)
  .option("--json", "Output as JSON", false)
  .action(async (url: string, opts) => {
    try {
      const { generateScenarios } = await import("../lib/generator.js");
      const projectId = resolveProject(opts.project) ?? undefined;

      log(chalk.dim(`  Crawling ${url} and generating scenarios...`));

      const result = await generateScenarios({
        url,
        maxScenarios: parseInt(opts.max, 10),
        maxPages: parseInt(opts.maxPages, 10),
        focus: opts.focus,
        persona: opts.persona,
        model: opts.model,
        headed: opts.headed,
        projectId,
        save: opts.save,
      });

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
        return;
      }

      log("");
      log(chalk.bold(`  Generated ${result.scenarios.length} scenarios`) + chalk.dim(` via ${result.provider}/${result.model} — ${result.pagesDiscovered} pages crawled`));
      log("");
      log(`  ${"Priority".padEnd(10)} ${"Name".padEnd(40)} ${"Steps".padEnd(7)} Tags`);
      log(`  ${"─".repeat(10)} ${"─".repeat(40)} ${"─".repeat(7)} ${"─".repeat(20)}`);
      for (const s of result.scenarios) {
        const priority = s.priority ?? "medium";
        const priorityColor = priority === "critical" ? chalk.red : priority === "high" ? chalk.yellow : chalk.dim;
        log(`  ${priorityColor(priority.padEnd(10))} ${s.name.slice(0, 39).padEnd(40)} ${String(s.steps?.length ?? 0).padEnd(7)} ${(s.tags ?? []).join(", ")}`);
      }
      log("");
      if (opts.save) {
        log(chalk.green(`  ✓ ${result.scenarios.length} scenarios saved to database`));
      } else {
        log(chalk.dim(`  Use --save to persist to database, or --json to export`));
      }
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

// ─── testers scan ───────────────────────────────────────────────────────────

const scanCmd = program.command("scan").description("Scan a running app for runtime issues");

const SCAN_COMMON_OPTIONS = (cmd: ReturnType<typeof scanCmd.command>) =>
  cmd
    .option("--project <id>", "Project ID for issue tracking")
    .option("--headed", "Run browser in headed mode", false)
    .option("--timeout <ms>", "Navigation timeout per page in ms", "15000")
    .option("--json", "Output results as JSON", false);

SCAN_COMMON_OPTIONS(
  scanCmd
    .command("console <url>")
    .description("Collect JS/React console errors and uncaught exceptions")
    .option("-p, --page <path>", "Page path to visit (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
).action(async (url: string, opts) => {
  try {
    const { scanConsoleErrors } = await import("../lib/scanners/console.js");
    const { upsertScanIssue } = await import("../db/scan-issues.js");
    const result = await scanConsoleErrors({ url, pages: opts.page, headed: opts.headed, timeoutMs: parseInt(opts.timeout) });
    result.issues.forEach((i) => upsertScanIssue(i, opts.project));
    printScanResult(result, opts.json);
  } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

SCAN_COMMON_OPTIONS(
  scanCmd
    .command("network <url>")
    .description("Detect failed API calls, 5xx, 404s, CORS errors")
    .option("-p, --page <path>", "Page path to visit (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
).action(async (url: string, opts) => {
  try {
    const { scanNetworkErrors } = await import("../lib/scanners/network.js");
    const { upsertScanIssue } = await import("../db/scan-issues.js");
    const result = await scanNetworkErrors({ url, pages: opts.page, headed: opts.headed, timeoutMs: parseInt(opts.timeout) });
    result.issues.forEach((i) => upsertScanIssue(i, opts.project));
    printScanResult(result, opts.json);
  } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

SCAN_COMMON_OPTIONS(
  scanCmd
    .command("links <url>")
    .description("Crawl app and find broken links / 404s")
    .option("--max-pages <n>", "Max pages to crawl", "30")
).action(async (url: string, opts) => {
  try {
    const { scanBrokenLinks } = await import("../lib/scanners/links.js");
    const { upsertScanIssue } = await import("../db/scan-issues.js");
    const result = await scanBrokenLinks({ url, maxPages: parseInt(opts.maxPages), headed: opts.headed, timeoutMs: parseInt(opts.timeout) });
    result.issues.forEach((i) => upsertScanIssue(i, opts.project));
    printScanResult(result, opts.json);
  } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

SCAN_COMMON_OPTIONS(
  scanCmd
    .command("perf <url>")
    .description("Measure page load time, LCP, DOMContentLoaded")
    .option("-p, --page <path>", "Page path to visit (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option("--lcp-threshold <ms>", "LCP threshold in ms (default 2500)", "2500")
    .option("--load-threshold <ms>", "Load time threshold in ms (default 5000)", "5000")
).action(async (url: string, opts) => {
  try {
    const { scanPerformance } = await import("../lib/scanners/performance.js");
    const { upsertScanIssue } = await import("../db/scan-issues.js");
    const result = await scanPerformance({
      url, pages: opts.page, headed: opts.headed, timeoutMs: parseInt(opts.timeout),
      thresholds: { lcpMs: parseInt(opts.lcpThreshold), loadTimeMs: parseInt(opts.loadThreshold) },
    });
    result.issues.forEach((i) => upsertScanIssue(i, opts.project));
    printScanResult(result, opts.json);
  } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

SCAN_COMMON_OPTIONS(
  scanCmd
    .command("all <url>")
    .description("Run all scanners: console, network, links, performance")
    .option("-p, --page <path>", "Page path to visit (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option("--max-pages <n>", "Max pages for link crawl", "20")
    .option("--skip <scanner>", "Skip a scanner: console|network|links|perf (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
).action(async (url: string, opts) => {
  try {
    const { runHealthScan } = await import("../lib/health-scan.js");
    const skip = new Set(opts.skip as string[]);
    const scanners = (["console", "network", "links", "performance"] as const).filter(
      (s) => !skip.has(s) && !skip.has(s === "performance" ? "perf" : s)
    );
    log(chalk.bold(`  Health scan: ${url}`));
    log(chalk.dim(`  Scanners: ${scanners.join(", ")}`));
    log("");
    const summary = await runHealthScan({
      url, pages: opts.page, projectId: opts.project,
      scanners, maxPages: parseInt(opts.maxPages),
      headed: opts.headed, timeoutMs: parseInt(opts.timeout),
    });
    if (opts.json) { log(JSON.stringify(summary, null, 2)); return; }
    log(chalk.bold("  Results"));
    log(chalk.dim(`  ${"─".repeat(50)}`));
    log(`  Total issues:    ${chalk.bold(String(summary.totalIssues))}`);
    log(`  New issues:      ${summary.newIssues > 0 ? chalk.red(String(summary.newIssues)) : chalk.green("0")}`);
    log(`  Regressed:       ${summary.regressedIssues > 0 ? chalk.yellow(String(summary.regressedIssues)) : chalk.green("0")}`);
    log(`  Known (skipped): ${chalk.dim(String(summary.existingIssues))}`);
    log(`  Duration:        ${(summary.durationMs / 1000).toFixed(1)}s`);
    log("");
    for (const result of summary.results) {
      if (result.issues.length > 0) printScanResult(result, false);
    }
    if (summary.newIssues + summary.regressedIssues > 0) process.exit(1);
  } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

scanCmd
  .command("issues")
  .description("List tracked scan issues")
  .option("--status <status>", "Filter by status: open|resolved|regressed")
  .option("--type <type>", "Filter by type: console_error|network_error|broken_link|performance")
  .option("--project <id>", "Filter by project ID")
  .option("--limit <n>", "Max results", "50")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const { listScanIssues } = require("../db/scan-issues.js");
      const issues = listScanIssues({ status: opts.status, type: opts.type, projectId: opts.project, limit: parseInt(opts.limit) });
      if (opts.json) { log(JSON.stringify(issues, null, 2)); return; }
      if (issues.length === 0) { log(chalk.dim("No scan issues found.")); return; }
      for (const i of issues) {
        const statusColor = i.status === "open" ? chalk.red : i.status === "regressed" ? chalk.yellow : chalk.green;
        log(`  ${statusColor(i.status.padEnd(10))} ${chalk.cyan(i.type.padEnd(16))} ${chalk.bold(i.severity.padEnd(8))} ${i.message.slice(0, 60)} ${chalk.dim(i.pageUrl)}`);
      }
    } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
  });

scanCmd
  .command("resolve <id>")
  .description("Mark a scan issue as resolved")
  .action((id: string) => {
    try {
      const { resolveScanIssue } = require("../db/scan-issues.js");
      const ok = resolveScanIssue(id);
      if (!ok) { logError(chalk.red(`Scan issue not found: ${id}`)); process.exit(1); }
      log(chalk.green(`Resolved scan issue: ${id}`));
    } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
  });

SCAN_COMMON_OPTIONS(
  scanCmd
    .command("a11y <url>")
    .description("WCAG accessibility scan — catches violations in authenticated/dynamic states")
    .option("-p, --page <path>", "Page path to visit (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option("--level <level>", "WCAG level: A, AA, or AAA (default AA)", "AA")
).action(async (url: string, opts) => {
  try {
    const { scanA11y } = await import("../lib/scanners/a11y.js");
    const { upsertScanIssue } = await import("../db/scan-issues.js");
    const result = await scanA11y({ url, pages: opts.page, wcagLevel: opts.level as "A" | "AA" | "AAA", headed: opts.headed, timeoutMs: parseInt(opts.timeout ?? "15000") });
    result.issues.forEach((i) => upsertScanIssue(i, opts.project));
    printScanResult(result, opts.json);
  } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

SCAN_COMMON_OPTIONS(
  scanCmd
    .command("injection <url>")
    .description("Probe AI endpoints for prompt injection vulnerabilities (OWASP LLM Top 10 #1)")
    .option("--endpoint <path>", "AI endpoint path to probe (default: /api/chat)", "/api/chat")
    .option("--input-field <path>", "JSON path for input field (default: messages[0].content)", "messages[0].content")
    .option("--output-field <path>", "JSON path for response extraction")
    .option("--category <cat>", "Payload category filter: extraction|role_override|jailbreak|data_exfil|indirect (repeatable)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
).action(async (url: string, opts) => {
  try {
    const { scanInjection } = await import("../lib/scanners/injection.js");
    const { upsertScanIssue } = await import("../db/scan-issues.js");

    log(chalk.bold(`  Injection probe: ${url}`));
    log(chalk.dim(`  Endpoint: ${opts.endpoint}  |  Payload categories: ${opts.category.length > 0 ? opts.category.join(", ") : "all"}`));
    log("");

    const result = await scanInjection({
      url,
      endpoint: opts.endpoint,
      inputField: opts.inputField,
      outputField: opts.outputField,
      payloadCategories: opts.category.length > 0 ? opts.category as ("extraction" | "role_override" | "jailbreak" | "data_exfil" | "indirect")[] : undefined,
      timeoutMs: parseInt(opts.timeout ?? "15000"),
      headed: opts.headed,
    });

    result.issues.forEach((i) => upsertScanIssue(i, opts.project));

    if (opts.json) { log(JSON.stringify(result, null, 2)); return; }

    log(chalk.bold(`  Results: ${result.payloadsTested} payloads tested in ${(result.durationMs / 1000).toFixed(1)}s`));
    log("");
    for (const f of result.findings) {
      const icon = f.vulnerabilityDetected
        ? (f.severity === "critical" ? chalk.bgRed.white(` ${f.severity.toUpperCase()} `) : chalk.red(`[${f.severity}]`))
        : chalk.green("  ✓  ");
      log(`  ${icon} ${f.description} (${f.category})`);
      if (f.vulnerabilityDetected) {
        log(chalk.dim(`        Response: ${f.response.slice(0, 100)}`));
        log(chalk.dim(`        Judge: ${f.judgeReason}`));
      }
    }
    log("");
    if (result.vulnerableCount > 0) {
      log(chalk.red(`  ⚠ ${result.vulnerableCount} potential vulnerabilities detected`));
      process.exit(1);
    } else {
      log(chalk.green(`  ✓ No injection vulnerabilities detected`));
    }
  } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

SCAN_COMMON_OPTIONS(
  scanCmd
    .command("pii <url>")
    .description("Scan AI API endpoint responses for PII and data leaks")
    .option("--endpoint <path>", "API endpoint path (default: /api/chat)", "/api/chat")
    .option("--seed <values>", "Comma-separated known PII values to watch for (e.g. 'user@example.com,555-1234')")
    .option("--input-field <path>", "JSON path to inject prompt (e.g. messages[0].content)")
).action(async (url: string, opts) => {
  try {
    const { scanPiiEndpoint } = await import("../lib/scanners/pii-scanner.js");
    const { upsertScanIssue } = await import("../db/scan-issues.js");
    const seedPii = opts.seed ? (opts.seed as string).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined;

    log(chalk.dim(`Scanning ${url}${opts.endpoint} for PII leaks...`));
    const result = await scanPiiEndpoint({
      url,
      endpoint: opts.endpoint,
      inputField: opts.inputField,
      seedPii,
      timeoutMs: parseInt(opts.timeout, 10),
    });

    result.issues.forEach((i) => upsertScanIssue(i, opts.project));

    if (opts.json) { log(JSON.stringify(result, null, 2)); return; }

    log("");
    log(chalk.bold("  PII Leak Scan Results"));
    log(chalk.dim("  ──────────────────────────────────────────────────"));

    if (result.issues.length === 0) {
      log(chalk.green("  ✓ No PII detected in AI responses"));
    } else {
      log(chalk.red(`  ${result.issues.length} PII issue(s) detected:`));
      log("");
      for (const issue of result.issues) {
        const sev = issue.severity === "critical" ? chalk.bgRed.white(` ${issue.severity} `) :
                    issue.severity === "high"     ? chalk.red(issue.severity) :
                    issue.severity === "medium"   ? chalk.yellow(issue.severity) : chalk.dim(issue.severity);
        log(`  ${sev}  ${issue.message}`);
        if (issue.detail && typeof issue.detail === "object" && (issue.detail as Record<string,unknown>)["context"]) {
          log(chalk.dim(`          Context: ${(issue.detail as Record<string,unknown>)["context"]}`));
        }
      }
      log("");
      if (result.issues.some((i) => i.severity === "critical" || i.severity === "high")) process.exit(1);
    }
    log("");
  } catch (e) { logError(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1); }
});

function printScanResult(result: { url: string; pages: string[]; issues: { type: string; severity: string; pageUrl: string; message: string }[]; durationMs: number }, asJson: boolean) {
  if (asJson) { log(JSON.stringify(result, null, 2)); return; }
  log(chalk.bold(`  ${result.url}`) + chalk.dim(` — ${result.pages.length} page(s) scanned in ${(result.durationMs / 1000).toFixed(1)}s`));
  if (result.issues.length === 0) {
    log(chalk.green("  ✓ No issues found"));
  } else {
    for (const issue of result.issues) {
      const sev = issue.severity === "critical" ? chalk.bgRed.white(` ${issue.severity} `) :
                  issue.severity === "high"     ? chalk.red(issue.severity) :
                  issue.severity === "medium"   ? chalk.yellow(issue.severity) : chalk.dim(issue.severity);
      log(`  ${sev}  ${issue.message.slice(0, 80)}`);
      log(chalk.dim(`          ${issue.pageUrl}`));
    }
  }
  log("");
}

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
    const dbPath = join(getTestersDir(), "testers.db");
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

    // 4. Check Lightpanda (optional)
    const { isLightpandaAvailable } = await import("../lib/browser-lightpanda.js");
    const lightpandaAvailable = isLightpandaAvailable();
    log((lightpandaAvailable ? chalk.green("✓") : chalk.dim("○")) + ` Lightpanda: ${lightpandaAvailable ? "installed" : "not installed (optional)"}`);

    const { isBunWebViewAvailable } = await import("../lib/browser-bun.js");
    const bunAvailable = isBunWebViewAvailable();
    log((bunAvailable ? chalk.green("✓") : chalk.dim("○")) + ` Bun.WebView: ${bunAvailable ? "available (native, ~11x faster)" : "not available — upgrade to Bun canary: bun upgrade --canary (optional)"}`);

    // 5. Check AI provider API keys
    log("");
    log(chalk.dim("  AI Providers:"));
    const anthropicKey = !!process.env["ANTHROPIC_API_KEY"];
    const openaiKey = !!process.env["OPENAI_API_KEY"];
    const googleKey = !!process.env["GOOGLE_API_KEY"];
    const cerebrasKey = !!process.env["CEREBRAS_API_KEY"];
    log((anthropicKey ? chalk.green("  ✓") : chalk.red("  ✗")) + ` Anthropic (ANTHROPIC_API_KEY)${!anthropicKey ? " — required for default model" : ""}`);
    log((openaiKey ? chalk.green("  ✓") : chalk.dim("  ○")) + ` OpenAI (OPENAI_API_KEY) — optional, enables gpt-* models`);
    log((googleKey ? chalk.green("  ✓") : chalk.dim("  ○")) + ` Google Gemini (GOOGLE_API_KEY) — optional, enables gemini-* models`);
    log((cerebrasKey ? chalk.green("  ✓") : chalk.dim("  ○")) + ` Cerebras (CEREBRAS_API_KEY) — optional, enables llama-*/qwen-* at ~20x faster inference`);
    if (!anthropicKey && !openaiKey && !googleKey && !cerebrasKey) {
      log(chalk.red("  ✗") + " No AI provider API keys found — at least one is required");
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

// ─── testers api ────────────────────────────────────────────────────────────

const apiCmd = program.command("api").description("Manage and run API health checks");

apiCmd
  .command("list")
  .description("List API checks")
  .option("--project <id>", "Filter by project ID")
  .option("--enabled", "Show only enabled checks")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const projectId = resolveProject(opts.project);
      const checks = listApiChecks({ projectId, enabled: opts.enabled ? true : undefined });
      if (opts.json) { log(JSON.stringify(checks, null, 2)); return; }
      if (checks.length === 0) { log(chalk.dim("No API checks found.")); return; }
      log("");
      log(chalk.bold("  API Checks"));
      log("");
      log(`  ${"ID".padEnd(10)} ${"Method".padEnd(8)} ${"Name".padEnd(25)} ${"URL".padEnd(35)} ${"Status".padEnd(8)} Tags`);
      log(`  ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(25)} ${"─".repeat(35)} ${"─".repeat(8)} ${"─".repeat(20)}`);
      for (const c of checks) {
        const enabled = c.enabled ? chalk.green("on") : chalk.red("off");
        const method = c.method.padEnd(6);
        log(`  ${c.shortId.padEnd(10)} ${method.padEnd(8)} ${c.name.slice(0, 24).padEnd(25)} ${c.url.slice(0, 34).padEnd(35)} ${enabled.toString().padEnd(8)} ${c.tags.join(", ")}`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

apiCmd
  .command("add")
  .description("Add a new API check (interactive if no --url given)")
  .option("--project <id>", "Project ID")
  .option("-n, --name <name>", "Check name (non-interactive)")
  .option("-u, --url <url>", "URL to check, full or path (non-interactive)")
  .option("-m, --method <method>", "HTTP method (default: GET)")
  .option("--status <code>", "Expected HTTP status code (default: 200)")
  .option("--contains <text>", "Body must contain this string")
  .option("--response-time <ms>", "Max acceptable response time in ms")
  .option("-t, --tag <tag>", "Tag (repeatable)", [] as string[])
  .action(async (opts) => {
    try {
      // Non-interactive mode
      if (opts.url) {
        const projectId = resolveProject(opts.project);
        const check = createApiCheck({
          name: opts.name?.trim() || opts.url,
          method: (opts.method?.toUpperCase() ?? "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
          url: opts.url.trim(),
          expectedStatus: opts.status ? parseInt(opts.status, 10) : 200,
          expectedBodyContains: opts.contains || undefined,
          expectedResponseTimeMs: opts.responseTime ? parseInt(opts.responseTime, 10) : undefined,
          tags: opts.tag ?? [],
          projectId,
        });
        log("");
        log(chalk.green(`✓ Created API check ${chalk.bold(check.name)} (${check.shortId})`));
        log(chalk.dim(`  ${check.method} ${check.url} → expect ${check.expectedStatus}`));
        return;
      }

      // Interactive mode
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
      const name = await ask("Name: ");
      if (!name.trim()) { logError(chalk.red("Name is required")); process.exit(1); }
      const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
      log(`Method [${methods.join("/")}] (default: GET): `);
      const methodInput = (await ask("")).trim().toUpperCase() || "GET";
      const method = methods.includes(methodInput) ? methodInput : "GET";
      const url = await ask("URL (full or path like /api/health): ");
      if (!url.trim()) { logError(chalk.red("URL is required")); process.exit(1); }
      const statusInput = await ask("Expected status (default 200): ");
      const expectedStatus = statusInput.trim() ? parseInt(statusInput.trim(), 10) : 200;
      const bodyContains = await ask("Body must contain (optional, press enter to skip): ");
      const tagsInput = await ask("Tags (comma-separated, optional): ");
      rl.close();
      const projectId = resolveProject(opts.project);
      const check = createApiCheck({
        name: name.trim(),
        method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
        url: url.trim(),
        expectedStatus,
        expectedBodyContains: bodyContains.trim() || undefined,
        tags: tagsInput.trim() ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean) : [],
        projectId,
      });
      log("");
      log(chalk.green(`✓ Created API check ${chalk.bold(check.name)} (${check.shortId})`));
      log(chalk.dim(`  ${check.method} ${check.url} → expect ${check.expectedStatus}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

apiCmd
  .command("show <id>")
  .description("Show API check details and last result")
  .action((id: string) => {
    try {
      const check = getApiCheck(id);
      if (!check) { logError(chalk.red(`API check not found: ${id}`)); process.exit(1); }
      log("");
      log(chalk.bold(`  API Check: ${check.name}`));
      log(`  ID:            ${check.id}`);
      log(`  Short ID:      ${check.shortId}`);
      log(`  Method:        ${check.method}`);
      log(`  URL:           ${check.url}`);
      log(`  Expected:      ${check.expectedStatus}${check.expectedBodyContains ? ` + body contains "${check.expectedBodyContains}"` : ""}`);
      log(`  Timeout:       ${check.timeoutMs}ms`);
      log(`  Enabled:       ${check.enabled ? chalk.green("yes") : chalk.red("no")}`);
      log(`  Tags:          ${check.tags.length > 0 ? check.tags.join(", ") : chalk.dim("none")}`);
      log(`  Created:       ${check.createdAt}`);
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

apiCmd
  .command("run [base-url]")
  .description("Run API checks against a base URL")
  .option("--check <id>", "Run a specific check by ID")
  .option("--project <id>", "Filter by project ID")
  .option("--env <name>", "Use a named environment's URL as the base URL")
  .option("--parallel <n>", "Parallel requests", "5")
  .option("--json", "Output as JSON", false)
  .action(async (baseUrlArg: string | undefined, opts) => {
    try {
      const projectId = resolveProject(opts.project);
      let baseUrl = baseUrlArg;
      if (!baseUrl && opts.env) {
        const env = getEnvironment(opts.env);
        if (!env) { logError(chalk.red(`Environment not found: ${opts.env}`)); process.exit(1); }
        baseUrl = env.url;
        log(chalk.dim(`Using environment: ${env.name} (${env.url})`));
      }
      if (!baseUrl) {
        const defaultEnv = getDefaultEnvironment();
        if (defaultEnv) {
          baseUrl = defaultEnv.url;
          log(chalk.dim(`Using default environment: ${defaultEnv.name} (${defaultEnv.url})`));
        }
      }
      if (!baseUrl) {
        logError(chalk.red("No base URL provided. Pass a URL argument, use --env <name>, or set a default environment."));
        process.exit(1);
      }
      if (opts.check) {
        const check = getApiCheck(opts.check);
        if (!check) { logError(chalk.red(`API check not found: ${opts.check}`)); process.exit(1); }
        log(chalk.dim(`Running ${check.method} ${check.url}...`));
        const result = await runApiCheck(check, { baseUrl });
        if (opts.json) { log(JSON.stringify(result, null, 2)); return; }
        const icon = result.status === "passed" ? chalk.green("✓") : result.status === "failed" ? chalk.red("✗") : chalk.yellow("!");
        log(`${icon} ${check.name} — ${result.status} (${result.responseTimeMs ?? "?"}ms, HTTP ${result.statusCode ?? "?"})`);
        if (result.assertionsFailed.length > 0) {
          for (const f of result.assertionsFailed) log(chalk.red(`  ✗ ${f}`));
        }
        if (result.error) log(chalk.red(`  Error: ${result.error}`));
      } else {
        const parallel = parseInt(opts.parallel, 10);
        log(chalk.dim(`Running all enabled API checks against ${baseUrl}...`));
        const { results, passed, failed, errors } = await runApiChecksByFilter({ baseUrl, projectId, parallel });
        if (opts.json) { log(JSON.stringify({ results, passed, failed, errors }, null, 2)); return; }
        log("");
        for (const r of results) {
          const check = getApiCheck(r.checkId);
          const name = check?.name ?? r.checkId;
          const icon = r.status === "passed" ? chalk.green("✓") : r.status === "failed" ? chalk.red("✗") : chalk.yellow("!");
          log(`  ${icon} ${name} (${r.responseTimeMs ?? "?"}ms, HTTP ${r.statusCode ?? "?"})`);
          if (r.assertionsFailed.length > 0) for (const f of r.assertionsFailed) log(chalk.red(`      ✗ ${f}`));
          if (r.error) log(chalk.red(`      Error: ${r.error}`));
        }
        log("");
        const passColor = passed > 0 ? chalk.green : chalk.dim;
        const failColor = failed + errors > 0 ? chalk.red : chalk.dim;
        log(`  ${passColor(`${passed} passed`)}  ${failColor(`${failed + errors} failed`)}  ${results.length} total`);
        log("");
        if (failed + errors > 0) process.exit(1);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

apiCmd
  .command("delete <id>")
  .description("Delete an API check")
  .option("-y, --yes", "Skip confirmation", false)
  .action(async (id: string, opts) => {
    try {
      const check = getApiCheck(id);
      if (!check) { logError(chalk.red(`API check not found: ${id}`)); process.exit(1); }
      if (!opts.yes) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((res) => rl.question(`Delete "${check.name}" (${check.shortId})? [y/N] `, res));
        rl.close();
        if (answer.toLowerCase() !== "y") { log(chalk.dim("Cancelled.")); return; }
      }
      deleteApiCheck(id);
      log(chalk.green(`✓ Deleted API check ${chalk.bold(check.name)}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

apiCmd
  .command("import <spec>")
  .description("Import API checks from an OpenAPI/Swagger JSON spec file")
  .option("--project <id>", "Project ID")
  .option("--dry-run", "Preview what would be created without saving", false)
  .action(async (spec: string, opts) => {
    try {
      const { parseOpenAPISpecAsChecks, importApiChecksFromOpenAPI } = await import("../lib/openapi-import.js");
      const projectId = resolveProject(opts.project) ?? undefined;

      if (opts.dryRun) {
        const inputs = parseOpenAPISpecAsChecks(spec);
        log("");
        log(chalk.bold(`  Would create ${inputs.length} API checks:`));
        log("");
        log(`  ${"Method".padEnd(8)} ${"URL".padEnd(40)} ${"Expected".padEnd(10)} Tags`);
        log(`  ${"─".repeat(8)} ${"─".repeat(40)} ${"─".repeat(10)} ${"─".repeat(20)}`);
        for (const c of inputs) {
          log(`  ${(c.method ?? "GET").padEnd(8)} ${(c.url ?? "").slice(0, 39).padEnd(40)} ${String(c.expectedStatus ?? 200).padEnd(10)} ${(c.tags ?? []).join(", ")}`);
        }
        log("");
        return;
      }

      const { imported, checks } = importApiChecksFromOpenAPI(spec, projectId);
      log("");
      log(chalk.green(`✓ Imported ${imported} API checks from spec:`));
      log("");
      log(`  ${"ID".padEnd(10)} ${"Method".padEnd(8)} ${"URL".padEnd(40)} Status`);
      log(`  ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(40)} ${"─".repeat(6)}`);
      for (const c of checks) {
        log(`  ${c.shortId.padEnd(10)} ${c.method.padEnd(8)} ${c.url.slice(0, 39).padEnd(40)} ${c.expectedStatus}`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

apiCmd
  .command("profile <url>")
  .description("Hit an AI endpoint and display its LLM latency and cost profile")
  .option("--method <method>", "HTTP method", "POST")
  .option("--header <header>", "Request header (repeatable, format: 'Key: Value')", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
  .option("--body <json>", "Request body (JSON string)")
  .option("--timeout <ms>", "Request timeout in ms", "30000")
  .option("--json", "Output as JSON", false)
  .action(async (url: string, opts) => {
    try {
      const { profileAIEndpoint, isAIEndpoint } = await import("../lib/ai-profiler.js");
      const headers: Record<string, string> = {};
      for (const h of (opts.header as string[])) {
        const colonIdx = h.indexOf(":");
        if (colonIdx > 0) {
          headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
        }
      }
      log(chalk.dim(`Profiling AI endpoint: ${url} ...`));
      const profile = await profileAIEndpoint(url, {
        method: opts.method,
        headers,
        body: opts.body,
        timeoutMs: parseInt(opts.timeout, 10),
      });
      if (opts.json) { log(JSON.stringify(profile, null, 2)); return; }
      const isAI = isAIEndpoint(url);
      log("");
      log(chalk.bold("  LLM Endpoint Profile"));
      log(chalk.dim("  ─────────────────────────────────────────"));
      log(`  Endpoint:       ${profile.endpoint}`);
      log(`  Status code:    ${profile.statusCode}`);
      log(`  Total time:     ${chalk.cyan(`${profile.totalMs}ms`)}`);
      if (profile.ttftMs !== null) log(`  TTFT:           ${chalk.cyan(`${profile.ttftMs}ms`)} (time to first token)`);
      log(`  AI endpoint:    ${isAI ? chalk.green("yes") : chalk.yellow("no (not detected as AI)")}`);
      log(`  Model:          ${profile.model ?? chalk.dim("unknown")}`);
      log(`  Provider:       ${profile.provider ?? chalk.dim("unknown")}`);
      log(`  Input tokens:   ${profile.inputTokens ?? chalk.dim("unknown")}`);
      log(`  Output tokens:  ${profile.outputTokens ?? chalk.dim("unknown")}`);
      if (profile.estimatedCostCents !== null) {
        log(`  Est. cost:      ${chalk.yellow(`$${(profile.estimatedCostCents / 100).toFixed(6)}`)} (${profile.estimatedCostCents.toFixed(4)} cents)`);
      } else {
        log(`  Est. cost:      ${chalk.dim("unknown (model not in pricing table)")}`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

apiCmd
  .command("monitor [base-url]")
  .description("Continuously run API checks and report only changes (new failures/recoveries)")
  .option("--interval <seconds>", "Poll interval in seconds", "30")
  .option("--project <id>", "Filter by project ID")
  .option("--env <name>", "Use a named environment's URL")
  .action(async (baseUrlArg: string | undefined, opts) => {
    try {
      const projectId = resolveProject(opts.project);
      let baseUrl = baseUrlArg;
      if (!baseUrl && opts.env) {
        const env = getEnvironment(opts.env);
        if (!env) { logError(chalk.red(`Environment not found: ${opts.env}`)); process.exit(1); }
        baseUrl = env.url;
      }
      if (!baseUrl) {
        const defaultEnv = getDefaultEnvironment();
        if (defaultEnv) {
          baseUrl = defaultEnv.url;
          log(chalk.dim(`Using default environment: ${defaultEnv.name} (${defaultEnv.url})`));
        }
      }
      if (!baseUrl) { logError(chalk.red("No base URL. Pass a URL, --env, or set a default environment.")); process.exit(1); }

      const intervalMs = parseInt(opts.interval, 10) * 1000;
      const lastStatus = new Map<string, string>(); // checkId → last status
      let runCount = 0;

      log("");
      log(chalk.bold(`  Monitoring API checks against ${chalk.cyan(baseUrl)}`));
      log(chalk.dim(`  Polling every ${opts.interval}s — press Ctrl+C to stop`));
      log("");

      const poll = async () => {
        const checks = listApiChecks({ projectId, enabled: true });
        if (checks.length === 0) {
          log(chalk.yellow("  No enabled API checks found."));
          return;
        }
        runCount++;
        const { results } = await runApiChecksByFilter({ baseUrl: baseUrl!, projectId, parallel: 5 });

        let changed = 0;
        const now = new Date().toLocaleTimeString();
        for (const result of results) {
          const check = checks.find((c) => c.id === result.checkId);
          const name = check?.name ?? result.checkId;
          const prev = lastStatus.get(result.checkId);
          const curr = result.status;

          if (prev !== curr) {
            changed++;
            if (!prev) {
              // First run — only log failures
              if (curr !== "passed") {
                const icon = curr === "failed" ? chalk.red("✗") : chalk.yellow("!");
                log(`  [${now}] ${icon} ${chalk.bold(name)} — ${curr} (${result.responseTimeMs ?? "?"}ms, HTTP ${result.statusCode ?? "?"})`);
                if (result.assertionsFailed.length > 0) {
                  for (const f of result.assertionsFailed) log(chalk.red(`      ✗ ${f}`));
                }
                if (result.error) log(chalk.red(`      Error: ${result.error}`));
              }
            } else if (prev !== "passed" && curr === "passed") {
              log(`  [${now}] ${chalk.green("✓")} ${chalk.bold(name)} — ${chalk.green("recovered")} (was ${prev})`);
            } else if (prev === "passed" && curr !== "passed") {
              const icon = curr === "failed" ? chalk.red("✗") : chalk.yellow("!");
              log(`  [${now}] ${icon} ${chalk.bold(name)} — ${chalk.red(curr)} (was passing, HTTP ${result.statusCode ?? "?"})`);
              if (result.assertionsFailed.length > 0) {
                for (const f of result.assertionsFailed) log(chalk.red(`      ✗ ${f}`));
              }
              if (result.error) log(chalk.red(`      Error: ${result.error}`));
            } else {
              // status changed between two non-passing states
              log(`  [${now}] ${chalk.yellow("!")} ${chalk.bold(name)} — ${curr} (was ${prev})`);
            }
            lastStatus.set(result.checkId, curr);
          } else if (!prev) {
            lastStatus.set(result.checkId, curr);
          }
        }

        if (runCount === 1 && changed === 0) {
          const passing = results.filter((r) => r.status === "passed").length;
          log(chalk.dim(`  [${now}] Initial run — ${passing}/${results.length} passing, watching for changes…`));
        } else if (changed === 0 && runCount > 1) {
          // Silence — no changes
        }
      };

      await poll();
      const interval = setInterval(poll, intervalMs);

      // Keep process alive
      process.on("SIGINT", () => {
        clearInterval(interval);
        log("");
        log(chalk.dim(`  Stopped monitoring after ${runCount} run(s).`));
        process.exit(0);
      });

      // Prevent process from exiting
      await new Promise(() => {});
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers persona ─────────────────────────────────────────────────────────
const personaCmd = program.command("persona").description("Manage test personas");

personaCmd
  .command("list")
  .description("List personas")
  .option("--project <id>", "Filter by project ID")
  .option("--global", "Show only global personas", false)
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const projectId = resolveProject(opts.project);
      const personas = listPersonas({
        projectId: opts.global ? undefined : projectId,
        globalOnly: opts.global ? true : undefined,
      });
      if (opts.json) {
        log(JSON.stringify(personas, null, 2));
        return;
      }
      if (personas.length === 0) {
        log(chalk.dim("No personas found."));
        return;
      }
      log("");
      log(chalk.bold("  Personas"));
      log("");
      log(`  ${"ID".padEnd(10)} ${"Name".padEnd(22)} ${"Role".padEnd(22)} ${"Scope".padEnd(18)} Traits`);
      log(`  ${"─".repeat(10)} ${"─".repeat(22)} ${"─".repeat(22)} ${"─".repeat(18)} ${"─".repeat(10)}`);
      for (const p of personas) {
        const scope = p.projectId ? chalk.dim(`project`) : chalk.blue("Global");
        log(`  ${p.shortId.padEnd(10)} ${p.name.slice(0, 21).padEnd(22)} ${p.role.slice(0, 21).padEnd(22)} ${scope.toString().padEnd(18)} ${p.traits.length} traits`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

personaCmd
  .command("add")
  .description("Create a persona (interactive if no --name/--role given)")
  .option("--global", "Create as a global persona (no project scope)", false)
  .option("--project <id>", "Project ID")
  .option("-n, --name <name>", "Persona name (non-interactive)")
  .option("-r, --role <role>", "Persona role (non-interactive)")
  .option("-d, --description <text>", "Persona description")
  .option("-i, --instructions <text>", "Behavior instructions")
  .option("--traits <list>", "Comma-separated traits (e.g. impatient,curious)")
  .option("--goals <list>", "Comma-separated goals")
  .option("--auth-email <email>", "Login email for auth testing")
  .option("--auth-password <pass>", "Login password for auth testing")
  .option("--auth-login-path <path>", "Login page path (default: /login)")
  .action(async (opts) => {
    try {
      // Non-interactive mode: --name and --role provided
      if (opts.name && opts.role) {
        const projectId = opts.global ? undefined : resolveProject(opts.project);
        const traits = opts.traits ? opts.traits.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
        const goals = opts.goals ? opts.goals.split(",").map((g: string) => g.trim()).filter(Boolean) : [];
        const persona = createPersona({
          name: opts.name.trim(),
          role: opts.role.trim(),
          description: opts.description?.trim() ?? "",
          instructions: opts.instructions?.trim() ?? "",
          traits,
          goals,
          projectId,
          authEmail: opts.authEmail,
          authPassword: opts.authPassword,
          authLoginPath: opts.authLoginPath,
        });
        log("");
        log(chalk.green(`Created persona ${chalk.bold(persona.shortId)}: ${persona.name}`));
        log(chalk.dim(`  Role: ${persona.role}`));
        log(chalk.dim(`  Scope: ${persona.projectId ? "project" : "global"}`));
        return;
      }

      // Interactive mode
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
      const name = await ask("Name: ");
      if (!name.trim()) { logError(chalk.red("Name is required")); rl.close(); process.exit(1); }
      const role = await ask("Role (e.g. first-time user, admin, power user): ");
      if (!role.trim()) { logError(chalk.red("Role is required")); rl.close(); process.exit(1); }
      const description = await ask("Description (optional): ");
      const instructions = await ask("Instructions — how should this persona behave? (optional): ");
      const traitsInput = await ask("Traits (comma-separated, e.g. impatient,curious): ");
      const goalsInput = await ask("Goals (comma-separated): ");
      rl.close();

      const projectId = opts.global ? undefined : resolveProject(opts.project);
      const traits = traitsInput.trim() ? traitsInput.split(",").map((t) => t.trim()).filter(Boolean) : [];
      const goals = goalsInput.trim() ? goalsInput.split(",").map((g) => g.trim()).filter(Boolean) : [];

      const persona = createPersona({
        name: name.trim(),
        role: role.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        traits,
        goals,
        projectId,
      });
      log("");
      log(chalk.green(`Created persona ${chalk.bold(persona.shortId)}: ${persona.name}`));
      log(chalk.dim(`  Role: ${persona.role}`));
      log(chalk.dim(`  Scope: ${persona.projectId ? "project" : "global"}`));
    } catch (error) {
      rl.close();
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

personaCmd
  .command("show <id>")
  .description("Show persona details")
  .action((id: string) => {
    try {
      const persona = getPersona(id);
      if (!persona) { logError(chalk.red(`Persona not found: ${id}`)); process.exit(1); }
      log("");
      log(chalk.bold(`  Persona: ${persona.name}`));
      log(`  ID:           ${chalk.dim(persona.id)}`);
      log(`  Short ID:     ${persona.shortId}`);
      log(`  Role:         ${persona.role}`);
      log(`  Scope:        ${persona.projectId ? `project (${persona.projectId})` : chalk.blue("Global")}`);
      log(`  Enabled:      ${persona.enabled ? chalk.green("yes") : chalk.red("no")}`);
      log(`  Description:  ${persona.description || chalk.dim("none")}`);
      log(`  Instructions: ${persona.instructions || chalk.dim("none")}`);
      log(`  Traits:       ${persona.traits.length > 0 ? persona.traits.join(", ") : chalk.dim("none")}`);
      log(`  Goals:        ${persona.goals.length > 0 ? persona.goals.join(", ") : chalk.dim("none")}`);
      log(`  Version:      ${persona.version}`);
      log(`  Created:      ${persona.createdAt}`);
      log(`  Updated:      ${persona.updatedAt}`);
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

personaCmd
  .command("delete <id>")
  .description("Delete a persona")
  .option("-y, --yes", "Skip confirmation prompt", false)
  .action(async (id: string, opts) => {
    try {
      const persona = getPersona(id);
      if (!persona) { logError(chalk.red(`Persona not found: ${id}`)); process.exit(1); }
      if (!opts.yes) {
        process.stdout.write(chalk.yellow(`Delete persona ${persona.shortId} "${persona.name}"? [y/N] `));
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
        if (answer !== "y" && answer !== "yes") { log(chalk.dim("Cancelled.")); return; }
      }
      const deleted = deletePersona(persona.id);
      if (deleted) {
        log(chalk.green(`Deleted persona ${persona.shortId}: ${persona.name}`));
      } else {
        logError(chalk.red(`Failed to delete persona: ${id}`));
        process.exit(1);
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

personaCmd
  .command("attach <persona-id> <scenario-id>")
  .description("Attach a persona to a scenario")
  .action(async (personaId: string, scenarioId: string) => {
    try {
      const persona = getPersona(personaId);
      if (!persona) { logError(chalk.red(`Persona not found: ${personaId}`)); process.exit(1); }
      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) { logError(chalk.red(`Scenario not found: ${scenarioId}`)); process.exit(1); }
      updateScenario(scenario.id, { personaId: persona.id } as Parameters<typeof updateScenario>[1], scenario.version);
      log(chalk.green(`Attached persona '${persona.name}' to scenario ${scenario.shortId}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

personaCmd
  .command("seed")
  .description("Seed the 7 default global personas (idempotent)")
  .option("--json", "Output as JSON", false)
  .action((seedOpts) => {
    try {
      const { seedDefaultPersonas } = require("../db/seed-personas.js");
      const result = seedDefaultPersonas();
      if (seedOpts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        if (result.seeded > 0) {
          log(chalk.green(`Seeded ${result.seeded} default personas.`));
        } else {
          log(chalk.dim(`Default personas already present (${result.skipped} skipped).`));
        }
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

personaCmd
  .command("detach <scenario-id>")
  .description("Detach persona from a scenario")
  .action(async (scenarioId: string) => {
    try {
      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) { logError(chalk.red(`Scenario not found: ${scenarioId}`)); process.exit(1); }
      updateScenario(scenario.id, { personaId: null } as Parameters<typeof updateScenario>[1], scenario.version);
      log(chalk.green(`Detached persona from scenario ${scenario.shortId}`));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers persona diff <p1> <p2> ──────────────────────────────────────────

personaCmd
  .command("diff <persona1> <persona2>")
  .description("Run a scenario under 2 personas and show behavioral differences")
  .requiredOption("--url <url>", "Base URL to run against")
  .option("--scenario <id>", "Scenario ID (runs all scenarios if omitted)")
  .option("--model <model>", "AI model to use")
  .option("--json", "Output as JSON", false)
  .action(async (persona1: string, persona2: string, opts) => {
    try {
      const p1 = getPersona(persona1);
      if (!p1) { logError(chalk.red(`Persona not found: ${persona1}`)); process.exit(1); }
      const p2 = getPersona(persona2);
      if (!p2) { logError(chalk.red(`Persona not found: ${persona2}`)); process.exit(1); }

      log(chalk.dim(`Running scenarios under personas: ${p1.name} vs ${p2.name} ...`));

      const { runByFilter } = await import("../lib/runner.js");
      const { diffPersonaResults, formatDivergenceTerminal } = await import("../lib/persona-diff.js");

      // Run under persona 1
      const result1 = await runByFilter({
        url: opts.url,
        scenarioIds: opts.scenario ? [opts.scenario] : undefined,
        model: opts.model,
        personaId: p1.id,
      });

      // Run under persona 2
      const result2 = await runByFilter({
        url: opts.url,
        scenarioIds: opts.scenario ? [opts.scenario] : undefined,
        model: opts.model,
        personaId: p2.id,
      });

      const allResults = [...result1.results, ...result2.results];
      const scenarios = listScenarios({});

      const divergences = diffPersonaResults(allResults, scenarios.map((s) => ({ id: s.id, name: s.name })));

      if (opts.json) {
        log(JSON.stringify(divergences, null, 2));
        return;
      }

      log(formatDivergenceTerminal(divergences));
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers convert <file> ──────────────────────────────────────────────────

program
  .command("convert <file>")
  .description("Convert a recorded browser session (rrweb/HAR) into a test scenario")
  .option("--format <format>", "Session format: rrweb, har, or testers (auto-detected if omitted)")
  .option("--name <name>", "Scenario name")
  .option("--model <model>", "AI model for step synthesis")
  .option("--save", "Save the scenario to the database", false)
  .option("--project <id>", "Project ID (when --save)")
  .option("--json", "Output as JSON", false)
  .action(async (file: string, opts) => {
    try {
      const { convertSessionFile, detectSessionFormat } = await import("../lib/session-converter.js");
      const format = opts.format ?? detectSessionFormat(file);
      const scenario = await convertSessionFile(file, format, {
        name: opts.name,
        model: opts.model,
      });

      if (opts.json) {
        log(JSON.stringify(scenario, null, 2));
        return;
      }

      log(chalk.bold(`\n  Converted scenario: ${scenario.name}`));
      log(`  Description: ${scenario.description}`);
      log(`  Steps: ${scenario.steps.length}`);
      if (scenario.targetPath) log(`  Target path: ${scenario.targetPath}`);
      log(`  Tags: ${scenario.tags.join(", ")}`);
      log("");
      for (let i = 0; i < scenario.steps.length; i++) {
        log(`  ${chalk.dim(`${i + 1}.`)} ${scenario.steps[i]}`);
      }

      if (opts.save) {
        const projectId = resolveProject(opts.project);
        const saved = createScenario({
          name: scenario.name,
          description: scenario.description,
          steps: scenario.steps,
          tags: scenario.tags,
          targetPath: scenario.targetPath,
          priority: "medium" as ScenarioPriority,
          projectId,
        });
        log(chalk.green(`\nSaved as scenario ${chalk.bold(saved.shortId)}: ${saved.name}`));
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers eval ────────────────────────────────────────────────────────────

const evalCmd = program.command("eval").description("Run AI evaluation pipelines (RAG quality, factual, faithfulness)");

evalCmd
  .command("rag <url>")
  .description("Run RAG quality evaluation — faithfulness, factual completeness, and hallucination detection")
  .option("--endpoint <path>", "API endpoint path to query (default: /api/chat)", "/api/chat")
  .option("--docs <path>", "Path to JSON file with RAG test cases [{question, sourceDocs, expectedFacts?, forbiddenClaims?}]")
  .option("--method <method>", "HTTP method", "POST")
  .option("--input-field <path>", "JSON path to inject question, e.g. messages[0].content")
  .option("--output-field <path>", "JSON path to extract answer, e.g. choices[0].message.content")
  .option("--json", "Output results as JSON", false)
  .action(async (url: string, opts) => {
    try {
      const { runRagEval } = await import("../lib/eval-runner.js");
      const { createRun, updateRun } = await import("../db/runs.js");

      let ragTestCases: unknown[] = [];
      if (opts.docs) {
        try {
          const raw = readFileSync(opts.docs, "utf-8");
          ragTestCases = JSON.parse(raw) as unknown[];
        } catch {
          logError(chalk.red(`Failed to read docs file: ${opts.docs}`));
          process.exit(1);
        }
      }

      if (ragTestCases.length === 0) {
        logError(chalk.red("No RAG test cases provided. Use --docs <path.json> to load test cases."));
        process.exit(1);
      }

      log(chalk.dim(`Running RAG eval against ${url}${opts.endpoint} with ${ragTestCases.length} test case(s)...`));

      // Create a temporary scenario and run
      const scenario = createScenario({
        name: `RAG eval — ${url}`,
        description: "RAG quality evaluation",
        steps: [],
        tags: ["rag", "eval"],
        metadata: {
          rag: {
            endpoint: opts.endpoint,
            method: opts.method,
            inputField: opts.inputField,
            outputField: opts.outputField,
            baseUrl: url,
            ragTestCases,
          },
        },
      });

      const run = createRun({ scenarioId: scenario.id, model: "rag-eval" });
      await updateRun(run.id, { status: "running" });

      const result = await runRagEval(scenario, { runId: run.id, baseUrl: url });
      await updateRun(run.id, { status: result.status === "passed" ? "passed" : "failed" });

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
        return;
      }

      const ragResult = result.metadata as import("../lib/eval-runner.js").RagEvalResult | null;
      if (!ragResult) { logError(chalk.red("No RAG result data")); process.exit(1); }

      log("");
      log(chalk.bold("  RAG Quality Evaluation Results"));
      log(chalk.dim("  ─────────────────────────────────────────────────────"));
      log(`  Total cases:          ${chalk.bold(String(ragResult.totalCases))}`);
      log(`  Passed:               ${ragResult.passedCases === ragResult.totalCases ? chalk.green(String(ragResult.passedCases)) : chalk.red(String(ragResult.passedCases))}`);
      log(`  Avg faithfulness:     ${chalk.cyan(`${(ragResult.avgFaithfulnessScore * 100).toFixed(0)}%`)}`);
      log(`  Avg factual score:    ${chalk.cyan(`${(ragResult.avgFactualCompletenessScore * 100).toFixed(0)}%`)}`);
      log(`  Forbidden violations: ${ragResult.totalForbiddenViolations > 0 ? chalk.red(String(ragResult.totalForbiddenViolations)) : chalk.green("0")}`);
      log(`  Duration:             ${ragResult.durationMs}ms`);
      log(`  Tokens used:          ${ragResult.tokensUsed}`);
      log("");
      for (const [i, c] of ragResult.caseResults.entries()) {
        const icon = c.passed ? chalk.green("✓") : chalk.red("✗");
        log(`  ${icon} Case ${i + 1}: ${c.question.slice(0, 60)}`);
        if (c.error) { log(chalk.red(`      Error: ${c.error}`)); continue; }
        log(`    Faithfulness: ${(c.faithfulnessScore * 100).toFixed(0)}%  Factual: ${(c.factualCompletenessScore * 100).toFixed(0)}%${c.forbiddenClaimViolations.length > 0 ? chalk.red(`  Violations: ${c.forbiddenClaimViolations.join(", ")}`) : ""}`);
      }
      log("");
      if (!ragResult.passed) process.exit(1);
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers golden ──────────────────────────────────────────────────────────

const goldenCmd = program.command("golden").description("Manage golden answer checks for hallucination detection");

goldenCmd
  .command("add")
  .description("Add a golden answer check (interactive if no --question given)")
  .option("--project <id>", "Project ID")
  .option("-q, --question <text>", "Question the endpoint should answer (non-interactive)")
  .option("-a, --answer <text>", "Expected golden answer (non-interactive)")
  .option("-e, --endpoint <path>", "Endpoint path or URL (non-interactive)")
  .option("--judge-model <model>", "Model to use as judge")
  .action(async (opts) => {
    try {
      const { createGoldenAnswer } = await import("../db/golden-answers.js");

      // Non-interactive mode
      if (opts.question && opts.answer && opts.endpoint) {
        const projectId = resolveProject(opts.project);
        const golden = createGoldenAnswer({
          question: opts.question,
          goldenAnswer: opts.answer,
          endpoint: opts.endpoint,
          judgeModel: opts.judgeModel || undefined,
          projectId,
        });
        log(chalk.green(`\nCreated golden answer check ${chalk.bold(golden.shortId)}`));
        log(`  Endpoint: ${golden.endpoint}`);
        log(`  Question: ${golden.question.slice(0, 60)}`);
        return;
      }

      // Interactive mode
      const ask = (prompt: string): Promise<string> => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()); }));
      };

      const question = await ask("Question (what this endpoint should answer): ");
      if (!question) { logError(chalk.red("Question is required")); process.exit(1); }

      const goldenAnswer = await ask("Expected / golden answer: ");
      if (!goldenAnswer) { logError(chalk.red("Golden answer is required")); process.exit(1); }

      const endpoint = await ask("Endpoint (path or full URL): ");
      if (!endpoint) { logError(chalk.red("Endpoint is required")); process.exit(1); }

      const judgeModel = await ask("Judge model (leave blank for auto): ");
      const projectId = resolveProject(opts.project);

      const golden = createGoldenAnswer({
        question,
        goldenAnswer,
        endpoint,
        judgeModel: judgeModel || undefined,
        projectId,
      });

      log(chalk.green(`\nCreated golden answer check ${chalk.bold(golden.shortId)}`));
      log(`  Endpoint: ${golden.endpoint}`);
      log(`  Question: ${golden.question.slice(0, 60)}`);
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

goldenCmd
  .command("list")
  .description("List golden answer checks")
  .option("--project <id>", "Filter by project ID")
  .option("--json", "Output as JSON", false)
  .action(async (opts) => {
    try {
      const { listGoldenAnswers } = await import("../db/golden-answers.js");
      const projectId = resolveProject(opts.project);
      const goldens = listGoldenAnswers({ projectId });

      if (opts.json) { log(JSON.stringify(goldens, null, 2)); return; }

      if (goldens.length === 0) { log(chalk.dim("No golden answer checks found.")); return; }

      log(chalk.bold(`\n  Golden Answer Checks (${goldens.length})`));
      log(chalk.dim("  ─────────────────────────────────────────────────────"));
      for (const g of goldens) {
        const status = g.enabled ? chalk.green("enabled") : chalk.dim("disabled");
        log(`  ${g.shortId}  ${status}  ${chalk.bold(g.endpoint)}  ${g.question.slice(0, 50)}`);
      }
      log("");
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

goldenCmd
  .command("run <base-url>")
  .description("Run all golden answer checks and report results")
  .option("--project <id>", "Filter by project ID")
  .option("--model <model>", "Judge model to use")
  .option("--json", "Output as JSON", false)
  .action(async (baseUrl: string, opts) => {
    try {
      const { runGoldenMonitor } = await import("../lib/golden-monitor.js");
      const projectId = resolveProject(opts.project);

      log(chalk.dim(`Running golden answer checks against ${baseUrl} ...`));

      const result = await runGoldenMonitor({
        baseUrl,
        projectId,
        judgeModel: opts.model,
      });

      if (opts.json) { log(JSON.stringify(result, null, 2)); return; }

      log(chalk.bold("\n  Golden Answer Monitor Results"));
      log(chalk.dim("  ─────────────────────────────────────────"));
      log(`  Checked: ${result.checked}`);
      log(`  Passed:  ${result.passed === result.checked ? chalk.green(String(result.passed)) : chalk.yellow(String(result.passed))}`);
      log(`  Drifted: ${result.drifted > 0 ? chalk.red(String(result.drifted)) : chalk.green("0")}`);
      log("");
      if (result.drifted > 0) {
        log(chalk.yellow("  Warning: Drift detected in one or more golden checks."));
        log(chalk.yellow("  This may indicate hallucination or response degradation."));
        log("");
      }
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers run-many <url> ───────────────────────────────────────────────────

program
  .command("run-many <url>")
  .description("Run scenarios × personas matrix — test each scenario under multiple personas")
  .option("--personas <ids>", "Comma-separated persona IDs, or 'all' for all global personas", "all")
  .option("--scenarios <ids>", "Comma-separated scenario IDs, or 'all'", "all")
  .option("--parallel <n>", "Parallel workers per run", "2")
  .option("--model <model>", "AI model to use")
  .option("--project <id>", "Filter by project ID")
  .option("--json", "Output as JSON", false)
  .action(async (url: string, opts) => {
    try {
      const projectId = resolveProject(opts.project);

      // Resolve personas
      let personas;
      if (opts.personas === "all") {
        personas = listPersonas({ globalOnly: true, enabled: true });
      } else {
        const ids = opts.personas.split(",").map((s: string) => s.trim()).filter(Boolean);
        personas = ids.map((id: string) => getPersona(id)).filter(Boolean);
      }
      if (personas.length === 0) {
        logError(chalk.red("No personas found. Run: testers persona seed"));
        process.exit(1);
      }

      // Resolve scenarios
      let scenarios;
      if (opts.scenarios === "all") {
        scenarios = listScenarios({ projectId, limit: 20 });
      } else {
        const ids = opts.scenarios.split(",").map((s: string) => s.trim()).filter(Boolean);
        const all = listScenarios({ projectId });
        scenarios = all.filter((s) => ids.includes(s.id) || ids.includes(s.shortId));
      }
      if (scenarios.length === 0) {
        logError(chalk.red("No scenarios found."));
        process.exit(1);
      }

      log("");
      log(chalk.bold(`  Running ${scenarios.length} scenarios × ${personas.length} personas (${scenarios.length * personas.length} total runs)`));
      log("");

      const matrixResults: Array<{ personaName: string; runId: string; run?: import("../types/index.js").Run }> = [];

      for (const persona of personas) {
        if (!persona) continue;
        log(chalk.dim(`  Starting run for persona: ${persona.name} ...`));
        const { run, results } = await runByFilter({
          url,
          scenarioIds: scenarios.map((s) => s.id),
          model: opts.model,
          parallel: parseInt(opts.parallel, 10),
          projectId,
          personaId: persona.id,
        });
        matrixResults.push({ personaName: persona.name, runId: run.id, run });
        const status = run.status === "passed" ? chalk.green("PASS") : chalk.red("FAIL");
        log(`  ${status}  ${persona.name.padEnd(24)} ${run.passed}/${run.total} passed`);
      }

      if (opts.json) {
        log(JSON.stringify(matrixResults.map((r) => ({ personaName: r.personaName, runId: r.runId, run: r.run })), null, 2));
      } else {
        log("");
        log(chalk.bold("  Summary"));
        let allPassed = true;
        for (const r of matrixResults) {
          if (r.run && r.run.failed > 0) allPassed = false;
        }
        log(allPassed ? chalk.green("  All personas passed!") : chalk.yellow("  Some personas had failures — review per-persona results above."));
        log("");
      }

      const anyFailed = matrixResults.some((r) => r.run && r.run.failed > 0);
      process.exit(anyFailed ? 1 : 0);
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── testers run-script <file.ts> ─────────────────────────────────────────────

program
  .command("run-script <file>")
  .description("Run a hybrid test script (.ts) that exports an array of HybridScenario objects")
  .option("--url <url>", "Base URL to run against")
  .option("--json", "Output as JSON", false)
  .action(async (file: string, opts) => {
    try {
      const { resolve } = await import("node:path");
      const { runHybridScenario } = await import("../lib/hybrid-runner.js");
      const scriptPath = resolve(process.cwd(), file);
      const mod = await import(scriptPath);
      const scenarios = mod.scenarios ?? mod.default ?? [];
      if (!Array.isArray(scenarios) || scenarios.length === 0) {
        logError(chalk.red(`No scenarios exported from ${file}. Export an array as 'export const scenarios = [...]'`));
        process.exit(1);
      }
      const results = [];
      for (const scenario of scenarios) {
        log(chalk.dim(`Running: ${scenario.name} ...`));
        const result = await runHybridScenario(scenario, { baseUrl: opts.url });
        results.push(result);
        const icon = result.status === "passed" ? chalk.green("PASS") : chalk.red("FAIL");
        log(`${icon}  ${result.name ?? scenario.name} (${result.durationMs}ms)`);
        if (result.status !== "passed" && result.error) {
          log(chalk.dim(`     ${result.error}`));
        }
      }
      if (opts.json) {
        log(JSON.stringify(results, null, 2));
      }
      const passed = results.filter((r) => r.status === "passed").length;
      const failed = results.length - passed;
      log("");
      log(chalk.bold(`Results: ${passed}/${results.length} passed${failed > 0 ? `, ${failed} failed` : ""}`));
      process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
      logError(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// Apply global flags before any action runs
program.hook("preAction", () => {
  const opts = program.opts();
  QUIET = opts.quiet === true;
  NO_COLOR = opts.color === false || process.env["NO_COLOR"] !== undefined || process.env["FORCE_COLOR"] === "0";
  if (NO_COLOR) {
    // Disable chalk colors globally
    process.env["FORCE_COLOR"] = "0";
    process.env["NO_COLOR"] = "1";
  }
});

program.parse();
