// File-backed workflow commands: Browser-owned manifests under the resolver-resolved browser data home's workflows dir.

import type { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import {
  getWorkflowDir,
  listWorkflowManifests,
  loadWorkflowManifest,
  redactWorkflowEvidence,
  redactWorkflowManifest,
  runWorkflowAction,
  validateAllWorkflowManifests,
  validateWorkflowManifest,
} from "../../lib/workflow-manifests.js";
import type { BrowserEngine } from "../../types/index.js";

export function register(program: Command) {
  const workflowCmd = program.command("workflow").description("Manage Browser-owned file-backed workflow manifests");

  workflowCmd
    .command("dir")
    .description("Print the canonical workflow directory")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const dir = getWorkflowDir();
      if (opts.json) console.log(JSON.stringify({ dir }, null, 2));
      else console.log(dir);
    });

  workflowCmd
    .command("list")
    .description("List workflow manifests from the Browser workflow directory")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Max rows to print in compact output", String(20))
    .option("--verbose", "Show descriptions and manifest paths")
    .action((opts: { json?: boolean; limit?: string; verbose?: boolean }) => {
      const workflows = listWorkflowManifests();
      if (opts.json) {
        console.log(JSON.stringify(workflows.map(({ manifest, path }) => ({ path, manifest: redactWorkflowManifest(manifest) })), null, 2));
      } else if (workflows.length === 0) {
        console.log(chalk.gray(`No workflows found in ${getWorkflowDir()}`));
      } else {
        const { visible } = limited(workflows, parseLimit(opts.limit));
        for (const { manifest, path } of visible) {
          const actions = Object.keys(manifest.actions ?? {});
          console.log(`${chalk.bold(truncate(manifest.name, 40))} ${chalk.gray(manifest.site)} actions=${actions.length}`);
          if (opts.verbose) {
            if (manifest.description) console.log(chalk.gray(`  ${truncate(manifest.description, 180)}`));
            console.log(chalk.gray(`  path: ${path}`));
            console.log(chalk.gray(`  actions: ${actions.join(", ") || "-"}`));
          }
        }
        printListFooter(workflows.length, visible.length, "Use --verbose, --json, or browser workflow show <name> for details.");
      }
    });

  workflowCmd
    .command("show <name>")
    .description("Show one workflow manifest")
    .option("--json", "Output full manifest as JSON")
    .action((name: string, opts: { json?: boolean }) => {
      const loaded = loadWorkflowManifestForCli(name, opts.json);
      if (!loaded) return;
      const validation = validateWorkflowManifest(loaded);
      if (!validation.ok) {
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, path: loaded.path, errors: validation.errors, warnings: validation.warnings }, null, 2));
        } else {
          console.log(chalk.red(`Invalid workflow manifest: ${validation.name ?? loaded.path}`));
          for (const error of validation.errors) console.log(chalk.red(`  error: ${error}`));
        }
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify({ path: loaded.path, manifest: redactWorkflowManifest(loaded.manifest) }, null, 2));
        return;
      }
      const { manifest } = loaded;
      console.log(chalk.bold(`${manifest.name} (${manifest.site})`));
      if (manifest.description) console.log(chalk.gray(`  ${manifest.description}`));
      console.log(chalk.gray(`  path: ${loaded.path}`));
      console.log(chalk.gray(`  runner: ${manifest.runner}`));
      console.log(chalk.gray(`  actions: ${Object.keys(manifest.actions ?? {}).join(", ") || "-"}`));
    });

  workflowCmd
    .command("validate [name]")
    .description("Validate one workflow manifest, or all manifests when no name is provided")
    .option("--json", "Output as JSON")
    .action((name: string | undefined, opts: { json?: boolean }) => {
      const results = name
        ? [validateWorkflowManifestForCli(name)]
        : validateAllWorkflowManifests();

      if (opts.json) {
        console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
      } else if (results.length === 0) {
        console.log(chalk.gray(`No workflows found in ${getWorkflowDir()}`));
      } else {
        for (const result of results) {
          const label = result.ok ? chalk.green("ok") : chalk.red("fail");
          console.log(`${label} ${result.name ?? result.path}`);
          for (const warning of result.warnings) console.log(chalk.yellow(`  warn: ${warning}`));
          for (const error of result.errors) console.log(chalk.red(`  error: ${error}`));
        }
      }

      if (!results.every((result) => result.ok)) process.exitCode = 1;
    });

  workflowCmd
    .command("run <name> <action>")
    .description("Run a workflow action and save Browser-owned evidence")
    .option("--engine <engine>", "Override manifest runner")
    .option("--headed", "Run headed")
    .option("--json", "Output as JSON")
    .option("--allow-mutation", "Allow actions that intentionally mutate external state")
    .option("--allow-risky-capabilities", "Approve trusted local Browser risky capabilities for this run")
    .option("--approval-token <token>", "Capability approval token")
    .option("--timeout-seconds <seconds>", "Override Kernel timeout seconds")
    .option("--var <pairs...>", "Set workflow variables (key=value)")
    .action(async (
      name: string,
      action: string,
      opts: {
        engine?: string;
        headed?: boolean;
        json?: boolean;
        allowMutation?: boolean;
        allowRiskyCapabilities?: boolean;
        approvalToken?: string;
        timeoutSeconds?: string;
        var?: string[];
      },
    ) => {
      const variables: Record<string, string> = {};
      for (const pair of opts.var ?? []) {
        const [key, ...value] = pair.split("=");
        if (key) variables[key] = value.join("=");
      }

      const previousRisky = process.env["BROWSER_ALLOW_RISKY_CAPABILITIES"];
      if (opts.allowRiskyCapabilities) process.env["BROWSER_ALLOW_RISKY_CAPABILITIES"] = "1";
      try {
        const timeoutSeconds = parseTimeoutOption(opts.timeoutSeconds);
        const evidence = await runWorkflowAction(name, {
          action,
          engine: opts.engine as BrowserEngine | undefined,
          headed: opts.headed,
          allowMutation: opts.allowMutation,
          allowRiskyCapabilities: opts.allowRiskyCapabilities,
          approvalToken: opts.approvalToken,
          timeoutSeconds,
          variables,
        });
        const outputEvidence = redactWorkflowEvidence(evidence);
        if (opts.json) {
          console.log(JSON.stringify(outputEvidence, null, 2));
        } else if (outputEvidence.ok) {
          console.log(chalk.green(`ok ${outputEvidence.workflow}:${outputEvidence.action}`));
          console.log(chalk.gray(`  evidence: ${outputEvidence.evidencePath}`));
          console.log(chalk.gray(`  screenshots: ${outputEvidence.screenshots.length}`));
        } else {
          console.log(chalk.red(`fail ${outputEvidence.workflow}:${outputEvidence.action}`));
          if (outputEvidence.error) console.log(chalk.red(`  error: ${outputEvidence.error}`));
          console.log(chalk.gray(`  evidence: ${outputEvidence.evidencePath}`));
          process.exitCode = 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (opts.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
        else console.log(chalk.red(`fail ${name}:${action}\n  error: ${message}`));
        process.exitCode = 1;
      } finally {
        if (opts.allowRiskyCapabilities) {
          if (previousRisky === undefined) delete process.env["BROWSER_ALLOW_RISKY_CAPABILITIES"];
          else process.env["BROWSER_ALLOW_RISKY_CAPABILITIES"] = previousRisky;
        }
      }
    });

  workflowCmd
    .command("exists <name>")
    .description("Check whether a workflow manifest exists")
    .option("--json", "Output as JSON")
    .action((name: string, opts: { json?: boolean }) => {
      let found = false;
      let path: string | undefined;
      try {
        const loaded = loadWorkflowManifest(name);
        found = existsSync(loaded.path);
        path = loaded.path;
      } catch {
        found = false;
      }
      if (opts.json) console.log(JSON.stringify({ found, path }, null, 2));
      else console.log(found ? chalk.green(`yes ${path}`) : chalk.red("no"));
      if (!found) process.exitCode = 1;
    });
}

function parseTimeoutOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 300) {
    throw new Error("--timeout-seconds must be an integer between 30 and 300");
  }
  return parsed;
}

function loadWorkflowManifestForCli(name: string, json?: boolean) {
  try {
    return loadWorkflowManifest(name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.log(chalk.red(`Workflow not found or invalid: ${message}`));
    process.exitCode = 1;
    return undefined;
  }
}

function validateWorkflowManifestForCli(name: string) {
  try {
    return validateWorkflowManifest(loadWorkflowManifest(name));
  } catch (err) {
    return {
      ok: false,
      path: name,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings: [],
    };
  }
}

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "20", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 20;
}

function limited<T>(items: T[], limit: number): { visible: T[] } {
  return { visible: items.slice(0, limit) };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function printListFooter(total: number, visible: number, hint: string): void {
  if (total > visible) console.log(chalk.gray(`Showing ${visible}/${total}. ${hint}`));
}
