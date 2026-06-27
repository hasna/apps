import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { retrieveKnowledgeContext, type RetrievalCitation, type RetrievalOptions } from './retrieval';
import { redactSecrets, type SafetyPolicy } from './safety';
import type { KnowledgeConfig } from './workspace';

export type KnowledgeContextPackSource = 'search' | 'loops' | 'runs';
export type KnowledgeContextPackPurpose = 'agent_context' | 'proposal';

export interface KnowledgeAgentContextPackOptions extends Omit<RetrievalOptions, 'dbPath' | 'config' | 'query'> {
  dbPath: string;
  config?: KnowledgeConfig;
  safetyPolicy?: SafetyPolicy;
  source?: KnowledgeContextPackSource;
  purpose?: KnowledgeContextPackPurpose;
  query?: string;
  topic?: string;
  since?: string;
  dedupe?: boolean;
  maxTokens?: number;
  maxItems?: number;
  now?: Date;
}

export interface KnowledgeAgentContextCitation {
  id: string;
  kind: 'source' | 'artifact' | 'run' | 'run_event';
  ref: string;
  source_ref: string | null;
  source_uri: string | null;
  artifact_uri: string | null;
  artifact_path: string | null;
  run_id: string | null;
  run_event_id: string | null;
  revision: string | null;
  hash: string | null;
  chunk_id: string | null;
  offsets: {
    start: number | null;
    end: number | null;
  };
  quote_preview: string | null;
}

export interface KnowledgeAgentContextEvidence {
  id: string;
  kind: string;
  title: string;
  text_preview: string;
  score: number;
  citation_ids: string[];
  provenance: {
    source: KnowledgeContextPackSource;
    record_ref: string;
    created_at: string | null;
    updated_at: string | null;
    metadata_keys: string[];
  };
}

export interface KnowledgeAgentDuplicateCandidate {
  id: string;
  reason: 'normalized_text_match';
  evidence_ids: string[];
  confidence: 'high' | 'medium';
}

export interface KnowledgeAgentContextPack {
  ok: true;
  format: 'knowledge-agent-context-pack';
  version: 1;
  created_at: string;
  source: KnowledgeContextPackSource;
  purpose: KnowledgeContextPackPurpose;
  query: string;
  topic: string | null;
  since: string | null;
  dry_run: true;
  idempotency_key: string;
  budgets: {
    max_tokens: number;
    estimated_tokens: number;
    max_items: number;
    items_included: number;
    items_available: number;
    items_truncated: number;
    token_budget_exceeded: boolean;
  };
  safety: {
    raw_artifact_content_included: false;
    durable_writes_performed: false;
    redactions: number;
    reminders: string[];
  };
  citations: KnowledgeAgentContextCitation[];
  evidence: KnowledgeAgentContextEvidence[];
  duplicate_candidates: KnowledgeAgentDuplicateCandidate[];
  outline: {
    title: string;
    bullets: string[];
    evidence_ids: string[];
    duplicate_candidate_ids: string[];
    next_actions: string[];
  };
  warnings: string[];
  message: string;
}

