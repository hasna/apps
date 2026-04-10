import { describe, expect, test } from "bun:test";
import { buildBackupPlan, runBackup } from "../src/commands/backup.js";

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
});
