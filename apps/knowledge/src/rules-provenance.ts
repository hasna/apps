import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ingestOpenFilesManifestItems, type ManifestIngestResult, type ManifestObject } from './manifest-ingest';
import { loadStoreIfExists, saveStore, withLock, type KnowledgeItem } from './store';
import { redactSecrets, type RedactionFinding, type SafetyPolicy } from './safety';

export type RulesProvenanceSourceFamily =
  | 'rule_doc'
  | 'codewith'
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'prompt'
  | 'plan'
  | 'legacy_json';

export type RulesProvenanceRedactionStatus = 'clean' | 'redacted' | 'refused';

export interface RulesProvenancePrecedence {
  rank: number;
  label: string;
}

export interface RulesProvenanceCitation {
  source_ref: string;
  source_path: string | null;
  line_start: number;
  line_end: number;
  content_hash: string;
}

export interface RulesProvenanceRecord {
  source_family: RulesProvenanceSourceFamily;
  title: string;
  source_path: string | null;
  source_path_ref: string;
  source_ref: string;
  owner: string;
  scope: string;
  precedence: RulesProvenancePrecedence;
  source_hash: string;
  content_hash: string;
  discovered_at: string;
  tags: string[];
  redaction_status: RulesProvenanceRedactionStatus;
  redactions: Array<Pick<RedactionFinding, 'type' | 'severity'>>;
  citations: RulesProvenanceCitation[];
  bytes: number;
  line_count: number;
  importable: boolean;
  skipped_reason: string | null;
  preview: string | null;
  legacy_json_id?: string;
}

export interface RulesProvenanceSkippedSource {
  source_family: RulesProvenanceSourceFamily;
  source_path: string;
  reason: string;
}

export interface RulesProvenanceImportOptions {
  root?: string;
  scope?: string;
  owner?: string;
  dryRun?: boolean;
  deprecateLegacy?: boolean;
  includeLegacy?: boolean;
  legacyStorePath?: string;
  dbPath?: string;
  safetyPolicy?: SafetyPolicy;
  now?: Date;
  maxItems?: number;
  limit?: number;
  maxBytesPerFile?: number;
}

export interface RulesProvenanceImportResult {
  ok: boolean;
  workflow: 'global-rules-provenance-import';
  dry_run: boolean;
  writes_performed: boolean;
  root: string;
  scope: string;
  owner: string;
  discovered_at: string;
  max_items: number;
  evidence_limit: number;
  records_seen: number;
  records_importable: number;
  records_refused: number;
  records_skipped: number;
  evidence_truncated: boolean;
  skipped_truncated: boolean;
  evidence: RulesProvenanceRecord[];
  skipped: RulesProvenanceSkippedSource[];
  import_result: ManifestIngestResult | null;
  legacy: {
    store_path: string | null;
    candidates: number;
    promoted: number;
    deprecated: number;
    data_loss: false;
  };
  message: string;
}

interface RuleSourceSpec {
  family: Exclude<RulesProvenanceSourceFamily, 'legacy_json'>;
  owner: string;
  scope: string;
  precedence: RulesProvenancePrecedence;
  tags: string[];
  include: (relativePath: string) => boolean;
}

interface FileCandidate {
  family: Exclude<RulesProvenanceSourceFamily, 'legacy_json'>;
  owner: string;
  scope: string;
  precedence: RulesProvenancePrecedence;
  tags: string[];
  absPath: string;
}

interface PreparedRecord {
  evidence: RulesProvenanceRecord;
  text: string;
  manifest: ManifestObject | null;
}

const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_EVIDENCE_LIMIT = 25;
const DEFAULT_MAX_BYTES_PER_FILE = 256 * 1024;
const WALK_MAX_DEPTH = 5;
const TEXT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.jsonc', '.toml', '.yaml', '.yml']);
const ROOT_RULE_DOCS = new Set(['CODEWITH.md', 'AGENTS.md', 'CLAUDE.md', 'RULES.md', 'INSTRUCTIONS.md']);
const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.codewith-worktrees',
  '.connect',
  '.secrets',
  '.tmp',
  'tmp',
  'auth_profiles',
  'profiles',
  'preserved',
  'backup',
  'backups',
  'cache',
  'logs',
  'runs',
]);
const SENSITIVE_PATH_RE = /(^|[._-])(secret|secrets|token|tokens|credential|credentials|password|passwd|private[_-]?key|id_rsa)([._-]|$)/i;
const SELECTED_PROMPT_OR_PLAN_RE = /(agent|rule|rules|instruction|instructions|global|operating|standard|knowledge)/i;

