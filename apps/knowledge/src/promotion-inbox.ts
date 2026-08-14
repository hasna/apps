import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { generatedArtifactProvenance } from './provenance';
import { createApprovalGate, recordAuditEvent, recordRedactionFindings, redactSecrets } from './safety';

export type KnowledgePromotionKind = 'lesson' | 'decision' | 'claim';
export type KnowledgePromotionSourceKind = 'memento' | 'session' | 'report';
export type KnowledgePromotionStatus =
  | 'ready'
  | 'needs_approval'
  | 'blocked'
  | 'duplicate'
  | 'promoted'
  | 'rejected';

export interface KnowledgePromotionEvidenceRefInput {
  ref: string;
  citation_id?: string | null;
  chunk_id?: string | null;
  revision?: string | null;
  hash?: string | null;
  observed_at?: string | null;
  expires_at?: string | null;
  status?: string | null;
}

export interface KnowledgePromotionEvidenceRef {
  ref: string;
  citation_id: string | null;
  chunk_id: string | null;
  revision: string | null;
  hash: string | null;
  observed_at: string | null;
  expires_at: string | null;
  status: string | null;
}

export interface KnowledgePromotionCitationCheck {
  ref: string;
  valid: boolean;
  resolved_by: 'citation' | 'chunk' | 'source' | 'run' | 'external_uri' | 'none';
  stale: boolean;
  reason: string | null;
}

export interface KnowledgePromotionChecks {
  citations: {
    provided: number;
    valid: number;
    invalid: number;
    entries: KnowledgePromotionCitationCheck[];
  };
  invalid_source_refs: string[];
  stale_refs: string[];
  duplicate_record_ids: string[];
  duplicate_candidate_ids: string[];
  conflicting_record_ids: string[];
  conflicting_candidate_ids: string[];
  approval_reasons: string[];
}

export interface KnowledgePromotionCandidate {
  id: string;
  record_kind: KnowledgePromotionKind;
  title: string;
  content: string;
  canonical_key: string;
  content_hash: string;
  source_kind: KnowledgePromotionSourceKind;
  source_refs: string[];
  evidence_refs: KnowledgePromotionEvidenceRef[];
  status: KnowledgePromotionStatus;
  requires_approval: boolean;
  checks: KnowledgePromotionChecks;
  idempotency_key: string;
  duplicate_of: string | null;
  approved_by: string | null;
  promoted_record_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  promoted_at: string | null;
}