interface RunRow {
  id: string;
  type: string;
  prompt: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  cost_tokens: number;
  cost_usd: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface RunEventRow {
  id: string;
  run_id: string;
  level: string;
  event: string;
  metadata_json: string;
  created_at: string;
}

interface DraftPack {
  citations: KnowledgeAgentContextCitation[];
  evidence: KnowledgeAgentContextEvidence[];
  duplicateCandidates: KnowledgeAgentDuplicateCandidate[];
  redactions: number;
  warnings: string[];
  available: number;
}

const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_MAX_ITEMS = 6;
const MAX_MAX_TOKENS = 12000;
const MAX_MAX_ITEMS = 50;
const MIN_MAX_TOKENS = 800;

function stableId(prefix: string, value: string, size = 16): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, size)}`;
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizedSearchText(value: string): string {
  return normalizeText(value).toLowerCase();
}

function termsFor(value: string): string[] {
  return Array.from(new Set(normalizedSearchText(value).match(/[\p{L}\p{N}_]+/gu) ?? [])).slice(0, 24);
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isSecretishKey(key: string): boolean {
  return /(?:api[_-]?key|secret|token|password|private[_-]?key|credential)/i.test(key);
}

function metadataKeys(metadata: Record<string, unknown>): string[] {
  return Object.keys(metadata).filter((key) => !isSecretishKey(key)).sort().slice(0, 12);
}

function rawMetadataRef(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (isSecretishKey(key)) continue;
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function safeRef(value: string | null | undefined, policy: SafetyPolicy | undefined): string | null {
  if (!value) return null;
  const redacted = redactSecrets(value, policy).text;
  try {
    const parsed = new URL(redacted);
    const secretParams = ['token', 'access_token', 'api_key', 'apikey', 'key', 'secret', 'password', 'signature', 'sig'];
    for (const param of secretParams) parsed.searchParams.delete(param);
    for (const [key] of parsed.searchParams) {
      if (isSecretishKey(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return redacted;
  }
}

function metadataRef(metadata: Record<string, unknown>, keys: string[], policy: SafetyPolicy | undefined): string | null {
  return safeRef(rawMetadataRef(metadata, keys), policy);
}

function summarizeMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of metadataKeys(metadata).slice(0, 6)) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) parts.push(`${key}=${truncateText(value, 80)}`);
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key}=${String(value)}`);
    else if (value && typeof value === 'object') parts.push(`${key}={...}`);
  }
  return parts.join('; ');
}

