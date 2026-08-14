import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  filterFleetPackageLeaksBySeverity,
  scanFleetPackageLeaks,
} from "./fleet-package-leak.js";
import { Severity } from "../types/index.js";

describe("fleet package leak preset", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fleet-package-leak-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("reports private fleet package indicators without returning matched values", () => {
    const githubToken = "ghp" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab";
    writeFileSync(
      join(tempDir, "manifest.json"),
      [
        "{",
        "  \"host\": \"machine001\",",
        "  \"serialNumber\": \"SYNTHETIC-SERIAL\",",
        "  \"path\": \"/home/hasna/.hasna/machines/machines.db\",",
        `  "token": "${githubToken}"`,
        "}",
      ].join("\n"),
      "utf-8",
    );

    const result = scanFleetPackageLeaks({ path: tempDir });

    expect(result.summary.total).toBeGreaterThanOrEqual(4);
    expect(result.summary.critical).toBeGreaterThan(0);
    expect(result.safety.includes_secret_values).toBe(false);
    expect(JSON.stringify(result.findings)).not.toContain(githubToken);
    expect(result.findings.map((finding) => finding.rule_id)).toContain("fleet-raw-machine-hostname");
    expect(result.findings.map((finding) => finding.rule_id)).toContain("fleet-serial-number-field");
  });

  test("ignores dependency/build artifacts and supports severity filtering", () => {
    mkdirSync(join(tempDir, "node_modules"), { recursive: true });
    writeFileSync(join(tempDir, "node_modules", "bad.txt"), "machine001\n", "utf-8");
    writeFileSync(join(tempDir, "safe.json"), "{\"machine\":\"example-laptop\",\"secretRef\":\"secrets://fleet/example\"}\n", "utf-8");
    writeFileSync(join(tempDir, "serial.json"), "{\"serial_number\":\"REDACTED\"}\n", "utf-8");

    const result = scanFleetPackageLeaks({ path: tempDir });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].rule_id).toBe("fleet-serial-number-field");

    const high = filterFleetPackageLeaksBySeverity(result.findings, Severity.High);
    expect(high).toHaveLength(0);
  });
});
