import { createHash, randomUUID } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import type { Database } from 'bun:sqlite';
import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';

export type SafetyDecision = 'allow' | 'deny' | 'requires_approval';

export interface SafetyPolicy {
  mode: 'local' | 'hosted';
  allowWriteRoots: string[];
  readOnlySourceAccess: boolean;
  network: {
    webSearchEnabled: boolean;
    s3ReadsEnabled: boolean;
    allowedS3Buckets: string[];
  };
  redaction: {
    enabled: boolean;
  };
  approvals: {
    generatedWritesRequireApproval: boolean;
  };
}

export interface SafetyAuditInput {
  event_type: string;
  action: string;
  target_uri?: string | null;
  decision: SafetyDecision | 'redacted' | 'info';
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface RedactionFinding {
  type: string;
  severity: 'low' | 'medium' | 'high';
  start: number;
  end: number;
}

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
}

type ConfigWithSafety = KnowledgeConfig & {
  safety?: {
    network?: {
      web_search_enabled?: boolean;
      s3_reads_enabled?: boolean;
      allowed_s3_buckets?: string[];
    };
    redaction?: {
      enabled?: boolean;
    };
    approvals?: {
      generated_writes_require_approval?: boolean;
    };
  };
};

function envEnabled(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value === 'true' || value === 'yes';
}

function configOrEnvEnabled(value: boolean | undefined, envName: string): boolean {
  return value === true || envEnabled(envName);
}

export function resolveSafetyPolicy(config: KnowledgeConfig, workspace: KnowledgeWorkspace): SafetyPolicy {
  const extended = config as ConfigWithSafety;
  const configuredBuckets = new Set<string>(extended.safety?.network?.allowed_s3_buckets ?? []);
  if (config.storage.type === 's3' && config.storage.s3?.bucket) configuredBuckets.add(config.storage.s3.bucket);
  if (process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS) {
    for (const bucket of process.env.HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      configuredBuckets.add(bucket);
    }
  }
  return {
    mode: config.mode,
    allowWriteRoots: [
      workspace.home,
      workspace.artifactsDir,
      workspace.cacheDir,
      workspace.exportsDir,
      workspace.indexesDir,
      workspace.logsDir,
      workspace.runsDir,
      workspace.schemasDir,
      workspace.wikiDir,
    ].map((entry) => resolve(entry)),
    readOnlySourceAccess: true,
    network: {
      webSearchEnabled: configOrEnvEnabled(extended.safety?.network?.web_search_enabled, 'HASNA_KNOWLEDGE_WEB_SEARCH'),
      s3ReadsEnabled: configOrEnvEnabled(extended.safety?.network?.s3_reads_enabled, 'HASNA_KNOWLEDGE_ALLOW_S3_READS'),
      allowedS3Buckets: [...configuredBuckets].sort(),
    },
    redaction: {
      enabled: extended.safety?.redaction?.enabled ?? true,
    },
    approvals: {
      generatedWritesRequireApproval: extended.safety?.approvals?.generated_writes_require_approval ?? true,
    },
  };
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export function assertWriteAllowed(targetPath: string, policy: SafetyPolicy): void {
  const resolved = resolve(targetPath);
  if (!policy.allowWriteRoots.some((root) => isInside(root, resolved))) {
    throw new Error(`Safety policy denied write outside .hasna/knowledge: ${targetPath}`);
  }
}

export function assertS3ReadAllowed(uri: string, policy: SafetyPolicy): void {
  const parsed = new URL(uri);
  const bucket = parsed.hostname;
  if (!policy.network.s3ReadsEnabled) {
    throw new Error('Safety policy denied S3 read. Set safety.network.s3_reads_enabled=true or HASNA_KNOWLEDGE_ALLOW_S3_READS=1.');
  }
  if (!policy.network.allowedS3Buckets.includes(bucket)) {
    throw new Error(`Safety policy denied S3 bucket "${bucket}". Add it to safety.network.allowed_s3_buckets or HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS.`);
  }
}

export function assertWebSearchAllowed(policy: SafetyPolicy): void {
  if (!policy.network.webSearchEnabled) {
    throw new Error('Safety policy denied web search. Set safety.network.web_search_enabled=true or HASNA_KNOWLEDGE_WEB_SEARCH=1.');
  }
}

const REDACTION_PATTERNS: Array<{ type: string; severity: RedactionFinding['severity']; regex: RegExp; replacement: string }> = [
  { type: 'private_key_block', severity: 'high', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED:private_key_block]' },
  { type: 'secret_assignment', severity: 'high', regex: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi, replacement: '[REDACTED:secret_assignment]' },
  { type: 'openai_api_key', severity: 'high', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED:openai_api_key]' },
  { type: 'anthropic_api_key', severity: 'high', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED:anthropic_api_key]' },
  { type: 'aws_access_key_id', severity: 'high', regex: /\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g, replacement: '[REDACTED:aws_access_key_id]' },
];

export function redactSecrets(text: string, policy?: Pick<SafetyPolicy, 'redaction'>): RedactionResult {
  if (policy && !policy.redaction.enabled) return { text, findings: [] };
  let output = text;
  const findings: RedactionFinding[] = [];
  for (const pattern of REDACTION_PATTERNS) {
    output = output.replace(pattern.regex, (match, ...args) => {
      const offset = typeof args.at(-2) === 'number' ? args.at(-2) as number : output.indexOf(match);
      findings.push({
        type: pattern.type,
        severity: pattern.severity,
        start: Math.max(0, offset),
        end: Math.max(0, offset + match.length),
      });
      return pattern.replacement;
    });
  }
  return { text: output, findings };
}

export function auditId(input: SafetyAuditInput): string {
  return `audit_${createHash('sha256')
    .update(`${input.event_type}\u0000${input.action}\u0000${input.target_uri ?? ''}\u0000${input.created_at ?? ''}\u0000${JSON.stringify(input.metadata ?? {})}\u0000${randomUUID()}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function truncateAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Truncated:depth]';
  if (typeof value === 'string') {
    return value.length > 1000 ? `${value.slice(0, 1000)}...[Truncated:${value.length - 1000} chars]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const entries = value.slice(0, 25).map((entry) => truncateAuditMetadata(entry, depth + 1));
    if (value.length > 25) entries.push(`[Truncated:${value.length - 25} items]`);
    return entries;
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50);
    for (const [key, entry] of entries) output[key] = truncateAuditMetadata(entry, depth + 1);
    const total = Object.keys(value as Record<string, unknown>).length;
    if (total > entries.length) output.__truncated_keys = total - entries.length;
    return output;
  }
  return String(value);
}

export function recordAuditEvent(db: Database, input: SafetyAuditInput): string {
  const createdAt = input.created_at ?? new Date().toISOString();
  const metadata = truncateAuditMetadata(input.metadata ?? {});
  const id = auditId({ ...input, metadata: metadata as Record<string, unknown>, created_at: createdAt });
  db.run(
    `INSERT INTO audit_events (id, event_type, action, target_uri, decision, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.event_type,
      input.action,
      input.target_uri ?? null,
      input.decision,
      JSON.stringify(metadata),
      createdAt,
    ],
  );
  return id;
}