function estimateTokensForText(text: string): number {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateTokensForValue(value: unknown): number {
  return estimateTokensForText(JSON.stringify(value));
}

function coerceMaxTokens(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_MAX_TOKENS;
  const floor = Math.floor(value as number);
  if (floor < MIN_MAX_TOKENS) throw new Error(`--max-tokens must be at least ${MIN_MAX_TOKENS} for the stable context-pack schema.`);
  return Math.min(floor, MAX_MAX_TOKENS);
}

function coerceMaxItems(value: number | undefined, limit: number | undefined): number {
  const raw = Number.isFinite(value ?? NaN) ? value as number : limit;
  if (!Number.isFinite(raw ?? NaN)) return DEFAULT_MAX_ITEMS;
  return Math.max(1, Math.min(Math.floor(raw as number), MAX_MAX_ITEMS));
}

function parseSince(value: string | null | undefined, now: Date): { cutoff: string | null; warning: string | null } {
  if (!value) return { cutoff: null, warning: null };
  const trimmed = value.trim();
  const duration = /^(\d+)\s*([mhdw])$/i.exec(trimmed);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const multiplier = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 604_800_000;
    return { cutoff: new Date(now.getTime() - amount * multiplier).toISOString(), warning: null };
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return { cutoff: parsed.toISOString(), warning: null };
  return { cutoff: null, warning: `invalid_since_ignored: ${trimmed}` };
}

function redactPreview(text: string, policy: SafetyPolicy | undefined, maxChars: number): { text: string; redactions: number } {
  const redacted = redactSecrets(text, policy);
  return {
    text: truncateText(redacted.text, maxChars),
    redactions: redacted.findings.length,
  };
}

function scoreAgainstTopic(text: string, terms: string[]): number {
  if (terms.length === 0) return 0.5;
  const haystack = normalizedSearchText(text);
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return Number((matched / terms.length).toFixed(6));
}

function baseSafetyReminders(source: KnowledgeContextPackSource): string[] {
  return [
    'This pack is read-only and performs no durable writes.',
    'Use citation ids and refs instead of pasting raw artifacts into prompts.',
    'Resolve source or artifact refs explicitly only when raw content is needed and allowed.',
    'Run generated knowledge writes through approval-gated commands before applying.',
    source === 'loops' || source === 'runs'
      ? 'Run evidence is summarized from knowledge run ledgers; raw run artifacts remain referenced, not embedded.'
      : 'Search evidence is derived from indexed chunks/wiki catalog rows with citation metadata.',
  ];
}

function citationFromRetrieval(
  index: number,
  citation: RetrievalCitation,
  policy: SafetyPolicy | undefined,
): { citation: KnowledgeAgentContextCitation; redactions: number } {
  const ref = citation.source_ref ?? citation.source_uri ?? citation.artifact_path ?? citation.artifact_uri ?? citation.id;
  const quote = citation.quote ? redactPreview(citation.quote, policy, index < 3 ? 220 : 140) : null;
  return {
    citation: {
      id: stableId('cite', `${citation.id}\u0000${ref}`, 12),
      kind: citation.artifact_uri || citation.artifact_path ? 'artifact' : 'source',
      ref,
      source_ref: citation.source_ref ?? null,
      source_uri: citation.source_uri ?? null,
      artifact_uri: citation.artifact_uri ?? null,
      artifact_path: citation.artifact_path ?? null,
      run_id: null,
      run_event_id: null,
      revision: citation.revision ?? null,
      hash: citation.hash ?? null,
      chunk_id: citation.chunk_id ?? null,
      offsets: {
        start: citation.start_offset ?? null,
        end: citation.end_offset ?? null,
      },
      quote_preview: quote?.text ?? null,
    },
    redactions: quote?.redactions ?? 0,
  };
}

async function buildSearchDraft(options: KnowledgeAgentContextPackOptions, maxItems: number): Promise<DraftPack> {
  const query = (options.query ?? options.topic ?? '').trim();
  if (!query) throw new Error('Context pack query is required for search source.');
  const {
    config,
    dbPath,
    limit,
    semantic,
    modelRef,
    dimensions,
    fake,
    env,
    batchSize,
    maxParallelCalls,
    legacyStorePath,
  } = options;
  const context = await retrieveKnowledgeContext({
    dbPath,
    config,
    legacyStorePath,
    query,
    limit: Math.max(maxItems, limit ?? maxItems),
    semantic,
    modelRef,
    dimensions,
    fake,
    env,
    batchSize,
    maxParallelCalls,
    contextChars: Math.min(options.contextChars ?? 700, 1200),
  });
  const citationMap = new Map<string, KnowledgeAgentContextCitation>();
  let redactions = 0;
  context.citations.forEach((citation, index) => {
    const item = citationFromRetrieval(index, citation, options.safetyPolicy);
    redactions += item.redactions;
    citationMap.set(citation.id, item.citation);
  });

  const evidence = context.excerpts.slice(0, Math.max(maxItems * 2, maxItems)).map((excerpt) => {
    const result = context.results.find((entry) => entry.id === excerpt.result_id);
    const citation = excerpt.citation_id ? citationMap.get(excerpt.citation_id) : null;
    const redacted = redactPreview(excerpt.text, options.safetyPolicy, 520);
    redactions += redacted.redactions;
    const title = result?.title ?? citation?.ref ?? excerpt.kind;
    return {
      id: stableId('ev', `${excerpt.kind}\u0000${excerpt.result_id}\u0000${excerpt.citation_id ?? ''}`, 14),
      kind: excerpt.kind,
      title: truncateText(title, 100),
      text_preview: redacted.text,
      score: Number(excerpt.score.toFixed(6)),
      citation_ids: citation ? [citation.id] : [],
      provenance: {
        source: 'search' as const,
        record_ref: `${excerpt.kind}:${excerpt.result_id}`,
        created_at: context.created_at,
        updated_at: null,
        metadata_keys: [],
      },
    };
  });

  const usedCitationIds = new Set(evidence.flatMap((entry) => entry.citation_ids));
  const citations = Array.from(citationMap.values()).filter((citation) => usedCitationIds.has(citation.id));
  return {
    citations,
    evidence,
    duplicateCandidates: [],
    redactions,
    warnings: context.warnings,
    available: context.excerpts.length,
  };
}

function loadRunRows(db: Database, cutoff: string | null, limit: number): RunRow[] {
  if (cutoff) {
    return db.query<RunRow, [string, string, number]>(
      `SELECT id, type, prompt, status, provider, model, cost_tokens, cost_usd, metadata_json, created_at, updated_at
       FROM runs
       WHERE updated_at >= ? OR created_at >= ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`,
    ).all(cutoff, cutoff, limit);
  }
  return db.query<RunRow, [number]>(
    `SELECT id, type, prompt, status, provider, model, cost_tokens, cost_usd, metadata_json, created_at, updated_at
     FROM runs
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
  ).all(limit);
}

function loadRunEvents(db: Database, runIds: string[], limit: number): RunEventRow[] {
  if (runIds.length === 0) return [];
  const placeholders = runIds.map(() => '?').join(', ');
  return db.query<RunEventRow, [...string[], number]>(
    `SELECT id, run_id, level, event, metadata_json, created_at
     FROM run_events
     WHERE run_id IN (${placeholders})
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(...runIds, limit);
}

function rowMentionsLoop(row: RunRow, events: RunEventRow[]): boolean {
  const text = `${row.type} ${row.metadata_json} ${events.map((event) => `${event.event} ${event.metadata_json}`).join(' ')}`.toLowerCase();
  return text.includes('loop');
}

function citationForRun(row: RunRow, metadata: Record<string, unknown>, policy: SafetyPolicy | undefined): KnowledgeAgentContextCitation {
  const sourceRef = metadataRef(metadata, ['source_ref', 'source_uri', 'evidence_uri', 'receipt_uri'], policy);
  const artifactUri = metadataRef(metadata, ['artifact_uri'], policy);
  const artifactPath = metadataRef(metadata, ['artifact_path', 'artifact_key'], policy);
  const ref = sourceRef ?? artifactUri ?? artifactPath ?? `knowledge://project/runs/${row.id}`;
  const quote = row.prompt ? redactPreview(row.prompt, policy, 180).text : null;
  return {
    id: stableId('cite', `run\u0000${row.id}\u0000${ref}`, 12),
    kind: artifactUri || artifactPath ? 'artifact' : 'run',
    ref,
    source_ref: sourceRef?.startsWith('open-files://') ? sourceRef : null,
    source_uri: sourceRef && !sourceRef.startsWith('open-files://') ? sourceRef : null,
    artifact_uri: artifactUri,
    artifact_path: artifactPath,
    run_id: row.id,
    run_event_id: null,
    revision: metadataRef(metadata, ['revision'], policy),
    hash: metadataRef(metadata, ['hash', 'content_hash'], policy),
    chunk_id: null,
    offsets: { start: null, end: null },
    quote_preview: quote,
  };
}

function citationForEvent(row: RunEventRow, metadata: Record<string, unknown>, policy: SafetyPolicy | undefined): KnowledgeAgentContextCitation {
  const sourceRef = metadataRef(metadata, ['source_ref', 'source_uri', 'evidence_uri', 'receipt_uri'], policy);
  const artifactUri = metadataRef(metadata, ['artifact_uri'], policy);
  const artifactPath = metadataRef(metadata, ['artifact_path', 'artifact_key'], policy);
  const ref = sourceRef ?? artifactUri ?? artifactPath ?? `knowledge://project/runs/${row.run_id}`;
  const quote = redactPreview(row.event, policy, 160).text;
  return {
    id: stableId('cite', `event\u0000${row.id}\u0000${ref}`, 12),
    kind: artifactUri || artifactPath ? 'artifact' : 'run_event',
    ref,
    source_ref: sourceRef?.startsWith('open-files://') ? sourceRef : null,
    source_uri: sourceRef && !sourceRef.startsWith('open-files://') ? sourceRef : null,
    artifact_uri: artifactUri,
    artifact_path: artifactPath,
    run_id: row.run_id,
    run_event_id: row.id,
    revision: metadataRef(metadata, ['revision'], policy),
    hash: metadataRef(metadata, ['hash', 'content_hash'], policy),
    chunk_id: null,
    offsets: { start: null, end: null },
    quote_preview: quote,
  };
}

function duplicateCandidatesFor(evidence: KnowledgeAgentContextEvidence[]): KnowledgeAgentDuplicateCandidate[] {
  const groups = new Map<string, string[]>();
  for (const entry of evidence) {
    const key = normalizedSearchText(`${entry.title} ${entry.text_preview}`)
      .replace(/\b(?:file|https?|s3):\/\/\S+/g, '')
      .replace(/\b(?:run|evt|task|loop)_[a-z0-9_]+\b/g, '')
      .replace(/[^a-z0-9 ]+/g, '')
      .replace(/\b(?:run|event|completed|dry_run|pending)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), entry.id]);
  }
  return Array.from(groups.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({
      id: stableId('dup', key, 12),
      reason: 'normalized_text_match' as const,
      evidence_ids: ids,
      confidence: ids.length > 2 ? 'high' as const : 'medium' as const,
    }));
}