export interface DurableKnowledgeRecord {
  id: string;
  record_kind: KnowledgePromotionKind;
  title: string;
  content: string;
  canonical_key: string;
  content_hash: string;
  status: string;
  source_refs: string[];
  evidence_refs: KnowledgePromotionEvidenceRef[];
  confidence: number | null;
  valid_from: string;
  valid_to: string | null;
  promoted_from_candidate_id: string;
  approved_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EnqueueKnowledgePromotionInput {
  kind: KnowledgePromotionKind;
  title: string;
  content: string;
  sourceKind: KnowledgePromotionSourceKind;
  sourceRefs: string[];
  evidenceRefs: Array<string | KnowledgePromotionEvidenceRefInput>;
  canonicalKey?: string;
  requiresApproval?: boolean;
  confidence?: number;
  validFrom?: string;
  validTo?: string | null;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export interface PromoteKnowledgeCandidateOptions {
  approveWrite?: boolean;
  approvedBy?: string;
  now?: Date;
}

interface CandidateRow {
  id: string;
  record_kind: string;
  title: string;
  content: string;
  canonical_key: string;
  content_hash: string;
  source_kind: string;
  source_refs_json: string;
  evidence_refs_json: string;
  status: string;
  requires_approval: number;
  checks_json: string;
  idempotency_key: string;
  duplicate_of: string | null;
  approved_by: string | null;
  promoted_record_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  promoted_at: string | null;
}

interface DurableRow {
  id: string;
  record_kind: string;
  title: string;
  content: string;
  canonical_key: string;
  content_hash: string;
  status: string;
  source_refs_json: string;
  evidence_refs_json: string;
  confidence: number | null;
  valid_from: string;
  valid_to: string | null;
  promoted_from_candidate_id: string;
  approved_by: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function stableId(prefix: string, value: string, length = 24): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, length)}`;
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizedKey(value: string): string {
  return normalizedText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asCandidate(row: CandidateRow): KnowledgePromotionCandidate {
  return {
    ...row,
    record_kind: row.record_kind as KnowledgePromotionKind,
    source_kind: row.source_kind as KnowledgePromotionSourceKind,
    status: row.status as KnowledgePromotionStatus,
    source_refs: parseJson(row.source_refs_json, []),
    evidence_refs: parseJson(row.evidence_refs_json, []),
    requires_approval: row.requires_approval === 1,
    checks: parseJson(row.checks_json, emptyChecks()),
    metadata: parseJson(row.metadata_json, {}),
  };
}

function asDurableRecord(row: DurableRow): DurableKnowledgeRecord {
  return {
    ...row,
    record_kind: row.record_kind as KnowledgePromotionKind,
    source_refs: parseJson(row.source_refs_json, []),
    evidence_refs: parseJson(row.evidence_refs_json, []),
    metadata: parseJson(row.metadata_json, {}),
  };
}

function emptyChecks(): KnowledgePromotionChecks {
  return {
    citations: { provided: 0, valid: 0, invalid: 0, entries: [] },
    invalid_source_refs: [],
    stale_refs: [],
    duplicate_record_ids: [],
    duplicate_candidate_ids: [],
    conflicting_record_ids: [],
    conflicting_candidate_ids: [],
    approval_reasons: [],
  };
}

function normalizeEvidenceRef(input: string | KnowledgePromotionEvidenceRefInput): KnowledgePromotionEvidenceRef {
  const value = typeof input === 'string' ? { ref: input } : input;
  return {
    ref: normalizedText(value.ref),
    citation_id: value.citation_id ?? null,
    chunk_id: value.chunk_id ?? null,
    revision: value.revision ?? null,
    hash: value.hash ?? null,
    observed_at: value.observed_at ?? null,
    expires_at: value.expires_at ?? null,
    status: value.status ?? null,
  };
}

function validReference(ref: string): boolean {
  try {
    const parsed = new URL(ref);
    return parsed.protocol.length > 1 && (parsed.hostname.length > 0 || parsed.pathname.length > 0);
  } catch {
    return /^(?:cite|citation|chunk|run):[A-Za-z0-9._:-]+$/.test(ref);
  }
}

function staleStatus(status: string | null | undefined): boolean {
  return ['deleted', 'stale', 'invalidated', 'reindex_required', 'expired', 'superseded'].includes((status ?? '').toLowerCase());
}

function metadataStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  const metadata = parseJson<Record<string, unknown>>(value, {});
  if (metadata.stale === true) return 'stale';
  return typeof metadata.status === 'string' ? metadata.status : null;
}

function citationIdentifier(evidence: KnowledgePromotionEvidenceRef): string | null {
  if (evidence.citation_id) return evidence.citation_id;
  const match = evidence.ref.match(/^(?:cite|citation):(.+)$/);
  return match?.[1] ?? null;
}

function chunkIdentifier(evidence: KnowledgePromotionEvidenceRef): string | null {
  if (evidence.chunk_id) return evidence.chunk_id;
  const match = evidence.ref.match(/^chunk:(.+)$/);
  return match?.[1] ?? null;
}

function inspectCitation(db: Database, evidence: KnowledgePromotionEvidenceRef, now: string): KnowledgePromotionCitationCheck {
  const explicitStale = staleStatus(evidence.status)
    || Boolean(evidence.expires_at && evidence.expires_at <= now);
  if (!evidence.ref || !validReference(evidence.ref)) {
    return { ref: evidence.ref, valid: false, resolved_by: 'none', stale: explicitStale, reason: 'invalid_reference' };
  }

  const citationId = citationIdentifier(evidence);
  const citation = db.query<{
    id: string;
    source_uri: string;
    chunk_id: string | null;
    chunk_metadata_json: string | null;
    revision_hash: string | null;
    revision: string | null;
    source_revision_id: string | null;
    source_id: string | null;
    revision_created_at: string | null;
    latest_revision_at: string | null;
  }, [string | null, string]>(
    `SELECT c.id, c.source_uri, c.chunk_id, ch.metadata_json AS chunk_metadata_json,
            sr.hash AS revision_hash, sr.revision, sr.id AS source_revision_id,
            sr.source_id, sr.created_at AS revision_created_at,
            (SELECT MAX(newest.created_at) FROM source_revisions newest WHERE newest.source_id = sr.source_id) AS latest_revision_at
     FROM citations c
     LEFT JOIN chunks ch ON ch.id = c.chunk_id
     LEFT JOIN source_revisions sr ON sr.id = ch.source_revision_id
     WHERE c.id = ? OR c.source_uri = ?
     ORDER BY c.created_at DESC
     LIMIT 1`,
  ).get(citationId, evidence.ref);
  if (citation) {
    const hashMismatch = Boolean(evidence.hash && citation.revision_hash && evidence.hash !== citation.revision_hash);
    const revisionMismatch = Boolean(evidence.revision && citation.revision && evidence.revision !== citation.revision);
    const oldRevision = Boolean(citation.revision_created_at && citation.latest_revision_at && citation.revision_created_at < citation.latest_revision_at);
    const stale = explicitStale || staleStatus(metadataStatus(citation.chunk_metadata_json)) || hashMismatch || revisionMismatch || oldRevision;
    return {
      ref: evidence.ref,
      valid: true,
      resolved_by: 'citation',
      stale,
      reason: hashMismatch ? 'hash_mismatch' : revisionMismatch ? 'revision_mismatch' : oldRevision ? 'newer_source_revision' : stale ? 'stale_citation' : null,
    };
  }

  const chunkId = chunkIdentifier(evidence);
  if (chunkId) {
    const chunk = db.query<{ metadata_json: string; hash: string | null; revision: string | null }, [string]>(
      `SELECT ch.metadata_json, sr.hash, sr.revision
       FROM chunks ch LEFT JOIN source_revisions sr ON sr.id = ch.source_revision_id
       WHERE ch.id = ?`,
    ).get(chunkId);
    if (!chunk) return { ref: evidence.ref, valid: false, resolved_by: 'none', stale: explicitStale, reason: 'chunk_not_found' };
    const mismatch = Boolean((evidence.hash && chunk.hash && evidence.hash !== chunk.hash)
      || (evidence.revision && chunk.revision && evidence.revision !== chunk.revision));
    const stale = explicitStale || staleStatus(metadataStatus(chunk.metadata_json)) || mismatch;
    return { ref: evidence.ref, valid: true, resolved_by: 'chunk', stale, reason: mismatch ? 'source_version_mismatch' : stale ? 'stale_chunk' : null };
  }

  const source = db.query<{ metadata_json: string }, [string]>(
    'SELECT metadata_json FROM sources WHERE uri = ? LIMIT 1',
  ).get(evidence.ref);
  if (source) {
    const stale = explicitStale || staleStatus(metadataStatus(source.metadata_json));
    return { ref: evidence.ref, valid: true, resolved_by: 'source', stale, reason: stale ? 'stale_source' : null };
  }

  const runMatch = evidence.ref.match(/^knowledge:\/\/project\/runs\/([^/?#]+)/);
  if (runMatch) {
    const run = db.query<{ id: string }, [string]>('SELECT id FROM runs WHERE id = ?',).get(decodeURIComponent(runMatch[1]));
    if (!run) return { ref: evidence.ref, valid: false, resolved_by: 'none', stale: explicitStale, reason: 'run_not_found' };
    return { ref: evidence.ref, valid: true, resolved_by: 'run', stale: explicitStale, reason: explicitStale ? 'expired_evidence' : null };
  }

  return {
    ref: evidence.ref,
    valid: true,
    resolved_by: 'external_uri',
    stale: explicitStale,
    reason: explicitStale ? 'expired_evidence' : null,
  };
}

function candidateById(db: Database, id: string): CandidateRow | null {
  return db.query<CandidateRow, [string]>('SELECT * FROM knowledge_promotion_candidates WHERE id = ?').get(id) ?? null;
}

function assessCandidate(db: Database, row: CandidateRow, now: string): KnowledgePromotionCandidate {
  const evidence = parseJson<KnowledgePromotionEvidenceRef[]>(row.evidence_refs_json, []);
  const sourceRefs = parseJson<string[]>(row.source_refs_json, []);
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  const checks = emptyChecks();
  checks.invalid_source_refs = sourceRefs.filter((ref) => !validReference(ref));
  checks.citations.entries = evidence.map((entry) => inspectCitation(db, entry, now));
  checks.citations.provided = evidence.length;
  checks.citations.valid = checks.citations.entries.filter((entry) => entry.valid).length;
  checks.citations.invalid = checks.citations.entries.length - checks.citations.valid;
  checks.stale_refs = checks.citations.entries.filter((entry) => entry.stale).map((entry) => entry.ref);

  checks.duplicate_record_ids = db.query<{ id: string }, [string, string]>(
    `SELECT id FROM durable_knowledge_records
     WHERE record_kind = ? AND content_hash = ? AND status IN ('active', 'conflicted')
     ORDER BY created_at`,
  ).all(row.record_kind, row.content_hash).map((entry) => entry.id);
  checks.duplicate_candidate_ids = db.query<{ id: string }, [string, string, string]>(
    `SELECT id FROM knowledge_promotion_candidates
     WHERE id <> ? AND record_kind = ? AND content_hash = ? AND status NOT IN ('rejected')
     ORDER BY created_at`,
  ).all(row.id, row.record_kind, row.content_hash).map((entry) => entry.id);
  checks.conflicting_record_ids = db.query<{ id: string }, [string, string, string]>(
    `SELECT id FROM durable_knowledge_records
     WHERE record_kind = ? AND canonical_key = ? AND content_hash <> ? AND status IN ('active', 'conflicted')
     ORDER BY created_at`,
  ).all(row.record_kind, row.canonical_key, row.content_hash).map((entry) => entry.id);
  checks.conflicting_candidate_ids = db.query<{ id: string }, [string, string, string, string]>(
    `SELECT id FROM knowledge_promotion_candidates
     WHERE id <> ? AND record_kind = ? AND canonical_key = ? AND content_hash <> ?
       AND status IN ('ready', 'needs_approval', 'promoted')
     ORDER BY created_at`,
  ).all(row.id, row.record_kind, row.canonical_key, row.content_hash).map((entry) => entry.id);

  const duplicateOf = checks.duplicate_record_ids[0] ?? checks.duplicate_candidate_ids[0] ?? null;
  const blocked = sourceRefs.length === 0
    || evidence.length === 0
    || checks.invalid_source_refs.length > 0
    || checks.citations.invalid > 0;
  if (row.record_kind === 'decision' || row.record_kind === 'claim') checks.approval_reasons.push(`${row.record_kind}_requires_review`);
  if (metadata.requested_approval === true) checks.approval_reasons.push('explicit_approval_request');
  if (checks.stale_refs.length > 0) checks.approval_reasons.push('stale_evidence');
  if (checks.conflicting_record_ids.length > 0 || checks.conflicting_candidate_ids.length > 0) {
    checks.approval_reasons.push('conflicting_knowledge');
  }
  const requiresApproval = checks.approval_reasons.length > 0;
  const status: KnowledgePromotionStatus = duplicateOf
    ? 'duplicate'
    : blocked
      ? 'blocked'
      : requiresApproval
        ? 'needs_approval'
        : 'ready';

  db.run(
    `UPDATE knowledge_promotion_candidates
     SET status = ?, requires_approval = ?, checks_json = ?, duplicate_of = ?, updated_at = ?, reviewed_at = ?
     WHERE id = ?`,
    [status, requiresApproval ? 1 : 0, JSON.stringify(checks), duplicateOf, now, now, row.id],
  );
  return asCandidate(candidateById(db, row.id)!);
}

export function enqueueKnowledgePromotion(dbPath: string, input: EnqueueKnowledgePromotionInput): {
  created: boolean;
  candidate: KnowledgePromotionCandidate;
} {
  const kinds: KnowledgePromotionKind[] = ['lesson', 'decision', 'claim'];
  const sourceKinds: KnowledgePromotionSourceKind[] = ['memento', 'session', 'report'];
  if (!kinds.includes(input.kind)) throw new Error('Promotion kind must be lesson, decision, or claim.');
  if (!sourceKinds.includes(input.sourceKind)) throw new Error('Promotion source kind must be memento, session, or report.');
  const titleResult = redactSecrets(normalizedText(input.title));
  const contentResult = redactSecrets(normalizedText(input.content));
  if (!titleResult.text) throw new Error('Promotion title is required.');
  if (!contentResult.text) throw new Error('Promotion content is required.');
  const sourceRefs = Array.from(new Set(input.sourceRefs.map(normalizedText).filter(Boolean))).sort();
  const evidenceRefs = input.evidenceRefs.map(normalizeEvidenceRef)
    .filter((entry) => entry.ref.length > 0)
    .sort((a, b) => a.ref.localeCompare(b.ref));
  const canonicalKey = normalizedKey(input.canonicalKey ?? titleResult.text);
  if (!canonicalKey) throw new Error('Promotion canonical key is empty after normalization.');
  const contentHash = `sha256:${createHash('sha256').update(`${input.kind}\0${normalizedText(contentResult.text).toLowerCase()}`).digest('hex')}`;
  const idempotencyKey = stableId('promote', [
    input.sourceKind,
    input.kind,
    canonicalKey,
    contentHash,
    ...sourceRefs,
  ].join('\0'));
  const id = stableId('promotion', idempotencyKey);
  const now = (input.now ?? new Date()).toISOString();
  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    requested_approval: input.requiresApproval === true,
    confidence: input.confidence ?? null,
    valid_from: input.validFrom ?? now,
    valid_to: input.validTo ?? null,
    redactions: titleResult.findings.length + contentResult.findings.length,
  };

  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const existing = db.query<CandidateRow, [string]>(
      'SELECT * FROM knowledge_promotion_candidates WHERE idempotency_key = ?',
    ).get(idempotencyKey);
    if (existing) return { created: false, candidate: asCandidate(existing) };

    db.run(
      `INSERT INTO knowledge_promotion_candidates (
        id, record_kind, title, content, canonical_key, content_hash, source_kind,
        source_refs_json, evidence_refs_json, status, requires_approval, checks_json,
        idempotency_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '{}', ?, ?, ?, ?)`,
      [
        id,
        input.kind,
        titleResult.text,
        contentResult.text,
        canonicalKey,
        contentHash,
        input.sourceKind,
        JSON.stringify(sourceRefs),
        JSON.stringify(evidenceRefs),
        idempotencyKey,
        JSON.stringify(metadata),
        now,
        now,
      ],
    );
    const findings = [...titleResult.findings, ...contentResult.findings];
    if (findings.length > 0) {
      recordRedactionFindings(db, {
        source_uri: sourceRefs[0] ?? `knowledge://promotion/${id}`,
        findings,
        metadata: { promotion_candidate_id: id },
        created_at: now,
      });
    }
    recordAuditEvent(db, {
      event_type: 'knowledge_promotion',
      action: 'enqueue_promotion',
      target_uri: `knowledge://promotion/${id}`,
      decision: 'info',
      metadata: { record_kind: input.kind, source_kind: input.sourceKind, source_refs: sourceRefs },
      created_at: now,
    });
    return { created: true, candidate: assessCandidate(db, candidateById(db, id)!, now) };
  } finally {
    db.close();
  }
}

