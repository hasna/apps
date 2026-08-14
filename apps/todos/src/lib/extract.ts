import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve, join } from "node:path";
import { createTask, listTasks } from "../db/tasks.js";
import { addTaskFile } from "../db/task-files.js";
import type { Task, TaskPriority } from "../types/index.js";
import type { Database } from "bun:sqlite";

// Supported comment tag types
export const EXTRACT_TAGS = ["TODO", "FIXME", "HACK", "XXX", "BUG", "NOTE"] as const;
export type ExtractTag = (typeof EXTRACT_TAGS)[number];

export interface ExtractedComment {
  tag: ExtractTag;
  message: string;
  file: string;       // relative path
  line: number;
  /** Full line content from the source file */
  raw: string;
  /** Stable fingerprint used to dedupe across line moves */
  fingerprint: string;
  /** Nearest enclosing or preceding symbol, when recognized locally */
  symbol?: string;
  symbol_kind?: SourceSymbolKind;
}

export type SourceSymbolKind = "function" | "class" | "interface" | "type" | "variable" | "method";

export interface SourceSymbol {
  name: string;
  kind: SourceSymbolKind;
  file: string;
  line: number;
  raw: string;
}

export interface SourceIndexFile {
  file: string;
  checksum: string;
  symbols: SourceSymbol[];
  comments: ExtractedComment[];
}

export interface CodebaseIndex {
  root: string;
  generated_at: string;
  files: SourceIndexFile[];
  total_comments: number;
  total_symbols: number;
  respects_gitignore: boolean;
  excludes: string[];
}

export interface ExtractOptions {
  /** Directory or file to scan */
  path: string;
  /** Comment tags to look for (default: all) */
  patterns?: ExtractTag[];
  /** Project ID to assign tasks to */
  project_id?: string;
  /** Task list ID */
  task_list_id?: string;
  /** Extra tags to add to created tasks */
  tags?: string[];
  /** Agent to assign tasks to */
  assigned_to?: string;
  /** Agent ID performing the extraction */
  agent_id?: string;
  /** If true, return extracted comments without creating tasks */
  dry_run?: boolean;
  /** File extensions to scan (default: common code extensions) */
  extensions?: string[];
  /** Extra glob-ish path patterns to exclude */
  exclude?: string[];
  /** Respect .gitignore files from the scanned root (default true) */
  respect_gitignore?: boolean;
  /** Include a local codebase index in the result */
  include_index?: boolean;
}

export interface ExtractResult {
  /** All comments found */
  comments: ExtractedComment[];
  /** Tasks created (empty if dry_run) */
  tasks: Task[];
  /** Number of duplicates skipped */
  skipped: number;
  /** Local codebase index, when requested */
  index?: CodebaseIndex;
}

export interface WatchSourceTodosOptions extends ExtractOptions {
  /** Poll interval for repeated local scans */
  interval_ms?: number;
  /** Run a single scan and return */
  once?: boolean;
  /** Maximum scans before returning. Defaults to 1 when once=true, otherwise Infinity. */
  max_runs?: number;
}

export interface SourceTodoWatchRun {
  run: number;
  scanned_at: string;
  changed_files: string[];
  result: ExtractResult;
}

export interface SourceTodoWatchResult {
  root: string;
  interval_ms: number;
  runs: SourceTodoWatchRun[];
}

