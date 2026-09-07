#!/usr/bin/env bun
import { Command } from "commander";
import { registerEventsCommands } from "@hasna/events/commander";
import chalk from "chalk";
import { getCurrentMachine } from "../db/machines.js";
import { createSource, listSources, getSource, updateSource } from "../db/sources.js";
import { getFile } from "../db/files.js";
import { getLatestFileVersion } from "../db/file-versions.js";
import {
  getFileSearchIndexStats,
  refreshAllFileSearchDocumentFts,
} from "../db/file-search-documents.js";
import { listPeers, addPeer, removePeer } from "../db/peers.js";
import { getConfigPath, loadConfig, setConfigValue } from "../lib/config.js";
import { registerEvidenceCommands } from "./evidence.js";
import { registerOrganizationCommands } from "./organize.js";
import { indexLocalSource } from "../lib/indexer.js";
import { listGoogleDriveItems, listGoogleDriveProfiles, listGoogleDriveSharedDrives, preflightGoogleDriveSource, syncGoogleDriveSource } from "../lib/google-drive.js";
import { indexS3Source } from "../lib/s3.js";
import { downloadResolvedFileObject, resolveFileObject, resolvedFileObjectSummary } from "../lib/file-object.js";
import { extractTextFromFile } from "../lib/extraction.js";
import { extractTextSnapshotFromFile } from "../lib/extraction-snapshot.js";
import { doctorKnowledgeSources } from "../lib/knowledge-doctor.js";
import { exportKnowledgeSourceManifest, formatKnowledgeSourceManifest } from "../lib/knowledge-manifest.js";
import { resolveKnowledgeSourceRef } from "../lib/knowledge-resolver.js";
import { buildFilesContextPack, buildFilesSearchPack } from "../lib/context-pack.js";
import { openSecureOutput } from "../lib/secure-output.js";
import { buildOpenFilesFileRef, buildOpenFilesFileRevisionRef } from "../lib/source-ref.js";
import { acknowledgeKnowledgeSourceOutbox, pollKnowledgeSourceOutbox } from "../db/knowledge-outbox.js";
import { runDbIntegrityCheck, runOpsStateSnapshot } from "../lib/ops-loop.js";
import { getDbPath } from "../db/database.js";
import { requireId } from "../db/resolve.js";
import { basename, dirname, resolve, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type {
  FilesContextPack,
  FileSearchDocument,
  FileSearchDocumentKind,
  FileSearchDocumentStatus,
  GoogleDriveConfig,
  KnowledgeSourceManifestFormat,
  KnowledgeSourceResolveMode,
  S3Config,
  SearchScope,
} from "../types/index.js";
import { ApiStore, store } from "../store/index.js";
import { announceFilesLocalMode, resolveFilesCloudStorage } from "../lib/cloud-storage.js";

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const _pkg = _require("../../package.json") as { version: string };

const program = new Command();

// SECURITY: this OSS package must never ship a literal internal S3 bucket
// name or AWS profile. `bootstrap-prod-files` requires an operator-supplied
// bucket (via --bucket or HASNA_FILES_S3_BUCKET) and defaults the AWS profile
// to the standard AWS SDK "default" profile — never a Hasna-specific name.
const DEFAULT_PROD_FILES_BUCKET = process.env.HASNA_FILES_S3_BUCKET ?? "";
const DEFAULT_PROD_FILES_REGION = process.env.HASNA_FILES_AWS_REGION ?? "us-east-1";
const DEFAULT_PROD_FILES_PREFIX = "imports/google-drive/live";
const DEFAULT_PROD_FILES_SOURCE_NAME = "prod-files-drive";
const DEFAULT_PROD_FILES_AWS_PROFILE = process.env.HASNA_FILES_AWS_PROFILE ?? "default";

/**
 * Refuse a physical, on-box-only command when the client is bound to the
 * hosted HTTP transport. Indexing, Drive sync, uploads, extraction, local
 * FTS/search indexes, peer sync, the change outbox, and on-disk diagnostics
 * are all machine-local side effects the files service owns; a thin hosted
 * client must never silently read or write the local SQLite island for them.
 * Data-plane reads/writes always route through the Store and work on both
 * transports.
 */
function requireLocalTransport(command: string): void {
  if (store().transport !== "local") {
    console.error(chalk.red(`${command} runs on-box only and is unavailable on the hosted transport; the files service owns ingestion.`));
    process.exit(1);
  }
}

program
  .name("files")
  .description("Agent-first file management — index, sync, search, and retrieve files across local, S3, and Google Drive sources")
  .version(_pkg.version);

registerEvidenceCommands(program);
registerEventsCommands(program, { source: "files" });
registerOrganizationCommands(program);

const ops = program.command("ops").description("Loop-safe operational checks");

ops
  .command("db-integrity")
  .description("Check SQLite DB integrity for local operational state")
  .option("--root <paths...>", "Root directories to scan (default: ~/.hasna and ~/.codewith)")
  .option("--max-dbs <n>", "Maximum DB files to inspect", "200")
  .option("--max-size <size>", "Skip DB files larger than this size", "512mb")
  .option("--timeout <ms>", "Overall wall-clock budget; remaining DBs are skipped once exceeded", "60000")
  .option("--busy-timeout <ms>", "Per-DB SQLite busy_timeout for locked/live DBs", "2000")
  .option("--report <path>", "Write JSON evidence to this path")
  .option("--json", "Output JSON")
  .action((opts: { root?: string[]; maxDbs: string; maxSize: string; timeout: string; busyTimeout: string; report?: string; json?: boolean }) => {
    const result = runDbIntegrityCheck({
      roots: opts.root,
      maxDbs: parseIntFlag(opts.maxDbs, "max-dbs", { min: 1 }),
      maxSizeBytes: parseSize(opts.maxSize),
      timeoutMs: parseIntFlag(opts.timeout, "timeout", { min: 1 }),
      busyTimeoutMs: parseIntFlag(opts.busyTimeout, "busy-timeout", { min: 1 }),
      reportPath: opts.report,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const status = result.summary.failed === 0 ? chalk.green("ok") : chalk.red("failed");
      console.log(`${status} checked=${result.summary.checked} failed=${result.summary.failed} skipped=${result.summary.skipped} truncated=${result.summary.truncated} timed_out=${result.summary.timed_out}`);
      if (result.report_path) console.log(chalk.dim(`report=${result.report_path}`));
      for (const row of result.databases.filter((entry) => entry.status !== "ok").slice(0, 20)) {
        console.log(`${row.status === "failed" ? chalk.red("failed") : chalk.yellow("skipped")} ${row.path} ${chalk.dim(row.detail)}`);
      }
    }
    if (result.summary.failed > 0) process.exitCode = 1;
  });

ops
  .command("snapshot")
  .description("Create bounded snapshots of local operational SQLite DBs")
  .option("--root <paths...>", "Root directories to scan (default: ~/.hasna and ~/.codewith)")
  .option("--snapshot-dir <path>", "Destination directory for snapshot batches")
  .option("--max-dbs <n>", "Maximum DB files to snapshot", "200")
  .option("--max-size <size>", "Skip DB files larger than this size", "512mb")
  .option("--keep-days <n>", "Prune batches older than this many days", "7")
  .option("--keep-batches <n>", "Keep at least this many most recent batches", "20")
  .option("--dry-run", "Plan snapshots without writing files")
  .option("--report <path>", "Write JSON evidence to this path")
  .option("--json", "Output JSON")
  .action((opts: {
    root?: string[];
    snapshotDir?: string;
    maxDbs: string;
    maxSize: string;
    keepDays: string;
    keepBatches: string;
    dryRun?: boolean;
    report?: string;
    json?: boolean;
  }) => {
    const result = runOpsStateSnapshot({
      roots: opts.root,
      snapshotDir: opts.snapshotDir,
      maxDbs: parseIntFlag(opts.maxDbs, "max-dbs", { min: 1 }),
      maxSizeBytes: parseSize(opts.maxSize),
      keepDays: parseIntFlag(opts.keepDays, "keep-days", { min: 1 }),
      keepBatches: parseIntFlag(opts.keepBatches, "keep-batches", { min: 1 }),
      dryRun: opts.dryRun,
      reportPath: opts.report,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const status = result.summary.failed === 0 ? chalk.green("ok") : chalk.red("failed");
      console.log(`${status} copied=${result.summary.copied} failed=${result.summary.failed} skipped=${result.summary.skipped} pruned=${result.summary.pruned_batches} truncated=${result.summary.truncated}`);
      console.log(chalk.dim(`batch=${result.batch_dir}`));
      if (result.report_path) console.log(chalk.dim(`report=${result.report_path}`));
      for (const row of result.snapshots.filter((entry) => entry.status !== "copied").slice(0, 20)) {
        const label = row.status === "failed" ? chalk.red("failed") : chalk.yellow("skipped");
        console.log(`${label} ${row.source} ${chalk.dim(row.detail)}`);
      }
    }
    if (result.summary.failed > 0) process.exitCode = 1;
  });

// ─── sources ────────────────────────────────────────────────────────────────

const sources = program.command("sources").description("Manage file sources");

sources
  .command("list")
  .alias("ls")
  .description("List all configured sources")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const files = store();
    const all = await files.listSources();
    if (opts.json) { await writeStdoutLine(JSON.stringify(all, null, 2)); return; }
    if (!all.length) {
      console.log(chalk.dim("No sources configured. Run: files sources add <path>"));
      return;
    }
    // On the hosted transport there is no single "current machine" for the
    // client — sources are owned by many machines — so we annotate every row
    // with its owner. On the local transport we only annotate foreign machines.
    const isCloud = files.transport === "api";
    const currentMachineId = isCloud ? null : (await files.currentMachine()).id;
    for (const s of all) {
      const isMine = currentMachineId === null ? false : s.machine_id === currentMachineId;
      const typeLabel = s.type === "s3"
        ? chalk.blue(`s3://${s.bucket}${s.prefix ? `/${s.prefix}` : ""}${(s.config as S3Config).profile ? ` profile:${(s.config as S3Config).profile}` : ""}`)
        : s.type === "google_drive"
          ? chalk.magenta(`google-drive:${(s.config as GoogleDriveConfig).profile}`)
          : chalk.green(s.path ?? "");
      const status = s.enabled ? chalk.green("enabled") : chalk.red("disabled");
      const mine = isMine ? "" : chalk.dim(` [${s.machine_id}]`);
      console.log(`${chalk.bold(s.id)}  ${chalk.cyan(s.name)}  ${typeLabel}  ${status}  ${chalk.dim(s.file_count + " files")}${mine}`);
    }
  });

sources
  .command("add <path-or-s3>")
  .description("Add a local folder or S3 bucket as a source")
  .option("-n, --name <name>", "Source name (defaults to path/bucket)")
  .option("--region <region>", "AWS region (for S3)")
  .option("--prefix <prefix>", "S3 key prefix (for S3)")
  .option("--access-key <key>", "Deprecated: static S3 credentials are rejected")
  .option("--secret-key <secret>", "Deprecated: static S3 credentials are rejected")
  .option("--aws-profile <profile>", "AWS shared config profile name (for S3)")
  .option("--endpoint <url>", "Custom S3 endpoint (for S3-compatible storage)")
  .option("--force-path-style", "Use path-style S3 requests for S3-compatible storage")
  .action(async (pathOrS3: string, opts: {
    name?: string;
    region?: string;
    prefix?: string;
    accessKey?: string;
    secretKey?: string;
    awsProfile?: string;
    endpoint?: string;
    forcePathStyle?: boolean;
  }) => {
    const files = store();
    const isCloud = files.transport === "api";
    // No `currentMachine()` preflight: the Store owns machine ownership. On
    // the local transport LocalStore stamps the on-box machine; on the hosted
    // transport ApiStore drops the id and the server assigns the owning machine.
    const persistSource = (input: Parameters<typeof files.createSource>[0]) => files.createSource(input);

    if (pathOrS3.startsWith("s3://")) {
      const url = new URL(pathOrS3);
      const bucket = url.hostname;
      const prefix = opts.prefix ?? (url.pathname.replace(/^\//, "") || undefined);
      const config: S3Config = {};
      if (opts.accessKey || opts.secretKey) {
        console.error(chalk.red("Static S3 credentials are not stored by @hasna/files. Use --aws-profile or the default AWS provider chain."));
        process.exit(1);
      }
      if (opts.awsProfile) config.profile = opts.awsProfile;
      if (opts.endpoint) config.endpoint = opts.endpoint;
      if (opts.forcePathStyle) config.forcePathStyle = true;

      const source = await persistSource({
        name: opts.name ?? bucket,
        type: "s3",
        bucket,
        prefix,
        region: opts.region ?? "us-east-1",
        config,
      });
      console.log(chalk.green(`✓ S3 source added${isCloud ? " (cloud)" : ""}: ${source.id} → s3://${bucket}${prefix ? `/${prefix}` : ""}`));
    } else {
      const absPath = resolve(pathOrS3);
      // On the hosted transport the source path may live on another machine,
      // so we do not require it to exist on this client. The local transport
      // still checks.
      if (!isCloud && !existsSync(absPath)) {
        console.error(chalk.red(`Path does not exist: ${absPath}`));
        process.exit(1);
      }
      const source = await persistSource({
        name: opts.name ?? absPath,
        type: "local",
        path: absPath,
        config: {},
      });
      console.log(chalk.green(`✓ Local source added${isCloud ? " (cloud)" : ""}: ${source.id} → ${absPath}`));
    }
  });

sources
  .command("add-google-drive")
  .description("Add a Google Drive source that imports files into the default S3 source or a configured local/S3 destination")
  .option("--profile <profile>", "Google connector profile name (repeatable)", collectValues, [] as string[])
  .option("--all-profiles", "Create one source for every authenticated Google Drive profile")
  .option("--destination-source <id>", "Destination S3 or local source ID (omits to auto-pick default S3)")
  .option("-n, --name <name>", "Source name")
  .option("--all", "Include My Drive and all shared drives")
  .option("--include-my-drive", "Include My Drive files")
  .option("--all-shared-drives", "Include all shared drives")
  .option("--shared-drive <id>", "Shared drive ID to include", collectValues, [] as string[])
  .option("--root-folder <id>", "Root folder ID to include", collectValues, [] as string[])
  .option("--path-mode <mode>", "Destination path mode: path_based or id_based", "path_based")
  .option("--delete-behavior <mode>", "How to handle missing Drive files: ignore or mark_deleted", "ignore")
  .option("--json", "Output as JSON")
  .action((opts: {
    profile: string[];
    allProfiles?: boolean;
    destinationSource?: string;
    name?: string;
    all?: boolean;
    includeMyDrive?: boolean;
    allSharedDrives?: boolean;
    sharedDrive: string[];
    rootFolder: string[];
    pathMode: string;
    deleteBehavior: string;
    json?: boolean;
  }) => {
    return (async () => {
    requireLocalTransport("files sources add-google-drive");
    const machine = getCurrentMachine();
    const destinationId = opts.destinationSource ? requireId(opts.destinationSource, "sources") : undefined;
    if (destinationId) {
      const destination = getSource(destinationId);
      if (!destination || (destination.type !== "s3" && destination.type !== "local")) {
        console.error(chalk.red("Destination source must be an S3 or local source"));
        process.exit(1);
      }
    }
    if (opts.deleteBehavior !== "ignore" && opts.deleteBehavior !== "mark_deleted") {
      console.error(chalk.red("--delete-behavior must be one of: ignore, mark_deleted"));
      process.exit(1);
    }
    if (opts.pathMode !== "path_based" && opts.pathMode !== "id_based") {
      console.error(chalk.red("--path-mode must be one of: path_based, id_based"));
      process.exit(1);
    }

    const profiles = opts.allProfiles ? await listGoogleDriveProfiles() : opts.profile;
    if (!profiles.length) {
      console.error(chalk.red(opts.allProfiles
        ? "No Google Drive profiles found. Run: connectors auth googledrive"
        : "Pass --profile <name> or --all-profiles"));
      process.exit(1);
    }

    const includeMyDrive = opts.all || opts.includeMyDrive || (!opts.allSharedDrives && opts.sharedDrive.length === 0);
    const includeSharedDrives = opts.all || opts.allSharedDrives || (!opts.includeMyDrive && opts.sharedDrive.length === 0);
    const created = [];
    for (const profile of profiles) {
      const config: GoogleDriveConfig = {
        profile,
        include_my_drive: includeMyDrive,
        include_all_shared_drives: includeSharedDrives,
        shared_drive_ids: opts.sharedDrive.length ? opts.sharedDrive : undefined,
        root_folder_ids: opts.rootFolder.length ? opts.rootFolder : undefined,
        destination_source_id: destinationId,
        path_mode: opts.pathMode as "path_based" | "id_based",
        delete_behavior: opts.deleteBehavior as "ignore" | "mark_deleted",
      };

      created.push(createSource({
        name: opts.name && profiles.length === 1 ? opts.name : `Google Drive (${profile})`,
        type: "google_drive",
        config,
        machine_id: machine.id,
      }));
    }

    if (opts.json) {
      console.log(JSON.stringify(created, null, 2));
      return;
    }

    for (const source of created) {
      console.log(chalk.green(`✓ Google Drive source added: ${source.id}`));
    }
    })().catch((error) => {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    });
  });

sources
  .command("bootstrap-prod-files")
  .alias("bootstrap-prod-emails")
  .description("Create or update the canonical S3 source for Google Drive archive sync (requires --bucket or HASNA_FILES_S3_BUCKET; no built-in default)")
  .option("--bucket <bucket>", "Archive bucket (required; or set HASNA_FILES_S3_BUCKET)", DEFAULT_PROD_FILES_BUCKET)
  .option("--region <region>", "AWS region", DEFAULT_PROD_FILES_REGION)
  .option("--aws-profile <profile>", "AWS shared config profile", DEFAULT_PROD_FILES_AWS_PROFILE)
  .option("--prefix <prefix>", "S3 key prefix for new Drive imports", DEFAULT_PROD_FILES_PREFIX)
  .option("-n, --name <name>", "Source name", DEFAULT_PROD_FILES_SOURCE_NAME)
  .option("--no-google-drive-default", "Do not set this source as the default Google Drive destination")
  .option("--json", "Output as JSON")
  .action((opts: {
    bucket: string;
    region: string;
    awsProfile: string;
    prefix?: string;
    name: string;
    googleDriveDefault?: boolean;
    json?: boolean;
  }) => {
    requireLocalTransport("files sources bootstrap-prod-files");
    if (!opts.bucket) {
      console.error(chalk.red("Missing --bucket (or set HASNA_FILES_S3_BUCKET). This package ships no default bucket."));
      process.exit(1);
      return;
    }
    const machine = getCurrentMachine();
    const config: S3Config = { profile: opts.awsProfile };
    // Generic short aliases a caller may have used for a prior bootstrap run
    // (not company-identifying); the actual bucket match is intentionally
    // limited to the resolved --bucket/env value — no internal bucket
    // literals are hardcoded here.
    const productionNames = new Set([opts.name, DEFAULT_PROD_FILES_SOURCE_NAME, "prod-files", "prod-emails-drive"]);
    const productionBuckets = new Set([opts.bucket]);
    const allSources = listSources();
    const activeDriveDestinationIds = new Set(
      allSources
        .filter((source) => source.enabled && source.type === "google_drive")
        .map((source) => (source.config as GoogleDriveConfig).destination_source_id)
        .filter((id): id is string => Boolean(id)),
    );
    const configuredDefaultId = loadConfig().google_drive_default_destination_source_id;
    const candidates = allSources.filter((source) =>
      source.type === "s3"
        && (productionNames.has(source.name) || productionBuckets.has(source.bucket ?? ""))
    );
    const existing = candidates.find((source) => activeDriveDestinationIds.has(source.id) && source.enabled)
      ?? candidates.find((source) => configuredDefaultId === source.id && source.enabled)
      ?? candidates.find((source) => source.enabled && source.bucket === opts.bucket)
      ?? candidates.find((source) => source.enabled)
      ?? candidates.find((source) => configuredDefaultId === source.id)
      ?? candidates.find((source) => activeDriveDestinationIds.has(source.id))
      ?? candidates[0];
    const candidateIds = new Set(candidates.map((source) => source.id));

    const source = existing
      ? updateSource(existing.id, {
          name: opts.name,
          bucket: opts.bucket,
          prefix: opts.prefix,
          region: opts.region,
          config,
          enabled: true,
        })!
      : createSource({
          name: opts.name,
          type: "s3",
          bucket: opts.bucket,
          prefix: opts.prefix,
          region: opts.region,
          config,
          machine_id: machine.id,
        });

    const updatedGoogleDriveSourceIds: string[] = [];
    for (const driveSource of allSources.filter((source) => source.type === "google_drive")) {
      const driveConfig = driveSource.config as GoogleDriveConfig;
      const shouldRepairDestination = !driveConfig.destination_source_id
        || candidateIds.has(driveConfig.destination_source_id);
      if (!shouldRepairDestination || driveConfig.destination_source_id === source.id) continue;

      updateSource(driveSource.id, {
        config: {
          ...driveConfig,
          destination_source_id: source.id,
        },
      });
      updatedGoogleDriveSourceIds.push(driveSource.id);
    }

    const disabledLegacySourceIds: string[] = [];
    for (const candidate of candidates) {
      if (candidate.id === source.id || !candidate.enabled) continue;
      updateSource(candidate.id, { enabled: false });
      disabledLegacySourceIds.push(candidate.id);
    }

    if (opts.googleDriveDefault !== false) {
      setConfigValue("google_drive_default_destination_source_id", source.id);
    }

    if (opts.json) {
      console.log(JSON.stringify({
        source,
        google_drive_default_destination_source_id: opts.googleDriveDefault === false ? undefined : source.id,
        updated_google_drive_source_ids: updatedGoogleDriveSourceIds,
        disabled_legacy_source_ids: disabledLegacySourceIds,
      }, null, 2));
      return;
    }

    const action = existing ? "updated" : "created";
    console.log(chalk.green(`✓ ${opts.name} ${action}: ${source.id} → s3://${opts.bucket}${opts.prefix ? `/${opts.prefix}` : ""}`));
    console.log(chalk.dim(`  AWS profile: ${opts.awsProfile}`));
    if (opts.googleDriveDefault !== false) {
      console.log(chalk.dim("  Google Drive default destination: set"));
    }
    if (updatedGoogleDriveSourceIds.length) {
      console.log(chalk.dim(`  Google Drive sources repaired: ${updatedGoogleDriveSourceIds.join(", ")}`));
    }
    if (disabledLegacySourceIds.length) {
      console.log(chalk.dim(`  Legacy S3 sources disabled: ${disabledLegacySourceIds.join(", ")}`));
    }
  });

sources
  .command("google-drive-profiles")
  .description("List Google Drive profiles available through connectors auth")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    requireLocalTransport("files sources google-drive-profiles");
    const profiles = await listGoogleDriveProfiles();
    if (opts.json) { console.log(JSON.stringify(profiles, null, 2)); return; }
    if (!profiles.length) {
      console.log(chalk.dim("No Google Drive profiles found. Run: connectors auth googledrive"));
      return;
    }
    for (const profile of profiles) console.log(profile);
  });
sources
  .command("rename <id> <name>")
  .description("Rename a source")
  .action(async (id: string, name: string) => {
    try {
      const updated = await store().updateSource(id, { name });
      if (!updated) throw new Error(`No source found matching "${id}"`);
      console.log(chalk.green(`✓ Source renamed to "${name}"`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

sources
  .command("enable <id>")
  .description("Enable a source")
  .action(async (id: string) => {
    try {
      if (!(await store().updateSource(id, { enabled: true }))) throw new Error(`No source found matching "${id}"`);
      console.log(chalk.green("✓ Source enabled"));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

sources
  .command("disable <id>")
  .description("Disable a source (skipped during index)")
  .action(async (id: string) => {
    try {
      if (!(await store().updateSource(id, { enabled: false }))) throw new Error(`No source found matching "${id}"`);
      console.log(chalk.green("✓ Source disabled"));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

sources
  .command("remove <id>")
  .description("Remove a source (and all its indexed files)")
  .option("--yes", "Confirm destructive removal")
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      if (!opts.yes) {
        console.error(chalk.red("Refusing to remove source without --yes (destructive operation)."));
        process.exit(1);
      }
      // The LocalStore resolves a partial id against the local db; the ApiStore
      // passes the cloud id straight through to DELETE /v1/sources/:id.
      const ok = await store().deleteSource(id);
      if (!ok) throw new Error(`Source not found: ${id}`);
      console.log(chalk.green(`✓ Source ${id} removed`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

// ─── index ──────────────────────────────────────────────────────────────────

program
  .command("index [source-id]")
  .description("Index all sources (or a specific one)")
  .action(async (sourceId?: string) => {
    requireLocalTransport("files index");
    const machine = getCurrentMachine();
    let resolvedSourceId = sourceId;
    if (sourceId) {
      try { resolvedSourceId = requireId(sourceId, "sources"); }
      catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
    }
    const toIndex = resolvedSourceId
      ? [getSource(resolvedSourceId)].filter(Boolean)
      : listSources(machine.id).filter((s) => s.enabled);

    if (!toIndex.length) {
      console.log(chalk.dim("No sources to index."));
      return;
    }

    for (const source of toIndex) {
      if (!source) continue;
      console.log(chalk.dim(`Indexing ${source.name}...`));
      try {
        const stats = source.type === "s3"
          ? await indexS3Source(source, machine.id)
          : source.type === "google_drive"
            ? await syncGoogleDriveSource(source)
            : await indexLocalSource(source, machine.id);
        console.log(
          chalk.green(`✓ ${source.name}`) +
          chalk.dim(` +${stats.added} ~${stats.updated} -${stats.deleted} errors:${stats.errors} (${stats.duration_ms}ms)`)
        );
      } catch (e) {
        console.error(chalk.red(`✗ ${source.name}: ${(e as Error).message}`));
      }
    }
  });

sources
  .command("shared-drives <id>")
  .description("List accessible Google shared drives for a source")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    requireLocalTransport("files sources shared-drives");
    const source = getSource(requireId(id, "sources"));
    if (!source || source.type !== "google_drive") {
      console.error(chalk.red("Source must be a Google Drive source"));
      process.exit(1);
    }
    const drives = await listGoogleDriveSharedDrives(source);
    if (opts.json) { console.log(JSON.stringify(drives, null, 2)); return; }
    if (!drives.length) { console.log(chalk.dim("No shared drives found.")); return; }
    for (const drive of drives) {
      console.log(`${chalk.bold(drive.id)}  ${chalk.cyan(drive.name)}`);
    }
  });

sources
  .command("google-drive-items <id>")
  .description("List Google Drive items visible to a source")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    requireLocalTransport("files sources google-drive-items");
    const source = getSource(requireId(id, "sources"));
    if (!source || source.type !== "google_drive") {
      console.error(chalk.red("Source must be a Google Drive source"));
      process.exit(1);
    }
    const items = await listGoogleDriveItems(source);
    if (opts.json) { console.log(JSON.stringify(items, null, 2)); return; }
    if (!items.length) { console.log(chalk.dim("No Google Drive items found.")); return; }
    for (const item of items) {
      console.log(`${chalk.bold(item.id)}  ${chalk.cyan(item.path)}  ${chalk.dim(item.drive_name)}`);
    }
  });

sources
  .command("google-drive-status [id]")
  .description("Preflight Google Drive auth, destination, and item scope without uploading")
  .option("--json", "Output as JSON")
  .action(async (id: string | undefined, opts: { json?: boolean }) => {
    requireLocalTransport("files sources google-drive-status");
    const sources = id
      ? [getSource(requireId(id, "sources"))].filter(Boolean)
      : listSources().filter((source) => source.enabled && source.type === "google_drive");
    const results = [];

    if (!sources.length) {
      if (opts.json) { console.log("[]"); return; }
      console.log(chalk.dim("No Google Drive sources found."));
      return;
    }

    for (const source of sources) {
      if (!source || source.type !== "google_drive") {
        console.error(chalk.red("Source must be a Google Drive source"));
        process.exit(1);
      }
      const result = await preflightGoogleDriveSource(source);
      results.push(result);
      if (!opts.json) printGoogleDrivePreflight(result);
    }

    if (opts.json) console.log(JSON.stringify(results, null, 2));
  });

sources
  .command("sync-google-drive [id]")
  .description("Import one Google Drive source, or all enabled Google Drive sources when omitted")
  .option("--dry-run", "Preflight auth, destination, and item scope without uploading")
  .option("--json", "Output as JSON")
  .action(async (id: string | undefined, opts: { dryRun?: boolean; json?: boolean }) => {
    requireLocalTransport("files sources sync-google-drive");
    const toSync = id
      ? [getSource(requireId(id, "sources"))].filter(Boolean)
      : listSources().filter((source) => source.enabled && source.type === "google_drive");
    const results = [];

    if (!toSync.length) {
      if (opts.json) { console.log("[]"); return; }
      console.log(chalk.dim("No Google Drive sources to sync."));
      return;
    }

    for (const source of toSync) {
      if (!source || source.type !== "google_drive") {
        console.error(chalk.red("Source must be a Google Drive source"));
        process.exit(1);
      }
      if (opts.dryRun) {
        const result = await preflightGoogleDriveSource(source);
        results.push(result);
        if (!opts.json) printGoogleDrivePreflight(result);
        continue;
      }
      const stats = await syncGoogleDriveSource(source);
      results.push({ source: source.id, name: source.name, ...stats });
      if (!opts.json) {
        console.log(
          chalk.green(`✓ ${source.name}`) +
          chalk.dim(` +${stats.added} ~${stats.updated} -${stats.deleted} errors:${stats.errors} (${stats.duration_ms}ms)`)
        );
      }
    }

    if (opts.json) console.log(JSON.stringify(results, null, 2));
  });

function printGoogleDrivePreflight(result: Awaited<ReturnType<typeof preflightGoogleDriveSource>>): void {
  const destination = result.destination.type === "s3"
    ? `s3://${result.destination.bucket}${result.destination.prefix ? `/${result.destination.prefix}` : ""}`
    : result.destination.path;
  const authLabel = result.auth?.authRequired
    ? chalk.red("auth required")
    : result.auth?.expired
      ? chalk.yellow("refreshable")
      : chalk.green("ok");
  console.log(chalk.bold(result.source_name));
  console.log(`  profile: ${chalk.cyan(result.profile)} (${authLabel})`);
  console.log(`  destination: ${chalk.cyan(destination ?? result.destination.name)}${result.destination.aws_profile ? chalk.dim(` profile:${result.destination.aws_profile}`) : ""}`);
  console.log(`  includes: ${[
    result.includes.my_drive ? "My Drive" : "",
    result.includes.all_shared_drives ? "all shared drives" : "",
    result.includes.shared_drive_ids.length ? `${result.includes.shared_drive_ids.length} selected shared drives` : "",
    result.includes.root_folder_ids.length ? `${result.includes.root_folder_ids.length} root folders` : "",
  ].filter(Boolean).join(", ") || "none"}`);
  console.log(`  visible items: ${result.item_count}`);
  for (const drive of result.drive_counts) {
    console.log(chalk.dim(`    ${drive.drive_name}: ${drive.count}`));
  }
  for (const error of result.errors) {
    console.log(chalk.red(`  error: ${error}`));
  }
}

// ─── machines ───────────────────────────────────────────────────────────────

program
  .command("machines")
  .description("List known machines")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const machines = await store().listMachines();
    if (opts.json) { console.log(JSON.stringify(machines, null, 2)); return; }
    for (const m of machines) {
      const current = m.is_current ? chalk.green(" (this machine)") : "";
      console.log(`${chalk.bold(m.id)}  ${chalk.cyan(m.hostname)}  ${m.platform}/${m.arch}  ${chalk.dim(m.last_seen)}${current}`);
    }
  });

// ─── search ─────────────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search files by metadata and indexed derived content")
  .option("-s, --source <id>", "Filter by source ID")
  .option("-m, --machine <id>", "Filter by machine ID")
  .option("-t, --tag <tag>", "Filter by tag")
  .option("-e, --ext <ext>", "Filter by extension")
  .option("--scope <scope>", "Search scope: all, metadata, content", "all")
  .option("-l, --limit <n>", "Max results", "20")
  .option("--offset <n>", "Offset", "0")
  .option("--json", "Output as JSON")
  .action(async (query: string, opts: {
    source?: string;
    machine?: string;
    tag?: string;
    ext?: string;
    scope: string;
    limit: string;
    offset: string;
    json?: boolean;
  }) => {
    let limit: number;
    let offset: number;
    let scope: SearchScope;
    try {
      limit = parseIntFlag(opts.limit, "limit", { min: 1 });
      offset = parseIntFlag(opts.offset, "offset", { min: 0 });
      scope = parseSearchScope(opts.scope);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }

    const results = await store().searchFiles(query, {
      source_id: opts.source,
      machine_id: opts.machine,
      tag: opts.tag,
      ext: opts.ext,
      limit,
      offset,
      search_scope: scope,
    });
    if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
    if (!results.length) { console.log(chalk.dim("No results.")); return; }
    for (const f of results) {
      const tags = f.tags.length ? chalk.yellow(` [${f.tags.join(", ")}]`) : "";
      const src = f.source_name ? chalk.dim(` (${f.source_name})`) : "";
      const target = f.organization_target_path ? chalk.green(` -> ${f.organization_target_path}`) : "";
      const match = formatSearchMatch(f.search_match_sources, f.search_document_kinds);
      console.log(`${chalk.bold(f.id)}  ${chalk.cyan(f.name)}  ${chalk.dim(f.path)}${target}${tags}${src}${match}`);
    }
    console.log(chalk.dim(`\n${results.length} result(s)`));
  });

program
  .command("context-pack [file-ids...]")
  .description("Build a bounded, cited context pack for explicit files or open-files refs")
  .option("--source-ref <ref>", "open-files://file or open-files://source/.../path ref; repeatable", collectValues, [] as string[])
  .option("--max-files <n>", "Maximum files to include", "5")
  .option("--max-excerpts <n>", "Maximum excerpts across the pack", "12")
  .option("--max-excerpt-chars <n>", "Maximum characters per excerpt", "900")
  .option("--max-total-chars <n>", "Maximum excerpt characters across the pack", "6000")
  .option("--max-bytes-per-file <n>", "Maximum bytes to read per file", "262144")
  .option("--redact <regex>", "Additional regex redaction pattern; repeatable", collectValues, [] as string[])
  .option("--out <path>", "Write the full bounded pack JSON to a file and print an artifact pointer")
  .option("--dry-run", "With --out, preview the artifact pointer without writing the file")
  .action(async (fileIds: string[], opts: ContextPackCliOptions) => {
    try {
      requireLocalTransport("context-pack");
      const positionalRefs = fileIds.filter((value) => value.startsWith("open-files://"));
      const positionalFileIds = fileIds.filter((value) => !value.startsWith("open-files://"));
      const pack = await buildFilesContextPack({
        file_ids: positionalFileIds.map(resolveFileIdForPack),
        source_refs: [...opts.sourceRef, ...positionalRefs],
        ...packLimitsFromCli(opts),
        redact_patterns: compileRedactions(opts.redact),
      });
      printContextPack(pack, opts);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

program
  .command("search-pack <query>")
  .description("Search files and return a bounded, cited context pack")
  .option("-s, --source <id>", "Filter by source ID")
  .option("-m, --machine <id>", "Filter by machine ID")
  .option("-t, --tag <tag>", "Filter by tag")
  .option("-e, --ext <ext>", "Filter by extension")
  .option("--scope <scope>", "Search scope: all, metadata, content", "all")
  .option("--offset <n>", "Search result offset", "0")
  .option("--max-files <n>", "Maximum files to include", "5")
  .option("--max-excerpts <n>", "Maximum excerpts across the pack", "12")
  .option("--max-excerpt-chars <n>", "Maximum characters per excerpt", "900")
  .option("--max-total-chars <n>", "Maximum excerpt characters across the pack", "6000")
  .option("--max-bytes-per-file <n>", "Maximum bytes to read per file", "262144")
  .option("--redact <regex>", "Additional regex redaction pattern; repeatable", collectValues, [] as string[])
  .option("--out <path>", "Write the full bounded pack JSON to a file and print an artifact pointer")
  .option("--dry-run", "With --out, preview the artifact pointer without writing the file")
  .action(async (query: string, opts: SearchPackCliOptions) => {
    try {
      requireLocalTransport("search-pack");
      const pack = await buildFilesSearchPack({
        query,
        source_id: opts.source,
        machine_id: opts.machine,
        tag: opts.tag,
        ext: opts.ext,
        search_scope: parseSearchScope(opts.scope),
        offset: parseIntFlag(opts.offset, "offset", { min: 0 }),
        ...packLimitsFromCli(opts),
        redact_patterns: compileRedactions(opts.redact),
      });
      printContextPack(pack, opts);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

// ─── search index ──────────────────────────────────────────────────────────

const searchIndex = program.command("search-index").description("Manage derived search documents for extracted artifacts");

searchIndex
  .command("add <file-id>")
  .description("Index a bounded extracted/OCR/transcript/summary text artifact for a file")
  .requiredOption("--text-file <path>", "Local text artifact to index")
  .option("--kind <kind>", "Document kind", "extracted_text")
  .option("--extractor <name>", "Extractor or agent that produced the artifact", "manual")
  .option("--source-ref <ref>", "Source ref for the artifact; defaults to the latest file revision ref")
  .option("--revision <id>", "File revision id for the artifact")
  .option("--content-hash <hash>", "Artifact content hash; defaults to sha256 of indexed text")
  .option("--status <status>", "ready, partial, unsupported, error, stale", "ready")
  .option("--metadata-json <json>", "Small JSON metadata object to store with the index row")
  .option("--metadata-file <path>", "Path to a small JSON metadata object")
  .option("--max-chars <n>", "Maximum UTF-8 characters to index from the artifact", "200000")
  .option("--public", "Mark the derived document as non-private")
  .option("--no-replace-existing", "Do not mark older same-kind/source-ref documents stale")
  .option("--json", "Output as JSON")
  .action(async (fileId: string, opts: {
    textFile: string;
    kind: string;
    extractor: string;
    sourceRef?: string;
    revision?: string;
    contentHash?: string;
    status: string;
    metadataJson?: string;
    metadataFile?: string;
    maxChars: string;
    public?: boolean;
    replaceExisting?: boolean;
    json?: boolean;
  }) => {
    // The derived-content index is a BOTH-backend capability: the local store
    // writes FTS5 rows, the hosted store writes /v1 search documents.
    try {
      const files = store();
      // Partial ids resolve on the local store only; hosted ids pass through.
      const id = files.transport === "local" ? requireId(fileId, "files") : fileId;
      const file = await files.getFile(id);
      if (!file) throw new Error(`File not found: ${id}`);
      const textPath = resolve(opts.textFile);
      if (!existsSync(textPath)) throw new Error(`Text artifact not found: ${opts.textFile}`);

      const kind = parseFileSearchDocumentKind(opts.kind);
      const status = parseFileSearchDocumentStatus(opts.status);
      const maxChars = parseIntFlag(opts.maxChars, "max-chars", { min: 1 });
      const rawText = readFileSync(textPath, "utf8");
      const searchableText = rawText.slice(0, maxChars);
      const truncated = rawText.length > searchableText.length;
      // Revision resolution is a local-store refinement; hosted clients pass
      // --revision explicitly (the server owns revision metadata).
      const revisionId = opts.revision ?? (files.transport === "local" ? getLatestFileVersion(id)?.id : undefined);
      const sourceRef = opts.sourceRef
        ?? (revisionId ? buildOpenFilesFileRevisionRef(id, revisionId) : buildOpenFilesFileRef(id));
      const metadata = {
        ...readMetadataObject(opts.metadataJson, opts.metadataFile),
        ...(truncated ? {
          cli_index_truncated: true,
          original_chars: rawText.length,
          indexed_chars: searchableText.length,
        } : {}),
      };

      const document = await files.upsertSearchDocument({
        file_id: id,
        revision_id: revisionId,
        source_ref: sourceRef,
        kind,
        extractor: opts.extractor,
        content_hash: opts.contentHash,
        searchable_text: searchableText,
        metadata,
        status,
        private: !opts.public,
        replace_existing: opts.replaceExisting,
      });
      const safe = formatSearchDocumentForOutput(document);
      if (opts.json) { console.log(JSON.stringify(safe, null, 2)); return; }
      console.log(chalk.green(`indexed search document: ${safe.id}`));
      console.log(chalk.dim(`file:${safe.file_id} kind:${safe.kind} status:${safe.status} chars:${safe.searchable_chars}`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

searchIndex
  .command("list [file-id]")
  .description("List derived search documents without printing indexed text")
  .option("--kind <kind>", "Filter by document kind")
  .option("--status <status>", "Filter by status")
  .option("-l, --limit <n>", "Max documents", "50")
  .option("--offset <n>", "Offset", "0")
  .option("--json", "Output as JSON")
  .action(async (fileId: string | undefined, opts: {
    kind?: string;
    status?: string;
    limit: string;
    offset: string;
    json?: boolean;
  }) => {
    try {
      const files = store();
      const docs = (await files.listSearchDocuments({
        file_id: fileId ? (files.transport === "local" ? requireId(fileId, "files") : fileId) : undefined,
        kind: opts.kind ? parseFileSearchDocumentKind(opts.kind) : undefined,
        status: opts.status ? parseFileSearchDocumentStatus(opts.status) : undefined,
        limit: parseIntFlag(opts.limit, "limit", { min: 1 }),
        offset: parseIntFlag(opts.offset, "offset", { min: 0 }),
      })).map(formatSearchDocumentForOutput);
      if (opts.json) { console.log(JSON.stringify(docs, null, 2)); return; }
      if (!docs.length) { console.log(chalk.dim("No search documents found.")); return; }
      for (const doc of docs) {
        console.log(`${chalk.bold(doc.id)}  ${chalk.cyan(doc.kind)}  ${doc.status}  ${chalk.dim(`chars:${doc.searchable_chars} updated:${doc.updated_at}`)}`);
      }
      console.log(chalk.dim(`\n${docs.length} document(s)`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

searchIndex
  .command("remove <document-id>")
  .description("Remove a derived search document and its FTS entry")
  .option("--json", "Output as JSON")
  .action(async (documentId: string, opts: { json?: boolean }) => {
    try {
      const removed = await store().deleteSearchDocument(documentId);
      if (opts.json) { console.log(JSON.stringify({ removed }, null, 2)); return; }
      console.log(removed ? chalk.green("removed") : chalk.dim("not found"));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

searchIndex
  .command("stats")
  .description("Show derived search index coverage")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    requireLocalTransport("files search-index stats");
    const stats = getFileSearchIndexStats();
    if (opts.json) { console.log(JSON.stringify(stats, null, 2)); return; }
    console.log(chalk.bold("derived search index"));
    console.log(`documents: ${stats.documents}  indexed_files: ${stats.indexed_files}  stale: ${stats.stale_documents}`);
    console.log(`active_files: ${stats.active_files}  active_indexed: ${stats.active_indexed_files}  missing_active_index: ${stats.missing_indexed_active_files}  coverage: ${stats.indexed_active_coverage_pct}%`);
    console.log(`organized: ${stats.organized_active_files}  with_owner: ${stats.active_files_with_owner}  with_target_path: ${stats.active_files_with_target_path}  with_canonical_name: ${stats.active_files_with_canonical_name}`);
    for (const row of stats.by_kind) console.log(`  ${chalk.cyan(row.kind.padEnd(20))} ${row.count}`);
    if (stats.by_owner.length) {
      console.log(chalk.dim("by owner"));
      for (const row of stats.by_owner) console.log(`  ${chalk.cyan(row.owner.padEnd(20))} active:${row.active_files} indexed:${row.indexed_files}`);
    }
  });

searchIndex
  .command("rebuild-fts")
  .description("Rebuild derived search FTS entries from stored search documents")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    requireLocalTransport("files search-index rebuild-fts");
    const refreshed = refreshAllFileSearchDocumentFts();
    if (opts.json) { console.log(JSON.stringify({ refreshed }, null, 2)); return; }
    console.log(chalk.green(`refreshed ${refreshed} search document(s)`));
  });

// ─── list ───────────────────────────────────────────────────────────────────

program
  .command("list")
  .alias("ls")
  .description("List files")
  .option("-s, --source <id>", "Filter by source ID")
  .option("-m, --machine <id>", "Filter by machine ID")
  .option("-t, --tag <tag>", "Filter by tag")
  .option("-e, --ext <ext>", "Filter by extension")
  .option("-c, --collection <id>", "Filter by collection ID")
  .option("-p, --project <id>", "Filter by project ID")
  .option("-l, --limit <n>", "Max results", "50")
  .option("--offset <n>", "Offset", "0")
  .option("--after <date>", "Modified after date (YYYY-MM-DD)")
  .option("--before <date>", "Modified before date (YYYY-MM-DD)")
  .option("--min-size <size>", "Minimum size (e.g. 1mb, 500kb, 1024)")
  .option("--max-size <size>", "Maximum size (e.g. 100mb)")
  .option("--sort <field>", "Sort by: name, size, date (default: date)")
  .option("--asc", "Sort ascending (default: descending)")
  .option("--json", "Output as JSON")
  .action(async (opts: {
    source?: string; machine?: string; tag?: string; ext?: string;
    collection?: string; project?: string; limit: string; offset: string;
    after?: string; before?: string; minSize?: string; maxSize?: string;
    sort?: string; asc?: boolean; json?: boolean;
  }) => {
    let limit: number;
    let offset: number;
    try {
      limit = parseIntFlag(opts.limit, "limit", { min: 1 });
      offset = parseIntFlag(opts.offset, "offset", { min: 0 });
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }

    // The Store routes to the on-box db (rich filters) or the cloud /v1/files
    // endpoint (which honors the source_id/machine_id/ext/limit/offset subset).
    const files = await store().listFiles({
      source_id: opts.source,
      machine_id: opts.machine,
      tag: opts.tag,
      ext: opts.ext,
      collection_id: opts.collection,
      project_id: opts.project,
      limit,
      offset,
      after: opts.after,
      before: opts.before,
      min_size: opts.minSize ? parseSize(opts.minSize) : undefined,
      max_size: opts.maxSize ? parseSize(opts.maxSize) : undefined,
      sort: (opts.sort as "name" | "size" | "date") ?? "date",
      sort_dir: opts.asc ? "asc" : "desc",
    });
    if (opts.json) { console.log(JSON.stringify(files, null, 2)); return; }
    if (!files.length) { console.log(chalk.dim("No files found.")); return; }
    for (const f of files) {
      const tags = f.tags.length ? chalk.yellow(` [${f.tags.join(", ")}]`) : "";
      console.log(`${chalk.bold(f.id)}  ${chalk.cyan(f.name)}  ${chalk.dim(formatSize(f.size))}  ${chalk.dim(f.path)}${tags}`);
    }
    console.log(chalk.dim(`\n${files.length} file(s)`));
  });

// ─── tag ────────────────────────────────────────────────────────────────────

program
  .command("tag <file-id> <tags...>")
  .description("Add tags to a file")
  .action(async (fileId: string, tags: string[]) => {
    try {
      const files = store();
      const file = await files.getFile(fileId);
      if (!file) throw new Error(`No file found matching "${fileId}"`);
      for (const tag of tags) await files.tagFile(fileId, tag);
      console.log(chalk.green(`✓ Tagged ${file.name} with: ${tags.join(", ")}`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

program
  .command("untag <file-id> <tags...>")
  .description("Remove tags from a file")
  .action(async (fileId: string, tags: string[]) => {
    try {
      const files = store();
      for (const tag of tags) await files.untagFile(fileId, tag);
      console.log(chalk.green(`✓ Tags removed`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

program
  .command("tags")
  .description("List all tags")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const tags = await store().listTags();
    if (opts.json) { console.log(JSON.stringify(tags, null, 2)); return; }
    if (!tags.length) { console.log(chalk.dim("No tags yet.")); return; }
    for (const t of tags) console.log(`${chalk.bold(t.id)}  ${chalk.hex(t.color)(t.name)}`);
  });

// ─── download ───────────────────────────────────────────────────────────────

program
  .command("download <file-id> [dest]")
  .description("Download a file to local disk")
  .action(async (fileId: string, dest?: string) => {
    const files = store();
    if (files.transport === "api") {
      if (!(files instanceof ApiStore)) {
        console.error(chalk.red("Authenticated file-content transport is unavailable."));
        process.exit(1);
      }
      if (!dest) {
        console.error(chalk.red("Hosted downloads require an explicit destination path."));
        process.exit(1);
      }

      let output;
      try {
        output = openSecureOutput(dest);
        await files.downloadFileContent(fileId, (chunk) => output!.write(chunk));
        output.commit();
        console.log(chalk.green("✓ Download complete"));
      } catch (error) {
        output?.abort();
        console.error(chalk.red(remoteContentFailure("download", error)));
        process.exit(1);
      }
      return;
    }

    let resolved;
    try {
      resolved = resolveFileObject(requireId(fileId, "files"));
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }

    if (resolved.storageSource.type === "local") {
      const fullPath = join(resolved.storageSource.path!, resolved.objectKey);
      console.log(chalk.dim(`Local file at: ${fullPath}`));
      return;
    }

    const outPath = dest ?? resolved.file.name;
    console.log(chalk.dim(`Downloading ${resolved.file.name}...`));
    await downloadResolvedFileObject(resolved, outPath);
    console.log(chalk.green(`✓ Downloaded to ${outPath}`));
  });

// ─── upload ──────────────────────────────────────────────────────────────────
// Cloud-mode ingestion: `files upload` used to refuse on the hosted transport
// ("runs on-box only ... the files service owns ingestion"), and the hosted
// service had no ingestion route — so a document could not be added as a
// tagged, project-linked resource in cloud mode (bug de9aeeed). It now routes
// through the store seam: ApiStore signs a server-owned PUT URL, uploads the
// bytes, completes, and applies tags + the project link; LocalStore keeps the
// existing S3-source upload and adds the same tag/project application.

const collectTag = (value: string, acc: string[]): string[] => [...acc, value];

program
  .command("upload <local-path> [source-id] [s3-key]")
  .description("Upload a local document (cloud: server-owned ingestion as a tagged project resource; local: to an S3 source)")
  .option("--project <id>", "Link the uploaded file to a project as a resource")
  .option("--tag <tag>", "Tag the uploaded file (repeatable)", collectTag, [])
  .option("--name <name>", "Stored file name (defaults to the local basename)")
  .action(async (localPath: string, sourceId: string | undefined, s3Key: string | undefined, opts: { project?: string; tag?: string[]; name?: string }) => {
    try {
      const result = await store().uploadFile({
        path: localPath,
        name: opts.name,
        source_id: sourceId,
        source_key: s3Key,
        tags: opts.tag ?? [],
        project_id: opts.project,
      });
      const f = result.file;
      const tags = f.tags?.length ? ` (tags: ${f.tags.join(", ")})` : "";
      console.log(chalk.green(`✓ Uploaded ${f.name} ${chalk.dim(f.id)}${tags}`));
      if (opts.project) console.log(chalk.dim(`Linked to project ${opts.project}`));
      if (sourceId && sourceId.trim()) console.log(chalk.dim(`Source: ${sourceId}`));
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

// ─── collections / projects ──────────────────────────────────────────────────

const cols = program.command("collections").description("Manage collections");
cols
  .command("list")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const collections = await store().listCollections();
    if (opts.json) { console.log(JSON.stringify(collections, null, 2)); return; }
    for (const c of collections) console.log(`${chalk.bold(c.id)}  ${chalk.cyan(c.name)}  ${chalk.dim(c.description)}`);
  });
cols.command("create <name> [description]").action(async (name: string, desc?: string) => {
  const c = await store().createCollection(name, desc);
  console.log(chalk.green(`✓ Collection created: ${c.id}`));
});
cols.command("remove <id>").description("Delete a collection").option("--yes", "Confirm destructive removal").action(async (id: string, opts: { yes?: boolean }) => {
  try {
    if (!opts.yes) {
      console.error(chalk.red("Refusing to remove collection without --yes (destructive operation)."));
      process.exit(1);
    }
    const ok = await store().deleteCollection(id);
    console.log(ok ? chalk.green("✓ Collection removed") : chalk.red("Collection not found"));
  } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
});
cols.command("add <collection-id> <file-id>").action(async (colId: string, fileId: string) => {
  try {
    await store().addToCollection(colId, fileId);
    console.log(chalk.green("✓ Added to collection"));
  } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
});

const projs = program.command("projects").description("Manage projects");
projs
  .command("list")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const projects = await store().listProjects();
    if (opts.json) { console.log(JSON.stringify(projects, null, 2)); return; }
    for (const p of projects) console.log(`${chalk.bold(p.id)}  ${chalk.cyan(p.name)}  ${chalk.dim(p.description)}`);
  });
projs.command("create <name> [description]").action(async (name: string, desc?: string) => {
  const p = await store().createProject(name, desc);
  console.log(chalk.green(`✓ Project created: ${p.id}`));
});
projs.command("remove <id>").description("Delete a project").option("--yes", "Confirm destructive removal").action(async (id: string, opts: { yes?: boolean }) => {
  try {
    if (!opts.yes) {
      console.error(chalk.red("Refusing to remove project without --yes (destructive operation)."));
      process.exit(1);
    }
    const ok = await store().deleteProject(id);
    console.log(ok ? chalk.green("✓ Project removed") : chalk.red("Project not found"));
  } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
});
projs.command("add <project-id> <file-id>").action(async (projId: string, fileId: string) => {
  try {
    await store().addToProject(projId, fileId);
    console.log(chalk.green("✓ Added to project"));
  } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
});

program
  .command("project-panel")
  .description("Emit a contract-valid project dashboard panel for files")
  .option("--project <project>", "Project id, name, or slug. Defaults to the current folder name")
  .option("--limit <n>", "Maximum panel items/resources", "20")
  .option("--contract", "Emit hasna.project_panel.v1 contract JSON")
  .option("--json", "Output JSON")
  .action(async (opts: { project?: string; limit: string; contract?: boolean; json?: boolean }) => {
    try {
      const { createFilesProjectPanel } = await import("../lib/project-panel.js");
      const panel = createFilesProjectPanel(opts.project ?? basename(process.cwd()), {
        limit: parseIntFlag(opts.limit, "limit", { min: 1 }),
      });
      if (opts.json || opts.contract) {
        console.log(JSON.stringify(panel, null, 2));
        return;
      }
      console.log(chalk.bold(panel.title));
      console.log(panel.summary ?? chalk.dim("No summary."));
      for (const metric of panel.metrics) {
        console.log(`${chalk.dim(metric.id)} ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`);
      }
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

// ─── info ────────────────────────────────────────────────────────────────────

program
  .command("info <file-id>")
  .description("Show file details")
  .option("--json", "Output as JSON")
  .action(async (fileId: string, opts: { json?: boolean }) => {
    // Data-plane read: routed through the Store so metadata reflects the active
    // transport (on-box db or cloud service).
    const file = await store().getFile(fileId);
    if (!file) { console.error(chalk.red(`No file found matching "${fileId}"`)); process.exit(1); }
    if (opts.json) { console.log(JSON.stringify(file, null, 2)); return; }
    console.log(`${chalk.bold("ID:")}        ${file.id}`);
    console.log(`${chalk.bold("Name:")}      ${file.name}`);
    console.log(`${chalk.bold("Path:")}      ${file.path}`);
    console.log(`${chalk.bold("Size:")}      ${formatSize(file.size)}`);
    console.log(`${chalk.bold("MIME:")}      ${file.mime}`);
    console.log(`${chalk.bold("Hash:")}      ${file.hash ?? "-"}`);
    console.log(`${chalk.bold("Tags:")}      ${file.tags.join(", ") || "-"}`);
    console.log(`${chalk.bold("Indexed:")}   ${file.indexed_at}`);
    console.log(`${chalk.bold("Modified:")}  ${file.modified_at ?? "-"}`);
    console.log(`${chalk.bold("Source:")}    ${file.source_id}`);
    console.log(`${chalk.bold("Machine:")}   ${file.machine_id}`);
  });

program
  .command("resolve <file-id>")
  .description("Resolve a file to its current object storage location")
  .option("--json", "Output as JSON")
  .action((fileId: string, opts: { json?: boolean }) => {
    requireLocalTransport("files resolve");
    try {
      const resolved = resolveFileObject(requireId(fileId, "files"));
      const summary = resolvedFileObjectSummary(resolved);
      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      const storage = summary.storage as Record<string, unknown>;
      console.log(`${chalk.bold("ID:")}        ${resolved.file.id}`);
      console.log(`${chalk.bold("Name:")}      ${resolved.file.name}`);
      console.log(`${chalk.bold("Kind:")}      ${storage.kind}`);
      console.log(`${chalk.bold("Provider:")}  ${storage.provider}`);
      if (storage.bucket) console.log(`${chalk.bold("Bucket:")}    ${storage.bucket}`);
      if (storage.region) console.log(`${chalk.bold("Region:")}    ${storage.region}`);
      if (storage.key) console.log(`${chalk.bold("Key:")}       ${storage.key}`);
      if (storage.path) console.log(`${chalk.bold("Path:")}      ${storage.path}`);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
  });

program
  .command("stats")
  .description("Show storage statistics")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    // Data-plane read: the Store reports the on-box db (local) or the hosted
    // service (api) — never a stale local island on the hosted transport.
    const stats = await store().getStats();
    if (opts.json) { console.log(JSON.stringify(stats, null, 2)); return; }

    const totalFiles = Number(stats.total_files ?? 0);
    const totalSize = Number(stats.total_size ?? 0);
    const bySource = (stats.by_source as Array<{ name?: string; count: number }> | undefined) ?? [];
    const byExt = (stats.by_ext as Array<{ ext?: string; count: number }> | undefined) ?? [];
    const byMachine = (stats.by_machine as Array<{ name?: string; count: number }> | undefined) ?? [];

    console.log(chalk.bold("\n  Files Overview"));
    console.log(`  ${chalk.cyan(totalFiles.toLocaleString())} files  ${chalk.cyan(formatSize(totalSize))} total\n`);

    if (bySource.length) {
      console.log(chalk.bold("  By Source"));
      for (const r of bySource) console.log(`  ${chalk.cyan((r.name ?? "(unknown)").padEnd(30))} ${String(r.count).padStart(7)} files`);
      console.log();
    }
    if (byExt.length) {
      console.log(chalk.bold("  Top Extensions"));
      for (const r of byExt) console.log(`  ${chalk.yellow((r.ext || "(none)").padEnd(12))} ${String(r.count).padStart(7)} files`);
      console.log();
    }
    if (byMachine.length) {
      console.log(chalk.bold("  By Machine"));
      for (const r of byMachine) console.log(`  ${chalk.magenta((r.name ?? "(unknown)").padEnd(30))} ${String(r.count).padStart(7)} files`);
      console.log();
    }
  });

program
  .command("dupes")
  .description("Find duplicate files (same BLAKE3 hash, different paths)")
  .option("-s, --source <id>", "Limit to a specific source")
  .option("--json", "Output as JSON")
  .action(async (opts: { source?: string; json?: boolean }) => {
    // Data-plane read: duplicate detection runs against the active transport's
    // dataset (on-box db or the cloud service), never the wrong island.
    const groups = await store().findDuplicates(opts.source);

    if (opts.json) { console.log(JSON.stringify(groups, null, 2)); return; }

    if (!groups.length) {
      console.log(chalk.green("✓ No duplicates found."));
      return;
    }

    console.log(chalk.bold(`\n  ${groups.length} duplicate group(s)\n`));
    for (const g of groups) {
      console.log(chalk.yellow(`  ${g.hash.slice(0, 16)}…  ${chalk.dim(`×${g.cnt}`)}`));
      for (const p of g.paths.split(" | ")) {
        console.log(`    ${chalk.dim(p)}`);
      }
      console.log();
    }
  });

// ─── peers ───────────────────────────────────────────────────────────────────

const peers = program.command("peers").description("Manage peer machines for sync");

peers
  .command("list")
  .alias("ls")
  .description("List saved peers")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    requireLocalTransport("files peers list");
    const all = listPeers();
    if (opts.json) { console.log(JSON.stringify(all, null, 2)); return; }
    if (!all.length) { console.log(chalk.dim("No peers saved. Run: files peers add <url>")); return; }
    for (const p of all) {
      const auto = p.auto_sync ? chalk.green(` [auto every ${p.sync_interval_minutes}m]`) : "";
      const last = p.last_synced_at ? chalk.dim(` last synced ${p.last_synced_at}`) : chalk.dim(" never synced");
      console.log(`${chalk.bold(p.id)}  ${chalk.cyan(p.url)}  ${p.name || ""}${auto}${last}`);
    }
  });

peers
  .command("add <url>")
  .description("Add a peer machine URL")
  .option("-n, --name <name>", "Peer name")
  .option("--auto", "Enable auto-sync")
  .option("--interval <minutes>", "Auto-sync interval in minutes", "30")
  .action((url: string, opts: { name?: string; auto?: boolean; interval: string }) => {
    requireLocalTransport("files peers add");
    let intervalMinutes: number;
    try {
      intervalMinutes = parseIntFlag(opts.interval, "interval", { min: 1 });
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }
    const peer = addPeer(url, opts.name ?? "", opts.auto ?? false, intervalMinutes);
    console.log(chalk.green(`✓ Peer added: ${peer.id} → ${peer.url}`));
    if (peer.auto_sync) console.log(chalk.dim(`  Auto-sync every ${peer.sync_interval_minutes} minutes`));
  });

peers
  .command("remove <id-or-url>")
  .description("Remove a peer")
  .option("--yes", "Confirm destructive removal")
  .action((idOrUrl: string, opts: { yes?: boolean }) => {
    requireLocalTransport("files peers remove");
    if (!opts.yes) {
      console.error(chalk.red("Refusing to remove peer without --yes (destructive operation)."));
      process.exit(1);
    }
    const ok = removePeer(idOrUrl);
    if (ok) console.log(chalk.green("✓ Peer removed"));
    else console.error(chalk.red(`Peer not found: ${idOrUrl}`));
  });

program
  .command("sync <peer-url...>")
  .description("Sync file index from one or more peer machines (e.g. http://192.168.1.10:19432)")
  .option("--json", "Output as JSON")
  .action(async (peerUrls: string[], opts: { json?: boolean }) => {
    requireLocalTransport("files sync");
    const { syncWithPeers } = await import("../lib/sync.js");
    const results = await syncWithPeers(peerUrls);
    if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
    for (const r of results) {
      if (r.errors.length) {
        console.error(chalk.red(`✗ ${r.peer}: ${r.errors.join(", ")}`));
      } else {
        console.log(chalk.green(`✓ ${r.peer}`) + chalk.dim(` machines:${r.machines_synced} files:${r.files_synced}`));
      }
    }
  });

program
  .command("open <file-id>")
  .description("Open a file in the default application")
  .action((fileId: string) => {
    requireLocalTransport("files open");
    try {
      const file = getFile(requireId(fileId, "files"))!;
      const source = getSource(file.source_id);
      if (!source || source.type !== "local") { console.error(chalk.red("open only works with local sources")); process.exit(1); }
      const fullPath = join(source.path!, file.path);
      Bun.spawn(getOpenCommand(fullPath), { stdout: "inherit", stderr: "inherit" });
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

program
  .command("where <file-id>")
  .description("Print the full absolute path of a file (for shell scripting)")
  .action((fileId: string) => {
    requireLocalTransport("files where");
    try {
      const file = getFile(requireId(fileId, "files"))!;
      const source = getSource(file.source_id);
      if (!source || source.type !== "local") { console.error(chalk.red("where only works with local sources")); process.exit(1); }
      process.stdout.write(join(source.path!, file.path) + "\n");
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

program
  .command("cat <file-id>")
  .description("Print file content to stdout")
  .option("--max-bytes <n>", "Max bytes to read (default: unlimited)", "0")
  .action((fileId: string, opts: { maxBytes: string }) => {
    requireLocalTransport("files cat");
    try {
      const file = getFile(requireId(fileId, "files"))!;
      const source = getSource(file.source_id);
      if (!source || source.type !== "local") { console.error(chalk.red("cat only works with local sources")); process.exit(1); }
      const fullPath = join(source.path!, file.path);

      const maxBytes = parseIntFlag(opts.maxBytes, "max-bytes", { min: 0 });
      const buf = readFileSync(fullPath);
      const slice = maxBytes > 0 ? buf.slice(0, maxBytes) : buf;
      process.stdout.write(slice);
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

program
  .command("extract-text <file-id>")
  .description("Return chunk-ready extracted text metadata for knowledge indexing")
  .option("--json", "Output as JSON")
  .option("--output-file <path>", "Write private extraction JSON to a new owner-only file")
  .option("--max-bytes <n>", "Maximum bytes to read", "1048576")
  .option("--segment-chars <n>", "Maximum characters per segment", "4000")
  .option("--redact <pattern>", "Regex pattern to redact; can be repeated", collectValues, [] as string[])
  .action(async (fileId: string, opts: {
    json?: boolean;
    outputFile?: string;
    maxBytes: string;
    segmentChars: string;
    redact: string[];
  }) => {
    try {
      const maxBytes = parseIntFlag(opts.maxBytes, "max-bytes", { min: 1 });
      const maxSegmentChars = parseIntFlag(opts.segmentChars, "segment-chars", { min: 256 });
      const redactPatterns = opts.redact.map((pattern) => new RegExp(pattern, "g"));
      const files = store();
      const remoteFiles = files instanceof ApiStore ? files : null;
      let output;
      if (files.transport === "api") {
        if (!remoteFiles) throw new Error("Authenticated file-content transport is unavailable.");
        if (!opts.outputFile) {
          throw new Error("Hosted extraction requires --output-file so private text is not written to stdout.");
        }
        output = openSecureOutput(opts.outputFile);
      } else if (opts.outputFile) {
        output = openSecureOutput(opts.outputFile);
      }

      try {
        const result = remoteFiles
          ? await remoteFiles.extractFileText(fileId, {
              max_bytes: maxBytes,
              max_segment_chars: maxSegmentChars,
              redact_patterns: opts.redact,
            })
          : await extractTextFromFile(requireId(fileId, "files"), {
              max_bytes: maxBytes,
              max_segment_chars: maxSegmentChars,
              redact_patterns: redactPatterns,
            });

        if (output) {
          output.write(`${JSON.stringify(result, null, 2)}\n`);
          output.commit();
          if (opts.json) console.log(JSON.stringify({ ok: true }));
          else console.log(chalk.green("✓ Extraction written securely"));
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(chalk.bold(`status: ${result.status}`));
        if (result.status_reason) console.log(chalk.dim(result.status_reason));
        for (const segment of result.segments) {
          if (result.segments.length > 1) {
            console.log(chalk.dim(`\n--- segment ${segment.index + 1}/${result.segments.length} lines ${segment.line_start}-${segment.line_end} bytes ${segment.byte_start}-${segment.byte_end} ---`));
          }
          process.stdout.write(segment.text);
          if (!segment.text.endsWith("\n")) process.stdout.write("\n");
        }
      } catch (error) {
        output?.abort();
        throw error;
      }
    } catch (e) { console.error(chalk.red(remoteContentFailure("extraction", e))); process.exit(1); }
  });

program
  .command("extract-snapshot <file-id>")
  .description("Return a deterministic extraction snapshot for semantic chunking")
  .option("--json", "Output as JSON")
  .option("--max-bytes <n>", "Maximum bytes to read", "1048576")
  .option("--segment-chars <n>", "Maximum characters per source segment", "4000")
  .option("--redact <pattern>", "Regex pattern to redact; can be repeated", collectValues, [] as string[])
  .action(async (fileId: string, opts: {
    json?: boolean;
    maxBytes: string;
    segmentChars: string;
    redact: string[];
  }) => {
    requireLocalTransport("files extract-snapshot");
    try {
      const maxBytes = parseIntFlag(opts.maxBytes, "max-bytes", { min: 1 });
      const maxSegmentChars = parseIntFlag(opts.segmentChars, "segment-chars", { min: 256 });
      const snapshot = await extractTextSnapshotFromFile(requireId(fileId, "files"), {
        max_bytes: maxBytes,
        max_segment_chars: maxSegmentChars,
        redact_patterns: opts.redact.map((pattern) => new RegExp(pattern, "g")),
      });

      if (opts.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }

      console.log(chalk.bold(`snapshot: ${snapshot.snapshot_id}`));
      console.log(`status: ${snapshot.status}`);
      console.log(`hash: ${snapshot.content_hash_algorithm}:${snapshot.content_hash}`);
      console.log(`sections: ${snapshot.sections.length}`);
      for (const section of snapshot.sections) {
        console.log(chalk.dim(`\n--- ${section.title ?? section.id} lines ${section.line_start}-${section.line_end} bytes ${section.byte_start}-${section.byte_end} ---`));
        process.stdout.write(section.text);
        if (!section.text.endsWith("\n")) process.stdout.write("\n");
      }
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

const knowledge = program.command("knowledge").description("Read-only source APIs for knowledge indexing");

knowledge
  .command("manifest")
  .description("Export a read-only source manifest for knowledge indexing")
  .option("--source <id>", "Filter by source id")
  .option("--collection <id>", "Filter by collection id")
  .option("--project <id>", "Filter by project id")
  .option("--tag <name>", "Filter by tag")
  .option("--status <status>", "Filter by file status: active, deleted, moved, all")
  .option("--include-deleted", "Include soft-deleted rows")
  .option("--delta", "Export a delta manifest including tombstones")
  .option("--since-cursor <cursor>", "Delta cursor from a previous manifest")
  .option("--since-sync-version <n>", "Delta from a sync_version")
  .option("--cursor <cursor>", "Page cursor")
  .option("--limit <n>", "Max file rows", "100")
  .option("--format <format>", "Output format: json or jsonl", "json")
  .option("--out <path>", "Write manifest artifact to a local path")
  .option("--include-acl-summary", "Include organization/ACL review summary")
  .option("--include-evidence-assets", "Include evidence asset rows")
  .option("--json", "Output manifest JSON")
  .action(async (opts: {
    source?: string;
    collection?: string;
    project?: string;
    tag?: string;
    status?: string;
    includeDeleted?: boolean;
    delta?: boolean;
    sinceCursor?: string;
    sinceSyncVersion?: string;
    cursor?: string;
    limit: string;
    format: string;
    out?: string;
    includeAclSummary?: boolean;
    includeEvidenceAssets?: boolean;
    json?: boolean;
  }) => {
    requireLocalTransport("files knowledge manifest");
    try {
      const limit = parseIntFlag(opts.limit, "limit", { min: 1 });
      const format = parseManifestFormat(opts.format);
      const manifest = await exportKnowledgeSourceManifest({
        source_id: opts.source,
        collection_id: opts.collection,
        project_id: opts.project,
        tag: opts.tag,
        status: opts.status as any,
        include_deleted: opts.includeDeleted,
        delta: opts.delta,
        since_cursor: opts.sinceCursor,
        since_sync_version: opts.sinceSyncVersion ? parseIntFlag(opts.sinceSyncVersion, "since-sync-version", { min: 0 }) : undefined,
        cursor: opts.cursor,
        limit,
        format,
        output: opts.out ? { provider: "local", path: opts.out, format } : undefined,
        include_acl_summary: opts.includeAclSummary,
        include_evidence_assets: opts.includeEvidenceAssets,
      });

      if (opts.json || format === "json") {
        console.log(JSON.stringify(manifest, null, 2));
        return;
      }

      if (opts.out) {
        console.log(chalk.green(`manifest written: ${manifest.artifact?.path}`));
        console.log(chalk.dim(`items:${manifest.item_count} high_watermark:${manifest.high_watermark}`));
        return;
      }

      process.stdout.write(formatKnowledgeSourceManifest(manifest, format));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

knowledge
  .command("doctor [sourceRefs...]")
  .description("Diagnose open-files source refs for knowledge sync readiness")
  .option("--source <id>", "Diagnose refs from a source manifest")
  .option("--collection <id>", "Filter manifest refs by collection id")
  .option("--project <id>", "Filter manifest refs by project id")
  .option("--tag <name>", "Filter manifest refs by tag")
  .option("--status <status>", "Filter manifest refs by file status: active, deleted, moved, all")
  .option("--limit <n>", "Maximum refs to diagnose", "100")
  .option("--purpose <purpose>", "Purpose label", "knowledge_index")
  .option("--no-extracted-text-required", "Do not flag refs that lack extracted text support")
  .option("--check-extracted-text", "Run a bounded read-only extraction check")
  .option("--max-bytes <n>", "Maximum bytes for extraction check", "262144")
  .option("--segment-chars <n>", "Maximum characters per extracted segment", "4000")
  .option("--json", "Output as JSON")
  .action(async (sourceRefs: string[], opts: {
    source?: string;
    collection?: string;
    project?: string;
    tag?: string;
    status?: string;
    limit: string;
    purpose: string;
    extractedTextRequired?: boolean;
    checkExtractedText?: boolean;
    maxBytes: string;
    segmentChars: string;
    json?: boolean;
  }) => {
    requireLocalTransport("files knowledge doctor");
    try {
      const report = await doctorKnowledgeSources({
        source_refs: sourceRefs,
        source_id: opts.source,
        collection_id: opts.collection,
        project_id: opts.project,
        tag: opts.tag,
        status: opts.status as any,
        limit: parseIntFlag(opts.limit, "limit", { min: 1 }),
        purpose: opts.purpose,
        require_extracted_text: opts.extractedTextRequired,
        check_extracted_text: opts.checkExtractedText,
        max_bytes: parseIntFlag(opts.maxBytes, "max-bytes", { min: 1 }),
        max_segment_chars: parseIntFlag(opts.segmentChars, "segment-chars", { min: 256 }),
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(chalk.bold(`knowledge source doctor: ${report.checked_count} checked`));
      console.log(`ready: ${report.summary.ready}  needs_action: ${report.summary.needs_action}`);
      for (const check of report.checks) {
        const color = check.status === "ready" ? chalk.green : chalk.yellow;
        console.log(color(`${check.status}: ${check.source_ref}`));
        if (check.issue_codes.length) console.log(chalk.dim(`  issues: ${check.issue_codes.join(", ")}`));
        if (check.actions.length) console.log(chalk.dim(`  actions: ${check.actions.join(", ")}`));
        if (check.status_reason) console.log(chalk.dim(`  reason: ${check.status_reason}`));
      }
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

knowledge
  .command("resolve <source-ref>")
  .description("Resolve an open-files:// source ref with read-only policy")
  .option("--mode <mode>", "metadata, content, extracted_text, snapshot, signed_url", "metadata")
  .option("--purpose <purpose>", "Purpose label", "knowledge_index")
  .option("--max-bytes <n>", "Maximum bytes to read", "262144")
  .option("--segment-chars <n>", "Maximum characters per segment", "4000")
  .option("--mime <mime>", "Allowed MIME type; can be repeated", collectValues, [] as string[])
  .option("--allow-binary", "Allow binary MIME types")
  .option("--signed-url-expires <seconds>", "Signed URL expiration seconds", "600")
  .option("--json", "Output as JSON")
  .action(async (sourceRef: string, opts: {
    mode: string;
    purpose: string;
    maxBytes: string;
    segmentChars: string;
    mime: string[];
    allowBinary?: boolean;
    signedUrlExpires: string;
    json?: boolean;
  }) => {
    requireLocalTransport("files knowledge resolve");
    try {
      const mode = parseResolveMode(opts.mode);
      const result = await resolveKnowledgeSourceRef(sourceRef, {
        mode,
        purpose: opts.purpose,
        max_bytes: parseIntFlag(opts.maxBytes, "max-bytes", { min: 1 }),
        max_segment_chars: parseIntFlag(opts.segmentChars, "segment-chars", { min: 256 }),
        allowed_mimes: opts.mime.length > 0 ? opts.mime : undefined,
        allow_binary: opts.allowBinary,
        signed_url_expires_in: parseIntFlag(opts.signedUrlExpires, "signed-url-expires", { min: 1 }),
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.bold(`${result.status}: ${result.source_ref}`));
      if (result.status_reason) console.log(chalk.dim(result.status_reason));
      console.log(`mode: ${mode}`);
      console.log(`mime: ${result.content.mime}`);
      if (result.content.bytes_read !== undefined) console.log(`bytes_read: ${result.content.bytes_read}`);
      if (result.content.extraction?.snapshot_id) console.log(`snapshot: ${result.content.extraction.snapshot_id}`);
      if (result.access?.url) console.log(result.access.url);
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

const knowledgeOutbox = knowledge.command("outbox").description("Poll or acknowledge source change outbox events");

knowledgeOutbox
  .command("poll")
  .description("Poll source change outbox events")
  .option("--consumer <id>", "Consumer checkpoint id")
  .option("--after-cursor <n>", "Poll after cursor")
  .option("--event-type <type>", "Filter event type; can be repeated", collectValues, [] as string[])
  .option("--source <id>", "Filter by source id")
  .option("--file <id>", "Filter by file id")
  .option("--limit <n>", "Max events", "100")
  .option("--json", "Output as JSON")
  .action((opts: {
    consumer?: string;
    afterCursor?: string;
    eventType: string[];
    source?: string;
    file?: string;
    limit: string;
    json?: boolean;
  }) => {
    requireLocalTransport("files knowledge outbox poll");
    try {
      const result = pollKnowledgeSourceOutbox({
        consumer_id: opts.consumer,
        after_cursor: opts.afterCursor ? parseIntFlag(opts.afterCursor, "after-cursor", { min: 0 }) : undefined,
        event_types: opts.eventType.length > 0 ? opts.eventType as any : undefined,
        source_id: opts.source,
        file_id: opts.file,
        limit: parseIntFlag(opts.limit, "limit", { min: 1 }),
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      for (const event of result.events) {
        console.log(`${event.cursor} ${event.event_type} ${event.source_ref ?? event.file_id ?? event.source_id ?? ""}`);
      }
      console.log(chalk.dim(`next_cursor: ${result.next_cursor}${result.has_more ? " (more)" : ""}`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

knowledgeOutbox
  .command("ack <consumer-id> <cursor>")
  .description("Acknowledge source change outbox progress")
  .option("--json", "Output as JSON")
  .action((consumerId: string, cursor: string, opts: { json?: boolean }) => {
    requireLocalTransport("files knowledge outbox ack");
    try {
      const checkpoint = acknowledgeKnowledgeSourceOutbox(
        consumerId,
        parseIntFlag(cursor, "cursor", { min: 0 }),
      );
      if (opts.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
        return;
      }
      console.log(chalk.green(`acknowledged ${checkpoint.consumer_id} at cursor ${checkpoint.cursor}`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

program
  .command("recent")
  .description("Show files most recently touched by agent activity")
  .option("-a, --agent <id>", "Limit to a specific agent")
  .option("-l, --limit <n>", "Max results", "20")
  .option("--json", "Output as JSON")
  .action(async (opts: { agent?: string; limit: string; json?: boolean }) => {
    let limit: number;
    try {
      limit = parseIntFlag(opts.limit, "limit", { min: 1 });
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exit(1);
    }

    // Data-plane read: routed through the Store so the hosted transport
    // reports the service's recent activity, not the local island.
    const files = await store().recentFiles(opts.agent, limit);
    if (opts.json) { console.log(JSON.stringify(files, null, 2)); return; }
    for (const f of files) {
      console.log(`${chalk.bold(f.id)}  ${chalk.cyan(f.name)}  ${formatSize(f.size)}  ${chalk.dim(f.last_touched ?? f.indexed_at)}`);
    }
  });

program
  .command("watch")
  .description("Start file watcher for all local sources (foreground daemon)")
  .action(async () => {
    requireLocalTransport("files watch");
    const machine = getCurrentMachine();
    const { watchSource } = await import("../lib/watcher.js");
    const localSources = listSources(machine.id).filter((s) => s.enabled && s.type === "local");
    if (!localSources.length) { console.log(chalk.dim("No local sources to watch.")); return; }
    for (const s of localSources) {
      watchSource(s, machine.id);
      console.log(chalk.green(`✓ Watching: ${s.name} (${s.path})`));
    }
    console.log(chalk.dim("Press Ctrl+C to stop."));
    await new Promise(() => {}); // keep alive
  });

// ─── config ──────────────────────────────────────────────────────────────────

const config = program.command("config").description("Manage configuration");

config
  .command("list")
  .alias("ls")
  .description("Show all config values")
  .action(() => {
    const cfg = loadConfig();
    console.log(chalk.bold(`\n  Config: ${getConfigPath()}\n`));
    for (const [k, v] of Object.entries(cfg)) {
      console.log(`  ${chalk.cyan(k.padEnd(24))} ${JSON.stringify(v)}`);
    }
    console.log();
  });

config
  .command("get <key>")
  .description("Get a config value")
  .action((key: string) => {
    const cfg = loadConfig();
    const val = cfg[key];
    if (val === undefined) { console.error(chalk.red(`Unknown key: ${key}`)); process.exit(1); }
    console.log(JSON.stringify(val));
  });

config
  .command("set <key> <value>")
  .description("Set a config value (auto_watch, hash_skip_bytes, default_limit, ignore_patterns, google_drive_default_destination_source_id)")
  .action((key: string, value: string) => {
    try {
      setConfigValue(key, value);
      console.log(chalk.green(`✓ ${key} = ${value}`));
    } catch (e) { console.error(chalk.red((e as Error).message)); process.exit(1); }
  });

program
  .command("db")
  .description("Show the on-box SQLite database path (local mode only)")
  .action(() => { requireLocalTransport("files db"); console.log(getDbPath()); });

// ─── utils ───────────────────────────────────────────────────────────────────

function getOpenCommand(fullPath: string): string[] {
  if (process.platform === "darwin") return ["open", fullPath];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", fullPath];
  return ["xdg-open", fullPath];
}

function collectValues(value: string, values: string[]): string[] {
  values.push(value);
  return values;
}

interface ContextPackCliOptions {
  sourceRef: string[];
  maxFiles: string;
  maxExcerpts: string;
  maxExcerptChars: string;
  maxTotalChars: string;
  maxBytesPerFile: string;
  redact: string[];
  out?: string;
  dryRun?: boolean;
}

interface SearchPackCliOptions extends ContextPackCliOptions {
  source?: string;
  machine?: string;
  tag?: string;
  ext?: string;
  scope: string;
  offset: string;
}

function packLimitsFromCli(opts: ContextPackCliOptions): {
  max_files: number;
  max_excerpts: number;
  max_excerpt_chars: number;
  max_total_chars: number;
  max_bytes_per_file: number;
} {
  return {
    max_files: parseIntFlag(opts.maxFiles, "max-files", { min: 1 }),
    max_excerpts: parseIntFlag(opts.maxExcerpts, "max-excerpts", { min: 1 }),
    max_excerpt_chars: parseIntFlag(opts.maxExcerptChars, "max-excerpt-chars", { min: 1 }),
    max_total_chars: parseIntFlag(opts.maxTotalChars, "max-total-chars", { min: 1 }),
    max_bytes_per_file: parseIntFlag(opts.maxBytesPerFile, "max-bytes-per-file", { min: 1 }),
  };
}

function compileRedactions(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, "g");
    } catch (error) {
      throw new Error(`Invalid --redact regex "${pattern}": ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function resolveFileIdForPack(value: string): string {
  try {
    return requireId(value, "files");
  } catch {
    return value;
  }
}

function printContextPack(pack: FilesContextPack, opts: { out?: string; dryRun?: boolean }): void {
  if (!opts.out) {
    process.stdout.write(`${JSON.stringify(pack)}\n`);
    return;
  }

  const body = `${JSON.stringify(pack, null, 2)}\n`;
  const outPath = resolve(opts.out);
  const pointer = {
    pack_id: pack.pack_id,
    dry_run: Boolean(opts.dryRun),
    artifact: {
      provider: "local",
      path: outPath,
      bytes: Buffer.byteLength(body),
      format: "json",
    },
    counts: pack.counts,
    citation_count: pack.citations.length,
    attachment_ref_count: pack.attachment_refs.length,
  };
  if (!opts.dryRun) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, body);
  }
  process.stdout.write(`${JSON.stringify(pointer)}\n`);
}

function parseSearchScope(value: string): SearchScope {
  if (value === "all" || value === "metadata" || value === "content") return value;
  throw new Error("Invalid --scope: expected all, metadata, or content");
}

function parseFileSearchDocumentKind(value: string): FileSearchDocumentKind {
  const kinds: FileSearchDocumentKind[] = [
    "extracted_text",
    "extraction_summary",
    "ocr_text",
    "vision_summary",
    "transcript",
    "llm_summary",
    "semantic_metadata",
    "manual_note",
  ];
  if (kinds.includes(value as FileSearchDocumentKind)) return value as FileSearchDocumentKind;
  throw new Error(`Invalid --kind: expected one of ${kinds.join(", ")}`);
}

function parseFileSearchDocumentStatus(value: string): FileSearchDocumentStatus {
  const statuses: FileSearchDocumentStatus[] = ["ready", "partial", "unsupported", "error", "stale"];
  if (statuses.includes(value as FileSearchDocumentStatus)) return value as FileSearchDocumentStatus;
  throw new Error(`Invalid --status: expected one of ${statuses.join(", ")}`);
}

function readMetadataObject(metadataJson?: string, metadataFile?: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (metadataFile) {
    const path = resolve(metadataFile);
    if (!existsSync(path)) throw new Error(`Metadata file not found: ${metadataFile}`);
    Object.assign(metadata, parseJsonObject(readFileSync(path, "utf8"), "--metadata-file"));
  }
  if (metadataJson) {
    Object.assign(metadata, parseJsonObject(metadataJson, "--metadata-json"));
  }
  return metadata;
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function formatSearchMatch(sources?: string[], kinds?: string[]): string {
  if (!sources?.length) return "";
  const contentKinds = kinds?.length ? `:${kinds.join(",")}` : "";
  return chalk.dim(` [${sources.map((source) => source === "content" ? `content${contentKinds}` : source).join(", ")}]`);
}

function formatSearchDocumentForOutput(document: FileSearchDocument): {
  id: string;
  file_id: string;
  revision_id?: string;
  source_ref: string;
  kind: FileSearchDocumentKind;
  extractor: string;
  content_hash: string;
  status: FileSearchDocumentStatus;
  private: boolean;
  searchable_chars: number;
  metadata_keys: string[];
  created_at: string;
  updated_at: string;
} {
  return {
    id: document.id,
    file_id: document.file_id,
    revision_id: document.revision_id,
    source_ref: document.source_ref,
    kind: document.kind,
    extractor: document.extractor,
    content_hash: document.content_hash,
    status: document.status,
    private: document.private,
    searchable_chars: document.searchable_text.length,
    metadata_keys: Object.keys(document.metadata).sort(),
    created_at: document.created_at,
    updated_at: document.updated_at,
  };
}

function parseIntFlag(value: string, name: string, opts: { min?: number } = {}): number {
  const n = Number(value);
  const min = opts.min ?? 0;
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`Invalid --${name} value "${value}" (must be an integer >= ${min})`);
  }
  return n;
}

function remoteContentFailure(operation: "download" | "extraction", error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : Number.NaN;
  if (Number.isInteger(status) && status >= 400) {
    return `Remote ${operation} failed (HTTP ${status}).`;
  }
  return error instanceof Error ? error.message : `Remote ${operation} failed.`;
}

function parseManifestFormat(value: string): KnowledgeSourceManifestFormat {
  if (value === "json" || value === "jsonl") return value;
  throw new Error("Invalid --format: expected json or jsonl");
}

function parseResolveMode(value: string): KnowledgeSourceResolveMode {
  if (
    value === "metadata"
    || value === "content"
    || value === "extracted_text"
    || value === "snapshot"
    || value === "signed_url"
  ) return value;
  throw new Error("Invalid --mode: expected metadata, content, extracted_text, snapshot, or signed_url");
}

function parseSize(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b)?$/i);
  if (!m) return parseInt(s, 10) || 0;
  const n = parseFloat(m[1]!);
  const unit = (m[2] ?? "b").toLowerCase();
  if (unit === "kb") return Math.floor(n * 1024);
  if (unit === "mb") return Math.floor(n * 1024 ** 2);
  if (unit === "gb") return Math.floor(n * 1024 ** 3);
  return Math.floor(n);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

// remove — alias for sources remove (consistent with open-* CLI conventions)
program
  .command("remove <source-id>")
  .description("Remove a source and all its indexed files (alias for sources remove)")
  .option("--yes", "Confirm destructive removal")
  .action(async (id: string, opts: { yes?: boolean }) => {
    if (!opts.yes) {
      console.error(chalk.red("Refusing to remove source without --yes (destructive operation)."));
      process.exit(1);
    }
    const ok = await store().deleteSource(id);
    if (ok) console.log(chalk.green(`✓ Source ${id} removed`));
    else { console.error(chalk.red(`Source not found: ${id}`)); process.exit(1); }
  });

// ─── transport gate (fail closed) ───────────────────────────────────────────
// Every command action runs only when the client transport resolves: either
// the @hasna/contracts chain supplies a hosted credential (the Keychain item
// hasna.credentials.files.api-key, ~/.hasna/files/config/credentials, or
// HASNA_FILES_API_KEY; the authority defaults to the fleet gateway
// https://api.hasna.com/files), or the operator explicitly opted in to the
// on-box SQLite store (HASNA_FILES_LOCAL=1 / FILES_LOCAL=1 — the retired
// *_MODE switches are gone). Running WITHOUT either fails closed before any
// command body executes — no silent local `~/.hasna/files/files.db` session,
// no false-green exit 0 — and a local run prints one "LOCAL mode" line on
// stderr so it is never mistaken for an empty hosted run. `--help` and
// `--version` are handled by commander and never reach an action, so they keep
// working unconfigured.
program.hook("preAction", () => {
  let storage;
  try {
    storage = resolveFilesCloudStorage();
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
  if (!storage.active) announceFilesLocalMode();
});

await program.parseAsync().catch(async (error: unknown) => {
  // Any command action that rejects (e.g. a HasnaHttpError from the cloud
  // transport) surfaces here as a single clean line — never a raw stack trace.
  await writeStderrLine(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

async function writeStdoutLine(line: string): Promise<void> {
  await writeStandardStreamLine(process.stdout, line);
}

async function writeStderrLine(line: string): Promise<void> {
  await writeStandardStreamLine(process.stderr, line);
}

function writeStandardStreamLine(stream: NodeJS.WriteStream, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => stream.off("error", onError);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    stream.once("error", onError);
    stream.write(`${line}\n`, (error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    });
  });
}
