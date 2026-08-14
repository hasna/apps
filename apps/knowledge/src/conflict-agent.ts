import { randomUUID } from 'node:crypto';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import {
  languageModelFor,
  normalizeAiSdkUsage,
  parseModelRef,
  recordProviderUsage,
  resolveModelRef,
  type NormalizedProviderUsage,
} from './providers';
import {
  getKnowledgeSyncConflictEvidence,
  proposeKnowledgeSyncConflictResolution,
  type KnowledgeSyncConflictProposedPatch,
  type KnowledgeSyncConflictResolutionProposal,
} from './sync';
import type { KnowledgeConfig } from './workspace';

export interface KnowledgeSyncConflictAiProposalOptions {
  dbPath: string;
  id: string;
  config?: KnowledgeConfig;
  env?: Record<string, string | undefined>;
  modelRef?: string;
  fake?: boolean;
  now?: Date;
}

function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}

function insertConflictRun(options: {
  dbPath: string;
  runId: string;
  prompt: string;
  provider: string;
  model: string;
  status: string;
  metadata: Record<string, unknown>;
  now: string;
}): void {
  const db = openKnowledgeDb(options.dbPath);
  try {
    db.run(
      `INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.runId,
        'sync-conflict-proposal',
        options.prompt,
        options.status,
        options.provider,
        options.model,
        JSON.stringify(options.metadata),
        options.now,
        options.now,
      ],
    );
  } finally {
    db.close();
  }
}

function updateConflictRun(options: {
  dbPath: string;
  runId: string;
  status: string;
  provider: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cost_usd: number };
  metadata: Record<string, unknown>;
  now: string;
}): void {
  const db = openKnowledgeDb(options.dbPath);
  try {
    db.run(
      `UPDATE runs
       SET status = ?, provider = ?, model = ?, cost_tokens = ?, cost_usd = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        options.status,
        options.provider,
        options.model,
        options.usage.input_tokens + options.usage.output_tokens,
        options.usage.cost_usd,
        JSON.stringify(options.metadata),
        options.now,
        options.runId,
      ],
    );
  } finally {
    db.close();
  }
}

