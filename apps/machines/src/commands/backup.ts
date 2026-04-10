import { homedir } from "node:os";
import { join } from "node:path";
import type { SetupResult, SetupStep } from "../types.js";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function defaultBackupSources(): string[] {
  const home = homedir();
  return [
    join(home, ".hasna"),
    join(home, ".ssh"),
    join(home, ".secrets"),
  ];
}

export function buildBackupPlan(bucket: string, prefix = "machines"): SetupResult {
  const archivePath = join(homedir(), ".hasna", "machines", "backup.tgz");
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
      command: `aws s3 cp ${quote(archivePath)} s3://${bucket}/${prefix}/$(hostname)-backup.tgz`,
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

export function runBackup(bucket: string, prefix = "machines", options: { apply?: boolean; yes?: boolean } = {}): SetupResult {
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