async function buildRunDraft(options: KnowledgeAgentContextPackOptions, maxItems: number, now: Date): Promise<DraftPack> {
  const source = options.source === 'loops' ? 'loops' : 'runs';
  const topic = (options.topic ?? options.query ?? '').trim();
  const topicTerms = termsFor(topic);
  const since = parseSince(options.since, now);
  const warnings = since.warning ? [since.warning] : [];
  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const runRows = loadRunRows(db, since.cutoff, Math.max(maxItems * 8, 40));
    const allEvents = loadRunEvents(db, runRows.map((row) => row.id), Math.max(maxItems * 12, 80));
    const eventsByRun = new Map<string, RunEventRow[]>();
    for (const event of allEvents) eventsByRun.set(event.run_id, [...(eventsByRun.get(event.run_id) ?? []), event]);
    const filteredRuns = source === 'loops'
      ? runRows.filter((row) => rowMentionsLoop(row, eventsByRun.get(row.id) ?? []))
      : runRows;

    const scoredRuns = filteredRuns
      .map((row) => {
        const metadata = parseJsonObject(row.metadata_json);
        const text = `${row.type} ${row.status} ${row.prompt ?? ''} ${summarizeMetadata(metadata)} ${(eventsByRun.get(row.id) ?? []).map((event) => `${event.event} ${event.metadata_json}`).join(' ')}`;
        return { row, metadata, score: scoreAgainstTopic(text, topicTerms), text };
      })
      .filter((entry) => topicTerms.length === 0 || entry.score > 0)
      .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at) || a.row.id.localeCompare(b.row.id));

    const citations: KnowledgeAgentContextCitation[] = [];
    const evidence: KnowledgeAgentContextEvidence[] = [];
    let redactions = 0;

    for (const entry of scoredRuns.slice(0, Math.max(maxItems * 2, maxItems))) {
      const citation = citationForRun(entry.row, entry.metadata, options.safetyPolicy);
      citations.push(citation);
      const metadataSummary = summarizeMetadata(entry.metadata);
      const previewInput = [entry.row.prompt, metadataSummary].filter(Boolean).join(' | ') || `${entry.row.type} ${entry.row.status}`;
      const preview = redactPreview(previewInput, options.safetyPolicy, 420);
      redactions += preview.redactions;
      evidence.push({
        id: `run:${entry.row.id}`,
        kind: entry.row.type,
        title: truncateText(`${entry.row.type}: ${entry.row.status}`, 100),
        text_preview: preview.text,
        score: entry.score,
        citation_ids: [citation.id],
        provenance: {
          source,
          record_ref: `knowledge://project/runs/${entry.row.id}`,
          created_at: entry.row.created_at,
          updated_at: entry.row.updated_at,
          metadata_keys: metadataKeys(entry.metadata),
        },
      });

      const eventRows = (eventsByRun.get(entry.row.id) ?? [])
        .map((event) => {
          const metadata = parseJsonObject(event.metadata_json);
          const text = `${event.event} ${summarizeMetadata(metadata)} ${event.metadata_json}`;
          return { event, metadata, score: scoreAgainstTopic(text, topicTerms), text };
        })
        .filter((eventEntry) => topicTerms.length === 0 || eventEntry.score > 0)
        .sort((a, b) => b.score - a.score || b.event.created_at.localeCompare(a.event.created_at) || a.event.id.localeCompare(b.event.id))
        .slice(0, 2);

      for (const eventEntry of eventRows) {
        const eventCitation = citationForEvent(eventEntry.event, eventEntry.metadata, options.safetyPolicy);
        citations.push(eventCitation);
        const preview = redactPreview(`${eventEntry.event}: ${summarizeMetadata(eventEntry.metadata)}`, options.safetyPolicy, 320);
        redactions += preview.redactions;
        evidence.push({
          id: `event:${eventEntry.event.id}`,
          kind: `run_event:${eventEntry.event.level}`,
          title: truncateText(eventEntry.event.event, 100),
          text_preview: preview.text,
          score: eventEntry.score,
          citation_ids: [eventCitation.id],
          provenance: {
            source,
            record_ref: `knowledge://project/runs/${eventEntry.event.run_id}`,
            created_at: eventEntry.event.created_at,
            updated_at: null,
            metadata_keys: metadataKeys(eventEntry.metadata),
          },
        });
      }
    }

    return {
      citations,
      evidence,
      duplicateCandidates: options.dedupe ? duplicateCandidatesFor(evidence) : [],
      redactions,
      warnings,
      available: scoredRuns.length,
    };
  } finally {
    db.close();
  }
}

