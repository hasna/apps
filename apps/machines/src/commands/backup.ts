import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { getDataDir } from "../paths.js";
import type { SetupResult, SetupStep } from "../types.js";

export const MACHINES_BACKUP_BUCKET_ENV = "HASNA_MACHINES_S3_BUCKET";
export const MACHINES_BACKUP_BUCKET_FALLBACK_ENV = "MACHINES_S3_BUCKET";
export const MACHINES_BACKUP_PREFIX_ENV = "HASNA_MACHINES_S3_PREFIX";
export const MACHINES_BACKUP_PREFIX_FALLBACK_ENV = "MACHINES_S3_PREFIX";
export const DEFAULT_BACKUP_PREFIX = "machines";

export interface BackupTarget {
  bucket: string;
  prefix: string;
  bucketSource: "argument" | typeof MACHINES_BACKUP_BUCKET_ENV | typeof MACHINES_BACKUP_BUCKET_FALLBACK_ENV;
  prefixSource: "argument" | typeof MACHINES_BACKUP_PREFIX_ENV | typeof MACHINES_BACKUP_PREFIX_FALLBACK_ENV | "default";
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readBackupBucketEnv(): Pick<BackupTarget, "bucket" | "bucketSource"> | null {
  const primary = readEnv(MACHINES_BACKUP_BUCKET_ENV);
  if (primary) return { bucket: primary, bucketSource: MACHINES_BACKUP_BUCKET_ENV };
  const fallback = readEnv(MACHINES_BACKUP_BUCKET_FALLBACK_ENV);
  if (fallback) return { bucket: fallback, bucketSource: MACHINES_BACKUP_BUCKET_FALLBACK_ENV };
  return null;
}

function readBackupPrefixEnv(): Pick<BackupTarget, "prefix" | "prefixSource"> | null {
  const primary = readEnv(MACHINES_BACKUP_PREFIX_ENV);
  if (primary) return { prefix: primary, prefixSource: MACHINES_BACKUP_PREFIX_ENV };
  const fallback = readEnv(MACHINES_BACKUP_PREFIX_FALLBACK_ENV);
  if (fallback) return { prefix: fallback, prefixSource: MACHINES_BACKUP_PREFIX_FALLBACK_ENV };
  return null;
}

export function resolveBackupTarget(options: { bucket?: string; prefix?: string } = {}): BackupTarget {
  const explicitBucket = options.bucket?.trim();
  const envBucket = explicitBucket ? null : readBackupBucketEnv();
  const bucket = explicitBucket || envBucket?.bucket;

  if (!bucket) {
    throw new Error(
      `Missing S3 backup bucket. Pass --bucket or set ${MACHINES_BACKUP_BUCKET_ENV} or ${MACHINES_BACKUP_BUCKET_FALLBACK_ENV}.`,
    );
  }

  const explicitPrefix = options.prefix?.trim();
  const envPrefix = explicitPrefix ? null : readBackupPrefixEnv();

  return {
    bucket,
    prefix: explicitPrefix || envPrefix?.prefix || DEFAULT_BACKUP_PREFIX,
    bucketSource: explicitBucket ? "argument" : envBucket!.bucketSource,
    prefixSource: explicitPrefix ? "argument" : envPrefix?.prefixSource || "default",
  };
}

function defaultBackupSources(): string[] {
  const home = homedir();
  return [
    join(home, ".hasna"),
    join(home, ".ssh"),
    join(home, ".secrets"),
  ];
}

export function buildBackupPlan(bucket?: string, prefix?: string): SetupResult {
  const target = resolveBackupTarget({ bucket, prefix });
  const archivePath = join(getDataDir(), "backup.tgz");
  const sources = defaultBackupSources();
  const steps: SetupStep[] = [
    {
      id: "backup-archive",
      title: "Create compressed machine backup archive",
      command: `tar -czf ${quote(archivePath)} ${sources.map((source) => quote(source)).join(" ")}`,
      manager: "shell",
    },
    {
      id: "backup-upload",
      title: "Upload archive to S3",
      command: `aws s3 cp ${quote(archivePath)} ${quote(`s3://${target.bucket}/${target.prefix}/${hostname()}-backup.tgz`)}`,
      manager: "custom",
    },
  ];

  return {
    machineId: process.env["HASNA_MACHINES_MACHINE_ID"] || "local",
    mode: "plan",
    steps,
    executed: 0,
  };
}

export function runBackup(bucket?: string, prefix?: string, options: { apply?: boolean; yes?: boolean } = {}): SetupResult {
  const plan = buildBackupPlan(bucket, prefix);
  if (!options.apply) return plan;
  if (!options.yes) {
    throw new Error("Backup execution requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    const result = Bun.spawnSync(["bash", "-lc", step.command], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Backup step failed (${step.id}): ${result.stderr.toString().trim()}`);
    }
    executed += 1;
  }

  return {
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  };
}
