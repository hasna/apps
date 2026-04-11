import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { runDoctor } from "../src/commands/doctor.js";

describe("doctor", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_DB_PATH"];
    delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
  });

  test("reports local machine checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-doctor-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    manifestInit();
    manifestAdd({ id: "spark01", platform: "linux", workspacePath: "/home/hasna/workspace" });
    writeFileSync(process.env["HASNA_MACHINES_DB_PATH"]!, "", "utf8");
    writeFileSync(process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"]!, "{}", "utf8");

    const report = runDoctor("spark01");
    expect(report.machineId).toBe("spark01");
    expect(report.checks.some((check) => check.id === "bun")).toBe(true);
    expect(report.checks.some((check) => check.id === "manifest-entry" && check.status === "ok")).toBe(true);
  });
});