function sha256Text(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function sha256Bytes(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function normalizePath(value: string): string {
  return value.split(sep).join('/');
}

function relativePath(root: string, absPath: string): string {
  const rel = relative(root, absPath);
  return rel ? normalizePath(rel) : basename(absPath);
}

function isTextSource(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function hasSensitivePathPart(path: string): boolean {
  return normalizePath(path).split('/').some((part) => SENSITIVE_PATH_RE.test(part));
}

function boundedPreview(text: string, max = 220): string {
  const normalized = text.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\n|\r/).length;
}

function citationFor(input: {
  sourceRef: string;
  sourcePath: string | null;
  lineCount: number;
  contentHash: string;
}): RulesProvenanceCitation {
  return {
    source_ref: input.sourceRef,
    source_path: input.sourcePath,
    line_start: input.lineCount > 0 ? 1 : 0,
    line_end: input.lineCount,
    content_hash: input.contentHash,
  };
}

function ruleSpecs(): Array<{ base: string; spec: RuleSourceSpec; maxDepth?: number }> {
  return [
    {
      base: '.',
      maxDepth: 0,
      spec: {
        family: 'rule_doc',
        owner: 'repository',
        scope: 'global',
        precedence: { rank: 10, label: 'root-rule-doc' },
        tags: ['global-rules', 'rule-doc'],
        include: (path) => ROOT_RULE_DOCS.has(path),
      },
    },
    {
      base: '.codewith',
      spec: {
        family: 'codewith',
        owner: 'codewith',
        scope: 'global',
        precedence: { rank: 20, label: 'codewith' },
        tags: ['global-rules', 'codewith', 'agent-instructions'],
        include: (path) => {
          const normalized = normalizePath(path);
          const name = basename(normalized);
          if (ROOT_RULE_DOCS.has(name) || normalized === 'config.toml') return true;
          if (normalized.endsWith('/SKILL.md')) return true;
          if (/^(rules|instructions|prompts|plans)\//.test(normalized) && isTextSource(normalized)) return true;
          return false;
        },
      },
    },
    {
      base: '.claude',
      spec: {
        family: 'claude',
        owner: 'claude',
        scope: 'global',
        precedence: { rank: 30, label: 'claude-rules' },
        tags: ['global-rules', 'claude', 'agent-instructions'],
        include: (path) => {
          const normalized = normalizePath(path);
          return normalized === 'CLAUDE.md' || (/^rules\//.test(normalized) && isTextSource(normalized));
        },
      },
    },
    {
      base: '.codex',
      spec: {
        family: 'codex',
        owner: 'codex',
        scope: 'global',
        precedence: { rank: 40, label: 'codex' },
        tags: ['global-rules', 'codex', 'agent-instructions'],
        include: (path) => {
          const normalized = normalizePath(path);
          const name = basename(normalized);
          if (ROOT_RULE_DOCS.has(name) || name === 'config.toml') return true;
          return /^(rules|instructions|prompts)\//.test(normalized) && isTextSource(normalized);
        },
      },
    },
    {
      base: '.opencode',
      spec: {
        family: 'opencode',
        owner: 'opencode',
        scope: 'global',
        precedence: { rank: 50, label: 'opencode' },
        tags: ['global-rules', 'opencode', 'agent-instructions'],
        include: (path) => SELECTED_PROMPT_OR_PLAN_RE.test(path) && isTextSource(path),
      },
    },
    {
      base: '.',
      maxDepth: 0,
      spec: {
        family: 'opencode',
        owner: 'opencode',
        scope: 'global',
        precedence: { rank: 50, label: 'opencode-config' },
        tags: ['global-rules', 'opencode', 'config'],
        include: (path) => ['opencode.json', 'opencode.jsonc', 'opencode.toml', 'opencode.yaml', 'opencode.yml'].includes(path),
      },
    },
    {
      base: '.hasna/prompts',
      spec: {
        family: 'prompt',
        owner: 'hasna',
        scope: 'global',
        precedence: { rank: 60, label: 'selected-prompts' },
        tags: ['global-rules', 'prompt'],
        include: (path) => SELECTED_PROMPT_OR_PLAN_RE.test(path) && isTextSource(path),
      },
    },
    {
      base: '.hasna/plans',
      spec: {
        family: 'plan',
        owner: 'hasna',
        scope: 'global',
        precedence: { rank: 65, label: 'selected-plans' },
        tags: ['global-rules', 'plan'],
        include: (path) => SELECTED_PROMPT_OR_PLAN_RE.test(path) && isTextSource(path),
      },
    },
    {
      base: 'docs',
      spec: {
        family: 'rule_doc',
        owner: 'repository',
        scope: 'global',
        precedence: { rank: 70, label: 'rule-docs' },
        tags: ['global-rules', 'rule-doc'],
        include: (path) => SELECTED_PROMPT_OR_PLAN_RE.test(path) && isTextSource(path),
      },
    },
  ];
}

function collectFiles(root: string, skipped: RulesProvenanceSkippedSource[]): FileCandidate[] {
  const candidates = new Map<string, FileCandidate>();
  for (const entry of ruleSpecs()) {
    const basePath = resolve(root, entry.base);
    if (!existsSync(basePath)) continue;
    const rootStats = statSync(basePath);
    if (rootStats.isFile()) {
      const rel = basename(basePath);
      if (entry.spec.include(rel)) {
        candidates.set(basePath, {
          ...entry.spec,
          absPath: basePath,
        });
      }
      continue;
    }
    walkRuleDirectory({
      basePath,
      depth: 0,
      maxDepth: entry.maxDepth ?? WALK_MAX_DEPTH,
      spec: entry.spec,
      candidates,
      skipped,
    });
  }
  return [...candidates.values()].sort((a, b) => {
    if (a.precedence.rank !== b.precedence.rank) return a.precedence.rank - b.precedence.rank;
    return a.absPath.localeCompare(b.absPath);
  });
}

function walkRuleDirectory(input: {
  rootBasePath?: string;
  basePath: string;
  depth: number;
  maxDepth: number;
  spec: RuleSourceSpec;
  candidates: Map<string, FileCandidate>;
  skipped: RulesProvenanceSkippedSource[];
}): void {
  const rootBasePath = input.rootBasePath ?? input.basePath;
  if (input.depth > input.maxDepth) return;
  for (const dirent of readdirSync(input.basePath, { withFileTypes: true })) {
    const absPath = join(input.basePath, dirent.name);
    const rel = relativePath(rootBasePath, absPath);
    if (dirent.isSymbolicLink()) continue;
    if (dirent.isDirectory()) {
      if (SKIP_DIRECTORIES.has(dirent.name)) {
        continue;
      }
      if (hasSensitivePathPart(rel)) {
        input.skipped.push({ source_family: input.spec.family, source_path: absPath, reason: 'sensitive_path' });
        continue;
      }
      walkRuleDirectory({
        ...input,
        rootBasePath,
        basePath: absPath,
        depth: input.depth + 1,
      });
      continue;
    }
    if (!dirent.isFile()) continue;
    const sourceRelativePath = relativePath(resolve(rootBasePath), absPath);
    if (hasSensitivePathPart(sourceRelativePath)) {
      input.skipped.push({ source_family: input.spec.family, source_path: absPath, reason: 'sensitive_path' });
      continue;
    }
    if (!input.spec.include(sourceRelativePath)) continue;
    if (!isTextSource(absPath)) continue;
    input.candidates.set(absPath, {
      ...input.spec,
      absPath,
    });
  }
}

function legacyRuleLike(item: KnowledgeItem): boolean {
  const tags = (item.tags ?? []).map((tag) => tag.toLowerCase());
  if (tags.some((tag) => ['rule', 'rules', 'agent', 'instructions', 'global-rules', 'global-agent-rules'].includes(tag))) {
    return true;
  }
  const haystack = `${item.title}\n${item.content.slice(0, 500)}`.toLowerCase();
  return /\b(agent|rule|rules|instruction|instructions|codewith|claude|codex|opencode)\b/.test(haystack);
}

function manifestItemForRecord(record: RulesProvenanceRecord, text: string): ManifestObject {
  const ruleProvenance = {
    source_path: record.source_path,
    source_path_ref: record.source_path_ref,
    source_ref: record.source_ref,
    owner: record.owner,
    scope: record.scope,
    precedence: record.precedence,
    source_hash: record.source_hash,
    content_hash: record.content_hash,
    discovered_at: record.discovered_at,
    tags: record.tags,
    redaction_status: record.redaction_status,
    citations: record.citations,
  };
  return {
    source_ref: record.source_ref,
    name: record.title,
    mime: 'text/markdown',
    size: Buffer.byteLength(text),
    hash: record.content_hash,
    revision: record.content_hash,
    status: 'active',
    updated_at: record.discovered_at,
    permissions: {
      mode: 'read_only',
      allowed_purposes: ['knowledge_index', 'knowledge_answer', 'agent_context'],
    },
    rule_provenance: ruleProvenance,
    source_family: record.source_family,
    source_path_ref: record.source_path_ref,
    owner: record.owner,
    scope: record.scope,
    precedence: record.precedence,
    tags: record.tags,
    redaction_status: record.redaction_status,
    legacy_json_id: record.legacy_json_id ?? null,
    extracted_text: text,
  };
}

function prepareFileRecord(input: {
  root: string;
  candidate: FileCandidate;
  discoveredAt: string;
  maxBytesPerFile: number;
  safetyPolicy?: SafetyPolicy;
}): PreparedRecord {
  const stats = lstatSync(input.candidate.absPath);
  const sourcePath = input.candidate.absPath;
  const sourcePathRef = relativePath(input.root, sourcePath);
  if (stats.size > input.maxBytesPerFile) {
    const sourceRef = pathToFileURL(sourcePath).href;
    const evidence: RulesProvenanceRecord = {
      source_family: input.candidate.family,
      title: basename(sourcePath),
      source_path: sourcePath,
      source_path_ref: sourcePathRef,
      source_ref: sourceRef,
      owner: input.candidate.owner,
      scope: input.candidate.scope,
      precedence: input.candidate.precedence,
      source_hash: 'sha256:skipped-too-large',
      content_hash: 'sha256:skipped-too-large',
      discovered_at: input.discoveredAt,
      tags: [...input.candidate.tags, 'skipped'],
      redaction_status: 'refused',
      redactions: [],
      citations: [],
      bytes: stats.size,
      line_count: 0,
      importable: false,
      skipped_reason: 'max_bytes_exceeded',
      preview: null,
    };
    return { evidence, text: '', manifest: null };
  }
  const bytes = readFileSync(sourcePath);
  const rawText = bytes.toString('utf8');
  const redacted = redactSecrets(rawText, input.safetyPolicy);
  const highSeverity = redacted.findings.some((finding) => finding.severity === 'high');
  const redactionStatus: RulesProvenanceRedactionStatus = highSeverity
    ? 'refused'
    : redacted.findings.length > 0
      ? 'redacted'
      : 'clean';
  const contentHash = sha256Text(redacted.text);
  const sourceRef = pathToFileURL(sourcePath).href;
  const lines = lineCount(redacted.text);
  const evidence: RulesProvenanceRecord = {
    source_family: input.candidate.family,
    title: basename(sourcePath),
    source_path: sourcePath,
    source_path_ref: sourcePathRef,
    source_ref: sourceRef,
    owner: input.candidate.owner,
    scope: input.candidate.scope,
    precedence: input.candidate.precedence,
    source_hash: sha256Bytes(bytes),
    content_hash: contentHash,
    discovered_at: input.discoveredAt,
    tags: [...input.candidate.tags],
    redaction_status: redactionStatus,
    redactions: redacted.findings.map((finding) => ({ type: finding.type, severity: finding.severity })),
    citations: [citationFor({ sourceRef, sourcePath, lineCount: lines, contentHash })],
    bytes: bytes.byteLength,
    line_count: lines,
    importable: redactionStatus !== 'refused',
    skipped_reason: redactionStatus === 'refused' ? 'secret_refused' : null,
    preview: redactionStatus === 'refused' ? null : boundedPreview(redacted.text),
  };
  return {
    evidence,
    text: redacted.text,
    manifest: evidence.importable ? manifestItemForRecord(evidence, redacted.text) : null,
  };
}

function prepareLegacyRecord(input: {
  item: KnowledgeItem;
  legacyStorePath: string;
  discoveredAt: string;
  scope: string;
  safetyPolicy?: SafetyPolicy;
}): PreparedRecord {
  const redacted = redactSecrets(input.item.content, input.safetyPolicy);
  const highSeverity = redacted.findings.some((finding) => finding.severity === 'high');
  const redactionStatus: RulesProvenanceRedactionStatus = highSeverity
    ? 'refused'
    : redacted.findings.length > 0
      ? 'redacted'
      : 'clean';
  const sourceRef = `open-files://source/legacy-json/path/${encodeURIComponent(input.item.id)}`;
  const contentHash = sha256Text(redacted.text);
  const sourceHash = sha256Text(input.item.content);
  const lines = lineCount(redacted.text);
  const evidence: RulesProvenanceRecord = {
    source_family: 'legacy_json',
    title: input.item.title,
    source_path: input.legacyStorePath,
    source_path_ref: `legacy-json:${input.item.id}`,
    source_ref: sourceRef,
    owner: 'legacy-json',
    scope: input.scope,
    precedence: { rank: 90, label: 'legacy-json-note' },
    source_hash: sourceHash,
    content_hash: contentHash,
    discovered_at: input.discoveredAt,
    tags: [...new Set(['global-rules', 'legacy-json', ...(input.item.tags ?? [])])],
    redaction_status: redactionStatus,
    redactions: redacted.findings.map((finding) => ({ type: finding.type, severity: finding.severity })),
    citations: [citationFor({ sourceRef, sourcePath: input.legacyStorePath, lineCount: lines, contentHash })],
    bytes: Buffer.byteLength(input.item.content),
    line_count: lines,
    importable: redactionStatus !== 'refused',
    skipped_reason: redactionStatus === 'refused' ? 'secret_refused' : null,
    preview: redactionStatus === 'refused' ? null : boundedPreview(redacted.text),
    legacy_json_id: input.item.id,
  };
  return {
    evidence,
    text: redacted.text,
    manifest: evidence.importable ? manifestItemForRecord(evidence, redacted.text) : null,
  };
}

function deprecateLegacyNotes(input: {
  legacyStorePath: string | null | undefined;
  records: RulesProvenanceRecord[];
  now: string;
}): number {
  if (!input.legacyStorePath || !existsSync(input.legacyStorePath)) return 0;
  const byId = new Map(input.records
    .filter((record) => record.legacy_json_id && record.importable)
    .map((record) => [record.legacy_json_id!, record]));
  if (byId.size === 0) return 0;
  return withLock(input.legacyStorePath, () => {
    const store = loadStoreIfExists(input.legacyStorePath!);
    if (!store.exists) return 0;
    let deprecated = 0;
    for (const item of store.items) {
      const record = byId.get(item.id);
      if (!record) continue;
      const metadata = item.metadata ?? {};
      item.archived = true;
      item.metadata = {
        ...metadata,
        knowledge_rules_import: {
          status: 'deprecated_after_source_backed_promotion',
          deprecated_at: input.now,
          source_ref: record.source_ref,
          source_hash: record.source_hash,
          content_hash: record.content_hash,
          data_loss: false,
        },
      };
      item.tags = [...new Set([...(item.tags ?? []), 'deprecated:knowledge-rules-import'])];
      item.updated_at = input.now;
      deprecated += 1;
    }
    if (deprecated > 0) saveStore(input.legacyStorePath!, { items: store.items });
    return deprecated;
  });
}

export async function importRulesProvenance(options: RulesProvenanceImportOptions = {}): Promise<RulesProvenanceImportResult> {
  const root = resolve(options.root ?? process.cwd());
  const scope = options.scope ?? 'global';
  const owner = options.owner ?? 'global-agent-rules-standard';
  const dryRun = options.dryRun !== false;
  const discoveredAt = (options.now ?? new Date()).toISOString();
  const maxItems = Math.max(1, Math.min(options.maxItems ?? DEFAULT_MAX_ITEMS, 1000));
  const evidenceLimit = Math.max(1, Math.min(options.limit ?? DEFAULT_EVIDENCE_LIMIT, 100));
  const maxBytesPerFile = Math.max(1024, Math.min(options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE, 2 * 1024 * 1024));
  const skipped: RulesProvenanceSkippedSource[] = [];
  const files = collectFiles(root, skipped).slice(0, maxItems);
  const fileRecords = files.map((candidate) => prepareFileRecord({
    root,
    candidate: {
      ...candidate,
      owner: candidate.owner === 'repository' ? owner : candidate.owner,
      scope,
    },
    discoveredAt,
    maxBytesPerFile,
    safetyPolicy: options.safetyPolicy,
  }));

  const legacyStore = options.includeLegacy === false || !options.legacyStorePath
    ? { exists: false, items: [] as KnowledgeItem[] }
    : loadStoreIfExists(options.legacyStorePath);
  const legacyItems = legacyStore.items.filter((item) => item.archived !== true && legacyRuleLike(item)).slice(0, maxItems);
  const legacyRecords = legacyItems.map((item) => prepareLegacyRecord({
    item,
    legacyStorePath: options.legacyStorePath!,
    discoveredAt,
    scope,
    safetyPolicy: options.safetyPolicy,
  }));

  const prepared = [...fileRecords, ...legacyRecords].slice(0, maxItems);
  const allEvidence = prepared.map((record) => record.evidence);
  const importableRecords = prepared.filter((record) => record.manifest);
  const manifests = importableRecords.map((record) => record.manifest!);
  const refused = allEvidence.filter((record) => record.redaction_status === 'refused').length;
  const evidence = allEvidence.slice(0, evidenceLimit);
  const boundedSkipped = skipped.slice(0, evidenceLimit);
  let importResult: ManifestIngestResult | null = null;
  let deprecated = 0;

  if (!dryRun) {
    if (!options.dbPath) throw new Error('rules provenance apply mode requires dbPath.');
    if (manifests.length > 0) {
      importResult = await ingestOpenFilesManifestItems({
        dbPath: options.dbPath,
        items: manifests,
        sourceLabel: 'knowledge://rules-provenance/global-agent-rules',
        readAction: 'rules_provenance_import',
        safetyPolicy: options.safetyPolicy,
        now: options.now,
        maxItems,
      });
    }
    if (options.deprecateLegacy !== false) {
      deprecated = deprecateLegacyNotes({
        legacyStorePath: options.legacyStorePath,
        records: allEvidence,
        now: discoveredAt,
      });
    }
  }

  return {
    ok: refused === 0 || manifests.length > 0 || dryRun,
    workflow: 'global-rules-provenance-import',
    dry_run: dryRun,
    writes_performed: !dryRun,
    root,
    scope,
    owner,
    discovered_at: discoveredAt,
    max_items: maxItems,
    evidence_limit: evidenceLimit,
    records_seen: allEvidence.length,
    records_importable: manifests.length,
    records_refused: refused,
    records_skipped: skipped.length,
    evidence_truncated: allEvidence.length > evidence.length,
    skipped_truncated: skipped.length > boundedSkipped.length,
    evidence,
    skipped: boundedSkipped,
    import_result: importResult,
    legacy: {
      store_path: options.legacyStorePath ?? null,
      candidates: legacyItems.length,
      promoted: legacyRecords.filter((record) => record.manifest).length,
      deprecated,
      data_loss: false,
    },
    message: dryRun
      ? `Discovered ${allEvidence.length} rule source(s); ${manifests.length} importable, ${refused} refused`
      : `Imported ${importResult?.items_seen ?? 0} rule source(s); ${deprecated} legacy note(s) deprecated`,
  };
}
