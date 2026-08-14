import type { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { getDatabase } from "../../db/database.js";
import {
  TODOS_TASK_MANIFEST_ROUTE,
  TODOS_TASK_MANIFEST_SCHEMA_VERSION,
  createSqliteTodosTaskManifestAuthority,
  type TodosTaskManifestAuthority,
} from "../../task-manifest/index.js";
import {
  cloudApplyTaskManifest,
  cloudCompensateTaskManifest,
  cloudLookupTaskManifestBinding,
  cloudMarkTaskManifestOutboxDelivered,
  cloudReadExactTaskManifest,
  cloudTaskManifestCapability,
  getTodosCloudClient,
} from "../cloud-router.js";
import { handleError, output } from "../helpers.js";

type CloudClient = NonNullable<ReturnType<typeof getTodosCloudClient>>;

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
      `task-manifest input must be a readable JSON file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseInteger(value: string | undefined, label: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${label} must be an integer >= ${min}`);
  }
  return parsed;
}

async function localAuthority(tenantId?: string): Promise<TodosTaskManifestAuthority> {
  return createSqliteTodosTaskManifestAuthority({
    database: getDatabase(),
    ...(tenantId ? { tenantId } : {}),
  });
}

async function currentTenantId(
  remote: CloudClient | null,
  authority: TodosTaskManifestAuthority | null,
  explicit: string | undefined,
): Promise<string> {
  if (explicit) return explicit;
  const capability = remote
    ? await cloudTaskManifestCapability(remote)
    : await authority!.capability();
  return capability.tenant_id;
}

export function registerTaskManifestCommands(program: Command): void {
  const taskManifest = program
    .command("task-manifest")
    .description("Apply and inspect package-owned task-manifest safe mutations");

  taskManifest
    .command("capability")
    .description("Show the current task-manifest authority capability")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (opts: { json?: boolean; tenantId?: string }) => {
      try {
        const remote = getTodosCloudClient();
        const result = remote
          ? await cloudTaskManifestCapability(remote)
          : await (await localAuthority(opts.tenantId)).capability();
        if (jsonRequested(program, opts)) {
          output({ capability: result }, true);
          return;
        }
        console.log(`${chalk.bold(result.route)} tenant=${result.tenant_id} backend=${result.backend}`);
      } catch (error) {
        handleError(error);
      }
    });

  taskManifest
    .command("apply")
    .description("Apply a task-manifest JSON file exactly once by operation/idempotency key")
    .requiredOption("--file <path>", "Task manifest JSON file")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (opts: { file: string; json?: boolean; tenantId?: string }) => {
      try {
        const manifest = parseJsonFile(opts.file);
        const remote = getTodosCloudClient();
        const result = remote
          ? await cloudApplyTaskManifest(remote, manifest)
          : await (await localAuthority(opts.tenantId)).apply(manifest);
        if (jsonRequested(program, opts)) {
          output({ result }, true);
          return;
        }
        console.log(`${result.duplicate ? "duplicate" : "applied"} receipt=${result.receipt.receipt_id}`);
        console.log(`plan=${result.graph.plan_id} tasks=${Object.keys(result.graph.task_ids).length}`);
      } catch (error) {
        handleError(error);
      }
    });

  taskManifest
    .command("read-exact <receipt-id>")
    .description("Read one immutable task-manifest apply receipt by full receipt id")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (receiptId: string, opts: { json?: boolean; tenantId?: string }) => {
      try {
        const remote = getTodosCloudClient();
        const result = remote
          ? await cloudReadExactTaskManifest(remote, receiptId)
          : await (await localAuthority(opts.tenantId)).readExact(receiptId);
        if (jsonRequested(program, opts)) {
          output({ result }, true);
          return;
        }
        console.log(`receipt=${result.receipt.receipt_id} duplicate=${String(result.duplicate)}`);
        console.log(`readback=${JSON.stringify(result.readback)}`);
      } catch (error) {
        handleError(error);
      }
    });

  taskManifest
    .command("lookup")
    .description("Recover one exact managed apply receipt from a full plan id")
    .requiredOption("--plan-id <uuid>", "Full managed plan UUID")
    .option("--tenant-id <id>", "Authority tenant id; defaults to capability tenant")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { planId: string; tenantId?: string; json?: boolean }) => {
      try {
        const remote = getTodosCloudClient();
        const authority = remote ? null : await localAuthority(opts.tenantId);
        const tenantId = await currentTenantId(remote, authority, opts.tenantId);
        const request = {
          authority: "todos" as const,
          route: TODOS_TASK_MANIFEST_ROUTE,
          schema_version: TODOS_TASK_MANIFEST_SCHEMA_VERSION,
          tenant_id: tenantId,
          plan_id: opts.planId,
          max_items: 1 as const,
        };
        const result = remote
          ? await cloudLookupTaskManifestBinding(remote, request)
          : await authority!.lookupBinding(request);
        if (jsonRequested(program, opts)) {
          output({ result }, true);
          return;
        }
        console.log(`plan=${result.plan_id} receipt=${result.apply_receipt_id} state=${result.state}`);
      } catch (error) {
        handleError(error);
      }
    });

  taskManifest
    .command("compensate")
    .description("Compensate an untouched task-manifest graph with CAS protection")
    .requiredOption("--receipt-id <uuid>", "Full apply receipt UUID")
    .requiredOption("--operation-id <id>", "Apply operation id")
    .requiredOption("--step-id <id>", "Distinct compensation step id")
    .requiredOption("--idempotency-key <key>", "Stable compensation idempotency key")
    .requiredOption("--precondition-digest <sha256>", "Exact compensation precondition digest")
    .requiredOption("--if-binding-version <n>", "Expected current binding version")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (opts: {
      receiptId: string;
      operationId: string;
      stepId: string;
      idempotencyKey: string;
      preconditionDigest: string;
      ifBindingVersion: string;
      json?: boolean;
      tenantId?: string;
    }) => {
      try {
        const request = {
          receipt_id: opts.receiptId,
          operation_id: opts.operationId,
          step_id: opts.stepId,
          idempotency_key: opts.idempotencyKey,
          precondition_digest: opts.preconditionDigest,
          if_binding_version: parseInteger(opts.ifBindingVersion, "--if-binding-version", 1),
        };
        const remote = getTodosCloudClient();
        const result = remote
          ? await cloudCompensateTaskManifest(remote, request)
          : await (await localAuthority(opts.tenantId)).compensate(request);
        if (jsonRequested(program, opts)) {
          output({ result }, true);
          return;
        }
        console.log(`${result.duplicate ? "duplicate" : "compensated"} receipt=${result.receipt.receipt_id}`);
        console.log(`absent=${String(result.absent)} readback=${JSON.stringify(result.readback)}`);
      } catch (error) {
        handleError(error);
      }
    });

  taskManifest
    .command("outbox-delivered <outbox-id>")
    .description("Mark one task-manifest outbox effect delivered")
    .option("-j, --json", "Output as JSON")
    .option("--tenant-id <id>", "Tenant id for local SQLite authority")
    .action(async (outboxId: string, opts: { json?: boolean; tenantId?: string }) => {
      try {
        const remote = getTodosCloudClient();
        if (remote) await cloudMarkTaskManifestOutboxDelivered(remote, outboxId);
        else await (await localAuthority(opts.tenantId)).markOutboxDelivered(outboxId);
        if (jsonRequested(program, opts)) {
          output({ delivered: true }, true);
          return;
        }
        console.log(`delivered=${outboxId}`);
      } catch (error) {
        handleError(error);
      }
    });
}