export function getKnowledgePromotion(dbPath: string, id: string): KnowledgePromotionCandidate | null {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const row = candidateById(db, id);
    return row ? asCandidate(row) : null;
  } finally {
    db.close();
  }
}

export function listKnowledgePromotions(dbPath: string, options: {
  status?: KnowledgePromotionStatus | 'inbox';
  kind?: KnowledgePromotionKind;
  limit?: number;
} = {}): KnowledgePromotionCandidate[] {
  migrateKnowledgeDb(dbPath);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options.status === 'inbox' || !options.status) {
    conditions.push("status IN ('ready', 'needs_approval', 'blocked')");
  } else {
    conditions.push('status = ?');
    params.push(options.status);
  }
  if (options.kind) {
    conditions.push('record_kind = ?');
    params.push(options.kind);
  }
  const db = openKnowledgeDb(dbPath);
  try {
    return db.query<CandidateRow, any[]>(
      `SELECT * FROM knowledge_promotion_candidates
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`,
    ).all(...params, limit).map(asCandidate);
  } finally {
    db.close();
  }
}

export function reviewKnowledgePromotion(dbPath: string, id: string, now = new Date()): KnowledgePromotionCandidate {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const row = candidateById(db, id);
    if (!row) throw new Error(`Promotion candidate not found: ${id}`);
    if (row.status === 'promoted' || row.status === 'rejected') return asCandidate(row);
    return assessCandidate(db, row, now.toISOString());
  } finally {
    db.close();
  }
}

