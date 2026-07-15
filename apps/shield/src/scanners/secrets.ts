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

const REDACTED_CODE_SNIPPET = "[REDACTED]";

const SECURITY_IGNORE = "security-ignore";
const SLASH_COMMENT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".cxx",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".php",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);
const HASH_COMMENT_EXTENSIONS = new Set([
  ".bash",
  ".cfg",
  ".conf",
  ".fish",
  ".ini",
  ".properties",
  ".py",
  ".rb",
  ".sh",
  ".toml",
  ".yaml",
  ".yml",
  ".zsh",
]);
const SQL_COMMENT_EXTENSIONS = new Set([".sql"]);

interface CommentSyntax {
  block: boolean;
  dash: boolean;
  hash: boolean;
  slash: boolean;
}

export interface SecurityIgnoreBlockRange {
  end: number;
  start: number;
}

export interface SecurityIgnoreLineScan {
  blockCommentRanges: SecurityIgnoreBlockRange[];
  commentIndex: number | null;
  commentKind: "block" | "line" | null;
  finalBlockComment: boolean;
  finalBlockCommentHasSecurityIgnore: boolean;
  finalQuote: string | null;
}

const NO_COMMENT_SYNTAX: CommentSyntax = {
  block: false,
  dash: false,
  hash: false,
  slash: false,
};

