import { createHash } from 'node:crypto';
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

const FILE_URI_RE = /file:\/\/[^\s"'<>),\]}]+/gi;
const ABSOLUTE_HASNA_PATH_RE = /\/[^\s"'<>),\]}]*\.hasna\/[^\s"'<>),\]}]*/g;
const ABSOLUTE_LOCAL_PATH_RE = /\/(?:home|tmp)\/[^\s"'<>),\]}]+/g;
const HASNA_PATH_RE = /(?:~|\/home\/[^/\s"'<>]+)?\/?\.hasna(?:\/[^\s"'<>),\]}]*)?/gi;
const PRIVATE_WORKSPACE_PATH_RE = /\/home\/[^/\s"'<>]+\/(?:workspace|Workspace)\/[^\s"'<>),\]}]*/g;
const RAW_DB_OR_ENV_RE = /\b(?:knowledge\.db(?:[-.][A-Za-z0-9_-]+)?|db\.json(?:[-.][A-Za-z0-9_-]+)?|cloud\.env|migration-exports\/[^\s"'<>),\]}]+)\b/gi;
const DATABASE_URL_RE = /\b(?:postgres(?:ql)?|mysql|mariadb):\/\/[^\s"'<>),\]}]+/gi;
const OPAQUE_EXPORT_KEYS = new Set(['content_base64']);

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
  return redactSecrets(value).text
    .replace(DATABASE_URL_RE, (match) => `[REDACTED:database-url:${fingerprint(match)}]`)
    .replace(FILE_URI_RE, (match) => `[REDACTED:local-file-uri:${fingerprint(match)}]`)
    .replace(ABSOLUTE_HASNA_PATH_RE, (match) => `[REDACTED:local-hasna-path:${fingerprint(match)}]`)
    .replace(PRIVATE_WORKSPACE_PATH_RE, (match) => `[REDACTED:private-workspace:${fingerprint(match)}]`)
    .replace(ABSOLUTE_LOCAL_PATH_RE, (match) => `[REDACTED:local-path:${fingerprint(match)}]`)
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