function outlineFor(input: {
  source: KnowledgeContextPackSource;
  purpose: KnowledgeContextPackPurpose;
  query: string;
  evidence: KnowledgeAgentContextEvidence[];
  duplicates: KnowledgeAgentDuplicateCandidate[];
}): KnowledgeAgentContextPack['outline'] {
  const title = input.purpose === 'proposal'
    ? `Proposal context: ${truncateText(input.query || 'loop evidence', 80)}`
    : `Knowledge context: ${truncateText(input.query, 80)}`;
  const evidenceIds = input.evidence.slice(0, 8).map((entry) => entry.id);
  const duplicateIds = input.duplicates.slice(0, 5).map((entry) => entry.id);
  const bullets = input.evidence.slice(0, 5).map((entry) => `${entry.id}: ${entry.title}`);
  if (input.evidence.length === 0) bullets.push('No matching bounded evidence was found.');
  return {
    title,
    bullets,
    evidence_ids: evidenceIds,
    duplicate_candidate_ids: duplicateIds,
    next_actions: input.source === 'loops'
      ? [
          'Review duplicate_candidates before drafting a new proposal.',
          'Use cited run refs for provenance; inspect a run only when more detail is needed.',
          'Keep proposal writes approval-gated and idempotent.',
        ]
      : [
          'Use evidence_ids and citation_ids in prompts instead of raw excerpts when possible.',
          'Inspect cited refs only if the bounded preview is insufficient.',
          'Use knowledge build/file-answer only with explicit approval for durable writes.',
        ],
  };
}

