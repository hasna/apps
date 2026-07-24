import { Command } from "commander";
import chalk from "chalk";
import {
  getLlmConfig, saveLlmConfig, setLlmStrip, maskKey,
  LLMClient, PROVIDER_DEFAULTS, type LLMProvider,
} from "../../lib/llm.js";
import {
  createJob, listJobs, getJobByName, getLatestRun, updateJob, deleteJob, listJobRuns,
} from "../../db/jobs.js";
import { createWorkflow, listWorkflows, getWorkflowByName, deleteWorkflow } from "../../db/workflows.js";
import { triggerJob } from "../../lib/scheduler.js";
import { runWorkflow } from "../../lib/workflow-runner.js";
import { getDatabase } from "../../db/database.js";
import { getConnector } from "../../lib/registry.js";
import {
  DEFAULT_COMPACT_LIMIT,
  maybeTruncateOutput,
  pageItems,
  parseNonNegativeInt,
  truncateText,
} from "../../lib/compact-output.js";

function parsePagingOptions(options: { limit?: string; offset?: string }) {
  const parsedLimit = parseNonNegativeInt(options.limit, "--limit");
  const parsedOffset = parseNonNegativeInt(options.offset, "--offset");
  return {
    limit: parsedLimit.value,
    offset: parsedOffset.value ?? 0,
    error: parsedLimit.error || parsedOffset.error,
  };
}

