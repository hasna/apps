import { readFileSync, statSync } from "node:fs";
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
}

export interface ExtractResult {
  /** All comments found */
  comments: ExtractedComment[];
  /** Tasks created (empty if dry_run) */
  tasks: Task[];
  /** Number of duplicates skipped */
  skipped: number;
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(regex);
    if (match) {
      const tag = match[1]!.toUpperCase() as ExtractTag;
      let message = match[2]!.trim();
      // Strip trailing comment closers
      message = message.replace(/\s*\*\/\s*$/, "").replace(/\s*-->\s*$/, "").replace(/\s*-\}\s*$/, "").trim();
      if (message) {
        results.push({
          tag,
          message,
          file: filePath,
          line: i + 1,
          raw: line,
        });
      }
    }
  }

  return results;
}

/**
 * Recursively collect file paths to scan using Bun.Glob.
 */
function collectFiles(basePath: string, extensions: Set<string>): string[] {
  const stat = statSync(basePath);
  if (stat.isFile()) {
    return [basePath];
  }

  const glob = new Bun.Glob("**/*");
  const files: string[] = [];

  for (const entry of glob.scanSync({ cwd: basePath, onlyFiles: true, dot: false })) {
    // Skip dirs
    const parts = entry.split("/");
    if (parts.some((p) => SKIP_DIRS.has(p))) continue;

    // Check extension
    const dotIdx = entry.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const ext = entry.slice(dotIdx);
    if (!extensions.has(ext)) continue;

    files.push(entry);
  }

  return files.sort();
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

  const files = collectFiles(basePath, extensions);
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
    return { comments: allComments, tasks: [], skipped: 0 };
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
    if (meta?.["source_file"] && meta?.["source_line"]) {
      existingKeys.add(`${meta["source_file"]}:${meta["source_line"]}`);
    }
  }

  for (const comment of allComments) {
    const dedupKey = `${comment.file}:${comment.line}`;
    if (existingKeys.has(dedupKey)) {
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
  }

  return { comments: allComments, tasks, skipped };
}