function addConflictRunEvent(options: {
  dbPath: string;
  runId: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  metadata: Record<string, unknown>;
  now: string;
}): void {
  const db = openKnowledgeDb(options.dbPath);
  try {
    db.run(
      `INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `event_${randomUUID()}`,
        options.runId,
        options.level,
        options.event,
        JSON.stringify(options.metadata),
        options.now,
      ],
    );
  } finally {
    db.close();
  }
}

function recordUsage(dbPath: string, runId: string, usage: NormalizedProviderUsage, now: string): void {
  const db = openKnowledgeDb(dbPath);
  try {
    recordProviderUsage(db, {
      ...usage,
      run_id: runId,
      created_at: now,
    });
  } finally {
    db.close();
  }
}

function promptForConflict(input: {
  deterministic: KnowledgeSyncConflictResolutionProposal;
  evidence: ReturnType<typeof getKnowledgeSyncConflictEvidence>;
}): string {
  return [
    'Build an approval-gated merge proposal for this knowledge sync conflict.',
    'Use only the supplied JSON evidence. Do not claim to inspect external files or write changes.',
    'Return a patch recommendation that a human can review before approval.',
    '',
    `Deterministic proposal:\n${JSON.stringify({
      proposed_strategy: input.deterministic.proposed_strategy,
      summary: input.deterministic.summary,
      warnings: input.deterministic.warnings,
    }, null, 2)}`,
    '',
    `Conflict evidence:\n${JSON.stringify(input.evidence, null, 2)}`,
  ].join('\n');
}

function normalizeConfidence(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0.5;
  return Math.max(0, Math.min(1, number));
}

function normalizePatch(value: Record<string, unknown>, conflictTarget: string): KnowledgeSyncConflictProposedPatch {
  const kind = value.kind === 'choose_local'
    || value.kind === 'choose_remote'
    || value.kind === 'no_op'
    || value.kind === 'custom'
    || value.kind === 'manual_merge'
    ? value.kind
    : 'manual_merge';
  return {
    kind,
    target: typeof value.target === 'string' && value.target ? value.target : conflictTarget,
    strategy: typeof value.strategy === 'string' && value.strategy ? value.strategy : kind.replace('_', '-'),
    summary: typeof value.summary === 'string' && value.summary ? value.summary : 'Review both sides before applying a merge.',
    diff: typeof value.diff === 'string' && value.diff ? value.diff : null,
    metadata: value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
      ? value.metadata as Record<string, unknown>
      : {},
  };
}

function fakePatch(input: ReturnType<typeof getKnowledgeSyncConflictEvidence>): KnowledgeSyncConflictProposedPatch {
  const target = `${input.conflict.entity_kind}:${input.conflict.entity_id}`;
  const hasBothRows = Boolean(input.local_row && input.remote_row);
  return {
    kind: hasBothRows ? 'manual_merge' : 'custom',
    target,
    strategy: hasBothRows ? 'manual-merge' : 'review-and-select',
    summary: hasBothRows
      ? `Fake AI proposal: compare local and remote ${target} row snapshots, then apply a reviewed manual merge.`
      : `Fake AI proposal: inspect ${target} with available conflict metadata before selecting a side.`,
    diff: hasBothRows
      ? [
          `--- ${target} local`,
          `+++ ${target} remote`,
          '@@ review-required @@',
          JSON.stringify({ local: input.local_row, remote: input.remote_row }, null, 2).slice(0, 1200),
        ].join('\n')
      : null,
    metadata: {
      fake: true,
      local_hash: input.conflict.local_hash,
      remote_hash: input.conflict.remote_hash,
      source_refs: input.source_refs,
    },
  };
}

export async function proposeKnowledgeSyncConflictResolutionWithAi(
  options: KnowledgeSyncConflictAiProposalOptions,
): Promise<KnowledgeSyncConflictResolutionProposal> {
  const now = (options.now ?? new Date()).toISOString();
  migrateKnowledgeDb(options.dbPath);
  const deterministic = proposeKnowledgeSyncConflictResolution(options.dbPath, options.id);
  const evidence = getKnowledgeSyncConflictEvidence(options.dbPath, options.id);
  const resolvedModelRef = resolveModelRef(options.modelRef ?? 'default', options.config);
  const parsed = parseModelRef(resolvedModelRef);
  const runId = `run_${randomUUID()}`;
  const prompt = promptForConflict({ deterministic, evidence });
  insertConflictRun({
    dbPath: options.dbPath,
    runId,
    prompt,
    provider: parsed.provider,
    model: parsed.model,
    status: options.fake ? 'dry_run' : 'running',
    metadata: {
      conflict_id: options.id,
      mode: 'ai',
      fake: options.fake === true,
      read_only_tools: evidence.read_only_tools.map((tool) => tool.name),
    },
    now,
  });
  addConflictRunEvent({
    dbPath: options.dbPath,
    runId,
    level: 'info',
    event: 'conflict_evidence_retrieved',
    metadata: {
      citations: evidence.citations.length,
      source_refs: evidence.source_refs.length,
      read_only_tools: evidence.read_only_tools,
    },
    now,
  });

  let patch: KnowledgeSyncConflictProposedPatch;
  let summary: string;
  let confidence = 0.5;
  let usage = {
    input_tokens: estimateTokens(prompt),
    output_tokens: 0,
    cost_usd: 0,
  };

  if (options.fake) {
    patch = fakePatch(evidence);
    summary = patch.summary;
    usage.output_tokens = estimateTokens(summary) + estimateTokens(patch.diff ?? '');
  } else {
    try {
      const { generateObject } = await import('ai');
      const { z } = await import('zod');
      const model = await languageModelFor(resolvedModelRef, {
        config: options.config,
        env: options.env,
      });
      const schema = z.object({
        summary: z.string(),
        confidence: z.number().min(0).max(1),
        proposed_patch: z.object({
          kind: z.enum(['manual_merge', 'choose_local', 'choose_remote', 'no_op', 'custom']),
          target: z.string(),
          strategy: z.string(),
          summary: z.string(),
          diff: z.string().nullable(),
          metadata: z.record(z.string(), z.unknown()).default({}),
        }),
      });
      const result = await generateObject({
        model: model as never,
        schema,
        system: 'You are a read-only knowledge sync conflict proposal agent. You produce reviewable proposals only; never approve or apply writes.',
        prompt,
      });
      summary = result.object.summary;
      confidence = normalizeConfidence(result.object.confidence);
      patch = normalizePatch(result.object.proposed_patch, `${evidence.conflict.entity_kind}:${evidence.conflict.entity_id}`);
      const normalized = normalizeAiSdkUsage({
        provider: parsed.provider,
        model: parsed.model,
        usage: result.usage as Record<string, unknown> | undefined,
        providerMetadata: result.providerMetadata as Record<string, unknown> | undefined,
      });
      usage = {
        input_tokens: normalized.input_tokens,
        output_tokens: normalized.output_tokens,
        cost_usd: normalized.cost_usd,
      };
      recordUsage(options.dbPath, runId, normalized, now);
    } catch (error) {
      addConflictRunEvent({
        dbPath: options.dbPath,
        runId,
        level: 'error',
        event: 'conflict_proposal_generation_failed',
        metadata: { message: error instanceof Error ? error.message : String(error) },
        now,
      });
      updateConflictRun({
        dbPath: options.dbPath,
        runId,
        status: 'failed',
        provider: parsed.provider,
        model: parsed.model,
        usage,
        metadata: {
          conflict_id: options.id,
          mode: 'ai',
          error: error instanceof Error ? error.message : String(error),
        },
        now,
      });
      throw error;
    }
  }

  updateConflictRun({
    dbPath: options.dbPath,
    runId,
    status: options.fake ? 'dry_run' : 'completed',
    provider: parsed.provider,
    model: parsed.model,
    usage,
    metadata: {
      conflict_id: options.id,
      mode: 'ai',
      fake: options.fake === true,
      confidence,
      proposed_strategy: patch.strategy,
      citation_count: evidence.citations.length,
    },
    now,
  });
  addConflictRunEvent({
    dbPath: options.dbPath,
    runId,
    level: 'info',
    event: options.fake ? 'fake_conflict_proposal_generated' : 'conflict_proposal_generated',
    metadata: {
      strategy: patch.strategy,
      confidence,
      patch_kind: patch.kind,
    },
    now,
  });

  return {
    ...deterministic,
    mode: 'ai',
    proposed_strategy: patch.strategy,
    summary,
    proposed_patch: patch,
    citations: evidence.citations,
    confidence,
    agent: {
      generated: true,
      provider: parsed.provider,
      model: parsed.model,
      run_id: runId,
      read_only_tools: evidence.read_only_tools,
      usage,
    },
    warnings: [
      ...deterministic.warnings,
      ...(evidence.remote_row ? [] : ['remote_row_snapshot_unavailable']),
    ],
    message: `Prepared AI SDK approval-gated merge proposal for ${options.id}`,
  };
}