const DEFAULT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".c", ".cpp", ".h", ".hpp",
  ".java", ".kt", ".swift", ".cs", ".php",
  ".sh", ".bash", ".zsh",
  ".lua", ".sql", ".r", ".R",
  ".yaml", ".yml", ".toml",
  ".css", ".scss", ".less",
  ".vue", ".svelte",
  ".ex", ".exs", ".erl", ".hs",
  ".ml", ".mli", ".clj", ".cljs",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  ".turbo", "coverage", "__pycache__", ".venv", "venv",
  "vendor", "target", ".cache", ".parcel-cache",
]);

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readGitignorePatterns(basePath: string): string[] {
  const root = statSync(basePath).isFile() ? resolve(basePath, "..") : basePath;
  const gitignorePath = join(root, ".gitignore");
  if (!existsSync(gitignorePath)) return [];
  try {
    return readFileSync(gitignorePath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
  } catch {
    return [];
  }
}

function patternToRegex(pattern: string): RegExp {
  const normalized = normalizePathForMatch(pattern.trim()).replace(/\/$/, "");
  const anchored = normalized.startsWith("/");
  const body = (anchored ? normalized.slice(1) : normalized)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const prefix = anchored ? "^" : "(^|.*/)";
  const suffix = pattern.endsWith("/") ? "(/.*)?$" : "($|/.*$)";
  return new RegExp(`${prefix}${body}${suffix}`);
}

function matchesAnyPattern(path: string, patterns: string[]): boolean {
  const normalized = normalizePathForMatch(path);
  return patterns.some((pattern) => patternToRegex(pattern).test(normalized));
}

function sourceFingerprint(file: string, tag: ExtractTag, message: string, symbol: string | undefined): string {
  return stableHash(`${file}\0${tag}\0${message.trim().toLowerCase()}\0${symbol || ""}`).slice(0, 24);
}

function extractSymbols(source: string, filePath: string): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const lines = source.split("\n");
  const patterns: Array<[SourceSymbolKind, RegExp]> = [
    ["class", /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/],
    ["interface", /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/],
    ["type", /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/],
    ["function", /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/],
    ["function", /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/],
    ["variable", /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/],
    ["function", /^\s*def\s+([A-Za-z_]\w*)\s*\(/],
    ["class", /^\s*class\s+([A-Za-z_]\w*)/],
    ["method", /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/],
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const [kind, pattern] of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        symbols.push({ name: match[1], kind, file: filePath, line: i + 1, raw: line.trim() });
        break;
      }
    }
  }
  return symbols;
}

function nearestSymbol(symbols: SourceSymbol[], line: number): SourceSymbol | undefined {
  let current: SourceSymbol | undefined;
  for (const symbol of symbols) {
    if (symbol.line > line) break;
    current = symbol;
  }
  return current;
}

/** Priority mapping from comment tag */
export function tagToPriority(tag: ExtractTag): TaskPriority {
  switch (tag) {
    case "BUG":
    case "FIXME":
      return "high";
    case "HACK":
    case "XXX":
      return "medium";
    case "TODO":
      return "medium";
    case "NOTE":
      return "low";
  }
}

/**
 * Regex that matches comment lines containing a known tag.
 * Handles: // TAG:, # TAG:, /* TAG:, -- TAG:, ;; TAG:
 * The colon after the tag is optional.
 */
function buildTagRegex(tags: ExtractTag[]): RegExp {
  const tagPattern = tags.join("|");
  // Match: optional comment prefix, then TAG optionally followed by colon/paren, then the message
  // Comment prefixes: //, /*, #, *, --, ;;, %, <!--, {-
  return new RegExp(
    `(?:^|\\s)(?:\\/\\/|\\/\\*|#|\\*|--|;;|%|<!--|\\{-)\\s*(?:@?)(${tagPattern})\\s*[:(]?\\s*(.*)$`,
    "i",
  );
}

/**
 * Extract TODO-style comments from a single file's contents.
 */
export function extractFromSource(
  source: string,
  filePath: string,
  tags: ExtractTag[] = [...EXTRACT_TAGS],
): ExtractedComment[] {
  const regex = buildTagRegex(tags);
  const results: ExtractedComment[] = [];
  const lines = source.split("\n");
  const symbols = extractSymbols(source, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(regex);
    if (match) {
      const tag = match[1]!.toUpperCase() as ExtractTag;
      let message = match[2]!.trim();
      // Strip trailing comment closers
      message = message.replace(/\s*\*\/\s*$/, "").replace(/\s*-->\s*$/, "").replace(/\s*-\}\s*$/, "").trim();
      if (message) {
        const symbol = nearestSymbol(symbols, i + 1);
        results.push({
          tag,
          message,
          file: filePath,
          line: i + 1,
          raw: line,
          fingerprint: sourceFingerprint(filePath, tag, message, symbol?.name),
          symbol: symbol?.name,
          symbol_kind: symbol?.kind,
        });
      }
    }
  }

  return results;
}