export function registerCommands(program: Command): void {
  // ── Hot Connectors Commands ───────────────────────────────────────────────────

  program
    .command("hot")
    .description("Show top connectors by usage")
    .option("--limit <n>", "Max results", "10")
    .option("--days <n>", "Time window in days", "7")
    .option("--json", "Output as JSON")
    .action((options) => {
      const { getTopConnectors } = require("../../db/usage.js");
      const { getPromotedConnectors } = require("../../db/promotions.js");
      const top = getTopConnectors(parseInt(options.limit), parseInt(options.days), getDatabase());
      const promoted = new Set(getPromotedConnectors(getDatabase()));

      if (options.json) { console.log(JSON.stringify(top.map((t: { connector: string; count: number }) => ({ ...t, promoted: promoted.has(t.connector) })))); return; }

      if (top.length === 0) { console.log(chalk.dim("No usage data yet. Use connectors to build up stats.")); return; }
      console.log(chalk.bold(`\nTop connectors (last ${options.days} days):\n`));
      console.log(`  ${chalk.dim("#".padEnd(4))}${chalk.dim("Connector".padEnd(22))}${chalk.dim("Usage".padEnd(8))}${chalk.dim("Badges")}`);
      console.log(chalk.dim(`  ${"─".repeat(45)}`));
      for (let i = 0; i < top.length; i++) {
        const t = top[i] as { connector: string; count: number };
        const badges = [
          t.count >= 5 ? chalk.red("[HOT]") : "",
          promoted.has(t.connector) ? chalk.yellow("[PRO]") : "",
        ].filter(Boolean).join(" ");
        console.log(`  ${String(i + 1).padEnd(4)}${chalk.cyan(t.connector.padEnd(22))}${String(t.count).padEnd(8)}${badges}`);
      }
    });

  program
    .command("promote")
    .argument("<connector>", "Connector to promote")
    .description("Mark a connector as promoted (boosted in search)")
    .action((connector) => {
      const meta = getConnector(connector);
      if (!meta) { console.error(chalk.red(`Connector '${connector}' not found`)); process.exit(1); }
      const { promoteConnector } = require("../../db/promotions.js");
      promoteConnector(connector, getDatabase());
      console.log(chalk.green("✓") + ` ${meta.displayName} promoted — will rank higher in search`);
    });

  program
    .command("demote")
    .argument("<connector>", "Connector to demote")
    .description("Remove promotion from a connector")
    .action((connector) => {
      const { demoteConnector } = require("../../db/promotions.js");
      const removed = demoteConnector(connector, getDatabase());
      if (removed) console.log(chalk.green("✓") + ` ${connector} demoted`);
      else console.log(chalk.dim(`${connector} was not promoted`));
    });

  // ── Jobs Commands ─────────────────────────────────────────────────────────────

  const jobsCmd = program.command("jobs").description("Manage scheduled connector jobs");

  jobsCmd
    .command("add")
    .description("Add a scheduled job")
    .requiredOption("--name <name>", "Job name")
    .requiredOption("--connector <connector>", "Connector name")
    .requiredOption("--command <command>", "Command to run")
    .requiredOption("--cron <cron>", "Cron expression (5-field)")
    .option("--args <args>", "Command args (space-separated)")
    .option("--strip", "Apply LLM stripping to output")
    .option("--json", "Output as JSON")
    .action((options) => {
      const db = getDatabase();
      const args = options.args ? options.args.split(" ") : [];
      const job = createJob({ name: options.name, connector: options.connector, command: options.command, args, cron: options.cron, strip: !!options.strip }, db);
      if (options.json) { console.log(JSON.stringify(job)); return; }
      console.log(chalk.green("✓") + ` Job created: ${job.name} (${job.cron})`);
    });

  jobsCmd
    .command("list")
    .description("List all jobs")
    .option("--limit <n>", "Limit rows")
    .option("--offset <n>", "Skip first N rows")
    .option("-v, --verbose", "Show all rows in human output", false)
    .option("--json", "Output as JSON")
    .action((options) => {
      const paging = parsePagingOptions(options);
      if (paging.error) {
        if (options.json) console.log(JSON.stringify({ error: paging.error }));
        else console.log(chalk.red(paging.error));
        process.exit(1);
        return;
      }
      const jobs = listJobs(getDatabase());
      const page = pageItems(jobs, {
        offset: paging.offset,
        limit: paging.limit ?? (options.verbose ? undefined : DEFAULT_COMPACT_LIMIT),
      });
      if (options.json) {
        const data = options.limit || options.offset ? page.items : jobs;
        console.log(JSON.stringify(data));
        return;
      }
      if (jobs.length === 0) { console.log(chalk.dim("No jobs configured.")); return; }
      console.log(chalk.bold(`\nJobs (showing ${page.items.length} of ${jobs.length})\n`));
      for (const j of page.items) {
        const status = j.enabled ? chalk.green("enabled") : chalk.dim("disabled");
        const strip = j.strip ? chalk.cyan(" [strip]") : "";
        console.log(`  ${j.name.padEnd(20)} ${j.connector}.${j.command.padEnd(16)} ${j.cron.padEnd(15)} ${status}${strip}`);
      }
      if (page.nextOffset !== null) console.log(chalk.dim(`\n  More rows: connectors jobs list --offset ${page.nextOffset}`));
      console.log(chalk.dim("  More detail: connectors jobs show <name> | connectors jobs list --verbose | connectors jobs list --json"));
    });

  jobsCmd
    .command("show")
    .alias("inspect")
    .description("Show full details for one job")
    .argument("<name>", "Job name")
    .option("--json", "Output as JSON")
    .action((name, options) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) { console.error(chalk.red(`Job "${name}" not found`)); process.exit(1); }
      const latestRun = getLatestRun(job.id, db);
      if (options.json) { console.log(JSON.stringify({ job, latestRun }, null, 2)); return; }
      console.log(chalk.bold(`\nJob: ${job.name}\n`));
      console.log(`  Connector: ${job.connector}`);
      console.log(`  Command:   ${job.command}${job.args.length ? ` ${job.args.join(" ")}` : ""}`);
      console.log(`  Cron:      ${job.cron}`);
      console.log(`  Enabled:   ${job.enabled ? "yes" : "no"}`);
      console.log(`  Strip:     ${job.strip ? "yes" : "no"}`);
      if (latestRun) {
        console.log(chalk.bold("\nLatest Run"));
        console.log(`  Started: ${latestRun.started_at}`);
        console.log(`  Exit:    ${latestRun.exit_code ?? "?"}`);
        const latestOutput = latestRun.stripped_output ?? latestRun.raw_output;
        if (latestOutput) console.log(`  Output:  ${truncateText(latestOutput, 160)}`);
      }
      console.log(chalk.dim(`\n  More detail: connectors jobs show ${name} --json | connectors jobs logs ${name}`));
    });

  jobsCmd
    .command("run")
    .description("Manually trigger a job")
    .argument("<name>", "Job name")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) { console.error(chalk.red(`Job "${name}" not found`)); process.exit(1); }
      if (!options.json) console.log(chalk.dim(`Running ${job.connector} ${job.command}...`));
      const result = await triggerJob(job, db);
      if (options.json) { console.log(JSON.stringify(result)); return; }
      const icon = result.exit_code === 0 ? chalk.green("✓") : chalk.red("✗");
      console.log(`${icon} Run ${result.run_id} — exit ${result.exit_code}`);
      if (result.output) {
        const output = maybeTruncateOutput(result.output, {
          maxChars: 2000,
          hint: `Run connectors jobs run ${name} --json for structured full output.`,
        });
        console.log(output.text);
      }
    });

  jobsCmd
    .command("logs")
    .description("Show recent runs for a job")
    .argument("<name>", "Job name")
    .option("--limit <n>", "Max results", "10")
    .option("--json", "Output as JSON")
    .action((name, options) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) { console.error(chalk.red(`Job "${name}" not found`)); process.exit(1); }
      const runs = listJobRuns(job.id, parseInt(options.limit), db);
      if (options.json) { console.log(JSON.stringify(runs)); return; }
      if (runs.length === 0) { console.log(chalk.dim("No runs yet.")); return; }
      for (const r of runs) {
        const icon = r.exit_code === 0 ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${icon} ${r.started_at.slice(0, 19)} — exit ${r.exit_code ?? "?"}`);
      }
    });

  jobsCmd
    .command("enable")
    .description("Enable a job")
    .argument("<name>")
    .action((name) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) { console.error(chalk.red(`Job "${name}" not found`)); process.exit(1); }
      updateJob(job.id, { enabled: true }, db);
      console.log(chalk.green("✓") + ` Job "${name}" enabled`);
    });

  jobsCmd
    .command("disable")
    .description("Disable a job")
    .argument("<name>")
    .action((name) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) { console.error(chalk.red(`Job "${name}" not found`)); process.exit(1); }
      updateJob(job.id, { enabled: false }, db);
      console.log(chalk.green("✓") + ` Job "${name}" disabled`);
    });

  jobsCmd
    .command("delete")
    .description("Delete a job")
    .argument("<name>")
    .action((name) => {
      const db = getDatabase();
      const job = getJobByName(name, db);
      if (!job) { console.error(chalk.red(`Job "${name}" not found`)); process.exit(1); }
      deleteJob(job.id, db);
      console.log(chalk.green("✓") + ` Job "${name}" deleted`);
    });

  // ── Workflows Commands ─────────────────────────────────────────────────────────

  const workflowsCmd = program.command("workflows").description("Manage connector workflows (sequential pipelines)");

  workflowsCmd
    .command("add")
    .description("Create a workflow from a JSON steps array")
    .requiredOption("--name <name>", "Workflow name")
    .requiredOption("--steps <json>", 'Steps JSON array, e.g. \'[{"connector":"stripe","command":"products list"}]\'')
    .option("--json", "Output as JSON")
    .action((options) => {
      let steps: unknown;
      try { steps = JSON.parse(options.steps); } catch { console.error(chalk.red("Invalid JSON for --steps")); process.exit(1); }
      const wf = createWorkflow({ name: options.name, steps: steps as Parameters<typeof createWorkflow>[0]["steps"] }, getDatabase());
      if (options.json) { console.log(JSON.stringify(wf)); return; }
      console.log(chalk.green("✓") + ` Workflow "${wf.name}" created (${wf.steps.length} steps)`);
    });

  workflowsCmd
    .command("list")
    .description("List all workflows")
    .option("--limit <n>", "Limit rows")
    .option("--offset <n>", "Skip first N rows")
    .option("-v, --verbose", "Show all rows in human output", false)
    .option("--json", "Output as JSON")
    .action((options) => {
      const paging = parsePagingOptions(options);
      if (paging.error) {
        if (options.json) console.log(JSON.stringify({ error: paging.error }));
        else console.log(chalk.red(paging.error));
        process.exit(1);
        return;
      }
      const wfs = listWorkflows(getDatabase());
      const page = pageItems(wfs, {
        offset: paging.offset,
        limit: paging.limit ?? (options.verbose ? undefined : DEFAULT_COMPACT_LIMIT),
      });
      if (options.json) {
        const data = options.limit || options.offset ? page.items : wfs;
        console.log(JSON.stringify(data));
        return;
      }
      if (wfs.length === 0) { console.log(chalk.dim("No workflows configured.")); return; }
      console.log(chalk.bold(`\nWorkflows (showing ${page.items.length} of ${wfs.length})\n`));
      for (const wf of page.items) {
        const status = wf.enabled ? chalk.green("enabled") : chalk.dim("disabled");
        console.log(`  ${wf.name.padEnd(20)} ${String(wf.steps.length).padStart(2)} steps  ${status}`);
      }
      if (page.nextOffset !== null) console.log(chalk.dim(`\n  More rows: connectors workflows list --offset ${page.nextOffset}`));
      console.log(chalk.dim("  More detail: connectors workflows show <name> | connectors workflows list --verbose | connectors workflows list --json"));
    });

  workflowsCmd
    .command("show")
    .alias("inspect")
    .description("Show full details for one workflow")
    .argument("<name>", "Workflow name")
    .option("--json", "Output as JSON")
    .action((name, options) => {
      const wf = getWorkflowByName(name, getDatabase());
      if (!wf) { console.error(chalk.red(`Workflow "${name}" not found`)); process.exit(1); }
      if (options.json) { console.log(JSON.stringify(wf, null, 2)); return; }
      console.log(chalk.bold(`\nWorkflow: ${wf.name}\n`));
      console.log(`  Enabled: ${wf.enabled ? "yes" : "no"}`);
      console.log(`  Steps:   ${wf.steps.length}`);
      for (const [index, step] of wf.steps.entries()) {
        const args = Array.isArray(step.args) && step.args.length > 0 ? ` ${step.args.join(" ")}` : "";
        console.log(`  ${String(index + 1).padStart(2)}. ${step.connector} ${step.command}${args}`);
      }
      console.log(chalk.dim(`\n  More detail: connectors workflows show ${name} --json`));
    });

  workflowsCmd
    .command("run")
    .description("Run a workflow")
    .argument("<name>", "Workflow name")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      const wf = getWorkflowByName(name, getDatabase());
      if (!wf) { console.error(chalk.red(`Workflow "${name}" not found`)); process.exit(1); }
      if (!options.json) console.log(chalk.dim(`Running workflow "${wf.name}" (${wf.steps.length} steps)...`));
      const result = await runWorkflow(wf);
      if (options.json) { console.log(JSON.stringify(result)); return; }
      for (const step of result.steps) {
        const icon = step.exit_code === 0 ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${icon} Step ${step.step}: ${step.connector} ${step.command}`);
      }
      console.log(result.success ? chalk.green("\nWorkflow completed") : chalk.red("\nWorkflow failed"));
    });

  workflowsCmd
    .command("delete")
    .description("Delete a workflow")
    .argument("<name>")
    .action((name) => {
      const wf = getWorkflowByName(name, getDatabase());
      if (!wf) { console.error(chalk.red(`Workflow "${name}" not found`)); process.exit(1); }
      deleteWorkflow(wf.id, getDatabase());
      console.log(chalk.green("✓") + ` Workflow "${name}" deleted`);
    });

  // ── LLM Commands ──────────────────────────────────────────────────────────────

  const llmCmd = program.command("llm").description("Manage LLM provider for output stripping");

  llmCmd
    .command("set")
    .description("Configure LLM provider and API key")
    .requiredOption("--provider <provider>", "Provider: cerebras, groq, openai, anthropic")
    .requiredOption("--key <key>", "API key")
    .option("--model <model>", "Model name (defaults to provider default)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const provider = options.provider as LLMProvider;
      const validProviders: LLMProvider[] = ["cerebras", "groq", "openai", "anthropic"];
      if (!validProviders.includes(provider)) {
        console.error(chalk.red(`Unknown provider "${provider}". Valid: ${validProviders.join(", ")}`));
        process.exit(1);
      }
      const model = options.model || PROVIDER_DEFAULTS[provider].model;
      const existing = getLlmConfig();
      saveLlmConfig({ provider, model, api_key: options.key, strip: existing?.strip ?? false });
      if (options.json) {
        console.log(JSON.stringify({ provider, model, key: maskKey(options.key), strip: existing?.strip ?? false }));
      } else {
        console.log(chalk.green("✓") + ` LLM configured: ${provider} / ${model}`);
        console.log(`  Key: ${maskKey(options.key)}`);
        console.log(`  Strip: ${existing?.strip ? chalk.green("enabled") : chalk.dim("disabled")} (run 'connectors llm strip enable' to turn on)`);
      }
    });

  llmCmd
    .command("status")
    .description("Show current LLM configuration")
    .option("--json", "Output as JSON")
    .action((options) => {
      const config = getLlmConfig();
      if (!config) {
        if (options.json) console.log(JSON.stringify({ configured: false }));
        else console.log(chalk.dim("No LLM configured. Run: connectors llm set --provider <provider> --key <key>"));
        return;
      }
      if (options.json) {
        console.log(JSON.stringify({ configured: true, provider: config.provider, model: config.model, key: maskKey(config.api_key), strip: config.strip }));
      } else {
        console.log(chalk.bold("LLM Configuration"));
        console.log(`  Provider : ${config.provider}`);
        console.log(`  Model    : ${config.model}`);
        console.log(`  Key      : ${maskKey(config.api_key)}`);
        console.log(`  Strip    : ${config.strip ? chalk.green("enabled") : chalk.red("disabled")}`);
      }
    });

  llmCmd
    .command("strip")
    .description("Enable or disable global output stripping")
    .argument("<action>", "enable or disable")
    .action((action: string) => {
      if (action !== "enable" && action !== "disable") {
        console.error(chalk.red('Action must be "enable" or "disable"'));
        process.exit(1);
      }
      try {
        setLlmStrip(action === "enable");
        console.log(chalk.green("✓") + ` Output stripping ${action}d`);
      } catch (e) {
        console.error(chalk.red(String(e instanceof Error ? e.message : e)));
        process.exit(1);
      }
    });

  llmCmd
    .command("test")
    .description("Test current LLM configuration with a sample prompt")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = getLlmConfig();
      if (!config) {
        console.error(chalk.red("No LLM configured. Run: connectors llm set --provider <provider> --key <key>"));
        process.exit(1);
      }
      if (!options.json) console.log(chalk.dim(`Testing ${config.provider} / ${config.model}...`));
      try {
        const client = new LLMClient(config);
        const result = await client.complete(
          "You are a helpful assistant. Respond with exactly: {\"status\":\"ok\"}",
          "ping"
        );
        if (options.json) {
          console.log(JSON.stringify({ success: true, provider: result.provider, model: result.model, latency_ms: result.latency_ms, response: result.content }));
        } else {
          console.log(chalk.green("✓") + ` Response received in ${result.latency_ms}ms`);
          console.log(`  ${result.content.trim()}`);
        }
      } catch (e) {
        if (options.json) console.log(JSON.stringify({ success: false, error: String(e instanceof Error ? e.message : e) }));
        else console.error(chalk.red("✗ " + String(e instanceof Error ? e.message : e)));
        process.exit(1);
      }
    });

  llmCmd
    .command("providers")
    .description("List supported LLM providers")
    .option("--json", "Output as JSON")
    .action((options) => {
      const providers = [
        { name: "cerebras", baseUrl: "https://api.cerebras.ai/v1", defaultModel: PROVIDER_DEFAULTS.cerebras.model, compatible: "OpenAI" },
        { name: "groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: PROVIDER_DEFAULTS.groq.model, compatible: "OpenAI" },
        { name: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: PROVIDER_DEFAULTS.openai.model, compatible: "OpenAI" },
        { name: "anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: PROVIDER_DEFAULTS.anthropic.model, compatible: "Anthropic" },
      ];
      if (options.json) { console.log(JSON.stringify(providers)); return; }
      console.log(chalk.bold("Supported LLM Providers"));
      for (const p of providers) {
        console.log(`  ${chalk.cyan(p.name.padEnd(12))} ${p.defaultModel.padEnd(30)} ${chalk.dim(p.baseUrl)}`);
      }
    });
}