export function promoteKnowledgeCandidate(dbPath: string, id: string, options: PromoteKnowledgeCandidateOptions = {}): {
  ok: boolean;
  promoted: boolean;
  requires_approval: boolean;
  candidate: KnowledgePromotionCandidate;
  record: DurableKnowledgeRecord | null;
  approval_id: string | null;
  reason: string | null;
} {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const now = (options.now ?? new Date()).toISOString();
  try {
    const row = candidateById(db, id);
    if (!row) throw new Error(`Promotion candidate not found: ${id}`);
    if (row.status === 'promoted' && row.promoted_record_id) {
      const existingRecord = db.query<DurableRow, [string]>('SELECT * FROM durable_knowledge_records WHERE id = ?').get(row.promoted_record_id);
      return {
        ok: true,
        promoted: false,
        requires_approval: row.requires_approval === 1,
        candidate: asCandidate(row),
        record: existingRecord ? asDurableRecord(existingRecord) : null,
        approval_id: null,
        reason: 'already_promoted',
      };
    }
    if (row.status === 'rejected') throw new Error(`Promotion candidate ${id} was rejected.`);
    const candidate = assessCandidate(db, row, now);
    if (candidate.status === 'duplicate') {
      return { ok: true, promoted: false, requires_approval: false, candidate, record: null, approval_id: null, reason: 'duplicate' };
    }
    if (candidate.status === 'blocked') {
      return { ok: false, promoted: false, requires_approval: false, candidate, record: null, approval_id: null, reason: 'citation_check_failed' };
    }
    if (candidate.requires_approval && !options.approveWrite) {
      return { ok: false, promoted: false, requires_approval: true, candidate, record: null, approval_id: null, reason: 'approval_required' };
    }
    if (candidate.requires_approval && !options.approvedBy?.trim()) {
      throw new Error('Promotion approval requires --approved-by <name>.');
    }

    const approvedBy = candidate.requires_approval ? options.approvedBy!.trim() : null;
    let approvalId: string | null = null;
    if (candidate.requires_approval) {
      approvalId = createApprovalGate(db, {
        action: 'promote_durable_knowledge',
        target_uri: `knowledge://promotion/${candidate.id}`,
        reason: candidate.checks.approval_reasons.join(', '),
        approved_by: approvedBy,
        metadata: { promotion_candidate_id: candidate.id, checks: candidate.checks },
        created_at: now,
      }).id;
    }
    const recordId = stableId('durable', candidate.id);
    const metadata = {
      ...candidate.metadata,
      promotion_candidate_id: candidate.id,
      source_kind: candidate.source_kind,
      checks: candidate.checks,
      approval_id: approvalId,
      provenance: generatedArtifactProvenance({
        generated_from: `knowledge://promotion/${candidate.id}`,
        artifact_key: `durable/${candidate.record_kind}/${candidate.canonical_key}`,
        source_refs: candidate.source_refs,
        citation_required: true,
      }),
    };
    db.run(
      `INSERT INTO durable_knowledge_records (
        id, record_kind, title, content, canonical_key, content_hash, status,
        source_refs_json, evidence_refs_json, confidence, valid_from, valid_to,
        promoted_from_candidate_id, approved_by, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recordId,
        candidate.record_kind,
        candidate.title,
        candidate.content,
        candidate.canonical_key,
        candidate.content_hash,
        candidate.checks.conflicting_record_ids.length > 0 ? 'conflicted' : 'active',
        JSON.stringify(candidate.source_refs),
        JSON.stringify(candidate.evidence_refs),
        typeof candidate.metadata.confidence === 'number' ? candidate.metadata.confidence : null,
        typeof candidate.metadata.valid_from === 'string' ? candidate.metadata.valid_from : now,
        typeof candidate.metadata.valid_to === 'string' ? candidate.metadata.valid_to : null,
        candidate.id,
        approvedBy,
        JSON.stringify(metadata),
        now,
        now,
      ],
    );
    db.run(
      `UPDATE knowledge_promotion_candidates
       SET status = 'promoted', approved_by = ?, promoted_record_id = ?, promoted_at = ?, updated_at = ?
       WHERE id = ?`,
      [approvedBy, recordId, now, now, candidate.id],
    );
    recordAuditEvent(db, {
      event_type: 'knowledge_promotion',
      action: 'promote_durable_knowledge',
      target_uri: `knowledge://durable/${recordId}`,
      decision: 'allow',
      metadata: { promotion_candidate_id: candidate.id, approval_id: approvalId, source_refs: candidate.source_refs },
      created_at: now,
    });
    const promotedCandidate = asCandidate(candidateById(db, candidate.id)!);
    const record = db.query<DurableRow, [string]>('SELECT * FROM durable_knowledge_records WHERE id = ?').get(recordId)!;
    return {
      ok: true,
      promoted: true,
      requires_approval: candidate.requires_approval,
      candidate: promotedCandidate,
      record: asDurableRecord(record),
      approval_id: approvalId,
      reason: null,
    };
  } finally {
    db.close();
  }
}

