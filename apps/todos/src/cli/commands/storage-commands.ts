import type { Command } from "commander";
import chalk from "chalk";
import { handleError, output } from "../helpers.js";
import type { NativeStorageStatus, NativeStorageSyncPlan } from "../../lib/native-storage-status.js";
import type { TodosRunArtifactSyncPlan, TodosRunArtifactSyncResult } from "../../storage/index.js";

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function printStatus(status: NativeStorageStatus): void {
  console.log(chalk.bold("todos storage"));
  console.log(`Mode: ${status.mode}`);
  console.log(`Remote: ${status.remote_enabled ? "enabled" : "disabled"}`);
  console.log(`Canonical RDS: ${status.canonical.cluster}/${status.canonical.database}`);
  console.log(`Runtime secret: ${status.canonical.runtimeSecretPath}`);
  console.log(`Database env: ${status.canonical.primaryEnv} (fallback: ${status.canonical.fallbackEnv})`);
  console.log(`Database: ${status.database.configured ? status.database.redacted_url : "not configured"}`);
  console.log(`Object storage: ${status.object_storage.configured ? `${status.object_storage.bucket}/${status.object_storage.prefix}` : "not configured"}`);
  console.log(`Sync batch: ${status.sync.batch_size}`);
  console.log(`Network: not used`);
  for (const issue of status.issues) console.error(chalk.red(`  ${issue}`));
  for (const warning of status.warnings) console.error(chalk.yellow(`  ${warning}`));
}

function printSyncPlan(plan: NativeStorageSyncPlan): void {
  console.log(chalk.bold("todos storage sync-plan"));
  console.log(`Mode: ${plan.status.mode}`);
  console.log(`Dry run: yes`);
  console.log(`Database: ${plan.postgres.configured ? "configured" : "not configured"}`);
  console.log(`Object storage: ${plan.object_storage.configured ? `${plan.object_storage.bucket}/${plan.object_storage.prefix}` : "not configured"}`);
  console.log("Steps:");
  for (const step of plan.steps) console.log(`  - ${step}`);
  if (plan.postgres.schema_sql.length > 0) {
    console.log("Postgres schema:");
    for (const statement of plan.postgres.schema_sql) console.log(statement);
  }
  for (const issue of plan.status.issues) console.error(chalk.red(`  ${issue}`));
  for (const warning of plan.status.warnings) console.error(chalk.yellow(`  ${warning}`));
}

function printArtifactPlan(plan: TodosRunArtifactSyncPlan): void {
  console.log(chalk.bold(`todos storage artifacts ${plan.direction}`));
  console.log("Dry run: yes");
  console.log("Network: not used");
  console.log(`Total: ${plan.total}`);
  console.log(`Uploadable: ${plan.uploadable}`);
  console.log(`Downloadable: ${plan.downloadable}`);
  console.log(`Skipped: ${plan.skipped}`);
  for (const artifact of plan.artifacts.slice(0, 20)) {
    console.log(`  ${artifact.status.padEnd(18)} ${artifact.id.slice(0, 8)} ${artifact.sha256?.slice(0, 12) ?? "no-sha"}`);
  }
  for (const error of plan.errors) console.error(chalk.red(`  ${error}`));
}

function printArtifactResult(direction: "upload" | "download", result: TodosRunArtifactSyncResult): void {
  console.log(chalk.bold(`todos storage artifacts ${direction}`));
  console.log(`Uploaded: ${result.uploaded}`);
  console.log(`Downloaded: ${result.downloaded}`);
  console.log(`Skipped: ${result.skipped}`);
  for (const artifact of result.artifacts.slice(0, 20)) {
    console.log(`  ${artifact.id.slice(0, 8)} ${artifact.key}`);
  }
  for (const error of result.errors) console.error(chalk.red(`  ${error}`));
}

function artifactFilter(opts: { runId?: string; taskId?: string; limit?: string; includeAlreadySynced?: boolean }) {
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined;
  if (opts.limit && (!Number.isSafeInteger(limit) || limit! <= 0)) throw new Error("--limit must be a positive integer");
  return {
    ...(opts.runId ? { runId: opts.runId } : {}),
    ...(opts.taskId ? { taskId: opts.taskId } : {}),
    ...(limit ? { limit } : {}),
    ...(opts.includeAlreadySynced ? { includeAlreadySynced: true } : {}),
  };
}

