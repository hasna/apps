import type { Command } from "commander";
import chalk from "chalk";
import { handleError, output } from "../helpers.js";
import type { NativeStorageStatus, NativeStorageSyncPlan } from "../../lib/native-storage-status.js";
import type { ShadowStatusReport } from "../../lib/shadow-status.js";
import type { TodosRunArtifactSyncPlan, TodosRunArtifactSyncResult } from "../../storage/index.js";
import { getTodosRemoteAuthorityConfigStatus } from "../cloud-router.js";

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

function printShadowStatus(report: ShadowStatusReport, enabled: boolean, shadowEnv: string): void {
  console.log(chalk.bold("todos storage shadow-status"));
  console.log(`Shadow mirror: ${enabled ? "enabled" : "disabled"} (${shadowEnv})`);
  console.log(`Service: ${report.service}`);
  console.log(`Cloud reachable: ${report.cloud_reachable ? "yes" : "no"}`);
  if (report.error) {
    console.error(chalk.red(`  ${report.error}`));
    return;
  }
  console.log(`In sync: ${report.in_sync ? "yes" : "no"}`);
  console.log(`Last mirror: ${report.last_mirror_at ?? "never"}`);
  console.log(
    `Last mirror lag: ${report.last_mirror_lag_ms === null ? "n/a" : `${report.last_mirror_lag_ms}ms`}`,
  );
  console.log("Rows (local -> cloud):");
  for (const entry of report.objects) {
    const flag = entry.diff === 0 ? "" : chalk.yellow(`  (diff ${entry.diff > 0 ? "+" : ""}${entry.diff})`);
    console.log(
      `  ${entry.object_type.padEnd(14)} local=${String(entry.local).padStart(6)} cloud=${String(entry.cloud).padStart(6)} tombstones=${entry.cloud_tombstones}${flag}`,
    );
  }
  console.log(
    `  ${"TOTAL".padEnd(14)} local=${String(report.totals.local).padStart(6)} cloud=${String(report.totals.cloud).padStart(6)} diff=${report.totals.diff}`,
  );
}

interface OutboxDepth { pending: number; failed: number; depth: number }

function readOutboxDepth(): OutboxDepth {
  try {
    const { getDatabase } = require("../../db/database.js") as typeof import("../../db/database.js");
    const db = getDatabase();
    const has = db
      .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='shadow_outbox'`)
      .get();
    if (!has) return { pending: 0, failed: 0, depth: 0 };
    const pending = (db.query<{ n: number }, []>(`SELECT count(*) AS n FROM shadow_outbox WHERE status='pending'`).get()?.n) ?? 0;
    const failed = (db.query<{ n: number }, []>(`SELECT count(*) AS n FROM shadow_outbox WHERE status='failed'`).get()?.n) ?? 0;
    return { pending, failed, depth: pending + failed };
  } catch {
    return { pending: 0, failed: 0, depth: 0 };
  }
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
    .description("Inspect explicit native local and remote storage configuration");

  storage
    .command("status")
    .description("Show redacted native storage configuration without opening network connections")
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

  storage
    .command("shadow-status")
    .description("Report dual-write shadow divergence: local vs cloud row counts and last mirror lag (opens a read-only DB connection)")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      let cloud: { close: () => Promise<void> } | null = null;
      try {
        const globalOpts = globalOptions(program);
        const asJson = Boolean(opts.json || globalOpts.json);
        const {
          createTodosCloudQueryClientFromEnv,
          createLocalSqliteTodosStorageAdapter,
          isTodosShadowEnabled,
          getTodosStorageShadowEnvName,
          getTodosStorageDatabaseEnv,
        } = await import("../../storage/index.js");
        const client = createTodosCloudQueryClientFromEnv();
        if (!client) {
          const message = `Shadow mirror not configured: set ${getTodosStorageDatabaseEnv()} to a remote Postgres DSN`;
          if (asJson) { output({ configured: false, message }, true); return; }
          console.log(chalk.yellow(message));
          return;
        }
        cloud = client;
        const { getTodosShadowStatus } = await import("../../lib/shadow-status.js");
        const local = createLocalSqliteTodosStorageAdapter();
        const report = await getTodosShadowStatus({ local, cloud: client });
        const enabled = isTodosShadowEnabled();
        const outbox = readOutboxDepth();
        if (asJson) {
          output({ shadow_enabled: enabled, shadow_env: getTodosStorageShadowEnvName(), outbox, ...report }, true);
          return;
        }
        printShadowStatus(report, enabled, getTodosStorageShadowEnvName());
        console.log(
          `Outbox depth: ${outbox.depth} (pending=${outbox.pending} failed=${outbox.failed})`,
        );
      } catch (error) {
        handleError(error);
      } finally {
        if (cloud) await cloud.close().catch(() => {});
      }
    });

  storage
    .command("shadow-drain")
    .description("Drain the durable dual-write shadow outbox to cloud Postgres (one-way, write-only)")
    .option("-j, --json", "Output as JSON")
    .option("--timeout <ms>", "Max drain time in milliseconds", "30000")
    .action(async (opts: { json?: boolean; timeout?: string }) => {
      try {
        const globalOpts = globalOptions(program);
        const asJson = Boolean(opts.json || globalOpts.json);
        const {
          isTodosShadowEnabled,
          getTodosStorageShadowEnvName,
          getRuntimeShadowOutbox,
          closeRuntimeShadowCloud,
        } = await import("../../storage/index.js");
        if (!isTodosShadowEnabled()) {
          const message = `Shadow disabled: set ${getTodosStorageShadowEnvName()}=1 to enable the dual-write shadow`;
          if (asJson) { output({ shadow_enabled: false, message }, true); return; }
          console.log(chalk.yellow(message));
          return;
        }
        const { getDatabase } = await import("../../db/database.js");
        const timeout = Number.parseInt(opts.timeout ?? "30000", 10);
        const outbox = getRuntimeShadowOutbox(getDatabase());
        const stats = await outbox.flush(Number.isFinite(timeout) ? timeout : 30000);
        await closeRuntimeShadowCloud();
        if (asJson) { output({ shadow_enabled: true, ...stats }, true); return; }
        console.log(chalk.bold("todos storage shadow-drain"));
        console.log(`Mirrored: ${stats.mirrored}`);
        console.log(`Retries: ${stats.retries}`);
        console.log(`Pending: ${stats.pending}`);
        console.log(`Failed (parked): ${stats.failed}`);
        console.log(`Outbox depth: ${stats.depth}`);
        console.log(`Last mirror: ${stats.lastMirrorAt ?? "never"}`);
        if (stats.lastError) console.error(chalk.yellow(`Last error: ${stats.lastError}`));
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
