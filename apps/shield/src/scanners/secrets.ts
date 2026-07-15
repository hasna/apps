import * as fs from "fs";
import * as path from "path";
import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  DEFAULT_CONFIG,
} from "../types/index.js";
import { recognizeCredentialText } from "../lib/credential-recognition.js";

export { SECRET_PATTERNS, shannonEntropy } from "../lib/credential-recognition.js";
export type { CredentialPattern as SecretPattern } from "../lib/credential-recognition.js";

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
      throw new Error("Unable to traverse the requested scan target");
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
      } else if (entry.isSymbolicLink()) {
        throw new Error("Symbolic links are not included in a verified file-only scan");
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

function isTrustedGitHubWorkflowFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const marker = "/.github/workflows/";
  const relative = normalized.startsWith(".github/workflows/")
    ? normalized.slice(".github/workflows/".length)
    : normalized.includes(marker)
      ? normalized.slice(normalized.lastIndexOf(marker) + marker.length)
      : "";
  return relative.length > 0 && !relative.includes("/") && /\.ya?ml$/.test(relative);
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

// --- Scanner ---

export function scanFile(
  filePath: string,
  content: string,
  verifiedSourcePath?: string,
): FindingInput[] {
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

    for (const recognition of recognizeCredentialText(lineText, {
      envLike: isEnvLikeFile(verifiedSourcePath ?? filePath),
      trustedGitHubWorkflowFile:
        verifiedSourcePath != null && isTrustedGitHubWorkflowFile(verifiedSourcePath),
    })) {
      if (isFindingSuppressedBySecurityIgnore(securityIgnore, recognition.index)) continue;
      findings.push({
        rule_id: recognition.rule.id,
        scanner_type: ScannerType.Secrets,
        severity: recognition.rule.severity,
        file: filePath,
        line: lineNum,
        column: recognition.index + 1,
        message: `${recognition.rule.name} detected`,
        code_snippet: REDACTED_CODE_SNIPPET,
      });
    }
  }

  return findings;
}

export const secretsScanner: Scanner = {
  name: "Secrets Scanner",
  type: ScannerType.Secrets,
  description: "Detects hardcoded secrets, API keys, tokens, and high-entropy strings in source code",

  async scan(scanPath: string, options?: ScannerRunOptions): Promise<FindingInput[]> {
    const ignorePatterns = options?.ignore_patterns ?? DEFAULT_CONFIG.ignore_patterns;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(scanPath);
    } catch {
      throw new Error("Unable to stat the requested scan target");
    }
    if (stat.isSymbolicLink()) {
      throw new Error("Symbolic links are not included in a verified file-only scan");
    }
    const files = stat.isFile()
      ? isBinaryFile(scanPath) ? [] : [scanPath]
      : stat.isDirectory()
        ? walkDirectory(scanPath, ignorePatterns)
        : (() => { throw new Error("Requested scan target is not a regular file or directory"); })();
    const findings: FindingInput[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const relativePath = stat.isFile() ? path.basename(file) : path.relative(scanPath, file);
        findings.push(...scanFile(relativePath, content, file));
      } catch {
        throw new Error("Unable to read every requested scan file");
      }
    }

    return findings;
  },
};

export default secretsScanner;
