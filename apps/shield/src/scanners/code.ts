import * as fs from "fs";
import * as path from "path";
import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  Severity,
  DEFAULT_CONFIG,
} from "../types/index.js";
import { walkDirectory, getCodeSnippet } from "./secrets.js";

// --- Code analysis patterns ---

interface CodePattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: Severity;
  message: string;
}

export const CODE_PATTERNS: CodePattern[] = [
  // SQL Injection
  {
    id: "sql-injection-concat",
    name: "SQL Injection (String Concatenation)",
    pattern: /(?:query|execute|exec|raw)\s*\(\s*['"`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE).*['"`]\s*\+/gi,
    severity: Severity.Critical,
    message: "Potential SQL injection via string concatenation in query",
  },
  {
    id: "sql-injection-template",
    name: "SQL Injection (Template Literal)",
    pattern: /(?:query|execute|exec|raw)\s*\(\s*`[^`]*\$\{.*\}[^`]*(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)/gi,
    severity: Severity.Critical,
    message: "Potential SQL injection via template literal interpolation",
  },
  {
    id: "sql-injection-template-rev",
    name: "SQL Injection (Template Literal)",
    pattern: /(?:query|execute|exec|raw)\s*\(\s*`[^`]*(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)[^`]*\$\{/gi,
    severity: Severity.Critical,
    message: "Potential SQL injection via template literal interpolation",
  },
  {
    id: "sql-raw-query",
    name: "Raw SQL Query",
    pattern: /\.\s*(?:rawQuery|raw|unsafe)\s*\(/g,
    severity: Severity.High,
    message: "Raw SQL query detected — ensure input is properly parameterized",
  },

  // XSS
  {
    id: "xss-innerhtml",
    name: "XSS (innerHTML)",
    pattern: /\.innerHTML\s*=/g,
    severity: Severity.High,
    message: "Direct innerHTML assignment — potential XSS vulnerability",
  },
  {
    id: "xss-dangerously-set",
    name: "XSS (dangerouslySetInnerHTML)",
    pattern: /dangerouslySetInnerHTML/g,
    severity: Severity.High,
    message: "dangerouslySetInnerHTML usage — potential XSS if user input is not sanitized",
  },
  {
    id: "xss-document-write",
    name: "XSS (document.write)",
    pattern: /document\.write\s*\(/g,
    severity: Severity.High,
    message: "document.write usage — potential XSS vulnerability",
  },
  {
    id: "xss-v-html",
    name: "XSS (v-html)",
    pattern: /v-html\s*=/g,
    severity: Severity.High,
    message: "Vue v-html directive — potential XSS if user input is not sanitized",
  },

  // Command Injection
  {
    id: "cmd-injection-exec",
    name: "Command Injection (exec)",
    pattern: /(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|['"].*\+)/g,
    severity: Severity.Critical,
    message: "Potential command injection via exec with dynamic input",
  },
  {
    id: "cmd-injection-spawn",
    name: "Command Injection (spawn)",
    pattern: /(?:spawn|spawnSync)\s*\(\s*(?:`[^`]*\$\{|['"].*\+)/g,
    severity: Severity.Critical,
    message: "Potential command injection via spawn with dynamic input",
  },
  {
    id: "cmd-injection-child-process",
    name: "Command Injection (child_process)",
    pattern: /require\s*\(\s*['"]child_process['"]\s*\)/g,
    severity: Severity.Medium,
    message: "child_process module imported — ensure commands are not constructed from user input",
  },

  // Path Traversal
  {
    id: "path-traversal-readfile",
    name: "Path Traversal (File Read)",
    pattern: /(?:readFile|readFileSync|createReadStream)\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.)/g,
    severity: Severity.High,
    message: "Potential path traversal — user input used directly in file read operation",
  },
  {
    id: "path-traversal-writefile",
    name: "Path Traversal (File Write)",
    pattern: /(?:writeFile|writeFileSync|createWriteStream)\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.)/g,
    severity: Severity.High,
    message: "Potential path traversal — user input used directly in file write operation",
  },
  {
    id: "path-traversal-dotdot",
    name: "Path Traversal (../ pattern)",
    pattern: /(?:path\.join|path\.resolve)\s*\([^)]*\.\.\//g,
    severity: Severity.Medium,
    message: "Path construction with ../ — potential path traversal if input is user-controlled",
  },

  // Insecure Crypto
  {
    id: "insecure-crypto-md5",
    name: "Insecure Crypto (MD5)",
    pattern: /(?:createHash|hashlib\.md5|MD5|md5)\s*\(\s*['"]?md5['"]?\s*\)/gi,
    severity: Severity.Medium,
    message: "MD5 hash detected — MD5 is cryptographically broken, use SHA-256 or bcrypt for passwords",
  },
  {
    id: "insecure-crypto-sha1",
    name: "Insecure Crypto (SHA1)",
    pattern: /(?:createHash)\s*\(\s*['"]sha1['"]\s*\)/gi,
    severity: Severity.Medium,
    message: "SHA1 hash detected — SHA1 is weak, use SHA-256 or stronger",
  },
  {
    id: "insecure-random",
    name: "Insecure Random (Math.random)",
    pattern: /Math\.random\s*\(\s*\)/g,
    severity: Severity.Medium,
    message: "Math.random() used — not cryptographically secure, use crypto.randomBytes() for security-sensitive operations",
  },

  // Hardcoded Credentials
  {
    id: "hardcoded-password",
    name: "Hardcoded Password",
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{4,}['"]/gi,
    severity: Severity.High,
    message: "Hardcoded password detected",
  },
  {
    id: "hardcoded-secret",
    name: "Hardcoded Secret",
    pattern: /(?:secret|token|auth_key|access_key)\s*[=:]\s*['"][^'"]{8,}['"]/gi,
    severity: Severity.High,
    message: "Hardcoded secret detected",
  },

  // SSRF
  {
    id: "ssrf-dynamic-url",
    name: "SSRF (Dynamic URL)",
    pattern: /(?:fetch|axios\.get|axios\.post|http\.get|http\.request|urllib\.request)\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.|`[^`]*\$\{)/g,
    severity: Severity.High,
    message: "Potential SSRF — HTTP request with dynamic/user-controlled URL",
  },

  // eval
  {
    id: "eval-usage",
    name: "eval() Usage",
    pattern: /\beval\s*\(/g,
    severity: Severity.High,
    message: "eval() usage detected — potential code injection if input is user-controlled",
  },
];

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rb"]);

export function scanFile(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNum = i + 1;

    // Skip comment-only lines
    const trimmed = lineText.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;

    for (const cp of CODE_PATTERNS) {
      cp.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = cp.pattern.exec(lineText)) !== null) {
        findings.push({
          rule_id: cp.id,
          scanner_type: ScannerType.Code,
          severity: cp.severity,
          file: filePath,
          line: lineNum,
          column: match.index + 1,
          message: cp.message,
          code_snippet: getCodeSnippet(content, lineNum),
        });
      }
    }
  }

  return findings;
}

export const codeScanner: Scanner = {
  name: "Code Scanner",
  type: ScannerType.Code,
  description: "Static code analysis for common security vulnerabilities like SQL injection, XSS, command injection, and more",

  async scan(scanPath: string, options?: ScannerRunOptions): Promise<FindingInput[]> {
    const ignorePatterns = options?.ignore_patterns ?? DEFAULT_CONFIG.ignore_patterns;
    const files = walkDirectory(scanPath, ignorePatterns, (filePath) =>
      CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
    );
    const findings: FindingInput[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const relativePath = path.relative(scanPath, file);
        findings.push(...scanFile(relativePath, content));
      } catch {
        // Skip unreadable files
      }
    }

    return findings;
  },
};

export default codeScanner;
