import type { Command } from "commander";
import chalk from "chalk";
import { handleError, output } from "../helpers.js";
import type {
  NativeDiagnosticMetadata,
  NativeStorageStatus,
  NativeStorageSyncPlan,
} from "../../lib/native-storage-status.js";
import type { TodosRunArtifactSyncPlan, TodosRunArtifactSyncResult } from "../../storage/s3-artifact-sync.js";
import { assertTodosStageARemoteAccessFloor } from "../../storage/authority-floor.js";
import { parseOptionalPositiveSafeInteger } from "../helpers.js";
import { getTodosRemoteAuthorityConfigStatus } from "../cloud-router.js";

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function printDiagnosticTruncation(metadata: NativeDiagnosticMetadata): void {
  if (!metadata.truncated) return;
  console.error(chalk.yellow(
    `Diagnostics: truncated (${metadata.truncations.length} reported, ${metadata.omitted_truncations} omitted)`,
  ));
  for (const entry of metadata.truncations) {
    console.error(chalk.yellow(
      `  ${entry.path}: ${entry.kind} ${entry.original} -> ${entry.retained}`,
    ));
  }
}

function printStatus(status: NativeStorageStatus): void {
  console.log(chalk.bold("todos storage"));
  console.log(`Mode: ${status.mode}`);
  console.log(`Remote: ${status.remote_enabled ? "enabled" : "disabled"}`);
  console.log(`Configured remote intent: ${status.remote_configured ? "yes" : "no"}`);
  console.log(`Runtime enabled: ${status.runtime_enabled ? "yes" : "no"}`);
  console.log(`Canonical RDS: ${status.canonical.cluster}/${status.canonical.database}`);
  console.log(`Runtime secret: ${status.canonical.runtimeSecretPath}`);
  console.log(`Database env: ${status.canonical.primaryEnv} (fallback: ${status.canonical.fallbackEnv})`);
  console.log(`Database: ${status.database.configured ? status.database.redacted_url : "not configured"}`);
  console.log(`Object storage: ${status.object_storage.configured ? `${status.object_storage.bucket}/${status.object_storage.prefix}` : "not configured"}`);
  console.log(`Sync batch: ${status.sync.batch_size}`);
  console.log(`Network: not used`);
  for (const issue of status.issues) console.error(chalk.red(`  ${issue}`));
  for (const warning of status.warnings) console.error(chalk.yellow(`  ${warning}`));
  printDiagnosticTruncation(status.diagnostics);
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
  printDiagnosticTruncation(plan.diagnostics);
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
  const limit = parseOptionalPositiveSafeInteger(opts.limit, "--limit");
  return {
    ...(opts.runId ? { runId: opts.runId } : {}),
    ...(opts.taskId ? { taskId: opts.taskId } : {}),
    ...(limit ? { limit } : {}),
    ...(opts.includeAlreadySynced ? { includeAlreadySynced: true } : {}),
  };
}

