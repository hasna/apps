import { afterEach, describe, expect, test } from "bun:test";
import {
  MACHINES_BACKUP_BUCKET_ENV,
  MACHINES_BACKUP_BUCKET_FALLBACK_ENV,
  MACHINES_BACKUP_PREFIX_ENV,
  MACHINES_BACKUP_PREFIX_FALLBACK_ENV,
  buildBackupPlan,
  resolveBackupTarget,
  runBackup,
} from "../src/commands/backup.js";

const ENV_KEYS = [
  MACHINES_BACKUP_BUCKET_ENV,
  MACHINES_BACKUP_BUCKET_FALLBACK_ENV,
  MACHINES_BACKUP_PREFIX_ENV,
  MACHINES_BACKUP_PREFIX_FALLBACK_ENV,
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("backup planning", () => {
  test("builds archive and upload steps", () => {
    const plan = buildBackupPlan("fleet-backups", "machines");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.command).toContain("tar -czf");
    expect(plan.steps[1]?.command).toContain("aws s3 cp");
  });

  test("requires confirmation to execute", () => {
    expect(() => runBackup("fleet-backups", "machines", { apply: true, yes: false })).toThrow("Backup execution requires --yes.");
  });

  test("resolves backup bucket from canonical env while preserving explicit override", () => {
    process.env[MACHINES_BACKUP_BUCKET_ENV] = "primary-machine-backups";
    process.env[MACHINES_BACKUP_PREFIX_ENV] = "orgs/example/machines";

    expect(resolveBackupTarget()).toMatchObject({
      bucket: "primary-machine-backups",
      prefix: "orgs/example/machines",
      bucketSource: MACHINES_BACKUP_BUCKET_ENV,
      prefixSource: MACHINES_BACKUP_PREFIX_ENV,
    });

    expect(resolveBackupTarget({ bucket: "customer-backups", prefix: "machines" })).toMatchObject({
      bucket: "customer-backups",
      prefix: "machines",
      bucketSource: "argument",
      prefixSource: "argument",
    });
  });

  test("uses fallback env and clear missing-bucket error", () => {
    expect(() => resolveBackupTarget()).toThrow("Missing S3 backup bucket");

    process.env[MACHINES_BACKUP_BUCKET_FALLBACK_ENV] = "fleet-backups";
    const plan = buildBackupPlan();
    expect(plan.steps[1]?.command).toContain("s3://fleet-backups/machines/");
    expect(plan.steps[1]?.command).toContain("'s3://fleet-backups/machines/");
  });
});