export function recordRedactionFindings(db: Database, input: {
  source_uri?: string | null;
  run_id?: string | null;
  findings: RedactionFinding[];
  metadata?: Record<string, unknown>;
  created_at?: string;
}): number {
  const createdAt = input.created_at ?? new Date().toISOString();
  for (const finding of input.findings) {
    db.run(
      `INSERT INTO redaction_findings (id, source_uri, run_id, severity, finding_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `redact_${randomUUID()}`,
        input.source_uri ?? null,
        input.run_id ?? null,
        finding.severity,
        finding.type,
        JSON.stringify({ ...(input.metadata ?? {}), start: finding.start, end: finding.end }),
        createdAt,
      ],
    );
  }
  return input.findings.length;
}

export function createApprovalGate(db: Database, input: {
  action: string;
  target_uri?: string | null;
  reason?: string | null;
  approved_by?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
}): { id: string; status: 'approved' } {
  const now = input.created_at ?? new Date().toISOString();
  const id = `approval_${randomUUID()}`;
  db.run(
    `INSERT INTO approval_gates (id, action, target_uri, status, reason, approved_by, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.action,
      input.target_uri ?? null,
      'approved',
      input.reason ?? null,
      input.approved_by ?? 'local-cli',
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    ],
  );
  return { id, status: 'approved' };
}

export function hasApproval(db: Database, action: string, targetUri?: string | null): boolean {
  const row = db.query<{ id: string }, [string, string | null, string | null]>(
    `SELECT id FROM approval_gates
     WHERE action = ? AND status = 'approved' AND (target_uri IS NULL OR target_uri = ? OR ? IS NULL)
     ORDER BY updated_at DESC LIMIT 1`,
  ).get(action, targetUri ?? null, targetUri ?? null);
  return Boolean(row);
}

export function approvalStatus(db: Database, policy: SafetyPolicy, action: string, targetUri?: string | null): {
  action: string;
  target_uri: string | null;
  approval_required: boolean;
  approved: boolean;
  decision: SafetyDecision;
} {
  const approvalRequired = action === 'generated_write' && policy.approvals.generatedWritesRequireApproval;
  const approved = !approvalRequired || hasApproval(db, action, targetUri);
  return {
    action,
    target_uri: targetUri ?? null,
    approval_required: approvalRequired,
    approved,
    decision: approved ? 'allow' : 'requires_approval',
  };
}