export function s3CredentialsFromEnv(env: Record<string, string | undefined> = process.env) {
  const { TODOS_STORAGE_ENV, TODOS_STORAGE_FALLBACK_ENV } = require("../../storage/index.js") as typeof import("../../storage/index.js");
  const accessKeyId = (env[TODOS_STORAGE_ENV.s3AccessKeyId] ?? env[TODOS_STORAGE_FALLBACK_ENV.s3AccessKeyId])?.trim();
  const s3Key = (env[TODOS_STORAGE_ENV.s3SecretAccessKey] ?? env[TODOS_STORAGE_FALLBACK_ENV.s3SecretAccessKey])?.trim();
  const s3Session = (env[TODOS_STORAGE_ENV.s3SessionToken] ?? env[TODOS_STORAGE_FALLBACK_ENV.s3SessionToken])?.trim();
  if (!accessKeyId || !s3Key) {
    throw new Error(`${TODOS_STORAGE_ENV.s3AccessKeyId}/${TODOS_STORAGE_FALLBACK_ENV.s3AccessKeyId} and ${TODOS_STORAGE_ENV.s3SecretAccessKey}/${TODOS_STORAGE_FALLBACK_ENV.s3SecretAccessKey} are required for --apply`);
  }
  return {
    accessKeyId,
    secretAccessKey: s3Key,
    ...(s3Session ? { sessionToken: s3Session } : {}),
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
    .description("Inspect local storage and Stage B configured intent; remote runtime stays disabled in Stage A");

  storage
    .command("status")
    .description("Show redacted local status and configured remote intent; remote_enabled remains false in Stage A")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { getNativeStorageStatus } = await import("../../lib/native-storage-status.js");
        const nativeStatus = getNativeStorageStatus();
        const remoteAuthority = getTodosRemoteAuthorityConfigStatus();
        const status = remoteAuthority.selected
          ? {
              ...nativeStatus,
              ok: remoteAuthority.ok,
              mode: "remote" as const,
              local_default: false,
              remote_enabled: true,
              transport: "http-v1" as const,
              remote_authority: remoteAuthority,
              database: {
                configured: false,
                provider: null,
                redacted_url: null,
                ssl: null,
                schema: null,
              },
              object_storage: {
                configured: false,
                provider: null,
                bucket: null,
                prefix: null,
                region: null,
                endpoint_configured: false,
                force_path_style: false,
              },
              issues: remoteAuthority.issues,
              warnings: [],
            }
          : { ...nativeStatus, transport: "sqlite" as const, remote_authority: remoteAuthority };
        if (opts.json || globalOpts.json) {
          output(status, true);
          if (!status.ok) process.exitCode = 1;
          return;
        }
        if (remoteAuthority.selected) {
          console.log(chalk.bold("todos storage"));
          console.log("Mode: remote");
          console.log("Transport: authenticated HTTP /v1");
          console.log(`Authority: ${remoteAuthority.v1_base_url ?? "not configured"}`);
          console.log(`API key: ${remoteAuthority.api_key_configured ? "configured" : "not configured"}`);
          console.log("Local fallback: disabled");
          console.log("Network: not used (configuration diagnostic only)");
          for (const issue of remoteAuthority.issues) console.error(chalk.red(`  ${issue}`));
          if (!status.ok) process.exitCode = 1;
          return;
        }
        printStatus(status);
      } catch (error) {
        handleError(error);
      }
    });

  storage
    .command("sync-plan")
    .description("Show a no-network Stage B-deferred sync design; it never enables or runs remote sync")
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

  storage
    .command("shadow-status")
    .description("Stage B deferred: remote shadow status is unavailable while Stage A authority is disabled")
    .option("-j, --json", "Output as JSON")
    .action((_opts: { json?: boolean }) => {
      try {
        assertTodosStageARemoteAccessFloor();
      } catch (error) {
        handleError(error);
      }
    });

  storage
    .command("shadow-drain")
    .description("Stage B deferred: remote shadow drain is unavailable while Stage A authority is disabled")
    .option("-j, --json", "Output as JSON")
    .option("--timeout <ms>", "Max drain time in milliseconds", "30000")
    .action((_opts: { json?: boolean; timeout?: string }) => {
      try {
        assertTodosStageARemoteAccessFloor();
      } catch (error) {
        handleError(error);
      }
    });

  const artifacts = storage
    .command("artifacts")
    .description("Stage B-deferred S3 artifact design; apply is denied in Stage A");

  artifacts
    .command("upload")
    .description("Preview Stage B-deferred uploads locally; --apply is denied in Stage A")
    .option("--run-id <id>", "Limit to one run id")
    .option("--task-id <id>", "Limit to one task id")
    .option("--limit <n>", "Maximum artifacts to scan")
    .option("--include-already-synced", "Include artifacts that already have a remote reference")
    .option("--apply", "Perform S3 uploads. Defaults to dry-run.")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { runId?: string; taskId?: string; limit?: string; includeAlreadySynced?: boolean; apply?: boolean; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        if (opts.apply) {
          assertTodosStageARemoteAccessFloor();
        }
        const { planRunArtifactsS3Sync, uploadRunArtifactsToS3 } = await import("../../storage/s3-artifact-sync.js");
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
    .description("Preview Stage B-deferred downloads locally; --apply is denied in Stage A")
    .option("--run-id <id>", "Limit to one run id")
    .option("--task-id <id>", "Limit to one task id")
    .option("--limit <n>", "Maximum artifacts to scan")
    .option("--force", "Download even when local stored content already verifies")
    .option("--apply", "Perform S3 downloads. Defaults to dry-run.")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { runId?: string; taskId?: string; limit?: string; force?: boolean; apply?: boolean; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        if (opts.apply) {
          assertTodosStageARemoteAccessFloor();
        }
        const { downloadRunArtifactsFromS3, planRunArtifactsS3Sync } = await import("../../storage/s3-artifact-sync.js");
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
