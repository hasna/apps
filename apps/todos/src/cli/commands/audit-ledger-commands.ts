import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { resolveTaskRunId } from "../../db/task-runs.js";
import { handleError, output } from "../helpers.js";

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function resolveOptional(table: string, value?: string): string | undefined {
  if (!value) return undefined;
  if (table === "task_runs") return resolveTaskRunId(value, getDatabase());
  const resolved = resolvePartialId(getDatabase(), table, value);
  if (!resolved) throw new Error(`Could not resolve ${table} ID: ${value}`);
  return resolved;
}

export function registerAuditLedgerCommands(program: Command) {
  const audit = program
    .command("audit-ledger")
    .description("Create and verify tamper-evident local audit ledger checkpoints");

  audit
    .command("show")
    .description("Build a local audit hash chain from current evidence")
    .option("--project <id>", "Project ID")
    .option("--task <id>", "Task ID")
    .option("--run <id>", "Run ID")
    .option("--entries", "Include per-entry hashes and redacted payloads")
    .option("--format <format>", "json or markdown", "json")
    .action(async (opts: { project?: string; task?: string; run?: string; entries?: boolean; format?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { getLocalAuditLedger, renderLocalAuditLedgerMarkdown } = await import("../../lib/audit-ledger.js");
        const ledger = getLocalAuditLedger({
          project_id: resolveOptional("projects", opts.project || globalOpts.project),
          task_id: resolveOptional("tasks", opts.task),
          run_id: resolveOptional("task_runs", opts.run),
          include_entries: Boolean(opts.entries),
        });
        if (opts.format === "markdown") { console.log(renderLocalAuditLedgerMarkdown(ledger)); return; }
        if (globalOpts.json || opts.format === "json") { output(ledger, true); return; }
        console.log(`Audit root ${ledger.root_hash} (${ledger.entry_count} entries)`);
      } catch (e) {
        handleError(e);
      }
    });

  audit
    .command("seal <name>")
    .description("Store a local audit ledger checkpoint for later verification")
    .option("--project <id>", "Project ID")
    .option("--task <id>", "Task ID")
    .option("--run <id>", "Run ID")
    .option("--note <text>", "Checkpoint note")
    .action(async (name: string, opts: { project?: string; task?: string; run?: string; note?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { sealLocalAuditLedger } = await import("../../lib/audit-ledger.js");
        const checkpoint = sealLocalAuditLedger({
          name,
          project_id: resolveOptional("projects", opts.project || globalOpts.project),
          task_id: resolveOptional("tasks", opts.task),
          run_id: resolveOptional("task_runs", opts.run),
          agent_id: globalOpts.agent,
          note: opts.note,
        });
        if (globalOpts.json) { output(checkpoint, true); return; }
        console.log(chalk.green(`Audit checkpoint sealed: ${checkpoint.name} ${checkpoint.root_hash}`));
      } catch (e) {
        handleError(e);
      }
    });

  audit
    .command("list")
    .description("List local audit ledger checkpoints")
    .action(async () => {
      const globalOpts = globalOptions(program);
      try {
        const { listLocalAuditLedgerCheckpoints } = await import("../../lib/audit-ledger.js");
        const checkpoints = listLocalAuditLedgerCheckpoints();
        if (globalOpts.json) { output(checkpoints, true); return; }
        if (checkpoints.length === 0) { console.log(chalk.dim("No audit ledger checkpoints.")); return; }
        for (const checkpoint of checkpoints) {
          console.log(`${checkpoint.name.padEnd(20)} ${checkpoint.entry_count.toString().padStart(4)} ${checkpoint.root_hash}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  audit
    .command("verify <checkpoint>")
    .description("Verify current local evidence against a sealed checkpoint")
    .option("--format <format>", "json or markdown", "json")
    .action(async (checkpoint: string, opts: { format?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { renderLocalAuditLedgerMarkdown, verifyLocalAuditLedger } = await import("../../lib/audit-ledger.js");
        const result = verifyLocalAuditLedger(checkpoint);
        if (opts.format === "markdown") { console.log(renderLocalAuditLedgerMarkdown(result)); return; }
        if (globalOpts.json || opts.format === "json") { output(result, true); return; }
        console.log(result.ok ? chalk.green("Audit ledger verified.") : chalk.red(`Audit ledger failed: ${result.issues.join("; ")}`));
        if (!result.ok) process.exitCode = 1;
      } catch (e) {
        handleError(e);
      }
    });
}
