import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { redactSecrets } from './safety';

export type PrivateRefIssueSeverity = 'medium' | 'high';

export interface PrivateRefLintIssue {
  type: string;
  severity: PrivateRefIssueSeverity;
  path: string;
  preview: string;
}

export interface PrivateRefLintOptions {
  allowFileSourceRefs?: boolean;
  allowPrivateWorkspaceRefs?: boolean;
}

/** Characters that terminate a filesystem reference inside serialized JSON, log
 * lines, and Markdown. Shared by every path pattern so redaction boundaries stay
 * consistent across OS families. */
const PATH_TAIL = String.raw`[^\s"'<>),\]}]`;
/** A single path segment: a user name, host name, or directory. */
const PATH_SEGMENT = String.raw`[^/\\\s"'<>]+`;

const FILE_URI_RE = /file:\/\/[^\s"'<>),\]}]+/gi;
const ABSOLUTE_HASNA_PATH_RE = /\/[^\s"'<>),\]}]*\.hasna\/[^\s"'<>),\]}]*/g;
const HASNA_PATH_RE = /(?:~|\/(?:home|Users)\/[^/\s"'<>]+)?\/?\.hasna(?:\/[^\s"'<>),\]}]*)?/gi;
const PRIVATE_WORKSPACE_PATH_RE = new RegExp(
  String.raw`/(?:home|Users)/${PATH_SEGMENT}/(?:workspace|Workspace)/${PATH_TAIL}*`,
  'g',
);

/**
 * Absolute local filesystem shapes, independent of the OS that produced them.
 *
 * These MUST NOT be narrowed to the exporting host's own OS. A bundle exported on
 * macOS or Windows has to redact as thoroughly as one exported on Linux, and rows
 * pulled from a peer can carry paths from a different OS than the machine doing the
 * export. Matching only /home and /tmp is what let macOS temp paths
 * (/var/folders/...) and macOS home paths (/Users/...) reach exported bundles
 * intact — a leak that reproduced solely on the macOS CI runners.
 */
const LOCAL_PATH_PATTERNS: readonly RegExp[] = [
  // POSIX home directories: Linux /home/<user>, macOS /Users/<user>.
  new RegExp(String.raw`/(?:home|Users)/${PATH_SEGMENT}(?:/${PATH_TAIL}*)?`, 'g'),
  // macOS per-user temp dirs, both as os.tmpdir() reports them (/var/folders/...)
  // and as realpath resolves them (/private/var/folders/...).
  new RegExp(String.raw`(?:/private)?/var/(?:folders|tmp)/${PATH_TAIL}+`, 'g'),
  // POSIX temp, plus the macOS /private realpath spelling.
  new RegExp(String.raw`(?:/private)?/tmp/${PATH_TAIL}+`, 'g'),
  // Windows drive-absolute paths (C:\... and C:/...). The lookbehind keeps URL
  // schemes such as https:// and s3:// from being read as a single-letter drive.
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]${PATH_TAIL}+`, 'g'),
  // Windows UNC shares (\\host\share\...).
  new RegExp(String.raw`\\\\${PATH_SEGMENT}\\${PATH_TAIL}+`, 'g'),
];
const RAW_DB_OR_ENV_RE = /\b(?:knowledge\.db(?:[-.][A-Za-z0-9_-]+)?|db\.json(?:[-.][A-Za-z0-9_-]+)?|cloud\.env|migration-exports\/[^\s"'<>),\]}]+)\b/gi;
const DATABASE_URL_RE = /\b(?:postgres(?:ql)?|mysql|mariadb):\/\/[^\s"'<>),\]}]+/gi;
const OPAQUE_EXPORT_KEYS = new Set(['content_base64']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A root broad enough to swallow unrelated text is worse than no pattern at all,
 * so degenerate roots ("/", "C:\") are refused rather than turned into patterns. */
function isUsableRoot(root: string): boolean {
  return root.length >= 4 && root !== '/' && !/^[A-Za-z]:[\\/]?$/.test(root);
}

let hostRootCacheKey: string | null = null;
let hostRootCache: readonly RegExp[] = [];

/**
 * Patterns for the running host's own home and temp roots.
 *
 * The OS is the source of truth for where this machine keeps private files, so the
 * roots are read from it rather than hardcoded. This is what covers hosts whose
 * roots match none of the conventional shapes above — a container with
 * HOME=/github/home, or TMPDIR pointed at a scratch volume. Both the reported and
 * the realpath-resolved spelling are covered because macOS reports tmpdir as
 * /var/folders/... while resolving it to /private/var/folders/...
 */
function hostRootPatterns(): readonly RegExp[] {
  const roots = new Set<string>();
  for (const root of [homedir(), tmpdir()]) {
    if (!root) continue;
    roots.add(root);
    try {
      roots.add(realpathSync(root));
    } catch {
      // An unresolvable root still gets its reported spelling covered above.
    }
  }
  const key = [...roots].sort().join('\u0000');
  if (key === hostRootCacheKey) return hostRootCache;
  hostRootCacheKey = key;
  hostRootCache = [...roots]
    .filter(isUsableRoot)
    .sort((a, b) => b.length - a.length)
    .map((root) => new RegExp(`${escapeRegExp(root)}(?:[/\\\\]${PATH_TAIL}*)?`, 'g'));
  return hostRootCache;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function preview(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 77)}...`;
}

function includesPrivateKnowledgeArtifact(value: string): boolean {
  return /(?:^|\/)\.hasna(?:\/|$)/i.test(value)
    || /\b(?:knowledge\.db|db\.json|cloud\.env)\b/i.test(value)
    || /\bmigration-exports\//i.test(value);
}

function addStringIssues(value: string, path: string, options: PrivateRefLintOptions, issues: PrivateRefLintIssue[]): void {
  for (const match of value.matchAll(FILE_URI_RE)) {
    const uri = match[0];
    if (!options.allowFileSourceRefs || includesPrivateKnowledgeArtifact(uri)) {
      issues.push({
        type: includesPrivateKnowledgeArtifact(uri) ? 'private_file_uri' : 'local_file_uri',
        severity: 'high',
        path,
        preview: preview(uri.replace(/^file:\/\/.*/, `[redacted:file-uri:${fingerprint(uri)}]`)),
      });
    }
  }

  for (const match of value.matchAll(HASNA_PATH_RE)) {
    issues.push({
      type: 'private_hasna_path',
      severity: 'high',
      path,
      preview: `[redacted:.hasna:${fingerprint(match[0])}]`,
    });
  }

  for (const match of value.matchAll(RAW_DB_OR_ENV_RE)) {
    issues.push({
      type: match[0].toLowerCase() === 'cloud.env' ? 'workspace_env_file' : 'raw_database_or_export_ref',
      severity: 'high',
      path,
      preview: `[redacted:${fingerprint(match[0])}]`,
    });
  }

  for (const match of value.matchAll(DATABASE_URL_RE)) {
    issues.push({
      type: 'database_url',
      severity: 'high',
      path,
      preview: `[redacted:database-url:${fingerprint(match[0])}]`,
    });
  }

  if (!options.allowPrivateWorkspaceRefs) {
    for (const match of value.matchAll(PRIVATE_WORKSPACE_PATH_RE)) {
      issues.push({
        type: 'private_workspace_path',
        severity: 'medium',
        path,
        preview: `[redacted:workspace:${fingerprint(match[0])}]`,
      });
    }
  }
}

export function lintPrivateRefs(value: unknown, options: PrivateRefLintOptions = {}, path = '$'): PrivateRefLintIssue[] {
  const issues: PrivateRefLintIssue[] = [];

  const visit = (entry: unknown, entryPath: string): void => {
    if (typeof entry === 'string') {
      addStringIssues(entry, entryPath, options, issues);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${entryPath}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(entry as Record<string, unknown>)) {
      visit(item, `${entryPath}.${key}`);
    }
  };

  visit(value, path);
  return issues;
}

export function assertNoPrivateRefs(value: unknown, options: PrivateRefLintOptions = {}): void {
  const issues = lintPrivateRefs(value, options);
  if (issues.length === 0) return;
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.type, (counts.get(issue.type) ?? 0) + 1);
  const summary = [...counts.entries()].map(([type, count]) => `${type}:${count}`).join(', ');
  throw new Error(`Knowledge private-ref lint failed (${summary}). Store open-files/s3 refs or approved runtime secret refs instead of private .hasna, file://, raw DB/export, or cloud.env refs.`);
}

function redactString(value: string): string {
  // Most specific categories first, so a workspace or .hasna path keeps its own
  // label instead of being flattened into the generic local-path category.
  let text = redactSecrets(value).text
    .replace(DATABASE_URL_RE, (match) => `[REDACTED:database-url:${fingerprint(match)}]`)
    .replace(FILE_URI_RE, (match) => `[REDACTED:local-file-uri:${fingerprint(match)}]`)
    .replace(ABSOLUTE_HASNA_PATH_RE, (match) => `[REDACTED:local-hasna-path:${fingerprint(match)}]`)
    .replace(PRIVATE_WORKSPACE_PATH_RE, (match) => `[REDACTED:private-workspace:${fingerprint(match)}]`);
  for (const pattern of [...hostRootPatterns(), ...LOCAL_PATH_PATTERNS]) {
    text = text.replace(pattern, (match) => `[REDACTED:local-path:${fingerprint(match)}]`);
  }
  return text
    .replace(HASNA_PATH_RE, (match) => `[REDACTED:hasna-path:${fingerprint(match)}]`)
    .replace(RAW_DB_OR_ENV_RE, (match) => `[REDACTED:private-artifact:${fingerprint(match)}]`);
}

export function redactPrivateRefs<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as T;
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => redactPrivateRefs(entry)) as T;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = OPAQUE_EXPORT_KEYS.has(key) ? entry : redactPrivateRefs(entry);
  }
  return output as T;
}

export function privateRefRedactionCount(before: unknown, after: unknown): number {
  return JSON.stringify(before) === JSON.stringify(after) ? 0 : 1;
}