const HASH_COMMENT_SYNTAX: CommentSyntax = {
  block: false,
  dash: false,
  hash: true,
  slash: false,
};

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function findMatchingOpenParen(lineText: string, closeIndex: number): number {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i--) {
    if (lineText[i] === ")") {
      depth++;
      continue;
    }
    if (lineText[i] === "(") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function canStartRegexLiteral(lineText: string, index: number): boolean {
  let previousIndex = index - 1;
  while (previousIndex >= 0 && /\s/.test(lineText[previousIndex])) {
    previousIndex--;
  }
  if (previousIndex < 0) return true;

  const previousChar = lineText[previousIndex];
  if ("=(:,[!&|?;{}+-*%^~<>".includes(previousChar)) return true;
  if (previousChar === ")") {
    const openParen = findMatchingOpenParen(lineText, previousIndex);
    if (openParen !== -1 && /\b(?:for|if|while|with)$/.test(lineText.slice(0, openParen).trimEnd())) {
      return true;
    }
  }

  return /\b(?:await|case|default|delete|do|else|in|new|of|return|throw|typeof|void|yield)$/.test(
    lineText.slice(0, previousIndex + 1).trimEnd(),
  );
}

function skipRegexLiteral(lineText: string, start: number): number {
  let escaped = false;
  let inCharacterClass = false;

  for (let i = start + 1; i < lineText.length; i++) {
    const char = lineText[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" && !inCharacterClass) {
      inCharacterClass = true;
      continue;
    }
    if (char === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (char === "/" && !inCharacterClass) {
      let end = i + 1;
      while (/[A-Za-z]/.test(lineText[end] ?? "")) {
        end++;
      }
      return end;
    }
  }

  return start + 1;
}

function isEnvLikeFile(filePath: string): boolean {
  const base = path.basename(filePath.replace(/\\/g, "/")).toLowerCase();
  return base === ".env" || base.startsWith(".env.") || base.endsWith(".env");
}

function getCommentSyntax(filePath?: string): CommentSyntax {
  if (!filePath) {
    return NO_COMMENT_SYNTAX;
  }

  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.startsWith("process:") || normalized.startsWith("tmux:")) {
    return NO_COMMENT_SYNTAX;
  }

  if (isEnvLikeFile(normalized)) {
    return HASH_COMMENT_SYNTAX;
  }

  const extension = path.extname(normalized);
  if (SLASH_COMMENT_EXTENSIONS.has(extension)) {
    return {
      block: true,
      dash: false,
      hash: false,
      slash: true,
    };
  }

  if (HASH_COMMENT_EXTENSIONS.has(extension)) {
    return HASH_COMMENT_SYNTAX;
  }

  if (SQL_COMMENT_EXTENSIONS.has(extension)) {
    return {
      block: true,
      dash: true,
      hash: false,
      slash: false,
    };
  }

  return NO_COMMENT_SYNTAX;
}

export function scanSecurityIgnoreLine(
  lineText: string,
  filePath?: string,
  initialQuote: string | null = null,
  initialBlockComment = false,
  initialBlockCommentHasSecurityIgnore = false,
): SecurityIgnoreLineScan {
  const syntax = getCommentSyntax(filePath);
  let quote = initialQuote;
  let blockComment = initialBlockComment;
  let blockCommentHasSecurityIgnore = initialBlockCommentHasSecurityIgnore;
  let escaped = false;
  const blockCommentRanges: SecurityIgnoreBlockRange[] = [];
  let commentIndex: number | null = null;
  let commentKind: "block" | "line" | null = null;

  function recordBlockSecurityIgnore(start: number, end: number): void {
    blockCommentRanges.push({ start, end });
    if (commentIndex === null) {
      commentIndex = start;
      commentKind = "block";
    }
  }

  let i = 0;
  while (i < lineText.length) {
    const char = lineText[i];

    if (blockComment) {
      const end = lineText.indexOf("*/", i);
      const commentEnd = end === -1 ? lineText.length : end;
      blockCommentHasSecurityIgnore =
        blockCommentHasSecurityIgnore || lineText.slice(i, commentEnd).includes(SECURITY_IGNORE);
      if (blockCommentHasSecurityIgnore) {
        recordBlockSecurityIgnore(i, end === -1 ? lineText.length : end + 2);
      }
      if (end === -1) {
        return {
          blockCommentRanges,
          commentIndex,
          commentKind,
          finalBlockComment: true,
          finalBlockCommentHasSecurityIgnore: blockCommentHasSecurityIgnore,
          finalQuote: quote,
        };
      }
      blockComment = false;
      blockCommentHasSecurityIgnore = false;
      i = end + 2;
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        i++;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      i++;
      continue;
    }

    if (syntax.block && lineText.startsWith("/*", i)) {
      const end = lineText.indexOf("*/", i + 2);
      const commentEnd = end === -1 ? lineText.length : end;
      blockCommentHasSecurityIgnore = lineText.slice(i + 2, commentEnd).includes(SECURITY_IGNORE);
      if (blockCommentHasSecurityIgnore) {
        recordBlockSecurityIgnore(i, end === -1 ? lineText.length : end + 2);
      }
      if (end === -1) {
        return {
          blockCommentRanges,
          commentIndex,
          commentKind,
          finalBlockComment: true,
          finalBlockCommentHasSecurityIgnore: blockCommentHasSecurityIgnore,
          finalQuote: quote,
        };
      }
      blockCommentHasSecurityIgnore = false;
      i = end + 2;
      continue;
    }

    if (syntax.slash && lineText.startsWith("//", i)) {
      const hasIgnore = lineText.slice(i + 2).includes(SECURITY_IGNORE);
      return {
        blockCommentRanges,
        commentIndex: hasIgnore ? i : commentIndex,
        commentKind: hasIgnore ? "line" : commentKind,
        finalBlockComment: false,
        finalBlockCommentHasSecurityIgnore: false,
        finalQuote: null,
      };
    }

    if (syntax.slash && char === "/" && canStartRegexLiteral(lineText, i)) {
      i = skipRegexLiteral(lineText, i);
      continue;
    }

    if (syntax.hash && char === "#" && isWhitespace(lineText[i - 1])) {
      const hasIgnore = lineText.slice(i + 1).includes(SECURITY_IGNORE);
      return {
        blockCommentRanges,
        commentIndex: hasIgnore ? i : commentIndex,
        commentKind: hasIgnore ? "line" : commentKind,
        finalBlockComment: false,
        finalBlockCommentHasSecurityIgnore: false,
        finalQuote: null,
      };
    }

    if (
      syntax.dash &&
      lineText.startsWith("--", i) &&
      isWhitespace(lineText[i - 1]) &&
      isWhitespace(lineText[i + 2])
    ) {
      const hasIgnore = lineText.slice(i + 2).includes(SECURITY_IGNORE);
      return {
        blockCommentRanges,
        commentIndex: hasIgnore ? i : commentIndex,
        commentKind: hasIgnore ? "line" : commentKind,
        finalBlockComment: false,
        finalBlockCommentHasSecurityIgnore: false,
        finalQuote: null,
      };
    }

    i++;
  }

  return {
    blockCommentRanges,
    commentIndex,
    commentKind,
    finalBlockComment: blockComment,
    finalBlockCommentHasSecurityIgnore: blockCommentHasSecurityIgnore,
    finalQuote: quote,
  };
}

interface PendingBlockRange {
  line: number;
  range: SecurityIgnoreBlockRange;
}

export function collectSecurityIgnoreBlockRanges(content: string, filePath?: string): Map<number, SecurityIgnoreBlockRange[]> {
  const syntax = getCommentSyntax(filePath);
  const rangesByLine = new Map<number, SecurityIgnoreBlockRange[]>();
  if (!syntax.block) return rangesByLine;

  const lines = content.split("\n");
  let quote: string | null = null;
  let blockComment = false;
  let blockCommentHasSecurityIgnore = false;
  let pendingRanges: PendingBlockRange[] = [];

  function addPendingRange(line: number, start: number, end: number): void {
    pendingRanges.push({ line, range: { start, end } });
  }

  function commitPendingRanges(): void {
    if (blockCommentHasSecurityIgnore) {
      for (const pending of pendingRanges) {
        const existing = rangesByLine.get(pending.line) ?? [];
        existing.push(pending.range);
        rangesByLine.set(pending.line, existing);
      }
    }
    pendingRanges = [];
    blockCommentHasSecurityIgnore = false;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    let escaped = false;
    let i = 0;

    while (i < lineText.length) {
      const char = lineText[i];

      if (blockComment) {
        const end = lineText.indexOf("*/", i);
        const commentEnd = end === -1 ? lineText.length : end;
        blockCommentHasSecurityIgnore =
          blockCommentHasSecurityIgnore || lineText.slice(i, commentEnd).includes(SECURITY_IGNORE);
        addPendingRange(lineIndex, i, end === -1 ? lineText.length : end + 2);
        if (end === -1) break;
        blockComment = false;
        i = end + 2;
        commitPendingRanges();
        continue;
      }

      if (quote) {
        if (escaped) {
          escaped = false;
          i++;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          i++;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        i++;
        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        i++;
        continue;
      }

      if (lineText.startsWith("/*", i)) {
        const end = lineText.indexOf("*/", i + 2);
        const commentEnd = end === -1 ? lineText.length : end;
        blockCommentHasSecurityIgnore = lineText.slice(i + 2, commentEnd).includes(SECURITY_IGNORE);
        addPendingRange(lineIndex, i, end === -1 ? lineText.length : end + 2);
        if (end === -1) {
          blockComment = true;
          break;
        }
        i = end + 2;
        commitPendingRanges();
        continue;
      }

      if (syntax.slash && lineText.startsWith("//", i)) break;
      if (syntax.slash && char === "/" && canStartRegexLiteral(lineText, i)) {
        i = skipRegexLiteral(lineText, i);
        continue;
      }
      if (syntax.hash && char === "#" && isWhitespace(lineText[i - 1])) break;
      if (
        syntax.dash &&
        lineText.startsWith("--", i) &&
        isWhitespace(lineText[i - 1]) &&
        isWhitespace(lineText[i + 2])
      ) {
        break;
      }

      i++;
    }
  }

  if (blockComment) commitPendingRanges();
  return rangesByLine;
}

export function mergeSecurityIgnoreBlockRanges(
  scan: SecurityIgnoreLineScan,
  blockCommentRanges: SecurityIgnoreBlockRange[] | undefined,
): SecurityIgnoreLineScan {
  if (!blockCommentRanges || blockCommentRanges.length === 0) return scan;
  return {
    ...scan,
    blockCommentRanges: [...scan.blockCommentRanges, ...blockCommentRanges],
    commentIndex: scan.commentIndex ?? blockCommentRanges[0].start,
    commentKind: scan.commentKind ?? "block",
  };
}

export function hasSecurityIgnoreComment(lineText: string, filePath?: string): boolean {
  return scanSecurityIgnoreLine(lineText, filePath).commentIndex !== null;
}

export function isFindingSuppressedBySecurityIgnore(
  scan: SecurityIgnoreLineScan,
  matchIndex: number,
): boolean {
  if (scan.commentIndex === null) return false;
  if (scan.commentKind === "line") return true;
  return scan.blockCommentRanges.some((range) => {
    const matchIsInsideBlock = matchIndex >= range.start && matchIndex < range.end;
    const blockAppearsAfterMatch = range.start >= matchIndex;
    return matchIsInsideBlock || blockAppearsAfterMatch;
  });
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
    pattern: /(?:api_key|apikey|api[-_]?key)\s*[=:]\s*['"]([A-Za-z0-9_\-]{16,})['"]/gi,
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
const UNQUOTED_ENV_API_KEY_RE = /(?:api_key|apikey|api[-_]?key)\s*=\s*([A-Za-z0-9_\-]{16,})(?=\s|$|[;,#])/gi;

function detectUnquotedEnvApiKeys(
  content: string,
  filePath: string,
  line: number,
  lineText: string,
  securityIgnore: SecurityIgnoreLineScan,
): FindingInput[] {
  if (!isEnvLikeFile(filePath)) return [];

  const findings: FindingInput[] = [];
  let match: RegExpExecArray | null;
  UNQUOTED_ENV_API_KEY_RE.lastIndex = 0;
  while ((match = UNQUOTED_ENV_API_KEY_RE.exec(lineText)) !== null) {
    if (isFindingSuppressedBySecurityIgnore(securityIgnore, match.index)) continue;
    findings.push({
      rule_id: "generic-api-key",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      file: filePath,
      line,
      column: match.index + 1,
      message: "Generic API Key detected",
      code_snippet: REDACTED_CODE_SNIPPET,
    });
  }

  return findings;
}

function detectHighEntropyStrings(
  content: string,
  filePath: string,
  line: number,
  lineText: string,
  securityIgnore: SecurityIgnoreLineScan,
): FindingInput[] {
  const findings: FindingInput[] = [];

  let hexMatch: RegExpExecArray | null;
  HEX_RE.lastIndex = 0;
  while ((hexMatch = HEX_RE.exec(lineText)) !== null) {
    const token = hexMatch[0];
    if (isFindingSuppressedBySecurityIgnore(securityIgnore, hexMatch.index)) continue;
    if (shannonEntropy(token) > 4.5) {
      findings.push({
        rule_id: "high-entropy-hex",
        scanner_type: ScannerType.Secrets,
        severity: Severity.Medium,
        file: filePath,
        line,
        message: "High-entropy hex string detected (possible secret)",
        code_snippet: REDACTED_CODE_SNIPPET,
      });
    }
  }

  let b64Match: RegExpExecArray | null;
  BASE64_RE.lastIndex = 0;
  while ((b64Match = BASE64_RE.exec(lineText)) !== null) {
    const token = b64Match[0];
    if (isFindingSuppressedBySecurityIgnore(securityIgnore, b64Match.index)) continue;
    if (shannonEntropy(token) > 5.0) {
      findings.push({
        rule_id: "high-entropy-base64",
        scanner_type: ScannerType.Secrets,
        severity: Severity.Medium,
        file: filePath,
        line,
        message: "High-entropy base64 string detected (possible secret)",
        code_snippet: REDACTED_CODE_SNIPPET,
      });
    }
  }

  return findings;
}

// --- Scanner ---

export function scanFile(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lines = content.split("\n");
  const securityIgnoreBlockRanges = collectSecurityIgnoreBlockRanges(content, filePath);
  let quote: string | null = null;
  let blockComment = false;
  let blockCommentHasSecurityIgnore = false;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNum = i + 1;
    const securityIgnore = mergeSecurityIgnoreBlockRanges(
      scanSecurityIgnoreLine(
        lineText,
        filePath,
        quote,
        blockComment,
        blockCommentHasSecurityIgnore,
      ),
      securityIgnoreBlockRanges.get(i),
    );
    quote = securityIgnore.finalQuote;
    blockComment = securityIgnore.finalBlockComment;
    blockCommentHasSecurityIgnore = securityIgnore.finalBlockCommentHasSecurityIgnore;

    for (const sp of SECRET_PATTERNS) {
      sp.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = sp.pattern.exec(lineText)) !== null) {
        if (isFindingSuppressedBySecurityIgnore(securityIgnore, match.index)) continue;
        findings.push({
          rule_id: sp.id,
          scanner_type: ScannerType.Secrets,
          severity: sp.severity,
          file: filePath,
          line: lineNum,
          column: match.index + 1,
          message: `${sp.name} detected`,
          code_snippet: REDACTED_CODE_SNIPPET,
        });
      }
    }

    findings.push(...detectUnquotedEnvApiKeys(content, filePath, lineNum, lineText, securityIgnore));
    findings.push(...detectHighEntropyStrings(content, filePath, lineNum, lineText, securityIgnore));
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
