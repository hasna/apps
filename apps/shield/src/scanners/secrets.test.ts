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
    test("verifies the real workflow path before exempting an exact action pin", async () => {
      const revision = "0123456789abcdef".repeat(3).slice(0, 40);
      const workflowDirectory = join(tempDir, ".github", "workflows");
      mkdirSync(workflowDirectory, { recursive: true });
      const workflow = join(workflowDirectory, "ci.yml");
      const ordinary = join(tempDir, "config.yml");
      const content = `- uses: synthetic/action@${revision}`;
      writeFileSync(workflow, content);
      writeFileSync(ordinary, content);

      expect(await secretsScanner.scan(workflow)).toEqual([]);
      expect((await secretsScanner.scan(ordinary)).some(
        (finding) => finding.rule_id === "high-entropy-hex",
      )).toBe(true);
    });

    test("detects AWS access key", () => {
      const content = 'const key = "AKIA' + 'IOSFODNN7EXAMPLE";';
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

    test("detects GitHub personal access token (ghp[_])", () => {
      const content = 'const token = "ghp' + '_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";';
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
      const content = 'const db = "postgres://app:Th3R3alPassw0rd!@db.prod.internal:5432/mydb";';
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

    test("does not report localhost/dev placeholder database URLs", () => {
      const postgresql = "postgres" + "ql://";
      const postgres = "postgres" + "://";
      const mongo = "mongo" + "db://";
      const contents = [
        `DATABASE_URL=${postgresql}postgres:postgres@localhost:5432/alumia`,
        `DATABASE_URL=${postgres}user:password@127.0.0.1:5432/db`,
        `MONGO_URI=${mongo}localhost:27017/mydb`,
      ];
      for (const content of contents) {
        const findings = scanFile(".env.example", content);
        expect(findings.filter((f) => f.rule_id === "database-url")).toEqual([]);
      }
    });

    test("does not report docs and IaC placeholder database URLs", () => {
      const scheme = "postgres" + "://";
      const contents = [
        `DATABASE_URL=${scheme}USER:PASSWORD@HOST:5432/DBNAME`,
        `DATABASE_URL=${scheme}<username>:<password>@<host>:5432/<database>`,
        `DATABASE_URL=${scheme}\${DB_USER}:\${DB_PASSWORD}@\${DB_HOST}:5432/\${DB_NAME}`,
      ];
      for (const content of contents) {
        const findings = scanFile(".env.example", content);
        expect(findings.filter((f) => f.rule_id === "database-url")).toEqual([]);
      }
    });

    test("does not report high-entropy tokens inside a placeholder database URL", () => {
      const scheme = "postgres" + "ql://";
      const content =
        `DATABASE_URL=${scheme}user:0123456789abcdef0123456789abcdef@localhost:5432/db`;
      const findings = scanFile(".env.example", content);
      expect(findings.filter((f) => f.rule_id === "database-url")).toEqual([]);
      expect(findings.filter((f) => f.rule_id === "high-entropy-hex")).toEqual([]);
    });

    test("still reports high-entropy tokens inside a real database URL", () => {
      const scheme = "postgres" + "ql://";
      const content =
        `DATABASE_URL=${scheme}app:0123456789abcdef0123456789abcdef@db.internal:5432/prod`;
      const findings = scanFile(".env", content);
      expect(findings.find((f) => f.rule_id === "database-url")).toBeDefined();
      expect(findings.find((f) => f.rule_id === "high-entropy-hex")).toBeDefined();
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

    test("does not suppress findings when security-ignore appears inside a string", () => {
      const marker = "security" + "-ignore";
      const content = `api_key = "${marker}-abc1234567890abcdef"`;
      const findings = scanFile("config.ts", content);

      const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFinding).toBeDefined();
    });

    test("does not treat URL schemes as security-ignore comments", () => {
      const scheme = "postgres" + "://";
      const marker = "security" + "-ignore";
      const content = `DATABASE_URL=${scheme}user:pass@${marker}.example.com/db`;
      const findings = scanFile(".env", content);

      const dbFinding = findings.find((f) => f.rule_id === "database-url");
      expect(dbFinding).toBeDefined();
    });

    test("does not treat URL path slashes as security-ignore comments", () => {
      const scheme = "postgres" + "://";
      const marker = "security" + "-ignore";
      const content = `DATABASE_URL=${scheme}user:pass@example.com//${marker}/db`;
      const findings = scanFile(".env", content);

      const dbFinding = findings.find((f) => f.rule_id === "database-url");
      expect(dbFinding).toBeDefined();
    });

    test("does not treat URL punctuation before slashes as security-ignore comments", () => {
      const scheme = "postgres" + "://";
      const marker = "security" + "-ignore";
      const contents = [
        `DATABASE_URL=${scheme}user:pass@example.com/db;//${marker}`,
        `DATABASE_URL=${scheme}user:pass@example.com/db?x=(//${marker})`,
      ];

      for (const content of contents) {
        const findings = scanFile(".env", content);
        const dbFinding = findings.find((f) => f.rule_id === "database-url");
        expect(dbFinding).toBeDefined();
      }
    });

    test("does not use code-style security-ignore comments for non-code files", () => {
      const scheme = "postgres" + "://";
      const marker = "security" + "-ignore";
      const inputs = [
        {
          file: "config.yml",
          content: `DATABASE_URL: ${scheme}user:pass@example.com/db?x=(//${marker})`,
        },
        {
          file: "process:123",
          content: `DATABASE_URL=${scheme}user:pass@example.com/db?x=(//${marker})`,
        },
      ];

      for (const input of inputs) {
        const findings = scanFile(input.file, input.content);
        const dbFinding = findings.find((f) => f.rule_id === "database-url");
        expect(dbFinding).toBeDefined();
      }
    });

    test("does not use hash security-ignore comments for unknown file types", () => {
      const marker = "security" + "-ignore";
      const files = ["payload.txt", "config.json", "key.pem"];

      for (const file of files) {
        const findings = scanFile(file, `api_key = "abcdef1234567890abcdef" # ${marker}`);
        const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
        expect(apiKeyFinding).toBeDefined();
      }
    });

    test("does not suppress findings when security-ignore appears inside a multiline string", () => {
      const marker = "security" + "-ignore";
      const content = [
        "const marker = `",
        `  // ${marker}\`; api_key = "abcdef1234567890abcdef"`,
      ].join("\n");
      const findings = scanFile("config.ts", content);

      const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFinding).toBeDefined();
    });

    test("keeps quote state after block security-ignore comments", () => {
      const marker = "security" + "-ignore";
      const content = [
        `/* ${marker} */ const text = \``,
        `  // ${marker}\`; api_key = "abcdef1234567890abcdef"`,
      ].join("\n");
      const findings = scanFile("config.ts", content);

      const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFinding).toBeDefined();
    });

    test("does not treat double dashes inside env values as security-ignore comments", () => {
      const marker = "security" + "-ignore";
      const contents = [
        `API_KEY=abcdef1234567890-- ${marker}`,
        `API_KEY=abcdef1234567890 -- ${marker}`,
      ];

      for (const content of contents) {
        const findings = scanFile(".env", content);
        const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
        expect(apiKeyFinding).toBeDefined();
      }
    });

    test("suppresses findings when security-ignore appears in a comment", () => {
      const content = 'api_key = "abcdef1234567890abcdef" // security-ignore';
      const findings = scanFile("config.ts", content);

      const apiKeyFindings = findings.filter((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFindings).toHaveLength(0);
    });

    test("suppresses findings after multi-line block comments with apostrophes", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const content = [
        "/*",
        " * John's deployment note",
        " */",
        `api_key = "${genericApiKey}" // security-ignore`,
      ].join("\n");
      const findings = scanFile("config.ts", content);

      const apiKeyFindings = findings.filter((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFindings).toHaveLength(0);
    });

    test("suppresses findings with adjacent js comment delimiters", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const contents = [
        `api_key = "${genericApiKey}"// security-ignore`,
        `api_key = "${genericApiKey}"/* security-ignore */`,
      ];

      for (const content of contents) {
        const findings = scanFile("config.ts", content);
        const apiKeyFindings = findings.filter((f) => f.rule_id === "generic-api-key");
        expect(apiKeyFindings).toHaveLength(0);
      }
    });

    test("keeps block security-ignore suppression before a later plain line comment", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const marker = "security" + "-ignore";
      const content = `api_key = "${genericApiKey}" /* ${marker} */ // ordinary comment`;
      const findings = scanFile("config.ts", content);

      const apiKeyFindings = findings.filter((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFindings).toHaveLength(0);
    });

    test("suppresses findings inside block comments that carry security-ignore", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const marker = "security" + "-ignore";
      const content = `/* ${marker} api_key = "${genericApiKey}" */`;
      const findings = scanFile("config.ts", content);

      const apiKeyFindings = findings.filter((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFindings).toHaveLength(0);
    });

    test("suppresses findings later inside multiline block comments that carry security-ignore", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const marker = "security" + "-ignore";
      const content = ["/* " + marker, `api_key = "${genericApiKey}"`, "*/"].join("\n");
      const findings = scanFile("config.ts", content);

      const apiKeyFindings = findings.filter((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFindings).toHaveLength(0);
    });

    test("does not treat security-ignore inside a regex literal as a comment", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const marker = "security" + "-ignore";
      const content = `const re = /[//] ${marker}/; api_key = "${genericApiKey}"`;
      const findings = scanFile("config.ts", content);

      const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFinding).toBeDefined();
    });

    test("does not treat security-ignore inside an exported regex literal as a comment", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const marker = "security" + "-ignore";
      const content = `export default /[//] ${marker}/; api_key = "${genericApiKey}"`;
      const findings = scanFile("config.ts", content);

      const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFinding).toBeDefined();
    });

    test("does not treat security-ignore inside a control-flow regex literal as a comment", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const marker = "security" + "-ignore";
      const content = `if (ok) /[//] ${marker}/.test(input); api_key = "${genericApiKey}"`;
      const findings = scanFile("config.ts", content);

      const apiKeyFinding = findings.find((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFinding).toBeDefined();
    });

    test("suppresses earlier lines in multiline block comments that carry security-ignore", () => {
      const genericApiKey = "abcdef1234567890" + "abcdef";
      const marker = "security" + "-ignore";
      const content = [`/* api_key = "${genericApiKey}"`, `${marker} */`].join("\n");
      const findings = scanFile("config.ts", content);

      const apiKeyFindings = findings.filter((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFindings).toHaveLength(0);
    });

    test("suppresses env findings when security-ignore appears in a hash comment", () => {
      const content = "API_KEY=abcdef1234567890 # security-ignore";
      const findings = scanFile(".env", content);

      const apiKeyFindings = findings.filter((f) => f.rule_id === "generic-api-key");
      expect(apiKeyFindings).toHaveLength(0);
    });

    test("reports correct line number and column", () => {
      const content = "line 1\nline 2\nconst key = \"AKIA" + "IOSFODNN7EXAMPLE\";\nline 4";
      const findings = scanFile("test.ts", content);
      const awsFinding = findings.find((f) => f.rule_id === "aws-access-key");
      expect(awsFinding).toBeDefined();
      expect(awsFinding!.line).toBe(3);
      expect(awsFinding!.column).toBeGreaterThan(0);
    });

    test("redacts code snippets in secret findings", () => {
      const content = "line 1\nline 2\nconst key = \"AKIA" + "IOSFODNN7EXAMPLE\";\nline 4";
      const findings = scanFile("test.ts", content);
      const awsFinding = findings.find((f) => f.rule_id === "aws-access-key");
      expect(awsFinding!.code_snippet).toBeDefined();
      expect(awsFinding!.code_snippet).toBe("[REDACTED]");
      expect(JSON.stringify(awsFinding)).not.toContain("AKIA" + "IOSFODNN7EXAMPLE");
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
        'const key = "AKIA' + 'IOSFODNN7EXAMPLE";\n',
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
        'const key = "AKIA' + 'IOSFODNN7EXAMPLE";\n',
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