export function rejectKnowledgePromotion(dbPath: string, id: string, options: { rejectedBy?: string; now?: Date } = {}): KnowledgePromotionCandidate {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const now = (options.now ?? new Date()).toISOString();
  try {
    const row = candidateById(db, id);
    if (!row) throw new Error(`Promotion candidate not found: ${id}`);
    if (row.status === 'promoted') throw new Error(`Promotion candidate ${id} is already promoted.`);
    db.run(
      `UPDATE knowledge_promotion_candidates
       SET status = 'rejected', approved_by = ?, updated_at = ?, reviewed_at = ?
       WHERE id = ?`,
      [options.rejectedBy?.trim() || null, now, now, id],
    );
    recordAuditEvent(db, {
      event_type: 'knowledge_promotion',
      action: 'reject_promotion',
      target_uri: `knowledge://promotion/${id}`,
      decision: 'deny',
      metadata: { rejected_by: options.rejectedBy ?? null },
      created_at: now,
    });
    return asCandidate(candidateById(db, id)!);
  } finally {
    db.close();
  }
}

export function listDurableKnowledgeRecords(dbPath: string, options: {
  kind?: KnowledgePromotionKind;
  status?: string;
  limit?: number;
} = {}): DurableKnowledgeRecord[] {
  migrateKnowledgeDb(dbPath);
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options.kind) { conditions.push('record_kind = ?'); params.push(options.kind); }
  if (options.status) { conditions.push('status = ?'); params.push(options.status); }
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const db = openKnowledgeDb(dbPath);
  try {
    return db.query<DurableRow, any[]>(
      `SELECT * FROM durable_knowledge_records
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`,
    ).all(...params, limit).map(asDurableRecord);
  } finally {
    db.close();
  }
}