function s3CredentialsFromEnv() {
  const { TODOS_STORAGE_ENV } = require("../../storage/index.js") as typeof import("../../storage/index.js");
  const accessKeyId = process.env[TODOS_STORAGE_ENV.s3AccessKeyId]?.trim();
  const secretAccessKey = process.env[TODOS_STORAGE_ENV.s3SecretAccessKey]?.trim();
  const sessionToken = process.env[TODOS_STORAGE_ENV.s3SessionToken]?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`${TODOS_STORAGE_ENV.s3AccessKeyId} and ${TODOS_STORAGE_ENV.s3SecretAccessKey} are required for --apply`);
  }
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

async function s3StoreFromEnv() {
  const { createTodosS3ArtifactStore, loadTodosStorageConfig, TODOS_STORAGE_ENV } = await import("../../storage/index.js");
  const config = loadTodosStorageConfig();
  if (!config.objectStorage) throw new Error(`${TODOS_STORAGE_ENV.s3Bucket} is required for S3 artifact sync`);
  return createTodosS3ArtifactStore({
    config: config.objectStorage,
    credentials: s3CredentialsFromEnv(),
  });
}

export function registerStorageCommands(program: Command) {
  const storage = program
    .command("storage")
    .description("Inspect explicit native local and remote storage configuration");

  storage
    .command("status")
    .description("Show redacted native storage configuration without opening network connections")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { getNativeStorageStatus } = await import("../../lib/native-storage-status.js");
        const status = getNativeStorageStatus();
        if (opts.json || globalOpts.json) {
          output(status, true);
          return;
        }
        printStatus(status);
      } catch (error) {
        handleError(error);
      }
    });

  storage
    .command("sync-plan")
    .description("Preview native storage sync work without opening network connections")
    .option("--schema-sql", "Include Postgres schema SQL in the dry-run output")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { schemaSql?: boolean; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { getNativeStorageSyncPlan } = await import("../../lib/native-storage-status.js");
        const plan = getNativeStorageSyncPlan(process.env, {
          includeSchemaSql: Boolean(opts.schemaSql),
        });
        if (opts.json || globalOpts.json) {
          output(plan, true);
          return;
        }
        printSyncPlan(plan);
      } catch (error) {
        handleError(error);
      }
    });

  const artifacts = storage
    .command("artifacts")
    .description("Preview or apply native S3 sync for locally stored run artifacts");

  artifacts
    .command("upload")
    .description("Upload locally stored run artifact bytes to configured S3. Dry-run by default.")
    .option("--run-id <id>", "Limit to one run id")
    .option("--task-id <id>", "Limit to one task id")
    .option("--limit <n>", "Maximum artifacts to scan")
    .option("--include-already-synced", "Include artifacts that already have a remote reference")
    .option("--apply", "Perform S3 uploads. Defaults to dry-run.")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { runId?: string; taskId?: string; limit?: string; includeAlreadySynced?: boolean; apply?: boolean; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { planRunArtifactsS3Sync, uploadRunArtifactsToS3 } = await import("../../storage/index.js");
        const filter = artifactFilter(opts);
        if (!opts.apply) {
          const plan = planRunArtifactsS3Sync({ direction: "upload", filter });
          if (opts.json || globalOpts.json) { output(plan, true); return; }
          printArtifactPlan(plan);
          return;
        }
        const result = await uploadRunArtifactsToS3({ store: await s3StoreFromEnv(), filter });
        if (opts.json || globalOpts.json) { output(result, true); return; }
        printArtifactResult("upload", result);
      } catch (error) {
        handleError(error);
      }
    });

  artifacts
    .command("download")
    .description("Restore locally stored run artifact bytes from configured S3. Dry-run by default.")
    .option("--run-id <id>", "Limit to one run id")
    .option("--task-id <id>", "Limit to one task id")
    .option("--limit <n>", "Maximum artifacts to scan")
    .option("--force", "Download even when local stored content already verifies")
    .option("--apply", "Perform S3 downloads. Defaults to dry-run.")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { runId?: string; taskId?: string; limit?: string; force?: boolean; apply?: boolean; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { downloadRunArtifactsFromS3, planRunArtifactsS3Sync } = await import("../../storage/index.js");
        const filter = artifactFilter(opts);
        if (!opts.apply) {
          const plan = planRunArtifactsS3Sync({ direction: "download", filter, force: Boolean(opts.force) });
          if (opts.json || globalOpts.json) { output(plan, true); return; }
          printArtifactPlan(plan);
          return;
        }
        const result = await downloadRunArtifactsFromS3({ store: await s3StoreFromEnv(), filter, force: Boolean(opts.force) });
        if (opts.json || globalOpts.json) { output(result, true); return; }
        printArtifactResult("download", result);
      } catch (error) {
        handleError(error);
      }
    });
}
