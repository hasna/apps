import type { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { getDatabase } from "../../db/database.js";
import {
  createSqliteTodosTaskSubtreeTransferAuthority,
  type TodosTaskSubtreeTransferAuthority,
} from "../../task-subtree-transfer/index.js";
import {
  cloudApplyTaskSubtreeTransfer,
  cloudInspectTaskSubtreeTransfer,
  cloudReadExactTaskSubtreeTransfer,
  cloudRollbackTaskSubtreeTransfer,
  cloudTaskSubtreeTransferCapability,
  getTodosCloudClient,
} from "../cloud-router.js";
import { handleError, output } from "../helpers.js";

function globalOptions(program: Command): Record<string, unknown> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, unknown> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function jsonRequested(program: Command, opts: { json?: boolean }): boolean {
  return opts.json === true || globalOptions(program)["json"] === true;
}

function parseJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `task-subtree-transfer input must be a readable JSON file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function localAuthority(tenantId?: string): TodosTaskSubtreeTransferAuthority {
  return createSqliteTodosTaskSubtreeTransferAuthority({
    database: getDatabase(),
    ...(tenantId ? { tenantId } : {}),
  });
}

export function registerTaskSubtreeTransferCommands(program: Command): void {
  const transfer = program
    .command("task-subtree-transfer")
    .description("Inspect and atomically transfer an existing task subtree between Projects");

  transfer
    .command("capability")
    .description("Show the task-subtree-transfer authority capability")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (opts: { json?: boolean; tenantId?: string }) => {
      try {
        const remote = getTodosCloudClient();
        const capability = remote
          ? await cloudTaskSubtreeTransferCapability(remote)
          : await localAuthority(opts.tenantId).capability();
        if (jsonRequested(program, opts)) output({ capability }, true);
        else console.log(`${chalk.bold(capability.route)} tenant=${capability.tenant_id} backend=${capability.backend}`);
      } catch (error) {
        handleError(error);
      }
    });

  transfer
    .command("inspect")
    .requiredOption("--file <path>", "Transfer inspection JSON file")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (opts: { file: string; json?: boolean; tenantId?: string }) => {
      try {
        const input = parseJsonFile(opts.file);
        const remote = getTodosCloudClient();
        const inspection = remote
          ? await cloudInspectTaskSubtreeTransfer(remote, input)
          : await localAuthority(opts.tenantId).inspect(input);
        if (jsonRequested(program, opts)) output({ inspection }, true);
        else console.log(`root=${inspection.root_task_id} tasks=${inspection.expected_tasks.length} complete=${inspection.complete}`);
      } catch (error) {
        handleError(error);
      }
    });

  transfer
    .command("apply")
    .requiredOption("--file <path>", "Transfer apply JSON file")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (opts: { file: string; json?: boolean; tenantId?: string }) => {
      try {
        const input = parseJsonFile(opts.file);
        const remote = getTodosCloudClient();
        const result = remote
          ? await cloudApplyTaskSubtreeTransfer(remote, input)
          : await localAuthority(opts.tenantId).apply(input);
        if (jsonRequested(program, opts)) output({ result }, true);
        else console.log(`${result.duplicate ? "duplicate" : "applied"} receipt=${result.receipt.receipt_id} tasks=${result.moved_task_ids.length}`);
      } catch (error) {
        handleError(error);
      }
    });

  transfer
    .command("read-exact <receipt-id>")
    .description("Read one immutable transfer receipt")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (receiptId: string, opts: { json?: boolean; tenantId?: string }) => {
      try {
        const remote = getTodosCloudClient();
        const result = remote
          ? await cloudReadExactTaskSubtreeTransfer(remote, receiptId)
          : await localAuthority(opts.tenantId).readExact(receiptId);
        if (jsonRequested(program, opts)) output({ result }, true);
        else console.log(`receipt=${result.receipt.receipt_id} kind=${result.receipt.kind} duplicate=${String(result.duplicate)}`);
      } catch (error) {
        handleError(error);
      }
    });

  transfer
    .command("rollback")
    .requiredOption("--file <path>", "Transfer rollback JSON file")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (opts: { file: string; json?: boolean; tenantId?: string }) => {
      try {
        const input = parseJsonFile(opts.file);
        const remote = getTodosCloudClient();
        const result = remote
          ? await cloudRollbackTaskSubtreeTransfer(remote, input)
          : await localAuthority(opts.tenantId).rollback(input);
        if (jsonRequested(program, opts)) output({ result }, true);
        else console.log(`${result.duplicate ? "duplicate" : "rolled back"} receipt=${result.receipt.receipt_id}`);
      } catch (error) {
        handleError(error);
      }
    });
}