/**
 * Recursively collect file paths to scan using Bun.Glob.
 */
function collectFiles(basePath: string, extensions: Set<string>, excludes: string[], respectGitignore: boolean): string[] {
  const stat = statSync(basePath);
  if (stat.isFile()) {
    return [basePath];
  }

  const glob = new Bun.Glob("**/*");
  const files: string[] = [];
  const ignorePatterns = respectGitignore ? readGitignorePatterns(basePath) : [];
  const allExcludes = [...ignorePatterns, ...excludes];

  for (const entry of glob.scanSync({ cwd: basePath, onlyFiles: true, dot: false })) {
    // Skip dirs
    const parts = entry.split("/");
    if (parts.some((p) => SKIP_DIRS.has(p))) continue;
    if (matchesAnyPattern(entry, allExcludes)) continue;

    // Check extension
    const dotIdx = entry.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const ext = entry.slice(dotIdx);
    if (!extensions.has(ext)) continue;

    files.push(entry);
  }

  return files.sort();
}

export function buildCodebaseIndex(options: ExtractOptions): CodebaseIndex {
  const basePath = resolve(options.path);
  const tags = options.patterns || [...EXTRACT_TAGS];
  const extensions = options.extensions
    ? new Set(options.extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
    : DEFAULT_EXTENSIONS;
  const excludes = options.exclude || [];
  const respectGitignore = options.respect_gitignore !== false;
  const files = collectFiles(basePath, extensions, excludes, respectGitignore);
  const indexed: SourceIndexFile[] = [];

  for (const file of files) {
    const fullPath = statSync(basePath).isFile() ? basePath : join(basePath, file);
    try {
      const source = readFileSync(fullPath, "utf-8");
      const relPath = statSync(basePath).isFile() ? relative(resolve(basePath, ".."), fullPath) : file;
      indexed.push({
        file: relPath,
        checksum: stableHash(source).slice(0, 24),
        symbols: extractSymbols(source, relPath),
        comments: extractFromSource(source, relPath, tags),
      });
    } catch {
      // Skip unreadable files (binary, permissions, etc.)
    }
  }

  return {
    root: basePath,
    generated_at: "1970-01-01T00:00:00.000Z",
    files: indexed,
    total_comments: indexed.reduce((sum, file) => sum + file.comments.length, 0),
    total_symbols: indexed.reduce((sum, file) => sum + file.symbols.length, 0),
    respects_gitignore: respectGitignore,
    excludes,
  };
}

/**
 * Scan a directory or file for TODO-style comments and optionally create tasks.
 */
export function extractTodos(options: ExtractOptions, db?: Database): ExtractResult {
  const basePath = resolve(options.path);
  const tags = options.patterns || [...EXTRACT_TAGS];
  const extensions = options.extensions
    ? new Set(options.extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
    : DEFAULT_EXTENSIONS;
  const excludes = options.exclude || [];
  const respectGitignore = options.respect_gitignore !== false;

  const files = collectFiles(basePath, extensions, excludes, respectGitignore);
  const allComments: ExtractedComment[] = [];

  for (const file of files) {
    const fullPath = statSync(basePath).isFile() ? basePath : join(basePath, file);
    try {
      const source = readFileSync(fullPath, "utf-8");
      const relPath = statSync(basePath).isFile() ? relative(resolve(basePath, ".."), fullPath) : file;
      const comments = extractFromSource(source, relPath, tags);
      allComments.push(...comments);
    } catch {
      // Skip unreadable files (binary, permissions, etc.)
    }
  }

  if (options.dry_run) {
    return {
      comments: allComments,
      tasks: [],
      skipped: 0,
      index: options.include_index ? buildCodebaseIndex(options) : undefined,
    };
  }

  // Create tasks, deduplicating against existing ones
  const tasks: Task[] = [];
  let skipped = 0;

  // Load existing tasks with "extracted" tag for dedup
  const existingTasks = options.project_id
    ? listTasks({ project_id: options.project_id, tags: ["extracted"] }, db)
    : listTasks({ tags: ["extracted"] }, db);

  // Build a dedup set from existing tasks' metadata
  const existingKeys = new Set<string>();
  for (const t of existingTasks) {
    const meta = t.metadata;
    if (meta?.["source_fingerprint"]) {
      existingKeys.add(String(meta["source_fingerprint"]));
    } else if (meta?.["source_file"] && meta?.["source_line"]) {
      existingKeys.add(`${meta["source_file"]}:${meta["source_line"]}`);
    }
  }

  for (const comment of allComments) {
    const dedupKey = comment.fingerprint;
    const legacyDedupKey = `${comment.file}:${comment.line}`;
    if (existingKeys.has(dedupKey) || existingKeys.has(legacyDedupKey)) {
      skipped++;
      continue;
    }

    const taskTags = ["extracted", comment.tag.toLowerCase(), ...(options.tags || [])];
    const task = createTask(
      {
        title: `[${comment.tag}] ${comment.message}`,
        description: `Extracted from code comment in \`${comment.file}\` at line ${comment.line}:\n\`\`\`\n${comment.raw.trim()}\n\`\`\``,
        priority: tagToPriority(comment.tag),
        project_id: options.project_id,
        task_list_id: options.task_list_id,
        assigned_to: options.assigned_to,
        agent_id: options.agent_id,
        tags: taskTags,
        metadata: {
          source: "code_comment",
          comment_type: comment.tag,
          source_file: comment.file,
          source_line: comment.line,
          source_symbol: comment.symbol,
          source_symbol_kind: comment.symbol_kind,
          source_fingerprint: comment.fingerprint,
        },
      },
      db,
    );

    // Link the source file to the task
    addTaskFile(
      {
        task_id: task.id,
        path: comment.file,
        note: `Line ${comment.line}: ${comment.tag} comment`,
      },
      db,
    );

    tasks.push(task);
    existingKeys.add(dedupKey);
    existingKeys.add(legacyDedupKey);
  }

  return {
    comments: allComments,
    tasks,
    skipped,
    index: options.include_index ? buildCodebaseIndex(options) : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function snapshotFiles(options: ExtractOptions): Map<string, string> {
  const index = buildCodebaseIndex({ ...options, include_index: false });
  return new Map(index.files.map((file) => [file.file, file.checksum]));
}

function changedFiles(previous: Map<string, string>, next: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [file, checksum] of next) {
    if (previous.get(file) !== checksum) changed.add(file);
  }
  for (const file of previous.keys()) {
    if (!next.has(file)) changed.add(file);
  }
  return [...changed].sort();
}

export async function watchSourceTodos(
  options: WatchSourceTodosOptions,
  onRun?: (run: SourceTodoWatchRun) => void | Promise<void>,
): Promise<SourceTodoWatchResult> {
  const interval = Math.max(100, options.interval_ms || 2000);
  const once = options.once !== false && (!options.max_runs || options.max_runs <= 1);
  const maxRuns = options.max_runs ?? (once ? 1 : Number.POSITIVE_INFINITY);
  const root = resolve(options.path);
  const runs: SourceTodoWatchRun[] = [];
  let previous = new Map<string, string>();

  for (let runNumber = 1; runNumber <= maxRuns; runNumber++) {
    const next = snapshotFiles(options);
    const changed = runNumber === 1 ? [...next.keys()].sort() : changedFiles(previous, next);
    previous = next;
    if (changed.length > 0 || runNumber === 1) {
      const result = extractTodos(options);
      const run: SourceTodoWatchRun = {
        run: runNumber,
        scanned_at: "1970-01-01T00:00:00.000Z",
        changed_files: changed,
        result,
      };
      runs.push(run);
      await onRun?.(run);
    }
    if (runNumber >= maxRuns) break;
    await sleep(interval);
  }

  return { root, interval_ms: interval, runs };
}
