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

// --- Shared utilities ---

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".flac", ".wav", ".ogg",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
  ".pyc", ".pyo", ".class", ".o", ".obj",
  ".lock", ".sqlite", ".db",
  ".DS_Store",
]);

export function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function walkDirectory(
  dir: string,
  ignorePatterns: string[],
  fileFilter?: (filePath: string) => boolean,
): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (ignorePatterns.some((pattern) => {
        if (pattern.startsWith("*.")) {
          // Glob extension match: *.test.ts matches foo.test.ts
          return entry.name.endsWith(pattern.slice(1));
        }
        return entry.name === pattern || fullPath.includes(`/${pattern}/`);
      })) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (isBinaryFile(fullPath)) continue;
        if (fileFilter && !fileFilter(fullPath)) continue;
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

export function getCodeSnippet(content: string, line: number, context: number = 1): string {
  const lines = content.split("\n");
  const start = Math.max(0, line - 1 - context);
  const end = Math.min(lines.length, line + context);
  return lines
    .slice(start, end)
    .map((l, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === line ? ">" : " ";
      return `${marker} ${lineNum}: ${l}`;
    })
    .join("\n");
}

// --- Secret patterns ---

export interface SecretPattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: Severity;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "aws-access-key",
    name: "AWS Access Key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: Severity.Critical,
  },
  {
    id: "aws-secret-key",
    name: "AWS Secret Key",
    pattern: /(?:aws_secret_access_key|aws_secret_key|secret_access_key)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
    severity: Severity.Critical,
  },
  {
    id: "github-token",
    name: "GitHub Token",
    pattern: /\b(ghp_[A-Za-z0-9_]{36,}|gho_[A-Za-z0-9_]{36,}|ghs_[A-Za-z0-9_]{36,}|ghr_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
    severity: Severity.Critical,
  },
  {
    id: "stripe-secret-key",
    name: "Stripe Secret Key",
    pattern: /\b(sk_live_[A-Za-z0-9]{24,})\b/g,
    severity: Severity.Critical,
  },
  {
    id: "stripe-publishable-key",
    name: "Stripe Publishable Key",
    pattern: /\b(pk_live_[A-Za-z0-9]{24,})\b/g,
    severity: Severity.Medium,
  },
  {
    id: "generic-api-key",
    name: "Generic API Key",
    pattern: /(?:api_key|apikey|api[-_]?key)\s*[=:]\s*['"]([A-Za-z0-9_\-]{16,})['"/]/gi,
    severity: Severity.High,
  },
  {
    id: "private-key",
    name: "Private Key",
    pattern: /-----BEGIN\s+(?:RSA|DSA|EC|PGP|OPENSSH)?\s*PRIVATE KEY-----/g,
    severity: Severity.Critical,
  },
  {
    id: "jwt-token",
    name: "JWT Token",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    severity: Severity.High,
  },
  {
    id: "slack-token",
    name: "Slack Token",
    pattern: /\b(xoxb-[A-Za-z0-9\-]{24,}|xoxp-[A-Za-z0-9\-]{24,}|xoxs-[A-Za-z0-9\-]{24,})\b/g,
    severity: Severity.Critical,
  },
  {
    id: "database-url",
    name: "Database URL",
    pattern: /\b(postgres(?:ql)?:\/\/[^\s'"]+|mysql:\/\/[^\s'"]+|mongodb(?:\+srv)?:\/\/[^\s'"]+)/gi,
    severity: Severity.High,
  },
];

// --- Shannon entropy ---

export function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;

  const freq: Record<string, number> = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] || 0) + 1;
  }

  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

const HEX_RE = /\b[0-9a-fA-F]{16,}\b/g;
const BASE64_RE = /\b[A-Za-z0-9+/=]{20,}\b/g;

function detectHighEntropyStrings(content: string, filePath: string, line: number, lineText: string): FindingInput[] {
  const findings: FindingInput[] = [];

  let hexMatch: RegExpExecArray | null;
  HEX_RE.lastIndex = 0;
  while ((hexMatch = HEX_RE.exec(lineText)) !== null) {
    const token = hexMatch[0];
    if (shannonEntropy(token) > 4.5) {
      findings.push({
        rule_id: "high-entropy-hex",
        scanner_type: ScannerType.Secrets,
        severity: Severity.Medium,
        file: filePath,
        line,
        message: `High-entropy hex string detected (possible secret): ${token.substring(0, 16)}...`,
        code_snippet: getCodeSnippet(content, line),
      });
    }
  }

  let b64Match: RegExpExecArray | null;
  BASE64_RE.lastIndex = 0;
  while ((b64Match = BASE64_RE.exec(lineText)) !== null) {
    const token = b64Match[0];
    if (shannonEntropy(token) > 5.0) {
      findings.push({
        rule_id: "high-entropy-base64",
        scanner_type: ScannerType.Secrets,
        severity: Severity.Medium,
        file: filePath,
        line,
        message: `High-entropy base64 string detected (possible secret): ${token.substring(0, 16)}...`,
        code_snippet: getCodeSnippet(content, line),
      });
    }
  }

  return findings;
}

// --- Scanner ---

export function scanFile(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNum = i + 1;

    // Skip lines with security-ignore suppression comment
    if (lineText.includes("security-ignore")) continue;

    for (const sp of SECRET_PATTERNS) {
      sp.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = sp.pattern.exec(lineText)) !== null) {
        findings.push({
          rule_id: sp.id,
          scanner_type: ScannerType.Secrets,
          severity: sp.severity,
          file: filePath,
          line: lineNum,
          column: match.index + 1,
          message: `${sp.name} detected`,
          code_snippet: getCodeSnippet(content, lineNum),
        });
      }
    }

    findings.push(...detectHighEntropyStrings(content, filePath, lineNum, lineText));
  }

  return findings;
}

export const secretsScanner: Scanner = {
  name: "Secrets Scanner",
  type: ScannerType.Secrets,
  description: "Detects hardcoded secrets, API keys, tokens, and high-entropy strings in source code",

  async scan(scanPath: string, options?: ScannerRunOptions): Promise<FindingInput[]> {
    const ignorePatterns = options?.ignore_patterns ?? DEFAULT_CONFIG.ignore_patterns;
    const files = walkDirectory(scanPath, ignorePatterns);
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

export default secretsScanner;