function pruneCitations(pack: KnowledgeAgentContextPack): void {
  const used = new Set(pack.evidence.flatMap((entry) => entry.citation_ids));
  pack.citations = pack.citations.filter((citation) => used.has(citation.id));
}

function syncOutline(pack: KnowledgeAgentContextPack): void {
  pack.outline.evidence_ids = pack.evidence.slice(0, 8).map((entry) => entry.id);
  pack.outline.bullets = pack.evidence.length > 0
    ? pack.evidence.slice(0, 5).map((entry) => `${entry.id}: ${entry.title}`)
    : ['No matching bounded evidence was found.'];
  pack.outline.duplicate_candidate_ids = pack.duplicate_candidates.slice(0, 5).map((entry) => entry.id);
}

function fitPackToBudget(pack: KnowledgeAgentContextPack): KnowledgeAgentContextPack {
  const maxTokens = pack.budgets.max_tokens;
  const warnings = new Set(pack.warnings);
  while (estimateTokensForValue(pack) > maxTokens) {
    const longest = pack.evidence
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.text_preview.length > 180)
      .sort((a, b) => b.entry.text_preview.length - a.entry.text_preview.length)[0];
    if (longest) {
      longest.entry.text_preview = truncateText(longest.entry.text_preview, 180);
      warnings.add('text_preview_truncated_for_token_budget');
      continue;
    }
    const longCitation = pack.citations
      .filter((citation) => (citation.quote_preview?.length ?? 0) > 120)
      .sort((a, b) => (b.quote_preview?.length ?? 0) - (a.quote_preview?.length ?? 0))[0];
    if (longCitation?.quote_preview) {
      longCitation.quote_preview = truncateText(longCitation.quote_preview, 120);
      warnings.add('citation_quote_truncated_for_token_budget');
      continue;
    }
    if (pack.evidence.length > 0) {
      pack.evidence.pop();
      pack.budgets.items_truncated += 1;
      pack.duplicate_candidates = pack.duplicate_candidates
        .map((candidate) => ({
          ...candidate,
          evidence_ids: candidate.evidence_ids.filter((id) => pack.evidence.some((entry) => entry.id === id)),
        }))
        .filter((candidate) => candidate.evidence_ids.length > 1);
      syncOutline(pack);
      warnings.add('evidence_truncated_for_token_budget');
      pruneCitations(pack);
      continue;
    }
    if (pack.outline.next_actions.length > 1) {
      pack.outline.next_actions.pop();
      warnings.add('outline_truncated_for_token_budget');
      continue;
    }
    warnings.add('token_budget_floor_exceeded');
    break;
  }
  pack.warnings = Array.from(warnings).sort();
  pack.budgets.items_included = pack.evidence.length;
  syncOutline(pack);
  pack.budgets.estimated_tokens = estimateTokensForValue(pack);
  pack.budgets.token_budget_exceeded = pack.budgets.estimated_tokens > maxTokens;
  if (pack.budgets.token_budget_exceeded) {
    throw new Error(`Unable to build context pack within ${maxTokens} token budget; increase --max-tokens.`);
  }
  pack.message = `${pack.evidence.length} bounded evidence item(s), estimated ${pack.budgets.estimated_tokens}/${maxTokens} token(s)`;
  return pack;
}

