import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scanFile, CODE_PATTERNS, codeScanner } from "./code.js";
import { ScannerType, Severity } from "../types/index.js";

describe("code scanner", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "code-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // --- scanFile unit tests ---

  describe("scanFile", () => {
    test("detects SQL injection via string concatenation", () => {
      const content = 'db.query("SELECT * FROM users WHERE id=" + userId);';
      const findings = scanFile("app.ts", content);
      const sqlFinding = findings.find((f) => f.rule_id === "sql-injection-concat");
      expect(sqlFinding).toBeDefined();
      expect(sqlFinding!.severity).toBe(Severity.Critical);
    });

    test("detects SQL injection via template literal", () => {
      const content = 'db.query(`SELECT * FROM users WHERE id=${userId}`);';
      const findings = scanFile("app.ts", content);
      const sqlFinding = findings.find((f) => f.rule_id === "sql-injection-template-rev");
      expect(sqlFinding).toBeDefined();
      expect(sqlFinding!.severity).toBe(Severity.Critical);
    });

    test("detects raw SQL query usage", () => {
      const content = 'const result = db.rawQuery("SELECT 1");';
      const findings = scanFile("app.ts", content);
      const rawFinding = findings.find((f) => f.rule_id === "sql-raw-query");
      expect(rawFinding).toBeDefined();
      expect(rawFinding!.severity).toBe(Severity.High);
    });

    test("detects innerHTML XSS", () => {
      const content = 'element.innerHTML = userInput;';
      const findings = scanFile("dom.ts", content);
      const xssFinding = findings.find((f) => f.rule_id === "xss-innerhtml");
      expect(xssFinding).toBeDefined();
      expect(xssFinding!.severity).toBe(Severity.High);
    });

    test("detects dangerouslySetInnerHTML", () => {
      const content = '<div dangerouslySetInnerHTML={{ __html: data }} />';
      const findings = scanFile("component.tsx", content);
      const xssFinding = findings.find((f) => f.rule_id === "xss-dangerously-set");
      expect(xssFinding).toBeDefined();
    });

    test("detects document.write", () => {
      const content = 'document.write("<h1>" + title + "</h1>");';
      const findings = scanFile("legacy.js", content);
      const xssFinding = findings.find((f) => f.rule_id === "xss-document-write");
      expect(xssFinding).toBeDefined();
    });

    test("detects v-html directive", () => {
      const content = '<div v-html="rawHtml"></div>';
      const findings = scanFile("component.vue", content);
      const xssFinding = findings.find((f) => f.rule_id === "xss-v-html");
      expect(xssFinding).toBeDefined();
    });

    test("detects command injection via exec", () => {
      const content = 'exec(`ls ${userDir}`);';
      const findings = scanFile("shell.ts", content);
      const cmdFinding = findings.find((f) => f.rule_id === "cmd-injection-exec");
      expect(cmdFinding).toBeDefined();
      expect(cmdFinding!.severity).toBe(Severity.Critical);
    });

    test("detects child_process import", () => {
      const content = 'const cp = require("child_process");';
      const findings = scanFile("worker.ts", content);
      const cpFinding = findings.find((f) => f.rule_id === "cmd-injection-child-process");
      expect(cpFinding).toBeDefined();
      expect(cpFinding!.severity).toBe(Severity.Medium);
    });

    test("detects path traversal in file read", () => {
      const content = 'fs.readFileSync(req.query.path);';
      const findings = scanFile("api.ts", content);
      const ptFinding = findings.find((f) => f.rule_id === "path-traversal-readfile");
      expect(ptFinding).toBeDefined();
      expect(ptFinding!.severity).toBe(Severity.High);
    });

    test("detects path traversal in file write", () => {
      const content = 'fs.writeFileSync(req.body.filename, data);';
      const findings = scanFile("upload.ts", content);
      const ptFinding = findings.find((f) => f.rule_id === "path-traversal-writefile");
      expect(ptFinding).toBeDefined();
    });

    test("detects insecure MD5 usage", () => {
      const content = 'const hash = createHash("md5");';
      const findings = scanFile("hash.ts", content);
      const cryptoFinding = findings.find((f) => f.rule_id === "insecure-crypto-md5");
      expect(cryptoFinding).toBeDefined();
      expect(cryptoFinding!.severity).toBe(Severity.Medium);
    });

    test("detects insecure SHA1 usage", () => {
      const content = 'const hash = createHash("sha1");';
      const findings = scanFile("hash.ts", content);
      const cryptoFinding = findings.find((f) => f.rule_id === "insecure-crypto-sha1");
      expect(cryptoFinding).toBeDefined();
    });

    test("detects Math.random() usage", () => {
      const content = "const id = Math.random();";
      const findings = scanFile("util.ts", content);
      const randFinding = findings.find((f) => f.rule_id === "insecure-random");
      expect(randFinding).toBeDefined();
      expect(randFinding!.severity).toBe(Severity.Medium);
    });

    test("detects hardcoded password", () => {
      const content = 'const password = "SuperSecret123!";';
      const findings = scanFile("config.ts", content);
      const pwFinding = findings.find((f) => f.rule_id === "hardcoded-password");
      expect(pwFinding).toBeDefined();
      expect(pwFinding!.severity).toBe(Severity.High);
    });

    test("detects hardcoded secret/token", () => {
      const content = 'const secret = "my-secret-token-12345678";';
      const findings = scanFile("config.ts", content);
      const secretFinding = findings.find((f) => f.rule_id === "hardcoded-secret");
      expect(secretFinding).toBeDefined();
    });

    test("detects eval() usage", () => {
      const content = "const result = eval(userCode);";
      const findings = scanFile("dangerous.ts", content);
      const evalFinding = findings.find((f) => f.rule_id === "eval-usage");
      expect(evalFinding).toBeDefined();
      expect(evalFinding!.severity).toBe(Severity.High);
    });

    test("detects SSRF with dynamic URL", () => {
      const content = "fetch(req.query.url);";
      const findings = scanFile("proxy.ts", content);
      const ssrfFinding = findings.find((f) => f.rule_id === "ssrf-dynamic-url");
      expect(ssrfFinding).toBeDefined();
      expect(ssrfFinding!.severity).toBe(Severity.High);
    });

    test("skips comment lines", () => {
      const content = "// eval(userCode);\n# eval(userCode);\n* eval(userCode);";
      const findings = scanFile("comments.ts", content);
      const evalFindings = findings.filter((f) => f.rule_id === "eval-usage");
      expect(evalFindings.length).toBe(0);
    });

    test("clean file produces no findings", () => {
      const content = `
import { createHash } from "crypto";
const hash = createHash("sha256").update(data).digest("hex");
const users = await db.select().from(usersTable).where(eq(usersTable.id, id));
`;
      const findings = scanFile("clean.ts", content);
      expect(findings.length).toBe(0);
    });

    test("reports correct line numbers", () => {
      const content = "line1\nline2\nconst result = eval(code);\nline4";
      const findings = scanFile("test.ts", content);
      const evalFinding = findings.find((f) => f.rule_id === "eval-usage");
      expect(evalFinding!.line).toBe(3);
    });

    test("includes code snippet", () => {
      const content = "safe line\nconst result = eval(code);\nafter";
      const findings = scanFile("test.ts", content);
      const evalFinding = findings.find((f) => f.rule_id === "eval-usage");
      expect(evalFinding!.code_snippet).toBeDefined();
      expect(evalFinding!.code_snippet).toContain("eval");
    });
  });

  // --- Full scanner integration test ---

  describe("codeScanner.scan", () => {
    test("scans directory and finds vulnerabilities", async () => {
      writeFileSync(
        join(tempDir, "vulnerable.ts"),
        'element.innerHTML = userInput;\nconst x = eval(code);\n',
      );
      writeFileSync(join(tempDir, "clean.ts"), "const x = 1;\n");

      const findings = await codeScanner.scan(tempDir);
      expect(findings.length).toBeGreaterThanOrEqual(2);
    });

    test("only scans code file extensions", async () => {
      writeFileSync(
        join(tempDir, "data.json"),
        '{"innerHTML": "test"}',
      );
      writeFileSync(join(tempDir, "style.css"), ".innerHTML { color: red; }");

      const findings = await codeScanner.scan(tempDir);
      expect(findings.length).toBe(0);
    });

    test("respects ignore patterns", async () => {
      mkdirSync(join(tempDir, "dist"), { recursive: true });
      writeFileSync(
        join(tempDir, "dist", "bundle.js"),
        "eval(code);",
      );

      const findings = await codeScanner.scan(tempDir, {
        ignore_patterns: ["dist"],
      });
      expect(findings.length).toBe(0);
    });

    test("returns empty array for directory with no code files", async () => {
      writeFileSync(join(tempDir, "readme.md"), "# Hello");

      const findings = await codeScanner.scan(tempDir);
      expect(findings.length).toBe(0);
    });
  });
});
