import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setupTestDb } from "../db/test-helpers.js";
import { createAdvisory } from "../db/advisories.js";
import { lockfileScanner } from "./lockfile.js";
import { AttackType, Ecosystem, ScannerType, Severity } from "../types/index.js";

describe("lockfile forensics scanner", () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lockfile-test-"));
    cleanup = setupTestDb();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    cleanup();
  });

  test("scanner has correct metadata", () => {
    expect(lockfileScanner.name).toBe("Lockfile Forensics Scanner");
    expect(lockfileScanner.type).toBe(ScannerType.Lockfile);
  });

  test("detects missing lockfile", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: { "express": "^5.0.0" },
    }));
    const findings = await lockfileScanner.scan(tempDir);
    const missing = findings.find((f) => f.rule_id === "lockfile-missing");
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe(Severity.High);
    expect(missing!.message).toContain("NO LOCKFILE FOUND");
  });

  test("detects unpinned critical packages with caret range", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: {
        "express": "^5.1.0",
        "react": "^19.0.0",
        "openai": "^4.86.0",
      },
    }, null, 2));
    // Create a dummy lockfile so the "missing lockfile" check doesn't fire
    writeFileSync(join(tempDir, "bun.lock"), "{}");

    const findings = await lockfileScanner.scan(tempDir);
    const unpinned = findings.filter((f) => f.rule_id === "lockfile-unpinned-critical");
    expect(unpinned.length).toBeGreaterThanOrEqual(3);
    for (const f of unpinned) {
      expect(f.severity).toBe(Severity.High);
    }
  });

  test("detects wildcard/latest version ranges", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: {
        "some-pkg": "*",
        "another-pkg": "latest",
      },
    }, null, 2));
    writeFileSync(join(tempDir, "bun.lock"), "{}");

    const findings = await lockfileScanner.scan(tempDir);
    const wildcards = findings.filter((f) => f.rule_id === "lockfile-wildcard-range");
    expect(wildcards.length).toBe(2);
    expect(wildcards[0].severity).toBe(Severity.High);
  });

  test("detects compromised version in package-lock.json", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: { "axios": "1.14.1" },
    }));
    writeFileSync(join(tempDir, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/axios": { version: "1.14.1" },
        "node_modules/express": { version: "5.1.0" },
      },
    }));

    const findings = await lockfileScanner.scan(tempDir);
    const compromised = findings.find((f) => f.rule_id.startsWith("lockfile-compromised"));
    expect(compromised).toBeDefined();
    expect(compromised!.severity).toBe(Severity.Critical);
    expect(compromised!.message).toContain("COMPROMISED VERSION IN LOCKFILE");
    expect(compromised!.message).toContain("axios@1.14.1");
  });

  test("does not flag safe locked versions", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: { "axios": "1.13.6" },
    }));
    writeFileSync(join(tempDir, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/axios": { version: "1.13.6" },
      },
    }));

    const findings = await lockfileScanner.scan(tempDir);
    const compromised = findings.filter((f) => f.rule_id.startsWith("lockfile-compromised"));
    expect(compromised.length).toBe(0);
  });

  test("returns empty for directory without package.json", async () => {
    writeFileSync(join(tempDir, "README.md"), "# Hello");
    const findings = await lockfileScanner.scan(tempDir);
    expect(findings.length).toBe(0);
  });

  test("flags axios with known advisory for unpinned range", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: {
        "axios": "^1.13.0",
      },
    }, null, 2));
    writeFileSync(join(tempDir, "bun.lock"), "{}");

    const findings = await lockfileScanner.scan(tempDir);
    const axiosFindings = findings.filter((f) => f.message.includes("axios") && f.message.includes("ADVISORY"));
    expect(axiosFindings.length).toBeGreaterThanOrEqual(1);
    expect(axiosFindings[0].severity).toBe(Severity.Critical);
  });

  test("detects compromised version in yarn.lock", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { "axios": "1.14.1" } }));
    writeFileSync(join(tempDir, "yarn.lock"), `
# yarn lockfile v1
"axios@1.14.1":
  version "1.14.1"
  resolved "https://registry.yarnpkg.com/axios/-/axios-1.14.1.tgz#abc"
  integrity sha512-abc==
`);

    const findings = await lockfileScanner.scan(tempDir);
    const compromised = findings.find((f) => f.rule_id.startsWith("lockfile-compromised") && f.message.includes("axios@1.14.1"));
    expect(compromised).toBeDefined();
    expect(compromised!.severity).toBe(Severity.Critical);
  });

  test("detects compromised scoped package in yarn.lock", async () => {
    createAdvisory({
      package_name: "@scope/malware",
      ecosystem: Ecosystem.Npm,
      affected_versions: ["1.2.3"],
      safe_versions: ["1.2.4"],
      attack_type: AttackType.MaliciousPackage,
      severity: Severity.Critical,
      title: "Scoped malware test advisory",
      description: "Test advisory for scoped package lockfile parsing",
      source: "https://example.com/advisory",
    });
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { "@scope/malware": "1.2.3" } }));
    writeFileSync(join(tempDir, "yarn.lock"), `
# yarn lockfile v1
"@scope/malware@1.2.3":
  version "1.2.3"
  resolved "https://registry.yarnpkg.com/@scope/malware/-/malware-1.2.3.tgz#abc"
  integrity sha512-abc==
`);

    const findings = await lockfileScanner.scan(tempDir);
    const compromised = findings.find((f) =>
      f.rule_id.startsWith("lockfile-compromised") && f.message.includes("@scope/malware@1.2.3")
    );
    expect(compromised).toBeDefined();
    expect(compromised!.severity).toBe(Severity.Critical);
  });

  test("detects compromised version in pnpm-lock.yaml", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { "axios": "1.14.1" } }));
    writeFileSync(join(tempDir, "pnpm-lock.yaml"), `
lockfileVersion: '6.0'
packages:
  /axios@1.14.1:
    resolution: {integrity: sha512-abc}
    engines: {node: '>= 12.0.0'}
`);

    const findings = await lockfileScanner.scan(tempDir);
    const compromised = findings.find((f) => f.rule_id.startsWith("lockfile-compromised") && f.message.includes("axios"));
    expect(compromised).toBeDefined();
  });

  test("detects compromised scoped package in pnpm-lock.yaml", async () => {
    createAdvisory({
      package_name: "@scope/malware",
      ecosystem: Ecosystem.Npm,
      affected_versions: ["1.2.3"],
      safe_versions: ["1.2.4"],
      attack_type: AttackType.MaliciousPackage,
      severity: Severity.Critical,
      title: "Scoped malware test advisory",
      description: "Test advisory for scoped package lockfile parsing",
      source: "https://example.com/advisory",
    });
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { "@scope/malware": "1.2.3" } }));
    writeFileSync(join(tempDir, "pnpm-lock.yaml"), `
lockfileVersion: '6.0'
packages:
  /@scope/malware@1.2.3:
    resolution: {integrity: sha512-abc}
`);

    const findings = await lockfileScanner.scan(tempDir);
    const compromised = findings.find((f) =>
      f.rule_id.startsWith("lockfile-compromised") && f.message.includes("@scope/malware@1.2.3")
    );
    expect(compromised).toBeDefined();
    expect(compromised!.severity).toBe(Severity.Critical);
  });

  test("detects compromised in package-lock.json v1/v2 format (dependencies key)", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { "axios": "1.14.1" } }));
    writeFileSync(join(tempDir, "package-lock.json"), JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        "axios": { version: "1.14.1", integrity: "sha512-abc" },
      },
    }));

    const findings = await lockfileScanner.scan(tempDir);
    const compromised = findings.find((f) => f.rule_id.startsWith("lockfile-compromised") && f.message.includes("axios@1.14.1"));
    expect(compromised).toBeDefined();
    expect(compromised!.severity).toBe(Severity.Critical);
  });

  test("detects compromised transitive package-lock.json packages entries", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { "parent": "1.0.0" } }));
    writeFileSync(join(tempDir, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/parent": { version: "1.0.0" },
        "node_modules/parent/node_modules/axios": { version: "1.14.1" },
      },
    }));

    const findings = await lockfileScanner.scan(tempDir);
    const compromised = findings.find((f) =>
      f.rule_id.startsWith("lockfile-compromised") && f.message.includes("axios@1.14.1")
    );
    expect(compromised).toBeDefined();
    expect(compromised!.severity).toBe(Severity.Critical);
  });

  test("preserves scoped package-lock.json names whose scope contains node_modules", async () => {
    createAdvisory({
      package_name: "@node_modules/malware",
      ecosystem: Ecosystem.Npm,
      affected_versions: ["1.2.3"],
      safe_versions: ["1.2.4"],
      attack_type: AttackType.MaliciousPackage,
      severity: Severity.Critical,
      title: "Scoped node_modules advisory",
      description: "Test advisory for package-lock path parsing",
      source: "https://example.com/advisory",
    });
    createAdvisory({
      package_name: "@my-node_modules/malware",
      ecosystem: Ecosystem.Npm,
      affected_versions: ["2.0.0"],
      safe_versions: ["2.0.1"],
      attack_type: AttackType.MaliciousPackage,
      severity: Severity.Critical,
      title: "Scoped my-node_modules advisory",
      description: "Test advisory for nested package-lock path parsing",
      source: "https://example.com/advisory",
    });

    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: {
        "@node_modules/malware": "1.2.3",
        "parent": "1.0.0",
      },
    }));
    writeFileSync(join(tempDir, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/@node_modules/malware": { version: "1.2.3" },
        "node_modules/parent": { version: "1.0.0" },
        "node_modules/parent/node_modules/@my-node_modules/malware": { version: "2.0.0" },
      },
    }));

    const findings = await lockfileScanner.scan(tempDir);
    const messages = findings
      .filter((f) => f.rule_id.startsWith("lockfile-compromised"))
      .map((f) => f.message);
    expect(messages.some((message) => message.includes("@node_modules/malware@1.2.3"))).toBe(true);
    expect(messages.some((message) => message.includes("@my-node_modules/malware@2.0.0"))).toBe(true);
  });
});