export async function buildKnowledgeAgentContextPack(options: KnowledgeAgentContextPackOptions): Promise<KnowledgeAgentContextPack> {
  const now = options.now ?? new Date();
  const source = options.source ?? 'search';
  const purpose = options.purpose ?? (source === 'loops' || source === 'runs' ? 'proposal' : 'agent_context');
  const maxTokens = coerceMaxTokens(options.maxTokens);
  const maxItems = coerceMaxItems(options.maxItems, options.limit);
  const query = normalizeText(options.query ?? options.topic ?? '');
  if (purpose === 'proposal' && source !== 'search' && !query) {
    throw new Error('Proposal context requires --topic <text> or a positional topic.');
  }
  if (source !== 'search') migrateKnowledgeDb(options.dbPath);
  const sinceForKey = parseSince(options.since, now).cutoff ?? options.since ?? '';

  const draft = source === 'search'
    ? await buildSearchDraft(options, maxItems)
    : await buildRunDraft(options, maxItems, now);
  const sortedEvidence = draft.evidence
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, maxItems);
  const sortedCitations = draft.citations
    .filter((citation, index, rows) => rows.findIndex((entry) => entry.id === citation.id) === index)
    .sort((a, b) => a.id.localeCompare(b.id));
  const duplicateCandidates = options.dedupe
    ? duplicateCandidatesFor(sortedEvidence)
    : draft.duplicateCandidates.filter((candidate) => candidate.evidence_ids.every((id) => sortedEvidence.some((entry) => entry.id === id)));
  const outline = outlineFor({
    source,
    purpose,
    query,
    evidence: sortedEvidence,
    duplicates: duplicateCandidates,
  });

  const pack: KnowledgeAgentContextPack = {
    ok: true,
    format: 'knowledge-agent-context-pack',
    version: 1,
    created_at: now.toISOString(),
    source,
    purpose,
    query,
    topic: options.topic ?? null,
    since: options.since ?? null,
    dry_run: true,
    idempotency_key: stableId('ctx', [
      source,
      purpose,
      query,
      sinceForKey,
      options.dedupe === true ? 'dedupe' : 'no-dedupe',
      options.semantic === true ? 'semantic' : 'keyword',
      options.modelRef ?? '',
      options.limit ?? '',
      maxTokens,
      maxItems,
      sortedEvidence.map((entry) => entry.id).join(','),
      sortedCitations.map((entry) => entry.id).join(','),
    ].join('\u0000'), 20),
    budgets: {
      max_tokens: maxTokens,
      estimated_tokens: 0,
      max_items: maxItems,
      items_included: sortedEvidence.length,
      items_available: draft.available,
      items_truncated: Math.max(0, draft.available - sortedEvidence.length),
      token_budget_exceeded: false,
    },
    safety: {
      raw_artifact_content_included: false,
      durable_writes_performed: false,
      redactions: draft.redactions,
      reminders: baseSafetyReminders(source),
    },
    citations: sortedCitations,
    evidence: sortedEvidence,
    duplicate_candidates: duplicateCandidates,
    outline,
    warnings: draft.warnings,
    message: `${sortedEvidence.length} bounded evidence item(s), estimated under ${maxTokens} token(s)`,
  };
  pruneCitations(pack);
  return fitPackToBudget(pack);
}
