import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanFile,
  shannonEntropy,
  SECRET_PATTERNS,
  walkDirectory,
  isBinaryFile,
  getCodeSnippet,
  secretsScanner,
} from "./secrets.js";
import { ScannerType, Severity } from "../types/index.js";

describe("secrets scanner", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "secrets-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // --- scanFile unit tests ---

  describe("scanFile", () => {
    test("detects AWS access key", () => {
      const content = 'const key = "AKIAIOSFODNN7EXAMPLE";';
      const findings = scanFile("test.ts", content);
      const awsFinding = findings.find((f) => f.rule_id === "aws-access-key");
      expect(awsFinding).toBeDefined();
      expect(awsFinding!.severity).toBe(Severity.Critical);
    });

    test("detects AWS secret key", () => {
      const content = 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
      const findings = scanFile("config.txt", content);
      const awsFinding = findings.find((f) => f.rule_id === "aws-secret-key");
      expect(awsFinding).toBeDefined();
      expect(awsFinding!.severity).toBe(Severity.Critical);
    });

    test("detects GitHub personal access token (ghp_)", () => {
      const content = 'const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";';
      const findings = scanFile("test.ts", content);
      const ghFinding = findings.find((f) => f.rule_id === "github-token");
      expect(ghFinding).toBeDefined();
      expect(ghFinding!.severity).toBe(Severity.Critical);
    });

    test("detects GitHub PAT (github_pat_)", () => {
      const content = 'const token = "github_pat_ABCDEFGHIJKLMNOPQRSTUVWXY";';
      const findings = scanFile("test.ts", content);
      const ghFinding = findings.find((f) => f.rule_id === "github-token");
      expect(ghFinding).toBeDefined();
    });

    test("detects Stripe secret key", () => {
      // Build the token via concatenation so GitHub push protection doesn't flag this test file
      const prefix = "sk_" + "live_";
      const content = `const stripe = "${prefix}FAKEKEYFORTESTING1234567890ab";`;
      const findings = scanFile("billing.ts", content);
      const stripeFinding = findings.find((f) => f.rule_id === "stripe-secret-key");
      expect(stripeFinding).toBeDefined();
      expect(stripeFinding!.severity).toBe(Severity.Critical);
    });

    test("detects Stripe publishable key with medium severity", () => {
      // Build the token via concatenation so GitHub push protection doesn't flag this test file
      const prefix = "pk_" + "live_";
      const content = `const pk = "${prefix}FAKEKEYFORTESTING1234567890ab";`;
      const findings = scanFile("billing.ts", content);
      const stripeFinding = findings.find((f) => f.rule_id === "stripe-publishable-key");
      expect(stripeFinding).toBeDefined();
      expect(stripeFinding!.severity).toBe(Severity.Medium);
    });

    test("detects generic API key", () => {
      const content = 'api_key = "abcdef1234567890abcdef"';
      const findings = scanFile("config.ts", content);
      const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFinding).toBeDefined();
      expect(apiKeyFinding!.severity).toBe(Severity.High);
    });

    test("detects private key header", () => {
      const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...";
      const findings = scanFile("key.pem", content);
      const pkFinding = findings.find((f) => f.rule_id === "private-key");
      expect(pkFinding).toBeDefined();
      expect(pkFinding!.severity).toBe(Severity.Critical);
    });

    test("detects JWT tokens", () => {
      const content =
        'const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";';
      const findings = scanFile("auth.ts", content);
      const jwtFinding = findings.find((f) => f.rule_id === "jwt-token");
      expect(jwtFinding).toBeDefined();
      expect(jwtFinding!.severity).toBe(Severity.High);
    });

    test("detects Slack tokens", () => {
      // Build the token via concatenation so GitHub push protection doesn't flag this test file
      const prefix = "xox" + "b-";
      const content = `const slack = "${prefix}FAKE-TOKEN-FOR-TESTING-1234567890abcdef";`;
      const findings = scanFile("bot.ts", content);
      const slackFinding = findings.find((f) => f.rule_id === "slack-token");
      expect(slackFinding).toBeDefined();
      expect(slackFinding!.severity).toBe(Severity.Critical);
    });

    test("detects database URLs", () => {
      const content = 'const db = "postgres://user:pass@localhost:5432/mydb";';
      const findings = scanFile("db.ts", content);
      const dbFinding = findings.find((f) => f.rule_id === "database-url");
      expect(dbFinding).toBeDefined();
      expect(dbFinding!.severity).toBe(Severity.High);
    });

    test("detects MongoDB connection string", () => {
      const content = 'const db = "mongodb+srv://user:pass@cluster.example.net/db";';
      const findings = scanFile("db.ts", content);
      const dbFinding = findings.find((f) => f.rule_id === "database-url");
      expect(dbFinding).toBeDefined();
    });

    test("clean file produces no findings from patterns", () => {
      const content = `
const name = "hello world";
const count = 42;
function greet() { return "hi"; }
`;
      const findings = scanFile("clean.ts", content);
      // Filter out entropy-based findings (random strings in the test might trigger)
      const patternFindings = findings.filter(
        (f) => f.rule_id !== "high-entropy-hex" && f.rule_id !== "high-entropy-base64",
      );
      expect(patternFindings.length).toBe(0);
    });

    test("reports correct line number and column", () => {
      const content = "line 1\nline 2\nconst key = \"AKIAIOSFODNN7EXAMPLE\";\nline 4";
      const findings = scanFile("test.ts", content);
      const awsFinding = findings.find((f) => f.rule_id === "aws-access-key");
      expect(awsFinding).toBeDefined();
      expect(awsFinding!.line).toBe(3);
      expect(awsFinding!.column).toBeGreaterThan(0);
    });

    test("includes code snippet in findings", () => {
      const content = "line 1\nline 2\nconst key = \"AKIAIOSFODNN7EXAMPLE\";\nline 4";
      const findings = scanFile("test.ts", content);
      const awsFinding = findings.find((f) => f.rule_id === "aws-access-key");
      expect(awsFinding!.code_snippet).toBeDefined();
      expect(awsFinding!.code_snippet).toContain("AKIAIOSFODNN7EXAMPLE");
    });
  });

  // --- Shannon entropy ---

  describe("shannonEntropy", () => {
    test("returns 0 for empty string", () => {
      expect(shannonEntropy("")).toBe(0);
    });

    test("returns 0 for single character repeated", () => {
      expect(shannonEntropy("aaaa")).toBe(0);
    });

    test("returns higher entropy for random-looking strings", () => {
      const low = shannonEntropy("aaaaaa");
      const high = shannonEntropy("a1b2c3d4e5f6");
      expect(high).toBeGreaterThan(low);
    });

    test("maximum entropy for uniform distribution", () => {
      // 2 equally distributed chars -> entropy = 1
      const entropy = shannonEntropy("ab");
      expect(entropy).toBeCloseTo(1.0, 5);
    });
  });

  // --- Helper functions ---

  describe("isBinaryFile", () => {
    test("identifies binary extensions", () => {
      expect(isBinaryFile("image.png")).toBe(true);
      expect(isBinaryFile("video.mp4")).toBe(true);
      expect(isBinaryFile("archive.zip")).toBe(true);
      expect(isBinaryFile("data.sqlite")).toBe(true);
    });

    test("identifies non-binary extensions", () => {
      expect(isBinaryFile("code.ts")).toBe(false);
      expect(isBinaryFile("style.css")).toBe(false);
      expect(isBinaryFile("data.json")).toBe(false);
    });
  });

  describe("walkDirectory", () => {
    test("lists files in directory", () => {
      writeFileSync(join(tempDir, "file1.ts"), "content");
      writeFileSync(join(tempDir, "file2.js"), "content");

      const files = walkDirectory(tempDir, []);
      expect(files.length).toBe(2);
    });

    test("ignores specified patterns", () => {
      mkdirSync(join(tempDir, "node_modules"), { recursive: true });
      writeFileSync(join(tempDir, "node_modules", "dep.js"), "content");
      writeFileSync(join(tempDir, "app.ts"), "content");

      const files = walkDirectory(tempDir, ["node_modules"]);
      expect(files.length).toBe(1);
      expect(files[0]).toContain("app.ts");
    });

    test("skips binary files", () => {
      writeFileSync(join(tempDir, "image.png"), "binary");
      writeFileSync(join(tempDir, "code.ts"), "content");

      const files = walkDirectory(tempDir, []);
      expect(files.length).toBe(1);
      expect(files[0]).toContain("code.ts");
    });

    test("applies file filter", () => {
      writeFileSync(join(tempDir, "a.ts"), "content");
      writeFileSync(join(tempDir, "b.js"), "content");

      const files = walkDirectory(tempDir, [], (f) => f.endsWith(".ts"));
      expect(files.length).toBe(1);
      expect(files[0]).toContain("a.ts");
    });

    test("recurses into subdirectories", () => {
      mkdirSync(join(tempDir, "sub"), { recursive: true });
      writeFileSync(join(tempDir, "sub", "deep.ts"), "content");

      const files = walkDirectory(tempDir, []);
      expect(files.length).toBe(1);
      expect(files[0]).toContain("deep.ts");
    });
  });

  describe("getCodeSnippet", () => {
    test("returns snippet with context lines", () => {
      const content = "line1\nline2\nline3\nline4\nline5";
      const snippet = getCodeSnippet(content, 3, 1);
      expect(snippet).toContain("line2");
      expect(snippet).toContain("line3");
      expect(snippet).toContain("line4");
    });

    test("marks the target line with >", () => {
      const content = "line1\nline2\nline3";
      const snippet = getCodeSnippet(content, 2, 0);
      expect(snippet).toContain("> 2:");
    });

    test("handles first line correctly", () => {
      const content = "line1\nline2\nline3";
      const snippet = getCodeSnippet(content, 1, 1);
      expect(snippet).toContain("line1");
      expect(snippet).toContain("line2");
    });
  });

  // --- Full scanner integration test ---

  describe("secretsScanner.scan", () => {
    test("scans directory and finds secrets", async () => {
      writeFileSync(
        join(tempDir, "config.ts"),
        'const key = "AKIAIOSFODNN7EXAMPLE";\n',
      );
      writeFileSync(join(tempDir, "clean.ts"), 'const x = "hello";\n');

      const findings = await secretsScanner.scan(tempDir);
      const awsFindings = findings.filter((f) => f.rule_id === "aws-access-key");
      expect(awsFindings.length).toBe(1);
      expect(awsFindings[0].file).toBe("config.ts");
    });

    test("respects ignore patterns", async () => {
      mkdirSync(join(tempDir, "vendor"), { recursive: true });
      writeFileSync(
        join(tempDir, "vendor", "leaked.ts"),
        'const key = "AKIAIOSFODNN7EXAMPLE";\n',
      );

      const findings = await secretsScanner.scan(tempDir, {
        ignore_patterns: ["vendor"],
      });
      expect(findings.length).toBe(0);
    });

    test("returns empty array for clean directory", async () => {
      writeFileSync(join(tempDir, "clean.ts"), "const x = 1;\nconst y = 2;\n");

      const findings = await secretsScanner.scan(tempDir);
      expect(findings.length).toBe(0);
    });
  });
});
